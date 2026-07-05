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

// stdout/stderr ルーティング (bridge.js のローカル経路と同じ設計を worker にも)。
// 自前 C 側の逐次ログは全て [小文字タグ] 形式 ([dos_loader]/[int21h…]/[batch]/[dos_exec]/[tty] 等)。
// Chrome は console.warn/error に赤黄+スタックトレースを自動付与するので、無害な診断ログが「エラーの山」に
// 見えてしまう (worker 既定は素の console.warn だった)。これら chatter は既定で console.debug へ回し、
// DevTools の Verbose レベルに送る (既定は非表示・captured なので消えてはいない = レベルを All にすれば読める)。
// 本物の emscripten エラー (Aborted/RuntimeError 等 = 先頭が [小文字 でない) は console.error で残す。
// verbose (init 時 ?debug/QB_VERBOSE か qbDebug.verbose(1)) 時は chatter も console.log で前面表示。
const QB_CHATTER = /^\[[a-z]/;
let logVerbose = false;
const logOut = (t) => { if (logVerbose || !QB_CHATTER.test(t)) console.log(t); };
const logErr = (t) => { if (QB_CHATTER.test(t)) { if (logVerbose) console.log(t); else console.debug(t); }
                        else console.error(t); };

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
// この時間 consumer (worklet/DAC) がリングを排出しないと「音声同期を諦めて映像だけ wall-clock で
// 進める」モードに入る。リングは ~341ms 分 (RING_FRAMES/rate) しか保持しないので、排出中なら満杯は
// ms 単位で解消する → 500ms 満杯が続く = 真に consumer が止まっている。短いほどブート/Safari 初動が速い。
const STALL_MS = 500;

// 音声リング (Stage 1c)。main が SAB を確保し init で渡す。SPSC: ctrl[0]=writeIdx, ctrl[1]=readIdx。
let audioSab = null, audioCtrl = null, audioData = null, audioCap = 0, audioMask = 0;
let fillPtr = 0, audioOn = false;
let audioRate = 48000;       // init で msg.audioRate を保持 (差し替え無音長を ms→block 換算するのに使う)

// 曲差し替え (.M プレビューの 2 曲目以降) の前曲残響対策。差し替え時にリングをクリアして前曲の
// バッファ残量を破棄し (g_swapSilence>0 の間は) 数ブロックを無音で埋めて差し替え窓 (シェル wake→
// PMP <曲> ロードの間に前曲が鳴り続ける分) を隠す。初回再生 (g_musicStarted=false) は前曲が無いので
// スキップしイントロを削らない。reset で g_musicStarted を倒すので新セッションの初曲も無音化しない。
let g_swapSilence = 0;       // 残りの無音ブロック数 (drainBlockToRing が消費)
let g_musicStarted = false;  // この音楽セッションで 1 曲以上演奏したか (差し替え判定用)
const SWAP_SILENCE_MS = 120; // 差し替え窓を覆う無音長 (短いほど次曲のイントロ欠けが減る)

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

// リングを空にする (producer 側で writeIdx を readIdx へ巻き戻す = バッファ済み前曲を破棄)。
// consumer (worklet) は readIdx==writeIdx で underrun→無音を出すので、巻き戻しは安全 (SPSC の producer 操作)。
function clearRing() { if (audioCtrl) Atomics.store(audioCtrl, 0, Atomics.load(audioCtrl, 1)); }
// 差し替え窓を覆う無音ブロック数 (SWAP_SILENCE_MS を block 長で割る。最低 2 ブロック)。
function swapSilenceBlocks() {
    const blockMs = bufsize / (audioRate || 48000) * 1000;
    return Math.max(2, Math.round(SWAP_SILENCE_MS / blockMs));
}

// 1 ブロック (s_samples) を pcmlock → int16→float32 でリングへ書く。
// pcmlock 直前に sound_sync が CPU クロックにロックステップでブロックを満たしているので top-up ≈0。
let audioActiveReported = false;   // 「実際に音が鳴り始めた」を main へ 1 度通知する用 (音楽プレイヤーの計時開始)
function drainBlockToRing() {
    c.audioFill(handle, fillPtr, bufsize);              // pcmlock → fillPtr に int16 stereo (bufsize frames)
    // 曲差し替え直後はこのブロックを無音で埋める (前曲の続きを隠す)。audioFill は必ず呼んで
    // emu の sound パイプラインは消費し、ring へ書く値だけ 0 にする (タイミングは進める)。
    const mute = g_swapSilence > 0;
    if (mute) g_swapSilence--;
    const src = new Int16Array(M.HEAPU8.buffer, fillPtr, bufsize * 2);
    let w = Atomics.load(audioCtrl, 0);
    let peak = 0;
    for (let i = 0; i < bufsize; i++) {
        const idx = (w & audioMask) * 2;
        const l = mute ? 0 : src[i * 2], r = mute ? 0 : src[i * 2 + 1];
        audioData[idx]     = l / 32768;
        audioData[idx + 1] = r / 32768;
        // L/R 両チャンネルのピークを見る (ローカル経路 bridge.js と揃える)。L だけだと
        // 完全に右パンの曲で audioActive が立たず、音楽プレイヤーの計時が 0:00 で止まる。
        const a = Math.max(l < 0 ? -l : l, r < 0 ? -r : r); if (a > peak) peak = a;
        w = (w + 1) | 0;
    }
    Atomics.store(audioCtrl, 0, w);
    // 無音マスク中は audioActive を立てない (前曲の窓で計時開始するのを防ぐ。次曲の実音で立てる)。
    if (!mute && !audioActiveReported && peak > 1000) { audioActiveReported = true; postMessage({ type: 'audioActive' }); }
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
        else if (lastAdvanceMs && now - lastAdvanceMs > STALL_MS) {
            // リングが満杯のまま STALL_MS 進まない = consumer (worklet/DAC) がリングを排出していない:
            // gesture 前の suspended・context 中断・worklet 不発、あるいは resume 後も worklet が
            // 排出しない環境 (macOS Safari で 0.3fps として観測)。**映像の前進を音声リング排出から
            // 切り離す**: 音声同期を諦め、映像を wall-clock (~56fps) で steady-tick する (音は据え置き
            // = リングは満杯のまま上書きしない)。これで「映像が 1 フレーム/STALL_MS に潰れる」を防ぐ。
            // ここではあえて lastAdvanceMs を更新しない → consumer が復帰するまで毎 tick ここで映像を
            // 進め続ける。consumer が排出を再開しリングに空きが出れば、上の通常ループが回って n>0 →
            // lastAdvanceMs が更新され、自動的に通常の音声同期 (DAC ロック) へ戻る。
            let steps = 0;
            while (now >= nextDue && steps < MAX_CATCHUP) { c.runFrame(handle); nextDue += MS_PER_FRAME; steps++; }
            if (steps === MAX_CATCHUP && now > nextDue) nextDue = now + MS_PER_FRAME;
            sampleDebt = 0;   // 復帰時に溜まった debt を一気に drain しない (音声フラッド防止)
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
    logVerbose = !!msg.verbose;                          // ?debug/QB_VERBOSE を main から引き継ぐ (chatter を前面表示)
    importScripts(msg.coreUrl);                          // self.NP2KaiModule (MODULARIZE)
    const coreUrl = msg.coreUrl;
    M = await self.NP2KaiModule({
        locateFile: (p) => new URL(p, coreUrl).href,     // wasm を coreUrl と同じディレクトリから
        print:    (t) => logOut(t),
        printErr: (t) => logErr(t),
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
    if (msg.audioRate) { M.ccall('np2kai_set_audio_rate', 'number', ['number'], [msg.audioRate]); audioRate = msg.audioRate; }

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
    try {
    switch (m.type) {
        // init は async。fire-and-forget にすると importScripts 404 / wasm instantiate 失敗が
        // unhandled rejection になり reply が返らず、bridge.js の await が永久 pending =
        // デプロイ事故が「無言の真っ暗」になる (local モードは showFatal が出るのと非対称)。
        case 'init':
            init(m).catch((e) => {
                console.error('emu-worker: init failed:', e);
                reply(m.id, { error: String((e && e.message) || e) });
            });
            break;
        case 'run': if (m.on) startLoop(); else running = false; break;
        case 'setVerbose': logVerbose = !!m.on; break;   // qbDebug.verbose(1) で chatter を前面表示へ切替

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
        case 'readFile': {
            let bytes = null;
            try { bytes = M.FS.readFile(m.path); } catch (_) {}
            if (bytes) { const buf = bytes.buffer.slice(0); reply(m.id, { bytes: new Uint8Array(buf) }, [buf]); }
            else reply(m.id, { bytes: null });
            break;
        }

        // ライフサイクル
        case 'insertFdd': reply(m.id, { r: c.insertFdd(handle, m.path, m.drive, m.readonly ? 1 : 0) }); break;
        case 'reset': audioActiveReported = false; g_musicStarted = false; g_swapSilence = 0; c.reset(handle); reply(m.id, { ok: true }); break;

        // ステージング (生バイトを HEAP 経由で)
        case 'stageCom': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageCom(p, n, m.cmdline || '', m.path || '')) }); break;
        case 'stageExe': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageExe(p, n, m.cmdline || '', m.path || '')) }); break;
        case 'stageScript': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageScript(p, n, m.label || '')) }); break;
        case 'stageBatch': reply(m.id, { r: withHeapBytes(m.bytes, (p, n) => c.stageBatch(p, n, m.label || '')) }); break;
        case 'stageMusic': reply(m.id, { r: c.stageMusic() }); break;
        case 'musicPlay':
            audioActiveReported = false;
            // 2 曲目以降 (= 差し替え) は前曲の残響を断つ (Approach A): リングをクリアして前曲の
            // バッファ残量を破棄し、差し替え窓のあいだ無音を埋める。初回 (g_musicStarted=false) は
            // 前曲が無いのでスキップ (イントロを削らない)。
            if (g_musicStarted && audioOn && audioCtrl) { clearRing(); g_swapSilence = swapSilenceBlocks(); }
            g_musicStarted = true;
            reply(m.id, { r: c.musicPlay(m.song) });
            break;

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
    } catch (e) {
        // 同期例外 (FS の ENOTDIR 等) も握りつぶさない: id 付き (= 返信待ちがいる) メッセージは
        // error reply で呼び出し元の await を必ず決着させる (無いと Promise が永久 pending)。
        console.error('emu-worker: ' + (m && m.type) + ' failed:', e);
        if (m && m.id != null) reply(m.id, { error: String((e && e.message) || e) });
    }
};
