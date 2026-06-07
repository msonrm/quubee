#!/usr/bin/env node
// bio 100% ゲーム headless ブートトリアージ (2026-06-05、2026-06-07 改修)
//
// 目的: 「bio 100% 純ゲーム N 本中 過半を T3(プレイ可能) に」の目標に対し *ベースライン* を機械計測する。
// 各ゲームを loader にステージして数千フレーム走らせ、framebuffer の「色数」「フレーム間差分」と
// 「最終 PC の位置」から到達状態を自動推定する。
//
// === 2026-06-07 改修 (GBOX.COM スモークで判明した 2 つの偽陰性を是正) ===
//  ① .bat 入口解決: ランチャ型 (音源ドライバ TSR + 本体) は、従来「主 exe を裸でステージ」していたため
//     ドライバ未常駐で早期終了し DEAD に見えていた。.bat があれば batscript.js でレシピを解釈し、
//     ブラウザと同じ stage_script 経路 (ミニ COMMAND.COM が 1 セッション内で順次 EXEC) でステージする。
//  ② PC 位置の 3 分類: 従来 `pc ∈ [0xE8000,0xFFFFF]` を一律「BIOS クラッシュ」扱いしていたが、この範囲は
//     dos_loader.h のトランポリンを含み、全く別の状態が混在する:
//       EXIT  : 0xFEE30 = QB_TRAMP_HALT_LOOP (プログラム正常終了後の停止 HLT) → 健全な終了
//       WAIT  : 0xFEE00-0xFEE7F の他トランポリン (INT21 等で DOS コール内ブロック) → 入力待ち = 生存
//       BIOS  : 上記以外の 0xE8000-0xFFFFF (neccheck 近傍) → 本物の BIOS 暴走 = 真のクラッシュ
//
// 到達 Tier (色ベース。色が乏しい時のみ PC 状態で曖昧さを割る):
//   ● ALIVE  : 多色 graphics + フレーム間変化 (アニメ=ほぼ確実にゲームが回っている)
//   ◐ RENDER : 多色 graphics 静止 (タイトル/ゲーム画面に到達した強い兆候)
//   ▫ BOOT   : graphics 乏しい (色 4-6)
//   ⌨ WAIT   : 色乏しいが DOS 入力待ちで生存 (テキストゲーム等) — 実質「動いている」
//   ⏏ EXIT   : 色乏しく正常終了 (ランチャがドライバ未常駐で自ら bail 等。非クラッシュ)
//   ✗ CRASH  : 色乏しく BIOS 暴走域に落ちた — 真の非互換/BIOS カバレッジ問題
//   ? BUSY   : 色乏しく user code で停留 (自前 INT 入力待ち or 無限ループ) — 要観察
// T3(操作可能) の最終確認はブラウザで人がやる前提 (headless は入力できない)。
//
// corpus は local 限定 (.gitignore /games/*)。不在/lha 無しは SKIP。
// 使い方: node tools/bio100_triage.js [filter]   filter= 書庫名の部分一致 (例: DYNAMO) で対象を絞る

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');
const qbBatScript = require(path.join(__dirname, '..', 'web', 'player', 'batscript.js'));

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const BIO    = path.join(ROOT, 'games', 'bio_100');
const WORK   = '/tmp/qb_bio100';
const FILTER = (process.argv[2] || '').toLowerCase();

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (bash tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');
if (!fs.existsSync(BIO))    skip('games/bio_100 不在 (local-only corpus)');
if (cp.spawnSync('sh', ['-c', 'command -v lha']).status) skip('lha 不在');

// 純ゲーム 31 本の {書庫, 主実行ファイル(.bat が無い/解決不能な時のフォールバック)}。
// 非ゲーム(C2ED/C2RANK/CATLET/EFORTH)と重複(FINAT=FINAL)は除外。
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
const SAMPLE_AT = new Set([800, 1500, 2200, 2900]);

// dos_loader.h のトランポリン番地 (linear)。
const TRAMP_HALT = 0xFEE30;            // QB_TRAMP_HALT_LOOP (正常終了後の停止)
const TRAMP_LO   = 0xFEE00, TRAMP_HI = 0xFEE7F;  // トランポリンページ全体
const BIOS_LO    = 0xE8000, BIOS_HI = 0xFFFFF;

function extract(archive) {
    const dir = path.join(WORK, archive + '.d');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        cp.spawnSync('lha', ['xw=' + dir, path.join(BIO, archive)], { stdio: 'ignore' });
    }
    return dir;
}

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

