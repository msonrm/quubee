#!/usr/bin/env node
// グラフ文字モード回帰テスト (2026-06-29) — SimK TEXTTEST PC98ADV1 P8 / PC98DCH P7 が突いた挙動。
// --------------------------------------------------------------------------------------------
// ESC)3 (および INT DCh CL=10h AH=0Eh DX=3) は「漢字 2 バイト結合を止め各バイトを ANK 1 文字で描く」
// グラフ文字モード。ESC)0 / DX=0 で漢字モードへ戻る。実機 (np21w) で表示が変わることを確認済み。
//
// 決め手: SJIS "テ" = 83h 65h を描いたとき、
//   グラフモード → cell[col]=0x83, cell[col+1]=0x65 ('e')  (各バイト ANK)
//   漢字モード   → 2 セル全角で cell[col+1] != 0x65        (65h は第2バイトとして吸収)
// あわせて ESC)3 の末尾バイト '3' が文字として漏れない (旧バグ) ことも確認する。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

function emit() {
  const b = [];
  const dch  = (ah, dx) => b.push(0xB1,0x10, 0xB4,ah, 0xBA,dx&0xFF,(dx>>8)&0xFF, 0xCD,0xDC); // INT DCh CL=10h
  const cls    = () => dch(0x0A, 2);
  const setpos = (r,c) => dch(0x03, ((r&0xFF)<<8)|(c&0xFF));   // AH=03h DH=r DL=c
  const mode0e = (dx) => dch(0x0E, dx);                        // AH=0Eh: 漢字/グラフモード切替
  const rawb   = (arr) => { for (const ch of arr) b.push(0xB4,0x02, 0xB2,ch&0xFF, 0xCD,0x21); }; // INT 21h AH=02h
  const exit   = () => b.push(0xB4,0x4C, 0xCD,0x21);
  return { b, cls, setpos, mode0e, rawb, exit, bytes: () => Uint8Array.from(b) };
}

// テ = SJIS 83h 65h
const TE = [0x83, 0x65];
function com() {
  const e = emit();
  e.cls();
  // (A) ESC)3 グラフモード: テ を 2 個の ANK として描く → (0,0)=0x83 (0,1)=0x65
  e.setpos(0, 0); e.rawb([0x1b, 0x29, 0x33]); e.rawb(TE);
  // (B) ESC)0 漢字モードに戻す: テ を全角結合 → (2,1) は 0x65 でない
  e.rawb([0x1b, 0x29, 0x30]); e.setpos(2, 0); e.rawb(TE);
  // (C) INT DCh AH=0Eh DX=3 グラフモード: (4,0)=0x83 (4,1)=0x65
  e.mode0e(3); e.setpos(4, 0); e.rawb(TE);
  // (D) INT DCh AH=0Eh DX=0 漢字モード: (6,1) は 0x65 でない
  e.mode0e(0); e.setpos(6, 0); e.rawb(TE);
  e.exit();
  return e.bytes();
}

async function run(name, bin) {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/' + name, bin);
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, bin.length, '', name]);
  M._free(ptr);
  if (sr !== 0) throw new Error('stage ' + sr);
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  for (let f = 0; f < 300; f++) runFrame(handle);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  return { code: (r, c) => peek(handle, 0xA0000 + (r * 80 + c) * 2) & 0xff };
}

(async () => {
  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const v = await run('GRAPHM.COM', com());

  // (A) ESC)3 グラフモード: 各バイトが ANK 1 文字
  expect(v.code(0,0) === 0x83 && v.code(0,1) === 0x65,
    `ESC)3 グラフ: テ(83 65) を ANK 2 文字で描画 (0,0)=83 (0,1)=65='e' (got ${v.code(0,0).toString(16)},${v.code(0,1).toString(16)})`);
  // (B) ESC)0 漢字モード: 全角結合 (第2バイト 0x65 は吸収される)
  expect(v.code(2,1) !== 0x65,
    `ESC)0 漢字: テ を全角結合 (2,1) != 0x65 (got ${v.code(2,1).toString(16)})`);
  // (C) INT DCh AH=0Eh DX=3 グラフモード
  expect(v.code(4,0) === 0x83 && v.code(4,1) === 0x65,
    `INT DCh AH=0Eh DX=3 グラフ: (4,0)=83 (4,1)=65 (got ${v.code(4,0).toString(16)},${v.code(4,1).toString(16)})`);
  // (D) INT DCh AH=0Eh DX=0 漢字モード
  expect(v.code(6,1) !== 0x65,
    `INT DCh AH=0Eh DX=0 漢字: (6,1) != 0x65 (got ${v.code(6,1).toString(16)})`);

  console.log(ok ? 'PASS: グラフ文字モード (ESC)0/)3 + INT DCh AH=0Eh)' : 'FAIL: グラフ文字モード 回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
