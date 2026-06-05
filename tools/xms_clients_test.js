#!/usr/bin/env node
// 実 XMS クライアント検証 (2026-06-05) — Tier1 XMS HLE を「実 DOS エディタ」で叩く headless スモーク。
//
// 目的 (互換性の長尾, EMS 据え置きの裏付け):
//   静的サーベイ (tools 外) で games/mem_test の EMS 使用 5 本 (VZ/5ds/amel/jed/mm46) は
//   全て XMS も叩くと判明 = EMS 専用タイトルはゼロ。ならば我々の XMS Tier1 がこれら実エディタを
//   実際に服すれば EMS HLE は不要。本テストは各エディタの実 EXE を loader にステージして数千フレーム
//   走らせ、以下を観測する:
//     - XMS 検出 (memprobe.xms>0) … エディタが INT 2Fh AX=4300 を叩いたか
//     - XMS 確保 (run 中 handles>0 / usedKB>0) … 我々の HLE 経由で実際に EMB を取れたか
//     - 未実装 fn 警告 ([xms] unimplemented AH=XX) … Tier1 の穴を実クライアントで炙り出す
//     - EMS への落下 (memprobe.ems / emmOpen) … XMS で足りず EMS を試したか (>0 なら EMS 価値あり)
//   エディタは対話型なので exit はしない。startup の拡張メモリ初期化フェーズを捕捉できれば十分。
//
// corpus は再配布不可・local 限定 (.gitignore /games/*)。不在なら SKIP (CI でも安全)。
// 展開ツール (lha/unzip) が無い・loader.d88 が無い場合も SKIP。
//
// 使い方: node tools/xms_clients_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const CORPUS = path.join(ROOT, 'games', 'mem_test');
const WORK   = '/tmp/qb_xms_clients';

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (bash tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');
if (!fs.existsSync(CORPUS)) skip('games/mem_test 不在 (local-only corpus)');
const HAVE_LHA   = !cp.spawnSync('sh', ['-c', 'command -v lha']).status;
const HAVE_UNZIP = !cp.spawnSync('sh', ['-c', 'command -v unzip']).status;

// 検証対象 (静的サーベイで EMS+XMS 併用と判明したエディタ群、クリーンに展開できる LZH のみ)。
// cmd: AMEL は /X で XMS を要求 (memory: 338KB 実証)。他は自動検出 (空 cmdline)。
const TITLES = [
    { archive: '5ds131.lzh',  exe: '5ds.exe',  cmd: '',   name: '5DS.EXE'  },
    { archive: 'amel133.lzh', exe: 'amel.exe', cmd: '/X', name: 'AMEL.EXE' },
    { archive: 'jed194n.lzh', exe: 'jed.exe',  cmd: '',   name: 'JED.EXE'  },
    { archive: 'mm46sp98.lzh',exe: 'mm46.exe', cmd: '',   name: 'MM46.EXE' },
];

const FRAMES = 3000;   // headless POST(~1k) + エディタ startup の拡張メモリ初期化を十分跨ぐ

function extract(archive) {
    const dir = path.join(WORK, archive + '.d');
    if (fs.existsSync(dir)) return dir;
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(CORPUS, archive);
    if (/\.lzh$/i.test(archive)) {
        if (!HAVE_LHA) return null;
        cp.spawnSync('lha', ['xw=' + dir, src], { stdio: 'ignore' });
    } else if (/\.zip$/i.test(archive)) {
        if (!HAVE_UNZIP) return null;
        cp.spawnSync('unzip', ['-o', '-d', dir, src], { stdio: 'ignore' });
    } else return null;
    return dir;
}

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

async function runTitle(t) {
    const dir = extract(t.archive);
    if (!dir) return { name: t.name, skipped: '展開ツール無し' };
    const exePath = path.join(dir, t.exe);
    if (!fs.existsSync(exePath)) return { name: t.name, skipped: t.exe + ' 不在' };

    const logs = [];   // [xms] / [memprobe] stderr
    const M = await NP2KaiModule({
        noInitialRun: true, print: () => {},
        printErr: (s) => { s = String(s); if (/\[xms\]|\[memprobe\]/.test(s)) logs.push(s.trim()); },
    });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) return { name: t.name, skipped: 'create 失敗' };

    // エディタの全ファイルを /run/ へフラット配置 (loader が case-insensitive 解決)。
    try { M.FS.mkdir('/run'); } catch (_) {}
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isFile()) M.FS.writeFile('/run/' + f, new Uint8Array(fs.readFileSync(p)));
    }

    // 主 EXE をメモリへステージ。
    const exe = new Uint8Array(fs.readFileSync(exePath));
    const ptr = M._malloc(exe.length);
    M.HEAPU8.set(exe, ptr);
    const sr = M.ccall('np2kai_dos_stage_exe', 'number',
        ['number', 'number', 'string', 'string'], [ptr, exe.length, t.cmd, t.name]);
    M._free(ptr);
    if (sr !== 0) return { name: t.name, stageErr: sr };

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame',     null,    ['number']);
    const xmsStat  = M.cwrap('np2kai_xms_stat',      'number',['number','number']);
    const memprobe = M.cwrap('np2kai_debug_memprobe','number',['number','number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit',  'number',['number']);
    const linPc    = M.cwrap('np2kai_debug_get_linear_pc','number',['number']);

    let maxHandles = 0, maxUsedKB = 0, exited = 0;
    for (let f = 0; f < FRAMES; f++) {
        runFrame(handle);
        const h = xmsStat(handle, 1); if (h > maxHandles) maxHandles = h;
        const u = (xmsStat(handle, 2) / 1024) | 0; if (u > maxUsedKB) maxUsedKB = u;
        if (getExit(0)) { exited = 1; break; }
    }
    const finalPc = linPc(handle) >>> 0;
    // BIOS neccheck 危険域 (FreeDOS hang と同じ 0xE8000-0xFFFFF) に居座っていないか
    const inBiosDanger = finalPc >= 0xE8000 && finalPc <= 0xFFFFF;

    return {
        name: t.name,
        xms:     memprobe(handle, 0),
        ems:     memprobe(handle, 1),
        emmOpen: memprobe(handle, 2),
        maxHandles, maxUsedKB, exited, finalPc, inBiosDanger,
        unimpl: logs.filter((l) => /unimplemented AH=/.test(l)),
        logs,
    };
}

