#!/usr/bin/env node
// XMS (HIMEM 相当) HLE / Tier 1 MVP の headless 検証 (2026-06-05)。
//
// 合成 COM (tools 内 nasm で生成、バイト埋込) が実機 XMS クライアントと同じ手順を踏む:
//   1) INT 2Fh AX=4300h で XMS 検出 (AL==80h を確認)
//   2) INT 2Fh AX=4310h で driver entry (ES:BX) 取得
//   3) entry を CALL FAR、AH=09h で 4KB EMB を確保 (AX==1, DX=handle)
//   4) AH=0Bh Move で conventional バッファ(16B,既知パターン) → EMB へ
//   5) AH=0Bh Move で EMB → 別の conventional バッファへ戻す
//   6) 2 つのバッファをバイト比較 → 一致なら DS:0080 に 0xAA、不一致/失敗なら 0x01 を書く
//   7) AH=4Ch 終了
// harness は終了後に DS:0080 (linear 0x1080) を peek して 0xAA を確認し、さらに xms_stat で
// 確保が成立したか (handles>=1) を確認する。これで「検出→entry→alloc→move 往復のバイト一致」を
// 一気通貫で検証する。
//
// 対応する asm: src=パターン 11 22 .. F0、conv↔EMB を move 往復して同一になれば XMS Move が正しい。
//
// 使い方: node tools/xms_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// nasm 生成 COM (tools/xms_test.js のコメント参照)。XMS 検出→entry→alloc→move 往復→自己比較。
const COM = Uint8Array.from([
    0xB8,0x00,0x43,0xCD,0x2F,0x3C,0x80,0x0F,0x85,0xB3,0x00,0xB8,0x10,0x43,0xCD,0x2F,
    0x89,0x1E,0xC8,0x01,0x8C,0x06,0xCA,0x01,0xB4,0x09,0xBA,0x04,0x00,0xFF,0x1E,0xC8,
    0x01,0x83,0xF8,0x01,0x0F,0x85,0x96,0x00,0x89,0x16,0xCC,0x01,0xC7,0x06,0xCE,0x01,
    0x10,0x00,0xC7,0x06,0xD0,0x01,0x00,0x00,0xC7,0x06,0xD2,0x01,0x00,0x00,0xC7,0x06,
    0xD4,0x01,0xDE,0x01,0x8C,0x1E,0xD6,0x01,0xA1,0xCC,0x01,0xA3,0xD8,0x01,0xC7,0x06,
    0xDA,0x01,0x00,0x00,0xC7,0x06,0xDC,0x01,0x00,0x00,0xB4,0x0B,0xBE,0xCE,0x01,0xFF,
    0x1E,0xC8,0x01,0x83,0xF8,0x01,0x75,0x56,0xC7,0x06,0xCE,0x01,0x10,0x00,0xC7,0x06,
    0xD0,0x01,0x00,0x00,0xA1,0xCC,0x01,0xA3,0xD2,0x01,0xC7,0x06,0xD4,0x01,0x00,0x00,
    0xC7,0x06,0xD6,0x01,0x00,0x00,0xC7,0x06,0xD8,0x01,0x00,0x00,0xC7,0x06,0xDA,0x01,
    0xEE,0x01,0x8C,0x1E,0xDC,0x01,0xB4,0x0B,0xBE,0xCE,0x01,0xFF,0x1E,0xC8,0x01,0x83,
    0xF8,0x01,0x75,0x1A,0xBE,0xDE,0x01,0xBF,0xEE,0x01,0xB9,0x10,0x00,0x8A,0x04,0x3A,
    0x05,0x75,0x0B,0x46,0x47,0xE2,0xF6,0xC6,0x06,0x80,0x00,0xAA,0xEB,0x05,0xC6,0x06,
    0x80,0x00,0x01,0xB8,0x00,0x4C,0xCD,0x21,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x11,0x22,0x33,0x44,
    0x55,0x66,0x77,0x88,0x99,0xAA,0xBB,0xCC,0xDD,0xEE,0x0F,0xF0,0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const xlog = [];
    const M = await NP2KaiModule({
        noInitialRun: true, print: () => {},
        printErr: (t) => { t = String(t); if (/\[xms\]/.test(t)) xlog.push(t.trim()); },
    });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    const peek8   = M.cwrap('np2kai_debug_peek8',  'number', ['number', 'number']);
    const xmsStat = M.cwrap('np2kai_xms_stat',     'number', ['number', 'number']);
    const memprobe= M.cwrap('np2kai_debug_memprobe','number', ['number', 'number']);
    const runFrame= M.cwrap('np2kai_run_frame',    null,     ['number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'XMSTEST']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_com failed r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    let exited = 0, handlesDuringRun = 0;
    for (let f = 0; f < 1500; f++) {
        runFrame(handle);
        const hn = xmsStat(handle, 1);
        if (hn > handlesDuringRun) handlesDuringRun = hn;   // COM が確保した瞬間を捕捉 (終了前)
        if (getExit(0)) { exited = 1; break; }
    }

    const result   = peek8(handle, 0x1080) & 0xff;   // COM が DS:0080 (linear 0x1080) に書いた結果
    const xms       = memprobe(handle, 0);
    const enabled   = xmsStat(handle, 0);
    console.log('xms logs:'); for (const l of xlog) console.log('  ' + l);
    console.log(`enabled=${enabled} memprobe.xms=${xms} handles(run中max)=${handlesDuringRun} result=0x${result.toString(16)} exited=${exited}`);

    const pass = enabled === 1 && xms >= 1 && handlesDuringRun >= 1 && result === 0xAA && exited === 1;
    if (pass) {
        console.log('PASS — XMS 検出→entry→alloc→Move 往復のバイト一致を確認 (faithful HIMEM 相当)');
        process.exit(0);
    }
    console.log('FAIL', { enabled, xms, handlesDuringRun, result: '0x' + result.toString(16), exited });
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
