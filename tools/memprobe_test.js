#!/usr/bin/env node
// XMS/EMS 需要プローブ (計測器, 2026-06-05) の headless 検証。
//
// 何を確かめるか:
//   現状 XMS/EMS は未 HLE。だが「ターゲット群が実際に XMS/EMS を要求してくるか」を
//   知るための計測器 (qbDebug.memprobe) を常設した。本テストは 3 つの検出経路:
//     1) XMS インストールチェック  : INT 2Fh AX=4300h          → memprobe.xms
//     2) EMS 呼び出し              : INT 67h                    → memprobe.ems
//     3) EMS デバイス検出 (MS 標準): INT 21h AH=3Dh open "EMMXXXX0" → memprobe.emmOpen
//   を全て叩く極小 COM を合成してローダで起動し、3 カウンタが全て立つこと、かつ
//   応答が従来通り「無し」(= COM が暴走せず AH=4Ch で正常終了する) ことを確認する。
//
// これは外部書庫に依存しない決定的テスト (corpus の既知 5 本は XMS/EMS 陰性が期待値で
// 「発火する」ことを示せないため、プローブ自体の動作確認はこの合成 COM で行う)。
//
// 使い方: node tools/memprobe_test.js

const path = require('path');
const fs   = require('fs');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// ---- XMS/EMS を順に叩いて AH=4Ch で終わる 32 byte COM (load seg PSP:0100) ----
//  0100 B8 00 43     mov ax,4300h     ; XMS install check
//  0103 CD 2F        int 2Fh
//  0105 B4 46        mov ah,46h        ; EMS get version
//  0107 CD 67        int 67h
//  0109 B4 3D        mov ah,3Dh        ; DOS open
//  010B B0 00        mov al,0
//  010D BA 17 01     mov dx,0117h      ; DS:DX -> "EMMXXXX0",0 (offset 0x117)
//  0110 CD 21        int 21h
//  0112 B8 00 4C     mov ax,4C00h      ; exit(0)
//  0115 CD 21        int 21h
//  0117 "EMMXXXX0",0
const COM = Uint8Array.from([
    0xB8, 0x00, 0x43, 0xCD, 0x2F,
    0xB4, 0x46, 0xCD, 0x67,
    0xB4, 0x3D, 0xB0, 0x00, 0xBA, 0x17, 0x01, 0xCD, 0x21,
    0xB8, 0x00, 0x4C, 0xCD, 0x21,
    0x45, 0x4D, 0x4D, 0x58, 0x58, 0x58, 0x58, 0x30, 0x00,  // "EMMXXXX0\0"
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const probeLog = [];
    const M = await NP2KaiModule({
        noInitialRun: true,
        print: () => {},
        printErr: (t) => { if (/\[memprobe\]/.test(t)) probeLog.push(t); },
    });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));

    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    // 本テストは「需要プローブが検出だけして応答は無しのまま」を検証する趣旨。XMS HLE は既定 ON で
    // INT 2Fh AX=4300 に「在り」と応答するので、ここでは明示的に無効化して probe-absent 経路を見る
    // (XMS 有効時のドライバ挙動は tools/xms_test.js が担当)。
    M.ccall('np2kai_xms_enable', 'number', ['number', 'number'], [handle, 0]);

    const memprobe = (which) => M.ccall('np2kai_debug_memprobe', 'number', ['number', 'number'], [handle, which]) >>> 0;
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);

    // COM を stage → loader.d88 を A: に挿入 → reset → 実行
    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'MEMPROBE']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_com failed r=' + sr); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    // COM は数命令で AH=4Ch 終了するが、その前に PC-98 BIOS POST→FDD ブート→loader-start が
    // 必要 (~240 フレーム)。exec_env_test と同じく余裕をもって回す。
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    let exited = 0;
    for (let f = 0; f < 1500; f++) {
        runFrame(handle);
        if (getExit(0)) { exited = 1; break; }
    }

    const xms = memprobe(0), ems = memprobe(1), emmOpen = memprobe(2);
    console.log('probe logs:');
    for (const l of probeLog) console.log('  ' + l.trim());
    console.log(`memprobe = { xms:${xms}, ems:${ems}, emmOpen:${emmOpen} }  exited=${exited}`);

    const pass = xms >= 1 && ems >= 1 && emmOpen >= 1 && exited === 1;
    if (pass) {
        console.log('PASS — XMS/EMS の 3 検出経路を全て捕捉し、COM は応答「無し」のまま正常終了 (互換性 unchanged)');
        process.exit(0);
    }
    console.log('FAIL', { xms, ems, emmOpen, exited });
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
