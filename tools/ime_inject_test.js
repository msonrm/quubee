#!/usr/bin/env node
// ホスト IME 注入経路の headless 検証 (2026-06-21 新設)。
//
// 背景: PC-98 DOS に FEP を持ち込まず、ホスト (ブラウザ) の IME で確定したかな漢字混じり文字列を
// Shift-JIS バイト列にして np2kai_inject_text でゲストの DOS 文字入力に注入する経路を新設した
// (native/dos_int21.c の g_inject_buf FIFO + bridge.c np2kai_inject_text)。dos_next_input_byte が
// キーバッファより優先して 1 バイトずつ返すので、ゲストには「FEP が確定文字列をタイプした」のと
// 区別がつかない。VZ も INT 21h 文字入力経路でキーを読むので、この経路でエディタに日本語が入る。
//
// 合成 COM: AH=07h (raw char input) で 6 バイトを DS:0082 へ読み込み、DS:0080=0xAA をセットして
// AH=4Ch 終了。テストは「日本語」(SJIS 93 fa 96 7b 8c ea) を注入し、ゲストが読み取ったバイト列が
// 完全一致することを確認する (注入が DOS 文字入力に届き、2 バイト SJIS がリード+トレイル順に渡る)。
//
//   org 0x100
//       mov si, 0x0082        ; BE 82 00
//       mov cx, 6             ; B9 06 00
//   read:                     ; @0x106
//       mov ah, 0x07          ; B4 07
//       int 0x21              ; CD 21   -> AL = char
//       mov [si], al          ; 88 04
//       inc si                ; 46
//       loop read             ; E2 F7   (rel8 -> 0x106)
//       mov byte [0x80], 0xAA ; C6 06 80 00 AA
//       mov ax, 0x4C00        ; B8 00 4C
//       int 0x21              ; CD 21
//
// 使い方: node tools/ime_inject_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

const COM = Uint8Array.from([
    0xBE, 0x82, 0x00, 0xB9, 0x06, 0x00, 0xB4, 0x07, 0xCD, 0x21, 0x88, 0x04,
    0x46, 0xE2, 0xF7, 0xC6, 0x06, 0x80, 0x00, 0xAA, 0xB8, 0x00, 0x4C, 0xCD, 0x21,
]);
const INJECT = Uint8Array.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);  // "日本語" (SJIS)

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);

    const ptr = M._malloc(COM.length); M.HEAPU8.set(COM, ptr);
    const r = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'IMETEST.COM']);
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

    // COM がロードされ最初の AH=07h で入力待ち (ブロック) になるまで進める。
    // 注入は loader-start (tty_reset で FIFO クリア) の後で行う必要があるのでここまで待つ。
    for (let f = 0; f < 300; f++) runFrame(handle);

    const ip = M._malloc(INJECT.length); M.HEAPU8.set(INJECT, ip);
    const acc = inject(handle, ip, INJECT.length);
    M._free(ip);

    let exited = 0;
    for (let f = 0; f < 600; f++) { runFrame(handle); if (getExit(0)) { exited = 1; break; } }

    // COM は PSP=0x0100 → DS:0080 = linear 0x1080
    const flag = pk(handle, 0x1080);
    const got = [];
    for (let i = 0; i < INJECT.length; i++) got.push(pk(handle, 0x1082 + i));
    const want = Array.from(INJECT);
    const match = got.length === want.length && got.every((b, i) => b === want[i]);
    const hex = a => a.map(b => b.toString(16).padStart(2, '0')).join(' ');

    console.log(`accepted=${acc} exited=${exited} flag=0x${flag.toString(16)}`);
    console.log(`got : ${hex(got)}`);
    console.log(`want: ${hex(want)}  ("日本語" SJIS)`);

    if (acc !== INJECT.length) { console.log('FAIL — np2kai_inject_text の受理数が不一致'); process.exit(1); }
    if (!exited)        { console.log('FAIL — COM が終了しない (注入が文字入力に届かずブロックし続け?)'); process.exit(1); }
    if (flag !== 0xAA)  { console.log('FAIL — COM が 6 バイト読み切れていない (flag != 0xAA)'); process.exit(1); }
    if (!match)         { console.log('FAIL — ゲストが読んだバイト列が注入と不一致'); process.exit(1); }
    console.log('PASS — ホスト IME 注入が DOS 文字入力に 1 バイトずつ届き、SJIS "日本語" を完全一致で受領');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
