#!/usr/bin/env node
// 仮想 30行BIOS (qbDebug.lines30 / np2kai_set_lines30) の headless 検証 (2026-06-28)。
//
// 背景: 実機 30行BIOS/30行計画 は NEC CRT-BIOS ROM をパッチして常駐する方式で、ROM を積まない
// QuuBee には常駐できない (30BIOS.COM は「対応していないDOS」で自滅)。そこで「30BIOS 常駐済みの
// 最終状態」(30TECH.DOC の 30BIOS-API + DOS ワークエリア + 480 ライン 30 行 GDC) を HLE が用意する。
// 詳細: docs/30line_spec.md。
//
// プローブ COM (nasm 生成、ソース = tools 履歴の lines30_probe.asm) が結果を PSP:0080.. に書く:
//   [0x80] = INT 18h AH=0Bh, BX=0xC0A3 (インストールチェック) の AL
//   [0x81] = DOS ワーク 0:0712 (行数 - 1)
//   [0x82] = INT 18h AX=FF03h, BL=0 (画面行数取得) の AL (行数 - 1)
//   [0x83] = ES:DI 文字列 "30BIOS_EXIST=" の末尾フラグ (フリップ後)
//
// 判定:
//   ON  (lines30=1): [0x80] bit6=1 (常駐), [0x81]=29, [0x82]=29, [0x83]='1'(0x31)
//   OFF (lines30=0): [0x80] bit6=0 (非常駐 = フックも入らず原 bios0x18 が返す), [0x81]=24 (= 25 行)
// OFF が原 BIOS 挙動と一致 = ゼロ回帰の確認。
//
// 使い方: node tools/lines30_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// nasm 生成 COM (上記コメントのプローブ。INT 18h AH=0Bh / AX=FF03h を叩き 0:0712 を読む)。
const COM = Uint8Array.from([
    0x0e,0x07,0xbf,0x30,0x01,0xb4,0x0b,0xbb,0xa3,0xc0,0xcd,0x18,0xa2,0x80,0x00,0x31,
    0xc0,0x8e,0xd8,0xa0,0x12,0x07,0x0e,0x1f,0xa2,0x81,0x00,0xb8,0x03,0xff,0x30,0xdb,
    0xcd,0x18,0xa2,0x82,0x00,0xa0,0x3d,0x01,0xa2,0x83,0x00,0xb8,0x00,0x4c,0xcd,0x21,
    0x33,0x30,0x42,0x49,0x4f,0x53,0x5f,0x45,0x58,0x49,0x53,0x54,0x3d,0x30,
]);

