#!/usr/bin/env node
// find_sjis_test.js — SJIS ファイル名の FindFirst(AH=4Eh) → Open(AH=3Dh) round-trip の headless 検証。
//
// 背景: MEMFS のノード名はフロントエンド (archive.js) が SJIS バイトを latin1 文字列として書くので、
// C 側 readdir の d_name は UTF-8 (0x80-0xFF が C2/C3 xx に膨張) になる。open 経路 (ci_equal_fsname)
// は d_name を「元の生 SJIS バイト」に畳んで比較するが、find 経路 (dta_write_find / dos_wildcard_match)
// は以前 d_name(UTF-8) を畳まず DTA へ書いていた → ゲームが FindFirst で得た名前を再 open すると
// open 側は SJIS を期待して不一致 (かつ 8.3 枠でマルチバイト境界の途中で切れる)。
// 2026-06-10 に find 経路も fold_fsname_to_sjis で生 SJIS に揃えて対称化。本テストはその回帰防止。
//
// 手順: 合成 COM が
//   1) FindFirst "*.*" (CX=0) で /run 内の唯一のファイル (SJIS 名 "漢字漢字.DAT" = 8.3 ぴったり 12 byte) を引く
//   2) DTA+0x1E (= PSP:009E) の返却名をそのまま AH=3Dh で open
//   3) 成功なら DS:0080 に 0xAA、失敗なら 0x01 を書いて AH=4Ch 終了
// harness は終了後に
//   - result(0x1080) == 0xAA          … 返却名で再 open できた = round-trip 成立
//   - DTA 名 (0x109E..) == 生 SJIS 12 byte + NUL  … UTF-8 の C2 8A でなく・中途切断もされていない
// を確認する。
//
// なぜ 4 漢字 (= SJIS 12 byte ちょうど) の名前か: Emscripten の fopen は UTF-8 パスを latin1 ノード名へ
// 復号して開くので、UTF-8 が 12 byte 以内に収まる短い SJIS 名だと、修正前 (DTA に UTF-8 のまま書く) でも
// 再 open がたまたま成功してしまい判別できない。SJIS 12 byte の名前は UTF-8 で 20 byte に膨れ、DTA の
// 8.3 枠 (12 byte) で「マルチバイトの途中」で切れる → 修正前は再 open が実際に失敗 (0x01) する。これで
// result 検査も DTA-name 検査も両方が修正前 FAIL / 修正後 PASS の判別力を持つ (実害の再現)。
//
// 使い方: node tools/find_sjis_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// 合成 COM (org 0x100, CS=DS=ES=PSP)。手アセンブル。詳細は上のコメント。
//   BA 26 01      MOV DX, 0x0126      ; DS:DX -> pattern "*.*",0
//   31 C9         XOR CX, CX          ; attr = 0
//   B4 4E         MOV AH, 0x4E        ; FindFirst
//   CD 21         INT 21h
//   72 12         JC  fail
//   BA 9E 00      MOV DX, 0x009E      ; DS:DX -> DTA+0x1E (返却ファイル名 ASCIZ)
//   30 C0         XOR AL, AL          ; open mode = read
//   B4 3D         MOV AH, 0x3D        ; Open existing
//   CD 21         INT 21h
//   72 07         JC  fail
//   C6 06 80 00 AA  MOV BYTE [0x0080], 0xAA   ; 成功
//   EB 05         JMP done
// fail:
//   C6 06 80 00 01  MOV BYTE [0x0080], 0x01   ; 失敗
// done:
//   B4 4C         MOV AH, 0x4C
//   CD 21         INT 21h             ; terminate
// pattern: db '*.*',0
const COM = Uint8Array.from([
    0xBA,0x26,0x01, 0x31,0xC9, 0xB4,0x4E, 0xCD,0x21, 0x72,0x12,
    0xBA,0x9E,0x00, 0x30,0xC0, 0xB4,0x3D, 0xCD,0x21, 0x72,0x07,
    0xC6,0x06,0x80,0x00,0xAA, 0xEB,0x05,
    0xC6,0x06,0x80,0x00,0x01,
    0xB4,0x4C, 0xCD,0x21,
    0x2A,0x2E,0x2A,0x00,
]);

// /run に置く唯一のファイルの SJIS 名 = "漢字漢字.DAT" の生バイト (frontend と同じく latin1 文字列で書く)。
// 漢=8A BF / 字=8E 9A。name 部 8 byte + "." + ext "DAT" = 8.3 ぴったり 12 byte。UTF-8 では 20 byte に膨れる。
const SJIS_NAME_BYTES = [0x8A,0xBF,0x8E,0x9A,0x8A,0xBF,0x8E,0x9A,0x2E,0x44,0x41,0x54];
const SJIS_NAME = String.fromCharCode(...SJIS_NAME_BYTES);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    // /run に SJIS 名ファイルを 1 本だけ置く (FindFirst "*.*" が一意に引く)。
    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/' + SJIS_NAME, new Uint8Array([0x42]));

    const peek8    = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const runFrame = M.cwrap('np2kai_run_frame',   null,     ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit','number', ['number']);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'FINDSJIS']);
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

    const result = peek8(handle, 0x1080) & 0xff;                    // COM が書いた結果
    const dtaName = [];                                            // DTA+0x1E (PSP:009E → linear 0x109E)
    for (let k = 0; k < 13; k++) dtaName.push(peek8(handle, 0x109E + k) & 0xff);  // 12 byte + NUL

    const hex = (a) => a.map(b => b.toString(16).padStart(2, '0')).join(' ');
    const expectName = SJIS_NAME_BYTES.concat([0x00]);             // 生 SJIS + NUL、無切断
    const nameOk = expectName.every((b, k) => dtaName[k] === b);

    console.log(`exited=${exited} result=0x${result.toString(16)}`);
    console.log(`DTA name : ${hex(dtaName)}   (expect ${hex(expectName)})`);

    const pass = exited === 1 && result === 0xAA && nameOk;
    if (pass) {
        console.log('PASS — FindFirst が返した SJIS 名 (生 SJIS・無切断) で再 open に成功 = find↔open 対称化を確認');
        process.exit(0);
    }
    console.log('FAIL', { exited, result: '0x' + result.toString(16), nameOk });
    if (dtaName[0] === 0xC2 || dtaName[0] === 0xC3)
        console.log('  → DTA 名が UTF-8 (先頭 0xC2/0xC3) のまま = find 経路が d_name を畳んでいない (修正前の症状)');
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
