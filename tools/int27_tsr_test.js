#!/usr/bin/env node
// int27_tsr_test.js — INT 27h (Terminate and Stay Resident, DOS 1.x 旧式) の headless 検証。
//
// 背景: MS Mouse Driver 7.06 等の旧式マウスドライバは INT 33h を hook した後、
// `int 27h` で自身を常駐させる (AH=31h の byte-単位・終了コード 0 固定版)。INT 27h が
// 未実装 (IRET スタブ) だと `int 27h` が素通りして直下の命令に「フォールスルー」し、
// ドライバの後始末 (AH=4Ch 通常終了) に落ちて自身を解放 → hook 済 INT 33h ベクタが
// 解放メモリを指すダングリングになり、後続ゲームが INT 33h を呼ぶと暴走する
// (= games/mouse.com「起動すると停止」の真因。2026-06-25 根治)。
//
// 合成 COM (org 0x100、25 byte):
//   C6 06 80 00 11   mov byte [0x0080], 0x11   ; "ran" マーカ (PSP:0x80 = linear 0x1080)
//   C6 06 81 00 00   mov byte [0x0081], 0x00   ; フォールスルー マーカをクリア
//   BA 00 02         mov dx, 0x0200            ; 常駐 512 byte
//   CD 27            int 0x27                  ; TSR — 正常なら親/halt へ飛び、以降は実行されない
//   C6 06 81 00 EE   mov byte [0x0081], 0xEE   ; ★フォールスルー時のみ到達 (INT 27h が no-op だった)
//   B8 00 4C         mov ax, 0x4C00
//   CD 21            int 0x21
// 判定: [0x1080]==0x11 (実行された) かつ [0x1081]!=0xEE (フォールスルーせず = TSR された)。
//   旧実装 (INT 27h=IRET スタブ) では [0x1081]==0xEE になり FAIL する (判別力あり)。
//
// 使い方: node tools/int27_tsr_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

const COM = Uint8Array.from([
    0xc6, 0x06, 0x80, 0x00, 0x11,   // mov byte [0x80], 0x11   ; ran
    0xc6, 0x06, 0x81, 0x00, 0x00,   // mov byte [0x81], 0x00   ; clear fall-through marker
    0xba, 0x00, 0x02,               // mov dx, 0x0200
    0xcd, 0x27,                     // int 0x27                ; TSR
    0xc6, 0x06, 0x81, 0x00, 0xee,   // mov byte [0x81], 0xEE   ; fall-through only
    0xb8, 0x00, 0x4c,               // mov ax, 0x4C00
    0xcd, 0x21,                     // int 0x21
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const r = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'INT27.COM']);
    M._free(ptr);
    if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const pk       = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);

    let exited = 0;
    for (let f = 0; f < 1200; f++) {
        runFrame(handle);
        if (getExit(0)) { exited = 1; break; }
    }

    // COM は PSP=0x0100 にロード → [0x80]=linear 0x1080, [0x81]=linear 0x1081
    const ran        = pk(handle, 0x1080);
    const fellThru   = pk(handle, 0x1081);
    console.log(`exited=${exited} ran=0x${ran.toString(16)} fallThrough=0x${fellThru.toString(16)}`);

    if (ran !== 0x11) { console.log('FAIL — COM が実行されていない (ran=0x' + ran.toString(16) + ')'); process.exit(1); }
    if (fellThru === 0xEE) {
        console.log('FAIL — int 27h が素通りし AH=4Ch にフォールスルー (INT 27h 未実装 = mouse.com「停止」の症状)');
        process.exit(1);
    }
    if (!exited) { console.log('FAIL — TSR 後に halt へ到達していない'); process.exit(1); }
    console.log('PASS — int 27h が TSR として処理され、直下の AH=4Ch 通常終了に落ちない (常駐 = INT 33h ダングリング解消)');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