(async () => {
    const results = [];
    for (const t of TITLES) results.push(await runTitle(t));

    console.log('==== 実 XMS クライアント検証 (Tier1 XMS HLE × 実 DOS エディタ) ====\n');
    let anyXmsAlloc = false, anyUnimpl = false, anyEms = false, ran = 0;
    for (const r of results) {
        if (r.skipped) { console.log(`[${r.name}] SKIP — ${r.skipped}`); continue; }
        if (r.stageErr !== undefined) { console.log(`[${r.name}] stage_exe 失敗 r=${r.stageErr}`); continue; }
        ran++;
        const alloc = r.maxHandles > 0 || r.maxUsedKB > 0;
        anyXmsAlloc = anyXmsAlloc || alloc;
        anyUnimpl   = anyUnimpl   || r.unimpl.length > 0;
        anyEms      = anyEms      || r.ems > 0 || r.emmOpen > 0;
        console.log(`[${r.name}]`);
        console.log(`   XMS 検出=${r.xms}  確保=${alloc ? `YES (handles=${r.maxHandles}, ${r.maxUsedKB}KB)` : 'no'}` +
                    `  EMS落下=${r.ems}/emmOpen=${r.emmOpen}`);
        console.log(`   未実装fn=${r.unimpl.length ? r.unimpl.join(' / ') : 'なし'}` +
                    `  finalPC=0x${r.finalPc.toString(16)}${r.inBiosDanger ? ' ⚠BIOS危険域' : ''}`);
        if (r.logs.length) console.log('   log: ' + r.logs.slice(0, 6).join(' | '));
        console.log();
    }

    console.log('---- まとめ ----');
    console.log(`走らせたタイトル: ${ran}/${TITLES.length}`);
    console.log(`XMS 実確保が成立: ${anyXmsAlloc ? 'YES (Tier1 が実エディタを服した)' : 'NO'}`);
    console.log(`未実装fn を叩いた: ${anyUnimpl ? 'YES (Tier1 に穴あり→要対応)' : 'なし (Tier1 で足りている)'}`);
    console.log(`EMS へ落下したか:  ${anyEms ? 'YES (EMS HLE に価値あり)' : 'なし (XMS で足り EMS 不要の傍証)'}`);

    // PASS 条件: 少なくとも 1 本で XMS 実確保が成立し、未実装 fn を一切叩かない
    // (= Tier1 が実クライアントを穴なく服する)。EMS 落下の有無は情報として表示するのみ。
    if (ran === 0) skip('展開できたタイトルが無い');
    if (anyXmsAlloc && !anyUnimpl) {
        console.log('\nPASS — 実 DOS エディタが Tier1 XMS で EMB を確保でき、未実装 fn も無し');
        process.exit(0);
    }
    console.log('\nFAIL — XMS 実確保が無い or 未実装 fn を叩いた (詳細は上記 log)');
    process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
