#!/usr/bin/env node
// int21_diag_test.js — INT 21h 診断カウンタ (未実装 AH 踏み検出、2026-07-12) の回帰。
//
// 合成 COM が未実装 AH=5Eh (network machine name) を 2 回呼んでから AH=4Ch で終了する。
//   ① np2kai_debug_int21_unimpl(0x5E) == 2 (未実装踏みが計上される)
//   ② np2kai_debug_int21_count(0x5E) == 2 / (0x4C) == 1 (呼び出し数も整合)
//   ③ 実装済み AH は unimpl に計上されない
// 素材不要 (合成 COM のみ)・SKIP 無し。CLI/MCP はこのカウンタを int21Unimplemented として報告する。

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

const COM = Buffer.from([
    0xB4, 0x5E,             // mov ah,5Eh   (未実装)
    0x30, 0xC0,             // xor al,al
    0xCD, 0x21,             // int 21h
    0xB4, 0x5E,             // mov ah,5Eh   (2 回目)
    0xCD, 0x21,             // int 21h
    0xB8, 0x00, 0x4C,       // mov ax,4C00h
    0xCD, 0x21,             // int 21h
]);

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const h = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}

    const ptr = M._malloc(COM.length); M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'],
        [ptr, COM.length, '', 'DIAG.COM']);
    M._free(ptr);
    if (sr !== 0) { console.log('✗ stage_com 失敗 r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [h]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    let exited = false;
    for (let f = 0; f < 600 && !exited; f++) { runFrame(h); if (getExit(0)) exited = true; }
    check('合成 COM が AH=4Ch まで完走 (未実装 AH は CF=1 で素通り)', exited);

    const cnt = (ah) => M.ccall('np2kai_debug_int21_count', 'number', ['number'], [ah]);
    const uni = (ah) => M.ccall('np2kai_debug_int21_unimpl', 'number', ['number'], [ah]);
    check('未実装 AH=5Eh の踏みが 2 回計上される', uni(0x5E) === 2, 'unimpl=' + uni(0x5E));
    check('呼び出し数も整合 (5Eh=2, 4Ch=1)', cnt(0x5E) === 2 && cnt(0x4C) === 1,
        `5E=${cnt(0x5E)} 4C=${cnt(0x4C)}`);
    check('実装済み AH (4Ch) は unimpl に計上されない', uni(0x4C) === 0, 'unimpl(4C)=' + uni(0x4C));

    console.log(`\nint21_diag_test: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL —', e.message || e); process.exit(1); });
