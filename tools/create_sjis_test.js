#!/usr/bin/env node
// create_sjis_test.js — ゲスト (INT 21h AH=3Ch) が作る SJIS 名ファイルの正準化 round-trip 検証。
//
// 背景: MEMFS ノード名の正準形は「SJIS 生バイトを 1 文字 1 バイトで U+00xx に写した latin1
// JS 文字列」(JS 展開側はこの形で書く)。ところがゲストが INT 21h で作るファイルは C の
// fopen を経由し、Emscripten がパスを UTF-8 として復号する。生 SJIS は不正 UTF-8 なので
//   - 短いパス (≤16B) は手書きデコーダがリード後続バイトを巻き込んで混合破壊
//   - 長いパスは TextDecoder が不正バイトを U+FFFD に潰す (不可逆)
// 特に「東」(93 60) と「残」(8E 60) は両方 "�`" になり **別名ファイルが衝突して
// w+b の切り詰め上書き** が起き得た。2026-06-10 に fs_path_utf8 シム (dos_int21.c) で
// 「内部 = 生 SJIS、libc 直前で UTF-8(latin1) に符号化」に統一し根治。本テストはその回帰防止。
//
// 手順: 合成 COM が
//   1) AH=3Ch で "東.DAT" を作成 → 'A' を 1 byte write → close
//   2) AH=3Ch で "残.DAT" を作成 → 'B' を 1 byte write → close
//   3) AH=3Dh で "東.DAT" を再 open → 1 byte を DS:0090 へ read → close
//   4) 成功なら [0x0080]=0xAA、失敗なら 0x01 で AH=4Ch 終了
// harness は終了後に
//   - result(0x1080)==0xAA かつ readback(0x1090)=='A' … 再 open が「残」に衝突していない
//   - JS 側 FS.readdir('/run') に latin1 正準名 "\x93\x60.DAT" と "\x8E\x60.DAT" が
//     **別々に** 存在し (U+FFFD 無し)、内容がそれぞれ 'A' / 'B' … 正準形とコンテンツ無破壊
// を確認する。
//
// 使い方: node tools/create_sjis_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// 合成 COM (org 0x100)。手アセンブル。ラベル位置は末尾コメントの通り。
//   0x100 create 東.DAT / 0x11B create 残.DAT / 0x136 reopen 東.DAT
//   0x153 success / 0x15A fail / 0x15F done
//   0x163 name1("東.DAT") / 0x16A name2("残.DAT") / 0x171 'A' / 0x172 'B'
const COM = Uint8Array.from([
    // create 東.DAT → write 'A' → close
    0xBA,0x63,0x01,            // MOV DX, 0x0163 (name1)
    0x31,0xC9,                 // XOR CX,CX
    0xB4,0x3C, 0xCD,0x21,      // AH=3Ch create
    0x72,0x4F,                 // JC fail
    0x89,0xC3,                 // MOV BX,AX
    0xBA,0x71,0x01,            // MOV DX, 0x0171 ('A')
    0xB9,0x01,0x00,            // MOV CX,1
    0xB4,0x40, 0xCD,0x21,      // AH=40h write
    0xB4,0x3E, 0xCD,0x21,      // AH=3Eh close
    // create 残.DAT → write 'B' → close
    0xBA,0x6A,0x01,            // MOV DX, 0x016A (name2)
    0x31,0xC9,
    0xB4,0x3C, 0xCD,0x21,
    0x72,0x34,                 // JC fail
    0x89,0xC3,
    0xBA,0x72,0x01,            // MOV DX, 0x0172 ('B')
    0xB9,0x01,0x00,
    0xB4,0x40, 0xCD,0x21,
    0xB4,0x3E, 0xCD,0x21,
    // reopen 東.DAT → read 1 byte to [0x0090] → close
    0xBA,0x63,0x01,            // MOV DX, name1
    0x30,0xC0,                 // XOR AL,AL (read mode)
    0xB4,0x3D, 0xCD,0x21,      // AH=3Dh open
    0x72,0x19,                 // JC fail
    0x89,0xC3,
    0xBA,0x90,0x00,            // MOV DX, 0x0090
    0xB9,0x01,0x00,
    0xB4,0x3F, 0xCD,0x21,      // AH=3Fh read
    0x72,0x0B,                 // JC fail
    0xB4,0x3E, 0xCD,0x21,
    // success
    0xC6,0x06,0x80,0x00,0xAA,  // MOV BYTE [0x0080], 0xAA
    0xEB,0x05,                 // JMP done
    // fail
    0xC6,0x06,0x80,0x00,0x01,
    // done
    0xB4,0x4C, 0xCD,0x21,      // AH=4Ch terminate
    // data
    0x93,0x60,0x2E,0x44,0x41,0x54,0x00,   // "東.DAT" (SJIS 93 60)
    0x8E,0x60,0x2E,0x44,0x41,0x54,0x00,   // "残.DAT" (SJIS 8E 60)
    0x41, 0x42,                           // 'A', 'B'
]);

const NAME_HIGASHI = String.fromCharCode(0x93, 0x60) + '.DAT';   // latin1 正準名
const NAME_ZAN     = String.fromCharCode(0x8E, 0x60) + '.DAT';

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    try { M.FS.mkdir('/run'); } catch (_) {}

    const peek8    = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const runFrame = M.cwrap('np2kai_run_frame',   null,     ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit','number', ['number']);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'CREATESJIS']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_com failed r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    let exited = 0;
    for (let f = 0; f < 1500; f++) {
        runFrame(handle);
        if (getExit(0)) { exited = 1; break; }
    }

    const result   = peek8(handle, 0x1080) & 0xff;
    const readback = peek8(handle, 0x1090) & 0xff;

    // JS 側からノード名を検査 (正準形 = latin1 = 全コードポイント ≤ 0xFF、U+FFFD 無し)
    const names = M.FS.readdir('/run').filter(n => n !== '.' && n !== '..');
    const cps = (s) => [...s].map(c => c.codePointAt(0).toString(16)).join(' ');
    const hasHigashi = names.includes(NAME_HIGASHI);
    const hasZan     = names.includes(NAME_ZAN);
    const noFFFD     = names.every(n => !n.includes('�'));
    let contentOk = false;
    if (hasHigashi && hasZan) {
        const a = M.FS.readFile('/run/' + NAME_HIGASHI);
        const b = M.FS.readFile('/run/' + NAME_ZAN);
        contentOk = a.length === 1 && a[0] === 0x41 && b.length === 1 && b[0] === 0x42;
    }

    console.log(`exited=${exited} result=0x${result.toString(16)} readback=0x${readback.toString(16)}`);
    console.log(`/run nodes: ${names.map(n => `[${cps(n)}]`).join(' ')}`);

    const pass = exited === 1 && result === 0xAA && readback === 0x41 &&
                 hasHigashi && hasZan && noFFFD && contentOk;
    if (pass) {
        console.log('PASS — ゲスト生成 SJIS 名が latin1 正準形で保存され、東/残 が衝突せず round-trip 成立');
        process.exit(0);
    }
    console.log('FAIL', { exited, result: '0x' + result.toString(16), readback: '0x' + readback.toString(16),
                          hasHigashi, hasZan, noFFFD, contentOk });
    if (!noFFFD) console.log('  → ノード名に U+FFFD = fopen パスが生 SJIS のまま libc へ渡っている (修正前の症状)');
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
