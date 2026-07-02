#!/usr/bin/env node
// INT 21h AH=38h (Get Country Info) 回帰テスト (2026-07-02)
// ------------------------------------------------------------------------------
// QuickBASIC (日本語版) ランタイム等が起動時に呼ぶ。日本 (country 81) の実 DOS 値:
// 日付書式 word=2 (YMD)・通貨 "\"・区切り ,/./-/:・24 時間制・case-map far ptr は有効な
// far RET を指す (呼んでもクラッシュしない)。BX=81・CF=0。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// AX=3800h DS:DX=buf で取得 → BX を保存 → buf の case-map far ptr を far CALL → 完走を確認
function com() {
  const b = [
    0xB8, 0x00, 0x38,       // mov ax,3800h
    0xBA, 0, 0,             // mov dx,buf (placeholder @4,5)
    0xCD, 0x21,             // int 21h
    0x72, 0x0E,             // jc fail (+14)
    0x89, 0x1E, 0, 0,       // mov [bxsave],bx (placeholder @12,13)
    0xB0, 0x41,             // mov al,'A' (case-map 入力)
    0xFF, 0x1E, 0, 0,       // call far [buf+12h] (placeholder @18,19)
    0xB4, 0x4C, 0xCD, 0x21, // exit (成功: ここまで到達 = far CALL がクラッシュしない)
    0xB8, 0x01, 0x4C, 0xCD, 0x21, // fail: mov ax,4C01h ; int 21h
  ];
  const bufOff = 0x100 + b.length, bxOff = bufOff + 0x22;
  b[4] = bufOff & 0xFF; b[5] = (bufOff >> 8) & 0xFF;
  b[12] = bxOff & 0xFF; b[13] = (bxOff >> 8) & 0xFF;
  const fp = bufOff + 0x12;                       // case-map far ptr の格納位置
  b[18] = fp & 0xFF; b[19] = (fp >> 8) & 0xFF;
  for (let i = 0; i < 0x22; i++) b.push(0xEE);    // buf (sentinel)
  b.push(0xEE, 0xEE);                             // bxsave
  return { bin: Uint8Array.from(b), bufLin: 0x1000 + bufOff, bxLin: 0x1000 + bxOff };
}

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const { bin, bufLin, bxLin } = com();
  M.FS.writeFile('/run/CTY.COM', bin);
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, bin.length, '', 'CTY.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = (a) => M.ccall('np2kai_debug_peek8', 'number', ['number','number'], [handle, a]) & 0xff;
  for (let f = 0; f < 600 && !getExit(0); f++) runFrame(handle);

  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  expect(getExit(0) === 1, 'COM が完走 (CF=0 + case-map far CALL がクラッシュしない)');
  const bx = peek(bxLin) | (peek(bxLin + 1) << 8);
  expect(bx === 81, `BX = 81 (日本) (got ${bx})`);
  const dateFmt = peek(bufLin) | (peek(bufLin + 1) << 8);
  expect(dateFmt === 2, `日付書式 = 2 (YMD) (got ${dateFmt})`);
  expect(peek(bufLin + 2) === 0x5C, `通貨記号 = "\\" (got 0x${peek(bufLin + 2).toString(16)})`);
  expect(peek(bufLin + 0x11) === 1, `時刻書式 = 24h (got ${peek(bufLin + 0x11)})`);
  console.log(ok ? 'PASS: AH=38h Get Country Info (日本, country 81)' : 'FAIL: AH=38h 回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
