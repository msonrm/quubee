#!/usr/bin/env node
// bio 100% ゲーム headless ブートトリアージ (2026-06-05、2026-06-07 改修、2026-06-27 並列化)
//
// 目的: 「bio 100% 純ゲーム N 本中 過半を T3(プレイ可能) に」の目標に対し *ベースライン* を機械計測する。
// 各ゲームを loader にステージして数千フレーム走らせ、framebuffer の「色数」「フレーム間差分」と
// 「最終 PC の位置」から到達状態を自動推定する。
//
// === 2026-06-27 並列化 (タイムアウト根治) ===
//  旧版は 30 本を 1 プロセスで逐次に回していた。各ゲームごとに wasm モジュールを生成して捨てるが、
//  同一プロセスで何十回も生成すると (原因未特定の) ストール/デッドロックに陥り、フルランが 2 分の
//  ツールタイムアウトに収まらず「ほぼ毎回やり直し」になっていた (単発・filter 指定なら 2 秒で完走)。
//  対策:
//   ① プロセス毎分離: 1 ゲーム = 1 子プロセス (`--worker <書庫>`)。各子は wasm を 1 回だけ生成する
//      ので、逐次生成の蓄積に起因するストールが原理的に起きない。
//   ② 並列: 既定 min(8, CPU数) ワーカーを同時に回す → フルランが数十秒に短縮。`--jobs N` で上書き。
//   ③ 個別タイムアウト: 子が `--timeout` 秒 (既定 150) を超えたら SIGKILL し TIMEOUT として記録。
//      1 本が固まってもバッチ全体を道連れにしない (旧版の最大の弱点)。どの本が固まるかも可視化される。
//      (グラフィカルなゲームは 3000 フレームで実 40-86 秒/本かかるので、8 並列の競合スパイクでも
//       誤って殺さないよう 150 秒に設定。真のハングは観測されていない=競合遅延が実態。)
//   ⑤ 早期確定: 多色 + アニメ済を確認した時点で残りフレームを打ち切る (runGame 内)。重い ALIVE 本が
//      ~半減し、全体のコールド時間が大きく縮む (tier は不変)。
//   ④ 再開キャッシュ: 各結果を WORK/results.json に逐次保存。再実行は済みをスキップして埋める。
//      途中で切れても続きから完走する。`--fresh` で全再計算 (FRAMES 変更時はキャッシュ自動失効)。
//
// === 2026-06-07 改修 (GBOX.COM スモークで判明した 2 つの偽陰性を是正) ===
//  ① .bat 入口解決: ランチャ型 (音源ドライバ TSR + 本体) は、従来「主 exe を裸でステージ」していたため
//     ドライバ未常駐で早期終了し DEAD に見えていた。.bat があれば batscript.js でレシピを解釈し、
//     ブラウザと同じ stage_batch 経路 (ミニ COMMAND.COM が 1 セッション内で順次 EXEC) でステージする。
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
//   ⧖ TIMEOUT: 子プロセスが時間内に終わらなかった (固まり) — 旧版がフルランごと巻き込まれていた本
// T3(操作可能) の最終確認はブラウザで人がやる前提 (headless は入力できない)。
//
// corpus は local 限定 (.gitignore /games/*)。不在/lha 無しは SKIP。
// 使い方:
//   node tools/bio100_triage.js [filter] [--jobs N] [--timeout S] [--fresh]
//     filter   = 書庫名の部分一致 (例: DYNAMO) で対象を絞る
//     --jobs   = 並列ワーカー数 (既定 min(8, CPU数))
//     --timeout= 1 本あたりの上限秒 (既定 150、超過で TIMEOUT)
//     --fresh  = キャッシュを無視して全再計算
//   (内部用) --worker <書庫>  : 1 本だけ走らせ結果を JSON 1 行で吐く子プロセスモード

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');
const os   = require('os');
const qbBatScript = require(path.join(__dirname, '..', 'web', 'player', 'batscript.js'));

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const BIO    = path.join(ROOT, 'games', 'bio_100');
const WORK   = '/tmp/qb_bio100';
const CACHE  = path.join(WORK, 'results.json');
const SENTINEL = '__BIO_RESULT__';   // 子プロセス stdout の結果行マーカ

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }

