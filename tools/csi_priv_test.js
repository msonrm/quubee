#!/usr/bin/env node
// tty CSI の私的マーカ '>' を「パラメータの後」に置く NEC PC-98 形式の headless 回帰 (2026-06-28)。
//
// WinDy (wd113) は fkey 行制御を ESC[1>h / ESC[1>l と「数字 → '>'」順で送る (NEC PC-98 ANSI は
// パラメータの後の '>' も私的マーカとして許す)。旧パーサは '[' 直後の '>' しか priv 扱いせず、
// 数字後の '>' を終端文字に誤認 → 続く 'h'/'l' を素の文字として描画していた (メイン画面左上に
// 謎の 'h' が居座る = 画面崩れの真因)。
//
// この合成 COM は画面クリア後に ESC[1>h ESC[1>l を送り、最後に印字センチネル 'X' を出す
// (AH=09h は '$' を終端記号として出力しないので別の文字を使う)。修正後は両シーケンスが完全に
// 消費されカーソルが home に留まるので 'X' が (0,0) に来る。バグ時は 'h' が (0,0)、'l' が (0,1)、
// 'X' が (0,2) に来てしまう。よって (0,0)=='X' かつ (0,1)==space を検証すれば回帰を decisive に捕まえる。
//
// 使い方: node tools/csi_priv_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

const ESC = '\x1b';
const MSG =
    `${ESC}[m${ESC}[2J` +   // 属性リセット + 画面クリア (全 cell space・カーソル home)
    `${ESC}[1>h` +          // NEC 形式 (param→'>'): fkey 行制御。完全消費されるべき
    `${ESC}[1>l` +          // 同上
    `${ESC}[>1h` +          // 標準形式 ('['直後 '>') も従来どおり消費 (回帰なし確認)
    `X$`;                   // 印字センチネル X (修正後は (0,0) に来る)。'$' は AH=09h の終端
const CODE = [0xB4, 0x09, 0xBA, 0x0C, 0x01, 0xCD, 0x21, 0xB8, 0x00, 0x4C, 0xCD, 0x21];
const COM = Uint8Array.from([...CODE, ...Array.from(MSG, (c) => c.charCodeAt(0) & 0xff)]);

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

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'CSIPRIV']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_com failed r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    let exited = 0;
    for (let f = 0; f < 1500; f++) { runFrame(handle); if (getExit(0)) { exited = 1; break; } }

    const c00 = peek8(handle, 0xA0000 + 0 * 2) & 0xff;
    const c01 = peek8(handle, 0xA0000 + 1 * 2) & 0xff;
    const c02 = peek8(handle, 0xA0000 + 2 * 2) & 0xff;
    console.log(`  (0,0)=0x${c00.toString(16)} (0,1)=0x${c01.toString(16)} (0,2)=0x${c02.toString(16)} exited=${exited}`);
    console.log(`  'X'=0x58 'h'=0x68 'l'=0x6c space=0x20`);

    const pass = exited === 1 && c00 === 0x58 && c01 === 0x20;
    if (pass) {
        console.log("PASS — ESC[1>h / ESC[1>l (NEC param→'>' 形式) を私的マーカとして消費 = 'h'/'l' 漏れなし (WinDy 画面崩れの回帰防止)");
        process.exit(0);
    }
    console.log('FAIL — 私的マーカ後の終端文字が漏れている (旧バグ再発)');
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
