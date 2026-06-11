#!/usr/bin/env node
// 東方旧作体験版 4 作 (TH02 封魔録 / TH03 夢時空 / TH04 幻想郷 / TH05 怪綺談) の headless e2e 回帰。
// 2026-06-11 マイルストーン「公式配布書庫そのまま・MS-DOS / NEC BIOS 不使用でブラウザ動作」のガード。
//
// 経路はブラウザの Run と同一:
//   - TH02 (通常 LZH): huma_ts2.lzh を archive.js (自前 LZH デコーダ) で展開 → /run へ SJIS 生バイト
//     (latin1) 名で配置 → 実 GAME.BAT を errorlevel 分岐インタプリタ (batscript.buildStatements →
//     serializeStatements → np2kai_dos_stage_batch) で起動 → 描画到達を確認
//   - TH03-05 (自己展開 .exe): SFX をゲスト内で実行して自己展開 (Y/Enter を散発注入) →
//     生成ファイル名が SJIS 正準形 (latin1・U+FFFD 無し) であることを検証 → GAME.BAT を同経路で
//     起動 → 描画到達を確認
//
// 守っている根治 (詳細 CHANGELOG 2026-06-09〜11):
//   AH=63h DBCS 表 / EXEC の FCB parse / SJIS 名 open・find の正準形 (fs_path_utf8 シム) /
//   AH=4Bh AL=03 Load Overlay / .bat errorlevel 分岐インタプリタ / DOS CON 0:0712h 初期化 /
//   合成 SFT (pmd86 install-check)
//
// corpus は local 限定 (.gitignore /games/*)。不在は SKIP (CI 安全)。
// 使い方: node tools/touhou_test.js [filter]   filter= "th03" 等の部分一致で対象を絞る

const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const FONT = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const TOUHOU = path.join(ROOT, 'games', 'touhou');
const FILTER = (process.argv[2] || '').toLowerCase();

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (bash tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT)) skip('font.bmp 不在');
if (!fs.existsSync(TOUHOU)) skip('games/touhou 不在 (local-only corpus)');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const bat = require(path.join(WEB, 'player', 'batscript.js'));
const archive = require(path.join(WEB, 'player', 'archive.js'));

const GAMES = [
    { id: 'th02', title: '東方封魔録', kind: 'lzh', file: 'huma_ts2.lzh' },
    { id: 'th03', title: '東方夢時空', kind: 'sfx', file: 'yume_ts2.exe' },
    { id: 'th04', title: '東方幻想郷', kind: 'sfx', file: 'gen_ts1.exe' },
    { id: 'th05', title: '東方怪綺談', kind: 'sfx', file: 'kai_ts1.exe' },
];

const EXTRACT_FRAMES = 6000;   // SFX 自己展開の上限
const RUN_FRAMES = 5000;       // GAME.BAT 起動後の観測フレーム数
const SAMPLE_AT = [1500, 2500, 3500, 4500];

async function newMachine() {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {},
        printErr: (s) => { if (process.env.TRACE) process.stderr.write('[err] ' + s + '\n'); } });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    return {
        M, handle,
        runFrame: M.cwrap('np2kai_run_frame', null, ['number']),
        getExit: M.cwrap('np2kai_dos_get_exit', 'number', ['number']),
        getFB: M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']),
        keyDown: M.cwrap('np2kai_key_down', null, ['number', 'number']),
        keyUp: M.cwrap('np2kai_key_up', null, ['number', 'number']),
        linPc: M.cwrap('np2kai_debug_get_linear_pc', 'number', ['number']),
        wP: M._malloc(4), hP: M._malloc(4), bP: M._malloc(4),
    };
}

function insertAndReset(mc) {
    mc.M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [mc.handle, '/tmp/loader.d88', 0, 0]);
    mc.M.ccall('np2kai_reset', null, ['number'], [mc.handle]);
}

function fbSample(mc) {
    const ptr = mc.getFB(mc.handle, mc.wP, mc.hP, mc.bP);
    const w = mc.M.HEAP32[mc.wP >> 2], h = mc.M.HEAP32[mc.hP >> 2];
    if (!ptr || w <= 0 || h <= 0) return { colors: 0, hash: 0 };
    const base = ptr >> 1, n = w * h, set = new Set(); let hash = 0;
    for (let i = 0; i < n; i += 17) { const px = mc.M.HEAPU16[base + i]; set.add(px); hash = (hash + px * (i + 1)) >>> 0; }
    return { colors: set.size, hash };
}

function runNames(M) {
    return M.FS.readdir('/run').filter((n) => n !== '.' && n !== '..');
}

// 名前の正準形チェック: 全コードポイント <= 0xFF (latin1=SJIS 生バイト)、U+FFFD 無し。
function checkCanonicalNames(names) {
    let sjis = 0, bad = 0;
    for (const n of names) {
        const cp = [...n].map((c) => c.codePointAt(0));
        if (cp.some((c) => c > 0xFF) || n.includes('�')) bad++;
        else if (cp.some((c) => c >= 0x80)) sjis++;
    }
    return { sjis, bad };
}

