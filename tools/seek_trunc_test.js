#!/usr/bin/env node
// AH=40h CX=0 (truncate) + AH=42h 負 seek の headless 回帰 (2026-07-05)。
//
// 実 DOS 契約:
//   - AH=40h CX=0 は「現在位置でファイルを切り詰め/延長」(seek→write(0byte) でセーブを
//     短く書き直す定石。未対応だと旧データの尻尾が残り固定長パースが壊れる)
//   - AH=42h は whence=1/2 で先頭より前へ seek してもエラーにしない — 負の位置を DX:AX で
//     返し (CF=0)、後続の read/write が error 5 で失敗する (RBIL)。旧実装は fseek 失敗を
//     CF=1/AX=6 (invalid handle!) にしていた
//
// 合成 COM (下記 asm、nasm -f bin) が一気通貫で踏む:
//   1) AH=3Ch create T.DAT → 2) 16 byte write → 3) seek SET 8 → 4) AH=40h CX=0 (→ size 8)
//   5) seek END -100 → CF=0・DX:AX = 8-100 = -92 = FFFF:FFA4 を記録
//   6) 負位置で AH=3Fh read → CF=1・AX=5 を確認
//   7) seek SET 0 → read 4 → CF=0・AX=4・"AB" (負位置状態が解除される)
// 結果マーカ: [0x80]=全体 AA / [0x81]=負seekのCF(0) / [0x82]=負read AA / [0x83]=復帰read AA /
//             [0x84]word=負seekのAX(FFA4) / [0x86]word=DX(FFFF)
// harness 側でさらに MEMFS の /run/T.DAT が 8 byte に切り詰まったことを直接確認する。
//
// asm 原本 (nasm -f bin):
//   org 0x100
//   mov ah,3Ch / xor cx,cx / mov dx,fname / int 21h / jc fail / mov bx,ax
//   mov ah,40h / mov cx,16 / mov dx,data16 / int 21h / jc fail
//   mov ax,4200h / xor cx,cx / mov dx,8 / int 21h / jc fail
//   mov ah,40h / xor cx,cx / int 21h / jc fail            ; truncate @8
//   mov ax,4202h / mov cx,0FFFFh / mov dx,0FF9Ch / int 21h ; END-100
//   mov byte[81h],0 / jnc .nc / mov byte[81h],1 / .nc: mov [84h],ax / mov [86h],dx
//   mov ah,3Fh / mov cx,4 / mov dx,buf / int 21h           ; 負位置 read
//   jnc .bad2 / cmp ax,5 / jne .bad2 / mov byte[82h],0AAh / jmp .s3 / .bad2: mov byte[82h],1
//   .s3: mov ax,4200h / xor cx,cx / xor dx,dx / int 21h
//   mov ah,3Fh / mov cx,4 / mov dx,buf / int 21h
//   jc .bad3 / cmp ax,4 / jne .bad3 / cmp word[buf],4241h / jne .bad3
//   mov byte[83h],0AAh / jmp done / .bad3: mov byte[83h],1
//   done: mov byte[80h],0AAh / mov ax,4C00h / int 21h
//   fail: mov byte[80h],1 / mov ax,4C01h / int 21h
//   fname: db 'T.DAT',0 / data16: db 'ABCDEFGHIJKLMNOP' / buf: times 4 db 0
//
// 使い方: node tools/seek_trunc_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

const COM = Uint8Array.from([
    0xB4,0x3C,0x31,0xC9,0xBA,0xAE,0x01,0xCD,0x21,0x0F,0x82,0x97,0x00,0x89,0xC3,0xB4,
    0x40,0xB9,0x10,0x00,0xBA,0xB4,0x01,0xCD,0x21,0x0F,0x82,0x87,0x00,0xB8,0x00,0x42,
    0x31,0xC9,0xBA,0x08,0x00,0xCD,0x21,0x72,0x7B,0xB4,0x40,0x31,0xC9,0xCD,0x21,0x72,
    0x73,0xB8,0x02,0x42,0xB9,0xFF,0xFF,0xBA,0x9C,0xFF,0xCD,0x21,0xC6,0x06,0x81,0x00,
    0x00,0x73,0x05,0xC6,0x06,0x81,0x00,0x01,0xA3,0x84,0x00,0x89,0x16,0x86,0x00,0xB4,
    0x3F,0xB9,0x04,0x00,0xBA,0xC4,0x01,0xCD,0x21,0x73,0x0C,0x83,0xF8,0x05,0x75,0x07,
    0xC6,0x06,0x82,0x00,0xAA,0xEB,0x05,0xC6,0x06,0x82,0x00,0x01,0xB8,0x00,0x42,0x31,
    0xC9,0x31,0xD2,0xCD,0x21,0xB4,0x3F,0xB9,0x04,0x00,0xBA,0xC4,0x01,0xCD,0x21,0x72,
    0x14,0x83,0xF8,0x04,0x75,0x0F,0x81,0x3E,0xC4,0x01,0x41,0x42,0x75,0x07,0xC6,0x06,
    0x83,0x00,0xAA,0xEB,0x05,0xC6,0x06,0x83,0x00,0x01,0xC6,0x06,0x80,0x00,0xAA,0xB8,
    0x00,0x4C,0xCD,0x21,0xC6,0x06,0x80,0x00,0x01,0xB8,0x01,0x4C,0xCD,0x21,0x54,0x2E,
    0x44,0x41,0x54,0x00,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,
    0x4D,0x4E,0x4F,0x50,0x00,0x00,0x00,0x00,
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }
    try { M.FS.mkdir('/run'); } catch (_) {}   // ブラウザでは bridge.js/emu-worker.js が作る

    const peek8    = M.cwrap('np2kai_debug_peek8',  'number', ['number', 'number']);
    const runFrame = M.cwrap('np2kai_run_frame',    null,     ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'SEEKTR']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_com failed r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    let exited = 0;
    for (let f = 0; f < 1500; f++) {
        runFrame(handle);
        if (getExit(0)) { exited = 1; break; }
    }

    const mark  = (off) => peek8(handle, 0x1000 + off) & 0xff;
    const mark16 = (off) => mark(off) | (mark(off + 1) << 8);
    let size = -1;
    try { size = M.FS.stat('/run/T.DAT').size; } catch (_) {}

    const checks = [
        ['exited',                exited === 1,          exited],
        ['sequence [80]=AA',      mark(0x80) === 0xAA,   '0x' + mark(0x80).toString(16)],
        ['truncate size==8',      size === 8,            size],
        ['neg-seek CF=0',         mark(0x81) === 0,      mark(0x81)],
        ['neg-seek AX=FFA4',      mark16(0x84) === 0xFFA4, '0x' + mark16(0x84).toString(16)],
        ['neg-seek DX=FFFF',      mark16(0x86) === 0xFFFF, '0x' + mark16(0x86).toString(16)],
        ['neg-pos read CF=1/AX=5', mark(0x82) === 0xAA,  '0x' + mark(0x82).toString(16)],
        ['recover read "AB"',     mark(0x83) === 0xAA,   '0x' + mark(0x83).toString(16)],
    ];
    let pass = 0;
    for (const [name, ok, got] of checks) {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  (got ' + got + ')'}`);
        if (ok) pass++;
    }
    if (pass === checks.length) {
        console.log(`PASS ${pass}/${checks.length} — 40h CX=0 truncate + 42h 負 seek (実 DOS 意味論)`);
        process.exit(0);
    }
    console.log(`FAIL ${pass}/${checks.length}`);
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
