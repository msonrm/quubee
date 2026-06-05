#!/usr/bin/env node
// bio 100% ゲーム headless ブートトリアージ (2026-06-05)
//
// 目的: 「bio 100% 純ゲーム N 本中 過半を T3(プレイ可能) に」の目標に対し、まず *ベースライン* を
// 機械計測する。各ゲームの主 EXE/COM を loader にステージして数千フレーム走らせ、フレームバッファの
// 「色数」と「フレーム間差分」から到達 Tier を自動推定する:
//   ❌ DEAD   : 描画に至らず (BIOS 危険域 hang / 早期終了 / 画面ほぼ単色)
//   ▫ BOOT   : 実行はされたが graphics 乏しい (テキストのみ/待機)
//   ◐ RENDER : 多色 graphics を描いた (タイトル/ゲーム画面に到達した強い兆候) ＝静止
//   ● ALIVE  : 多色 graphics ＋ フレーム間で変化 (アニメ=ほぼ確実にゲームが回っている)
// RENDER+ALIVE 本数 ≈ 「あと一押しで T3 に届く母集団」。これで 16/31 か 20/31 かを推測でなく
// データで決める。T3(操作可能) の最終確認はブラウザで人がやる前提 (headless は入力できない)。
//
// 注: .bat 起動ゲーム (音源ドライバ TSR + 主) は本トリアージでは主 EXE を直接ステージする
// (ドライバ非常駐)。ドライバ必須で落ちるゲームは DEAD/BOOT に出るので、その本は .bat 経路で再検証する。
//
// corpus は local 限定 (.gitignore /games/*)。不在/lha 無しは SKIP。
// 使い方: node tools/bio100_triage.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const BIO    = path.join(ROOT, 'games', 'bio_100');
const WORK   = '/tmp/qb_bio100';

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (bash tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');
if (!fs.existsSync(BIO))    skip('games/bio_100 不在 (local-only corpus)');
if (cp.spawnSync('sh', ['-c', 'command -v lha']).status) skip('lha 不在');

// 純ゲーム 31 本の {書庫, 主実行ファイル}。非ゲーム(C2ED/C2RANK/CATLET/EFORTH)と重複(FINAT=FINAL)は除外。
const GAMES = [
    ['BIOHJA.LZH','biohja.exe'], ['C2GP100.LZH','c2gp.exe'], ['CRAY083.LZH','cray.exe'],
    ['CX92_100.LZH','cx92.exe'], ['CZ102.LZH','camelzoo.exe'], ['DADA.LZH','dada.exe'],
    ['DEPTH100.LZH','depth.exe'], ['DYNAMO16.LZH','dynamo.exe'], ['F1GP083.LZH','f1gp.exe'],
    ['FINAL100.LZH','finmain.exe'], ['FLIXX100.LZH','flixx.exe'], ['GETS.LZH','gets.exe'],
    ['GGL2_100.LZH','goggle2.exe'], ['GS100.LZH','gsnake.exe'], ['KANI123.LZH','kani.exe'],
    ['METYS100.LZH','metys.exe'], ['MKD106.LZH','markadia.exe'], ['MOG003.LZH','mogler.exe'],
    ['NX93_110.LZH','nx93.exe'], ['OZ100.LZH','oz8.exe'], ['PECKER05.LZH','pecker.exe'],
    ['POLA100.LZH','pola.exe'], ['POY100.LZH','poy.exe'], ['ROLL100.LZH','rolling.exe'],
    ['SC100.LZH','sc.exe'], ['SEENA2.LZH','seena2.com'], ['SSP101.LZH','sspartan.exe'],
    ['STB120.LZH','stbmain.exe'], ['TW212.LZH','twins2.exe'], ['TWINS110.LZH','twins.exe'],
    ['YY.LZH','yy.exe'],
];

const FRAMES = 3000;
const SAMPLE_AT = [800, 1500, 2200, 2900];   // この frame で framebuffer をサンプル

function extract(archive) {
    const dir = path.join(WORK, archive + '.d');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        cp.spawnSync('lha', ['xw=' + dir, path.join(BIO, archive)], { stdio: 'ignore' });
    }
    return dir;
}

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// framebuffer の「色数」と「内容ハッシュ」を取る (RGB16, 1/17 サンプル)。
function fbMetric(M, getFB, wP, hP, bP) {
    const ptr = getFB(0/*handle 引数は使わないが API 形上渡す*/, wP, hP, bP);
    const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
    if (!ptr || w <= 0 || h <= 0) return { colors: 0, hash: 0 };
    const base = ptr >> 1, n = w * h;
    const set = new Set(); let hash = 0;
    for (let i = 0; i < n; i += 17) {
        const px = M.HEAPU16[base + i];
        set.add(px); hash = (hash + px * (i + 1)) >>> 0;
    }
    return { colors: set.size, hash };
}