// SFX 自己展開: ゲスト内で SFX .exe を走らせ、確認入力 (Y/Enter) を散発注入して exit まで回す。
function runSfxExtract(mc, exeName, exeBytes) {
    const { M, handle } = mc;
    M.FS.writeFile('/run/' + exeName, exeBytes);
    const ptr = M._malloc(exeBytes.length); M.HEAPU8.set(exeBytes, ptr);
    const r = M.ccall('np2kai_dos_stage_exe', 'number',
        ['number', 'number', 'string', 'string'], [ptr, exeBytes.length, '', exeName]);
    M._free(ptr);
    if (r !== 0) return { ok: false, why: 'stage_exe r=' + r };
    insertAndReset(mc);
    const PRESS_AT = new Map([[600, 0x15], [900, 0x1c], [1500, 0x15], [1800, 0x1c],
                              [2400, 0x15], [2700, 0x1c], [3600, 0x15], [3900, 0x1c]]);
    let held = -1, heldUntil = 0;
    for (let f = 0; f < EXTRACT_FRAMES; f++) {
        if (PRESS_AT.has(f)) { held = PRESS_AT.get(f); mc.keyDown(handle, held); heldUntil = f + 4; }
        if (held >= 0 && f >= heldUntil) { mc.keyUp(handle, held); held = -1; }
        mc.runFrame(handle);
        if (mc.getExit(0)) return { ok: true, frames: f };
    }
    return { ok: false, why: '抽出が ' + EXTRACT_FRAMES + ' フレームで完走せず (pc=0x' +
        (mc.linPc(handle) >>> 0).toString(16) + ')' };
}

// 実 GAME.BAT を分岐インタプリタ経路でステージし、描画到達を観測する。
function runGameBat(mc) {
    const { M, handle } = mc;
    const names = runNames(M);
    const batName = names.find((n) => n.toLowerCase() === 'game.bat');
    if (!batName) return { ok: false, why: 'GAME.BAT 不在 (files=' + names.length + ')' };
    const recipe = bat.parse(M.FS.readFile('/run/' + batName));
    const stmts = bat.buildStatements(recipe, names, '');
    if (!stmts) return { ok: false, why: 'buildStatements null (未対応構文)' };
    const prog = Buffer.from(bat.serializeStatements(stmts), 'latin1');
    const ptr = M._malloc(prog.length); M.HEAPU8.set(prog, ptr);
    const r = M.ccall('np2kai_dos_stage_batch', 'number',
        ['number', 'number', 'string'], [ptr, prog.length, 'GAME.BAT']);
    M._free(ptr);
    if (r !== 0) return { ok: false, why: 'stage_batch r=' + r };
    insertAndReset(mc);

    const samples = [];
    let exited = 0, exitFrame = -1;
    const sampleSet = new Set(SAMPLE_AT);
    for (let f = 0; f < RUN_FRAMES; f++) {
        mc.runFrame(handle);
        if (sampleSet.has(f)) samples.push({ f, ...fbSample(mc) });
        if (mc.getExit(0)) { exited = 1; exitFrame = f; break; }
    }
    const last = samples[samples.length - 1];
    const rendered = !!last && last.colors >= 8;
    const animated = samples.length >= 2 && new Set(samples.map((s) => s.hash)).size > 1;
    return { ok: rendered && !exited, rendered, animated, exited, exitFrame,
        stmts: stmts.length, colors: samples.map((s) => s.colors).join('/'),
        why: exited ? '途中終了 (frame ' + exitFrame + ')' : (rendered ? '' : '描画未到達') };
}

async function runOne(g) {
    const src = path.join(TOUHOU, g.file);
    if (!fs.existsSync(src)) return { id: g.id, verdict: 'SKIP', detail: g.file + ' 不在' };
    const mc = await newMachine();
    let detail = '';

    if (g.kind === 'lzh') {
        const entries = archive.parseLzh(new Uint8Array(fs.readFileSync(src)));
        let staged = 0;
        for (const e of entries) {
            if (!e.data) continue;
            const base = e.name.split(/[\\\/]/).pop();
            if (!base) continue;
            mc.M.FS.writeFile('/run/' + base, e.data);
            staged++;
        }
        if (!staged) return { id: g.id, verdict: 'FAIL', detail: 'LZH 展開 0 ファイル' };
        detail += 'lzh=' + staged + '本 ';
    } else {
        const r = runSfxExtract(mc, g.file.toUpperCase(), new Uint8Array(fs.readFileSync(src)));
        if (!r.ok) return { id: g.id, verdict: 'FAIL', detail: 'SFX: ' + r.why };
        const names = runNames(mc.M);
        const { sjis, bad } = checkCanonicalNames(names);
        detail += `sfx=${names.length}本(f${r.frames}) sjis名=${sjis} `;
        if (bad) return { id: g.id, verdict: 'FAIL', detail: detail + `壊れ名=${bad} (正準形違反)` };
    }

    const g2 = runGameBat(mc);
    detail += `stmts=${g2.stmts || '-'} colors=${g2.colors || '-'} animated=${!!g2.animated}`;
    if (!g2.ok) return { id: g.id, verdict: 'FAIL', detail: detail + ' — ' + g2.why };
    return { id: g.id, verdict: 'PASS', detail };
}

(async () => {
    const targets = GAMES.filter((g) => !FILTER || (g.id + g.title + g.file).toLowerCase().includes(FILTER));
    if (!targets.length) skip('filter "' + FILTER + '" に一致なし');
    const results = [];
    for (const g of targets) {
        process.stdout.write(`${g.id} ${g.title} (${g.file}) ... `);
        const t0 = Date.now();
        let r;
        try { r = await runOne(g); }
        catch (e) { r = { id: g.id, verdict: 'FAIL', detail: 'exception: ' + (e && e.message) }; }
        console.log(`${r.verdict}  ${r.detail}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
        results.push(r);
    }
    const fails = results.filter((r) => r.verdict === 'FAIL');
    console.log('----');
    console.log(`touhou_test: ${results.filter((r) => r.verdict === 'PASS').length} PASS / ` +
        `${fails.length} FAIL / ${results.filter((r) => r.verdict === 'SKIP').length} SKIP`);
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
