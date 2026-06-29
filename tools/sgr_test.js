#!/usr/bin/env node
// tty の SGR (ESC[...m) → PC-98 テキスト属性の headless 検証 (2026-06-11)。
//
// 合成 COM が AH=09h で ESC シーケンス入り文字列を出力し、テキスト VRAM の属性プレーン
// (0xA2000) を直接検証する。NEC CON のセマンティクス (DOSBox-X dev_con.h の PC-98 実装と
// 突合) に準拠していることを確認:
//   - 毎 SGR シーケンス先頭で属性リセット (絶対指定方式)
//   - 30-37 = 文字色 (ANSI RGB 順 → PC-98 GRB ビット)、40-47 = 色 + 反転
//   - 17-23 = NEC 別系色コード (21 = 黄 — corpus で FLIXX/MOG/POLA/POY/ROLL が使用)
//   - 5 = 点滅 / 7 = 反転 / 8 = シークレット / 空 param ("5;46;") = 0 = リセット
//   - ESC[>5h/l (カーソル表示制御) は no-op = テキスト面表示を壊さない (旧バグの回帰防止)
//   - DOS CON ワークエリア 0:0711h/0712h/071Dh の初期化・追従
//
// 使い方: node tools/sgr_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// org 100h / mov ah,09 / mov dx,msg / int 21h / mov ax,4C00 / int 21h / msg: ...
const ESC = '\x1b';
const MSG =
    `${ESC}[m${ESC}[2J` +        // 属性リセット + 画面クリア (カーソル home)
    `${ESC}[33mA` +              // 黄                → 0xC1
    `${ESC}[5;32mB` +            // 点滅+緑           → 0x83
    `${ESC}[7mC` +               // 白反転            → 0xE5
    `${ESC}[46mD` +              // シアン背景(=反転) → 0xA5
    `${ESC}[5;46;mE` +           // 末尾の空 param = 0 (リセット) → 0xE1 (ANSI/DOSBox-X 準拠。Ray IV 実例)
    `${ESC}[21mF` +              // NEC 別系コード 21 = 黄 → 0xC1
    `${ESC}[8mG` +               // シークレット      → 0xE0
    `${ESC}[mH` +                // リセット          → 0xE1
    `${ESC}[>5lI` +              // カーソル表示 (no-op) → 0xE1 のまま・テキスト面も無傷
    '$';
const CODE = [0xB4, 0x09, 0xBA, 0x0C, 0x01, 0xCD, 0x21, 0xB8, 0x00, 0x4C, 0xCD, 0x21];
const COM = Uint8Array.from([...CODE, ...Array.from(MSG, (c) => c.charCodeAt(0) & 0xff)]);

const EXPECT = [   // row 0 の col 0.. に置かれる文字と期待属性
    ['A', 0xC1], ['B', 0x83], ['C', 0xE5], ['D', 0xA5], ['E', 0xE1],
    ['F', 0xC1], ['G', 0xE0], ['H', 0xE1], ['I', 0xE1],
];

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    const peek8    = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const textdisp = M.cwrap('np2kai_debug_get_textdisp', 'number', ['number']);
    const gdcMode1 = M.cwrap('np2kai_debug_get_gdc_mode1', 'number', ['number']);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'SGRTEST']);
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

    let pass = exited === 1, lines = [];
    for (let i = 0; i < EXPECT.length; i++) {
        const [ch, want] = EXPECT[i];
        const code = peek8(handle, 0xA0000 + i * 2) & 0xff;
        const attr = peek8(handle, 0xA2000 + i * 2) & 0xff;
        const ok = code === ch.charCodeAt(0) && attr === want;
        if (!ok) pass = false;
        lines.push(`col${i} '${ch}' code=0x${code.toString(16)} attr=0x${attr.toString(16)}` +
                   ` (expect 0x${want.toString(16)}) ${ok ? 'ok' : 'NG'}`);
    }
    // DOS CON ワークエリア + テキスト面表示 (>5l を送った後でも ENABLE のまま)
    const w711 = peek8(handle, 0x711) & 0xff, w712 = peek8(handle, 0x712) & 0xff;
    const w71d = peek8(handle, 0x71D) & 0xff;
    const tdisp = textdisp(handle) & 0x80;
    if (!(w711 === 0 && w712 === 24 && w71d === 0xE1 && tdisp === 0x80)) pass = false;
    /* DEGB (gdc.mode1 bit0 = 簡易グラフィックモード) は OFF であること。ON だと属性 0x10 が
     * 縦線でなく 2x4 ブロックに化け、SGR 2 (vertical-line) が np21w と食い違う (2026-06-29 根治)。
     * qb_dos_tty_reset が POST 既定 (0x99) から bit0 を落とすことのガード。 */
    const degb = gdcMode1(handle) & 0x01;
    if (degb !== 0) pass = false;
    for (const l of lines) console.log('  ' + l);
    console.log(`  conarea: 0711=${w711} 0712=${w712} 071D=0x${w71d.toString(16)}` +
                ` textdisp&0x80=0x${tdisp.toString(16)} DEGB=${degb} exited=${exited}`);

    if (pass) {
        console.log('PASS — SGR→PC-98 属性写像 (NEC 絶対指定/別系色/反転背景/空param) + >5 no-op + CON ワークエリアを確認');
        process.exit(0);
    }
    console.log('FAIL');
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
