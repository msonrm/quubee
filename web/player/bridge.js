// SPDX-License-Identifier: MIT
const canvas = document.getElementById('screen');
const ctx    = canvas.getContext('2d');
// 初期化失敗・致命的エラーの表示先。Run バーのステータス行が唯一の常設テキスト
// (console だけに出すとユーザーには「何も起きない」ようにしか見えない)。
function showFatal(msg) {
    const el = document.getElementById('run-status');
    if (el) el.textContent = msg;
    console.error(msg);
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

// 下部 IME 入力欄が「空・変換中でない」ときだけゲストへ透過させる code。
// いずれも空欄では欄内編集として無意味 (カーソルは先頭で動かず BS/DEL も消すものが無い、
// Home/PageUp/PageDown は単一行欄で no-op、Insert は上書きトグルのみ、Tab は単一行欄を編集せず
// 既定はフォーカス移動だけ) なので、わざわざ欄を閉じなくてもメニュー移動・決定やエディタ
// (VZ/みゅあっぷ) のカーソル/スクロール/行頭/挿入/タブ操作にそのまま使える。文字が入っていれば
// 従来どおり欄内編集を優先する (透過しない)。
// Enter は「空欄 = 実 Enter スキャンコード(0x1c)」に一本化 (非空欄 Enter は SJIS 文字列送信で別扱い、
// setupImeInput 参照)。Tab は欄にフォーカスがあると既定でフォーカスが逃げてしまうので、欄を構えている
// 間は常にフォーカスを欄へ留める (setupImeInput で preventDefault) + 空欄なら実 Tab をゲストへ送る。
// Escape(blur) は空欄でも副作用があるため含めない。
const IME_PASSTHROUGH_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete',
    'Enter', 'Home', 'PageUp', 'PageDown', 'Insert', 'Tab',
]);

async function loadDisk(M, url, fsPath) {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    M.FS.writeFile(fsPath, new Uint8Array(buf));
    return true;
}

// emscripten の stdout/stderr ルーティング。自前 C 側の逐次ログは全て [tag] 形式
// ([dos_loader] / [int21h…] / [tty] / [mcb] 等) なので「先頭が [小文字 の行」をまとめて既定で
// console.debug へ回す。Chrome の DevTools はこれを Verbose レベルに分類し既定では非表示にするが、
// captured なので消えてはいない (レベルフィルタを All/Verbose にすれば読める)。console.warn/error だと
// 赤黄+スタックトレースが自動付与され「無害なのにエラーの山」に見えるのを避ける狙い。本物の emscripten
// エラーは Aborted/RuntimeError 等で先頭が [小文字 にならないので console.error に残す。
// 前面表示 (console.log): URL に ?debug を付ける / window.QB_VERBOSE = true / qbDebug.verbose(1)。
const qbVerbose = () => typeof window !== 'undefined' &&
    (window.QB_VERBOSE || /[?&]debug\b/.test(location.search));
const qbChatter = /^\[[a-z]/;

// ---- emulator を Web Worker で走らせるか (既定 = 対応環境なら ON) ----
// FM 音楽の揺れ根治のため emulator を専用スレッドへ。SharedArrayBuffer(音声リング)+cross-origin
// isolation(COOP/COEP)+AudioWorklet が揃う環境でだけ worker、揃わない (古いブラウザ・ヘッダ未適用の
// ホスト) 時は自動でメインスレッドの従来パスにフォールバック。?local / ?worker=0 で明示的に従来パスへ。
// docs/audio_worker_migration.md 参照。
const QB_USE_WORKER = !/[?&](local|worker=0)\b/.test(location.search)
    && typeof Worker !== 'undefined'
    && typeof SharedArrayBuffer !== 'undefined'
    && self.crossOriginIsolated === true
    && typeof AudioWorklet !== 'undefined';
try { console.log('QuuBee: ' + (QB_USE_WORKER ? 'worker' : 'main-thread') + ' mode'); } catch (_) {}

// worker モード用のスタブ M。closure 冒頭のローカル初期化 (cwrap 定義・create・font/rhythm 書き込み等) を
// 無害に空回りさせる (実体は worker 側)。create だけ truthy を返して `if (!handle)` を通す。emu は
// makeWorkerEmu に差し替わり、ローカル音声ノードは QB_USE_WORKER で skip するので、これらは未使用。
function makeStubM() {
    const noop = () => {};
    return {
        ccall: (fn) => (fn === 'np2kai_create' ? 1 : 0),
        cwrap: () => noop,
        FS: { writeFile: noop, mkdir: noop, readdir: () => [], stat: () => ({ mode: 0 }),
              isDir: () => false, readFile: () => null, rmdir: noop, unlink: noop },
        _malloc: () => 0, _free: noop, HEAPU8: new Uint8Array(0), getValue: () => 0, setValue: noop,
    };
}

// worker emu 実装 (②でモード対応 closure から使う)。local emu と同じインターフェースを worker メッセージで
// 実装し、start(onFrame) で worker 駆動 + SAB 音声 + framebuffer→onFrame を回す。await で初期化完了まで待つ。
async function makeWorkerEmu() {
    const worker = new Worker('player/emu-worker.js');
    let nextId = 1; const pending = new Map();
    let onFrameCb = null, emuObj = null;
    const call = (msg, transfer) => new Promise((resolve, reject) => {
        const id = nextId++; pending.set(id, { resolve, reject });
        worker.postMessage(Object.assign({ id }, msg), transfer || []);
    });
    worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'frame') { if (onFrameCb) onFrameCb(m.w, m.h, m.bpp, new Uint8Array(m.buf)); return; }
        if (m.type === 'audioActive') { if (emuObj && emuObj.onAudioActive) emuObj.onAudioActive(); return; }
        if (m.type === 'reply') {
            const p = pending.get(m.id);
            if (!p) return;
            pending.delete(m.id);
            // worker 側の失敗 (init 失敗 / FS 例外) は error reply で届く → reject で await を
            // 決着させる (resolve のままだと呼び出し元が {error} を成功と誤読して黙って進む)。
            if (m.error) p.reject(new Error(m.error)); else p.resolve(m);
        }
    };
    worker.onerror = (e) => showFatal('worker error: ' + (e.message || (e.filename + ':' + e.lineno)));

    // 音声: SAB リング + AudioWorklet consumer
    const RING_FRAMES = 16384;
    const ringSab = new SharedArrayBuffer(8 + RING_FRAMES * 2 * 4);
    let audioCtx = null, audioRate = 48000, audioReady = false;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        audioRate = audioCtx.sampleRate;
        await audioCtx.audioWorklet.addModule('player/emu-audio-worklet.js');
        new AudioWorkletNode(audioCtx, 'emu-audio', { processorOptions: { sab: ringSab, ringFrames: RING_FRAMES }, outputChannelCount: [2] }).connect(audioCtx.destination);
        audioReady = true;                       // consumer (worklet) が確実に繋がった時だけ true
    } catch (e) {
        // 音声セットアップ失敗 (worklet ファイルの取りこぼし等)。**audioOn を立てない**ことで
        // worker を steady-tick (無音だが映像は進む) に留める。ここで audioOn を立てると、リングを
        // 排出する consumer が居ないまま worker tick が「リング空き待ち」でフレームを進めず、映像ごと
        // 永久に固まる (ローカル経路は rAF が音声と独立なので無音で走り続ける = それに揃える)。
        console.warn('worker audio setup failed — 無音で続行します (映像は動きます):', e);
    }
    // 最初のユーザー操作で resume したら自分のリスナーを外す (ローカル経路と揃える。
    // 貼りっぱなしだと以後ずっと毎 pointerdown/keydown で resume() を呼び続ける)。
    const resumeAudio = () => {
        if (!audioCtx || audioCtx.state !== 'suspended') return;
        audioCtx.resume().then(() => {
            window.removeEventListener('pointerdown', resumeAudio);
            window.removeEventListener('keydown', resumeAudio);
        }).catch(() => {});
    };
    window.addEventListener('pointerdown', resumeAudio);
    window.addEventListener('keydown', resumeAudio);

    // create 前に FONT.BMP / リズムサンプルを worker FS へ
    const coreUrl = new URL('np2kai_core.js', location.href).href;
    const dataFiles = [];
    const fontRes = await fetch('assets/font.bmp');
    if (fontRes.ok) dataFiles.push({ path: '/tmp/FONT.BMP', bytes: new Uint8Array(await fontRes.arrayBuffer()) });
    for (const nm of ['bd', 'sd', 'top', 'hh', 'tom', 'rim']) {
        const rr = await fetch('assets/rhythm/2608_' + nm + '.wav');
        if (!rr.ok) continue;
        const rb = new Uint8Array(await rr.arrayBuffer());
        dataFiles.push({ path: '/tmp/2608_' + nm.toUpperCase() + '.WAV', bytes: rb });
        dataFiles.push({ path: '/tmp/2608_' + nm + '.wav', bytes: rb });
    }
    try {
        await call({ type: 'init', coreUrl, audioRate, dataFiles, audioSab: ringSab, ringFrames: RING_FRAMES, verbose: qbVerbose() });
    } catch (e) {   // core 404 / wasm instantiate / np2kai_create 失敗 — 無言ハングにしない (local の showFatal に揃える)
        showFatal('worker: ' + ((e && e.message) || e));
        throw e;    // 以降の boot disk 挿入 (handle=0) へ進ませない
    }
    const bootRes = await fetch('assets/np2kai_boot.d88');
    if (bootRes.ok) {
        const bytes = new Uint8Array(await bootRes.arrayBuffer());
        await call({ type: 'writeFile', path: '/tmp/boot.d88', bytes });
        await call({ type: 'insertFdd', path: '/tmp/boot.d88', drive: 0, readonly: 0 });
    }

    emuObj = {
        async writeFile(path, bytes) { await call({ type: 'writeFile', path, bytes }); },
        async writeRun(rel, data)    { await call({ type: 'writeRun', rel, data }); },
        async stage(items)           { await call({ type: 'stage', items }); },
        async clearRun()             { await call({ type: 'clearRun' }); },
        async scanRun()              { return (await call({ type: 'scanRun' })).files; },
        async readRun(rel)           { return (await call({ type: 'readFile', path: '/run/' + rel })).bytes; },
        async insertFdd(path, drive, ro) { return (await call({ type: 'insertFdd', path, drive, readonly: ro })).r; },
        async reset()                { await call({ type: 'reset' }); },
        async setPmdIrq(v)           { return (await call({ type: 'call', fn: 'np2kai_set_pmd_irq',  ret: 'number', argTypes: ['number'], args: [v] })).r; },
        async setChibiOto(v)         { return (await call({ type: 'call', fn: 'np2kai_set_chibioto', ret: 'number', argTypes: ['number'], args: [v] })).r; },
        async setBeepMute(v)         { return (await call({ type: 'call', fn: 'np2kai_set_beep_mute', ret: 'number', argTypes: ['number'], args: [v] })).r; },
        async setBeepGain(pct)       { return (await call({ type: 'call', fn: 'np2kai_set_beep_gain', ret: 'number', argTypes: ['number'], args: [pct] })).r; },
        async setClockMultiple(m)    { return (await call({ type: 'call', fn: 'np2kai_set_clock_multiple', ret: 'number', argTypes: ['number'], args: [m] })).r; },
        async enableMidiNow()        { return (await call({ type: 'call', fn: 'np2kai_enable_midi_now', ret: 'number', argTypes: ['number'], prependHandle: true, args: [] })).r; },
        async stageImage(bytes, cmdline, path, isExe) { return (await call({ type: isExe ? 'stageExe' : 'stageCom', bytes, cmdline, path })).r; },
        async stageScript(bytes, label) { return (await call({ type: 'stageScript', bytes, label })).r; },
        async stageBatch(bytes, label)  { return (await call({ type: 'stageBatch', bytes, label })).r; },
        async stageMusic()           { return (await call({ type: 'stageMusic' })).r; },
        async musicPlay(song)        { return (await call({ type: 'musicPlay', song })).r; },
        async getExit()              { return await call({ type: 'getExit' }); },
        keyDown(code)        { worker.postMessage({ type: 'key', down: 1, code }); },
        keyUp(code)          { worker.postMessage({ type: 'key', down: 0, code }); },
        injectText(bytes)    { worker.postMessage({ type: 'injectText', bytes }); },   // SJIS バイト列 (ホスト IME)
        fepShow(bytes, attrs) { worker.postMessage({ type: 'fepShow', bytes, attrs }); },  // HLE FEP: 未確定文字列のインライン描画
        fepHide()            { worker.postMessage({ type: 'fepHide' }); },
        mouseMove(dx, dy)    { worker.postMessage({ type: 'mouseMove', dx, dy }); },
        mouseButton(btn, st) { worker.postMessage({ type: 'mouseButton', btn, state: st }); },
        setPaused(p)         { worker.postMessage({ type: 'setPaused', on: p }); },
        setVerbose(on)       { worker.postMessage({ type: 'setVerbose', on: !!on }); },   // 診断ログの前面表示切替
        // 汎用 C 呼び出し (qbDebug のライブ制御/取得用)。ctl=副作用のみ fire-and-forget、query=戻り値を Promise で。
        ctl(fn, argTypes, args, prependHandle) { worker.postMessage({ type: 'call', fn, argTypes: argTypes || [], args: args || [], prependHandle: !!prependHandle }); },
        query(fn, ret, argTypes, args, prependHandle) { return call({ type: 'call', fn, ret, argTypes: argTypes || [], args: args || [], prependHandle: !!prependHandle }).then(m => m.r); },
        start(onFrame) {
            onFrameCb = onFrame; resumeAudio();
            worker.postMessage({ type: 'run', on: true });
            // 音声 consumer が繋がった時だけ音声駆動。失敗時 (audioReady=false) は steady-tick で無音続行
            // (映像は進む)。これで worklet ロード事故が「全体ハング」でなく「無音」に劣化する。
            worker.postMessage({ type: 'audioOn', on: audioReady });
        },
    };
    return emuObj;
}