// 純ゲーム 31 本の {書庫, 主実行ファイル(.bat が無い/解決不能な時のフォールバック), 必須引数?}。
// 非ゲーム(C2ED/C2RANK/CATLET/EFORTH)と重複(FINAT=FINAL)は除外。
// 第3要素 = .bat が無く本体が「ドキュメント記載の必須コマンドライン引数」を要求する場合の cmdline。
// これを渡さないと裸起動で usage を出して即終了し EXIT に見える (偽陰性)。.bat レシピ解決と同じ
// 「作者が文書化した起動方法どおりに起動する」原則。GS100=gsnake は `gsnake <1P> <2P> <wait>`
// (gsnake.doc) で 1P/2P=プレイヤー種別(0=人/キーボード 等)、wait=0~10。"0 0 0"=両者キーボード・wait 0。
const GAMES = [
    ['BIOHJA.LZH','biohja.exe'], ['C2GP100.LZH','c2gp.exe'], ['CRAY083.LZH','cray.exe'],
    ['CX92_100.LZH','cx92.exe'], ['CZ102.LZH','camelzoo.exe'], ['DADA.LZH','dada.exe'],
    ['DEPTH100.LZH','depth.exe'], ['DYNAMO16.LZH','dynamo.exe'], ['F1GP083.LZH','f1gp.exe'],
    ['FINAL100.LZH','finmain.exe'], ['FLIXX100.LZH','flixx.exe'], ['GETS.LZH','gets.exe'],
    ['GGL2_100.LZH','goggle2.exe'], ['GS100.LZH','gsnake.exe','0 0 0'], ['KANI123.LZH','kani.exe'],
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

const nameOf = (archive) => archive.replace(/\.LZH$/i, '');

function extract(archive) {
    const dir = path.join(WORK, archive + '.d');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        cp.spawnSync('lha', ['xw=' + dir, path.join(BIO, archive)], { stdio: 'ignore' });
    }
    return dir;
}

// ===================== 子プロセス (worker) 側: 1 ゲームを走らせる =====================

let NP2KaiModule = null;   // 遅延ロード: wasm を生成するのは worker 子プロセスだけ

function fbColors(M, getFB, handle, wP, hP, bP) {
    const ptr = getFB(handle, wP, hP, bP);
    const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
    if (!ptr || w <= 0 || h <= 0) return { colors: 0, hash: 0 };
    const base = ptr >> 1, n = w * h, set = new Set(); let hash = 0;
    for (let i = 0; i < n; i += 17) { const px = M.HEAPU16[base + i]; set.add(px); hash = (hash + px * (i + 1)) >>> 0; }
    return { colors: set.size, hash };
}

// 起動方法を決める: .bat があり buildStatements が通れば {kind:'script', stmts, main}、
// 無ければ {kind:'single', exe} (GAMES のフォールバック exe)。ブラウザの Run と同じ
// 文インタプリタ経路 (stage_batch。2026-07-11 に旧 ② 線形列経路を統合)。
function planLaunch(dir, fallbackExe, fallbackArgs) {
    const names = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
    const bats = names.filter((n) => /\.bat$/i.test(n)).sort();
    for (const bat of bats) {
        const recipe = qbBatScript.parse(fs.readFileSync(path.join(dir, bat)));
        const stmts = qbBatScript.buildStatements(recipe, names, '');   // userArgs 無し
        const cmds = stmts ? stmts.filter((s) => s.op === 'cmd') : [];
        if (cmds.length) {
            const main = cmds.find((c) => {
                const key = c.name.toLowerCase().replace(/\.(com|exe|bat)$/, '');
                return !qbBatScript.DRIVER_NAMES.has(key);
            }) || cmds[cmds.length - 1];
            return { kind: 'script', bat, stmts, ncmd: cmds.length, main: main.name, names };
        }
    }
    // フォールバック: GAMES の主 exe (大小揺れ吸収)
    let exe = fallbackExe;
    if (!names.some((f) => f === exe)) {
        const found = names.find((f) => f.toLowerCase() === exe.toLowerCase());
        if (found) exe = found;
    }
    return { kind: 'single', exe, args: fallbackArgs || '', names };
}