function fbColors(M, getFB, handle, wP, hP, bP) {
    const ptr = getFB(handle, wP, hP, bP);
    const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
    if (!ptr || w <= 0 || h <= 0) return { colors: 0, hash: 0 };
    const base = ptr >> 1, n = w * h, set = new Set(); let hash = 0;
    for (let i = 0; i < n; i += 17) { const px = M.HEAPU16[base + i]; set.add(px); hash = (hash + px * (i + 1)) >>> 0; }
    return { colors: set.size, hash };
}

// 起動方法を決める: .bat があり resolveSequence が通れば {kind:'script', seq, main}、
// 無ければ {kind:'single', exe} (GAMES のフォールバック exe)。
function planLaunch(dir, fallbackExe) {
    const names = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
    const bats = names.filter((n) => /\.bat$/i.test(n)).sort();
    for (const bat of bats) {
        const recipe = qbBatScript.parse(fs.readFileSync(path.join(dir, bat)));
        const seq = qbBatScript.resolveSequence(recipe, names, '');   // userArgs 無し
        if (seq && seq.length) {
            const main = seq.find((c) => {
                const key = c.name.toLowerCase().replace(/\.(com|exe|bat)$/, '');
                return !qbBatScript.DRIVER_NAMES.has(key);
            }) || seq[seq.length - 1];
            return { kind: 'script', bat, seq, main: main.name, names };
        }
    }
    // フォールバック: GAMES の主 exe (大小揺れ吸収)
    let exe = fallbackExe;
    if (!names.some((f) => f === exe)) {
        const found = names.find((f) => f.toLowerCase() === exe.toLowerCase());
        if (found) exe = found;
    }
    return { kind: 'single', exe, names };
}

async function runGame([archive, fallbackExe]) {
    const dir = extract(archive);
    const name = archive.replace(/\.LZH$/i, '');
    const plan = planLaunch(dir, fallbackExe);
    if (plan.kind === 'single' && !plan.names.some((f) => f.toLowerCase() === plan.exe.toLowerCase()))
        return { archive, name, skip: plan.exe + ' 不在' };

    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) return { archive, name, skip: 'create 失敗' };

    try { M.FS.mkdir('/run'); } catch (_) {}
    for (const f of plan.names) M.FS.writeFile('/run/' + f, new Uint8Array(fs.readFileSync(path.join(dir, f))));

    // --- ステージ (.bat シーケンス or 単一 exe) ---
    let sr, launchLabel;
    if (plan.kind === 'script') {
        const scriptStr = plan.seq.map((c) => c.name + '\t' + (c.args || '')).join('\n') + '\n';
        const bytes = Buffer.from(scriptStr, 'latin1');
        const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
        sr = M.ccall('np2kai_dos_stage_script', 'number', ['number','number','string'],
                     [ptr, bytes.length, 'SHELL.COM']);
        M._free(ptr);
        launchLabel = `bat:${plan.bat}→${plan.main}${plan.seq.length > 1 ? '+drv' : ''}`;
    } else {
        const img = new Uint8Array(fs.readFileSync(path.join(dir, plan.exe)));
        const ptr = M._malloc(img.length); M.HEAPU8.set(img, ptr);
        const stageFn = /\.com$/i.test(plan.exe) ? 'np2kai_dos_stage_com' : 'np2kai_dos_stage_exe';
        sr = M.ccall(stageFn, 'number', ['number','number','string','string'],
                     [ptr, img.length, '', plan.exe.toUpperCase()]);
        M._free(ptr);
        launchLabel = `exe:${plan.exe}`;
    }
    if (sr !== 0) return { archive, name, launchLabel, stageErr: sr };

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const linPc    = M.cwrap('np2kai_debug_get_linear_pc', 'number', ['number']);
    const xmsStat  = M.cwrap('np2kai_xms_stat', 'number', ['number','number']);
    const getFB    = M.cwrap('np2kai_get_framebuffer', 'number', ['number','number','number','number']);
    const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);

    let maxColors = 0; const hashes = []; let exited = 0, allocKB = 0;
    for (let f = 0; f < FRAMES; f++) {
        runFrame(handle);
        const u = (xmsStat(handle, 2) / 1024) | 0; if (u > allocKB) allocKB = u;
        if (SAMPLE_AT.has(f)) { const m = fbColors(M, getFB, handle, wP, hP, bP); if (m.colors > maxColors) maxColors = m.colors; hashes.push(m.hash); }
        if (getExit(0)) { exited = 1; break; }
    }
    const pc = linPc(handle) >>> 0;
    const animated = new Set(hashes.filter((x) => x !== 0)).size >= 2;

    // PC 状態の 3(+1) 分類
    let state;
    if (exited || pc === TRAMP_HALT)            state = 'EXIT';
    else if (pc >= TRAMP_LO && pc <= TRAMP_HI)  state = 'WAIT';   // DOS コール内ブロック (入力待ち等)
    else if (pc >= BIOS_LO && pc <= BIOS_HI)    state = 'BIOS';   // 本物の BIOS 暴走
    else                                         state = 'USER';

    // Tier 推定: 色が出ていれば色優先、乏しければ state で割る
    let tier;
    if (maxColors > 6)        tier = animated ? 'ALIVE' : 'RENDER';
    else if (maxColors >= 4)  tier = 'BOOT';
    else if (state === 'WAIT') tier = 'WAIT';
    else if (state === 'EXIT') tier = 'EXIT';
    else if (state === 'BIOS') tier = 'CRASH';
    else                       tier = 'BUSY';

    return { archive, name, tier, state, maxColors, animated, exited, pc, allocKB, launchLabel };
}

