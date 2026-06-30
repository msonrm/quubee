#!/usr/bin/env node
// DOS CON カーソル座標ワークエリア (0:0710h=行Y / 0:071Ch=列X) 回帰テスト (2026-06-30)
// ------------------------------------------------------------------------------
// X で報告された WORKTEST.COM の不具合: ゲストが ESC/INT を使わずワークエリア
// (0060:0110=Y / 0060:011C=X) へカーソル座標を直接書き込んでから AH=02h で 'A' を
// 出力すると、実 PC-98 DOS (NP21W) は出力直前にこの番地を読むので 'A' が 10 行 30 列に
// 飛ぶ。QuuBee は内部 g_cur_row/col とこの番地を同期しておらず、直書きが無視されて 'A' が
// 基準位置 (BASE: の直後) に残っていた。tty_putc / INT DCh の前後で双方向同期して根治。
//
// corpus 非依存の合成 COM (org 100h, 49 byte):
//   1. ES = 0x0060 (SEG_WORK)
//   2. AH=09h で ESC[2J / ESC[5;10H / "BASE:" を出力 (→ 0-based row4,col9 から)
//   3. ワークエリア直書き: [es:0x110]=9 (row Y), [es:0x11C]=29 (col X)  ← 核心
//   4. AH=02h DL='A'  → 反映されれば 0-based row9,col29、無視されれば BASE: 直後 (row4,col14)
//   5. jmp $ で凍結 (シェル後処理の干渉を排しスナップショット検証)
// 期待: row9 col29 == 'A'、row4 = "BASE:"、row4 col14 != 'A' (直書き無視の再発を捕まえる)。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// org 100h。msg @ 0x120。
const COM = Uint8Array.from([
  /* 0x100 mov ax,0x0060      */ 0xB8,0x60,0x00,
  /* 0x103 mov es,ax          */ 0x8E,0xC0,
  /* 0x105 mov dx,0x120 (msg) */ 0xBA,0x20,0x01,
  /* 0x108 mov ah,09h         */ 0xB4,0x09,
  /* 0x10A int 21h            */ 0xCD,0x21,
  /* 0x10C mov [es:0x110],9   */ 0x26,0xC6,0x06,0x10,0x01,0x09,
  /* 0x112 mov [es:0x11C],29  */ 0x26,0xC6,0x06,0x1C,0x01,0x1D,
  /* 0x118 mov ah,02h         */ 0xB4,0x02,
  /* 0x11A mov dl,'A'         */ 0xB2,0x41,
  /* 0x11C int 21h            */ 0xCD,0x21,
  /* 0x11E jmp $              */ 0xEB,0xFE,
  /* 0x120 ESC[2J             */ 0x1B,0x5B,0x32,0x4A,
  /* 0x124 ESC[5;10H          */ 0x1B,0x5B,0x35,0x3B,0x31,0x30,0x48,
  /* 0x12B "BASE:$"           */ 0x42,0x41,0x53,0x45,0x3A,0x24,
]);

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/WORKTEST.COM', COM);
  const ptr = M._malloc(COM.length); M.HEAPU8.set(COM, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, COM.length, '', 'WORKTEST.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('FAIL: stage err', sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  for (let f = 0; f < 300; f++) runFrame(handle);

  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  const cell = (r, c) => peek(handle, 0xA0000 + (r * 80 + c) * 2) & 0xff;
  const text = (r, c0, c1) => {
    let s = '';
    for (let c = c0; c <= c1; c++) {
      const lo = cell(r, c);
      s += (lo >= 0x20 && lo < 0x7f) ? String.fromCharCode(lo) : ' ';
    }
    return s;
  };

  const aCell = cell(9, 29);
  const base = text(4, 9, 13);
  const afterBase = cell(4, 14);
  const waY = peek(handle, 0x710) & 0xff;
  const waX = peek(handle, 0x71C) & 0xff;

  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  expect(aCell === 0x41, `ワークエリア直書きが反映: row9 col29 = 'A' (got 0x${aCell.toString(16)})`);
  expect(base === 'BASE:', `基準文字列が row4 col9- に出力: "${base}"`);
  expect(afterBase !== 0x41, `'A' は BASE: 直後 (row4 col14) に残っていない (直書き無視の再発検出): got 0x${afterBase.toString(16)}`);
  expect(waY === 9, `カーソル行ワーク 0:0710h = 9 (store 反映): got ${waY}`);
  expect(waX === 30, `カーソル列ワーク 0:071Ch = 30 ('A' 出力後に列前進): got ${waX}`);
  console.log(ok ? 'PASS: DOS CON カーソル座標ワークエリア (0710h/071Ch) 双方向同期'
                 : 'FAIL: カーソル座標ワークエリア回帰');
  process.exit(ok ? 0 : 1);
})();