async function runGame([archive, fallbackExe, fallbackArgs]) {
    const t0 = Date.now();
    const dir = extract(archive);
    const name = nameOf(archive);
    const plan = planLaunch(dir, fallbackExe, fallbackArgs);
    if (plan.kind === 'single' && !plan.names.some((f) => f.toLowerCase() === plan.exe.toLowerCase()))
        return { archive, name, skip: plan.exe + ' 不在' };

    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) return { archive, name, skip: 'create 失敗' };

    try { M.FS.mkdir('/run'); } catch (_) {}
    for (const f of plan.names) M.FS.writeFile('/run/' + f, new Uint8Array(fs.readFileSync(path.join(dir, f))));

    // --- ステージ (.bat 文列 or 単一 exe) ---
    let sr, launchLabel;
    if (plan.kind === 'script') {
        const bytes = Buffer.from(qbBatScript.serializeStatements(plan.stmts), 'latin1');
        const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
        sr = M.ccall('np2kai_dos_stage_batch', 'number', ['number','number','string'],
                     [ptr, bytes.length, 'SHELL.COM']);
        M._free(ptr);
        launchLabel = `bat:${plan.bat}→${plan.main}${plan.ncmd > 1 ? '+drv' : ''}`;
    } else {
        const img = new Uint8Array(fs.readFileSync(path.join(dir, plan.exe)));
        const ptr = M._malloc(img.length); M.HEAPU8.set(img, ptr);
        const stageFn = /\.com$/i.test(plan.exe) ? 'np2kai_dos_stage_com' : 'np2kai_dos_stage_exe';
        sr = M.ccall(stageFn, 'number', ['number','number','string','string'],
                     [ptr, img.length, plan.args || '', plan.exe.toUpperCase()]);
        M._free(ptr);
        launchLabel = `exe:${plan.exe}${plan.args ? ' ' + plan.args : ''}`;
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

    let maxColors = 0; const hashes = []; let exited = 0, allocKB = 0, early = 0;
    for (let f = 0; f < FRAMES; f++) {
        runFrame(handle);
        const u = (xmsStat(handle, 2) / 1024) | 0; if (u > allocKB) allocKB = u;
        if (SAMPLE_AT.has(f)) {
            const m = fbColors(M, getFB, handle, wP, hP, bP);
            if (m.colors > maxColors) maxColors = m.colors;
            hashes.push(m.hash);
            // 早期確定: 多色 + アニメ済 (異なる非ゼロ hash 2 種以上) なら ALIVE は確定なので、残り
            // フレームを回す意味がない (グラフィカルなゲームは 1 フレーム ~10-30ms と重く、20 本の
            // ALIVE がここで半減すると全体が大きく速くなる)。tier は変わらない (ALIVE のまま)。
            if (maxColors > 6 && new Set(hashes.filter((x) => x !== 0)).size >= 2) { early = 1; break; }
        }
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

    return { archive, name, tier, state, maxColors, animated, exited, pc, allocKB, launchLabel, early, ms: Date.now() - t0 };
}

// worker エントリ: 1 ゲームを走らせ結果を JSON 1 行で stdout に吐いて即終了。
async function runWorkerMode(archive) {
    const entry = GAMES.find((g) => g[0] === archive);
    let res;
    if (!entry) res = { archive, name: nameOf(archive), error: 'GAMES に未登録: ' + archive };
    else {
        try { res = await runGame(entry); }
        catch (e) { res = { archive, name: nameOf(archive), error: String(e && e.message || e) }; }
    }
    // 書き込み完了 (flush) を待ってから exit (パイプ宛 write の切り捨て防止)。
    // wasm のバックグラウンドスレッド等が残ってもプロセスごと落とす。
    process.stdout.write(SENTINEL + JSON.stringify(res) + '\n', () => process.exit(0));
}

// ===================== 親プロセス (dispatcher) 側: 並列 + キャッシュ =====================

// 結果キャッシュ: { frames, results: { 書庫: 結果 } }。FRAMES 不一致なら失効。
// 常にファイル全体を base として読む (--fresh は dispatcher 側で対象分だけ無効化する。
// filter 付き --fresh が範囲外のキャッシュを消さないため)。
function loadCache() {
    try {
        const j = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
        if (j && j.frames === FRAMES && j.results) return j.results;
    } catch (_) {}
    return {};
}
function saveCache(results) {
    try {
        fs.mkdirSync(WORK, { recursive: true });
        fs.writeFileSync(CACHE, JSON.stringify({ frames: FRAMES, results }, null, 0));
    } catch (_) {}
}

// 1 ゲーム = 1 子プロセス。timeout 超過で SIGKILL → TIMEOUT 結果。
function spawnWorker(archive, timeoutMs) {
    return new Promise((resolve) => {
        const child = cp.spawn(process.execPath, [__filename, '--worker', archive],
                               { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '', timedOut = false;
        const killTimer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch (_) {} }, timeoutMs);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (code) => {
            clearTimeout(killTimer);
            let res;
            if (timedOut) {
                res = { archive, name: nameOf(archive), tier: 'TIMEOUT' };
            } else {
                const line = out.split('\n').reverse().find((l) => l.startsWith(SENTINEL));
                if (line) { try { res = JSON.parse(line.slice(SENTINEL.length)); } catch (_) { res = { archive, name: nameOf(archive), error: 'JSON 解析失敗' }; } }
                else res = { archive, name: nameOf(archive), error: 'no-result (code=' + code + ')' + (err ? ' ' + err.replace(/\s+/g, ' ').slice(0, 120) : '') };
            }
            resolve(res);
        });
    });
}

