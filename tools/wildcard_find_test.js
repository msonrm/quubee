#!/usr/bin/env node
// wildcard_find_test.js — DOS FindFirst の wildcard と 8.3 空白パディング open の headless 回帰。
//
// 背景 (2026-06-15、MUAP98 のファイラがサブディレクトリ/サンプルを開けなかった件):
//   ① dos_wildcard_match が文字単位の素朴な再帰で、"*.*" が拡張子の無い名前 (ディレクトリ
//      "SUB" 等) に一致しなかった。実 DOS は name.ext のフィールドで照合し "*.*" は ext 空にも
//      一致する → サブディレクトリが FindFirst("*.*", attr=0x10) で見つからずファイラが навиг不能。
//      → フィールド分割の照合に修正。
//   ② プログラムが FindFirst 結果を 11 byte FCB 形式で持ち、選択ファイルを "NAME    .EXT" の
//      ように 8.3 空白パディングで再 open することがある。実 DOS の open はこの空白を読み飛ばすが、
//      我々は生のパスで lookup して不一致 → 開けなかった。→ read_dos_rel が 0x20 を除去。
//
// 手順: 合成 COM が
//   1) FindFirst "*.*" (CX=0x10=ディレクトリ含む) → /run には唯一の項目=ディレクトリ "SUB"。
//      DTA+0x15 の属性 byte に 0x10 (ディレクトリ) が立っていれば res1=0xAA。
//   2) 8.3 空白パディングのパス "\SUB\INSIDE  .DAT" を open ("INSIDE"6 字を 8 字に空白 2 つで詰めた)。
//      成功 (= 空白除去 + サブディレクトリ解決) なら res2=0xAA。
//   3) AH=4Ch で終了。
// harness は res1/res2 がともに 0xAA を確認する。修正前は ①=NOT FOUND で res1=0、②=open 失敗で res2=0。
//
// 使い方: node tools/wildcard_find_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// 合成 COM (org 0x100)。手アセンブル。レイアウトとオフセットは下記コメント参照。
//   0100 BA 2E 01      mov dx, 012E      ; -> PAT "*.*",0
//   0103 B9 10 00      mov cx, 0x0010    ; FindFirst attr = ディレクトリ含む
//   0106 B4 4E         mov ah, 0x4E
//   0108 CD 21         int 21h
//   010A 72 0C         jc  0118 (t1done) ; 見つからなければ res1=0 のまま
//   010C A0 95 00      mov al, [0095]    ; DTA(PSP:0x80)+0x15 = 属性 byte
//   010F 24 10         and al, 0x10      ; ディレクトリビット
//   0111 74 05         jz  0118 (t1done)
//   0113 C6 06 2C 01 AA mov byte [012C], 0xAA   ; res1
//   0118 BA 32 01      mov dx, 0132      ; -> SPATH "\SUB\INSIDE  .DAT",0
//   011B B0 00         mov al, 0x00      ; open read
//   011D B4 3D         mov ah, 0x3D
//   011F CD 21         int 21h
//   0121 72 05         jc  0128 (t2done)
//   0123 C6 06 2D 01 AA mov byte [012D], 0xAA   ; res2
//   0128 B4 4C         mov ah, 0x4C
//   012A CD 21         int 21h
//   012C res1 db 0
//   012D res2 db 0
//   012E PAT  '*' '.' '*' 00
//   0132 SPATH '\SUB\INSIDE  .DAT' 00     (INSIDE=6字を 8字に空白2で詰める)
const COM = Uint8Array.from([
    0xBA,0x2E,0x01, 0xB9,0x10,0x00, 0xB4,0x4E, 0xCD,0x21, 0x72,0x0C,
    0xA0,0x95,0x00, 0x24,0x10, 0x74,0x05,
    0xC6,0x06,0x2C,0x01,0xAA,
    0xBA,0x32,0x01, 0xB0,0x00, 0xB4,0x3D, 0xCD,0x21, 0x72,0x05,
    0xC6,0x06,0x2D,0x01,0xAA,
    0xB4,0x4C, 0xCD,0x21,
    0x00, 0x00,                                  // 012C res1 / 012D res2
    0x2A,0x2E,0x2A,0x00,                          // 012E PAT "*.*"
    0x5C,0x53,0x55,0x42,0x5C,0x49,0x4E,0x53,0x49,0x44,0x45,0x20,0x20,0x2E,0x44,0x41,0x54,0x00,  // 0132 "\SUB\INSIDE  .DAT"
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    // /run には唯一の項目としてサブディレクトリ SUB を置き、その中に INSIDE.DAT を入れる。
    // (root の FindFirst "*.*" がディレクトリ SUB を一意に引く構成)。
    try { M.FS.mkdir('/run'); } catch (_) {}
    try { M.FS.mkdir('/run/SUB'); } catch (_) {}
    M.FS.writeFile('/run/SUB/INSIDE.DAT', new Uint8Array([0x4f, 0x4b]));   // "OK"

    const peek8    = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const runFrame = M.cwrap('np2kai_run_frame',   null,     ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit','number', ['number']);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'WILDCARD']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_com failed r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    let exited = 0;
    for (let f = 0; f < 1500; f++) { runFrame(handle); if (getExit(0)) { exited = 1; break; } }

    const res1 = peek8(handle, 0x112C) & 0xff;   // 0x100<<4 + 0x12C
    const res2 = peek8(handle, 0x112D) & 0xff;
    console.log(`exited=${exited} res1(wildcard dir)=0x${res1.toString(16)} res2(8.3 space open)=0x${res2.toString(16)}`);

    const pass = exited === 1 && res1 === 0xAA && res2 === 0xAA;
    if (pass) {
        console.log('PASS — FindFirst "*.*" がディレクトリ (拡張子なし) に一致 + 8.3 空白パディング名で open 成功');
        process.exit(0);
    }
    if (res1 !== 0xAA) console.log('  → res1!=AA: "*.*" が拡張子なし名 (ディレクトリ) に一致していない (wildcard 修正前の症状)');
    if (res2 !== 0xAA) console.log('  → res2!=AA: "\\SUB\\INSIDE  .DAT" を開けない (8.3 空白除去 / サブディレクトリ解決の問題)');
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
