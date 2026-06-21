#!/usr/bin/env node
// ホスト IME 注入が BIOS INT 18h 直読みアプリにも届くことの headless 検証 (2026-06-21 新設)。
//
// 背景: 注入バイトは当初 DOS 文字入力 (dos_next_input_byte) 専用 FIFO に積んでおり、BIOS INT 18h
// (bios18.c keyget、0x502 を直読み) や DOS AH=0Ah はそれを見ないため取りこぼしていた (VZ Editor の
// 起動時 Y/N プロンプトがツールバーから答えられなかった真因)。修正 = 注入 FIFO を実 BIOS キーバッファ
// (0x502) へ inject_pump でペース供給 (投入時 + np2kai_run_frame 毎 + dos_next_input_byte 毎)。これで
// 0x502 を読む全経路 (BIOS INT 18h / DOS AH=01/06/07/08 / AH=0Ah) が物理キーと同じ扱いで注入を受ける。
//
// 合成 COM: INT 18h AH=00h (keyget、空なら 0xFFFF を返す非ブロッキング) を 0xFFFF の間リトライしつつ
// 3 バイトを DS:0082 へ読み込み、DS:0080=0xAA をセットして AH=4Ch 終了。"あ"(SJIS 82 a0)+"Y"(59) を
// 注入し、BIOS 経路で読んだ 3 バイトが完全一致することを確認 (2 バイト SJIS のリード/トレイルも素通り)。
//
//   org 0x100
//       mov si, 0x0082        ; BE 82 00
//       mov cx, 3             ; B9 03 00
//   read:                     ; @0x106
//       mov ah, 0x00          ; B4 00
//       int 0x18              ; CD 18    -> AX = keyget() (0xFFFF=空)
//       cmp ax, 0xffff        ; 3D FF FF
//       je read               ; 74 F7
//       mov [si], al          ; 88 04
//       inc si                ; 46
//       loop read             ; E2 F2
//       mov byte [0x80], 0xAA ; C6 06 80 00 AA
//       mov ax, 0x4C00        ; B8 00 4C
//       int 0x21              ; CD 21
//
// 使い方: node tools/ime_inject_bios_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

const COM = Uint8Array.from([
    0xBE, 0x82, 0x00, 0xB9, 0x03, 0x00, 0xB4, 0x00, 0xCD, 0x18, 0x3D, 0xFF,
    0xFF, 0x74, 0xF7, 0x88, 0x04, 0x46, 0xE2, 0xF2, 0xC6, 0x06, 0x80, 0x00,
    0xAA, 0xB8, 0x00, 0x4C, 0xCD, 0x21,
]);
const INJECT = Uint8Array.from([0x82, 0xa0, 0x59]);  // "あ" (SJIS 82 a0) + "Y" (59)

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);

    const ptr = M._malloc(COM.length); M.HEAPU8.set(COM, ptr);
    const r = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'IME18.COM']);
    M._free(ptr);
    if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const inject   = M.cwrap('np2kai_inject_text', 'number', ['number', 'number', 'number']);
    const pk       = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);

    // COM が起動し INT 18h のリトライループに入るまで進めてから注入 (loader-start の FIFO クリア後)。
    for (let f = 0; f < 300; f++) runFrame(handle);

    const ip = M._malloc(INJECT.length); M.HEAPU8.set(INJECT, ip);
    inject(handle, ip, INJECT.length);
    M._free(ip);

    let exited = 0;
    for (let f = 0; f < 600; f++) { runFrame(handle); if (getExit(0)) { exited = 1; break; } }

    const flag = pk(handle, 0x1080);
    const got = [];
    for (let i = 0; i < INJECT.length; i++) got.push(pk(handle, 0x1082 + i));
    const want = Array.from(INJECT);
    const match = got.length === want.length && got.every((b, i) => b === want[i]);
    const hex = a => a.map(b => b.toString(16).padStart(2, '0')).join(' ');

    console.log(`exited=${exited} flag=0x${flag.toString(16)}`);
    console.log(`got : ${hex(got)}`);
    console.log(`want: ${hex(want)}  ("あ"+"Y" via INT 18h)`);

    if (!exited)       { console.log('FAIL — COM が終了しない (BIOS INT 18h に注入が届かず 0xFFFF を読み続け?)'); process.exit(1); }
    if (flag !== 0xAA) { console.log('FAIL — 3 バイト読み切れていない (flag != 0xAA)'); process.exit(1); }
    if (!match)        { console.log('FAIL — BIOS INT 18h で読んだバイト列が注入と不一致'); process.exit(1); }
    console.log('PASS — ホスト IME 注入が BIOS INT 18h 直読み (0x502) にも届き、SJIS+ASCII を完全一致で受領');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