// 固定並列度のプール。各完了で逐次キャッシュ保存。
async function runPool(items, jobs, timeoutMs, results, onDone) {
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const archive = items[idx++];
            const res = await spawnWorker(archive, timeoutMs);
            results[archive] = res;
            saveCache(results);
            onDone(res);
        }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, () => worker()));
}

async function dispatcherMode(opts) {
    if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (bash tools/dos_loader/build.sh)');
    if (!fs.existsSync(FONT))   skip('font.bmp 不在');
    if (!fs.existsSync(BIO))    skip('games/bio_100 不在 (local-only corpus)');
    if (cp.spawnSync('sh', ['-c', 'command -v lha']).status) skip('lha 不在');

    const list = GAMES.map((g) => g[0]).filter((a) => !opts.filter || a.toLowerCase().includes(opts.filter));
    if (!list.length) skip(`filter "${opts.filter}" に一致する書庫なし`);

    const results = loadCache();
    if (opts.fresh) for (const a of list) delete results[a];   // 対象分だけ無効化 (範囲外キャッシュは保持)
    const todo = list.filter((a) => !results[a]);
    const cachedN = list.length - todo.length;

    process.stderr.write(`bio100 triage: ${list.length} 本 (済 ${cachedN} / 実行 ${todo.length})  ` +
        `jobs=${opts.jobs} timeout=${opts.timeout}s${opts.fresh ? ' [fresh]' : ''}\n`);
    if (todo.length) {
        let n = 0;
        await runPool(todo, opts.jobs, opts.timeout * 1000, results, (res) => {
            n++;
            const mark = res.tier === 'TIMEOUT' ? 'T' : (res.error ? '!' : (res.skip ? 's' : '.'));
            process.stderr.write(`${mark}${n % 10 === 0 ? n : ''}`);
        });
        process.stderr.write('\n');
    }

    // ---- 集計 (list 順、結果はキャッシュ/今回分から) ----
    const ICON = { ALIVE:'● ', RENDER:'◐ ', BOOT:'▫ ', WAIT:'⌨ ', EXIT:'⏏ ', CRASH:'✗ ', BUSY:'? ', TIMEOUT:'⧖ ' };
    console.log('\n==== bio 100% headless トリアージ (.bat 入口解決 + PC 状態 3 分類 + 並列) ====\n');
    const tally = { ALIVE:0, RENDER:0, BOOT:0, WAIT:0, EXIT:0, CRASH:0, BUSY:0, TIMEOUT:0 };
    for (const archive of list) {
        const r = results[archive] || { name: nameOf(archive), error: '結果なし' };
        if (r.skip)     { console.log(`  ?? ${r.name.padEnd(12)} SKIP ${r.skip}`); continue; }
        if (r.error)    { console.log(`  !! ${r.name.padEnd(12)} エラー: ${r.error}`); continue; }
        if (r.stageErr !== undefined) { console.log(`  !! ${r.name.padEnd(12)} stage 失敗 r=${r.stageErr} [${r.launchLabel}]`); continue; }
        tally[r.tier]++;
        if (r.tier === 'TIMEOUT') { console.log(`  ${ICON.TIMEOUT}${r.name.padEnd(11)} TIMEOUT (${opts.timeout}s 内に終わらず固まり)`); continue; }
        console.log(`  ${ICON[r.tier]}${r.name.padEnd(11)} ${r.tier.padEnd(6)} ` +
                    `colors=${String(r.maxColors).padStart(3)} ${r.animated ? 'anim' : '    '} ` +
                    `${r.allocKB ? 'XMS' + r.allocKB + 'K ' : '      '} ` +
                    `${r.ms != null ? String((r.early ? '~' : '') + (r.ms / 1000).toFixed(1) + 's').padStart(6) : '      '} ` +
                    `pc=0x${(r.pc >>> 0).toString(16).padStart(5,'0')}(${r.state}) ${r.launchLabel}`);
    }
    const reach = tally.ALIVE + tally.RENDER;
    const aliveish = reach + tally.WAIT;          // WAIT(入力待ち) も「動いている」側
    console.log('\n---- 集計 ----');
    console.log(`● ALIVE=${tally.ALIVE}  ◐ RENDER=${tally.RENDER}  ▫ BOOT=${tally.BOOT}  ⌨ WAIT=${tally.WAIT}` +
                `  ⏏ EXIT=${tally.EXIT}  ✗ CRASH=${tally.CRASH}  ? BUSY=${tally.BUSY}  ⧖ TIMEOUT=${tally.TIMEOUT}`);
    console.log(`描画到達 (ALIVE+RENDER) = ${reach}/${list.length}`);
    console.log(`動作確認 (＋WAIT 入力待ち生存) = ${aliveish}/${list.length}`);
    console.log(`真の問題候補 (CRASH=BIOS暴走) = ${tally.CRASH}  / 早期終了 (EXIT、ドライバ等で復活余地) = ${tally.EXIT}`);
    if (tally.TIMEOUT) console.log(`固まり (TIMEOUT) = ${tally.TIMEOUT}  ← 時間内に終わらない本。--timeout を増やすか単独調査を。`);
    console.log(`\n注: EXIT はランチャ型で .bat 解決後も終了したもの (ドライバ init 失敗 / 本体が更に前提を要求)。`);
    console.log(`    CRASH のみが BIOS カバレッジの実問題。T3 最終確認はブラウザで。`);
    console.log(`    結果は ${CACHE} にキャッシュ済 (再実行は済みをスキップ。全再計算は --fresh)。`);
}

// ===================== エントリ: arg を解いて worker / dispatcher へ分岐 =====================

function parseArgs(argv) {
    const opts = { filter: '', jobs: Math.min(8, os.cpus().length || 4), timeout: 150, fresh: false, worker: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--worker')       opts.worker = argv[++i];
        else if (a === '--jobs' || a === '-j') opts.jobs = Math.max(1, parseInt(argv[++i], 10) || opts.jobs);
        else if (a === '--timeout') opts.timeout = Math.max(5, parseInt(argv[++i], 10) || opts.timeout);
        else if (a === '--fresh')   opts.fresh = true;
        else if (!a.startsWith('-')) opts.filter = a.toLowerCase();
    }
    return opts;
}

(async () => {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.worker) {
        NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
        await runWorkerMode(opts.worker);
        return;
    }
    await dispatcherMode(opts);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