(async () => {
    const list = GAMES.filter(([a]) => !FILTER || a.toLowerCase().includes(FILTER));
    if (!list.length) skip(`filter "${FILTER}" に一致する書庫なし`);
    const rows = [];
    for (const g of list) { process.stderr.write('.'); rows.push(await runGame(g)); }
    process.stderr.write('\n');

    const ICON = { ALIVE:'● ', RENDER:'◐ ', BOOT:'▫ ', WAIT:'⌨ ', EXIT:'⏏ ', CRASH:'✗ ', BUSY:'? ' };
    console.log('\n==== bio 100% headless トリアージ (.bat 入口解決 + PC 状態 3 分類) ====\n');
    const tally = { ALIVE:0, RENDER:0, BOOT:0, WAIT:0, EXIT:0, CRASH:0, BUSY:0 };
    for (const r of rows) {
        if (r.skip)     { console.log(`  ?? ${r.name.padEnd(12)} SKIP ${r.skip}`); continue; }
        if (r.stageErr !== undefined) { console.log(`  !! ${r.name.padEnd(12)} stage 失敗 r=${r.stageErr} [${r.launchLabel}]`); continue; }
        tally[r.tier]++;
        console.log(`  ${ICON[r.tier]}${r.name.padEnd(11)} ${r.tier.padEnd(6)} ` +
                    `colors=${String(r.maxColors).padStart(3)} ${r.animated ? 'anim' : '    '} ` +
                    `${r.allocKB ? 'XMS' + r.allocKB + 'K ' : '      '} ` +
                    `pc=0x${r.pc.toString(16).padStart(5,'0')}(${r.state}) ${r.launchLabel}`);
    }
    const reach = tally.ALIVE + tally.RENDER;
    const aliveish = reach + tally.WAIT;          // WAIT(入力待ち) も「動いている」側
    console.log('\n---- 集計 ----');
    console.log(`● ALIVE=${tally.ALIVE}  ◐ RENDER=${tally.RENDER}  ▫ BOOT=${tally.BOOT}  ⌨ WAIT=${tally.WAIT}` +
                `  ⏏ EXIT=${tally.EXIT}  ✗ CRASH=${tally.CRASH}  ? BUSY=${tally.BUSY}`);
    console.log(`描画到達 (ALIVE+RENDER) = ${reach}/${list.length}`);
    console.log(`動作確認 (＋WAIT 入力待ち生存) = ${aliveish}/${list.length}`);
    console.log(`真の問題候補 (CRASH=BIOS暴走) = ${tally.CRASH}  / 早期終了 (EXIT、ドライバ等で復活余地) = ${tally.EXIT}`);
    console.log(`\n注: EXIT はランチャ型で .bat 解決後も終了したもの (ドライバ init 失敗 / 本体が更に前提を要求)。`);
    console.log(`    CRASH のみが BIOS カバレッジの実問題。T3 最終確認はブラウザで。`);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
