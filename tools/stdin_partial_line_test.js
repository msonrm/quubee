#!/usr/bin/env node
// AH=3Fh handle 0 (STDIN) cooked 行入力 — 分割到着 回帰テスト (2026-06-30)
// ------------------------------------------------------------------------------
// stdin_read_test.js は "Hi\r" を一括注入するため「1 回の read 呼び出しで全文字が
// 揃う」幸運なケースしか踏まない。本テストは実ブラウザで起こりうる「文字が複数フレームに
// 分かれて届く」状況を再現し、cooked モードの核心契約を固定する:
//
//   (1) Enter (CR) が来るまで read は戻らない (部分行を勝手に確定して返さない)。
//       → "Hi" だけ注入しても COM は AH=3Fh から戻らず、count 領域は 0 のまま。
//   (2) 後から CR を注入すると、フレームを跨いで貯めた "Hi" と CR が正しく繋がり
//       "Hi"+CR LF = 48 69 0d 0a (count=4) を返す。
//
// 実装 (native/dos_int21.c int21_3f_read_stdin): FIFO が途中で枯れたら
// qb_dos_int21_retry() で CPU_IP を巻き戻し、貯めた分を static バッファに保持して
// 次フレームを待つ (AH=0Ah と同じ非ブロッキング方式)。この退行を防ぐのが本テスト。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// COM: AH=3Fh BX=0 CX=64 DX=buf で STDIN を読み、AX を count へ格納して終了。
// (stdin_read_test.js と同一バイナリ。意図: 入口を揃え差分を「到着の分割」だけにする)
function com() {
  const head = [
    0xB4, 0x3F,             // mov ah,3Fh
    0xBB, 0x00, 0x00,       // mov bx,0 (STDIN)
    0xB9, 0x40, 0x00,       // mov cx,64
    0xBA, 0, 0,             // mov dx,buf  (placeholder @9,10)
    0xCD, 0x21,             // int 21h
    0xA3, 0, 0,             // mov [count],ax (placeholder @14,15)
    0xB4, 0x4C, 0xCD, 0x21, // mov ah,4Ch ; int 21h
  ];
  const codeLen = head.length;            // 20
  const bufOff = 0x100 + codeLen;
  const countOff = bufOff + 64;
  head[9]  = bufOff & 0xFF;   head[10] = (bufOff >> 8) & 0xFF;
  head[14] = countOff & 0xFF; head[15] = (countOff >> 8) & 0xFF;
  const b = [];
  for (const x of head) b.push(x);
  for (let i = 0; i < 64 + 2; i++) b.push(0);
  return { bin: Uint8Array.from(b), bufLin: 0x1000 + bufOff, countLin: 0x1000 + countOff };
}

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const { bin, bufLin, countLin } = com();
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'],
                     [ptr, bin.length, '', 'STDINP.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);

  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  const inject = (s) => {
    const a = Array.from(s).map(c => c.charCodeAt(0));
    const p = M._malloc(a.length); M.HEAPU8.set(Uint8Array.from(a), p);
    M.ccall('np2kai_inject_text', null, ['number', 'number', 'number'], [handle, p, a.length]);
    M._free(p);
  };
  const rd16 = (lin) => (peek(handle, lin) & 0xff) | ((peek(handle, lin + 1) & 0xff) << 8);

  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

  // 起動を進める (COM は即 AH=3Fh で STDIN read に入り、FIFO 空なので retry スピン)
  for (let f = 0; f < 200; f++) runFrame(handle);

  // (1) Enter 抜きで "Hi" だけ注入 → 戻ってはいけない
  inject('Hi');
  for (let f = 0; f < 300; f++) runFrame(handle);
  expect(getExit(0) === 0, 'CR 前は COM が終了しない (read が部分行で戻らない)');
  expect(rd16(countLin) === 0, 'CR 前は count 領域が未書き込み (0 のまま)');

  // (2) 遅れて CR を注入 → ここで初めて行確定して返る
  inject('\r');
  for (let f = 0; f < 600 && !getExit(0); f++) runFrame(handle);

  const count = rd16(countLin);
  const bytes = []; for (let i = 0; i < count && i < 16; i++) bytes.push(peek(handle, bufLin + i) & 0xff);
  const hex = bytes.map(x => x.toString(16).padStart(2, '0')).join(' ');

  expect(getExit(0) === 1, 'CR 注入後に COM が終了 (行が確定して read が戻った)');
  expect(count === 4, `count=4 ("Hi"+CR LF) (got ${count})`);
  expect(hex === '48 69 0d 0a', `bytes = 48 69 0d 0a ("Hi"<CR><LF>) — 分割到着でも結合 (got "${hex}")`);

  console.log(ok ? 'PASS: STDIN 分割到着 — CR まで待ち、跨ったバイトを正しく結合'
                 : 'FAIL: STDIN 分割到着で部分行確定 or 結合ミス (退行)');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