// テキストを INT 21h AH=09h で print して AH=4Ch 終了する COM (画面表示検査用)。
// 黒画面バグ (bios0x18_30 が text display を OFF にして返す件) の恒久ガード:
//   ON で h=480 (480 ライン化) かつ non-black>0 (テキストが実際に表示されている) を確認する。
const PRINT_COM = Uint8Array.from([
    0xb4,0x09,0xba,0x0c,0x01,0xcd,0x21,0xb8,0x00,0x4c,0xcd,0x21,0x0d,0x0a,0x48,0x45,
    0x4c,0x4c,0x4f,0x20,0x33,0x30,0x20,0x4c,0x49,0x4e,0x45,0x20,0x44,0x49,0x53,0x50,
    0x4c,0x41,0x59,0x20,0x54,0x45,0x53,0x54,0x20,0x20,0x41,0x42,0x43,0x44,0x45,0x46,
    0x47,0x20,0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x0d,0x0a,0x24,
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);

    function stage() {
        const ptr = M._malloc(COM.length);
        M.HEAPU8.set(COM, ptr);
        const r = M.ccall('np2kai_dos_stage_com', 'number',
            ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'L30TEST.COM']);
        M._free(ptr);
        if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }
    }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);

    const runFrame   = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit    = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const pk         = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const setLines30 = M.cwrap('np2kai_set_lines30', 'number', ['number']);
    const getFB      = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
    const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);

    function stageBytes(bytes, name) {
        const ptr = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, ptr);
        const r = M.ccall('np2kai_dos_stage_com', 'number',
            ['number', 'number', 'string', 'string'], [ptr, bytes.length, '', name]);
        M._free(ptr);
        if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }
    }

    // COM は PSP=0x0100 にロードされる → DS:0080 = linear 0x1080
    function runOnce(on) {
        setLines30(on ? 1 : 0);
        stage();
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        let exited = 0;
        for (let f = 0; f < 1200; f++) {
            runFrame(handle);
            if (getExit(0)) { exited = 1; break; }
        }
        return {
            exited,
            al0b:  pk(handle, 0x1080),
            work:  pk(handle, 0x1081),
            ff03:  pk(handle, 0x1082),
            flip:  pk(handle, 0x1083),
        };
    }

    // 画面表示検査: テキストを print → フレームバッファの高さと非黒ピクセル数を見る。
    function displayOnce(on) {
        setLines30(on ? 1 : 0);
        stageBytes(PRINT_COM, 'L30DISP.COM');
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        let exited = 0;
        for (let f = 0; f < 600; f++) { runFrame(handle); if (getExit(0)) { exited = 1; break; } }
        for (let f = 0; f < 60; f++) runFrame(handle);   // 描画を進める
        const ptr = getFB(handle, wP, hP, bP);
        const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
        let nonblack = 0;
        if (ptr && w > 0 && h > 0) {
            const base = ptr >> 1, n = w * h;
            for (let i = 0; i < n; i++) if (M.HEAPU16[base + i] !== 0) nonblack++;
        }
        return { exited, w, h, nonblack };
    }

    let fail = 0;
    const need = (cond, msg) => { if (!cond) { console.log('FAIL — ' + msg); fail = 1; } };

    // --- ON: 30 行モード ---
    const on = runOnce(true);
    console.log(`[ON ] exited=${on.exited} AH0Bh.AL=0x${on.al0b.toString(16)} work(0712)=${on.work} FF03.AL=${on.ff03} flip=0x${on.flip.toString(16)}`);
    need(on.exited, 'ON: COM が終了しない (ハング)');
    need((on.al0b & 0x40) !== 0, `ON: AH=0Bh の AL bit6 (30BIOS 常駐) が立っていない (AL=0x${on.al0b.toString(16)})`);
    need((on.al0b & 0x10) !== 0, `ON: AH=0Bh の AL bit4 (拡張モード) が立っていない (AL=0x${on.al0b.toString(16)})`);
    need(on.work === 29, `ON: 0:0712 (行数-1) が 29 でない (=${on.work})`);
    need(on.ff03 === 29, `ON: AX=FF03h の AL (行数-1) が 29 でない (=${on.ff03})`);
    need(on.flip === 0x31, `ON: ES:DI の '30BIOS_EXIST=' フラグが '1' にフリップされていない (=0x${on.flip.toString(16)})`);

    // --- OFF: 25 行 (= 原 BIOS 挙動 / ゼロ回帰) ---
    const off = runOnce(false);
    console.log(`[OFF] exited=${off.exited} AH0Bh.AL=0x${off.al0b.toString(16)} work(0712)=${off.work}`);
    need(off.exited, 'OFF: COM が終了しない (ハング)');
    need((off.al0b & 0x40) === 0, `OFF: 非常駐なのに AL bit6 が立っている (フック誤作動? AL=0x${off.al0b.toString(16)})`);
    need(off.work === 24, `OFF: 0:0712 (行数-1) が 24 (=25 行) でない (=${off.work})`);

    // --- 画面表示検査 (黒画面バグの恒久ガード) ---
    const dON  = displayOnce(true);
    const dOFF = displayOnce(false);
    console.log(`[DISP ON ] ${dON.w}x${dON.h} non-black=${dON.nonblack}`);
    console.log(`[DISP OFF] ${dOFF.w}x${dOFF.h} non-black=${dOFF.nonblack}`);
    need(dON.h === 480, `ON: 画面高さが 480 でない (=${dON.h}、480 ライン化されていない)`);
    need(dON.nonblack > 0, 'ON: テキストを print したのに画面が真っ黒 (text display OFF のまま = bios0x18_30 後の AH=0Ch 欠落)');
    need(dOFF.h === 400, `OFF: 画面高さが 400 でない (=${dOFF.h})`);
    need(dOFF.nonblack > 0, 'OFF: テキストが表示されない (原 BIOS 経路の回帰)');

    if (fail) process.exit(1);
    console.log('PASS — lines30 ON で 30BIOS-API 応答 + 0:0712=29 + 640x480 にテキスト表示、OFF で原 BIOS 挙動 (ゼロ回帰)');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