async function runGame([archive, exe]) {
    const dir = extract(archive);
    const exePath = path.join(dir, exe);
    if (!fs.existsSync(exePath)) {
        // 大文字小文字の揺れを吸収
        const found = fs.readdirSync(dir).find((f) => f.toLowerCase() === exe.toLowerCase());
        if (!found) return { archive, skip: exe + ' 不在' };
        exe = found;
    }
    const name = archive.replace(/\.LZH$/i, '');

    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) return { archive, skip: 'create 失敗' };

    try { M.FS.mkdir('/run'); } catch (_) {}
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isFile()) M.FS.writeFile('/run/' + f, new Uint8Array(fs.readFileSync(p)));
    }

    const img = new Uint8Array(fs.readFileSync(path.join(dir, exe)));
    const ptr = M._malloc(img.length); M.HEAPU8.set(img, ptr);
    const stageFn = /\.com$/i.test(exe) ? 'np2kai_dos_stage_com' : 'np2kai_dos_stage_exe';
    const sr = M.ccall(stageFn, 'number', ['number','number','string','string'],
                       [ptr, img.length, '', exe.toUpperCase()]);
    M._free(ptr);
    if (sr !== 0) return { archive, name, stageErr: sr };

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const linPc    = M.cwrap('np2kai_debug_get_linear_pc', 'number', ['number']);
    const xmsStat  = M.cwrap('np2kai_xms_stat', 'number', ['number','number']);
    const getFB    = M.cwrap('np2kai_get_framebuffer', 'number', ['number','number','number','number']);
    const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);
    const getFBh = (h, a, b, c) => getFB(handle, a, b, c);

    let maxColors = 0; const hashes = []; let exited = 0, allocKB = 0;
    for (let f = 0; f < FRAMES; f++) {
        runFrame(handle);
        const u = (xmsStat(handle, 2) / 1024) | 0; if (u > allocKB) allocKB = u;
        if (SAMPLE_AT.includes(f)) {
            const m = fbMetric(M, getFBh, wP, hP, bP);
            if (m.colors > maxColors) maxColors = m.colors;
            hashes.push(m.hash);
        }
        if (getExit(0)) { exited = 1; break; }
    }
    const finalPc = linPc(handle) >>> 0;
    const animated = new Set(hashes.filter((x) => x !== 0)).size >= 2;   // サンプル間で内容が変化
    const inBios = finalPc >= 0xE8000 && finalPc <= 0xFFFFF;

    // Tier 推定
    let tier;
    if (maxColors <= 3 && (inBios || exited)) tier = 'DEAD';
    else if (maxColors <= 6)                  tier = 'BOOT';
    else if (animated)                        tier = 'ALIVE';
    else                                      tier = 'RENDER';

    return { archive, name, tier, maxColors, animated, exited, finalPc, inBios, allocKB };
}

(async () => {
    const rows = [];
    for (const g of GAMES) { process.stderr.write('.'); rows.push(await runGame(g)); }
    process.stderr.write('\n');

    const ICON = { DEAD: '❌', BOOT: '▫ ', RENDER: '◐ ', ALIVE: '● ' };
    console.log('\n==== bio 100% headless ブートトリアージ (主EXE直ステージ) ====\n');
    const tally = { DEAD: 0, BOOT: 0, RENDER: 0, ALIVE: 0 };
    for (const r of rows) {
        if (r.skip)   { console.log(`   ?  ${r.archive.padEnd(14)} SKIP ${r.skip}`); continue; }
        if (r.stageErr !== undefined) { console.log(`   !  ${r.archive.padEnd(14)} stage 失敗 r=${r.stageErr}`); continue; }
        tally[r.tier]++;
        console.log(`  ${ICON[r.tier]} ${r.name.padEnd(12)} colors=${String(r.maxColors).padStart(3)}` +
                    ` ${r.animated ? 'anim' : '    '} ${r.allocKB ? 'XMS'+r.allocKB+'KB' : '       '}` +
                    ` pc=0x${r.finalPc.toString(16)}${r.inBios ? ' BIOS' : ''}`);
    }
    const reach = tally.RENDER + tally.ALIVE;
    console.log('\n---- 集計 ----');
    console.log(`❌ DEAD=${tally.DEAD}  ▫ BOOT=${tally.BOOT}  ◐ RENDER=${tally.RENDER}  ● ALIVE=${tally.ALIVE}`);
    console.log(`描画到達 (RENDER+ALIVE) = ${reach}/${GAMES.length}  ← 「あと一押しで T3」候補の母集団`);
    console.log(`そのうち ALIVE(アニメ動作中) = ${tally.ALIVE} 本 ← T3 にかなり近い`);
    console.log(`\n目安: 目標「過半=16/31」に対し描画到達 ${reach} 本。20/31 が射程かはこの数とブロッカーの偏りで判断。`);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
