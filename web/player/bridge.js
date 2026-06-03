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
    const wrap = document.getElementById('canvas-wrap');
    const maxW = (wrap ? wrap.clientWidth  : window.innerWidth)      - 2;
    const maxH = (wrap ? wrap.clientHeight : window.innerHeight - 32) - 2;
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

// emscripten の stdout/stderr ルーティング。自前 C 側の逐次ログは全て [tag] 形式
// ([dos_loader] / [int21h…] / [tty] / [mcb] 等) なので「先頭が [小文字 の行」をまとめて既定抑制する
// (Chrome が stderr を console.error=赤で表示し、無害なのに「エラー」に見えるため)。本物の emscripten
// エラーは Aborted/RuntimeError 等で先頭が [小文字 にならないので残る。
// 再表示: URL に ?debug を付けるか、コンソールで window.QB_VERBOSE = true。
const qbVerbose = () => typeof window !== 'undefined' &&
    (window.QB_VERBOSE || /[?&]debug\b/.test(location.search));
const qbChatter = /^\[[a-z]/;
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
            if (audioCtx.state !== 'suspended') return;
            // resume 成功後にだけリスナを外す (失敗時は次のジェスチャで再試行)。
            audioCtx.resume().then(() => {
                canvas.removeEventListener('click',       resumeAudio);
                canvas.removeEventListener('keydown',     resumeAudio);
                window.removeEventListener('pointerdown', resumeAudio);
            }).catch(() => {});
        };
        canvas.addEventListener('click',     resumeAudio);
        canvas.addEventListener('keydown',   resumeAudio);
        window.addEventListener('pointerdown', resumeAudio);
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

    // ロード中のディスクパス (FS 上)。同名で複数回ロードしても良いように名前を都度生成する。
    // FS はセッション内では永続するので、同 slot へ挿し直す際は旧イメージを unlink する
    // (下記 slotPaths)。さもないと Run 連打で loader.d88 (~1.2MB) が MEMFS に積み上がる。
    let loadSeq = 0;
    const slotPaths = {};   // `${kind}${drive}` → 現在その slot に挿入中の FS パス

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
            try { M.FS.unlink(fsPath); } catch (_) {}   // 挿入失敗分は即掃除
            setDriveName(kind, drive, `(insert failed r=${r}: ${file.name})`);
            return;
        }
        // 挿入成功: 同 slot の旧イメージを掃除 (NP2kai は fdd_set/sxsi で新パスを参照済みなので安全)。
        const slot = `${kind}${drive}`;
        const prev = slotPaths[slot];
        slotPaths[slot] = fsPath;
        if (prev && prev !== fsPath) { try { M.FS.unlink(prev); } catch (_) {} }
        setDriveName(kind, drive, `${file.name} (${(buf.byteLength/1024)|0} KB)`);
        // HDD は挿入後に再ブートしないと BIOS が拾わない。FDD は A: のみリセット。
        if (kind === 'hdd' || drive === 0) reset(handle);
    }

    // ---- filer (書庫を /run/ に展開し、一覧/テキスト表示/エントリ選択) ----
    const runEntryEl  = document.getElementById('run-entry');
    const runCmdline  = document.getElementById('run-cmdline');
    const runButton   = document.getElementById('run-button');
    const stopButton  = document.getElementById('stop-button');
    const runStatusEl = document.getElementById('run-status');
    const arcNameEl   = document.getElementById('arc-name');
    const fileListEl  = document.getElementById('file-list');
    const textBodyEl  = document.getElementById('text-body');
    const textHeadEl  = document.getElementById('text-head');

    let loadedEntries  = [];   // { name(=/run 相対), data, mtime }  path は last-wins
    let selectedEntry  = null; // 実行対象に選んだ行 (EXE/COM もしくは 起動 .bat)
    let selectedRecipe = null; // selectedEntry が .bat の時の解決結果 { targetEntry, args, recipe }
    let loadedArchives = [];   // 表示用の投入書庫名
    let currentDir     = '';   // ファイラの現在フォルダ (/run 相対, '' = ルート, 末尾 '/' 付き)
    const crumbsEl     = document.getElementById('crumbs');

    const sjis = new TextDecoder('shift_jis');
    // 表示用に名前 (latin1 バイト列, 1 char = 1 byte) を SJIS デコードする。FS キー/ナビ用の
    // 原バイト名はそのまま保ち、画面に出す文字列だけ日本語へ復号する (漢字ファイル名対策)。
    // file.name (ブラウザ File) は既に Unicode なので、これを通すのは latin1 由来の名前だけ。
    const sjisName = (n) => {
        const b = new Uint8Array(n.length);
        for (let i = 0; i < n.length; i++) b[i] = n.charCodeAt(i) & 0xff;
        return sjis.decode(b);
    };
    const isExecName = (n) => /\.(exe|com)$/i.test(n);
    const isBatName  = (n) => /\.bat$/i.test(n);   // 起動レシピ (qbBatScript で解釈)
    const isTextName = (n) =>
        /\.(txt|doc|me|1st|asc|ini|cfg|nfo|faq|hlp|dic|wri)$/i.test(n) ||
        /readme|read\.me|どきゅめんと|説明|よみ/i.test(n);
    const isReadme   = (n) => /readme|read\.me|よみ|説明|どきゅめんと/i.test(n);
    const baseName   = (n) => n.slice(n.lastIndexOf('/') + 1);   // /run 相対 → ファイル名
    const fmtSize = (n) => n >= 1024 ? `${(n / 1024) | 0}K` : `${n}`;
    const fmtTime = (d) => {
        if (!d) return '';
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const escapeHtml = (s) =>
        s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // path 重複は last-wins でマージ (パッチ書庫を後から重ねる用途)
    function mergeEntries(entries) {
        for (const ent of entries) {
            const key = ent.name.toLowerCase();
            const i = loadedEntries.findIndex((e) => e.name.toLowerCase() === key);
            if (i >= 0) loadedEntries[i] = ent; else loadedEntries.push(ent);
        }
    }

    // パンくず (現代的なフォルダ移動。クリックで任意の親へジャンプ)
    function renderCrumbs() {
        const segs = currentDir.split('/').filter(Boolean);
        // サブフォルダが一切無く、ルートに居るなら隠す (平置き書庫では従来どおりの見た目)
        const anyDir = loadedEntries.some((e) => e.name.includes('/'));
        if (!segs.length && !anyDir) { crumbsEl.hidden = true; crumbsEl.textContent = ''; return; }
        crumbsEl.hidden = false;
        crumbsEl.textContent = '';
        const addSeg = (label, dir, here) => {
            const s = document.createElement('span');
            s.className = 'seg' + (here ? ' here' : '');
            s.textContent = label;
            if (!here) s.addEventListener('click', () => { currentDir = dir; renderFileList(); });
            crumbsEl.appendChild(s);
        };
        addSeg('🏠', '', segs.length === 0);
        let acc = '';
        segs.forEach((seg, i) => {
            const sep = document.createElement('span');
            sep.className = 'sep'; sep.textContent = '›';
            crumbsEl.appendChild(sep);
            acc += seg + '/';
            addSeg(sjisName(seg), acc, i === segs.length - 1);
        });
    }

    function renderFileList() {
        arcNameEl.textContent = loadedArchives.length
            ? `書庫: ${loadedArchives.join(' + ')}` : '書庫をドロップ';
        renderCrumbs();

        // currentDir 直下の「フォルダ」と「ファイル」に振り分ける
        const folders = new Map();   // 直下サブフォルダ名 → ファイル数
        const files = [];            // 直下ファイル entry
        for (const ent of loadedEntries) {
            if (currentDir && !ent.name.startsWith(currentDir)) continue;
            const rest = ent.name.slice(currentDir.length);
            const slash = rest.indexOf('/');
            if (slash >= 0) {
                const fname = rest.slice(0, slash);
                folders.set(fname, (folders.get(fname) || 0) + 1);
            } else if (rest) {
                files.push(ent);
            }
        }
        fileListEl.textContent = '';

        // フォルダ行 (アルファベット順、降下する)
        const folderNames = Array.from(folders.keys())
            .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        for (const fn of folderNames) {
            const row = document.createElement('div');
            row.className = 'frow dir';
            row.innerHTML =
                `<span class="fn">📁 ${escapeHtml(sjisName(fn))}/</span>` +
                `<span class="fsz">${folders.get(fn)} 件</span>` +
                `<span class="fdt"></span>`;
            row.addEventListener('click', () => { currentDir += fn + '/'; renderFileList(); });
            fileListEl.appendChild(row);
        }

        // ファイル行 (readme→起動.bat→text→exec→other、各内アルファベット順)
        const rank = (n) => isReadme(n) ? 0 : isBatName(n) ? 1 : isTextName(n) ? 2 : isExecName(n) ? 3 : 4;
        files.sort((a, b) => rank(a.name) - rank(b.name) ||
            baseName(a.name).toLowerCase().localeCompare(baseName(b.name).toLowerCase()));
        for (const ent of files) {
            const nm = baseName(ent.name);
            const isBat = isBatName(nm);
            const runnable = isBat || isExecName(nm);
            const row = document.createElement('div');
            row.className = 'frow' + (isBat ? ' bat' : isExecName(nm) ? ' exec' : isTextName(nm) ? ' text' : '') +
                            (ent === selectedEntry ? ' sel' : '');
            const tag = isBat ? '▷ ' : isExecName(nm) ? '▶ ' : isTextName(nm) ? '・' : '  ';
            row.innerHTML =
                `<span class="fn">${tag}${escapeHtml(sjisName(nm))}</span>` +
                `<span class="fsz">${fmtSize(ent.data.length)}</span>` +
                `<span class="fdt">${fmtTime(ent.mtime)}</span>`;
            row.addEventListener('click', () =>
                runnable ? selectEntry(ent) : openText(ent));
            fileListEl.appendChild(row);
        }
    }

    // テキスト (readme / .bat 等) を表示。annotation を渡すと本文の先頭に注記行を足す
    // (起動 .bat の「解釈した起動順」を見せる用)。
    function openText(ent, annotation) {
        textHeadEl.textContent = sjisName(ent.name);
        // DOS EOF (Ctrl-Z=0x1A) 以降は本文ではない。生バイトで切る
        // (0x1A は SJIS の trail バイト範囲外なので常に単独制御＝安全。
        //  デコード後の符号位置は環境依存なのでバイトで判定する)。
        let bytes = ent.data;
        const eof = bytes.indexOf(0x1a);
        if (eof >= 0) bytes = bytes.subarray(0, eof);
        const body = sjis.decode(bytes).replace(/\r\n?/g, "\n");
        textBodyEl.textContent = annotation ? `${annotation}\n\n${body}` : body;
        textBodyEl.scrollTop = 0;
    }

    // 起動 .bat を解釈し、実際に走らせる主プログラム entry + 引数テンプレを解決する。
    // 主プログラムが展開済みファイル群に見つからなければ null (UI 側でフォールバック)。
    function resolveBat(ent) {
        const recipe = qbBatScript.parse(ent.data);
        const m = qbBatScript.resolveMain(recipe, loadedEntries.map((e) => e.name));
        if (!m) return null;
        const target = loadedEntries.find((e) => e.name === m.name);
        if (!target) return null;
        return { targetEntry: target, args: m.args, recipe };
    }

    // 起動 .bat の「解釈した起動順」を 1 行サマリにする (Run でこう動く、の透明化)。
    // リテラルフラグ (-r/-v 等) は出すが %N はユーザー入力前なので省く (本文の生 .bat で確認可)。
    function batRecipeSummary(rec) {
        if (!rec) return '▷ 起動レシピ — 起動する実行ファイルが束に見つかりません';
        const names = loadedEntries.map((e) => e.name);
        const seq = qbBatScript.resolveSequence(rec.recipe, names, '');
        const fmt = (c) => sjisName(baseName(c.name)) + (c.args ? ` ${c.args}` : '');
        if (seq && seq.length > 1) {
            return `▷ 起動順 (1 セッション逐次 EXEC): ${seq.map(fmt).join('  →  ')}`;
        }
        const a = rec.args.join(' ');
        return `▷ 起動: ${sjisName(baseName(rec.targetEntry.name))}${a ? ` ${a}` : ''}`;
    }

    function selectEntry(ent) {
        if (isBatName(ent.name)) {
            // .bat は「作者の起動レシピ」。主プログラム + 引数を解決して run 対象にする。
            const rec = resolveBat(ent);
            if (!rec) {
                // 起動できなくても中身は読ませる (③敬意: 作者のレシピ)。
                runStatusEl.textContent = `${sjisName(ent.name)}: 起動する実行ファイルが見つかりません`;
                openText(ent, batRecipeSummary(null));
                return;
            }
            selectedEntry = ent;
            selectedRecipe = rec;
            // プレビューはレシピ引数を素のまま見せる (%1 等のプレースホルダも) ―― ユーザーに
            // 「cmdline 欄に引数が要る」ことを伝える。実起動時は buildCmdline で %N を差し込む。
            const preview = rec.args.join(' ');
            runEntryEl.textContent =
                `${sjisName(ent.name)} → ${sjisName(baseName(rec.targetEntry.name))}` + (preview ? ` ${preview}` : '');
            // 起動 .bat の中身 (作者のレシピ) を解釈した起動順つきでテキスト面に表示。
            openText(ent, batRecipeSummary(rec));
        } else {
            selectedEntry = ent;
            selectedRecipe = null;
            runEntryEl.textContent = sjisName(ent.name);
        }
        runButton.disabled = false;
        renderFileList();   // ハイライト更新
    }

    // ドロップ/選択された 1 ファイルを開く。append=true で /run/ に重ねて展開。
    async function openDropped(file, append) {
        document.body.classList.remove('panel-hidden');   // 投入時はパネルを表示
        currentDir = '';                                  // 投入時はルート表示に戻す
        runStatusEl.textContent = `読み込み中: ${file.name}…`;
        try {
            if (!append) { clearRunDir(); loadedEntries = []; loadedArchives = []; selectedEntry = null; selectedRecipe = null; }
            if (/\.(lzh|zip)$/i.test(file.name)) {
                mergeEntries(await extractArchiveToFs(file, true));   // /run/ クリアは上で実施済
            } else if (qbDiskImage.isDiskImageName(file.name)) {
                // ディスクイメージは「ブートせず中身を /run/ へ取り出す」(FAT12/16 リーダ)。
                const res = qbDiskImage.extractDiskImage(
                    new Uint8Array(await file.arrayBuffer()), file.name);
                if (!res.ok) {
                    runStatusEl.textContent = `取り出せません: ${file.name} — ${res.reason}`;
                    return;
                }
                mergeEntries(writeEntriesToRun(res.files));
            } else if (isExecName(file.name)) {
                ensureRunDir();
                const data = new Uint8Array(await file.arrayBuffer());
                M.FS.writeFile('/run/' + file.name, data);
                mergeEntries([{ name: file.name, data, mtime: file.lastModified ? new Date(file.lastModified) : null }]);
            } else {
                runStatusEl.textContent =
                    `未対応のファイル: ${file.name} (.lzh / .zip / ディスクイメージ / .com / .exe)`;
                return;
            }
            loadedArchives.push(file.name);
            // 既定エントリ自動選択。起動 .bat があれば最優先 (作者の意図した起動レシピ)。
            // 複数 .bat = 起動方法 (音源モード/シナリオ/難易度等) の選択肢なのでユーザーに選ばせる。
            // .bat 無しは従来どおり .exe > .com。
            let multiBat = false;
            if (!selectedEntry) {
                const bats = loadedEntries.filter((e) => isBatName(e.name) && resolveBat(e));
                if (bats.length === 1) {
                    selectEntry(bats[0]);
                } else if (bats.length > 1) {
                    multiBat = true;
                } else {
                    const def = loadedEntries.find((e) => /\.exe$/i.test(e.name))
                             || loadedEntries.find((e) => /\.com$/i.test(e.name));
                    if (def) selectEntry(def);
                }
            }
            renderFileList();
            // readme 系を自動で開く (③敬意: 作者の声をまず見せる)
            const readme = loadedEntries.find((e) => isReadme(e.name) && isTextName(e.name))
                        || loadedEntries.find((e) => /\.doc$/i.test(e.name))
                        || loadedEntries.find((e) => isTextName(e.name));
            if (readme) openText(readme);
            // 複数 .bat (音源モード選択肢) の時だけ誘導を出す。それ以外は一覧自体が示すので無表示。
            runStatusEl.textContent = multiBat
                ? '起動 .bat が複数あります — 一覧から起動方法を選んでください'
                : '';
        } catch (e) {
            runStatusEl.textContent = `ERROR: ${e.message}`;
            console.error(e);
        }
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

    // DOS パス区切り '\' を '/' に変換。ただし SJIS 2 バイト文字の trail バイト 0x5C
    // (ダメ文字: ソ=0x83 0x5C / 表=0x95 0x5C 等) は区切りでなく文字データなので素通しする。
    // name は latin1 バイト列 (1 char = 1 byte) 前提。書庫経路の名前にだけ適用する
    // (FAT 名は '/' 区切りで生成済 + 0x5C は必ず漢字 trail なので変換しない)。
    function dosPathToSlash(name) {
        let out = '';
        for (let i = 0; i < name.length; i++) {
            const c = name.charCodeAt(i);
            if ((c >= 0x81 && c <= 0x9f) || (c >= 0xe0 && c <= 0xfc)) {  // SJIS lead byte
                out += name[i];
                if (i + 1 < name.length) { out += name[i + 1]; i++; }    // trail を素通し
                continue;
            }
            out += (c === 0x5c) ? '/' : name[i];
        }
        return out;
    }

    // entries [{name, data, mtime}] を /run/ 配下へ書き出す (LZH/書庫/ディスクイメージ共通)。
    // 区切りは '/' 前提 (呼び出し側で正規化済)。サブディレクトリも再現。data==null は skip。
    // 書き出したエントリ (name=正規化相対パス) を返す。DOS は大小を区別しないので、case の
    // 吸収は C 側 dos_path_to_host の case-insensitive リゾルバに任せる (原ケースのまま保持)。
    function writeEntriesToRun(entries) {
        ensureRunDir();
        const written = [], skipped = [];
        for (const ent of entries) {
            if (ent.data == null) {            // 未対応メソッド (例: -lh1-) → skip して継続
                skipped.push(`${sjisName(ent.name)} (${ent.method || '?'})`);
                continue;
            }
            const rel = ent.name.replace(/^\/+/, '');
            const parts = rel.split('/');
            let dir = '/run';
            for (let k = 0; k < parts.length - 1; k++) {
                dir += '/' + parts[k];
                try { M.FS.mkdir(dir); } catch (_) { /* 既存 */ }
            }
            M.FS.writeFile('/run/' + rel, ent.data);
            written.push({ name: rel, data: ent.data, mtime: ent.mtime });
        }
        if (skipped.length) {
            console.warn(`未対応メソッドで ${skipped.length} エントリを skip: ${skipped.join(', ')}`);
        }
        return written;
    }

    async function extractArchiveToFs(file, append) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // .zip は deflate 展開、それ以外 (.lzh) は LZH デコーダ。どちらもブートせず /run/ へ展開する。
        const entries = /\.zip$/i.test(file.name)
            ? await qbArchive.parseZip(bytes)
            : qbArchive.parseLzh(bytes);
        if (!append) clearRunDir();
        // 書庫名の '\' 区切りを SJIS 対応で '/' に正規化 (ダメ文字の誤分割を防ぐ)。
        for (const e of entries) if (e.name) e.name = dosPathToSlash(e.name);
        return writeEntriesToRun(entries);
    }

    // ---- Phase 3 ローダ: COM / EXE image を staging → loader.d88 で起動 ----
    const dosStageCom  = M.cwrap('np2kai_dos_stage_com', 'number',
                                  ['number', 'number', 'string', 'string']);
    const dosStageExe  = M.cwrap('np2kai_dos_stage_exe', 'number',
                                  ['number', 'number', 'string', 'string']);
    // ② 起動 .bat の逐次実行 (ミニ COMMAND.COM)。script は生バイト (ptr,len) で渡す。
    const dosStageScript = M.cwrap('np2kai_dos_stage_script', 'number',
                                  ['number', 'number', 'string']);
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
    let currentPoll = null;   // 実行中の poll: { tick, codePtr } | null
    function pollDosExit(onExit) {
        // 万一前の poll が生きていたら確実に止める (再入時のタイマ/ヒープリーク防止)。
        if (currentPoll) {
            clearInterval(currentPoll.tick);
            M._free(currentPoll.codePtr);
            currentPoll = null;
        }
        // exit code 用に 4B (i32) を HEAP に確保して polling。100ms 間隔。
        const codePtr = M._malloc(4);
        const self = { tick: 0, codePtr };
        function stopPolling(code) {
            if (currentPoll !== self) return;  // 既に停止済 (二重停止防止)
            clearInterval(self.tick);
            M._free(self.codePtr);
            currentPoll = null;
            onExit(code);
        }
        self.tick = setInterval(() => {
            if (dosGetExitFn(codePtr)) stopPolling(M.getValue(codePtr, 'i32'));
        }, 100);
        currentPoll = self;
        // Stop ボタンが叩く用のフックを保存
        pollDosExit._stop = () => stopPolling(-1);
    }

    // ---- /run ライブ反映 ----------------------------------------------------
    // 実行中のゲームが /run に作った/書き換えた/消したファイルを一覧へ取り込む。
    // 正本は従来どおり loadedEntries (投入時に作る配列)。実行中だけ /run を ~1s ポーリング
    // し、「実行開始時から変化したファイル」だけ差分マージする (= 書庫由来ファイルの原 mtime は
    // そのまま保持)。FS スキャン自体は MEMFS=メモリ上なので軽い。再描画は変化があった時のみ。
    let fsSig = new Map();     // name(/run 相対) -> "size:mtimeMs" (最後に同期した FS 状態)
    let runSyncTimer = null;

    function scanRun() {        // /run 配下の通常ファイルを再帰列挙 {name,size,mtimeMs}
        const out = [];
        (function walk(dir, prefix) {
            let ents;
            try { ents = M.FS.readdir(dir); } catch (_) { return; }
            for (const e of ents) {
                if (e === '.' || e === '..') continue;
                const path = dir + '/' + e;
                let st;
                try { st = M.FS.stat(path); } catch (_) { continue; }
                if (M.FS.isDir(st.mode)) walk(path, prefix + e + '/');
                else out.push({ name: prefix + e, size: st.size, mtimeMs: +st.mtime });
            }
        })('/run', '');
        return out;
    }

    function fsSnapshot() {     // run 開始時の FS 状態を「同期済み」として記録 (差分の基準)
        fsSig = new Map();
        for (const f of scanRun()) fsSig.set(f.name, f.size + ':' + f.mtimeMs);
    }

    function syncRunDir() {     // 差分だけ loadedEntries に反映。変化があれば再描画
        const scan = scanRun();
        const names = new Set();
        let changed = false;
        for (const f of scan) {
            names.add(f.name);
            const sig = f.size + ':' + f.mtimeMs;
            if (fsSig.get(f.name) === sig) continue;     // 開始時から不変 → 触らない (原 mtime 保持)
            fsSig.set(f.name, sig);
            let data;
            try { data = M.FS.readFile('/run/' + f.name); } catch (_) { continue; }
            const mtime = f.mtimeMs ? new Date(f.mtimeMs) : null;
            const i = loadedEntries.findIndex((e) => e.name === f.name);
            if (i >= 0) { loadedEntries[i].data = data; loadedEntries[i].mtime = mtime; }  // 同一性保持
            else loadedEntries.push({ name: f.name, data, mtime });
            changed = true;
        }
        // 実行中に消えたファイルを一覧からも除去
        for (let i = loadedEntries.length - 1; i >= 0; i--) {
            const nm = loadedEntries[i].name;
            if (names.has(nm)) continue;
            fsSig.delete(nm);
            if (loadedEntries[i] === selectedEntry) {
                selectedEntry = null; selectedRecipe = null; runButton.disabled = true; runEntryEl.textContent = '—';
            }
            loadedEntries.splice(i, 1);
            changed = true;
        }
        if (changed) renderFileList();
        return changed;
    }

    function startRunSync() { stopRunSync(); fsSnapshot(); runSyncTimer = setInterval(syncRunDir, 1000); }
    function stopRunSync()  { if (runSyncTimer) { clearInterval(runSyncTimer); runSyncTimer = null; } }

    // staging 後の共通処理: loader.d88 を A: に挿入してリセット → /run ライブ反映 → exit polling。
    async function runStaged(label) {
        runStatusEl.textContent = `${label}: loader.d88 を A: に挿入してリセット中…`;
        await loadLoaderDisk();
        runStatusEl.textContent = `${label}: 実行中 (exit を polling 中…)`;
        stopButton.hidden = false;
        startRunSync();                 // 実行中の /run 変化を一覧へライブ反映
        pollDosExit((code) => {
            stopRunSync();
            syncRunDir();               // 終了直前の書き込みを最終取り込み
            runStatusEl.textContent = code === -1
                ? `${label}: 中断 (Stop)`
                : `${label}: 終了 (exit code=${code})`;
            runButton.disabled = false;
            stopButton.hidden = true;
        });
    }

    async function stageAndRunImage(bytes, cmdline, label, isExe) {
        // image を C ヒープに転送して stage する
        const ptr = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, ptr);
        const stageFn = isExe ? dosStageExe : dosStageCom;
        const r = stageFn(ptr, bytes.length, cmdline || '', label || '');
        M._free(ptr);
        if (r !== 0) throw new Error(`stage_${isExe ? 'exe' : 'com'} failed r=${r}`);
        await runStaged(label);
    }

    // ② 起動 .bat の逐次実行: コマンド列をミニ COMMAND.COM に組んで stage する。
    // 子イメージのバイトは渡さない (展開済 /run から AH=4Bh が読む)。
    async function stageAndRunScript(seq, label) {
        // "PATH\tARGS\n…" を latin1 (= FS キーと同じ符号化) で C へ。
        const scriptStr = seq.map((c) => c.name + '\t' + (c.args || '')).join('\n') + '\n';
        const bytes = new Uint8Array(scriptStr.length);
        for (let i = 0; i < scriptStr.length; i++) bytes[i] = scriptStr.charCodeAt(i) & 0xff;
        const ptr = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, ptr);
        const r = dosStageScript(ptr, bytes.length, label || '');
        M._free(ptr);
        if (r !== 0) throw new Error(`stage_script failed r=${r}`);
        await runStaged(label);
    }

    stopButton.addEventListener('click', () => {
        if (pollDosExit._stop) pollDosExit._stop();
        stopButton.blur();
    });

    runButton.addEventListener('click', async () => {
        if (!selectedEntry || runButton.disabled) return;
        runButton.disabled = true;   // ポーリング終了まで連打を抑止 (重複 stage 防止)
        runButton.blur();            // Enter で Run が再 click されないよう focus を外す
        const userArgs = runCmdline.value;
        try {
            // ② .bat がドライバ+本体の複数コマンド (制御フロー無し) なら、ミニ COMMAND.COM で
            // 1 DOS セッション内に順次 EXEC する (音源ドライバ TSR が本体に効く)。
            if (selectedRecipe) {
                const seq = qbBatScript.resolveSequence(
                    selectedRecipe.recipe, loadedEntries.map((e) => e.name), userArgs);
                if (seq && seq.length > 1) {
                    const label = `${sjisName(selectedEntry.name)} → `
                        + `${sjisName(baseName(selectedRecipe.targetEntry.name))} (+${seq.length - 1} cmd)`;
                    runStatusEl.textContent = `${label} を起動…`;
                    await stageAndRunScript(seq, label);
                    return;
                }
            }
            // 単一プログラム: .bat 主のみ / 制御フロー入り .bat (① フォールバック) / 素の EXE・COM。
            // .bat はレシピ引数 (%N にユーザー入力を差し込み)、素のファイルは cmdline 欄を素の引数で。
            let target, cmdline, label;
            if (selectedRecipe) {
                target  = selectedRecipe.targetEntry;
                cmdline = qbBatScript.buildCmdline(selectedRecipe.args, userArgs);
                label   = `${sjisName(selectedEntry.name)} → ${sjisName(baseName(target.name))}`;
            } else {
                target  = selectedEntry;
                cmdline = userArgs;
                label   = sjisName(target.name);
            }
            const isExe = /\.exe$/i.test(target.name);
            runStatusEl.textContent = `${label} を起動…`;
            await stageAndRunImage(target.data, cmdline, label, isExe);
        } catch (e) {
            runStatusEl.textContent = `ERROR: ${e.message}`;
            console.error(e);
        } finally {
            // polling 中は onExit (stageAndRun*) が戻すので、currentPoll が立つ間は触らない。
            if (currentPoll === null) { runButton.disabled = false; stopButton.hidden = true; }
        }
    });

    // ---- filer 配線: ファイル選択 / ＋追加 / クリア / ドロップ / 仕切り ----
    const fileInput = document.getElementById('file-input');
    let pickerAppend = false;
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
            openDropped(fileInput.files[0], pickerAppend);
            fileInput.value = '';
        }
    });
    document.getElementById('add-archive').addEventListener('click', () => {
        pickerAppend = true; fileInput.click();      // 同じ /run/ に重ねて展開
    });
    arcNameEl.addEventListener('click', () => {
        pickerAppend = false; fileInput.click();      // 新規 (クリアして展開)
    });
    document.getElementById('clear-run').addEventListener('click', () => {
        clearRunDir();
        loadedEntries = []; loadedArchives = []; selectedEntry = null; selectedRecipe = null; currentDir = '';
        runEntryEl.textContent = '—'; runButton.disabled = true;
        textHeadEl.textContent = 'readme / テキスト'; textBodyEl.textContent = '';
        renderFileList();
        runStatusEl.textContent = 'クリアしました';
    });

    // ドロップ受け: 右パネルと canvas エリア。中身があれば追記、無ければ新規。
    function wireDrop(el) {
        el.addEventListener('dragover', (e) => {
            e.preventDefault(); el.classList.add('dragover'); e.dataTransfer.dropEffect = 'copy';
        });
        el.addEventListener('dragleave', (e) => {
            if (!el.contains(e.relatedTarget)) el.classList.remove('dragover');
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault(); el.classList.remove('dragover');
            const f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) openDropped(f, loadedEntries.length > 0);
        });
    }
    wireDrop(document.getElementById('panel'));
    wireDrop(document.getElementById('canvas-wrap'));

    // パネル幅の仕切りドラッグ (canvas は再フィット)
    (function () {
        const divider = document.getElementById('divider');
        const app = document.getElementById('app');
        let dragging = false;
        divider.addEventListener('mousedown', (e) => {
            dragging = true; e.preventDefault(); document.body.style.userSelect = 'none';
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const w = Math.min(Math.max(app.getBoundingClientRect().right - e.clientX, 260),
                               window.innerWidth - 320);
            document.documentElement.style.setProperty('--panel-w', w + 'px');
            fitCanvas(offscreen.width || 640, offscreen.height || 400);
        });
        window.addEventListener('mouseup', () => {
            if (dragging) { dragging = false; document.body.style.userSelect = ''; }
        });
    })();

    // パネル表示/非表示トグル (没入用)。隠すと canvas が全幅に広がる。
    document.getElementById('panel-toggle').addEventListener('click', () => {
        document.body.classList.toggle('panel-hidden');
        fitCanvas(offscreen.width || 640, offscreen.height || 400);
    });

    renderFileList();   // 初期表示 (空一覧)

    // スロット外へのドロップは無視 (ブラウザのデフォルト動作 = ファイルを開く を抑止)
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop',     (e) => e.preventDefault());

    // ---- キーボード入力 ----
    const keyDown = M.cwrap('np2kai_key_down', null, ['number', 'number']);
    const keyUp   = M.cwrap('np2kai_key_up',   null, ['number', 'number']);

    // 押されている code を追跡 (オートリピートで重複 keydown を送らない)
    const pressed = new Set();

    const inField = (e) => e.target && (e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    window.addEventListener('keydown', (e) => {
        // 入力欄 (Args 等) にフォーカス中はゲームへキーを送らない
        if (inField(e)) return;
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
        if (inField(e)) return;
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
    const setFmgen    = M.cwrap('np2kai_set_fmgen',          'number', ['number']);
    window.qbDebug = {
        cs:     () => '0x' + (getCs(handle)       >>> 0).toString(16),
        linear: () => '0x' + (getLinearPc(handle) >>> 0).toString(16),
        pc:     () => `${window.qbDebug.cs()}:${window.qbDebug.linear()}`,
        // FM 音源エンジンの A/B 切替。fmgen(1)=fmgen(既定) / fmgen(0)=opngen。
        // 次の Run (reset) から反映 → 同じ FM ゲームを再実行して聴き比べる。
        fmgen:  (on=1) => `usefmgen=${setFmgen(on ? 1 : 0)} (1=fmgen/0=opngen) — 次の Run から反映。同じゲームを再実行して聴き比べてください`,
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
