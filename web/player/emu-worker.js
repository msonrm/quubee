// QuuBee emulator-side Worker (Stage 1+, docs/audio_worker_migration.md)。
//
// この Worker が NP2kai 本体・run ループ・Emscripten FS・全 np2kai_* 呼び出しを所有する。
// メインスレッド (bridge.js) は DOM/ファイラ/入力捕捉だけを持ち、ここへコマンドを送る。
// emulation を専用スレッドの一定ペースで回すことで、メインスレッドのジャンク/rAF ジッタから
// 切り離し「テンポの揺れ・フレームが詰まるスキップ」を根治する。
//
// Stage 1a: 表示 (framebuffer を postMessage transfer で main へ) + 入力 + FS + ライフサイクル。音は無し。
// Stage 1c/2: 音声 (audio_fill→SAB リング)。audio_fill はブロック粒度 (s_samples) で run_frame の clock
//             前進との噛み合わせが繊細なので、sound.c のクロックを確かめつつ別途実装する (ここでは stub)。

'use strict';

let M = null;
let handle = 0;
let bufsize = 0;

// HEAP scratch
let pW = 0, pH = 0, pBpp = 0;

// cwrap holders (init で確定)
let c = {};

// run ループ
let running = false;
let paused = false;             // 一時停止 (music pause)。tick がフレームを進めない = 位置保持・無音
const TARGET_HZ   = 56;
const MS_PER_STEP = 1000 / TARGET_HZ;
const MS_PER_FRAME = 1000 / 56.42;   // 音声駆動時の wall-clock フレーム周期 (PC-98 24kHz VSYNC、映像の滑らかさ)
const MAX_CATCHUP = 8;          // 専用スレッドなので main より広く取れる
let nextDue = 0;
let samplesPerFrame = 48000 / 56.42;   // run_frame 1 回が進める音声サンプル数 (init で rate から)
let sampleDebt = 0;             // 「ブロック分のフレームを走らせてから pcmlock」用の蓄積
let lastFbPost = 0;             // framebuffer post のスロットリング
let lastAdvanceMs = 0;          // 音声駆動中に最後にフレームを進めた時刻 (consumer 停止の検知用)
const STALL_MS = 1500;          // この時間 consumer がリングを排出しないと steady-tick で映像だけ救う

// 音声リング (Stage 1c)。main が SAB を確保し init で渡す。SPSC: ctrl[0]=writeIdx, ctrl[1]=readIdx。
let audioSab = null, audioCtrl = null, audioData = null, audioCap = 0, audioMask = 0;
let fillPtr = 0, audioOn = false;

function reply(id, payload, transfer) {
    if (id === undefined) return;
    postMessage(Object.assign({ type: 'reply', id }, payload || {}), transfer || []);
}

// 生バイトを C ヒープへ置いて fn を呼び、解放する (stage* 用。fn(ptr,len,...rest))
function withHeapBytes(bytes, fn) {
    const ptr = M._malloc(bytes.length);
    M.HEAPU8.set(bytes, ptr);
    try { return fn(ptr, bytes.length); }
    finally { M._free(ptr); }
}

// ---- FS ヘルパ (MEMFS 名 = SJIS 生バイトの latin1。bridge と同じ) ----
function clearRun() {
    function walk(path) {
        let st;
        try { st = M.FS.stat(path); } catch (_) { return; }
        if (M.FS.isDir(st.mode)) {
            for (const e of M.FS.readdir(path)) {
                if (e === '.' || e === '..') continue;
                walk(path + '/' + e);
            }
            try { M.FS.rmdir(path); } catch (_) {}
        } else {
            try { M.FS.unlink(path); } catch (_) {}
        }
    }
    try { for (const e of M.FS.readdir('/run')) { if (e !== '.' && e !== '..') walk('/run/' + e); } }
    catch (_) {}
}

function readTree(dir) {                       // /run ライブ反映用: {rel: bytes} を集める
    const out = [];
    function walk(path, prefix) {
        let ents; try { ents = M.FS.readdir(path); } catch (_) { return; }
        for (const e of ents) {
            if (e === '.' || e === '..') continue;
            const p = path + '/' + e;
            let st; try { st = M.FS.stat(p); } catch (_) { continue; }
            if (M.FS.isDir(st.mode)) walk(p, prefix + e + '/');
            else out.push({ rel: prefix + e, size: st.size });
        }
    }
    walk(dir, '');
    return out;
}

