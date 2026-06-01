// SPDX-License-Identifier: MIT OR GPL-2.0-or-later
const canvas = document.getElementById('screen');
const ctx    = canvas.getContext('2d');
// ドライブ UI 要素
const driveEls = Array.from(document.querySelectorAll('.drive'));
function setDriveName(kind, drive, name) {
    const el = driveEls.find(d => d.dataset.kind === kind && +d.dataset.drive === drive);
    if (el) el.querySelector('.name').textContent = name;
}

// オフスクリーンキャンバス: エミュレータの生解像度フレームを受け取る
const offscreen = document.createElement('canvas');
const offCtx    = offscreen.getContext('2d');

ctx.imageSmoothingEnabled = false;

// PAR 補正は廃止 (4:2.5 表示)。さらに 1 ソース px を「N × N 物理画素」に
// ぴったり合わせ込むことで、非整数 dpr (Chromebook の 1.25 等) の OS スケー
// リングを 1:1 にして 100% でもピクセルパーフェクトを実現する。
//   bitmap = source × N        (整数倍 nearest で焼く)
//   css    = bitmap / dpr      (CSS→物理 が bitmap = physical になる)
// 結果: 1 ソース px = N 物理 px (ブラウザ/OS による追加スケーリングなし)
function fitCanvas(w, h) {
    const maxW = window.innerWidth  - 2;
    const maxH = window.innerHeight - 32;
    const dpr  = window.devicePixelRatio || 1;
    // CSS が表示領域に収まる最大の N を選ぶ
    const N = Math.max(1, Math.floor(Math.min(maxW * dpr / w, maxH * dpr / h)));
    canvas.width        = w * N;
    canvas.height       = h * N;
    canvas.style.width  = (w * N / dpr) + 'px';
    canvas.style.height = (h * N / dpr) + 'px';
    ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', () => fitCanvas(offscreen.width || 640, offscreen.height || 400));

// KeyboardEvent.code → PC-98 keycode (NKEY_*).
// 位置ベースのマップ。JIS/US どちらの物理配列でも、その物理位置に対応する
// PC-98 キーを送る。PC-98 固有キー (XFER, NFER, KANA, GRPH, HELP, COPY, STOP,
// VF1-VF5) はここでは未マップ。
const PC98_KEYMAP = {
    // 英字
    'KeyA': 0x1d, 'KeyB': 0x2d, 'KeyC': 0x2b, 'KeyD': 0x1f,
    'KeyE': 0x12, 'KeyF': 0x20, 'KeyG': 0x21, 'KeyH': 0x22,
    'KeyI': 0x17, 'KeyJ': 0x23, 'KeyK': 0x24, 'KeyL': 0x25,
    'KeyM': 0x2f, 'KeyN': 0x2e, 'KeyO': 0x18, 'KeyP': 0x19,
    'KeyQ': 0x10, 'KeyR': 0x13, 'KeyS': 0x1e, 'KeyT': 0x14,
    'KeyU': 0x16, 'KeyV': 0x2c, 'KeyW': 0x11, 'KeyX': 0x2a,
    'KeyY': 0x15, 'KeyZ': 0x29,
    // 数字 (メインキー)
    'Digit0': 0x0a, 'Digit1': 0x01, 'Digit2': 0x02, 'Digit3': 0x03,
    'Digit4': 0x04, 'Digit5': 0x05, 'Digit6': 0x06, 'Digit7': 0x07,
    'Digit8': 0x08, 'Digit9': 0x09,
    // 記号 (位置ベース)
    'Minus':        0x0b,   // -
    'Equal':        0x0c,   // = → PC-98 ^ (CIRCUMFLEX)
    'BracketLeft':  0x1b,   // [
    'BracketRight': 0x28,   // ]
    'Semicolon':    0x26,   // ;
    'Quote':        0x27,   // ' (US) / : (JIS) → PC-98 COLON
    'Backquote':    0x1a,   // ` (US) / 半/全 (JIS) → 暫定で PC-98 @
    'Comma':        0x30,   // ,
    'Period':       0x31,   // .
    'Slash':        0x32,   // /
    'Backslash':    0x0d,   // \ → PC-98 YEN
    'IntlYen':      0x0d,   // JIS ¥
    'IntlRo':       0x33,   // JIS 右シフト左 → PC-98 _
    // 制御
    'Escape': 0x00, 'Tab': 0x0f, 'Backspace': 0x0e, 'Enter': 0x1c, 'Space': 0x34,
    // 修飾
    'ShiftLeft': 0x70, 'ShiftRight': 0x70,
    'ControlLeft': 0x74, 'ControlRight': 0x74,
    'CapsLock': 0x71,
    // 矢印
    'ArrowUp': 0x3a, 'ArrowLeft': 0x3b, 'ArrowRight': 0x3c, 'ArrowDown': 0x3d,
    // 編集/ナビ
    'Insert': 0x38, 'Delete': 0x39,
    'PageUp': 0x36,   // PC-98 ROLLUP
    'PageDown': 0x37, // PC-98 ROLLDOWN
    'Home': 0x3e,     // PC-98 HOMECLR (CLR/HOME)
    // ファンクション
    'F1': 0x62, 'F2': 0x63, 'F3': 0x64, 'F4': 0x65, 'F5': 0x66,
    'F6': 0x67, 'F7': 0x68, 'F8': 0x69, 'F9': 0x6a, 'F10': 0x6b,
    // テンキー
    'NumpadDivide': 0x41, 'NumpadMultiply': 0x45,
    'NumpadSubtract': 0x40, 'NumpadAdd': 0x49,
    'Numpad0': 0x4e, 'Numpad1': 0x4a, 'Numpad2': 0x4b, 'Numpad3': 0x4c,
    'Numpad4': 0x46, 'Numpad5': 0x47, 'Numpad6': 0x48,
    'Numpad7': 0x42, 'Numpad8': 0x43, 'Numpad9': 0x44,
    'NumpadDecimal': 0x50, 'NumpadEnter': 0x1c,
    'NumpadEqual': 0x4d, 'NumpadComma': 0x4f,
    // TODO (PC-98 固有 / IME 系): XFER (変換) 0x35, NFER (無変換) 0x51,
    //   KANA 0x72, GRPH 0x73, HELP 0x3f, COPY 0x61, STOP 0x60,
    //   VF1-VF5 0x52-0x56
};

// preventDefault する code (ブラウザのスクロール/フォーカス移動を抑止)
const KEY_PREVENT_DEFAULT = new Set([
    'Tab', 'Space',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10',
    'PageUp', 'PageDown', 'Home',
]);

async function loadDisk(M, url, fsPath) {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    M.FS.writeFile(fsPath, new Uint8Array(buf));
    return true;
}

// emscripten の stdout/stderr ルーティング。自前ローダ/INT21h の逐次ログ ([dos_loader]/[int21h…]) は
// 既定で抑制する (Chrome が stderr を console.error=赤で表示し、無害なのに「エラー」に見えるため)。
// 再表示: URL に ?debug を付けるか、コンソールで window.QB_VERBOSE = true。本物のエラーは常に表示。
const qbVerbose = () => typeof window !== 'undefined' &&
    (window.QB_VERBOSE || /[?&]debug\b/.test(location.search));
const qbChatter = /^\[(dos_loader|int2[01])/;
NP2KaiModule({
    print:    (t) => { if (qbVerbose() || !qbChatter.test(t)) console.log(t); },
    printErr: (t) => { if (qbChatter.test(t)) { if (qbVerbose()) console.log(t); }
                       else console.error(t); },
}).then(async function (M) {
    setDriveName('fdd', 0, 'initializing…');

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);

    // FONT.BMP を有効化。以前「化けの原因」と疑ったが実際は boot.asm の DS
    // 未設定が真因だった。FONT.BMP が PC-98 規格通りなら 8x16 ネイティブグ
    // リフが出る。化けるならその時こそ BMP 中身が不正と確定する。
    await loadDisk(M, 'assets/font.bmp', '/tmp/FONT.BMP');

    // ---- AudioContext を先に作って rate を確定させる ----
    // np2kai_create より前に samplingrate を反映させる必要があるため。
    // 48000 をリクエスト、得られた実 rate を使う。サポート外の値だと sound_create が
    // 失敗するので、未対応値の場合は 44100 にフォールバック。
    const SUPPORTED_RATES = new Set([11025, 22050, 44100, 48000, 88200, 96000, 176400, 192000]);
    let audioCtx = null;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    } catch (_) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (_2) { audioCtx = null; }
    }
    let audioRate = audioCtx ? audioCtx.sampleRate : 0;
    if (!SUPPORTED_RATES.has(audioRate)) {
        // 近い値に丸めて再生成
        const candidates = [48000, 44100, 96000, 88200, 22050, 11025];
        const fallback = candidates.find(r => Math.abs(r - audioRate) / audioRate < 0.05) || 44100;
        try {
            if (audioCtx) audioCtx.close();
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: fallback });
            audioRate = audioCtx.sampleRate;
        } catch (_) { audioRate = 44100; }
    }
    if (audioRate && SUPPORTED_RATES.has(audioRate)) {
        M.ccall('np2kai_set_audio_rate', 'number', ['number'], [audioRate]);
    }

    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) {
        setDriveName('fdd', 0, 'np2kai_create failed');
        return;
    }

    // ブート用ディスクイメージを挿入
    // 最小自己起動ディスク (tools/boot_hello/boot.asm から生成)。
    // text VRAM に "HELLO NP2KAI" を直接書いて HLT ループするだけで BIOS
    // コール一切なし → FreeDOS で踏んだ BIOS ROM 問題を完全に回避できる。
    const diskUrl = 'assets/np2kai_boot.d88';
    const diskPath = '/tmp/boot.d88';
    if (await loadDisk(M, diskUrl, diskPath)) {
        const r = M.ccall('np2kai_insert_fdd', 'number',
            ['number', 'string', 'number', 'number'],
            [handle, diskPath, 0, 0]);
        setDriveName('fdd', 0, r === 0 ? 'np2kai_boot.d88' : `(insert failed r=${r})`);
    } else {
        setDriveName('fdd', 0, '(no disk)');
    }

    // ---- オーディオ再生 (AudioWorklet) ----
    // ScriptProcessorNode から移行。Worklet は別スレッドで動くため、メインスレッ
    // ドのジャンクで audio コールバックが詰まらず micro-underrun を減らせる。
    // Wasm ↔ Worklet 間は postMessage で Int16Array を転送 (SharedArrayBuffer 不要)。
    let pumpAudio = null;
    if (audioCtx && handle) {
        const drainFn = M.cwrap('np2kai_audio_drain', 'number',
            ['number', 'number', 'number']);
        const CHUNK = 1024;  // 1 回の drain で取り出すフレーム数 (~21ms @48k)
        const heapPtr = M._malloc(CHUNK * 2 * 2);  // ステレオ int16

        try {
            await audioCtx.audioWorklet.addModule('player/audio-worklet.js');
            const node = new AudioWorkletNode(audioCtx, 'qb-player', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });
            node.connect(audioCtx.destination);

            // メインスレッドから Wasm リングを drain → Worklet へ送る。
            // rAF ループから毎フレーム呼ぶ。1 rAF (16ms) で約 800 frame 生産される
            // ので、通常は 1 回の drain で吸い切れる。詰まった時のために CHUNK 単位で
            // ループする。
            pumpAudio = () => {
                while (true) {
                    const n = drainFn(handle, heapPtr, CHUNK);
                    if (n <= 0) break;
                    const view = new Int16Array(M.HEAPU8.buffer, heapPtr, n * 2);
                    const out = new Int16Array(n * 2);
                    out.set(view);
                    node.port.postMessage(out, [out.buffer]);
                    if (n < CHUNK) break;
                }
            };
        } catch (e) {
            console.error('AudioWorklet setup failed:', e);
        }

        // ブラウザのオートプレイ規制により、最初のユーザー操作まで AudioContext は
        // 'suspended' 状態。canvas クリックでまとめて resume する。
        const resumeAudio = () => {
            if (audioCtx.state === 'suspended') audioCtx.resume();
        };
        canvas.addEventListener('click',     resumeAudio);
        canvas.addEventListener('keydown',   resumeAudio);
        window.addEventListener('pointerdown', resumeAudio, { once: false });
    }

    // ---- マウス入力 (Pointer Lock) ----
    const mouseMove   = M.cwrap('np2kai_mouse_move',   null, ['number','number','number']);
    const mouseButton = M.cwrap('np2kai_mouse_button', null, ['number','number','number']);

    // canvas クリックで Pointer Lock 取得。ESC で抜けるのは Web 標準。
    canvas.addEventListener('click', () => {
        if (document.pointerLockElement !== canvas) {
            canvas.requestPointerLock().catch(() => { /* user denied or unsupported */ });
        }
    });

    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas) {
            canvas.classList.add('captured');
        } else {
            canvas.classList.remove('captured');
            // キャプチャ解除時はボタン状態をリセット (スタックボタン防止)
            mouseButton(handle, 0, 0);
            mouseButton(handle, 1, 0);
        }
    });

    // 移動: Pointer Lock 中のみ送る。
    // canvas は dpr × 整数倍に拡大されているので、movementX/Y は CSS px (=dpr で物理px に
    // 拡縮された値) になる。PC-98 側はソース px ベースで動かしたいので、CSS px ↔ source px
    // のスケールで割る。
    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== canvas) return;
        // canvas.style.width は (w * N / dpr) px、source は w なので、
        // 1 source px = canvas.style.width / w CSS px
        const cssW = parseFloat(canvas.style.width)  || canvas.width;
        const cssH = parseFloat(canvas.style.height) || canvas.height;
        const srcW = offscreen.width  || 640;
        const srcH = offscreen.height || 400;
        const dx = Math.round(e.movementX * srcW / cssW);
        const dy = Math.round(e.movementY * srcH / cssH);
        if (dx !== 0 || dy !== 0) mouseMove(handle, dx, dy);
    });

    document.addEventListener('mousedown', (e) => {
        if (document.pointerLockElement !== canvas) return;
        if (e.button === 0) mouseButton(handle, 0, 1);
        else if (e.button === 2) mouseButton(handle, 1, 1);
    });
    document.addEventListener('mouseup', (e) => {
        if (document.pointerLockElement !== canvas) return;
        if (e.button === 0) mouseButton(handle, 0, 0);
        else if (e.button === 2) mouseButton(handle, 1, 0);
    });
    // Pointer Lock 中の右クリックメニュー抑止
    canvas.addEventListener('contextmenu', (e) => {
        if (document.pointerLockElement === canvas) e.preventDefault();
    });

    // ---- ディスク差し替え (D&D / ファイル選択) ----
    const insertFdd = M.cwrap('np2kai_insert_fdd', 'number',
        ['number', 'string', 'number', 'number']);
    const insertHdd = M.cwrap('np2kai_insert_hdd', 'number',
        ['number', 'string', 'number']);
    const reset     = M.cwrap('np2kai_reset',      null,     ['number']);

    // ロード中のディスクパス (FS 上)。同名で複数回ロードしても良いように
    // 名前を都度生成する。FS は永続化しないのでクリーンアップは不要。
    let loadSeq = 0;

    /**
     * kind: 'fdd' | 'hdd'
     * drive: FDD は 0=A, 1=B / HDD は 0=C, 1=D
     * FDD A: 挿入はリセットあり (新規ブート想定)
     * FDD B: 挿入はリセットなし (ゲーム中の差し替え想定)
     * HDD: 挿入後リセットして HDD からブート (PC-98 BIOS は POST 時に HDD を読む)
     */
    async function loadDiskFromBlob(file, kind, drive) {
        const buf = await file.arrayBuffer();
        const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
        const fsPath = `/tmp/disk_${loadSeq++}_${safe}`;
        M.FS.writeFile(fsPath, new Uint8Array(buf));
        let r;
        if (kind === 'hdd') {
            r = insertHdd(handle, fsPath, drive);
        } else {
            r = insertFdd(handle, fsPath, drive, 0);
        }
        if (r !== 0) {
            setDriveName(kind, drive, `(insert failed r=${r}: ${file.name})`);
            return;
        }
        setDriveName(kind, drive, `${file.name} (${(buf.byteLength/1024)|0} KB)`);
        // HDD は挿入後に再ブートしないと BIOS が拾わない。FDD は A: のみリセット。
        if (kind === 'hdd' || drive === 0) reset(handle);
    }

    // ---- Run スロット (Phase 3: アーカイブから直接実行) ----
    // games DB を best-effort で読み込む (失敗時は空 DB として続行)。
    let gamesDb = { games: {} };
    try {
        const res = await fetch('db/games.json');
        if (res.ok) gamesDb = await res.json();
    } catch (_) { /* DB なしで継続 */ }

    const runConfig   = document.getElementById('run-config');
    const runTitleEl  = document.getElementById('run-title');
    const runEntryEl  = document.getElementById('run-entry');
    const runCmdline  = document.getElementById('run-cmdline');
    const runButton   = document.getElementById('run-button');
    const stopButton  = document.getElementById('stop-button');
    const runStatusEl = document.getElementById('run-status');

    let runQueued = null;  // { file, entry, kind, title }

    function handleRunDrop(file) {
        const entry = gamesDb.games[file.name];
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        // 未登録ファイルは拡張子で kind を推定:
        //   .lzh / .zip = 書庫として /run/ へ全展開 → 中の EXE/COM を実行 (ブートしない)
        //   .com / .exe = ローダで直接実行
        const kind = entry?.kind || (ext === 'lzh' ? 'lzh'
                                  :  ext === 'zip' ? 'zip'
                                  :  ext === 'com' ? 'com'
                                  :  ext === 'exe' ? 'exe'
                                  : 'unknown');
        runConfig.hidden = false;
        runTitleEl.textContent = entry?.title || file.name;
        runEntryEl.textContent = entry?.entry || '(auto)';
        runCmdline.value       = entry?.cmdline ?? '';
        runStatusEl.textContent = '';
        runQueued = { file, entry: entry?.entry, kind, title: entry?.title };
        setDriveName('run', 0, `${file.name} (${(file.size/1024)|0} KB)`);
    }

    // ---- アーカイブを Emscripten FS に展開 ----
    // /run/ 配下に全ファイルを書き出す (実行ごとに上書き想定)。
    function ensureRunDir() {
        try { M.FS.mkdir('/run'); } catch (_) { /* 既存 */ }
    }
    // /run 配下を再帰削除 (サブディレクトリ対応のため unlink だけでは不足)。
    function rmrf(path) {
        let st;
        try { st = M.FS.stat(path); } catch (_) { return; }
        if (M.FS.isDir(st.mode)) {
            for (const e of M.FS.readdir(path)) {
                if (e === '.' || e === '..') continue;
                rmrf(path + '/' + e);
            }
            try { M.FS.rmdir(path); } catch (_) {}
        } else {
            try { M.FS.unlink(path); } catch (_) {}
        }
    }
    function clearRunDir() {
        ensureRunDir();
        for (const e of M.FS.readdir('/run')) {
            if (e === '.' || e === '..') continue;
            rmrf('/run/' + e);
        }
    }

    async function extractArchiveToFs(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // .zip は deflate 展開、それ以外 (.lzh) は LZH デコーダ。どちらもブートせず /run/ へ展開する。
        const entries = /\.zip$/i.test(file.name)
            ? await qbArchive.parseZip(bytes)
            : qbArchive.parseLzh(bytes);
        clearRunDir();
        // 原ケースのまま /run 配下へ展開し、LZH 内のサブディレクトリも再現する。
        // DOS は大小を区別しないので、case の吸収は C 側 dos_path_to_host の
        // case-insensitive リゾルバに任せる (旧実装の「両側で強制小文字化」は廃止)。
        const extracted = [], skipped = [];
        for (const ent of entries) {
            if (ent.data == null) {            // 未対応メソッド (例: -lh1-) → skip して継続
                skipped.push(`${ent.name} (${ent.method})`);
                continue;
            }
            const rel = ent.name.replace(/\\/g, '/').replace(/^\/+/, '');
            const parts = rel.split('/');
            let dir = '/run';
            for (let k = 0; k < parts.length - 1; k++) {
                dir += '/' + parts[k];
                try { M.FS.mkdir(dir); } catch (_) { /* 既存 */ }
            }
            M.FS.writeFile('/run/' + rel, ent.data);
            ent.name = rel;
            extracted.push(ent);
        }
        if (skipped.length) {
            console.warn(`未対応メソッドで ${skipped.length} エントリを skip: ${skipped.join(', ')}`);
        }
        return extracted;
    }

    // ---- Phase 3 ローダ: COM / EXE image を staging → loader.d88 で起動 ----
    const dosStageCom  = M.cwrap('np2kai_dos_stage_com', 'number',
                                  ['number', 'number', 'string', 'string']);
    const dosStageExe  = M.cwrap('np2kai_dos_stage_exe', 'number',
                                  ['number', 'number', 'string', 'string']);
    // np2kai_dos_get_exit(int* code) — JS では HEAP に書き込み番地を渡す
    const dosGetExitFn = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);

    let loaderDiskCached = null;  // 一度 fetch すれば再利用 (毎回 reset で再ロード)
    async function loadLoaderDisk() {
        if (!loaderDiskCached) {
            const res = await fetch('assets/loader.d88');
            if (!res.ok) throw new Error(`loader.d88 fetch failed (${res.status})`);
            loaderDiskCached = new Uint8Array(await res.arrayBuffer());
        }
        // /tmp に書いて A: に挿入。loadDiskFromBlob は File を要求するので Blob で包む。
        const f = new File([loaderDiskCached], 'loader.d88');
        await loadDiskFromBlob(f, 'fdd', 0);  // A: 挿入 + reset
    }

    // 現在 polling 中のハンドル (Stop ボタンで強制中断する用)。
    let currentPoll = null;
    function pollDosExit(onExit) {
        // exit code 用に 4B (i32) を HEAP に確保して polling。100ms 間隔。
        const codePtr = M._malloc(4);
        const tick = setInterval(() => {
            const done = dosGetExitFn(codePtr);
            if (done) {
                stopPolling(M.getValue(codePtr, 'i32'));
            }
        }, 100);
        function stopPolling(code) {
            if (currentPoll !== tick) return;  // 既に停止済
            M._free(codePtr);
            clearInterval(tick);
            currentPoll = null;
            onExit(code);
        }
        currentPoll = tick;
        // Stop ボタンが叩く用のフックを保存
        pollDosExit._stop = () => stopPolling(-1);
    }

    async function stageAndRunImage(bytes, cmdline, label, isExe) {
        // image を C ヒープに転送して stage する
        const ptr = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, ptr);
        const stageFn = isExe ? dosStageExe : dosStageCom;
        const r = stageFn(ptr, bytes.length, cmdline || '', label || '');
        M._free(ptr);
        if (r !== 0) throw new Error(`stage_${isExe ? 'exe' : 'com'} failed r=${r}`);
        runStatusEl.textContent = `${label}: staged ${bytes.length}B、loader.d88 を A: に挿入してリセット中…`;
        await loadLoaderDisk();
        runStatusEl.textContent = `${label}: 実行中 (exit を polling 中…)`;
        stopButton.hidden = false;
        pollDosExit((code) => {
            runStatusEl.textContent = code === -1
                ? `${label}: 中断 (Stop)`
                : `${label}: 終了 (exit code=${code})`;
            runButton.disabled = false;
            stopButton.hidden = true;
        });
    }

    stopButton.addEventListener('click', () => {
        if (pollDosExit._stop) pollDosExit._stop();
        stopButton.blur();
    });

    runButton.addEventListener('click', async () => {
        if (!runQueued) return;
        if (runButton.disabled) return;
        runButton.disabled = true;   // ポーリング終了まで連打を抑止 (重複 stage 防止)
        // ★重要: focus を外す。これをしないと Start Game の Enter キーが
        // Run ボタンの再 click を引き起こして同じ EXE が再 stage されてしまう。
        runButton.blur();
        const cmdline = runCmdline.value;
        runStatusEl.textContent = 'extracting…';
        try {
            if (runQueued.kind === 'com' || runQueued.kind === 'exe') {
                const bytes = new Uint8Array(await runQueued.file.arrayBuffer());
                await stageAndRunImage(bytes, cmdline, runQueued.file.name,
                                       runQueued.kind === 'exe');
            } else if (runQueued.kind === 'lzh' || runQueued.kind === 'zip') {
                const entries = await extractArchiveToFs(runQueued.file);
                // entry を決定: DB 指定 > 拡張子で .exe/.com を自動選択
                let entryName = runQueued.entry;
                if (!entryName) {
                    const exec = entries.find(e => /\.exe$/i.test(e.name))
                              || entries.find(e => /\.com$/i.test(e.name));
                    entryName = exec ? exec.name : null;
                }
                if (!entryName) throw new Error('書庫内に .exe/.com が見つからない');
                const entry = entries.find(e => e.name.toLowerCase() === entryName.toLowerCase());
                if (!entry) throw new Error(`entry "${entryName}" が書庫内にない`);
                const isExe = /\.exe$/i.test(entryName);
                const totalKb = (entries.reduce((a, e) => a + e.data.length, 0) / 1024) | 0;
                runStatusEl.textContent =
                    `展開完了: ${entries.length} files / ${totalKb} KB → /run/。${entryName} を起動…`;
                await stageAndRunImage(entry.data, cmdline, entryName, isExe);
            } else {
                runStatusEl.textContent = `(未対応 kind: ${runQueued.kind})`;
            }
        } catch (e) {
            runStatusEl.textContent = `ERROR: ${e.message}`;
            console.error(e);
        } finally {
            // polling を開始しなかった経路 (unknown / stage 前の throw) では
            // ここで Run ボタンを戻す。polling 中はその onExit (stageAndRunImage) が
            // 戻すので、currentPoll が立っている間は触らない。
            if (currentPoll === null) {
                runButton.disabled = false;
                stopButton.hidden = true;
            }
        }
    });

    // ファイル選択 (共有 input、target をクロージャで保持)
    const fileInput = document.getElementById('file-input');
    let pickerTarget = { kind: 'fdd', drive: 0 };
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
            const f = fileInput.files[0];
            if (pickerTarget.kind === 'run') handleRunDrop(f);
            else loadDiskFromBlob(f, pickerTarget.kind, pickerTarget.drive);
            fileInput.value = '';
        }
    });

    // 各ドライブスロットに click / D&D ハンドラを設定
    driveEls.forEach((el) => {
        const drive = +el.dataset.drive;
        const kind  = el.dataset.kind;
        el.addEventListener('click', () => {
            pickerTarget = { kind, drive };
            fileInput.click();
        });
        el.addEventListener('dragenter', (e) => {
            e.preventDefault();
            el.classList.add('dragover');
        });
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        el.addEventListener('dragleave', (e) => {
            // 子要素境界での誤発火を避けるため、relatedTarget が外なら解除
            if (!el.contains(e.relatedTarget)) el.classList.remove('dragover');
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('dragover');
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (!f) return;
            if (kind === 'run') handleRunDrop(f);
            else loadDiskFromBlob(f, kind, drive);
        });
    });

    // スロット外へのドロップは無視 (ブラウザのデフォルト動作 = ファイルを開く を抑止)
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop',     (e) => e.preventDefault());

    // ---- キーボード入力 ----
    const keyDown = M.cwrap('np2kai_key_down', null, ['number', 'number']);
    const keyUp   = M.cwrap('np2kai_key_up',   null, ['number', 'number']);

    // 押されている code を追跡 (オートリピートで重複 keydown を送らない)
    const pressed = new Set();

    window.addEventListener('keydown', (e) => {
        // Ctrl 系のブラウザショートカット (Ctrl+R / Ctrl+W / Ctrl+Shift+I 等) は通す
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const code = PC98_KEYMAP[e.code];
        if (code === undefined) return;
        if (KEY_PREVENT_DEFAULT.has(e.code)) e.preventDefault();
        if (pressed.has(e.code)) return;     // OS のオートリピートは無視
        pressed.add(e.code);
        keyDown(handle, code);
    });

    window.addEventListener('keyup', (e) => {
        const code = PC98_KEYMAP[e.code];
        if (code === undefined) return;
        if (KEY_PREVENT_DEFAULT.has(e.code)) e.preventDefault();
        if (!pressed.has(e.code)) return;
        pressed.delete(e.code);
        keyUp(handle, code);
    });

    // ---- デバッグ補助 ----
    // ブラウザコンソールから window.qbDebug.pc() で CPU PC を読める。
    // 数 ms おきに連打して同じ位置で固まっていればハング/ループ確定。
    const getCs       = M.cwrap('np2kai_debug_get_cs',        'number', ['number']);
    const getLinearPc = M.cwrap('np2kai_debug_get_linear_pc', 'number', ['number']);
    const peek8       = M.cwrap('np2kai_debug_peek8',         'number', ['number', 'number']);
    const getGdcMode1 = M.cwrap('np2kai_debug_get_gdc_mode1', 'number', ['number']);
    const getTextdisp = M.cwrap('np2kai_debug_get_textdisp', 'number', ['number']);
    const getGrphdisp = M.cwrap('np2kai_debug_get_grphdisp', 'number', ['number']);
    const getInt21    = M.cwrap('np2kai_debug_int21_count',  'number', ['number']);
    const resetInt21  = M.cwrap('np2kai_debug_int21_reset',  null, []);
    const getReg16    = M.cwrap('np2kai_debug_get_reg16',    'number', ['number', 'number']);
    window.qbDebug = {
        cs:     () => '0x' + (getCs(handle)       >>> 0).toString(16),
        linear: () => '0x' + (getLinearPc(handle) >>> 0).toString(16),
        pc:     () => `${window.qbDebug.cs()}:${window.qbDebug.linear()}`,
        // 16-bit レジスタ一覧 (ハング時の状態確認用)
        regs:   () => {
            const n = ['AX','BX','CX','DX','SI','DI','BP','SP','DS','ES','SS','CS','IP'];
            const o = {};
            n.forEach((k, i) => o[k] = '0x' + (getReg16(handle, i) >>> 0).toString(16).padStart(4,'0'));
            return o;
        },
        // 線形アドレスから n バイトを 16 進ダンプ
        dump:   (addr, n=32) => {
            const bytes = [];
            for (let i = 0; i < n; i++) {
                bytes.push(peek8(handle, addr + i).toString(16).padStart(2, '0'));
            }
            return bytes.join(' ');
        },
        // 現在の PC 周辺 (前 4 / 後 28 byte) をダンプ
        dumpHere: () => {
            const a = getLinearPc(handle);
            return `@${a.toString(16)}: ${window.qbDebug.dump(a - 4, 32)}`;
        },
        // テキスト GDC mode1 を読む。bit 3 (0x08) が立っていれば 8x16 ANK モード
        gdcMode1: () => {
            const m = getGdcMode1(handle);
            return `0x${m.toString(16).padStart(2,'0')} (bit3=8x16:${(m>>3)&1}, bit5=code:${(m>>5)&1}, bit0=attr:${m&1})`;
        },
        // gdcs.textdisp / grphdisp。bit 0x80 (GDCSCRN_ENABLE) で面表示の master ON/OFF。
        // GDC STOP コマンドで OFF、START で ON。テキスト面残留問題の切り分け用。
        textdisp: () => {
            const v = getTextdisp(handle);
            return `0x${v.toString(16).padStart(2,'0')} (ENABLE bit7=${(v>>7)&1})`;
        },
        grphdisp: () => {
            const v = getGrphdisp(handle);
            return `0x${v.toString(16).padStart(2,'0')} (ENABLE bit7=${(v>>7)&1})`;
        },
        // INT 21h の AH 別呼び出し回数。引数なしで非ゼロのみ全表示。
        // qb_dos_dbg_ah_reset() でリセットして再観測するときは int21Reset()。
        int21Stats: (specificAh) => {
            if (specificAh != null) return getInt21(specificAh);
            const stats = {};
            let total = 0;
            for (let ah = 0; ah < 256; ah++) {
                const c = getInt21(ah);
                if (c > 0) { stats['0x' + ah.toString(16).padStart(2,'0')] = c; total += c; }
            }
            stats.__total__ = total;
            return stats;
        },
        int21Reset: () => { resetInt21(); return 'int21 counters reset'; },
        sample: (n=5, intervalMs=200) => {
            const out = [];
            let i = 0;
            const id = setInterval(() => {
                out.push(window.qbDebug.pc());
                if (++i >= n) { clearInterval(id); console.log('PC samples:', out); }
            }, intervalMs);
        },
        // Emscripten FS アクセス (Run スロット展開先 /run/ の確認用)
        fs:      M.FS,
        ls:      (dir='/run') => {
            try { return M.FS.readdir(dir).filter(n => n !== '.' && n !== '..'); }
            catch (e) { return `ERR: ${e.message}`; }
        },
        read:    (path) => {
            try { return M.FS.readFile(path); }
            catch (e) { return `ERR: ${e.message}`; }
        },
        readSize: (path) => {
            try { return M.FS.readFile(path).length; }
            catch (e) { return `ERR: ${e.message}`; }
        },
        // textdisp の時系列観測。Start Game 等の画面遷移時に値が変化するかを見る。
        // 値が変わったタイミングだけログするので、出力は最小限。
        watchTextdisp: (durationSec = 30, intervalMs = 50) => {
            let last = -1;
            const t0 = performance.now();
            const id = setInterval(() => {
                const v = getTextdisp(handle);
                if (v !== last) {
                    const ms = (performance.now() - t0).toFixed(0);
                    console.log(`[+${ms}ms] textdisp 0x${last < 0 ? '?' : last.toString(16)} → 0x${v.toString(16)} (ENABLE=${(v>>7)&1})`);
                    last = v;
                }
                if (performance.now() - t0 > durationSec * 1000) {
                    clearInterval(id);
                    console.log(`[watchTextdisp] stopped after ${durationSec}s`);
                }
            }, intervalMs);
            return `watching textdisp for ${durationSec}s`;
        },
        // テキスト VRAM 行 0-(n-1) を ASCII で一覧表示。ハイスコア表テキストが
        // どの行に書かれているか、そもそもテキスト面にあるかの確認に使う。
        // 非 ASCII (漢字 2byte 含む) は '.' で表示。
        textVram: (nrows = 20) => {
            const lines = [];
            for (let r = 0; r < nrows; r++) {
                let s = '';
                for (let c = 0; c < 80; c++) {
                    const ch = peek8(handle, 0xA0000 + (r * 80 + c) * 2);
                    s += (ch >= 0x20 && ch < 0x7f) ? String.fromCharCode(ch) : '.';
                }
                lines.push(r.toString().padStart(2) + ': ' + s);
            }
            return '\n' + lines.join('\n');
        }
    };

    // ウィンドウフォーカス喪失時に全キーを解放 (スタックキー防止)
    window.addEventListener('blur', () => {
        for (const c of pressed) {
            const code = PC98_KEYMAP[c];
            if (code !== undefined) keyUp(handle, code);
        }
        pressed.clear();
    });

    // Output parameter slots for np2kai_get_framebuffer
    const pW   = M._malloc(4);
    const pH   = M._malloc(4);
    const pBpp = M._malloc(4);

    // RGB565 → RGBA8888 LUT (65536 × 4 byte = 256KB)。
    // 旧実装は per-pixel で 4 つのビット演算 + 4 つの代入 = 640×400 で
    // 5-15ms / frame を主スレッドで消費していた。LUT 1 回引きに置き換えて
    // ~1-2ms に短縮し、その分を pumpAudio や run_frame の余裕に回す。
    // little-endian 前提で Uint32 を直接書く (RGBA バイト並び = AABBGGRR)。
    const RGB565_LUT = new Uint32Array(65536);
    for (let p = 0; p < 65536; p++) {
        const r = ((p >> 11) & 0x1f) << 3;
        const g = ((p >>  5) & 0x3f) << 2;
        const b = ( p        & 0x1f) << 3;
        RGB565_LUT[p] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }

    // ---- エミュレーション駆動ループ (wall-clock catch-up) ----
    // 旧実装: rAF 1 回 = pccore_exec 1 回。これだと
    //   - 120Hz ディスプレイ → 倍速
    //   - 低速機で 1 rAF 内に間に合わない → rAF 自体が遅延して全体スロー
    // となり、音 (sample 生成レート) も連動して崩れる。
    //
    // 新実装: 目標 60Hz の wall-clock 仮想時計を立てて、rAF 内で「今までに本来
    // 来るべきだった emu step」を最大 MAX_CATCHUP までキャッチアップ実行する。
    // 描画は rAF rate のまま (重い時は描画フレームスキップになるが、エミュ進行
    // と音は維持される)。
    // PC-98 24kHz mode の vsync は 56.42Hz、これが「本来の」テンポ。
    // 60 だと体感やや速め (一部ゲームで音楽が走る) という報告に合わせて 56 を採用。
    const TARGET_HZ    = 56;
    const MS_PER_STEP  = 1000 / TARGET_HZ;
    const MAX_CATCHUP  = 3;   // 1 rAF で実行する最大 step 数
    const runFrame     = M.cwrap('np2kai_run_frame', null, ['number']);
    const getFb        = M.cwrap('np2kai_get_framebuffer', 'number',
                                 ['number', 'number', 'number', 'number']);
    let nextDue = performance.now();

    function frame(now) {
        // 経過時間分の emulator step を消化
        let steps = 0;
        while (now >= nextDue && steps < MAX_CATCHUP) {
            runFrame(handle);
            // 音は step ごとに即ポンプ (リングを最新に保つ)
            if (pumpAudio) pumpAudio();
            nextDue += MS_PER_STEP;
            steps++;
        }
        // 大幅遅延 (タブ復帰など) で何百ステップも溜まる事故を防ぐため、
        // 上限に達したら時計をリセットして「諦めて現在時刻基準でやり直す」。
        if (steps === MAX_CATCHUP && now > nextDue) {
            nextDue = now + MS_PER_STEP;
        }

        const fbPtr = getFb(handle, pW, pH, pBpp);

        if (fbPtr) {
            const w   = M.getValue(pW,   'i32');
            const h   = M.getValue(pH,   'i32');
            const bpp = M.getValue(pBpp, 'i32');

            if (w > 0 && h > 0) {
                // オフスクリーンのサイズが変わったらメインキャンバスも更新
                if (offscreen.width !== w || offscreen.height !== h) {
                    offscreen.width  = w;
                    offscreen.height = h;
                    fitCanvas(w, h);
                }

                // RGB16 (5-6-5) → RGBA32 をオフスクリーンに描画
                const imgData = offCtx.createImageData(w, h);
                const dst = imgData.data;

                if (bpp === 2) {
                    const src  = new Uint16Array(M.HEAPU8.buffer, fbPtr, w * h);
                    const dst32 = new Uint32Array(dst.buffer);
                    for (let i = 0; i < w * h; i++) {
                        dst32[i] = RGB565_LUT[src[i]];
                    }
                } else if (bpp === 4) {
                    const src = new Uint8Array(M.HEAPU8.buffer, fbPtr, w * h * 4);
                    dst.set(src);
                }

                offCtx.putImageData(imgData, 0, 0);
                // 物理ピクセルサイズのメインキャンバスへニアレストネイバーで拡大
                ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
            }
        }

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

}).catch(function (e) {
    setDriveName('fdd', 0, 'Error: ' + e);
    console.error(e);
});