(async function main() {
    // モード対応の単一エントリ。worker 時は M をスタブ化し、emu を makeWorkerEmu に差し替える。
    // ローカル初期化 (下) は worker 時スタブ M で無害に空回りする。共有 UI は emu.* で両対応。
    const M = QB_USE_WORKER ? makeStubM() : await NP2KaiModule({
        print:    (t) => { if (qbVerbose() || !qbChatter.test(t)) console.log(t); },
        printErr: (t) => { if (qbChatter.test(t)) { if (qbVerbose()) console.log(t); else console.debug(t); }
                           else console.error(t); },
    });
    let emu;   // QB_USE_WORKER → makeWorkerEmu / それ以外 → 下のローカル実装
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);

    // FONT.BMP / リズムサンプル / boot.d88 の fetch は worker モードでは skip する。
    // worker 時 M はスタブ (FS.writeFile は no-op) なのでローカル init は「無害に空回り」する
    // 設計だが、fetch() だけは実ネットワークを叩く。これらは後段の makeWorkerEmu が worker FS へ
    // 改めて fetch するので、ここで取りに行くと二重取得になる (HTTP キャッシュ頼みの無駄)。
    if (!QB_USE_WORKER) {
        // FONT.BMP を有効化。以前「化けの原因」と疑ったが実際は boot.asm の DS
        // 未設定が真因だった。FONT.BMP が PC-98 規格通りなら 8x16 ネイティブグ
        // リフが出る。化けるならその時こそ BMP 中身が不正と確定する。
        await loadDisk(M, 'assets/font.bmp', '/tmp/FONT.BMP');

        // OPNA 内蔵リズム音源 (バスドラ/スネア/シンバル/ハイハット/タム/リム) のサンプルを
        // データディレクトリへ置く。これが無いと OPNA のリズム部 (reg 0x10 キーオン) が無音になり、
        // 東方旧作など多くの曲でハイハット等のパーカッションが欠ける (実機では鳴る)。本物の YM2608
        // リズム ROM はヤマハ著作物なので同梱不可 → font.bmp と同じく**クリーンな代替**を使う:
        // メモル氏 (J'aime la musique, http://sound.jp/jaime/) が独自作成した「YM2608風リズム音色」
        // 2608modoki2 (作者明示で「組み込み・再配布は有償無償問わず自由」)。CREDITS 参照。
        // opna_reset (pccore_reset) が getbiospath()+"2608_*.WAV" を読むので、最初の reset より前に置く。
        // fmgen は大文字 (2608_BD.WAV)、opngen 経路は小文字 (2608_bd.wav) を探すため両方の名前で書く。
        for (const nm of ['bd', 'sd', 'top', 'hh', 'tom', 'rim']) {
            const res = await fetch('assets/rhythm/2608_' + nm + '.wav');
            if (!res.ok) continue;
            const data = new Uint8Array(await res.arrayBuffer());
            M.FS.writeFile('/tmp/2608_' + nm.toUpperCase() + '.WAV', data); // fmgen 既定
            M.FS.writeFile('/tmp/2608_' + nm + '.wav', data);               // opngen A/B 用
        }
    }

    // ---- AudioContext を先に作って rate を確定させる (従来パス = メインスレッド音声のみ) ----
    // np2kai_create より前に samplingrate を反映させる必要があるため。48000 をリクエストし、
    // 得られた実 rate を使う。サポート外の値だと sound_create が失敗するので 44100 にフォールバック。
    // worker モードでは音声 (AudioContext + rate 設定) は makeWorkerEmu / worker 側が持つので、
    // ここでは作らない (作っても未使用の AudioContext が suspended のまま残るだけ・rate 設定は stub M の no-op)。
    let audioCtx = null, audioRate = 0;
    if (!QB_USE_WORKER) {
        const SUPPORTED_RATES = new Set([11025, 22050, 44100, 48000, 88200, 96000, 176400, 192000]);
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        } catch (_) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
            catch (_2) { audioCtx = null; }
        }
        audioRate = audioCtx ? audioCtx.sampleRate : 0;
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
    }

    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) {
        showFatal('np2kai_create failed');
        return;
    }

    // ブート用ディスクイメージを挿入
    // 最小自己起動ディスク (tools/boot_hello/boot.asm から生成)。
    // text VRAM に "HELLO NP2KAI" を直接書いて HLT ループするだけで BIOS
    // コール一切なし → FreeDOS で踏んだ BIOS ROM 問題を完全に回避できる。
    // worker モードでは makeWorkerEmu が boot.d88 を worker FS へ fetch + insert するので skip
    // (ここで取りに行くと二重取得・stub M への insert は no-op)。
    const diskUrl = 'assets/np2kai_boot.d88';
    const diskPath = '/tmp/boot.d88';
    if (!QB_USE_WORKER) {
        if (await loadDisk(M, diskUrl, diskPath)) {
            const r = M.ccall('np2kai_insert_fdd', 'number',
                ['number', 'string', 'number', 'number'],
                [handle, diskPath, 0, 0]);
            if (r !== 0) showFatal(`boot disk insert failed (r=${r})`);
        } else {
            showFatal(`boot disk fetch failed (${diskUrl})`);
        }
    }

    // ---- オーディオ再生 (pull 型, C1) ----
    // ScriptProcessorNode.onaudioprocess が audio DAC クロックで発火し、毎回 C の
    // np2kai_audio_fill を呼んで出力バッファを直接埋める。生成 (sound_pcmlock) が
    // この pull の中で起きるので、マスタークロックは audio DAC ただ 1 つ = ドリフト無し
    // (旧: rAF で生成して push する二重クロック構成を撤去)。別スレッド化 (AudioWorklet +
    // SharedArrayBuffer) は将来の C2。SPN は非推奨 API だが全ブラウザで動作し、Emscripten
    // SDL2 の非 worklet 音声も内部でこれを使う。
    // ---- 音声/エミュ進行の計測ハーネス (qbDebug.audioStats) ----
    // 症状①「テンポの揺れ・フレームが詰まるようなスキップ」の真因切り分け用。ScriptProcessorNode は
    // メインスレッドで走るので、音声コールバックの発火が run_frame や ~25 万回のピクセル変換ループと
    // 取り合いになって遅刻すると、ハードウェアの音声バッファが枯れて可聴スキップになる。さらに FM の
    // レンダリングは emulated clock までしか進めず、その clock を進める run_frame が rAF で詰まると音が
    // 枯れる。「音声コールバックの遅刻」と「エミュの追いつけなさ」を別々に数値化し、本丸 (AudioWorklet/
    // Worker 化) のどのレベルが要るかを実測で決める。純 JS・リビルド不要。qbDebug.audioStats() で読む。
    const audioStats = {
        since: performance.now(),
        // 音声コールバック (ScriptProcessorNode, メインスレッド)
        cb: 0, cbLate: 0, cbGapMaxMs: 0, cbExpectMs: 0,
        fillSumMs: 0, fillMaxMs: 0, lastCbMs: 0,
        // run_frame (rAF)
        raf: 0, rafSlowCount: 0, rafDtMaxMs: 0, emuSaturated: 0,
        fbSumMs: 0, fbMaxMs: 0, lastRafMs: 0,
    };

    if (!QB_USE_WORKER && audioCtx && handle) {
        const bufSize = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
        const fillFn  = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
        const heapPtr = M._malloc(bufSize * 2 * 2);  // ステレオ int16
        const node = audioCtx.createScriptProcessor(bufSize, 0, 2);
        audioStats.cbExpectMs = bufSize / (audioRate || 48000) * 1000;  // 期待コールバック間隔
        node.onaudioprocess = (e) => {
            // コールバック間隔の計測: 期待 (bufSize/rate) の 1.5 倍超 = HW バッファ枯れ = スキップ疑い
            const _cbNow = performance.now();
            if (audioStats.lastCbMs) {
                const gap = _cbNow - audioStats.lastCbMs;
                if (gap > audioStats.cbGapMaxMs) audioStats.cbGapMaxMs = gap;
                if (audioStats.cbExpectMs && gap > audioStats.cbExpectMs * 1.5) audioStats.cbLate++;
            }
            audioStats.lastCbMs = _cbNow;
            audioStats.cb++;
            const L = e.outputBuffer.getChannelData(0);
            const R = e.outputBuffer.getChannelData(1);
            // 一時停止/停止中はエミュレータを凍結している。ここで pull すると FM チップの保持音
            // (鳴りっぱなしのノート) を audio クロックで延々レンダリングして「最後の音が鳴り続ける」
            // ので、凍結中は fill せず無音を出す (チップ状態は据え置き → 再開で続きから)。
            if (emuFrozen) { L.fill(0); R.fill(0); return; }
            const _fill0 = performance.now();
            fillFn(handle, heapPtr, bufSize);
            // ALLOW_MEMORY_GROWTH で heap が再確保されることがあるので毎回 view を取り直す
            const pcm = new Int16Array(M.HEAPU8.buffer, heapPtr, bufSize * 2);
            let maxAbs = 0;
            for (let i = 0; i < bufSize; i++) {
                const l = pcm[i * 2], r = pcm[i * 2 + 1];
                L[i] = l / 32768;
                R[i] = r / 32768;
                const m = Math.max(l < 0 ? -l : l, r < 0 ? -r : r);
                if (m > maxAbs) maxAbs = m;
            }
            const _fillMs = performance.now() - _fill0;
            audioStats.fillSumMs += _fillMs;
            if (_fillMs > audioStats.fillMaxMs) audioStats.fillMaxMs = _fillMs;
            // 初回再生は boot/常駐/曲ロードで数秒無音 → 実際に音が出た瞬間に計時開始点を合わせる
            // (それまで musicElapsed() は 0 を返す)。音楽の頭が boot 時間ぶんずれないように。
            if (maxAbs > 1000) markAudioActive();
        };
        node.connect(audioCtx.destination);
        M._qbAudioNode = node;  // GC 防止: SPN を永続参照に固定

        // ブラウザのオートプレイ規制対策: 最初のユーザー操作で AudioContext を resume。
        const resumeAudio = () => {
            if (audioCtx.state !== 'suspended') return;
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
            // キャプチャ解除時はボタン状態をリセット (スタックボタン防止)。
            // emu ガード: worker 初期化 (makeWorkerEmu の await 窓・秒オーダー) 中に
            // canvas クリック→ロック→解除すると emu が未代入で TypeError になるため。
            if (!emu) return;
            emu.mouseButton(0, 0);
            emu.mouseButton(1, 0);
        }
    });

    // 移動: Pointer Lock 中のみ送る。
    // canvas は dpr × 整数倍に拡大されているので、movementX/Y は CSS px (=dpr で物理px に
    // 拡縮された値) になる。PC-98 側はソース px ベースで動かしたいので、CSS px ↔ source px
    // のスケールで割る。
    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== canvas) return;
        if (!emu) return;   // worker 初期化中 (emu 未確立) は送らない
        // canvas.style.width は (w * N / dpr) px、source は w なので、
        // 1 source px = canvas.style.width / w CSS px
        const cssW = parseFloat(canvas.style.width)  || canvas.width;
        const cssH = parseFloat(canvas.style.height) || canvas.height;
        const srcW = offscreen.width  || 640;
        const srcH = offscreen.height || 400;
        const dx = Math.round(e.movementX * srcW / cssW);
        const dy = Math.round(e.movementY * srcH / cssH);
        if (dx !== 0 || dy !== 0) emu.mouseMove(dx, dy);
    });

    document.addEventListener('mousedown', (e) => {
        if (document.pointerLockElement !== canvas) return;
        if (!emu) return;   // worker 初期化中 (emu 未確立) は送らない
        if (e.button === 0) emu.mouseButton(0, 1);
        else if (e.button === 2) emu.mouseButton(1, 1);
    });
    document.addEventListener('mouseup', (e) => {
        if (document.pointerLockElement !== canvas) return;
        if (!emu) return;   // worker 初期化中 (emu 未確立) は送らない
        if (e.button === 0) emu.mouseButton(0, 0);
        else if (e.button === 2) emu.mouseButton(1, 0);
    });
    // Pointer Lock 中の右クリックメニュー抑止
    canvas.addEventListener('contextmenu', (e) => {
        if (document.pointerLockElement === canvas) e.preventDefault();
    });

    // ---- 同梱ディスクの挿入 (A: 固定) ----
    // QuuBee はユーザーのディスクイメージをブートしない (concept の赤線 — ドロップされた
    // イメージは qbDiskImage が中身だけを取り出す)。機械に挿さるのは同梱の 2 枚
    // (np2kai_boot.d88 = HELLO 待機 / loader.d88 = Phase 3 ローダ) のみで、どちらも
    // A: 固定・挿入後 reset。旧 A/B/C/D ドライブスロットの任意イメージ挿入+ブート機構は
    // UI 撤去 (2026-06-01) 以来の死に経路だったため削除した。
    const insertFdd = M.cwrap('np2kai_insert_fdd', 'number',
        ['number', 'string', 'number', 'number']);
    const reset     = M.cwrap('np2kai_reset',      null,     ['number']);

    // ---- filer (書庫を /run/ に展開し、一覧/テキスト表示/エントリ選択) ----
    const runEntryEl  = document.getElementById('run-entry');
    const runCmdline  = document.getElementById('run-cmdline');
    const runButton   = document.getElementById('run-button');
    const stopButton  = document.getElementById('stop-button');
    const runStatusEl = document.getElementById('run-status');
    const arcNameEl   = document.getElementById('arc-name');
    const fileListEl  = document.getElementById('file-list');
    const textBodyEl  = document.getElementById('text-body');
    const textHeadEl  = document.getElementById('text-head-name');   // head 内のファイル名 span
    const textPopoutBtn = document.getElementById('text-popout');    // 別窓ビューア起動ボタン
    const textSaveBtn = document.getElementById('text-save');        // 表示中ファイルのダウンロード保存
    const textImageEl = document.getElementById('text-image');       // .MAG 画像プレビュー canvas (text 面と排他)
    const openArchiveBtn = document.getElementById('open-archive');
    const addArchiveBtn  = document.getElementById('add-archive');
    const closeRunBtn    = document.getElementById('close-run');
    const textHeadBar = document.getElementById('text-head');        // ビューアのヘッダ帯 (何も開いていない間は隠す)
    const textPlayBtn = document.getElementById('text-play');        // PMD .M タップ時の ▶ Play (音楽ポップアップを開く)
    // 音楽プレイヤーポップアップ (クリーン HTML プレイヤー。PC-98 画面は背後で暗転)
    const playerModalEl  = document.getElementById('player-modal');
    const pfFileEl       = document.getElementById('pf-file');
    const pfDateEl       = document.getElementById('pf-date');
    const pfTitleEl      = document.getElementById('pf-title');
    const pfComposerEl   = document.getElementById('pf-composer');
    const pfArrangerEl   = document.getElementById('pf-arranger');
    const pfCommentEl    = document.getElementById('pf-comment');
    const playerTimeEl   = document.getElementById('player-time');
    const playerPlayBtn  = document.getElementById('player-play');
    const playerPauseBtn = document.getElementById('player-pause');
    const playerStopBtn  = document.getElementById('player-stop');
    // 音楽再生で /run へ注入する PMD エンジン名 (一覧から隠す対象 — scanRun でフィルタ)
    const HIDDEN_RUN_NAMES = new Set(['PMD86.COM', 'PMP.COM']);
    // 初期の歓迎文 (HTML 直書き・「宣言を読む」リンク入り) を退避 — 「閉じる」/新規オープンで
    // 復元する。リンク要素ごと戻すため innerHTML で持つ (クリックは textBodyEl への委譲で拾う)
    const WELCOME_HTML = textBodyEl.innerHTML;

    let loadedEntries  = [];   // { name(=/run 相対), data, mtime }  path は last-wins
    let selectedEntry  = null; // ▶ Run の実行対象 (EXE/COM もしくは 起動 .bat) — 一覧ではアイコンチップで示す
    let selectedRecipe = null; // selectedEntry が .bat の時の解決結果 { targetEntry, args, recipe }
    let focusedEntry   = null; // いまタップ/表示中のファイル — 一覧では行背景で示す (実行対象とは別概念)
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

    // PC-98 NEC 罫線 (2バイト, SJIS 0x86xx) は JIS X 0208 の区9-12 に NEC が置いた PC-98 固有
    // gaiji で、ブラウザの TextDecoder('shift_jis') も Microsoft CP932 も知らず U+FFFD に潰す
    // (= readme の罫線が崩れる真因)。NEC 罫線は JIS83 罫線 (区8) と同形状なので、同じ形の
    // Unicode 罫線 (U+2500–U+254B) へ写像すれば等幅 Web フォントでそのまま描ける。
    // 写像は NEC罫線→JIS83 変換ツール trkei98 の変換テーブルを正典に抽出 (全32字、test98 で全数検証)。
    // A系(0x86a3 等)=太線、B系(0x86a2 等)=細線、混在分岐も対応。1バイト罫線は SJIS リードバイトと
    // 衝突し文中で曖昧なので対象外 (raw VRAM 経路は既存 tty が font ROM で処理済)。
    const NEC_RULED_TO_UNICODE = {
        0x86a2: 0x2500, 0x86a3: 0x2501, 0x86a4: 0x2502, 0x86a5: 0x2503, 0x86ae: 0x250c, 0x86b1: 0x250f, 0x86b2: 0x2510, 0x86b5: 0x2513,
        0x86b6: 0x2514, 0x86b9: 0x2517, 0x86ba: 0x2518, 0x86bd: 0x251b, 0x86be: 0x251c, 0x86bf: 0x251d, 0x86c2: 0x2520, 0x86c5: 0x2523,
        0x86c6: 0x2524, 0x86c7: 0x2525, 0x86ca: 0x2528, 0x86cd: 0x252b, 0x86ce: 0x252c, 0x86d1: 0x252f, 0x86d2: 0x2530, 0x86d5: 0x2533,
        0x86d6: 0x2534, 0x86d9: 0x2537, 0x86da: 0x2538, 0x86dd: 0x253b, 0x86de: 0x253c, 0x86e1: 0x253f, 0x86e4: 0x2542, 0x86ed: 0x254b,
    };
    // JIS 区9 (SJIS 0x85xx) は PC-98 フォント ROM の「2バイト半角文字」域 — 区3 全角英数字と対で、
    // 半角 (8x16, 1セル幅) の英数字/記号を 2 バイト SJIS コードでアクセスする表 (font.bmp の区9・
    // 94 点全定義を実データ照合し、ANK 8x16 とは別書体ながら同一文字であることを確認済み。区9=半角、
    // 区11=半角罫線 [[reference_pc98_halfwidth_graphics]] と役割が対応する)。
    // PMD .M の #Title に直書きされた曲名で実見: games/music/pmddata.lzh の DE_TOW.M
    // "[ Dungeon Explorer ]" が丸ごとこの符号化で、標準デコーダには U+FFFD の羅列にしか見えない。
    // 見た目 (半角幅) は再現できないので同じ文字の素の ASCII へ復元する。未定義の trail 値 (区9 の
    // 範囲外、区10 側) は復元せず在来の U+FFFD のまま = 誠実な失敗を優先 (feedback_hle_honest_failure)。
    function decorAsciiFromTrail(t) {
        if (t >= 0x40 && t <= 0x7e) return t - 0x1f;   // ascii 0x21-0x5f (記号+大文字)
        if (t >= 0x80 && t <= 0x9e) return t - 0x20;   // ascii 0x60-0x7e (小文字+記号)
        return -1;
    }
    // SJIS バイト列をテキスト復号する。NEC 罫線 (0x86xx) は上表で Unicode 罫線へ、区9 の2バイト半角
    // 英数字 (0x85xx) は半角 ASCII へ差し替え、それ以外の連続バイトは標準の TextDecoder にまとめて
    // 委ねる (漢字/かな/区8罫線はそのまま正しく出る)。
    // 注: 0x86 は SJIS のトレイルバイトにもなり得る (トレイル範囲 0x40-0x7E / 0x80-0xFC)。バイト単位で
    // 「0x86=罫線リード」と決め打つと、トレイルが 0x86 で終わる漢字の直後に罫線トレイル集合 (a2 a3 a4 a5
    // = 半角カナ ｢｣､･ 等) が続いたとき、前の漢字のリードが孤立して化ける。そこで通常の SJIS 2 バイト
    // 文字はリード+トレイルを必ず一緒に消費し、トレイル 0x86 をリードとして再走査させない (0x85 も同様)。
    function decodeSjisText(bytes) {
        let out = '';
        let run = [];
        const flush = () => { if (run.length) { out += sjis.decode(Uint8Array.from(run)); run = []; } };
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            // ここは必ず文字境界。0x86xx が罫線表にあれば Unicode 罫線へ差し替える。
            if (b === 0x86 && i + 1 < bytes.length) {
                const u = NEC_RULED_TO_UNICODE[(0x86 << 8) | bytes[i + 1]];
                if (u !== undefined) { flush(); out += String.fromCodePoint(u); i++; continue; }
            }
            // 0x85xx が区9 の2バイト半角英数字テーブルにあれば半角 ASCII へ差し替える。
            if (b === 0x85 && i + 1 < bytes.length) {
                const a = decorAsciiFromTrail(bytes[i + 1]);
                if (a >= 0) { flush(); out += String.fromCharCode(a); i++; continue; }
            }
            // 通常の SJIS 2 バイト文字 (0x85/0x86 が通常リードの場合も含む) はトレイルごと消費する。
            const isLead = (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);
            if (isLead && i + 1 < bytes.length) { run.push(b, bytes[i + 1]); i++; continue; }
            run.push(b);
        }
        flush();
        return out;
    }

    // Unicode → Shift-JIS エンコーダ (ホスト IME 注入用、2026-06-21 プロトタイプ)。外部テーブルを
    // 持たず、ブラウザ内蔵の shift_jis デコーダ (decodeSjisText と同じ sjis インスタンス) を全 SJIS 域で
    // 逆引きして Unicode→SJIS 表を遅延生成する (素性が decode と一致・依存ゼロ)。半角は ASCII (0x20-0x7E)
    // と半角カナ (0xA1-0xDF)、全角は 2 バイト。表現できない文字は黙って捨てる。
    let _sjisEnc = null;
    function sjisEncoder() {
        if (_sjisEnc) return _sjisEnc;
        const map = new Map();
        for (let b = 0x20; b <= 0x7e; b++) map.set(String.fromCharCode(b), [b]);
        for (let b = 0xa1; b <= 0xdf; b++) {
            const c = sjis.decode(Uint8Array.of(b));
            if (c && c !== '�' && !map.has(c)) map.set(c, [b]);
        }
        const leads = [];
        for (let l = 0x81; l <= 0x9f; l++) leads.push(l);
        for (let l = 0xe0; l <= 0xfc; l++) leads.push(l);
        for (const l of leads) for (let t = 0x40; t <= 0xfc; t++) {
            if (t === 0x7f) continue;
            const c = sjis.decode(Uint8Array.of(l, t));
            if (c && c.length === 1 && c !== '�' && !map.has(c)) map.set(c, [l, t]);
        }
        _sjisEnc = map;
        return map;
    }
    function encodeSjis(str) {
        const map = sjisEncoder();
        const out = [];
        for (const ch of str) {
            const b = map.get(ch);
            if (b) out.push(...b);
            else if (ch === '¥') out.push(0x5c);   // ¥ → 0x5C
            // 表現不能文字はスキップ (プロトタイプ)
        }
        return Uint8Array.from(out);
    }

    const isExecName = (n) => /\.(exe|com)$/i.test(n);
    const isBatName  = (n) => /\.bat$/i.test(n);   // 起動レシピ (qbBatScript で解釈)
    // man=マニュアル / hed=BBS・Vector 配布のヘッダ紹介文 (例: ZUN の huma_ts2.hed) /
    // his=更新履歴 — いずれも corpus 実在 (2026-06-12 棚卸し)
    const isTextName = (n) =>
        /\.(txt|doc|man|hed|his|me|1st|asc|ini|cfg|nfo|faq|hlp|dic|wri)$/i.test(n) ||
        /readme|read\.me|どきゅめんと|説明|よみ/i.test(n);
    const isReadme   = (n) => /readme|read\.me|よみ|説明|どきゅめんと/i.test(n);
    const isImageName = (n) => /\.(mag|pi)$/i.test(n);   // PC-98 標準画像 (MAKI02 / Pi)。.MKI は別系統で未対応
    const isMusicName = (n) => /\.m$/i.test(n);     // PMD (KAJA) FM 音楽データ。.M2/.M26 は後回し
    // 実行せず「閲覧/試聴するだけ」の形式 (画像/音楽)。D&D/Open/＋Add のどれでも単体で開け、
    // 実行されないので束 (ゲーム) を壊さず重ねられる (非破壊オープン)。
    const isPreviewOnlyName = (n) => isImageName(n) || isMusicName(n);
    const baseName   = (n) => n.slice(n.lastIndexOf('/') + 1);   // /run 相対 → ファイル名
    // DOS 8.3 (ASCII) 名か — ＋Add の単体ファイル受け入れ / Save ボタン有効化の共通判定。
    // /run の名前正準形は SJIS 生バイトだが、ブラウザの File.name / download 名は Unicode。
    // 逆変換 (Unicode→SJIS エンコーダ) を持たずに往復を成立させるため、出入りとも
    // 変換不要な ASCII 8.3 名に限定する (= Save できたものは必ず ＋Add で戻せる対称性)。
    // 許可文字は DOS の有効ファイル名文字 (英数 + !#$%&'()@^_`{}~-)。デバイス名は /run に
    // 置けてもゲストの open がデバイス I/O に化けるため弾く。
    const DOS83_RE = /^[A-Za-z0-9!#$%&'()@^_`{}~-]{1,8}(\.[A-Za-z0-9!#$%&'()@^_`{}~-]{1,3})?$/;
    const DOS_DEVICE_NAMES = new Set(['CON', 'PRN', 'AUX', 'NUL', 'CLOCK$',
        'COM1', 'COM2', 'COM3', 'COM4', 'LPT1', 'LPT2', 'LPT3']);
    const isDos83Name = (n) =>
        DOS83_RE.test(n) && !DOS_DEVICE_NAMES.has(n.split('.')[0].toUpperCase());
    const fmtSize = (n) => n >= 1024 ? `${(n / 1024) | 0}K` : `${n}`;
    const fmtTime = (d) => {
        if (!d) return '';
        const p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const escapeHtml = (s) =>
        s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // path 重複は last-wins でマージ (パッチ書庫を後から重ねる用途)。
    // 既存エントリはオブジェクト置換でなく in-place 更新 (同一性保持、syncRunDir と同じ流儀) —
    // 置換すると selectedEntry / selectedRecipe.targetEntry / viewedEntry が旧オブジェクトを
    // 掴んだままになり、▶ Run / Save が上書き前の旧バイトを使ってしまう。
    function mergeEntries(entries) {
        for (const ent of entries) {
            const key = ent.name.toLowerCase();
            const hit = loadedEntries.find((e) => e.name.toLowerCase() === key);
            if (!hit) { loadedEntries.push(ent); continue; }
            Object.assign(hit, ent);
            // 選択中の .bat 自体が差し替わったら起動レシピも作り直す (旧解析で Run しない)
            if (hit === selectedEntry && selectedRecipe) {
                selectedRecipe = resolveBat(hit);
                if (!selectedRecipe) {
                    selectedEntry = null; runButton.disabled = true; runEntryEl.textContent = '—';
                    runStatusEl.textContent = `${sjisName(hit.name)}: launch target not found`;
                }
            }
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
        // ヘッダは 2 状態 (タブ的メタファ)。左 = 環境の開閉 / 右端 = ファイル入出力:
        //   空       = 左「Open」のみ (開き方は歓迎文が説明)
        //   ロード済 = 左「× 書庫名」(×=この書庫を閉じる) / 右「＋Add」のみ
        //     — ロード中の「Open」は出さない: ドロップが常に新規だし、ピッカー派は ×→Open が直感的
        const has = loadedArchives.length > 0;
        arcNameEl.textContent = has ? loadedArchives.join(' + ') : '';
        closeRunBtn.hidden = !has;
        addArchiveBtn.hidden = !has;
        openArchiveBtn.hidden = has;
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
                `<span class="fi">▸</span>` +
                `<span class="fn">${escapeHtml(sjisName(fn))}/</span>` +
                `<span class="fsz">${folders.get(fn)} files</span>` +
                `<span class="fdt"></span>`;
            row.addEventListener('click', () => { currentDir += fn + '/'; renderFileList(); });
            fileListEl.appendChild(row);
        }

        // ファイル行 (readme→起動.bat→text→画像→音楽→exec→other、各内アルファベット順)
        const rank = (n) => isReadme(n) ? 0 : isBatName(n) ? 1 : isTextName(n) ? 2 : isImageName(n) ? 3 : isMusicName(n) ? 4 : isExecName(n) ? 5 : 6;
        files.sort((a, b) => rank(a.name) - rank(b.name) ||
            baseName(a.name).toLowerCase().localeCompare(baseName(b.name).toLowerCase()));
        for (const ent of files) {
            const nm = baseName(ent.name);
            const isBat = isBatName(nm);
            const runnable = isBat || isExecName(nm);
            const row = document.createElement('div');
            // 行の状態は 2 軸を別の手段で示す (混ぜない):
            //   .sel   = いまタップ/表示中 (focusedEntry) → 行背景
            //   .armed = ▶ Run の実行対象 (selectedEntry) → アイコンチップ (Run ボタンと同系緑)
            row.className = 'frow' + (isBat ? ' bat' : isExecName(nm) ? ' exec' : isTextName(nm) ? ' text' : '') +
                            (ent === focusedEntry ? ' sel' : '') +
                            (ent === selectedEntry ? ' armed' : '');
            // 種別アイコンは専用カラム (.fi)。絵文字でなく本文フォントの幾何学記号で統一:
            // ▶=起動できるもの (EXE/COM/.bat 共通 — 種別は色と拡張子が示す) / ≡=テキスト /
            // ▨=画像 / ♪=音楽 (PMD .M) / ▸=フォルダ
            const icon = (isBat || isExecName(nm)) ? '▶'
                       : isImageName(nm) ? '▨' : isMusicName(nm) ? '♪' : isTextName(nm) ? '≡' : '';
            row.innerHTML =
                `<span class="fi">${icon}</span>` +
                `<span class="fn">${escapeHtml(sjisName(nm))}</span>` +
                `<span class="fsz">${fmtSize(ent.data.length)}</span>` +
                `<span class="fdt">${fmtTime(ent.mtime)}</span>`;
            row.addEventListener('click', () =>
                runnable ? selectEntry(ent)
                : isMusicName(nm) ? openMusic(ent)
                : isImageName(nm) ? openImage(ent)
                : openText(ent));
            fileListEl.appendChild(row);
        }
    }

    // 直近に表示した .MAG (別窓ポップアップ用に保持)。null = テキスト表示中。
    let currentImage = null;
    // ビューアに表示中のエントリ (Save ボタンの対象)。focusedEntry とは別物 —
    // EXE/COM をタップすると focused は動くがビューアの中身は前のままなので、
    // 「ファイル名の隣の Save はそのファイルを保存する」を成立させるには表示追従が要る。
    let viewedEntry = null;

    // Save ボタンを表示中エントリに同期する。有効化は ASCII 8.3 名のみ
    // (＋Add 読み戻しと対称 — 書き出せたものは必ず戻せる)。漢字名等は無効化+理由表示。
    function showSaveFor(ent) {
        viewedEntry = ent;
        textSaveBtn.hidden = false;
        const ok = isDos83Name(baseName(ent.name));
        textSaveBtn.disabled = !ok;
        textSaveBtn.title = ok ? 'このファイルをダウンロード保存'
                               : '保存は半角英数の 8.3 名のみ (＋Add で読み戻せる名前に限定)';
    }

    // 表示エリアを「テキスト」モードに切替 (画像 canvas を隠し pre を出す)。
    function showTextMode() { currentImage = null; textImageEl.hidden = true; textBodyEl.hidden = false; }

    // テキスト (readme / .bat 等) を表示
    // (起動 .bat の「解釈した起動順」を見せる用)。
    function openText(ent) {
        focusedEntry = ent;          // 「いま表示中」を一覧の行背景に反映
        renderFileList();
        showTextMode();
        textHeadBar.hidden = false;
        textHeadEl.textContent = sjisName(ent.name);
        // DOS EOF (Ctrl-Z=0x1A) 以降は本文ではない。生バイトで切る
        // (0x1A は SJIS の trail バイト範囲外なので常に単独制御＝安全。
        //  デコード後の符号位置は環境依存なのでバイトで判定する)。
        let bytes = ent.data;
        const eof = bytes.indexOf(0x1a);
        if (eof >= 0) bytes = bytes.subarray(0, eof);
        textBodyEl.textContent = decodeSjisText(bytes).replace(/\r\n?/g, "\n");
        textBodyEl.scrollTop = 0;
        textPopoutBtn.hidden = false;   // 本文があるので別窓ボタンを出す
        textPlayBtn.hidden = true;      // 音楽でないので Play は出さない
        showSaveFor(ent);
    }

    // PMD .M (FM 音楽) をタップ — 下部ビューアに曲名/作曲/作者コメントを表示し ▶ Play を出す。
    // memo (作者注釈) は QBPmd.parseMemo で抽出 (NEC 罫線対応の decodeSjisText を渡す)。
    let currentMusic = null;   // { ent, meta } — Play / ポップアップが参照
    function openMusic(ent) {
        focusedEntry = ent;
        renderFileList();
        showTextMode();
        textHeadBar.hidden = false;
        const nm = baseName(ent.name);
        textHeadEl.textContent = sjisName(ent.name);
        let meta = null;
        try { meta = QBPmd.parseMemo(ent.data, (u) => decodeSjisText(u)); } catch (_) { meta = null; }
        currentMusic = { ent, meta };
        // 下部プレビューは曲タイトルだけ (作曲者/コメント等の詳細は ▶ Play で開くポップアップに集約)。
        textBodyEl.textContent = '♪ ' + (meta && meta.title ? meta.title : sjisName(nm));
        textBodyEl.scrollTop = 0;
        textPopoutBtn.hidden = true;
        textPlayBtn.hidden = false;   // ▶ Play を出す
        showSaveFor(ent);             // .M (ASCII 8.3) はそのまま Save でき往復可能
    }

    // デコード済 MAG を canvas へ描く (アスペクト/200ライン縦2倍は intrinsic で持たせ、
    // CSS object-fit:contain で枠に合わせる)。元画像は 1 度だけ offscreen 化してキャッシュ。
    function renderImageTo(canvasEl, img) {
        if (!img._src) {
            const off = document.createElement('canvas');
            off.width = img.width; off.height = img.height;
            off.getContext('2d').putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
            img._src = off;
        }
        canvasEl.width = img.width;
        canvasEl.height = img.height * img.scaleY;
        const ctx = canvasEl.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img._src, 0, 0, canvasEl.width, canvasEl.height);
    }

    // .MAG 画像をプレビュー表示 (テキスト面と排他)。デコード失敗時はテキストにフォールバック。
    function openImage(ent) {
        focusedEntry = ent;          // 「いま表示中」を一覧の行背景に反映
        renderFileList();
        textHeadBar.hidden = false;
        let img;
        // MAG (MAKI02) / Pi をシグネチャで自動判別 (拡張子でなく中身で出し分け)。
        const decodeImage = (QBPi.isPi(ent.data) ? QBPi.decode : QBMag.decode);
        try { img = decodeImage(ent.data); }
        catch (e) {
            showTextMode();
            textHeadEl.textContent = sjisName(ent.name);
            textBodyEl.textContent = `画像をデコードできませんでした:\n${e.message}`;
            textBodyEl.scrollTop = 0; textPopoutBtn.hidden = false;
            textPlayBtn.hidden = true;
            showSaveFor(ent);   // デコード不能でも生バイトの保存はできる
            return;
        }
        currentImage = img;
        textHeadEl.textContent = `${sjisName(ent.name)} — ${img.width}×${img.height * img.scaleY} / ${img.colors}色`;
        renderImageTo(textImageEl, img);
        textBodyEl.hidden = true; textImageEl.hidden = false;
        textPopoutBtn.hidden = false;
        textPlayBtn.hidden = true;
        showSaveFor(ent);
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

    function selectEntry(ent) {
        focusedEntry = ent;          // タップした行として背景を付ける (実行対象になれなくても)
        if (isBatName(ent.name)) {
            // .bat は「作者の起動レシピ」。主プログラム + 引数を解決して run 対象にする。
            const rec = resolveBat(ent);
            if (!rec) {
                // 起動できなくても中身は読ませる (③敬意: 作者のレシピ)。
                runStatusEl.textContent = `${sjisName(ent.name)}: launch target not found`;
                openText(ent);
                return;
            }
            selectedEntry = ent;
            selectedRecipe = rec;
            // Run バーは .bat 名のみ (シンプル優先)。起動内容は .bat 本文そのもの (ビューア表示)
            // が伝える — 解釈サマリの前置は冗長なので出さない。%N は buildCmdline で差し込む。
            runEntryEl.textContent = sjisName(ent.name);
            openText(ent);
        } else {
            selectedEntry = ent;
            selectedRecipe = null;
            runEntryEl.textContent = sjisName(ent.name);
        }
        // Run 対象が切り替わったので、前の対象に関するメッセージ (exited 等) を流さない。
        // テキスト閲覧タップでは消さない —「Multiple programs — select one」の誘導は
        // プログラム未選択のあいだ表示され続けるべき情報のため (ここに来た時点で解消済み)。
        runStatusEl.textContent = '';
        runButton.disabled = false;
        renderFileList();   // ハイライト更新
    }

    // ドロップ/選択された 1 ファイルを開く。append=true で /run/ に重ねて展開。
    async function openDropped(file, append) {
        document.body.classList.remove('panel-hidden');   // 投入時はパネルを表示
        syncStageMax();                                   // 取っ手のツールチップも追従
        // ＋Add は「いま見ているフォルダ」(currentDir 配下) に展開する。サブフォルダへ移動して
        // から Add する人はそこへ置きたいはず (= サブディレクトリ起動ゲームのセーブ往復が成立)。
        // 新規ドロップ/オープンは束を閉じてルートから (closeBundle が currentDir='' に戻す)。
        // destDir をここで 1 度だけ確定し、以下の各経路 (書庫/ディスクイメージ/COM・EXE/単体
        // ファイル) すべてに効かせる。ルート (destDir='') では全経路が従来挙動と完全一致。
        const destDir = append ? currentDir : '';
        // 画像 (.MAG/.PI) / 音楽 (.M) は実行されない閲覧専用形式。束を壊さず重ねる
        // (束が空なら新規 1 個・ロード済みなら追加)。自動プレビュー対象を previewRel に控える。
        const previewOnly = isPreviewOnlyName(file.name);
        let previewRel = null;
        try {
            // 新規 = 前の束を完全に閉じてから (機械リセット込み — 前のゲームが左画面で
            // 走り続けない)。追加 (＋追加ボタン経由のみ) は重ね展開で機械もそのまま。
            // 閲覧専用形式は !append でも束を閉じない (誤って画像を落としても前のゲームが消えない)。
            if (!append && !previewOnly) await closeBundle();
            runStatusEl.textContent = `Loading ${file.name}…`;
            if (/\.(lzh|lha|lzs|zip)$/i.test(file.name)) {
                mergeEntries(await extractArchiveToFs(file, true, destDir));  // currentDir 配下へ (/run クリアは closeBundle 済)
            } else if (qbDiskImage.isDiskImageName(file.name)) {
                // ディスクイメージは「ブートせず中身を /run/ へ取り出す」(FAT12/16 リーダ)。
                const res = qbDiskImage.extractDiskImage(
                    new Uint8Array(await file.arrayBuffer()), file.name);
                if (!res.ok) {
                    runStatusEl.textContent = `Cannot extract: ${file.name} — ${res.reason}`;
                    return;
                }
                mergeEntries(await writeEntriesToRun(res.files, destDir));   // currentDir 配下へ
            } else if (isExecName(file.name)) {
                const data = new Uint8Array(await file.arrayBuffer());
                const rel = destDir + file.name;                  // currentDir 配下 (ルートなら従来どおり)
                await emu.writeRun(rel, data);
                mergeEntries([{ name: rel, data, mtime: file.lastModified ? new Date(file.lastModified) : null }]);
            } else if (previewOnly) {
                // 画像 (.MAG/.PI) / 音楽 (.M) の単体オープン。実行せず閲覧するだけなので束を壊さず
                // 重ねる。/run 名は SJIS 生バイトの latin1 写像が正準形 (書庫展開名と同形) なので
                // encodeSjis で SJIS 化 — 日本語名の CG もそのまま開ける。SJIS で表現できない名前は弾く。
                const sjis = encodeSjis(file.name);
                if (!sjis.length) {
                    runStatusEl.textContent = `Cannot represent name in Shift-JIS: ${file.name}`;
                    return;
                }
                const data = new Uint8Array(await file.arrayBuffer());
                const canon = destDir + String.fromCharCode(...sjis);
                const prior = loadedEntries.find((e) => e.name.toLowerCase() === canon.toLowerCase());
                const rel = prior ? prior.name : canon;
                await emu.writeRun(rel, data);
                mergeEntries([{ name: rel, data, mtime: file.lastModified ? new Date(file.lastModified) : null }]);
                previewRel = rel;          // 末尾で自動プレビュー
            } else if (append) {
                // ＋Add 限定: 任意の単体ファイルを /run に重ねる (Save したセーブの読み戻し /
                // 自作データ・MML 等の持ち込み)。ASCII 8.3 名のみ (上記 isDos83Name の対称性)。
                // 新規 Open / ドロップは従来どおり弾く — 誤ドロップで束を閉じない安全弁。
                if (!isDos83Name(file.name)) {
                    runStatusEl.textContent =
                        `Not a DOS 8.3 (ASCII) name: ${file.name} — rename and retry`;
                    return;
                }
                const data = new Uint8Array(await file.arrayBuffer());
                // 既存エントリと大文字小文字だけ違う名前は既存側の表記に揃える (MEMFS は
                // case-sensitive なので、素直に書くと同名異 case のファイルが 2 つできる)。
                // 比較も配置も destDir (= currentDir) 基準: サブフォルダを開いた状態なら
                // そのフォルダ内の同名 (セーブ) を上書き、ルートなら従来どおり /run 直下。
                const want = (destDir + file.name).toLowerCase();
                const prior = loadedEntries.find((e) => e.name.toLowerCase() === want);
                const rel = prior ? prior.name : destDir + file.name;
                await emu.writeRun(rel, data);
                mergeEntries([{ name: rel, data, mtime: file.lastModified ? new Date(file.lastModified) : null }]);
            } else {
                runStatusEl.textContent =
                    `Unsupported file: ${file.name} (.lzh / .lha / .lzs / .zip / disk image / .com / .exe)`;
                return;
            }
            loadedArchives.push(file.name);
            // 既定エントリ自動選択 — 「一意なら選ぶ、曖昧なら選ばず一言だけ誘導」。
            // 起動 .bat があれば最優先 (作者の意図した起動レシピ)。複数 .bat = 起動方法
            // (音源モード/シナリオ等) の選択肢。 .bat 無しは .exe が一意ならそれ
            // (.com は音源ドライバ等の脇役が多いので、.exe 1 本ならそれが本体とみなせる)。
            // 旧実装は EXE 複数でも先頭を黙って選んでいたが、曖昧な推測はしない。
            let needChoice = false;
            if (!selectedEntry) {
                const bats = loadedEntries.filter((e) => isBatName(e.name) && resolveBat(e));
                const exes = loadedEntries.filter((e) => /\.exe$/i.test(e.name));
                const coms = loadedEntries.filter((e) => /\.com$/i.test(e.name));
                if (bats.length === 1) selectEntry(bats[0]);
                else if (bats.length > 1) needChoice = true;
                else if (exes.length === 1) selectEntry(exes[0]);
                else if (exes.length === 0 && coms.length === 1) selectEntry(coms[0]);
                else if (exes.length + coms.length > 0) needChoice = true;
            }
            renderFileList();
            // 画像/音楽を単体で開いたら即プレビュー (1 個落とす → そのまま表示/試聴)。
            // それ以外は readme 系を自動で開く (③敬意: 作者の声をまず見せる)。
            if (previewRel) {
                const pent = loadedEntries.find((e) => e.name === previewRel);
                if (pent) (isImageName(pent.name) ? openImage(pent) : openMusic(pent));
            } else {
                const readme = loadedEntries.find((e) => isReadme(e.name) && isTextName(e.name))
                            || loadedEntries.find((e) => /\.doc$/i.test(e.name))
                            || loadedEntries.find((e) => isTextName(e.name));
                if (readme) openText(readme);
            }
            // 曖昧 (起動候補が複数) の時だけ一言誘導 — Run が無効な理由を黙らせない。
            runStatusEl.textContent = needChoice
                ? 'Multiple programs — select one from the list to run'
                : '';
        } catch (e) {
            runStatusEl.textContent = `ERROR: ${e.message}`;
            console.error(e);
        }
    }

    // ---- アーカイブを Emscripten FS に展開 ----
    // (/run の mkdir は emu.writeRun / emu.clearRun が必要時に行う)
    // /run 配下を再帰削除 (サブディレクトリ対応のため unlink だけでは不足)。emu.clearRun が使う。
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
    async function clearRunDir() { await emu.clearRun(); }

    // 機械をページ読込直後と同じ待機状態 (自己起動 HELLO ディスク) に戻す。
    // 直前まで走っていたゲーム/常駐 TSR はこのリセットで消える。staged image は
    // loader-start フックが 1 ショット消費済み (g_stage.ready=0) なので再実行されない。
    // 既に HELLO 待機なら何もしない — リセットの目的は「前のゲームを止める」ことだけで、
    // メモリ衛生は毎 Run の reset + pristine loader.d88 が保証する (新規ドロップのたびに
    // 左画面が無意味に再起動しないように)。
    let machineAtIdle = true;   // 初期ブート = HELLO 待機。Run で false / 本リセットで true
    // 音楽プレイヤーの状態 (PMD .M)。pause は run_frame ループの凍結 (emuFrozen) で実現する
    // = エミュレータごと止まり位置を保持する真の一時停止 (再起動なし)。
    let musicState = 'stopped';   // 'stopped' | 'playing' | 'paused'
    let emuFrozen  = false;       // frame() の run_frame 消化を止める (一時停止)
    let musicSessionUp = false;   // PMD86 常駐の音楽セッションが起動済み (曲差し替えで再起動不要)
    // 演奏経過時間 (壁時計ベース。音楽は DAC クロックで実時間再生なので壁時計=演奏位置)。
    // playing の間だけ進み、pause で凍り、stop で 0 に戻る。初回は boot 中 (無音) は 0 のまま待ち、
    // 実際に音が出た瞬間から計時する (musicAwaitingStart)。
    let musicElapsedMs = 0;       // 確定済み経過 (playing でない区間は据え置き)
    let musicAnchorMs  = 0;       // 現在の playing 区間の開始 (performance.now())
    let musicAwaitingStart = false;  // Play 直後、まだ音が出ていない (boot/常駐/ロード中) → 0 表示で待つ
    function markAudioActive() {  // 実際に音が鳴り始めた → 計時開始点を合わせる (local=onaudioprocess / worker=audioActive msg)
        if (musicAwaitingStart) { musicAwaitingStart = false; musicElapsedMs = 0; musicAnchorMs = performance.now(); }
    }
    function freezeElapsed() {    // playing なら現在区間を確定して止める
        if (musicState === 'playing' && !musicAwaitingStart) musicElapsedMs += performance.now() - musicAnchorMs;
    }
    function musicElapsed() {     // 表示用の総経過 ms
        if (musicAwaitingStart) return 0;   // 音が出るまでは 0:00
        return musicElapsedMs + (musicState === 'playing' ? performance.now() - musicAnchorMs : 0);
    }
    async function resetToIdle() {
        // exit 監視を停止し、onExit (最終 syncRunDir) の完了まで待つ。待たずに下の
        // hideEngineFiles=false へ進むと、最終 scanRun が worker 往復の await 後に倒れた
        // フラグを読んでフィルタ無しになり、音楽セッションの注入エンジン (PMD86.COM/
        // PMP.COM) が「新規ファイル」として一覧に出てしまう (Stop 後の出現バグ)。
        if (currentPoll && pollDosExit._stop) await pollDosExit._stop();
        emu.setPaused(false);       // 凍結したまま reset すると HELLO が描かれない
        musicState = 'stopped';
        musicSessionUp = false;     // セッション破棄 (C 側も qb_dos_reset_state で g_music_active=0)
        musicElapsedMs = 0; musicAwaitingStart = false;   // 経過時間もリセット
        hideEngineFiles = false;
        if (machineAtIdle) return;
        await emu.insertFdd('/tmp/boot.d88', 0, 0);   // 失敗しても reset で BIOS 待機になるだけ
        await emu.setPmdIrq(0);     // snd86opt を既定に戻す (reset 前)
        await emu.reset();
        await emu.setBeepMute(0);   // 起動音を通常に戻す (音楽セッションでミュートしていた場合)
        machineAtIdle = true;
    }

    // 開いている束を完全に閉じる: 機械リセット + /run クリア + UI を初期状態 (歓迎文) へ。
    // 「✕ 閉じる」と新規オープンの前処理で共用する。
    async function closeBundle() {
        await resetToIdle();
        await clearRunDir();
        loadedEntries = []; loadedArchives = []; selectedEntry = null; selectedRecipe = null;
        focusedEntry = null;
        currentDir = '';
        runEntryEl.textContent = '—'; runButton.disabled = true; runCmdline.value = '';
        showTextMode();
        textHeadBar.hidden = true;   // 歓迎文の上にヘッダ帯は出さない
        textHeadEl.textContent = '';
        textBodyEl.innerHTML = WELCOME_HTML;
        textPopoutBtn.hidden = true;
        textSaveBtn.hidden = true;
        viewedEntry = null;
        // 音楽ポップアップを開いたまま束を閉じた場合の後始末 (UI のみ。再生セッション自体は
        // resetToIdle が破棄済み)。closePlayer は使わない — あれは stopMusic 経由で
        // setPaused(true) するため resetToIdle の setPaused(false) を打ち消し HELLO が凍る。
        if (playerTimer) { clearInterval(playerTimer); playerTimer = null; }
        playerModalEl.hidden = true;
        renderFileList();
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
    async function writeEntriesToRun(entries, destDir = '') {
        const written = [], skipped = [], toStage = [];
        for (const ent of entries) {
            if (ent.data == null) {            // 未対応メソッド (例: -lh1-) → skip して継続
                skipped.push(`${sjisName(ent.name)} (${ent.method || '?'})`);
                continue;
            }
            // destDir ('' = ルート / 末尾 '/' 付き) を前置して currentDir 配下へ。書庫内の
            // サブフォルダはその下にネストする (本人が選んだ展開先=本人の責任、コメント済)。
            const rel = destDir + ent.name.replace(/^\/+/, '');
            toStage.push({ rel, data: ent.data });
            written.push({ name: rel, data: ent.data, mtime: ent.mtime });
        }
        await emu.stage(toStage);             // /run へ一括書き込み (親ディレクトリも作成)
        if (skipped.length) {
            console.warn(`未対応メソッドで ${skipped.length} エントリを skip: ${skipped.join(', ')}`);
        }
        return written;
    }

    async function extractArchiveToFs(file, append, destDir = '') {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // .zip は deflate 展開、それ以外 (.lzh / .lha / .lzs=LArc) は LZH デコーダ。どちらもブートせず /run/ へ展開する。
        const entries = /\.zip$/i.test(file.name)
            ? await qbArchive.parseZip(bytes)
            : qbArchive.parseLzh(bytes);
        if (!append) await clearRunDir();
        // 書庫名の '\' 区切りを SJIS 対応で '/' に正規化 (ダメ文字の誤分割を防ぐ)。
        for (const e of entries) if (e.name) e.name = dosPathToSlash(e.name);
        return await writeEntriesToRun(entries, destDir);   // destDir 配下へ展開 (＋Add は currentDir)
    }

    // ---- Phase 3 ローダ: COM / EXE image を staging → loader.d88 で起動 ----
    const dosStageCom  = M.cwrap('np2kai_dos_stage_com', 'number',
                                  ['number', 'number', 'string', 'string']);
    const dosStageExe  = M.cwrap('np2kai_dos_stage_exe', 'number',
                                  ['number', 'number', 'string', 'string']);
    // ② 起動 .bat の逐次実行 (ミニ COMMAND.COM)。script は生バイト (ptr,len) で渡す。
    const dosStageScript = M.cwrap('np2kai_dos_stage_script', 'number',
                                  ['number', 'number', 'string']);
    // ③ if errorlevel/goto 入り .bat (C 側文インタプリタ)。直列化文列を生バイトで渡す。
    const dosStageBatch = M.cwrap('np2kai_dos_stage_batch', 'number',
                                  ['number', 'number', 'string']);
    // 音楽セッション (PMD .M を再起動なしで次々演奏)。stage_music で PMD86 常駐セッションを
    // 仕込み、loader.d88 で 1 度起動 → 以後 music_play(song) で曲だけ差し替える。
    const dosStageMusic = M.cwrap('np2kai_dos_stage_music', 'number', []);
    const dosMusicPlay  = M.cwrap('np2kai_dos_music_play',  'number', ['string']);
    // 起動音 (ピポ = BEEP) のミュート。音楽セッションのブートでだけ消す (FM 曲は別音源で無傷)。
    const setBeepMute   = M.cwrap('np2kai_set_beep_mute',   'number', ['number']);
    // BEEP 音量ブースト (% , 100=素の np2kai)。FM/MIDI を変えず BEEP だけ増幅。qbDebug.beepgain(x) の実体。
    const setBeepGain   = M.cwrap('np2kai_set_beep_gain',   'number', ['number']);
    // 86 ボードの割り込みを IRQ12 に寄せる。我々の PMD .M 再生でだけ on (常駐ドライバ同梱ゲームは
    // 既定 IRQ を前提にするので off=既定でないと演奏が壊れる)。snd86opt は reset(board bind) 前に設定。
    const setPmdIrq     = M.cwrap('np2kai_set_pmd_irq',     'number', ['number']);
    const setChibiOto   = M.cwrap('np2kai_set_chibioto',    'number', ['number']);
    // 86 ボード IRQ の上書きトグル。null=既定 (全ブート IRQ12)、0=既定 IRQ 強制、1=IRQ12 強制。
    // 既定は下の loadLoaderDisk で IRQ12。将来 IRQ12 非対応ドライバが出たら qbDebug.snd86irq(0) で逃げる。
    let forcePmdIrq = null;
    // 「ちびおと」(86+ADPCM=SOUND_SW 0x14) の有効化トグル。**既定 true (= 全ブート 86+ADPCM)**。
    // 2026-06-27 にユーザー実機確認 (FM/ADPCM/FMDSP すべて問題なし) を経て既定 ON 化。0x14 はメインの
    // status レジスタ読み (timer/busy) を変えず (FM ドライバの主経路は不変)、ADPCM 未使用なら無音ストリームを
    // 足すだけ = FM のみ曲は発音同一。ADPCM 入り (FMP .ovi / PMD .PPC) は追加設定なしで鳴る。
    // 非 ADPCM タイトルで万一の副作用 (拡張 status/レジスタ読みの差) が出たら qbDebug.chibioto(0) で素の 86 に戻せる。
    let forceChibi = true;
    let suppressBootBeep = false;   // 次の loader ブートが音楽セッションか (= beep 消音 + IRQ12 + エンジン非表示)
    let hideEngineFiles  = false;   // 一覧から PMD86.COM/PMP.COM を隠すか (音楽セッション中だけ true)
    // np2kai_dos_get_exit(int* code) — JS では HEAP に書き込み番地を渡す
    const dosGetExitFn = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);

    // ---- emu ファサード (継ぎ目): closure はエミュレータをこの窓口だけで触る ----
    // ローカル版 (= ?worker=1 でない従来パス) は M を直接ラップ。後で worker 版に差し替えられるよう
    // 全メソッド async (worker 版はメッセージ往復で非同期になるため)。段階的に拡張中 (いまは起動フロー)。
    // docs/audio_worker_migration.md 段階1 (その場ファサード化・挙動不変)。
    if (QB_USE_WORKER) { emu = await makeWorkerEmu(); }
    else emu = {
        async writeFile(path, bytes) { M.FS.writeFile(path, bytes); },
        async writeRun(rel, data) {                       // /run/<rel> へ書く (親ディレクトリも作る)
            try { M.FS.mkdir('/run'); } catch (_) {}
            const parts = rel.split('/');
            let dir = '/run';
            for (let k = 0; k < parts.length - 1; k++) { dir += '/' + parts[k]; try { M.FS.mkdir(dir); } catch (_) {} }
            M.FS.writeFile('/run/' + rel, data);
        },
        async stage(items) { for (const it of items) await emu.writeRun(it.rel, it.data); },  // [{rel,data}] 一括
        async clearRun() {                                // /run 配下を再帰削除 (rmrf はクロージャの再帰ヘルパ)
            try { M.FS.mkdir('/run'); } catch (_) {}
            for (const e of M.FS.readdir('/run')) { if (e !== '.' && e !== '..') rmrf('/run/' + e); }
        },
        async scanRun() {                                 // /run 配下を再帰列挙 → [{name,size,mtimeMs}] (raw)
            const out = [];
            const walk = (dir, prefix) => {
                let ents; try { ents = M.FS.readdir(dir); } catch (_) { return; }
                for (const e of ents) {
                    if (e === '.' || e === '..') continue;
                    const p = dir + '/' + e;
                    let st; try { st = M.FS.stat(p); } catch (_) { continue; }
                    if (M.FS.isDir(st.mode)) walk(p, prefix + e + '/');
                    else out.push({ name: prefix + e, size: st.size, mtimeMs: +st.mtime });
                }
            };
            walk('/run', '');
            return out;
        },
        async readRun(rel) { try { return M.FS.readFile('/run/' + rel); } catch (_) { return null; } },
        async insertFdd(path, drive, ro) { return insertFdd(handle, path, drive, ro ? 1 : 0); },
        async reset() { reset(handle); },
        async setPmdIrq(v) { return setPmdIrq(v); },
        async setChibiOto(v) { return setChibiOto(v); },
        async setBeepMute(v) { return setBeepMute(v); },
        async setBeepGain(pct) { return setBeepGain(pct); },
        async setClockMultiple(m) { return setMul(m); },
        async enableMidiNow() { return enableMidiNow(handle); },
        async stageImage(bytes, cmdline, path, isExe) {
            // path = image の /run 相対パス (例 "SDEPTH/SD.EXE")。C 側 stage_name/stage_dir が
            // basename と起動時 CWD を切り出す (display label とは別: label は runStaged の UI 用)。
            const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
            const r = (isExe ? dosStageExe : dosStageCom)(ptr, bytes.length, cmdline || '', path || '');
            M._free(ptr); return r;
        },
        async stageScript(bytes, label) {
            const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
            const r = dosStageScript(ptr, bytes.length, label || ''); M._free(ptr); return r;
        },
        async stageBatch(bytes, label) {
            const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
            const r = dosStageBatch(ptr, bytes.length, label || ''); M._free(ptr); return r;
        },
        async stageMusic() { return dosStageMusic(); },
        async musicPlay(song) { return dosMusicPlay(song); },
        async getExit() {
            const p = M._malloc(4); const exited = dosGetExitFn(p);
            const code = M.getValue(p, 'i32'); M._free(p);
            return { exited: !!exited, code };
        },
        // 入力 (fire-and-forget。戻り値を使わないので await 不要)。handle はここで前置。
        keyDown(code)         { keyDown(handle, code); },
        keyUp(code)           { keyUp(handle, code); },
        injectText(bytes) {                          // SJIS バイト列 (ホスト IME) を DOS 文字入力へ注入
            if (!bytes || !bytes.length) return;
            const p = M._malloc(bytes.length); M.HEAPU8.set(bytes, p);
            M.ccall('np2kai_inject_text', 'number', ['number', 'number', 'number'], [handle, p, bytes.length]);
            M._free(p);
        },
        fepShow(bytes, attrs) {                      // HLE FEP: 未確定文字列のインライン描画 (sjis + 属性)
            if (!bytes || !bytes.length) { this.fepHide(); return; }
            const n = bytes.length;
            const p = M._malloc(n * 2); M.HEAPU8.set(bytes, p); M.HEAPU8.set(attrs, p + n);
            M.ccall('np2kai_fep_show', 'number', ['number', 'number', 'number', 'number'], [handle, p, p + n, n]);
            M._free(p);
        },
        fepHide() { M.ccall('np2kai_fep_hide', null, ['number'], [handle]); },
        mouseMove(dx, dy)     { mouseMove(handle, dx, dy); },
        mouseButton(btn, st)  { mouseButton(handle, btn, st); },
        setPaused(p)          { emuFrozen = p; },   // local: loop/audio が emuFrozen を読む
        setVerbose(on)        { window.QB_VERBOSE = !!on; },   // local: printErr が qbVerbose() をライブ参照 (worker との対称性のため)
        // 駆動ループ (local): rAF で catch-up runFrame → getFb → onFrame(描画コールバック)。
        // pause(emuFrozen)/入力ポーリング/クロック/計測は closure 側の状態を参照。worker 版の start() は別実装。
        start(onFrame) {
            const TARGET_HZ = 56, MS_PER_STEP = 1000 / TARGET_HZ, MAX_CATCHUP = 3;
            const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
            const getFb = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
            let nextDue = performance.now();
            const frame = (now) => {
                if (audioStats.lastRafMs) {
                    const dt = now - audioStats.lastRafMs;
                    if (dt > audioStats.rafDtMaxMs) audioStats.rafDtMaxMs = dt;
                    if (dt > 25) audioStats.rafSlowCount++;
                }
                audioStats.lastRafMs = now;
                audioStats.raf++;
                if (emuFrozen) { nextDue = now; requestAnimationFrame(frame); return; }   // 一時停止
                let steps = 0;
                while (now >= nextDue && steps < MAX_CATCHUP) {
                    if (autoClock.enabled) {
                        const _t = performance.now();
                        runFrame(handle);
                        autoClock.sample(performance.now() - _t);
                    } else {
                        runFrame(handle);
                    }
                    nextDue += MS_PER_STEP;
                    steps++;
                }
                if (steps === MAX_CATCHUP && now > nextDue) { audioStats.emuSaturated++; nextDue = now + MS_PER_STEP; }
                autoClock.tick();
                const _fb0 = performance.now();
                const fbPtr = getFb(handle, pW, pH, pBpp);
                if (fbPtr) {
                    const w = M.getValue(pW, 'i32'), h = M.getValue(pH, 'i32'), bpp = M.getValue(pBpp, 'i32');
                    if (w > 0 && h > 0) onFrame(w, h, bpp, M.HEAPU8.subarray(fbPtr, fbPtr + w * h * bpp));
                }
                const _fbMs = performance.now() - _fb0;
                audioStats.fbSumMs += _fbMs;
                if (_fbMs > audioStats.fbMaxMs) audioStats.fbMaxMs = _fbMs;
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        },
    };

    // ---- MIDI 遅延 on-demand ロード ----
    // MIDI ドライバ (MIDDRV/MMD 等) を使うレシピを Run した時だけ、soundfont (SF2) を取得して
    // 合成器 (TinySoundFont) を構築する。非 MIDI ゲームは一切ダウンロードしない (「即プレイ」維持)。
    // SF2 を読んだ後の reset (runStaged 内) で RS-MIDI(シリアル)/MPU98II が合成器に繋ぎ直される
    // (C 側 qb_commng.c)。create のやり直しは不要。音色は GeneralUser GS (full GM/GS、~32MB)。
    const enableMidiNow = M.cwrap('np2kai_enable_midi_now', 'number', ['number']);
    let midiLoadState = 'none';   // 'none' | 'ready' | 'failed'
    async function ensureMidiLoaded() {
        if (midiLoadState === 'ready')  return true;
        if (midiLoadState === 'failed') return false;   // 同セッション内の再試行はしない
        try {
            runStatusEl.textContent = 'MIDI: fetching instrument data (~32 MB, first time only)…';
            // SF2 の取得。fetch は 404 等で reject しないので res.ok を検査する (未配備時に HTML を SF2 として
            // 書き込んでしまわないように)。ローカルは単一 soundfont.sf2、本番 (Cloudflare Pages は 1 ファイル
            // 25MiB 上限) は deploy.sh が soundfont.sf2.00/.01… に分割するので、単一が無ければ連番パートを連結する。
            const showMB = (b) => runStatusEl.textContent = `MIDI: downloading soundfont… ${(b / 1048576).toFixed(1)} MB`;
            const readStream = async (res) => {            // 単一ファイルをストリーミングで読み進捗表示
                const total = Number(res.headers.get('content-length')) || 0;
                if (!(res.body && res.body.getReader)) return new Uint8Array(await res.arrayBuffer());
                const reader = res.body.getReader();
                const parts = []; let n = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    parts.push(value); n += value.length;
                    runStatusEl.textContent = total
                        ? `MIDI: downloading soundfont… ${Math.round(n / total * 100)}% (${(n / 1048576).toFixed(1)} MB)`
                        : `MIDI: downloading soundfont… ${(n / 1048576).toFixed(1)} MB`;
                }
                const u = new Uint8Array(n); let o = 0;
                for (const p of parts) { u.set(p, o); o += p.length; }
                return u;
            };
            // SF2 は RIFF コンテナ。Pages が未配備パスに 200+HTML を返す (SPA フォールバック) ケースを
            // 弾くため、先頭 "RIFF" を検査して偽物なら不採用にする。
            const looksLikeSf2 = (u) => u && u.length > 12 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46;
            let buf = null;
            const single = await fetch('assets/soundfont.sf2');
            if (single.ok) {
                const u = await readStream(single);
                if (looksLikeSf2(u)) buf = u;     // 偽物 (HTML 等) なら下のパート連結へ
            }
            if (!buf) {
                // 本番 (Cloudflare Pages、25MiB/ファイル上限) は deploy.sh が SF2 を分割し、
                // パート名一覧を assets/soundfont.json (マニフェスト) に書く。**Pages は存在しないパスにも
                // 200+HTML を返す**ので「404 まで連番取得」だと無限ループになる → マニフェストで個数を確定する。
                let parts = null;
                try {
                    const mr = await fetch('assets/soundfont.json');
                    if (mr.ok) {
                        const j = JSON.parse(await mr.text());   // HTML フォールバックなら parse 失敗 → catch
                        if (Array.isArray(j.parts) && j.parts.length) parts = j.parts;
                    }
                } catch (_) { parts = null; }
                if (parts) {
                    const chunks = []; let n = 0;
                    for (const name of parts) {
                        const r = await fetch('assets/' + name);
                        if (!r.ok) throw new Error(`soundfont part ${name} (HTTP ${r.status})`);
                        const part = new Uint8Array(await r.arrayBuffer());
                        chunks.push(part); n += part.length; showMB(n);
                    }
                    buf = new Uint8Array(n); let o = 0;
                    for (const c of chunks) { buf.set(c, o); o += c.length; }
                }
            }
            if (!looksLikeSf2(buf)) throw new Error('soundfont 取得失敗 (単一/manifest とも不在 or RIFF 不正)');
            runStatusEl.textContent = `MIDI: soundfont ready (${(buf.length / 1048576).toFixed(1)} MB) — preparing…`;
            // CWD (= data dir /tmp) 直下に soundfont.sf2 を置く。C 側 midimod_create (qb_tsf.c) が
            // tsf_load_filename("soundfont.sf2") で読む。
            await emu.writeFile('/tmp/soundfont.sf2', buf);
            const ok = await emu.enableMidiNow();   // TSF で SF2 ロード (次の reset で結線)
            midiLoadState = ok ? 'ready' : 'failed';
            if (!ok) console.warn('[midi] soundfont ロード失敗 (soundfont.sf2 配置を確認)');
            return !!ok;
        } catch (e) {
            midiLoadState = 'failed';
            console.warn('[midi] soundfont 取得失敗 (production は未配備の可能性):', e);
            return false;
        }
    }

    let loaderDiskCached = null;  // 一度 fetch すれば再利用 (毎回 reset で再ロード)
    async function loadLoaderDisk() {
        if (!loaderDiskCached) {
            const res = await fetch('assets/loader.d88');
            if (!res.ok) throw new Error(`loader.d88 fetch failed (${res.status})`);
            loaderDiskCached = new Uint8Array(await res.arrayBuffer());
        }
        // 毎 Run、pristine な内容を同一パスへ書き直して A: に挿入 (前 Run でゲストがディスクへ
        // 書いた変更を持ち越さない + 固定パス上書きなので MEMFS に積み上がらない)。
        // 挿入失敗は throw → Run ハンドラの catch がステータス行に表示する。
        await emu.writeFile('/tmp/loader.d88', loaderDiskCached);
        const r = await emu.insertFdd('/tmp/loader.d88', 0, 0);
        if (r !== 0) throw new Error(`loader.d88 insert failed (r=${r})`);
        emu.setPaused(false);    // 新セッション = まっさら (凍結/前の音楽セッションを引き継がない)
        musicSessionUp = false;  // 音楽セッション確立は playMusic が reset 後に立て直す
        const musicBoot = suppressBootBeep;   // このブートが音楽セッションか
        suppressBootBeep = false;
        hideEngineFiles = musicBoot;          // 注入エンジンを一覧から隠すのは音楽セッション中だけ
        // 86 ボードの割り込み線を INT5=IRQ12 に寄せる (全ブートの既定)。PC-98 86 ボードの FM
        // ドライバの多くは INT5/IRQ12 を前提に ISR を hook する: ザルバールの SIZ3/SIZ4P は
        // IRQ12 決め打ち (既定 IRQ だと曲送りが止まり本編 FM が無音)、我々の PMD .M プレイヤも
        // IRQ12 前提。KAJA PMD86 (東方旧作同梱) は board 設定に追従するのでどちらでも鳴る。
        // → IRQ12 を既定にすれば全部満たす (2026-06-17、ザルバール無音回帰の根治。deae233 の
        // 「音楽セッションのみ IRQ12」は撤去範囲が広すぎ IRQ12 必須のドライバを巻き添えにしていた)。
        // snd86opt は board bind (reset) 時に読まれるので reset の前に設定する。
        // forcePmdIrq が non-null なら上書き (qbDebug.snd86irq / 将来 IRQ12 非対応ドライバ用)。
        await emu.setPmdIrq(forcePmdIrq !== null ? forcePmdIrq : 1);
        // 「ちびおと」(86+ADPCM=SOUND_SW 0x14) を毎 Run の reset 前に適用。forceChibi 既定 true (全ブート ON)。
        // FMP .ovi / PMD .PPC 等 ADPCM 声部が追加設定なしで鳴る。qbDebug.chibioto(0) で素の 86 に戻せる。
        await emu.setChibiOto(forceChibi ? 1 : 0);
        await emu.reset();
        if (fep) fep.reset();   // FEP の未確定バッファを破棄 (C 側表示状態は np2kai_reset が破棄済み)
        // 起動音 (ピポ) は音楽セッションのブートでだけ消す。ゲーム起動は当時どおり鳴らす
        // (beepcfg.vol は render 時参照なので reset 後でも間に合う)。
        await emu.setBeepMute(musicBoot ? 1 : 0);
        machineAtIdle = false;   // ゲーム実行開始 — 以後の resetToIdle は実リセットする
    }

    // 現在 polling 中のハンドル (Stop ボタンで強制中断する用)。
    let currentPoll = null;   // 実行中の poll: { tick, busy } | null
    function pollDosExit(onExit) {
        // 万一前の poll が生きていたら確実に止める (再入時のタイマリーク防止)。
        if (currentPoll) { clearInterval(currentPoll.tick); currentPoll = null; }
        const self = { tick: 0, busy: false };
        function stopPolling(code) {
            if (currentPoll !== self) return;  // 既に停止済 (二重停止防止)
            clearInterval(self.tick);
            currentPoll = null;
            return onExit(code);   // async onExit の完了を Stop 経路 (resetToIdle) が待てるよう返す
        }
        // exit code は emu.getExit() で取得 (ローカルは HEAP、worker はメッセージ往復)。
        // busy で多重往復を防ぐ。100ms 間隔。
        self.tick = setInterval(async () => {
            if (self.busy) return;
            self.busy = true;
            try { const r = await emu.getExit(); if (currentPoll === self && r.exited) stopPolling(r.code); }
            finally { self.busy = false; }
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

    async function scanRun() {  // emu.scanRun (raw) + hideEngineFiles フィルタ。
        // 音楽セッション中だけ、こちらが /run へ注入した PMD エンジン (PMD86.COM/PMP.COM) を一覧から隠す。
        // ゲーム同梱の pmd86.com (東方旧作等) を巻き込まないよう hideEngineFiles で音楽セッションに限定。
        const all = await emu.scanRun();
        return hideEngineFiles
            ? all.filter((f) => !HIDDEN_RUN_NAMES.has(baseName(f.name).toUpperCase()))
            : all;
    }

    async function fsSnapshot() {  // run 開始時の FS 状態を「同期済み」として記録 (差分の基準)
        // 基準は raw (emu.scanRun 直) で撮る。snapshot は reset より前 = hideEngineFiles が
        // loadLoaderDisk で今回の Run 用に切り替わる前に走るので、フィルタ済み scanRun() だと
        // 音楽セッション直後の通常 Run で注入エンジン (PMD86.COM/PMP.COM) が基準から漏れ
        // 「新規ファイル」として一覧に出てしまう。raw なら不変ファイルとして正しくスキップされる
        // (実行中の一覧反映 syncRunDir は従来どおりフィルタ済み — 隠しファイルは追加されない)。
        fsSig = new Map();
        for (const f of await emu.scanRun()) fsSig.set(f.name, f.size + ':' + f.mtimeMs);
    }

    async function syncRunDir() {  // 差分だけ loadedEntries に反映。変化があれば再描画
        const scan = await scanRun();
        const names = new Set();
        let changed = false;
        for (const f of scan) {
            names.add(f.name);
            const sig = f.size + ':' + f.mtimeMs;
            if (fsSig.get(f.name) === sig) continue;     // 開始時から不変 → 触らない (原 mtime 保持)
            fsSig.set(f.name, sig);
            const data = await emu.readRun(f.name);
            if (data == null) continue;
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
            if (loadedEntries[i] === focusedEntry) focusedEntry = null;   // 行背景の幽霊ハイライト防止
            if (loadedEntries[i] === viewedEntry) {                       // Save の stale 書き込み防止
                viewedEntry = null; textSaveBtn.disabled = true;
            }
            loadedEntries.splice(i, 1);
            changed = true;
        }
        if (changed) renderFileList();
        return changed;
    }

    let syncBusy = false;       // async polling の多重実行を防ぐ (worker 版は往復で時間がかかりうる)
    async function syncRunTick() { if (syncBusy) return; syncBusy = true; try { await syncRunDir(); } finally { syncBusy = false; } }
    async function startRunSync() { stopRunSync(); await fsSnapshot(); runSyncTimer = setInterval(syncRunTick, 1000); }
    function stopRunSync()  { if (runSyncTimer) { clearInterval(runSyncTimer); runSyncTimer = null; } }

    // staging 後の共通処理: /run 同期基準 → loader.d88 を A: に挿入してリセット → exit polling。
    async function runStaged(label) {
        runStatusEl.textContent = `${label}: starting…`;
        // 同期基準 (fsSnapshot) は必ず reset より前に撮る。loader boot は実質ゼロ遅延で、
        // 「creat→write→exit だけ」の爆速プログラムは boot 込み 1 フレームで完走する (実測)。
        // 旧順序 (reset 後に snapshot) だと worker の tick が 1 回先行しただけでプログラムが
        // 走り切り、作られたファイルが「開始時から存在」とみなされ一覧に永遠に載らなかった
        // (Stosstruppe 氏報告「fig1.exe を Run しても a.txt が作られない」の真因 — 実際は
        // MEMFS に作られており、一覧同期が取りこぼしていた)。
        await startRunSync();           // 基準を確定し、実行中の /run 変化を一覧へライブ反映
        await loadLoaderDisk();
        runStatusEl.textContent = `${label}: running`;
        stopButton.hidden = false;
        pollDosExit(async (code) => {
            stopRunSync();
            await syncRunDir();         // 終了直前の書き込みを最終取り込み
            runStatusEl.textContent = code === -1
                ? `${label}: stopped`
                : `${label}: exited (code ${code})`;
            runButton.disabled = false;
            stopButton.hidden = true;
        });
    }

    async function stageAndRunImage(bytes, cmdline, label, isExe, path) {
        // path = image の /run 相対パス (C 側の stage_name/stage_dir 用)。省略時は label を流用
        // (従来挙動: ルート直下 ASCII 名なら label==path で等価)。label は UI 表示専用。
        const r = await emu.stageImage(bytes, cmdline, path || label, isExe);
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
        const r = await emu.stageScript(bytes, label);
        if (r !== 0) throw new Error(`stage_script failed r=${r}`);
        await runStaged(label);
    }

    // ③ if errorlevel/goto 入り .bat: buildStatements の文列を直列化して C 側文インタプリタへ。
    // 分岐は実行中に errorlevel (EXEC 子の終了コード) で評価される。
    async function stageAndRunBatch(stmts, label) {
        const progStr = qbBatScript.serializeStatements(stmts);
        const bytes = new Uint8Array(progStr.length);
        for (let i = 0; i < progStr.length; i++) bytes[i] = progStr.charCodeAt(i) & 0xff;
        const r = await emu.stageBatch(bytes, label);
        if (r !== 0) {
            // C 側の容量上限 (文数 96 / cmd 48 / echo 2KB 等) 超過は JS で事前検査して
            // いない → throw せず false を返し、呼び元が ① 単一起動へフォールバックする。
            console.warn(`stage_batch failed r=${r} — ① 単一起動へフォールバック`);
            return false;
        }
        await runStaged(label);
        return true;
    }

    // ---- PMD (.M) FM 音楽の再生 ------------------------------------------------
    // 自前クリーンビルドの PMD エンジン (PMD86.COM 常駐 + PMP.COM 演奏) を assets から
    // 遅延 fetch して /run へ注入し、既存のシーケンス起動経路 (stageAndRunScript) で
    // 「PMD86 → PMP <曲>」を 1 DOS セッションで走らせる。loader の sti+hlt アイドルで
    // 常駐 ISR (OPNA タイマ IRQ12) が刻み続ける = steady-state 演奏 (Path B 実証済)。
    let pmdEngineCache = null;   // { pmd86: Uint8Array, pmp: Uint8Array } — 一度 fetch すれば再利用
    async function ensurePmdEngine() {
        if (!pmdEngineCache) {
            const fetchBin = async (p) => {
                const r = await fetch(p);
                if (!r.ok) throw new Error(`${p} fetch failed (${r.status})`);
                return new Uint8Array(await r.arrayBuffer());
            };
            const [pmd86, pmp] = await Promise.all([
                fetchBin('assets/pmd/PMD86.COM'),
                fetchBin('assets/pmd/PMP.COM'),
            ]);
            pmdEngineCache = { pmd86, pmp };
        }
        // 毎再生 /run へ書き直す (reset を跨いでも内容は不変・固定パスなので積み上がらない)。
        // scanRun が HIDDEN_RUN_NAMES でフィルタするので一覧には出ない。
        await emu.writeRun('PMD86.COM', pmdEngineCache.pmd86);
        await emu.writeRun('PMP.COM',   pmdEngineCache.pmp);
    }

    // 曲を再生する。音楽セッション (PMD86 常駐) が既に在れば曲だけ差し替え (再起動なし)、
    // 無ければセッションを 1 度だけ起動する。停止/一時停止の凍結はここで必ず解除する。
    async function playMusic(ent) {
        musicElapsedMs = 0; musicAnchorMs = performance.now(); musicAwaitingStart = true;  // 音が出るまで 0:00
        emu.setPaused(false); musicState = 'playing'; updatePlayerButtons();   // 楽観的に playing (凍結解除)
        const dosPath = ent.name.replace(/\//g, '\\');   // /run 相対 → DOS パス (PMP の引数)
        const label = `♪ ${sjisName(baseName(ent.name))}`;
        try {
            await ensurePmdEngine();   // PMD86.COM/PMP.COM を /run へ (毎回・冪等)
            if (musicSessionUp) {
                // 常駐セッションに曲を queue するだけ = 別 DOS セッションを起こさない (再起動なし)
                await emu.musicPlay(dosPath);
                runStatusEl.textContent = `${label}: running`;
            } else {
                // 初回: PMD86 常駐の音楽セッションを起動し、最初の曲を queue する (ここだけ 1 回 reset)
                runStatusEl.textContent = `${label}: loading engine…`;
                runButton.disabled = true;
                const r = await emu.stageMusic();
                if (r !== 0) throw new Error(`stage_music failed r=${r}`);
                await emu.musicPlay(dosPath);
                suppressBootBeep = true;    // 音楽セッションのブートは起動音 (ピポ) を消す
                await runStaged(label);     // loader.d88 挿入 + reset + /run sync + exit polling
                musicSessionUp = true;
            }
        } catch (e) {
            runStatusEl.textContent = `ERROR: ${e.message}`;
            console.error(e);
            runButton.disabled = false;
            musicState = 'stopped'; musicSessionUp = false; updatePlayerButtons();
        }
    }

    // 一時停止 = エミュレータごと凍結 (位置保持・再起動なし)。常駐 ISR も刻まなくなる。
    function pauseMusic() {
        if (musicState !== 'playing') return;
        freezeElapsed();             // 経過カウンタを確定して止める
        emu.setPaused(true); musicState = 'paused';
        runStatusEl.textContent = `${currentMusic ? '♪ ' + sjisName(baseName(currentMusic.ent.name)) : '♪'}: paused`;
        updatePlayerButtons();
    }
    function resumeMusic() {
        if (musicState !== 'paused') return;
        musicAnchorMs = performance.now();   // 経過カウンタを再開
        emu.setPaused(false); musicState = 'playing';
        runStatusEl.textContent = `${currentMusic ? '♪ ' + sjisName(baseName(currentMusic.ent.name)) : '♪'}: running`;
        updatePlayerButtons();
    }
    // 停止 = 凍結で無音化 + 経過を 0 に戻す (一時停止は値を保持・停止はリセット = ユーザー要望)。
    // セッション (PMD86 常駐) は維持するので、次の Play は再起動なしで頭から。
    // セッションの実破棄は Run / 新規ドロップ / 閉じる の reset が行う。
    function stopMusic() {
        emu.setPaused(true); musicState = 'stopped';
        musicElapsedMs = 0; musicAwaitingStart = false;   // 0:00 に戻す
        runStatusEl.textContent = `${currentMusic ? '♪ ' + sjisName(baseName(currentMusic.ent.name)) : '♪'}: stopped`;
        updatePlayerButtons();
        updatePlayerTime();
    }

    // ---- 音楽プレイヤーポップアップ (クリーン HTML。表示中は PC-98 画面を覆う) ----
    // ボタン活殺: 再生中は Play 無効 / 停止中は Stop 無効 / Pause は再生中のみ有効。
    function updatePlayerButtons() {
        playerPlayBtn.disabled  = (musicState === 'playing');
        playerPauseBtn.disabled = (musicState !== 'playing');
        playerStopBtn.disabled  = (musicState === 'stopped');
    }
    // 経過時間表示 (M:SS、無限ループなので総尺は出さない)。~250ms 間隔で playing 中だけ進む。
    let playerTimer = null;
    function fmtClock(ms) {
        const t = Math.max(0, Math.floor(ms / 1000));
        return `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`;
    }
    function updatePlayerTime() { playerTimeEl.textContent = fmtClock(musicElapsed()); }

    // ラベル付きで情報を流し込む (空でもフィールドは残す)。値はそのまま (作者の表記を尊重)。
    function openPlayer(music) {
        releaseHeldKeys();                        // 押しっぱなしキーの取り残し防止 (keyup 参照)
        const meta = music && music.meta;
        pfFileEl.textContent     = sjisName(baseName(music.ent.name));
        pfDateEl.textContent     = music.ent.mtime ? fmtTime(music.ent.mtime) : '';   // 配布当時のタイムスタンプ
        pfTitleEl.textContent    = (meta && meta.title)    || '';
        pfComposerEl.textContent = (meta && meta.composer) || '';
        pfArrangerEl.textContent = (meta && meta.arranger) || '';
        pfCommentEl.textContent  = (meta && meta.memo && meta.memo.length) ? meta.memo.join('\n') : '';
        playerModalEl.hidden = false;
        updatePlayerButtons();
        updatePlayerTime();
        if (!playerTimer) playerTimer = setInterval(updatePlayerTime, 250);
    }
    // 閉じる = 停止 (ユーザー要望: 閉じたら音楽も止まる)。
    function closePlayer() {
        stopMusic();
        if (playerTimer) { clearInterval(playerTimer); playerTimer = null; }
        playerModalEl.hidden = true;
    }

    // 下部ビューアの ▶ Play: 再生開始 + ポップアップを開く。
    textPlayBtn.addEventListener('click', () => {
        if (!currentMusic) return;
        openPlayer(currentMusic);
        playMusic(currentMusic.ent);
    });
    // ポップアップ: ▶ = 停止中なら頭から再生 / 一時停止中なら再開 ・ ⏸ = 一時停止 ・ ■ = 停止。
    playerPlayBtn.addEventListener('click', () => {
        if (musicState === 'paused') resumeMusic();
        else if (currentMusic) playMusic(currentMusic.ent);
    });
    playerPauseBtn.addEventListener('click', pauseMusic);
    playerStopBtn.addEventListener('click', stopMusic);
    document.getElementById('player-close').addEventListener('click', closePlayer);
    playerModalEl.addEventListener('click', (e) => { if (e.target === playerModalEl) closePlayer(); });

    stopButton.addEventListener('click', async () => {
        // exit 監視の停止だけでなく機械もリセット — 「止まった」が見た目どおりになる
        // (旧実装は監視停止のみで、ゲーム/TSR は左画面で走り続けていた)。
        // /run のセーブ類は onExit の syncRunDir が取り込み済み。
        await resetToIdle();
        stopButton.blur();
    });

    runButton.addEventListener('click', async () => {
        if (!selectedEntry || runButton.disabled) return;
        runButton.disabled = true;   // ポーリング終了まで連打を抑止 (重複 stage 防止)
        runButton.blur();            // Enter で Run が再 click されないよう focus を外す
        const userArgs = runCmdline.value;
        try {
            // MIDI ドライバ (MIDDRV 等) を使うレシピ、または MIDI 曲データが投入されていれば、
            // staging 前に soundfont を遅延ロードして合成器を構築する。直後の runStaged 内
            // reset でシリアル/MPU98II が結線される。失敗しても続行 (= FM/BEEP 経路でそのまま
            // 起動、無音にはならない)。
            // 拡張子ヒューリスティック: MPU-PC98 を直接叩くプレイヤー (MIMPI 等) は起動時の
            // 音源自動判別で 0xE0D0 を探すため、その時点で MPU が attach 済みでないと BEEP へ
            // フォールバックしてしまう。「MIDI でしか鳴らない曲データ形式」(SMF とレコンポーザ系)
            // が /run に居ればほぼ確実に MIDI 用途なので先に有効化する。.sng (ミュージ郎) /
            // .std/.mff (SMF 別名) / .seq 等は他ドライバ・他用途と衝突しうるので保留 —
            // 誤検知は「そのセッションだけ MPU 常時 attach」と同じ副作用 (自動判別ソフトの
            // 音源選択が変わりうる) を持つため、確実な形式に絞る。ソフト単体で起動して後から
            // MIDI ファイルを読む型 (曲データ非同梱) はこの判定では救えない (既知の限界)。
            const midiSongRe = /\.(mid|rcp|r36|mcp)$/i;
            if ((selectedRecipe && qbBatScript.usesMidi(selectedRecipe.recipe))
                || loadedEntries.some((e) => midiSongRe.test(e.name))) {
                const ok = await ensureMidiLoaded();
                if (!ok) runStatusEl.textContent = 'MIDI setup failed — launching without MIDI';
            }
            // ②/③ .bat の逐次実行: 1 DOS セッション内で順次 EXEC する (音源ドライバ TSR が
            // 本体に効く)。if errorlevel/goto 入り (③) は C 側文インタプリタが分岐を実行時評価、
            // 制御フロー無し (②) は従来の線形列。どちらも未対応構文等で null なら ① 単一起動へ。
            if (selectedRecipe) {
                const names = loadedEntries.map((e) => e.name);
                // 制御フロー (if/goto) か環境操作 (set/cd) を含む .bat は C 側文インタプリタ (③) で
                // 実行する。set は env を更新し以降の EXEC 子へ継承、cd はカレントを移動する
                // (環境変数でデータ位置を知るソフト / 本体ディレクトリへ cd するレシピのため)。
                if (selectedRecipe.recipe.hasControlFlow || selectedRecipe.recipe.hasEnvOps) {
                    const stmts = qbBatScript.buildStatements(
                        selectedRecipe.recipe, names, userArgs);
                    if (stmts) {
                        const ncmd = stmts.filter((s) => s.op === 'cmd').length;
                        const how = selectedRecipe.recipe.hasControlFlow
                            ? `if/goto 分岐を実行時評価, ${ncmd} cmd`
                            : `set/cd を逐次実行, ${ncmd} cmd`;
                        const label = `${sjisName(selectedEntry.name)} (${how})`;
                        runStatusEl.textContent = `Launching ${label}…`;
                        if (await stageAndRunBatch(stmts, label)) return;
                        // stage 失敗 (C 側上限超過) → 下の ① 単一起動へフォールスルー
                    }
                } else {
                    const seq = qbBatScript.resolveSequence(
                        selectedRecipe.recipe, names, userArgs);
                    if (seq && seq.length > 1) {
                        const label = `${sjisName(selectedEntry.name)} → `
                            + `${sjisName(baseName(selectedRecipe.targetEntry.name))} (+${seq.length - 1} cmd)`;
                        runStatusEl.textContent = `Launching ${label}…`;
                        await stageAndRunScript(seq, label);
                        return;
                    }
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
            runStatusEl.textContent = `Launching ${label}…`;
            // target.name = /run 相対パス (例 "SDEPTH/SD.EXE")。C 側が起動時 CWD をその
            // サブディレクトリに合わせる (サブディレクトリ起動のデータ相対 open 救済)。
            await stageAndRunImage(target.data, cmdline, label, isExe, target.name);
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
    const pickerAcceptNew = fileInput.accept;   // 新規 Open 用の拡張子フィルタ (HTML の accept)
    let pickerAppend = false;
    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files[0]) {
            openDropped(fileInput.files[0], pickerAppend);
            fileInput.value = '';
        }
    });
    openArchiveBtn.addEventListener('click', () => {
        pickerAppend = false; fileInput.accept = pickerAcceptNew;
        fileInput.click();                           // 新規 (前の束を閉じて展開)
    });
    addArchiveBtn.addEventListener('click', () => {
        pickerAppend = true; fileInput.accept = '';  // ＋Add は単体ファイルも受けるので無フィルタ
        fileInput.click();                           // 同じ /run/ に重ねて展開 (HD インストール)
    });
    closeRunBtn.addEventListener('click', async () => {
        // 破壊的 (ゲーム停止 + 取り出したファイル/セーブ消滅) なので確認を挟む。
        // ドロップ新規はあえて確認なし: ファイルを選んで落とすのは十分意図的な操作で、
        // 毎回ダイアログを挟むと「書庫→即プレイ」のお手軽さが削れる。
        if (!confirm(`「${loadedArchives.join(' + ')}」を閉じます。\n実行中のゲームは停止し、取り出したファイル (セーブ含む) は消えます。`)) return;
        await closeBundle();
        runStatusEl.textContent = 'Closed';
    });

    // ドロップ受け: 右パネルと canvas エリア。常に「新規」(予測可能性優先 —
    // 重ね展開したい時は ＋追加 ボタンから)。
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
            if (f) openDropped(f, false);
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
            if (e.target !== divider) return;   // 取っ手のクリックを幅調整に化けさせない
            if (document.body.classList.contains('panel-hidden')) return;   // 最大化中は幅調整なし
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

    // 仕切りの取っ手: ゲーム画面の最大化⇄復帰 (シアターモード相当)。最大化中も仕切りは
    // 右端に細く残るため、取っ手は両状態で同じ場所に居続ける (戻すボタンが行方不明に
    // ならない)。グリフ ▸/◂ は CSS ::before が body.panel-hidden で切り替える。
    const stageMaxBtn = document.getElementById('stage-max');
    function syncStageMax() {
        stageMaxBtn.title = document.body.classList.contains('panel-hidden')
            ? 'パネルを戻す' : 'ゲーム画面を最大化';
    }
    stageMaxBtn.addEventListener('click', () => {
        document.body.classList.toggle('panel-hidden');
        syncStageMax();
        fitCanvas(offscreen.width || 640, offscreen.height || 400);
    });
    syncStageMax();

    // ---- 別窓ビューア (readme/テキストを大きく読む。将来 .MAG 画像も同じモーダルに相乗り) ----
    const viewerModalEl  = document.getElementById('viewer-modal');
    const settingsModalEl = document.getElementById('settings-modal');   // 設定パネル (キー/パッドガードで参照)
    const viewerTitleEl  = document.getElementById('viewer-title');
    const viewerBodyEl   = document.getElementById('viewer-body');
    const viewerCanvasEl = document.getElementById('viewer-canvas');
    // VZ Editor 慣習の「%X タグ」(目次⇔本文の手作りリンク) をリンク化してテキストを描画する。
    // 当時の readme は VZ の HELP キー (カーソル下の単語で検索ジャンプ) で目次から各セクションへ
    // 飛ぶ前提で %A〜%O 等のタグを目次と見出しの両方に置いた (例: CANV2C30 canvas.doc)。
    // それをマウスクリックに翻訳する: クリックで「次の同タグ出現位置」へ巡回ジャンプ
    // (目次→本文→目次と回れる、VZ の検索と同じ意味論)。
    // 同じタグが 2 回以上出るものだけリンク化 (1 回きりは飛び先が無い = "100%" 等の誤爆も防ぐ)。
    const VIEWER_TAG_RE = /(?<![0-9A-Za-z%])%[0-9A-Za-z@](?=[\s　]|$)/gm;
    const renderViewerText = (text) => {
        viewerBodyEl.textContent = '';
        const counts = new Map();
        for (const m of text.matchAll(VIEWER_TAG_RE)) {
            counts.set(m[0], (counts.get(m[0]) || 0) + 1);
        }
        const frag = document.createDocumentFragment();
        let pos = 0;
        for (const m of text.matchAll(VIEWER_TAG_RE)) {
            if ((counts.get(m[0]) || 0) < 2) continue;
            frag.appendChild(document.createTextNode(text.slice(pos, m.index)));
            const span = document.createElement('span');
            span.className = 'viewer-tag';
            span.dataset.tag = m[0];
            span.title = '次の ' + m[0] + ' へジャンプ (VZ の HELP キー相当)';
            span.textContent = m[0];
            frag.appendChild(span);
            pos = m.index + m[0].length;
        }
        frag.appendChild(document.createTextNode(text.slice(pos)));
        viewerBodyEl.appendChild(frag);
    };
    viewerBodyEl.addEventListener('click', (e) => {
        const el = e.target.closest('.viewer-tag');
        if (!el) return;
        const all = [...viewerBodyEl.querySelectorAll('.viewer-tag')]
            .filter((s) => s.dataset.tag === el.dataset.tag);
        const next = all[(all.indexOf(el) + 1) % all.length];
        next.scrollIntoView({ block: 'start' });
        next.classList.remove('viewer-tag-hit');
        void next.offsetWidth;                    // reflow でアニメーションを再始動可能に
        next.classList.add('viewer-tag-hit');
    });
    // いま表示している内容 (ファイル名 + テキスト or 画像) をそのまま大きくポップアップに写す。
    const openViewer = () => {
        releaseHeldKeys();                        // 押しっぱなしキーの取り残し防止 (下記 keyup 参照)
        viewerBodyEl.classList.remove('prose');   // 宣言 (About) の散文モードを解除
        viewerTitleEl.textContent = textHeadEl.textContent;
        if (currentImage) {                       // 画像: canvas を大きく
            renderImageTo(viewerCanvasEl, currentImage);
            viewerBodyEl.hidden = true; viewerCanvasEl.hidden = false;
            viewerModalEl.hidden = false;
        } else {                                  // テキスト: pre を大きく (+ %X タグリンク)
            renderViewerText(textBodyEl.textContent);
            viewerCanvasEl.hidden = true; viewerBodyEl.hidden = false;
            // scrollTop=0 は必ずモーダル表示「後」に行う。display:none 中の代入は no-op で、
            // Chrome は再表示時に前回のスクロール位置を復元するため、非表示中に 0 を入れても
            // 前回位置が残る (「View を開くと前回の位置のまま」の真因)。
            viewerModalEl.hidden = false;
            viewerBodyEl.scrollTop = 0;
        }
    };
    const closeViewer = () => {
        viewerModalEl.hidden = true;
        if (aboutShowing) {
            aboutShowing = false;
            // 既読は「閉じた」時点で記録する。読まずにタブごと離脱した人には次回も出す
            try { localStorage.setItem(ABOUT_SEEN_KEY, '1'); } catch (e) { /* storage 不可なら毎回表示 */ }
        }
    };
    textPopoutBtn.addEventListener('click', openViewer);
    document.getElementById('viewer-close').addEventListener('click', closeViewer);
    viewerModalEl.addEventListener('click', (e) => { if (e.target === viewerModalEl) closeViewer(); });

    // ---- 宣言 (About) — 初回訪問時に自動表示 + ヘッダ About で随時再表示 ----
    // 本文は index.html の #about-text (歓迎文と同じく site copy は HTML 側)。
    // キー名の v1 は文面の大改訂時にバンプして全員にもう一度見せるための版数。
    const ABOUT_SEEN_KEY = 'quubee_about_seen_v1';
    const ABOUT_TEXT = document.getElementById('about-text').textContent;
    let aboutShowing = false;
    const openAbout = () => {
        releaseHeldKeys();                        // 押しっぱなしキーの取り残し防止 (keyup 参照)
        viewerTitleEl.textContent = 'QuuBee — 宣言 / Declaration';
        viewerBodyEl.textContent = '';
        // URL だけ実リンク化 (新規タブ)。それ以外はプレーンテキストのまま
        const frag = document.createDocumentFragment();
        let pos = 0;
        for (const m of ABOUT_TEXT.matchAll(/https?:\/\/\S+/g)) {
            frag.appendChild(document.createTextNode(ABOUT_TEXT.slice(pos, m.index)));
            const a = document.createElement('a');
            a.href = m[0]; a.target = '_blank'; a.rel = 'noopener';
            a.textContent = m[0];
            frag.appendChild(a);
            pos = m.index + m[0].length;
        }
        frag.appendChild(document.createTextNode(ABOUT_TEXT.slice(pos)));
        viewerBodyEl.appendChild(frag);
        viewerBodyEl.classList.add('prose');
        viewerCanvasEl.hidden = true; viewerBodyEl.hidden = false;
        viewerModalEl.hidden = false;
        viewerBodyEl.scrollTop = 0;   // 表示「後」にリセット (display:none 中の代入は no-op)
        aboutShowing = true;
    };
    // 再表示入口は歓迎文 (ファイル未オープン時のマニュアル部分) 内の「宣言を読む」リンク。
    // 歓迎文は innerHTML 復元で要素が作り直されるため、リスナは委譲で textBodyEl に置く
    textBodyEl.addEventListener('click', (e) => {
        if (e.target.closest('.about-link')) openAbout();
    });
    try { if (!localStorage.getItem(ABOUT_SEEN_KEY)) openAbout(); } catch (e) { /* storage 不可時は出さない */ }

    // 表示中ファイルをダウンロード保存。/run ライブ反映は entry オブジェクトを同一性
    // 保持で更新するので、実行中にゲームが書き換えたセーブも最新の data が落ちる。
    textSaveBtn.addEventListener('click', () => {
        if (!viewedEntry || textSaveBtn.disabled) return;
        const url = URL.createObjectURL(
            new Blob([viewedEntry.data], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName(viewedEntry.name);   // ASCII 8.3 のみ有効なので符号化問題なし
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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

    // 保持中のキーを全部 keyUp してから追跡集合を空にする。モーダル (ビューア/音楽
    // ポップアップ) を開く瞬間に呼ぶ — モーダル表示中は keydown/keyup がゲームへ届かず、
    // キーを押したままモーダルを開いてモーダル中に離すと keyUp が伝わらずゲスト側で
    // 押しっぱなしになり (以後そのキーが pressed に残って効かなくなる)、window blur まで
    // 復帰しない。開いた時点で解放しておけばこの取り残しが起きない (ゲームパッドの
    // 「モーダル中は全キー解放扱い」と同じ思想)。
    function releaseHeldKeys() {
        for (const codeName of pressed) {
            const code = PC98_KEYMAP[codeName];
            if (code !== undefined) emu.keyUp(code);
        }
        pressed.clear();
    }

    // ---- HLE FEP (ホスト側日本語入力、未確定文字列をゲスト画面内へインライン表示) ----
    // fep.js の純状態機械を emu へ配線する。キーはアプリより上流 (下の keydown) で飲み、
    // 表示は C 側 dos_fep.c がテキスト VRAM に直接描く。確定は「復元 → SJIS 注入」の順。
    // 属性スキームはスタイル名 → {yomi(未確定よみ), focus(注目=候補表示中)} の属性バイト。
    // 実 FEP の表示文法 (よみ=下線系 / 注目文節=反転) の配分違いを qbDebug.fepstyle で A/B する。
    // 値は仮置き — VZ 実画面での見比べで決める (fmgen A/B と同じ流儀)。
    const FEP_STYLES = {
        wx:   { yomi: 0xE9, focus: 0xE5 },   // WX 風: よみ=白下線 / 注目=白反転 (下線多用)
        atok: { yomi: 0xE5, focus: 0xC5 },   // ATOK 風: よみ=白反転 / 注目=黄反転 (反転主体)
    };
    let fepStyleName = 'wx';
    const fep = window.qbFepCreate ? window.qbFepCreate({
        show(segments) {
            const bytes = [], attrs = [];
            const style = FEP_STYLES[fepStyleName] || FEP_STYLES.wx;
            for (const seg of segments) {
                const a = (style[seg.kind] !== undefined) ? style[seg.kind] : 0xE9;
                for (const b of encodeSjis(seg.text)) { bytes.push(b); attrs.push(a); }
            }
            if (!bytes.length) { emu.fepHide(); return; }
            emu.fepShow(Uint8Array.from(bytes), Uint8Array.from(attrs));
        },
        hide()       { emu.fepHide(); },
        commit(text) { emu.fepHide(); emu.injectText(encodeSjis(text)); },
    }) : null;

    const inField = (e) => e.target && (e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    // 下部 IME 入力欄 (#ime-input) が「フォーカス中・空・変換中でない」ときの透過対象キー
    // (IME_PASSTHROUGH_KEYS) だけをゲストへ通す。e.target が入力欄自身 = フォーカス中。
    const imePassThrough = (e) => e.target && e.target.id === 'ime-input' &&
        e.target.value === '' && !e.isComposing && IME_PASSTHROUGH_KEYS.has(e.code);
    window.addEventListener('keydown', (e) => {
        // 入力欄 (Args 等) にフォーカス中はゲームへキーを送らない。
        // ただし空の IME 入力欄での透過対象キー (矢印/編集キー等) だけは例外で通す。
        const passThru = imePassThrough(e);
        if (inField(e) && !passThru) return;
        // 別窓ビューアを開いている間はゲームへキーを送らない (Esc で閉じる)
        if (!viewerModalEl.hidden) { if (e.key === 'Escape') { e.preventDefault(); closeViewer(); } return; }
        // 音楽プレイヤーポップアップを開いている間も同様 (Esc で閉じる。演奏は背後で続く)
        if (!playerModalEl.hidden) { if (e.key === 'Escape') { e.preventDefault(); closePlayer(); } return; }
        // 設定パネルを開いている間も同様 (Esc で閉じる。ゲームは背後で続く = live 設定を聴き比べられる)
        if (!settingsModalEl.hidden) { if (e.key === 'Escape') { e.preventDefault(); settingsModalEl.hidden = true; } return; }
        // HLE FEP: Ctrl+Space でトグル (実機の CTRL+XFER 相当。qbDebug.fep でも可)。
        // ON 中は composition がキーを飲む (feed が true を返したキーはゲストへ送らない)。
        if (fep && e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'Space') {
            e.preventDefault();
            const on = fep.toggle();
            runStatusEl.textContent = on ? 'FEP: ON — ローマ字入力 (Space=変換 / Enter=確定 / Esc=取消 / Ctrl+Space=OFF)' : 'FEP: OFF';
            return;
        }
        if (fep && fep.feed(e)) { e.preventDefault(); return; }
        // Ctrl/Meta/Alt + 他キーのブラウザショートカット (Ctrl+R / Ctrl+W / Ctrl+Shift+I 等)
        // は横取りしない。ただし CTRL キー単体は PC-98 の CTRL(0x74) としてゲームに送る
        // (発射/ダッシュに CTRL を使うゲーム向け)。これを通さないと PC98_KEYMAP の
        // ControlLeft/Right→0x74 が永久に死にコードになる。Ctrl 押下中の他キーは従来どおり
        // ブラウザへ委ねるため、押下キー自身が Control のときだけ素通しさせる。
        const isCtrlKey = (e.code === 'ControlLeft' || e.code === 'ControlRight');
        // Ctrl+C だけは例外的にゲストへ通す: DOS の ^C (INT 23h 発火、bios09 の CTRL バンクが
        // C キーを 0x03 に変換する)。canvas 上に選択は無いのでコピーを奪っても実害はない。
        // keyup 側は pressed セット基準なので押しっぱなしにはならない。
        const isCtrlC = (e.code === 'KeyC' && e.ctrlKey && !e.metaKey && !e.altKey);
        if (!isCtrlKey && !isCtrlC && (e.ctrlKey || e.metaKey || e.altKey)) return;
        const code = PC98_KEYMAP[e.code];
        if (code === undefined) return;
        // 透過時 (BS/DEL は KEY_PREVENT_DEFAULT 外) も欄の既定動作を抑止してゲストへ回す
        if (passThru || isCtrlC || KEY_PREVENT_DEFAULT.has(e.code)) e.preventDefault();
        if (pressed.has(e.code)) return;     // OS のオートリピートは無視
        pressed.add(e.code);
        emu.keyDown(code);
    });

    window.addEventListener('keyup', (e) => {
        // 入力欄にフォーカス中でも、keydown が透過したキー (= pressed に在る) は keyUp を送る。
        // さもないとゲスト側で押しっぱなしになる。透過しなかったキーは従来どおり欄に委ねる。
        if (inField(e) && !pressed.has(e.code)) return;
        if (!viewerModalEl.hidden) return;   // ビューア表示中はゲームへ送らない
        if (!playerModalEl.hidden) return;   // 音楽ポップアップ表示中も同様
        if (!settingsModalEl.hidden) return; // 設定パネル表示中も同様
        const code = PC98_KEYMAP[e.code];
        if (code === undefined) return;
        if (KEY_PREVENT_DEFAULT.has(e.code)) e.preventDefault();
        if (!pressed.has(e.code)) return;
        pressed.delete(e.code);
        emu.keyUp(code);
    });

    // ---- ゲームパッド入力 (Gamepad API → キー変換) ----
    // PC-98 ゲームの操作はキーボードが普遍 (カーソル/テンキー移動 + Z/X が典型) なので、
    // パッドは「キーの別名」として NKEY を直接注入する。標準 mapping 前提:
    //   十字キー (buttons 12-15) / 左スティック (axes 0,1) → カーソル
    //   ボタン 0(下)→Z  1(右)→X  2(左)→Space  3(上)→Enter  9(Start)→ESC
    //   L1(4)→Ctrl (東方のメッセージスキップ)  R1(5)→Shift (東方の低速移動)
    // 東方旧作: Z/Space=ショット, X=ボム, Shift=低速移動, Ctrl=スキップ, ESC=ポーズ。
    // Super Depth: Z/Space=左攻撃 (button 0/2), X/Enter=右攻撃 (button 1/3)。
    // Gamepad API はイベントでなくポーリング型なので rAF ループ先頭で毎フレーム読む。
    // Chrome はボタンを一度押すまでパッドを列挙しない (= 接続直後は無反応で正常)。
    // 割当は設定パネル (Gamepad グループ) で変更可 (方向=カーソル/テンキー切替・各ボタン→キー)。
    // 下記の既定値は上のコメントの現行マッピングと 1:1 (localStorage 未保存なら挙動不変=ゼロ回帰)。
    const PAD_DEADZONE = 0.5;
    // ボタン割当の候補キー (id → PC-98 NKEY)。矢印・Tab は候補から外し (移動は方向モードが担う)、
    // 動作キーに絞る。テンキーは方向モード側で 2468 を提供。
    const PAD_KEYS = { z: 0x29, x: 0x2a, c: 0x2b, space: 0x34, enter: 0x1c, esc: 0x00, ctrl: 0x74, shift: 0x70 };
    const PAD_KEY_LABEL = { z: 'Z', x: 'X', c: 'C', space: 'Space', enter: 'Enter', esc: 'Esc', ctrl: 'Ctrl', shift: 'Shift', none: 'None' };
    // 方向モード 2 種 (左手 = 十字/左スティック)。arrow=カーソル / tenkey=テンキー 2468。斜めは同時押し。
    const PAD_DIRS = { arrow:  { up: 0x3a, down: 0x3d, left: 0x3b, right: 0x3c },
                       tenkey: { up: 0x43, down: 0x4b, left: 0x46, right: 0x48 } };   // 8/2/4/6
    // 対象ボタンと既定割当 (現行 if と 1:1)。idx = 標準 Gamepad ボタン番号。
    const PAD_BUTTONS = [
        { idx: 0, label: 'A (0)',     def: 'z' },
        { idx: 1, label: 'B (1)',     def: 'x' },
        { idx: 2, label: 'X (2)',     def: 'space' },
        { idx: 3, label: 'Y (3)',     def: 'enter' },
        { idx: 4, label: 'L1 (4)',    def: 'ctrl' },
        { idx: 5, label: 'R1 (5)',    def: 'shift' },
        { idx: 9, label: 'Start (9)', def: 'esc' },
    ];
    let padDir = 'arrow';                 // 現在の方向モード (設定パネルで上書き)
    const padBtnMap = {};                 // btnIdx → keyId (既定は PAD_BUTTONS.def)
    PAD_BUTTONS.forEach((b) => { padBtnMap[b.idx] = b.def; });
    let padLive = -1;                     // 今押している対象ボタン番号 (設定パネルの live 表示用・-1=なし)
    const padPressed = new Set();         // パッド由来で押下中の NKEY (キーボードとは独立管理)

    // パッド由来の押下を全解放。blur/タブ非表示中は rAF が止まりエッジ検出が走らないため、
    // 押しっぱなしのままタブを離れるとゲスト側でキーが押されたまま自走する — 明示解放で断つ。
    function releasePadKeys() {
        for (const k of padPressed) emu.keyUp(k);
        padPressed.clear();
    }

    function pollGamepads() {
        const want = new Set();
        let live = -1;
        // ビューア/音楽ポップアップ中は完全停止。設定パネル中は「押下ボタンの検出 (live)」だけ行い、
        // ゲームへは送らない (toGame=false → want 空 → 下のエッジ検出で padPressed が全解放される)。
        if (viewerModalEl.hidden && playerModalEl.hidden && navigator.getGamepads) {
            const toGame = settingsModalEl.hidden;
            const dir = PAD_DIRS[padDir] || PAD_DIRS.arrow;
            for (const gp of navigator.getGamepads()) {
                if (!gp || !gp.connected) continue;
                const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
                const ax  = (i) => gp.axes[i] || 0;
                for (const b of PAD_BUTTONS) if (btn(b.idx)) live = b.idx;   // UI 用 (パネル中の物理ボタン特定)
                if (!toGame) continue;
                if (btn(12) || ax(1) < -PAD_DEADZONE) want.add(dir.up);
                if (btn(13) || ax(1) >  PAD_DEADZONE) want.add(dir.down);
                if (btn(14) || ax(0) < -PAD_DEADZONE) want.add(dir.left);
                if (btn(15) || ax(0) >  PAD_DEADZONE) want.add(dir.right);
                for (const b of PAD_BUTTONS) {
                    if (btn(b.idx)) {
                        const kid = padBtnMap[b.idx];
                        if (kid && kid !== 'none' && PAD_KEYS[kid] !== undefined) want.add(PAD_KEYS[kid]);
                    }
                }
            }
        }
        padLive = live;
        // エッジ検出して keyDown/keyUp (同 NKEY をキーボードと同時押ししていた場合、
        // 片方の解放で keyUp が先行するが、実害は「押し直せば済む」程度なので許容)
        for (const k of want) {
            if (!padPressed.has(k)) { padPressed.add(k); emu.keyDown(k); }
        }
        for (const k of [...padPressed]) {
            if (!want.has(k)) { padPressed.delete(k); emu.keyUp(k); }
        }
    }
    // ゲームパッドはメインスレッドの rAF で毎フレームポーリング (両モード共通)。pollGamepads は
    // emu.keyDown/keyUp 経由なので local/worker どちらにも届く (旧: local の駆動ループ内で呼んでいた)。
    (function padLoop() { pollGamepads(); requestAnimationFrame(padLoop); })();

    window.addEventListener('gamepadconnected', (e) => {
        console.log(`[QuuBee] gamepad connected: ${e.gamepad.id} (mapping=${e.gamepad.mapping || 'none'})`);
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
    const setItfPost  = M.cwrap('np2kai_set_itf_post',       'number', ['number']);
    const setLines30  = M.cwrap('np2kai_set_lines30',        'number', ['number']);
    const setMul      = M.cwrap('np2kai_set_clock_multiple', 'number', ['number']);
    const setY2k      = M.cwrap('np2kai_set_y2k_clamp',      'number', ['number']);
    const getY2k      = M.cwrap('np2kai_get_y2k_clamp',      'number', []);
    // 既定クロック倍率。multiple=20 × baseclock 2.4576MHz ≈ 49MHz (≈486DX2-50)。
    // 2026-06-26 に 27 (≈66MHz、ZUN 推奨環境相当) へ上げたが、ちびおと(ADPCM)既定 ON 後の
    // FMDSP 等で run_frame が重くなり音が詰まる実害をユーザーが実機で確認したため 20 に戻した
    // (2026-06-27)。np2kai_set_clock_multiple は np2cfg.multiple も書くので一度適用すれば以後の
    // Run (reset) でも保持される (下の起動時 emu.setClockMultiple で一度だけ適用)。
    const DEFAULT_MULTIPLE = 20;
    const setVol      = M.cwrap('np2kai_set_vol',  null,     ['number','number','number','number']);
    const getVol      = M.cwrap('np2kai_get_vol',  'number', ['number']);
    const midiBytes   = M.cwrap('np2kai_debug_serial_midi_bytes',  'number', ['number']);
    const midiActive  = M.cwrap('np2kai_debug_serial_midi_active', 'number', ['number']);
    const midiFxFn    = M.cwrap('np2kai_debug_midi_fx',            null,     ['number']);
    const memprobeFn  = M.cwrap('np2kai_debug_memprobe',           'number', ['number', 'number']);
    const xmsEnableFn = M.cwrap('np2kai_xms_enable',               'number', ['number', 'number']);
    const xmsStatFn   = M.cwrap('np2kai_xms_stat',                 'number', ['number', 'number']);
    const mouse33CtlFn  = M.cwrap('np2kai_mouse33_ctl',            null,     ['number', 'number']);
    const mouse33StatFn = M.cwrap('np2kai_mouse33_stat',           'number', ['number', 'number']);

    // ---- async 自動クロック (快適化, 既定 ON) ----
    // 達成フレーム時間から CPU クロック倍率を「逆算」する適応コントローラ。run_frame の
    // wall-time を EMA で測り、1 step の real-time 予算 (= MS_PER_STEP) に対する負荷比で
    // multiple を [floor, ceil] 内で 1 段ずつ増減する。host が速ければ自動で上げて快適化し
    // (HLT-idle ゲームは HLT fast-forward で倍率がほぼ無料なので ceil まで張り付く)、遅ければ
    // 下げて pull 音声バッファの枯渇 (途切れ) を未然に防ぐ。engine の SUPPORT_ASYNC_CPU は
    // 実時間フィードバック (lastTimingValue) が未結線で機能しないため、調整カスケード
    // (np2kai_set_clock_multiple = engine と同手順の changeclock + gdc_updateclock) だけ
    // 借りて、フィードバックは我々の最も信頼できる実時間信号 = run_frame 実測で駆動する。
    const autoClock = {
        enabled: false,           // 既定 OFF (multiple=DEFAULT_MULTIPLE=20≈49MHz 固定)。autoclock の快適化利得は小さく
                                  // (大半のゲームは HLT 待ちで倍率ほぼ無影響)、一方で倍率を上げると
                                  // run_frame が重くなり音楽のテンポがもたつく実害が出る (MIDI でも FM/Ray でも
                                  // 確認、2026-06-14。ちびおと既定 ON 後の FMDSP でも 2026-06-27 に再確認)。速さが欲しい稀な
                                  // CPU 律速タイトルだけ qbDebug.autoclock(1) または qbDebug.multiple(N) で手動で上げる。
                                  // 既定倍率は起動時に emu.setClockMultiple(DEFAULT_MULTIPLE=20) で適用し
                                  // np2cfg.multiple に保持される (≈486DX2-50 相当。音切れの出ない安全側)。
        floor: 20, ceil: 42, step: 2,   // floor=20: autoclock ON 時の安全下限 (重い時はここまで下げる)。
                                  // ceil=42: 仕様の x42 快適化目標。これ以上 (例 60) だと
                                  // vsync ロックゲームの CPU-bound バースト (ステージ遷移等) が
                                  // 速すぎになる (Nyahax で確認) ため、速度の上限として 42 を採用。
        cur: DEFAULT_MULTIPLE,    // 現在の倍率 (= pccore.multiple と同期)。既定 20≈49MHz
        emaMs: 0,                 // run_frame 1 回の所要 ms の指数移動平均
        budgetMs: 1000 / 56,      // 1 step の real-time 予算 (run loop の TARGET_HZ=56 と一致)
        evalEvery: 30,            // 評価間隔 (rAF 単位 ≈ 0.5s)。頻繁すぎる発振を防ぐ
        evalCount: 0,
        hi: 0.70, lo: 0.40,       // 負荷ヒステリシス帯。残り (0.30〜0.60) は描画+音声+jitter 用
        sample(ms) { this.emaMs = this.emaMs ? this.emaMs * 0.9 + ms * 0.1 : ms; },
        tick() {
            if (!this.enabled || ++this.evalCount < this.evalEvery) return;
            this.evalCount = 0;
            const load = this.emaMs / this.budgetMs;
            let next = this.cur;
            if      (load > this.hi && this.cur > this.floor) next = Math.max(this.floor, this.cur - this.step);
            else if (load < this.lo && this.cur < this.ceil)  next = Math.min(this.ceil,  this.cur + this.step);
            if (next !== this.cur) this.cur = setMul(next);
        },
        setEnabled(on) {
            this.enabled = !!on;
            if (!this.enabled) this.cur = setMul(DEFAULT_MULTIPLE);   // OFF で既定 (20≈49MHz) に戻す
            else this.emaMs = 0;                        // ON で EMA を初期化し測り直す
            return this.enabled;
        },
        setManual(m) { this.enabled = false; this.cur = setMul(m); return this.cur; },  // 手動固定
    };

    // 既定クロックを ≈49MHz (multiple=20) に。np2kai_set_clock_multiple が np2cfg.multiple も書くので
    // 一度の適用で以後の Run (reset) でも保持される。local/worker 両モードで効く (emu 経由)。
    // ≈486DX2-50 相当。ちびおと(ADPCM)既定 ON 後も FMDSP 等で音が詰まらない安全側 (2026-06-27 実機確認)。
    emu.setClockMultiple(DEFAULT_MULTIPLE);

    window.qbDebug = {
        cs:     () => '0x' + (getCs(handle)       >>> 0).toString(16),
        linear: () => '0x' + (getLinearPc(handle) >>> 0).toString(16),
        pc:     () => `${window.qbDebug.cs()}:${window.qbDebug.linear()}`,
        // 診断ログ (自前 C 側の [tag] 逐次ログ) の表示切替。既定 OFF = console.debug (DevTools の Verbose
        // レベル送り = 既定非表示・captured)。verbose(1) で console.log 前面表示、verbose(0) で既定へ戻す。
        // ?debug / window.QB_VERBOSE = true でも同じ。ローカル経路は次のログから即反映。
        verbose: (on = 1) => { window.QB_VERBOSE = !!on;
            return `診断ログ ${on ? '前面表示 (console.log)' : '既定 (console.debug = Verbose 送り・captured)'} に切替`; },
        // HLE FEP (ホスト側日本語入力、未確定はゲスト画面内にインライン表示)。fep(1)=ON / fep(0)=OFF /
        // fep()=トグル。Ctrl+Space と同じ。M1 はローマ字→ひらがな + Space でカナ巡回 (スタブ変換、
        // Mozc-Wasm 差し替え予定)。Enter=確定 (SJIS 注入) / Esc=取消 / BS=編集。
        fep: (on) => fep
            ? `FEP ${(on === undefined ? fep.toggle() : fep.setActive(on)) ? 'ON' : 'OFF'} (Space=変換/Enter=確定/Esc=取消)`
            : 'fep.js 未ロード',
        // FEP 表示スタイルの A/B。wx=よみ白下線・注目白反転 (既定) / atok=よみ白反転・注目黄反転。
        // 次の表示更新 (キー 1 打) から反映。実画面で見比べて既定を決める (値は仮置き)。
        fepstyle: (name) => { if (name && FEP_STYLES[name]) fepStyleName = name;
            return `fepstyle=${fepStyleName} (wx=よみ下線/atok=よみ反転) — 次の表示更新から反映`; },
        // FM 音源エンジンの A/B 切替。fmgen(1)=fmgen(既定) / fmgen(0)=opngen。
        // 次の Run (reset) から反映 → 同じ FM ゲームを再実行して聴き比べる。
        fmgen:  (on=1) => `usefmgen=${setFmgen(on ? 1 : 0)} (1=fmgen/0=opngen) — 次の Run から反映。同じゲームを再実行して聴き比べてください`,
        // パート別音量バランスの live 調整 (症状②: リズムがメロより前に出すぎ)。各 0..128。
        // 引数なし = 現在値を表示。例: qbDebug.vol({rhythm: 80}) でリズムだけ引いて即聴き比べ
        // (reset 不要、鳴っている曲にそのまま反映)。次の Run でも維持されます (np2cfg を更新)。
        vol: (o) => {
            const cur = () => ({ fm: getVol(0), ssg: getVol(1), rhythm: getVol(2), adpcm: getVol(3), master: getVol(4) });
            if (o === undefined) return cur();
            const g = (k) => (o[k] === undefined ? -1 : (o[k] | 0));
            setVol(g('fm'), g('ssg'), g('rhythm'), g('adpcm'));
            return cur();
        },
        // BEEP (PC-98 内蔵ブザー = 多くのフリーソフトの効果音) の音量ブースト。x = 倍率 (1=素の np2kai)。
        // np2kai 標準の BEEP は peak 2048 (-24dBFS) で頭打ちのため FM/MIDI 楽曲の下で SE が埋もれる
        // (amel133 作者報告)。既定は 4 倍 (≈+12dB、BEEP peak ≈ MIDI 同等)。FM/MIDI/ADPCM には無影響
        // (patch 06 の BEEP 専用ゲイン = beepg.c レンダラ内で完結。旧 vol_master/vol_pcm 相殺
        // ハックは fmgen ADPCM を -10dB にする副作用があり 2026-07-05 撤去)。
        // 例: qbDebug.beepgain(4) で 4 倍、qbDebug.beepgain(1) で素の np2kai に戻して聴き比べ。
        // 全部 live 反映 (reset 不要)。純設定の上限は約 3.83 倍。
        beepgain: async (x = 4) => {
            const pct = Math.max(50, Math.min(383, Math.round(x * 100)));
            const got = await emu.setBeepGain(pct);
            return `beepgain=${(got / 100).toFixed(2)}x (${got}%) — live 反映`;
        },
        // 音声/エミュ進行の計測ハーネス。曲を再生しながら呼ぶと、症状①(揺れ・スキップ)が
        // 「音声コールバックの遅刻 (cbLate)」由来か「エミュの追いつけなさ (emuSaturated)」由来かを
        // 数値で切り分ける。引数 true でカウンタをリセット。本丸の規模 (AudioWorklet/Worker 化) を実測で決める。
        audioStats: (reset) => {
            const s = audioStats;
            const durS = Math.max((performance.now() - s.since) / 1000, 0.001);
            const out = {
                '計測時間': durS.toFixed(1) + 's',
                '─ 音声CB(メインスレッド) ─': '',
                'CB発火数': s.cb,
                '遅刻CB(>1.5x=スキップ疑い)': `${s.cbLate} (${(s.cbLate / durS).toFixed(2)}/s)`,
                '期待/最大間隔': `${s.cbExpectMs.toFixed(1)} / ${s.cbGapMaxMs.toFixed(1)} ms`,
                'fill 平均/最大': `${(s.fillSumMs / (s.cb || 1)).toFixed(2)} / ${s.fillMaxMs.toFixed(2)} ms`,
                '─ run_frame(rAF) ─': '',
                'rAF数': s.raf,
                'コマ落ち(>25ms)': `${s.rafSlowCount} (${(s.rafSlowCount / durS).toFixed(2)}/s)`,
                '最大rAF間隔': s.rafDtMaxMs.toFixed(1) + 'ms',
                'エミュ飽和(追いつけず)': `${s.emuSaturated} (${(s.emuSaturated / durS).toFixed(2)}/s)`,
                'FB変換 平均/最大': `${(s.fbSumMs / (s.raf || 1)).toFixed(2)} / ${s.fbMaxMs.toFixed(2)} ms`,
            };
            if (reset) {
                s.cb = s.cbLate = s.cbGapMaxMs = s.fillSumMs = s.fillMaxMs = s.lastCbMs = 0;
                s.raf = s.rafSlowCount = s.rafDtMaxMs = s.emuSaturated = s.fbSumMs = s.fbMaxMs = s.lastRafMs = 0;
                s.since = performance.now();
            }
            try { console.table(out); } catch (_) { console.log(out); }
            return out;
        },
        // 86 ボードの割り込み線の上書き。既定は全ブート IRQ12 (de-facto 標準)。snd86irq(0)=既定 IRQ へ、
        // snd86irq(1)=IRQ12 明示、snd86irq()=既定 (IRQ12) に戻す。設定後に対象ゲームを Run (reset) して反映。
        snd86irq: (v) => { forcePmdIrq = (v === undefined ? null : (v ? 1 : 0)); return `forcePmdIrq=${forcePmdIrq} (null=既定IRQ12/1=IRQ12/0=既定IRQ) — 次の Run から反映`; },
        // 「ちびおと」(PC-9801-86 + ADPCM RAM = SOUND_SW 0x14) のトグル。既定 OFF (素の 86=0x04)。
        // chibioto(1)=ON で FMP の .ovi / PMD の .PPC 等 ADPCM(PCM) 声部のある曲が鳴る。chibioto(0)/()=既定 OFF。
        // 設定後に対象を Run (reset) して反映。FM のみの曲には無影響なので付けっぱなしでも実害は小さい。
        chibioto: (on = 1) => { forceChibi = !!on; return `forceChibi=${forceChibi} (既定 ON。1=86+ADPCM/0=素の86) — 次の Run から反映`; },
        // ブート時の ITF (BIOS POST) 表示。既定はスキップ (メモリカウント+ピポ音なし=即プレイ)。
        // itfpost(1)=実機どおり POST を出す (ノスタルジー用)、itfpost(0)=既定どおりスキップ。
        // 設定後にゲーム/音楽を Run (reset) して反映。
        itfpost: (on = 1) => `ITF_WORK=${setItfPost(on ? 1 : 0)} (1=POST表示/0=スキップ) — 次の Run から反映`,
        // 仮想 30行BIOS。lines30(1)=30 行テキスト表示 (640×480) + 30BIOS-API を有効化、lines30(0)/()=既定 OFF (25 行)。
        // 実機 30行BIOS/30行計画 は ROM パッチ式で常駐できないので、その「常駐済み最終状態」を HLE が用意する。
        // 設定後に対象を Run (reset) して反映。詳細: docs/30line_spec.md。
        lines30: (on = 1) => `lines30=${setLines30(on ? 1 : 0)} (1=30行/0=25行) — 次の Run から反映`,
        // Y2K クランプ (RTC/DOS の年 20xx→1999 写像) のオン/オフ。既定 ON。90 年代の pre-Y2K タイトル
        // (蟹味噌等) が RTC/DOS 日付を 2 桁前提で扱い現在年 2026 で固定幅セーブを壊すのを防ぐシム。
        // y2k(0)=OFF で本当の日付を渡す (カレンダー/時計系ツール向け上級者オプション。OFF だと蟹味噌型は
        // 再びセーブが壊れる)。引数なし=現在値。ゲームは起動時に一度日付を読むので次の Run から反映が確実。
        y2k: (on) => { if (on !== undefined) setY2k(on ? 1 : 0);
            return `y2k_clamp=${getY2k()} (1=ON クランプ有効/0=OFF 本当の日付) — 次の Run 推奨`; },
        // async 自動クロック (快適化, **既定 OFF**)。autoclock(1)=ON で host の余裕に応じ multiple を
        // floor..ceil 内で自動調整 (達成フレーム時間から逆算)。autoclock(0)=OFF で既定 20≈49MHz 固定。
        // 既定 OFF の理由: 倍率を上げる利得は小さく音楽テンポがもたつく実害がある (上の autoClock 定義参照)。
        // 第2引数で ceil (上限倍率) を調整可: 例 autoclock(1, 30) で遷移をさらに緩く、(1, 60) で攻める。
        autoclock: (on=1, ceil) => {
            if (ceil !== undefined) autoClock.ceil = Math.max(autoClock.floor, ceil | 0);
            const en = autoClock.setEnabled(on ? 1 : 0);
            // ceil を下げた直後、現在値が上限超なら即座に従わせる。tick の上げ条件 (cur<ceil) /
            // 下げ条件 (高負荷) はどちらも発火しないので、ここで明示的にクランプしないと降りてこない。
            if (en && autoClock.cur > autoClock.ceil) autoClock.cur = setMul(autoClock.ceil);
            return en
                ? `autoclock ON — host 余裕に応じ multiple を ${autoClock.floor}..${autoClock.ceil} で自動調整 (現 ${autoClock.cur})。重い時は自動で下げて音切れを防ぎます`
                : `autoclock OFF — multiple=${DEFAULT_MULTIPLE} 固定 (≈49MHz)`;
        },
        // CPU クロック倍率の手動上書き (autoclock を OFF にして固定)。引数なしで現状表示。
        // 快適化の A/B 用 (例: qbDebug.multiple(42) で速さ・音切れを体感比較)。
        multiple: (m) => {
            if (m === undefined) return `multiple=${autoClock.cur} (autoclock ${autoClock.enabled ? 'ON' : 'OFF'})`;
            return `multiple=${autoClock.setManual(m)} に固定 (autoclock OFF)`;
        },
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
        // RS-MIDI 診断: シリアル(8251)へ流れた MIDI バイト数と、RS-MIDI→VERMOUTH ルーティングの生死。
        // active=false なら MIDI 無効 or VERMOUTH 未ロード (com_nc 落ち)。bytes が増えていれば MIDDRV が
        // 実際に送出している。bytes>0 かつ無音なら VERMOUTH 合成/freepats 側を疑う。
        midi: () => ({ active: !!midiActive(handle), bytes: midiBytes(handle) }),
        // GS システムエフェクト (reverb/chorus/delay) の on/off。ドライ⇄ウェットの聴き比べ用。
        // 既定 ON。例: qbDebug.midifx(0) で素のドライ音、qbDebug.midifx(1) で残響あり。
        midifx: (on) => { midiFxFn(on ? 1 : 0); return on ? 'GS effects ON' : 'GS effects OFF'; },
        // XMS/EMS 需要プローブ: 現タイトルが拡張メモリを要求した回数 (Run 毎リセット)。
        // xms=INT 2Fh AX=43xx / ems=INT 67h / emmOpen=EMMXXXX0 デバイス open。いずれも未実装で
        // 「無し」と応答済みなので、>0 なら XMS/EMS HLE の実装価値あり (= 640KB の壁に当たっている)。
        memprobe: () => ({ xms: memprobeFn(handle, 0), ems: memprobeFn(handle, 1), emmOpen: memprobeFn(handle, 2), mouse33: memprobeFn(handle, 3) }),
        // XMS (HIMEM 相当) HLE。引数なしで状態表示、xms(0|1) で有効/無効を切替 (次の Run/現状で反映)。
        // 既定 ON (= HIMEM ロード済の DOS を再現)。enabled/確保中ハンドル数/使用・空き KB を返す。
        xms: (on) => {
            if (on !== undefined) xmsEnableFn(handle, on ? 1 : 0);
            return { enabled: !!xmsStatFn(handle, 0), handles: xmsStatFn(handle, 1),
                     usedKB: (xmsStatFn(handle, 2) / 1024) | 0, freeKB: (xmsStatFn(handle, 3) / 1024) | 0 };
        },
        // INT 33h マウスドライバ HLE。引数なしで状態表示、mouse33('ms'|'nec'|0) でペルソナ切替/無効化。
        // 既定 MS 仕様 (corpus 実測より。NEC 前提タイトルは 'nec' へ)。実測正典は tools/mousetest/ 参照。
        mouse33: (mode) => {
            if (mode !== undefined)
                mouse33CtlFn(handle, mode === 'nec' ? 2 : mode === 'ms' ? 1 : (mode === 'off' || mode === 'none') ? 0 : mode ? 1 : 0);
            const m = mouse33StatFn(handle, 0);
            return { mode: ['off', 'ms', 'nec'][m] || m, calls: mouse33StatFn(handle, 1),
                     x: mouse33StatFn(handle, 2), y: mouse33StatFn(handle, 3),
                     buttons: mouse33StatFn(handle, 4), hidden: mouse33StatFn(handle, 5) };
        },
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
        },
        // 指定 row (既定 0) の内容変化を時系列で記録する。画面遷移時に row が「空白化(=クリア)」を
        // 通るかを捉えるための watcher。textVram と違い漢字セル(高位 bit7)を '#'、空白を ' ' で区別
        // するので「全部空白に戻った瞬間」が分かる。タイトル→本編 遷移で残留テキストがクリアされる
        // (= 我々が取りこぼしている) のか、メッセージのまま HUD を重ね書きするのかの最終判定用。
        // 使い方: qbDebug.watchTextRow(0, 30) を実行 → キーを押して本編へ進入 → 変化ログを見る。
        watchTextRow: (row = 0, durationSec = 30, intervalMs = 30) => {
            const decode = () => {
                let s = '';
                for (let c = 0; c < 80; c++) {
                    const lo = peek8(handle, 0xA0000 + (row * 80 + c) * 2) & 0xff;
                    const hi = peek8(handle, 0xA0000 + (row * 80 + c) * 2 + 1) & 0xff;
                    if (hi & 0x80) s += '#';
                    else if (lo >= 0x20 && lo < 0x7f) s += String.fromCharCode(lo);
                    else s += ' ';
                }
                return s.replace(/\s+$/, '');
            };
            let last = null;
            const t0 = performance.now();
            console.log(`[watchTextRow ${row}] 開始。今からキーを押して本編へ進めてください。`);
            const id = setInterval(() => {
                const v = decode();
                if (v !== last) {
                    const ms = (performance.now() - t0).toFixed(0);
                    console.log(`[+${ms}ms] row${row} = "${v}"${v === '' ? '  ← 空白化(クリア!)' : ''}`);
                    last = v;
                }
                if (performance.now() - t0 > durationSec * 1000) {
                    clearInterval(id);
                    console.log(`[watchTextRow] ${durationSec}s で停止。row${row} が一度でも "← 空白化" を通れば` +
                                ` ゲームはクリアを発行している (我々が取りこぼし)。通らず message→HUD なら ゲームが` +
                                ` クリアしない設計。`);
                }
            }, intervalMs);
            return `watching text row ${row} for ${durationSec}s — キーで本編へ進めてください`;
        }
    };

    // ---- worker モードの qbDebug 配線 ----
    // worker モード (既定) では M はスタブ (cwrap=noop) なので、上の qbDebug 定義は全部 0/no-op に
    // なってしまう。NP2kai 本体は worker スレッドにあるので、デバッグ面を実態に合わせて張り替える:
    //   - ライブ音源/クロック制御 (vol/fmgen/midifx/multiple/xms) は worker へ転送して**実際に効かせる**。
    //     setter は fire-and-forget で即値 (説明文字列) を返す。getter (vol()/midi()/memprobe()/xms()) は
    //     worker 往復になるので **Promise を返す** (コンソールでは await してください)。
    //   - 同期取得が要るメモリ/レジスタ/FS インスペクタ (cs/regs/dump/textVram/ls 等) は worker スレッド外
    //     から同期で引けないので、黙って 0 を返さず正直に「?local で」と案内する。
    if (QB_USE_WORKER) {
        const NA = () => '⚠ worker モードでは利用不可。?local を付けて再読み込みしてください ' +
                         '(メモリ/レジスタ/FS の同期参照は worker スレッド外から取得できないため)';
        const ctl = (fn, at, a, ph) => emu.ctl(fn, at, a, ph);
        const q   = (fn, ret, at, a, ph) => emu.query(fn, ret, at, a, ph);
        Object.assign(window.qbDebug, {
            // --- ライブ制御 (worker へ転送して実効) ---
            // 診断ログの表示切替 (worker 版)。printErr ルーティングは worker 内なので postMessage で転送。
            verbose: (on = 1) => { window.QB_VERBOSE = !!on; emu.setVerbose(on);
                return `診断ログ ${on ? '前面表示 (console.log)' : '既定 (console.debug = Verbose 送り・captured)'} に切替 (worker)`; },
            fmgen: (on = 1) => { ctl('np2kai_set_fmgen', ['number'], [on ? 1 : 0]);
                return `usefmgen=${on ? 1 : 0} (1=fmgen/0=opngen) — 次の Run から反映。同じゲームを再実行して聴き比べてください`; },
            itfpost: (on = 1) => { ctl('np2kai_set_itf_post', ['number'], [on ? 1 : 0]);
                return `ITF_WORK=${on ? 1 : 0} (1=POST表示/0=スキップ) — 次の Run から反映`; },
            lines30: (on = 1) => { ctl('np2kai_set_lines30', ['number'], [on ? 1 : 0]);
                return `lines30=${on ? 1 : 0} (1=30行/0=25行) — 次の Run から反映。詳細 docs/30line_spec.md`; },
            // Y2K クランプのオン/オフ。設定は fire-and-forget、現在値取得は worker 往復 (await してください)。
            y2k: (on) => {
                if (on !== undefined) ctl('np2kai_set_y2k_clamp', ['number'], [on ? 1 : 0]);
                return q('np2kai_get_y2k_clamp', 'number', [], [])
                    .then((v) => `y2k_clamp=${v} (1=ON クランプ有効/0=OFF 本当の日付) — 次の Run 推奨`);
            },
            vol: (o) => {
                if (o !== undefined) {
                    const g = (k) => (o[k] === undefined ? -1 : (o[k] | 0));
                    ctl('np2kai_set_vol', ['number', 'number', 'number', 'number'], [g('fm'), g('ssg'), g('rhythm'), g('adpcm')]);
                }
                return Promise.all([0, 1, 2, 3, 4].map(i => q('np2kai_get_vol', 'number', ['number'], [i])))
                    .then(([fm, ssg, rhythm, adpcm, master]) => ({ fm, ssg, rhythm, adpcm, master }));   // await してください
            },
            midifx: (on) => { ctl('np2kai_debug_midi_fx', ['number'], [on ? 1 : 0]); return on ? 'GS effects ON' : 'GS effects OFF'; },
            multiple: (m) => {
                if (m === undefined) return `multiple=${autoClock.cur} (worker: 手動固定のみ・autoclock 非対応)`;
                autoClock.enabled = false; autoClock.cur = m | 0;
                ctl('np2kai_set_clock_multiple', ['number'], [m | 0]);
                return `multiple=${m | 0} に固定 (worker)`;
            },
            autoclock: () => '⚠ worker モードでは autoclock 非対応 (フレームペースは worker が管理)。' +
                             '倍率を上げたいときは qbDebug.multiple(N) で固定してください',
            midi: () => Promise.all([
                q('np2kai_debug_serial_midi_active', 'number', ['number'], [], true),
                q('np2kai_debug_serial_midi_bytes',  'number', ['number'], [], true),
            ]).then(([a, b]) => ({ active: !!a, bytes: b })),
            memprobe: () => Promise.all([0, 1, 2, 3].map(i => q('np2kai_debug_memprobe', 'number', ['number', 'number'], [i], true)))
                .then(([xms, ems, emmOpen, mouse33]) => ({ xms, ems, emmOpen, mouse33 })),
            xms: (on) => {
                if (on !== undefined) ctl('np2kai_xms_enable', ['number'], [on ? 1 : 0], true);
                return Promise.all([0, 1, 2, 3].map(i => q('np2kai_xms_stat', 'number', ['number', 'number'], [i], true)))
                    .then(([en, handles, used, free]) => ({ enabled: !!en, handles, usedKB: (used / 1024) | 0, freeKB: (free / 1024) | 0 }));
            },
            mouse33: (mode) => {
                if (mode !== undefined)
                    ctl('np2kai_mouse33_ctl', ['number'], [mode === 'nec' ? 2 : mode === 'ms' ? 1 : (mode === 'off' || mode === 'none') ? 0 : mode ? 1 : 0], true);
                return Promise.all([0, 1, 2, 3, 4, 5].map(i => q('np2kai_mouse33_stat', 'number', ['number', 'number'], [i], true)))
                    .then(([m, calls, x, y, buttons, hidden]) =>
                        ({ mode: ['off', 'ms', 'nec'][m] || m, calls, x, y, buttons, hidden }));
            },
            // --- 同期取得インスペクタ (worker 外から引けない → 正直に案内) ---
            cs: NA, linear: NA, pc: NA, regs: NA, dump: NA, dumpHere: NA,
            gdcMode1: NA, textdisp: NA, grphdisp: NA, int21Stats: NA, int21Reset: NA,
            sample: NA, textVram: NA, watchTextdisp: NA, watchTextRow: NA,
            fs: undefined, ls: NA, read: NA, readSize: NA,
            audioStats: () => '⚠ worker モードの音声/フレーム計測は未対応 (計測は worker スレッド内で行われます)',
        });
    }

    // ウィンドウフォーカス喪失/タブ非表示時に全キーを解放 (スタックキー防止)。
    // キーボード (pressed) とゲームパッド (padPressed) の両方 — パッドは rAF 停止中に
    // エッジ検出が走らないので、ここで解放しないと押しっぱなしがゲストに残る。
    window.addEventListener('blur', () => { releaseHeldKeys(); releasePadKeys(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { releaseHeldKeys(); releasePadKeys(); }
    });

    // Output parameter slots for np2kai_get_framebuffer
    const pW   = M._malloc(4);
    const pH   = M._malloc(4);
    const pBpp = M._malloc(4);

    // RGB565 → RGBA8888 LUT (65536 × 4 byte = 256KB)。
    // 旧実装は per-pixel で 4 つのビット演算 + 4 つの代入 = 640×400 で
    // 5-15ms / frame を主スレッドで消費していた。LUT 1 回引きに置き換えて
    // ~1-2ms に短縮し、その分を run_frame の余裕に回す。
    // little-endian 前提で Uint32 を直接書く (RGBA バイト並び = AABBGGRR)。
    const RGB565_LUT = new Uint32Array(65536);
    for (let p = 0; p < 65536; p++) {
        const r = ((p >> 11) & 0x1f) << 3;
        const g = ((p >>  5) & 0x3f) << 2;
        const b = ( p        & 0x1f) << 3;
        RGB565_LUT[p] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }

    // framebuffer (w×h、bpp=2:RGB565 / 4:RGBA、bytes=ソースバイト列) を canvas に描く。両モード共通の
    // 描画 (DOM・メインスレッド)。local は M.HEAPU8 の subarray、worker は postMessage のバイト列を渡す。
    // emu.start(onFrame) の onFrame コールバックとして使う。
    function drawFrame(w, h, bpp, bytes) {
        if (w <= 0 || h <= 0) return;
        if (offscreen.width !== w || offscreen.height !== h) {
            offscreen.width = w; offscreen.height = h; fitCanvas(w, h);
        }
        const imgData = offCtx.createImageData(w, h);
        const dst = imgData.data;
        if (bpp === 2) {
            const src = new Uint16Array(bytes.buffer, bytes.byteOffset, w * h);
            const dst32 = new Uint32Array(dst.buffer);
            for (let i = 0; i < w * h; i++) dst32[i] = RGB565_LUT[src[i]];
        } else if (bpp === 4) {
            dst.set(new Uint8Array(bytes.buffer, bytes.byteOffset, w * h * 4));
        }
        offCtx.putImageData(imgData, 0, 0);
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);   // 物理 px へ nearest 拡大
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
    emu.onAudioActive = markAudioActive;   // 音が鳴り始めたら音楽プレイヤーの計時を開始 (worker は audioActive msg 経由)
    emu.start(drawFrame);   // 駆動ループ開始 (loop 本体は emu.start に移設・モード固有)

    // ---- 設定コントロールパネル (2026-07-04) ----
    // qbDebug の厳選をコンソール無しで触る GUI。適用は必ず window.qbDebug.* 経由 (worker/ローカル両対応の
    // 既存制御面を再利用し、await Promise.resolve で sync/async 差を吸収)。既定値は「レイヤ方式」で再適用
    // しない = localStorage(quubee_settings_v1) に保存された項目だけを起動時に適用し、未変更は native 既定の
    // まま (新規ブラウザ = 適用ゼロ = 現状と完全一致)。ライトモードは applyTheme で <html> に data-theme。
    (function setupSettings() {
        const gear = document.getElementById('settings-toggle');
        if (!settingsModalEl || !gear) return;
        const el = (id) => document.getElementById(id);
        const qd = window.qbDebug;
        const VOL_PARTS = ['fm', 'ssg', 'rhythm', 'adpcm'];
        // CPU クロック表示: multiple × baseclock 2.4576MHz (例: ×20≈49MHz=486DX2-50 相当)。目安なので四捨五入。
        const mulLabel = (m) => '×' + (m | 0) + ' ≈' + Math.round((m | 0) * 2.4576) + 'MHz';

        const SETTINGS_KEY = 'quubee_settings_v1';
        const loadSettings = () => { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); return (s && typeof s === 'object') ? s : {}; } catch (_) { return {}; } };
        let settings = loadSettings();
        const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {} };

        // 表示用の既定値 (getter の無い設定の初期表示に使う。native の実既定と一致させること)。
        const DEFAULTS = { fmgen: 1, beepgain: 3.83, chibioto: 1, midifx: 1, multiple: 20,
                           lines30: 0, itfpost: 0, y2k: 1, mouse33: 'ms', verbose: 0, theme: 'dark' };
        const get = (k) => (k in settings ? settings[k] : DEFAULTS[k]);

        const applyTheme = (t) => { document.documentElement.dataset.theme = (t === 'light') ? 'light' : ''; };
        // Gamepad 割当の適用 (localStorage → padDir/padBtnMap)。pollGamepads がこれを live 参照する。
        const applyPad = (p) => {
            if (!p || typeof p !== 'object') return;
            if (p.dir === 'arrow' || p.dir === 'tenkey') padDir = p.dir;
            if (p.buttons) for (const b of PAD_BUTTONS) { const k = p.buttons[b.idx]; if (k != null && (k === 'none' || PAD_KEYS[k] !== undefined)) padBtnMap[b.idx] = k; }
        };

        // 設定キー → 適用関数 (qbDebug 経由)。await Promise.resolve でローカル同期・worker Promise を吸収。
        const APPLY = {
            vol:      (v) => qd.vol(v),
            fmgen:    (v) => qd.fmgen(v ? 1 : 0),
            beepgain: (v) => qd.beepgain(v),
            chibioto: (v) => qd.chibioto(v ? 1 : 0),
            midifx:   (v) => qd.midifx(v ? 1 : 0),
            multiple: (v) => qd.multiple(v | 0),
            lines30:  (v) => qd.lines30(v ? 1 : 0),
            itfpost:  (v) => qd.itfpost(v ? 1 : 0),
            y2k:      (v) => qd.y2k(v ? 1 : 0),
            mouse33:  (v) => qd.mouse33(v),
            verbose:  (v) => qd.verbose(v ? 1 : 0),
            theme:    (v) => applyTheme(v),
            pad:      (v) => applyPad(v),
        };
        const applyOne = (k, v) => { const f = APPLY[k]; return f ? Promise.resolve().then(() => f(v)).catch(() => {}) : Promise.resolve(); };

        // 起動時復元: 保存済みキーだけ適用 (未保存 = native 既定のまま = 現状一致)。theme は head 先読み済みだが再適用は no-op。
        (async () => { for (const k of Object.keys(settings)) await applyOne(k, settings[k]); })();

        // ---- パネル配線 ----
        // 変更 → settings 更新 → 適用 → 保存。
        function change(k, v) { settings[k] = v; applyOne(k, v); saveSettings(); }
        function volChange() {
            const vol = {};
            for (const p of VOL_PARTS) { const v = el('set-vol-' + p).value | 0; vol[p] = v; el('val-vol-' + p).textContent = v; }
            change('vol', vol);
        }

        // 現在値をコントロールへ反映 (開くたび)。vol は getter があるので保存が無ければ native 読み戻し。
        async function refresh() {
            let vol = settings.vol;
            if (!vol) { try { vol = await qd.vol(); } catch (_) { vol = null; } }
            for (const p of VOL_PARTS) { const v = (vol && vol[p] != null) ? (vol[p] | 0) : 128; el('set-vol-' + p).value = v; el('val-vol-' + p).textContent = v; }
            el('set-fmgen').value = String(get('fmgen') ? 1 : 0);
            const bg = Number(get('beepgain')); el('set-beepgain').value = Math.round(bg * 100); el('val-beepgain').textContent = bg.toFixed(2) + 'x';
            el('set-chibioto').checked = !!get('chibioto');
            el('set-midifx').checked = !!get('midifx');
            const mul = get('multiple') | 0; el('set-multiple').value = mul; el('val-multiple').textContent = mulLabel(mul);
            el('set-lines30').checked = !!get('lines30');
            el('set-itfpost').checked = !!get('itfpost');
            el('set-y2k').checked = !!get('y2k');
            el('set-mouse33').value = get('mouse33');
            el('set-verbose').checked = !!get('verbose');
            el('set-theme').checked = (get('theme') === 'light');
            syncPadUI();
        }

        for (const p of VOL_PARTS) el('set-vol-' + p).addEventListener('input', volChange);
        el('set-fmgen').addEventListener('change', (e) => change('fmgen', e.target.value === '1' ? 1 : 0));
        el('set-beepgain').addEventListener('input', (e) => { const x = (e.target.value | 0) / 100; el('val-beepgain').textContent = x.toFixed(2) + 'x'; change('beepgain', x); });
        el('set-chibioto').addEventListener('change', (e) => change('chibioto', e.target.checked ? 1 : 0));
        el('set-midifx').addEventListener('change', (e) => change('midifx', e.target.checked ? 1 : 0));
        el('set-multiple').addEventListener('input', (e) => { const m = e.target.value | 0; el('val-multiple').textContent = mulLabel(m); change('multiple', m); });
        el('set-lines30').addEventListener('change', (e) => change('lines30', e.target.checked ? 1 : 0));
        el('set-itfpost').addEventListener('change', (e) => change('itfpost', e.target.checked ? 1 : 0));
        el('set-y2k').addEventListener('change', (e) => change('y2k', e.target.checked ? 1 : 0));
        el('set-mouse33').addEventListener('change', (e) => change('mouse33', e.target.value));
        el('set-verbose').addEventListener('change', (e) => change('verbose', e.target.checked ? 1 : 0));
        el('set-theme').addEventListener('change', (e) => change('theme', e.target.checked ? 'light' : 'dark'));

        // ---- Gamepad グループ (方向モード切替 + ボタン→キー割当 + 押下 live 表示) ----
        const rowsEl = el('pad-rows');
        for (const b of PAD_BUTTONS) {                       // ボタン行を生成 (ラベル + 割当キー select)
            const row = document.createElement('div'); row.className = 'pad-row'; row.dataset.btn = b.idx;
            const lab = document.createElement('span'); lab.className = 'pad-btn-label'; lab.textContent = b.label;
            const sel = document.createElement('select'); sel.dataset.btn = b.idx;
            for (const kid of [...Object.keys(PAD_KEYS), 'none']) {
                const opt = document.createElement('option'); opt.value = kid; opt.textContent = PAD_KEY_LABEL[kid]; sel.appendChild(opt);
            }
            sel.value = padBtnMap[b.idx];
            sel.addEventListener('change', () => { padBtnMap[b.idx] = sel.value; savePad(); });
            row.appendChild(lab); row.appendChild(sel); rowsEl.appendChild(row);
        }
        function savePad() { settings.pad = { dir: padDir, buttons: { ...padBtnMap } }; saveSettings(); }
        function syncPadUI() {
            const dsel = el('set-pad-dir'); if (dsel) dsel.value = padDir;
            for (const b of PAD_BUTTONS) { const s = rowsEl.querySelector('select[data-btn="' + b.idx + '"]'); if (s) s.value = padBtnMap[b.idx]; }
        }
        function resetPadState() { padDir = 'arrow'; PAD_BUTTONS.forEach((b) => { padBtnMap[b.idx] = b.def; }); syncPadUI(); }
        el('set-pad-dir').addEventListener('change', (e) => { padDir = (e.target.value === 'tenkey') ? 'tenkey' : 'arrow'; savePad(); });
        el('pad-reset').addEventListener('click', () => { resetPadState(); delete settings.pad; saveSettings(); });

        // 押下ボタンの live 表示 (パネル表示中だけ rAF)。物理ボタンを光らせてラベル無しパッドでも特定できる。
        const padConnected = () => { if (!navigator.getGamepads) return false; for (const gp of navigator.getGamepads()) if (gp && gp.connected) return true; return false; };
        function updatePadLive() {
            const liveEl = el('pad-live');
            rowsEl.querySelectorAll('.pad-row').forEach((r) => r.classList.toggle('hot', (r.dataset.btn | 0) === padLive));
            if (!padConnected()) { liveEl.textContent = 'パッド未接続 / no gamepad'; liveEl.classList.remove('on'); return; }
            if (padLive >= 0) { const b = PAD_BUTTONS.find((x) => x.idx === padLive); liveEl.textContent = '今押したボタン / pressed: ' + (b ? b.label : padLive); liveEl.classList.add('on'); }
            else { liveEl.textContent = 'ボタンを押すと光ります / press a button'; liveEl.classList.remove('on'); }
        }
        let padUiRaf = 0;
        function padUiLoop() { if (settingsModalEl.hidden) { padUiRaf = 0; return; } updatePadLive(); padUiRaf = requestAnimationFrame(padUiLoop); }

        // 開閉。開くとき releaseHeldKeys で押しっぱなし防止 + 現在値反映。ゲームは背後で continue (live 聴き比べ)。
        let initialVol = null;   // Reset 用に native 既定 vol を初回だけキャプチャ
        async function open() {
            if (initialVol === null) { try { initialVol = await qd.vol(); } catch (_) { initialVol = {}; } }
            releaseHeldKeys();
            await refresh();
            settingsModalEl.hidden = false;
            if (!padUiRaf) padUiLoop();       // 押下ボタンの live 表示を開始 (閉じると自ら停止)
        }
        const close = () => { settingsModalEl.hidden = true; };
        gear.addEventListener('click', open);
        el('settings-done').addEventListener('click', close);
        el('settings-close').addEventListener('click', close);
        settingsModalEl.addEventListener('mousedown', (e) => { if (e.target === settingsModalEl) close(); });

        // Reset: 既定へ戻す (明示操作なので既定適用してよい)。vol は初回キャプチャした native 既定へ。
        el('settings-reset').addEventListener('click', async () => {
            settings = {}; saveSettings();
            if (initialVol && Object.keys(initialVol).length) await applyOne('vol', initialVol);
            for (const k of Object.keys(DEFAULTS)) await applyOne(k, DEFAULTS[k]);
            resetPadState();                  // パッド割当も既定へ (settings は既に {} = pad も消去済み)
            await refresh();
        });
    })();

    // ---- 下部ツールバー: テキスト入力 (IME 可) を DOS 文字入力へ注入 (2026-06-21) ----
    // FEP を持ち込まず、ブラウザ/OS の IME (や直接タイプ) で打った文字列を Shift-JIS にしてゲストへ注入する。
    // ✎ トグルで入力欄を出し、IME で打って Enter で送信。入力欄にフォーカス中は inField ガードで
    // 通常キーがゲストへ行かない = 二重入力なし。エディタ (VZ/みゅあっぷ等) に流し込める。
    // 例外として、欄が空・変換中でないときの矢印/BS/DEL/Enter/Home/PageUp/PageDown/Insert は
    // imePassThrough でゲストへ透過する (空欄ではどれも欄内編集として無意味なので、欄を構えたまま
    // メニュー移動・決定やエディタのカーソル操作ができる)。
    // 入力欄は #stage 下部の通常フロー (index.html #input-bar) なので、将来ソフトキーボードやバーチャル
    // パッドもこのツールバーへ自然に足せる。
    (function setupImeInput() {
        const toggle = document.getElementById('ime-toggle');
        const inp    = document.getElementById('ime-input');
        if (!toggle || !inp) return;
        let composing = false;
        inp.addEventListener('compositionstart', () => { composing = true; });
        inp.addEventListener('compositionend',   () => { composing = false; });
        inp.addEventListener('keydown', (e) => {
            // Tab は欄からフォーカスを逃がさない (既定のフォーカス移動を止める)。空欄ならグローバル
            // 透過が実 Tab スキャンコード(0x0f)をゲストへ送り、文字ありなら no-op で欄に留まるだけ。
            // 変換中は IME の候補選択に使われ得るので触らない。
            if (e.key === 'Tab' && !composing) { e.preventDefault(); return; }
            // Enter は「文字あり = SJIS 文字列を送信」だけをここで担う。空欄 Enter は下のグローバル
            // 透過に委ね、実 Enter スキャンコード(0x1c)としてゲストへ届く (injectText(CR) より上位互換:
            // BIOS キーバッファに CR が入るのは同じで、加えて生スキャンコードを読むゲームにも届く)。
            if (e.key !== 'Enter' || composing) return;   // IME 変換確定の Enter は送信に使わない
            if (!inp.value) return;                       // 空欄 Enter → グローバル透過 (keyDown 0x1c) に委ねる
            e.preventDefault();
            e.stopPropagation();                          // 送信したら透過経路へ渡さない (二重 Enter 防止)
            emu.injectText(encodeSjis(inp.value));
            inp.value = '';
        });
        toggle.addEventListener('click', () => {
            const show = !inp.classList.contains('show');
            inp.classList.toggle('show', show);
            toggle.classList.toggle('on', show);
            // ボタンにフォーカスを残さない: 残るとブラウザが Enter/Space を「ボタンのクリック」と解釈して
            // 再トグルし、閉じたつもりが Enter で入力欄へ戻ってしまう。開いたら入力欄へ、閉じたら
            // フォーカスをゲーム (body) へ返し、以後のキーは通常どおりゲストへ届く。
            toggle.blur();
            if (show) inp.focus();
        });
    })();

})().catch(function (e) {
    showFatal('QuuBee init error: ' + e);
    console.error(e);
});
