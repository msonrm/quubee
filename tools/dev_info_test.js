#!/usr/bin/env node
// IOCTL Get Device Info (INT 21h AH=44h AL=00) 回帰テスト (2026-06-30)
// ------------------------------------------------------------------------------
// CON (stdin/stdout/stderr = handle 0/1/2) は実機 DOS が 0x80D3 を返す。とりわけ
// **bit6 (0x40)** が立っていないと TurboC ランタイムが stdout を「リダイレクト先ファイル」と
// 判定して full-buffer 化し、printf→getch 型 (YY「ある勇者の憂鬱」等) のオープニングが
// 入力するまで画面に出ない。旧実装 (0x81/0x82/0x80) は bit6 を欠いていた。
// バッファリングは TurboC 内部なので合成 COM では再現できない → device info の値を直接検証する。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// COM: handle 0/1/2 を AH=44 AL=00 で照会し、各 DX を DS:[0x2000/2/4] へ格納して終了。
// (COM は DS=PSP=0x0100、よって linear 0x1000+0x2000 = 0x3000 から 3 ワード)
function com() {
  const b = [];
  const query = (handle, off) => b.push(
    0xB4, 0x44, 0xB0, 0x00,                 // mov ah,44h ; mov al,00h
    0xBB, handle & 0xFF, (handle >> 8) & 0xFF, // mov bx,handle
    0xCD, 0x21,                             // int 21h
    0x89, 0x16, off & 0xFF, (off >> 8) & 0xFF); // mov [off],dx
  query(0, 0x2000);
  query(1, 0x2002);
  query(2, 0x2004);
  b.push(0xB4, 0x4C, 0xCD, 0x21);           // mov ah,4Ch ; int 21h
  return Uint8Array.from(b);
}

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const bin = com();
  M.FS.writeFile('/run/DEVINFO.COM', bin);
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, bin.length, '', 'DEVINFO.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  for (let f = 0; f < 300; f++) runFrame(handle);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  const word = (a) => (peek(handle, a) & 0xff) | ((peek(handle, a + 1) & 0xff) << 8);
  const dx = [word(0x3000), word(0x3002), word(0x3004)];

  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const names = ['stdin', 'stdout', 'stderr'];
  for (let h = 0; h < 3; h++) {
    expect(dx[h] === 0x80D3, `handle ${h} (${names[h]}) device info = 0x80D3 (got 0x${dx[h].toString(16)})`);
    expect((dx[h] & 0x40) !== 0, `handle ${h} bit6 (0x40 非EOF/対話=TurboC が stdout を行バッファ化する鍵) がセット`);
    expect((dx[h] & 0x80) !== 0, `handle ${h} bit7 (char device) がセット`);
  }
  console.log(ok ? 'PASS: IOCTL Get Device Info — CON は 0x80D3 (bit6 込み)' : 'FAIL: device info 回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
