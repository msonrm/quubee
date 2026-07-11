#!/usr/bin/env node
// com_memown_test.js — 最上位 COM の実 DOS 相当メモリ所有 (gaps §4-20 解消、2026-07-11) の回帰。
//
// 実 DOS: 最上位プログラムは起動時に空きメモリを丸ごと所有する。よって
//   ① self-shrink (AH=4Ah) 前の AH=48h は失敗し largest=0 (旧実装は 64KB 固定 + 直上アリーナで
//     「シュリンク無し確保」が実機に無い形で成功していた = ここを falsify)
//   ② self-shrink 後は解放された空きが見える (largest が大きい) — 実機の作法どおりの手順は通る
// を、合成 COM (シュリンク前後で AH=48h BX=FFFF プローブの CF/largest を固定番地へ書く) で検証する。
// 素材不要 (合成 COM のみ)・SKIP 無し。
//
// COM (org 100h):
//   mov ah,48h / mov bx,0FFFFh / int 21h        ; プローブ 1 (シュリンク前)
//   mov [0200h],bx / pushf / pop ax / mov [0202h],ax
//   mov sp,0FFEh                                 ; スタックを KEEP 領域へ退避 (実機の作法)
//   mov ah,4Ah / mov bx,0100h / push cs / pop es / int 21h   ; self-shrink (4KB 保持)
//   mov ah,48h / mov bx,0FFFFh / int 21h        ; プローブ 2 (シュリンク後)
//   mov [0204h],bx / pushf / pop ax / mov [0206h],ax
//   mov ax,4C00h / int 21h

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

const COM = Buffer.from([
    0xB4, 0x48,             // mov ah,48h
    0xBB, 0xFF, 0xFF,       // mov bx,0FFFFh
    0xCD, 0x21,             // int 21h
    0x89, 0x1E, 0x00, 0x02, // mov [0200h],bx
    0x9C,                   // pushf
    0x58,                   // pop ax
    0xA3, 0x02, 0x02,       // mov [0202h],ax
    0xBC, 0xFE, 0x0F,       // mov sp,0FFEh
    0xB4, 0x4A,             // mov ah,4Ah
    0xBB, 0x00, 0x01,       // mov bx,0100h
    0x0E,                   // push cs
    0x07,                   // pop es
    0xCD, 0x21,             // int 21h
    0xB4, 0x48,             // mov ah,48h
    0xBB, 0xFF, 0xFF,       // mov bx,0FFFFh
    0xCD, 0x21,             // int 21h
    0x89, 0x1E, 0x04, 0x02, // mov [0204h],bx
    0x9C,                   // pushf
    0x58,                   // pop ax
    0xA3, 0x06, 0x02,       // mov [0206h],ax
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
        [ptr, COM.length, '', 'MEMOWN.COM']);
    M._free(ptr);
    if (sr !== 0) { console.log('✗ stage_com 失敗 r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [h]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    let exited = false;
    for (let f = 0; f < 600 && !exited; f++) { runFrame(h); if (getExit(0)) exited = true; }
    check('合成 COM が AH=4Ch まで完走', exited);

    const peek = (a) => M.ccall('np2kai_debug_peek8', 'number', ['number', 'number'], [h, a]);
    const word = (a) => peek(a) | (peek(a + 1) << 8);   // PSP=0x0100 → linear 0x1000 + off
    const largest1 = word(0x1200), flags1 = word(0x1202);
    const largest2 = word(0x1204), flags2 = word(0x1206);

    // ① シュリンク前: 実 DOS = プログラムが全所有 → 失敗 (CF=1)・largest=0
    check('シュリンク前の AH=48h は CF=1', (flags1 & 1) === 1, 'flags=0x' + flags1.toString(16));
    check('シュリンク前の largest=0 (全所有)', largest1 === 0,
        'largest=0x' + largest1.toString(16) + ' (旧 64KB 固定実装だと ~0x8E00)');
    // ② シュリンク後: 解放された空きが見える (BX=FFFF 自体は依然大きすぎて CF=1)
    check('シュリンク後も BX=FFFF は CF=1', (flags2 & 1) === 1, 'flags=0x' + flags2.toString(16));
    check('シュリンク後は largest が大きい (>=0x8000 paras)', largest2 >= 0x8000,
        'largest=0x' + largest2.toString(16));

    console.log(`\ncom_memown_test: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL —', e.message || e); process.exit(1); });
