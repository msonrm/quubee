#!/usr/bin/env node
// LIO GCIRCLE 円弧 + 楕円 回帰テスト (patch 05_lio_gcircle_arc)。
// --------------------------------------------------------------------------------------------
// NP2kai コアの lio_gcircle は真円しか描けず、円弧 (扇) と楕円が未対応だった
// (開始/終了角 sx/sy/ex/ey と flag を無視・rx!=ry で早期 return)。
// テスター提供の LIO 描画テスト liotest.zip (T1=GCIRCLE 円弧の扇 / T2=真円+楕円+塗り) を
// headless で走らせ、円弧の扇と楕円がフレームバッファに現れることを画素で確認する。
//
// 正典参照: T1 = np21w の「同心円弧+放射線の扇」(マゼンタ/緑)、T2 = DOSBox-X PC-98 の
//   緑真円 / 赤い大楕円弧 / 黄色い細楕円。塗り (flag&0x60) は scope 外 (GPAINT 未実装) なので
//   本テストは「輪郭が出ること」だけを assert する。
//
// corpus/フィクスチャは local 限定 (.gitignore /games/*)。不在は SKIP (CI 安全)。
const fs = require('fs'), path = require('path'), os = require('os');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const ZIP = path.join(ROOT, 'games/liotest.zip');
const DIR = path.join(ROOT, 'games/liotest');           // 展開済みでも可
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (bash tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT)) skip('font.bmp 不在');

// T1.EXE / T2.EXE の在り処を確定 (展開済みディレクトリ優先、無ければ zip を展開)。
let src = null;
if (fs.existsSync(path.join(DIR, 'T1.EXE'))) {
    src = DIR;
} else if (fs.existsSync(ZIP)) {
    src = fs.mkdtempSync(path.join(os.tmpdir(), 'liotest-'));
    try { execSync(`unzip -oq ${JSON.stringify(ZIP)} -d ${JSON.stringify(src)}`); }
    catch (e) { skip('unzip 失敗 (' + e.message + ')'); }
}
if (!src || !fs.existsSync(path.join(src, 'T1.EXE'))) skip('games/liotest(.zip) 不在 (local-only)');

async function run(exe, frames, enter) {
    const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const h = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}
    for (const nb of fs.readdirSync(src, { encoding: 'buffer' })) {
        try { M.FS.writeFile('/run/' + nb.toString('latin1'),
            new Uint8Array(fs.readFileSync(Buffer.concat([Buffer.from(src + '/'), nb])))); } catch (_) {}
    }
    const bin = new Uint8Array(fs.readFileSync(path.join(src, exe)));
    const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
    const r = M.ccall('np2kai_dos_stage_exe', 'number', ['number', 'number', 'string', 'string'],
        [ptr, bin.length, '', exe.toUpperCase()]); M._free(ptr);
    if (r !== 0) throw new Error(exe + ' stage ' + r);
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [h]);
    const rf = M.cwrap('np2kai_run_frame', null, ['number']);
    const kd = M.cwrap('np2kai_key_down', null, ['number', 'number']);
    const ku = M.cwrap('np2kai_key_up', null, ['number', 'number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const getFB = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
    const RET = 0x1c;
    for (let f = 0; f < frames; f++) {
        rf(h);
        if (enter) { if (f % 90 === 40) kd(h, RET); if (f % 90 === 55) ku(h, RET); }
        if (getExit(0)) break;
    }
    const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);
    const p = getFB(h, wP, hP, bP), w = M.HEAP32[wP >> 2], ht = M.HEAP32[hP >> 2], base = p >> 1;
    const px = (x, y) => {
        const v = M.HEAPU16[base + y * w + x];
        return { r: ((v >> 11) & 31) << 3, g: ((v >> 5) & 63) << 2, b: (v & 31) << 3 };
    };
    const is = { magenta: (c) => c.r > 120 && c.b > 120 && c.g < 96,
                 green:   (c) => c.g > 120 && c.r < 96 && c.b < 96,
                 yellow:  (c) => c.r > 120 && c.g > 120 && c.b < 96,
                 red:     (c) => c.r > 120 && c.g < 96 && c.b < 96 };
    const count = (kind) => { let n = 0; for (let y = 0; y < ht; y += 2) for (let x = 0; x < w; x += 2) if (is[kind](px(x, y))) n++; return n; };
    const boxHas = (kind, x0, y0, rad) => { for (let y = y0 - rad; y <= y0 + rad; y++) for (let x = x0 - rad; x <= x0 + rad; x++) if (x >= 0 && x < w && y >= 0 && y < ht && is[kind](px(x, y))) return true; return false; };
    return { w, ht, count, boxHas };
}

(async () => {
    let ok = true;
    const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

    // ---- T1: 円弧の扇 (マゼンタ左 中心160,200 / 緑右 中心440,200) ----
    const t1 = await run('T1.EXE', 4000, true);
    expect(t1.count('magenta') > 300, `T1 マゼンタ扇が描画 (px=${t1.count('magenta')})`);
    expect(t1.count('green')   > 300, `T1 緑扇が描画 (px=${t1.count('green')})`);
    // 円弧 ON: 左 i=7 (r=140) 最外弧は北 (160,60) を通る / 東 spoke (300,200)
    expect(t1.boxHas('magenta', 160, 60, 3),  'T1 左最外弧が北 (160,60) を通る');
    expect(t1.boxHas('magenta', 300, 200, 3), 'T1 左の東 spoke (300,200)');
    // 開いたウェッジ OFF: 左中心の右上 0-45° (r=100, 22.5°) ≒ (252,162) は未描画
    expect(!t1.boxHas('magenta', 252, 162, 2), 'T1 開ウェッジ (252,162) は未描画');

    // ---- T2: 真円 + 楕円 (塗りは scope 外=輪郭) ----
    const t2 = await run('T2.EXE', 1500, false);
    expect(t2.count('green')  > 90,  `T2 緑真円が描画 (px=${t2.count('green')})`);
    expect(t2.count('yellow') > 40,  `T2 黄色い細楕円が描画=楕円対応 (px=${t2.count('yellow')})`);
    expect(t2.count('red')    > 80,  `T2 赤い大楕円弧が描画=楕円対応 (px=${t2.count('red')})`);
    // 楕円 ON: 黄楕円は上端 (400,~15) 付近 / 赤大楕円は上端 (500,~200) 付近
    expect(t2.boxHas('yellow', 400, 20, 12), 'T2 黄楕円が上部 (400,20) 付近に存在');
    expect(t2.boxHas('red', 500, 202, 14),   'T2 赤楕円弧が (500,202) 付近に存在');

    console.log(ok ? 'PASS: LIO GCIRCLE 円弧 + 楕円' : 'FAIL: LIO GCIRCLE 回帰');
    process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