// /run/<rel> へ書く (親ディレクトリも作る)。local emu.writeRun と対応。
function writeRunFile(rel, data) {
    try { M.FS.mkdir('/run'); } catch (_) {}
    const parts = rel.split('/');
    let dir = '/run';
    for (let k = 0; k < parts.length - 1; k++) { dir += '/' + parts[k]; try { M.FS.mkdir(dir); } catch (_) {} }
    M.FS.writeFile('/run/' + rel, data);
}

// /run を走査して [{name, size, mtimeMs}] (ライブ反映用、原ケース保持)。local emu.scanRun と対応。
function scanRunTree() {
    const out = [];
    function walk(path, prefix) {
        let ents; try { ents = M.FS.readdir(path); } catch (_) { return; }
        for (const e of ents) {
            if (e === '.' || e === '..') continue;
            const p = path + '/' + e;
            let st; try { st = M.FS.stat(p); } catch (_) { continue; }
            if (M.FS.isDir(st.mode)) walk(p, prefix + e + '/');
            else out.push({ name: prefix + e, size: st.size, mtimeMs: +st.mtime });
        }
    }
    walk('/run', '');
    return out;
}

// ---- run ループ ----
function postFrame() {
    const fbPtr = c.getFb(handle, pW, pH, pBpp);
    if (!fbPtr) return;
    const w = M.getValue(pW, 'i32');
    const h = M.getValue(pH, 'i32');
    const bpp = M.getValue(pBpp, 'i32');
    if (w <= 0 || h <= 0) return;
    const bytes = w * h * bpp;
    // ALLOW_MEMORY_GROWTH で heap が再確保されるので毎回 view を取り直す
    const buf = M.HEAPU8.slice(fbPtr, fbPtr + bytes).buffer;   // コピー (transfer 用)
    postMessage({ type: 'frame', w, h, bpp, buf }, [buf]);
}

function ringFill() { return (Atomics.load(audioCtrl, 0) - Atomics.load(audioCtrl, 1)) | 0; }

// 1 ブロック (s_samples) を pcmlock → int16→float32 でリングへ書く。
// pcmlock 直前に sound_sync が CPU クロックにロックステップでブロックを満たしているので top-up ≈0。
let audioActiveReported = false;   // 「実際に音が鳴り始めた」を main へ 1 度通知する用 (音楽プレイヤーの計時開始)
function drainBlockToRing() {
    c.audioFill(handle, fillPtr, bufsize);              // pcmlock → fillPtr に int16 stereo (bufsize frames)
    const src = new Int16Array(M.HEAPU8.buffer, fillPtr, bufsize * 2);
    let w = Atomics.load(audioCtrl, 0);
    let peak = 0;
    for (let i = 0; i < bufsize; i++) {
        const idx = (w & audioMask) * 2;
        const l = src[i * 2], r = src[i * 2 + 1];
        audioData[idx]     = l / 32768;
        audioData[idx + 1] = r / 32768;
        const a = l < 0 ? -l : l; if (a > peak) peak = a;
        w = (w + 1) | 0;
    }
    Atomics.store(audioCtrl, 0, w);
    if (!audioActiveReported && peak > 1000) { audioActiveReported = true; postMessage({ type: 'audioActive' }); }
}

