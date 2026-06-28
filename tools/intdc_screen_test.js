#!/usr/bin/env node
// INT DCh CL=10h (文字・画面制御) 回帰テスト (2026-06-29)
// ------------------------------------------------------------------------------
// 蟹味噌(KANI123)の左上テキスト残留 / OTENKI の文字描写不具合の真因 = INT DCh CL=10h
// (NEC PC-98 DOS のコンソール BIOS) 未実装。lpproj gist + KANI/SimK PC98DCH.COM の実
// トレースで仕様確定し、qb_dos_intdc_hook で既存 tty へ橋渡しした (native/dos_int21.c)。
//
// corpus 非依存の合成 COM で CL=10h を叩き、テキスト VRAM を直接検証する:
//   1. AH=01h で "DIRTY" を row0 に表示
//   2. AH=0Ah(DX=2) で画面消去      ← 蟹味噌の ESC[2J に相当する核心
//   3. AH=03h で (row=3,col=0) へカーソル移動
//   4. AH=01h で "CLEAN" を表示 (→ row3)
//   5. AH=02h 属性設定 (スモーク)・AH=4Ch 終了
// 期待: row0 は空 (消去された)、row3 = "CLEAN"。画面消去が効かないと row0 に "DIRTY"
// が残る = 蟹味噌残留の再発を捕まえる。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// org 100h の COM。コード 49 byte → strDirty@0x131, strClean@0x137。
const COM = Uint8Array.from([
  /* AH=01h "DIRTY$" */ 0xB1,0x10, 0xB4,0x01, 0xBA,0x31,0x01, 0xCD,0xDC,
  /* AH=0Ah DX=2 cls */ 0xB1,0x10, 0xB4,0x0A, 0xBA,0x02,0x00, 0xCD,0xDC,
  /* AH=03h (3,0)    */ 0xB1,0x10, 0xB4,0x03, 0xB6,0x03, 0xB2,0x00, 0xCD,0xDC,
  /* AH=01h "CLEAN$" */ 0xB1,0x10, 0xB4,0x01, 0xBA,0x37,0x01, 0xCD,0xDC,
  /* AH=02h attr e1  */ 0xB1,0x10, 0xB4,0x02, 0xB2,0xE1, 0xCD,0xDC,
  /* AH=4Ch exit     */ 0xB4,0x4C, 0xCD,0x21,
  /* strDirty @0x131 */ 0x44,0x49,0x52,0x54,0x59,0x24,
  /* strClean @0x137 */ 0x43,0x4C,0x45,0x41,0x4E,0x24,
]);

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/INTDCH.COM', COM);
  const ptr = M._malloc(COM.length); M.HEAPU8.set(COM, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, COM.length, '', 'INTDCH.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('FAIL: stage err', sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  for (let f = 0; f < 400; f++) runFrame(handle);

  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  const row = (r) => {
    let s = '';
    for (let c = 0; c < 20; c++) {
      const lo = peek(handle, 0xA0000 + (r * 80 + c) * 2) & 0xff;
      s += (lo >= 0x20 && lo < 0x7f) ? String.fromCharCode(lo) : ' ';
    }
    return s.trim();
  };
  const row0 = row(0), row3 = row(3);
  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  expect(row0 === '', `row0 が空 (画面消去が効く / 蟹味噌残留なし): "${row0}"`);
  expect(row3.startsWith('CLEAN'), `row3 = "CLEAN" (AH=03h カーソル + AH=01h 文字列): "${row3}"`);
  console.log(ok ? 'PASS: INT DCh CL=10h 文字・画面制御' : 'FAIL: INT DCh CL=10h 回帰');
  process.exit(ok ? 0 : 1);
})();
