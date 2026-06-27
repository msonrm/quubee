#!/usr/bin/env node
// tsr_vsync_test.js — 最上位プログラムが AH=31h で TSR した後、halt loop 中も IF=1 で
// 常駐 ISR (ハードウェア割り込みフック) が走ることの headless 回帰 (2026-06-27)。
//
// 背景: FreeWay (frway102.lzh、FKS 作・1990) は VSYNC (PC-98 IRQ2 = INT 0Ah) をフックして
// 夜景/擬似 3D 道路をアニメーションさせる常駐ソフト (「3D ドライブ環境常駐ソフト」)。
// INT 21h AH=31h は IF をクリアした状態で入ってくるので、最上位 TSR の idle (halt loop) で
// IF を立て直さないと HLT が割り込みで起きず、常駐 ISR が一切走らない (画面が静止)。
// qb_dos_signal_tsr の最上位ブランチで CPU_FLAG |= I_FLAG する修正の回帰ガード
// (PMD 音楽 TSR の「IF=0 だと最初の1音だけ」と同型 [[reference_int27_oldstyle_tsr]])。
//
// 検証: freeway.com を COM ステージ → TSR まで進める → さらに数百フレーム回し、framebuffer の
// フレーム間ハッシュが変化する (= 常駐 VSYNC ISR が毎フレーム描画している = IF=1) ことを確認。
// 旧バグ (IF=0 idle) なら画面が静止しハッシュが 1 種類のまま。
//
// corpus は再配布不可のため local 限定 (games/fixture/frway102.lzh)。不在/lha 無しは SKIP。
// 使い方: node tools/tsr_vsync_test.js
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const LZH = path.join(ROOT, 'games', 'fixture', 'frway102.lzh');
const WORK = '/tmp/qb_frway_test';

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LZH)) skip('games/fixture/frway102.lzh 不在 (local-only corpus)');
if (cp.spawnSync('sh', ['-c', 'command -v lha']).status) skip('lha 不在');

// 展開 (freeway.com を取り出す)
fs.mkdirSync(WORK, { recursive: true });
cp.spawnSync('lha', ['xfw=' + WORK, LZH], { stdio: 'ignore' });
const comPath = path.join(WORK, 'freeway.com');
if (!fs.existsSync(comPath)) skip('freeway.com を展開できない');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    const img = new Uint8Array(fs.readFileSync(comPath));
    const ptr = M._malloc(img.length); M.HEAPU8.set(img, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'],
                       [ptr, img.length, '', 'FREEWAY.COM']);
    M._free(ptr);
    if (sr !== 0) { console.log('FAIL — stage_com r=' + sr); process.exit(1); }

    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const getFB    = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
    const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);
    function frameHash() {
        const p = getFB(handle, wP, hP, bP);
        const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
        if (!p || w <= 0 || h <= 0) return 0;
        const base = p >> 1, n = w * h; let hash = 0;
        for (let i = 0; i < n; i += 17) hash = (hash + M.HEAPU16[base + i] * (i + 1)) >>> 0;
        return hash;
    }

    // TSR まで進める (freeway は frame 0 で AH=31h 常駐)
    let f = 0, tsr = 0;
    for (; f < 600; f++) { runFrame(handle); if (getExit(0)) { tsr = 1; break; } }
    // TSR 後、常駐 VSYNC ISR の描画でフレームが変化するかを収集
    const hashes = [];
    for (let i = 0; i < 1500; i++) { runFrame(handle); if (i % 100 === 0) hashes.push(frameHash()); }
    const distinct = new Set(hashes.filter((x) => x !== 0)).size;

    let pass = 0, fail = 0;
    const check = (name, cond, extra) => {
        if (cond) { pass++; console.log(`  ok   ${name}`); }
        else      { fail++; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); }
    };
    check('freeway が TSR した (AH=31h → halt 検出)', tsr, `tsr=${tsr}`);
    check('TSR 後に常駐 VSYNC ISR が画面をアニメーション (IF=1)', distinct >= 2,
          `distinct frame hashes=${distinct} (>=2 ならアニメ動作)`);

    console.log(`\n${pass} passed, ${fail} failed  (distinct frame hashes=${distinct})`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