function tick() {
    if (!running) return;
    if (paused) { setTimeout(tick, 30); return; }   // 一時停止: フレームを進めない (位置保持・無音)
    if (audioOn && audioCtrl) {
        // 映像と音を両立: フレームは wall-clock (~56.42fps = PC-98 VSYNC) で「ばらして」進め
        // (5 フレーム一気だと映像がブロックレート≈12fps に落ちて見える)、音はリング fill の
        // ゲートで DAC にロックして drift を防ぐ:
        //  - ring 満杯 (空き < 1 ブロック) なら走らせない = エミュを DAC に同期 (音欠け/drift 防止)。
        //  - ring 空きが多い (枯れそう) ときだけ catch-up を許して詰める。
        const now = performance.now();
        const free = audioCap - ringFill();
        const maxCatch = (free > bufsize * 2) ? 4 : 1;
        let n = 0;
        while (now >= nextDue && (audioCap - ringFill()) >= bufsize && n < maxCatch) {
            c.runFrame(handle);
            sampleDebt += samplesPerFrame;
            if (sampleDebt >= bufsize) { drainBlockToRing(); sampleDebt -= bufsize; }
            nextDue += MS_PER_FRAME;
            n++;
        }
        if (n > 0) { lastAdvanceMs = now; }
        else if (lastAdvanceMs && now - lastAdvanceMs > STALL_MS && now >= nextDue) {
            // リングが満杯のまま STALL_MS 進まない = consumer (worklet/DAC) が排出していない
            // (gesture 前の suspended・context 中断・worklet 不発)。映像が固まらないよう steady-tick で
            // 1 フレームだけ進める (音は据え置き)。consumer が復帰しリングに空きが出れば次ループで通常同期へ戻る。
            c.runFrame(handle);
            nextDue = now + MS_PER_FRAME;
            lastAdvanceMs = now;
        }
        if (n === maxCatch && now > nextDue) nextDue = now;   // 大幅遅延はリセット
    } else {
        // pre-audio (boot/曲ロード中、または AudioContext 未 resume) は steady tick で進める。
        const now = performance.now();
        let steps = 0;
        while (now >= nextDue && steps < MAX_CATCHUP) { c.runFrame(handle); nextDue += MS_PER_STEP; steps++; }
        if (steps === MAX_CATCHUP && now > nextDue) nextDue = now + MS_PER_STEP;
    }
    // framebuffer は表示レート (~60Hz) にスロットル
    const t = performance.now();
    if (t - lastFbPost >= 15) { postFrame(); lastFbPost = t; }
    const delay = audioOn ? 3 : Math.max(0, nextDue - performance.now());
    setTimeout(tick, delay);
}

function startLoop() {
    if (running) return;
    running = true;
    nextDue = performance.now();
    lastAdvanceMs = performance.now();   // stall 検知の基準時刻 (audioOn が既に true のケース用)
    tick();
}

// ---- init ----
async function init(msg) {
    importScripts(msg.coreUrl);                          // self.NP2KaiModule (MODULARIZE)
    const coreUrl = msg.coreUrl;
    M = await self.NP2KaiModule({
        locateFile: (p) => new URL(p, coreUrl).href,     // wasm を coreUrl と同じディレクトリから
        print:    (t) => console.log(t),
        printErr: (t) => console.warn(t),
    });

    c.runFrame   = M.cwrap('np2kai_run_frame', null, ['number']);
    c.getFb      = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
    c.audioFill  = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    c.keyDown    = M.cwrap('np2kai_key_down', null, ['number', 'number']);
    c.keyUp      = M.cwrap('np2kai_key_up',   null, ['number', 'number']);
    c.injectText = M.cwrap('np2kai_inject_text', 'number', ['number', 'number', 'number']);
    c.mouseMove  = M.cwrap('np2kai_mouse_move',   null, ['number', 'number', 'number']);
    c.mouseButton= M.cwrap('np2kai_mouse_button', null, ['number', 'number', 'number']);
    c.insertFdd  = M.cwrap('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number']);
    c.reset      = M.cwrap('np2kai_reset', null, ['number']);
    c.stageCom   = M.cwrap('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string']);
    c.stageExe   = M.cwrap('np2kai_dos_stage_exe', 'number', ['number', 'number', 'string', 'string']);
    c.stageScript= M.cwrap('np2kai_dos_stage_script', 'number', ['number', 'number', 'string']);
    c.stageBatch = M.cwrap('np2kai_dos_stage_batch', 'number', ['number', 'number', 'string']);
    c.stageMusic = M.cwrap('np2kai_dos_stage_music', 'number', []);
    c.musicPlay  = M.cwrap('np2kai_dos_music_play', 'number', ['string']);
    c.getExitFn  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    if (msg.audioRate) M.ccall('np2kai_set_audio_rate', 'number', ['number'], [msg.audioRate]);

    // data-dir ファイル (FONT.BMP / リズムサンプル等) を create より前に書く。
    // create→pccore_reset で font ROM / リズム ROM が読まれるため、先に置く必要がある。
    if (msg.dataFiles) {
        for (const f of msg.dataFiles) {
            try { M.FS.writeFile(f.path, f.bytes); } catch (_) {}
        }
    }

    handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { reply(msg.id, { error: 'np2kai_create failed' }); return; }
    try { M.FS.mkdir('/run'); } catch (_) {}

    bufsize = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    pW = M._malloc(4); pH = M._malloc(4); pBpp = M._malloc(4);
    fillPtr = M._malloc(bufsize * 2 * 2);                // int16 stereo (Stage 1c)

    samplesPerFrame = (msg.audioRate || 48000) / 56.42;  // run_frame 1 回ぶんの音声サンプル数
    if (msg.audioSab) {                                  // 音声リング (main が確保し共有)
        audioSab = msg.audioSab; audioCap = msg.ringFrames | 0; audioMask = audioCap - 1;
        audioCtrl = new Int32Array(audioSab, 0, 2);
        audioData = new Float32Array(audioSab, 8, audioCap * 2);
    }

    reply(msg.id, { bufsize });
}

