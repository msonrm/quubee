#!/usr/bin/env node
// INT DCh CL=10h カーソル移動 / 行挿入・削除 回帰テスト (2026-06-29)
// ------------------------------------------------------------------------------
// lpproj 氏 gist (FreeDOS(98) INT DCh) の CL=10h は AH=04-0Eh も「実装済(○)」。
// 本テストは AH=06-09 (カーソル ↑↓→← n 移動)・AH=04/05 (1 行下/上移動)・
// AH=0Ch/0Dh (行挿入/削除) を合成 COM で叩き、テキスト VRAM のセル配置を直接検証する。
// (AH=00/01/02/03/0A/0B は intdc_screen_test.js が別途カバー)
//
// 全て AH=00h (1 文字表示, DL=文字) で文字を置く (DS:DX 文字列のオフセット計算を避ける)。
// 行挿入/削除は他テスト領域より下/独立行で行い、行シフトが干渉しない順序で並べる。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// ---- COM コードを JS で組み立て (org 100h、データ不要) ----
const code = [];
const CL10 = () => code.push(0xB1, 0x10);          // MOV CL,10h (CL=10h 文字・画面制御)
const INTDC = () => code.push(0xCD, 0xDC);         // INT DCh
const cls    = () => { CL10(); code.push(0xB4,0x0A, 0xBA,0x02,0x00); INTDC(); };           // AH=0Ah DX=2 全消去
const setpos = (r,c) => { CL10(); code.push(0xB4,0x03, 0xBA,c&0xFF,r&0xFF); INTDC(); };    // AH=03h DH=r DL=c
const putc   = (ch) => { CL10(); code.push(0xB4,0x00, 0xB2,ch&0xFF); INTDC(); };           // AH=00h DL=ch
const moven  = (ah,n) => { CL10(); code.push(0xB4,ah, 0xBA,n&0xFF,(n>>8)&0xFF); INTDC(); };// AH=ah DX=n
const line1  = (ah) => { CL10(); code.push(0xB4,ah); INTDC(); };                            // AH=ah (引数なし)
const puts   = (s) => { for (const ch of s) putc(ch.charCodeAt(0)); };

cls();

// --- Region 4 (rows 6-8): AH=0Dh 行削除 (上シフト) — 先に実行 (シフトが他領域へ及ばぬよう最上段) ---
setpos(6,0); putc(0x53 /*S*/);
setpos(7,0); putc(0x54 /*T*/);
setpos(8,0); putc(0x55 /*U*/);
setpos(6,0); moven(0x0D, 1);     // row6 削除 → row6=T, row7=U, row8=空

// --- Region 3 (rows 20-22): AH=0Ch 行挿入 (下シフト) ---
setpos(20,0); puts('L20');
setpos(21,0); puts('L21');
setpos(20,0); moven(0x0C, 1);    // row20 に 1 行挿入 → row20=空, row21=L20, row22=L21

// --- Region 1 (rows 10-12): AH=06-09 カーソル移動 ---
setpos(10,0); putc(0x41 /*A*/);  // A@(10,0) → cur(10,1)
moven(0x07, 2); putc(0x42 /*B*/);// 下2 → cur(12,1); B@(12,1) → cur(12,2)
moven(0x06, 1); putc(0x43 /*C*/);// 上1 → cur(11,2); C@(11,2) → cur(11,3)
moven(0x09, 5); putc(0x44 /*D*/);// 左5 → cur(11,0) clamp; D@(11,0) → cur(11,1)
moven(0x08, 4); putc(0x45 /*E*/);// 右4 → cur(11,5); E@(11,5)

// --- Region 2 (rows 3-4): AH=04/05 1 行下/上移動 ---
setpos(3,0); putc(0x50 /*P*/);   // P@(3,0) → cur(3,1)
line1(0x04); putc(0x51 /*Q*/);   // 下1 → cur(4,1); Q@(4,1) → cur(4,2)
line1(0x05); putc(0x52 /*R*/);   // 上1 → cur(3,2); R@(3,2)

code.push(0xB4,0x4C, 0xCD,0x21); // AH=4Ch exit
const COM = Uint8Array.from(code);

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/INTDCC.COM', COM);
  const ptr = M._malloc(COM.length); M.HEAPU8.set(COM, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, COM.length, '', 'INTDCC.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('FAIL: stage err', sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  for (let f = 0; f < 400; f++) runFrame(handle);

  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  const cell = (r, c) => peek(handle, 0xA0000 + (r * 80 + c) * 2) & 0xff;  // code plane 低位 = ANK
  const ch = (r, c) => { const lo = cell(r, c); return (lo >= 0x20 && lo < 0x7f) ? String.fromCharCode(lo) : '.'; };

  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

  // Region 1: カーソル移動 AH=06-09
  expect(ch(10,0) === 'A', `AH-move: A@(10,0) = "${ch(10,0)}"`);
  expect(ch(12,1) === 'B', `AH=07 下2: B@(12,1) = "${ch(12,1)}"`);
  expect(ch(11,2) === 'C', `AH=06 上1: C@(11,2) = "${ch(11,2)}"`);
  expect(ch(11,0) === 'D', `AH=09 左(clamp): D@(11,0) = "${ch(11,0)}"`);
  expect(ch(11,5) === 'E', `AH=08 右4: E@(11,5) = "${ch(11,5)}"`);

  // Region 2: 1 行移動 AH=04/05
  expect(ch(3,0) === 'P', `P@(3,0) = "${ch(3,0)}"`);
  expect(ch(4,1) === 'Q', `AH=04 下1: Q@(4,1) = "${ch(4,1)}"`);
  expect(ch(3,2) === 'R', `AH=05 上1: R@(3,2) = "${ch(3,2)}"`);

  // Region 3: 行挿入 AH=0Ch
  expect(cell(20,0) === 0x20, `AH=0C 挿入: row20 空 (cell=${cell(20,0).toString(16)})`);
  expect(ch(21,0)+ch(21,1)+ch(21,2) === 'L20', `AH=0C 挿入: row21="L20" 押下 = "${ch(21,0)+ch(21,1)+ch(21,2)}"`);
  expect(ch(22,0)+ch(22,1)+ch(22,2) === 'L21', `AH=0C 挿入: row22="L21" 押下 = "${ch(22,0)+ch(22,1)+ch(22,2)}"`);

  // Region 4: 行削除 AH=0Dh
  expect(ch(6,0) === 'T', `AH=0D 削除: row6=T (繰上げ) = "${ch(6,0)}"`);
  expect(ch(7,0) === 'U', `AH=0D 削除: row7=U (繰上げ) = "${ch(7,0)}"`);
  expect(cell(8,0) === 0x20, `AH=0D 削除: row8 空 (cell=${cell(8,0).toString(16)})`);

  console.log(ok ? 'PASS: INT DCh CL=10h カーソル移動/行挿入削除' : 'FAIL: INT DCh CL=10h 回帰');
  process.exit(ok ? 0 : 1);
})();
