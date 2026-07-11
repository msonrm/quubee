#!/usr/bin/env node
// キーリピート (案A) の C 側前提の恒久回帰 (2026-07-11)
// ------------------------------------------------------------------------------
// 実機 PC-98 はキーボードがハードウェアで auto-repeat する。QuuBee は bridge.js が OS の
// オートリピート keydown を NP2kai へそのまま転送する方式 (案A、JS のみ・Wasm 不変) を採る。
// 成立の前提は NP2kai keystat_down の契約 (keystat.c):
//   1) 既押下キーへの再 down → break+make を送出し「新規キーストローク」になる
//      (keyctrl.keyrep 既定 0x21)
//   2) 1 回の down は 1 ストロークだけ。NP2kai 自前タイプマチック (np2cfg.keyrepeat_enable)
//      は我々のビルドで既定 OFF — もし ON だと OS リピートと二重生成になる
//   3) 修飾キー (kbexflag=KBEX_NONREP=0x80: SFT/CAPS/KANA/GRPH/CTRL) は再 down しても何も
//      出ず、押下状態も壊れない
// 上流更新でこの契約が変わると「リピートしない/二重リピート/長押し修飾が化ける」が無言で
// 入るので、ここで型に封じる。
//
// 検証: AH=08h (getch no echo) で 3 文字読む COM をステージし、'A' (NKEY 0x1D) を keyUp
// なしで 3 回 down する。期待 = down 1 回につきちょうど 1 文字。3 文字目は SHIFT (0x70) を
// 二重 down (リピート相当) してから読む → 'A' (0x41) になれば NONREP と shift 保持の証明。
//
// 使い方: node tools/keyrepeat_test.js

const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const FONT = path.join(WEB, 'assets/font.bmp');
const LOADER = path.join(WEB, 'assets/loader.d88');

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
for (const [p, n] of [[LOADER, 'loader.d88'], [FONT, 'font.bmp']]) if (!fs.existsSync(p)) skip(n + ' 不在');
if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) skip('np2kai_core.js 不在 (bash emscripten/build.sh)');
const NP2 = require(path.join(WEB, 'np2kai_core.js'));

// COM: AH=08h を 3 回読み buf(0x113) へ格納して AH=4Ch 終了。
//   0x100: B9 03 00        mov cx,3
//   0x103: BE 13 01        mov si,0x113 (buf)
//   0x106: B4 08 CD 21     mov ah,08h ; int 21h
//   0x10A: 88 04 46        mov [si],al ; inc si
//   0x10D: E2 F7           loop 0x106
//   0x10F: B4 4C CD 21     mov ah,4Ch ; int 21h
//   0x113: buf (3 bytes)
const COM = Uint8Array.from([
    0xB9, 0x03, 0x00, 0xBE, 0x13, 0x01,
    0xB4, 0x08, 0xCD, 0x21, 0x88, 0x04, 0x46, 0xE2, 0xF7,
    0xB4, 0x4C, 0xCD, 0x21,
    0x00, 0x00, 0x00,
]);
const BUF_LIN = 0x1000 + 0x113;   // stage_com は 0x100:0x100 ロード
const NKEY_A = 0x1D, NKEY_SHIFT = 0x70;

(async () => {
    const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const h = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/KEYREP.COM', COM);
    const ptr = M._malloc(COM.length); M.HEAPU8.set(COM, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'],
                       [ptr, COM.length, '', 'KEYREP.COM']);
    M._free(ptr);
    if (sr !== 0) { console.log('FAIL stage r=' + sr); process.exit(1); }
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [h]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const keyDown = M.cwrap('np2kai_key_down', null, ['number', 'number']);
    const keyUp = M.cwrap('np2kai_key_up', null, ['number', 'number']);
    const run = (n) => { for (let i = 0; i < n; i++) runFrame(h); };
    const buf = (i) => peek(h, BUF_LIN + i) & 0xff;
    const hex = (x) => '0x' + x.toString(16).padStart(2, '0');

    let fails = 0;
    const ok = (cond, msg, got) => {
        console.log((cond ? '  PASS: ' : '  FAIL: ') + msg + (cond || got === undefined ? '' : ` (got ${got})`));
        if (!cond) fails++;
    };

    run(200);                                  // COM が AH=08h で入力待ちに入るまで

    keyDown(h, NKEY_A); run(60);               // down #1 (通常の初回押下)
    ok(buf(0) === 0x61, "down 1 回目で 'a' が 1 文字届く", hex(buf(0)));
    ok(buf(1) === 0x00, 'down 1 回 = 1 ストロークだけ', hex(buf(1)));

    run(240);                                  // 押しっぱなしのままフレームだけ進める
    ok(buf(1) === 0x00, '保持中に勝手にリピートしない (自前タイプマチック OFF の証明)', hex(buf(1)));

    keyDown(h, NKEY_A); run(60);               // down #2 (OS リピート相当・keyUp なし)
    ok(buf(1) === 0x61, "再 down (リピート) で 2 文字目 'a' = break+make が生成される", hex(buf(1)));
    ok(buf(2) === 0x00, '再 down 1 回 = 1 ストロークだけ', hex(buf(2)));

    keyDown(h, NKEY_SHIFT); run(10);           // SHIFT 押下 + リピート相当の再 down
    keyDown(h, NKEY_SHIFT); run(10);           //   (KBEX_NONREP: 何も出ず状態も壊れないはず)
    keyDown(h, NKEY_A); run(60);               // down #3 (シフト中のリピート)
    ok(buf(2) === 0x41, "SHIFT 再 down 後も shift 保持 = 3 文字目が 'A' (NONREP の証明)", hex(buf(2)));
    ok(getExit(0) === 1, 'COM が 3 文字読んで正常終了');
    keyUp(h, NKEY_A); keyUp(h, NKEY_SHIFT);

    console.log(fails === 0
        ? '\nPASS — keystat_down の再 down = 新規ストローク / 保持は無音 / 修飾は NONREP (案A の前提が成立)'
        : `\nFAIL — ${fails} 件`);
    process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