// ---- メッセージディスパッチ ----
onmessage = (ev) => {
    const m = ev.data;
    switch (m.type) {
        case 'init': init(m); break;
        case 'run': if (m.on) startLoop(); else running = false; break;

        // 入力 (handle はここで前置)
        case 'key':   (m.down ? c.keyDown : c.keyUp)(handle, m.code); break;
        case 'injectText': withHeapBytes(m.bytes, (p, n) => c.injectText(handle, p, n)); break;   // ホスト IME → SJIS 注入
        case 'mouseMove':   c.mouseMove(handle, m.dx, m.dy); break;
        case 'mouseButton': c.mouseButton(handle, m.btn, m.state); break;

        // FS
        case 'writeFile': M.FS.writeFile(m.path, m.bytes); reply(m.id, { ok: true }); break;
        case 'mkdir': try { M.FS.mkdir(m.path); } catch (_) {} reply(m.id, { ok: true }); break;
        case 'clearRun': clearRun(); reply(m.id, { ok: true }); break;
        case 'writeRun': writeRunFile(m.rel, m.data); reply(m.id, { ok: true }); break;
        case 'stage': for (const it of (m.items || [])) writeRunFile(it.rel, it.data); reply(m.id, { ok: true }); break;
        case 'scanRun': reply(m.id, { files: scanRunTree() }); break;
        case 'readTree': reply(m.id, { files: readTree(m.path || '/run') }); break;
        case 'readFile': {
            let bytes = null;
            try { bytes = M.FS.readFile(m.path); } catch (_) {}
            if (bytes) { const buf = bytes.buffer.slice(0); reply(m.id, { bytes: new Uint8Array(buf) }, [buf]); }
            else reply(m.id, { bytes: null });
            break;
        }

        // ライフサイクル
        case 'insertFdd': reply(m.id, { r: c.insertFdd(handle, m.path, m.drive, m.readonly ? 1 : 0) }); break;
        case 'reset': audioActiveReported = false; c.reset(handle); reply(m.id, { ok: true }); break;

        // ステージング (生バイトを HEAP 経由で)
        case 'stageCom': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageCom(p, n, m.cmdline || '', m.label || '')) }); break;
        case 'stageExe': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageExe(p, n, m.cmdline || '', m.label || '')) }); break;
        case 'stageScript': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageScript(p, n, m.label || '')) }); break;
        case 'stageBatch': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageBatch(p, n, m.label || '')) }); break;
        case 'stageMusic': reply(m.id, { r: c.stageMusic() }); break;
        case 'musicPlay': audioActiveReported = false; reply(m.id, { r: c.musicPlay(m.song) }); break;

        case 'getExit': {
            const p = M._malloc(4);
            const exited = c.getExitFn(p);
            const code = M.getValue(p, 'i32');
            M._free(p);
            reply(m.id, { exited: !!exited, code });
            break;
        }

        // 汎用 ccall (set_beep_mute/set_pmd_irq/enable_midi_now/set_fmgen/set_clock_multiple/
        // set_vol/get_vol/各 debug getter 等。prependHandle で handle 前置)
        case 'call': {
            const args = m.prependHandle ? [handle, ...(m.args || [])] : (m.args || []);
            const r = M.ccall(m.fn, m.ret || null, m.argTypes || [], args);
            reply(m.id, { r });
            break;
        }

        case 'setPaused': paused = !!m.on; break;         // 一時停止 (music pause)
        case 'audioOn':                                   // Stage 1c: 音声駆動の開始/停止
            audioOn = !!m.on;
            if (audioOn) { nextDue = performance.now(); sampleDebt = 0; lastAdvanceMs = performance.now(); }  // ペース時計 + stall 検知をリセット
            break;

        default: console.warn('emu-worker: unknown message', m.type);
    }
};
