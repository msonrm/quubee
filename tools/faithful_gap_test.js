#!/usr/bin/env node
// dos_hle_gaps.md §4 faithful 化 4 点の headless 回帰 (2026-07-05)
// ------------------------------------------------------------------------------
// 実 DOS 契約 (精査グループ C の残・いずれも「嘘の成功より正直な失敗」):
//   §4-1-3  read-only open (AH=3Dh AL=0) への AH=40h write は CF=1/AX=5 (access denied)。
//           旧実装は fwrite が 0 を返して「0 バイト書けた・成功 (CF=0)」だった。
//   §4-1-4  AH=41h Delete のエラーは出し分け: 途中ディレクトリ欠=3 / ファイル無し=2 /
//           実在するのに消せない=5。旧実装は一律 AX=2 で open/create 系と不整合。
//   §4-2-10 AH=0Ah の Enter エコーは CR のみ (LF はプログラム側が出す規約)。旧実装は
//           CR+LF で、自前で LF を出すソフトが 1 行余分に進んでいた。
//   §4-2-15 IOCTL AL=01h は AL=00h と同じハンドル検証 (未 open/範囲外 → AX=6)。旧実装は
//           どんな BX でも黙って CF=0 成功だった。
//
// 合成 COM の作り: 分岐なしの線形列。各 int 21h の直後に
//   mov [slot],ax / sbb ax,ax (AX = CF ? FFFF : 0000) / mov [slot+2],ax
// で AX と CF を固定番地スロットに記録し、JS 側が値を照合する (ジャンプの手組み不要)。
// データ/スロットは addr 0x300 固定 (コードは 0x300 未満・COM は org 100h、image index =
// addr-0x100、linear = 0x1000+addr)。
//
// 使い方: node tools/faithful_gap_test.js

const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

let ok = true;
const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

// stdin_cx1_test.js と同じ共通ハーネス (1 インスタンス起動 → COM stage → boot)
async function boot(comBin) {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/T.COM', comBin);
  const ptr = M._malloc(comBin.length); M.HEAPU8.set(comBin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, comBin.length, '', 'T.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = (a) => M.ccall('np2kai_debug_peek8', 'number', ['number','number'], [handle, a]) & 0xff;
  const inject = (bytes) => { const p = M._malloc(bytes.length);
    M.HEAPU8.set(Uint8Array.from(bytes), p);
    M.ccall('np2kai_inject_text', null, ['number','number','number'], [handle, p, bytes.length]); M._free(p); };
  for (let f = 0; f < 200; f++) runFrame(handle);   // boot 進行
  return { M, handle, runFrame, getExit, peek, inject };
}

// ---- COM 組み立てヘルパ ----
// code: addr 0x100〜 / data: addr 0x300〜 (固定)。スロット sentinel は 0xEE。
const DATA = 0x300;
function buildCom(code, dataBytes) {
  const img = new Uint8Array((DATA - 0x100) + dataBytes.length);
  img.fill(0x90, 0, DATA - 0x100);                 // 未使用域は NOP 埋め (実行は exit で終わる)
  img.set(code, 0);
  img.set(dataBytes, DATA - 0x100);
  return img;
}
const lo = (v) => v & 0xFF, hi = (v) => (v >> 8) & 0xFF;
// int 21h → [axAddr]=AX / [axAddr+2]=CF (FFFF/0000)
const int21save = (axAddr) => [0xCD, 0x21, 0xA3, lo(axAddr), hi(axAddr), 0x19, 0xC0, 0xA3, lo(axAddr + 2), hi(axAddr + 2)];
const word = (t, a) => t.peek(0x1000 + a) | (t.peek(0x1000 + a + 1) << 8);
const h4 = (v) => '0x' + v.toString(16);

(async () => {
  // ===== テスト 1 (§4-1-3): read-only open への AH=40h write / CX=0 truncate → AX=5 =====
  {
    // data: 0x300 "T.DAT"\0 / 0x310 "ABCD" / 0x318 buf(4) / slots 0x340..0x34F
    const code = [
      0xB4, 0x3C, 0x31, 0xC9, 0xBA, 0x00, 0x03,      // create T.DAT
      0xCD, 0x21, 0x89, 0xC3,                         // handle → bx
      0xB4, 0x40, 0xB9, 0x04, 0x00, 0xBA, 0x10, 0x03, 0xCD, 0x21,   // write "ABCD"
      0xB4, 0x3E, 0xCD, 0x21,                         // close
      0xB8, 0x00, 0x3D, 0xBA, 0x00, 0x03, 0xCD, 0x21, 0x89, 0xC3,   // open read-only → bx
      0xB4, 0x40, 0xB9, 0x04, 0x00, 0xBA, 0x10, 0x03, // write 4 (ro) → 期待 CF=1/AX=5
      ...int21save(0x344),
      0xB4, 0x40, 0x31, 0xC9,                         // CX=0 truncate (ro) → 期待 CF=1/AX=5
      ...int21save(0x348),
      0xB8, 0x00, 0x42, 0x31, 0xC9, 0xBA, 0x00, 0x00, 0xCD, 0x21,   // seek SET 0
      0xB4, 0x3F, 0xB9, 0x04, 0x00, 0xBA, 0x18, 0x03, // read back 4 → 期待 CF=0/AX=4
      ...int21save(0x34C),
      0xB8, 0x00, 0x4C, 0xCD, 0x21,                   // exit
    ];
    const data = new Uint8Array(0x60).fill(0xEE);
    data.set([0x54, 0x2E, 0x44, 0x41, 0x54, 0x00], 0x00);            // "T.DAT"\0
    data.set([0x41, 0x42, 0x43, 0x44], 0x10);                        // "ABCD"
    data.set([0x00, 0x00, 0x00, 0x00], 0x18);                        // buf
    const t = await boot(buildCom(code, data));
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    expect(t.getExit(0) === 1, 'ro-write: COM が終了');
    expect(word(t, 0x346) === 0xFFFF && word(t, 0x344) === 5,
           `ro handle への write 4 が CF=1/AX=5 (got cf=${h4(word(t, 0x346))} ax=${h4(word(t, 0x344))})`);
    expect(word(t, 0x34A) === 0xFFFF && word(t, 0x348) === 5,
           `ro handle への CX=0 truncate が CF=1/AX=5 (got cf=${h4(word(t, 0x34A))} ax=${h4(word(t, 0x348))})`);
    const buf = [0, 1, 2, 3].map((i) => t.peek(0x1000 + 0x318 + i));
    expect(word(t, 0x34E) === 0 && word(t, 0x34C) === 4 && String.fromCharCode(...buf) === 'ABCD',
           `ファイルは無傷 (read back "ABCD") (got cf=${h4(word(t, 0x34E))} ax=${word(t, 0x34C)} buf="${String.fromCharCode(...buf)}")`);
    const fsData = t.M.FS.readFile('/run/T.DAT');
    expect(fsData.length === 4, `MEMFS 上も 4 byte のまま (truncate されていない) (got ${fsData.length})`);
  }

  // ===== テスト 2 (§4-1-4): AH=41h Delete のエラーコード出し分け =====
  {
    // data: 0x300 "NODIR\MISSING.DAT"\0 / 0x318 "MISSING.DAT"\0 / 0x328 "DEL.DAT"\0
    const code = [
      0xB4, 0x41, 0xBA, 0x00, 0x03,                   // delete NODIR\MISSING.DAT → 期待 AX=3
      ...int21save(0x340),
      0xB4, 0x41, 0xBA, 0x18, 0x03,                   // delete MISSING.DAT → 期待 AX=2
      ...int21save(0x344),
      0xB4, 0x3C, 0x31, 0xC9, 0xBA, 0x28, 0x03, 0xCD, 0x21, 0x89, 0xC3,   // create DEL.DAT
      0xB4, 0x3E, 0xCD, 0x21,                         // close
      0xB4, 0x41, 0xBA, 0x28, 0x03,                   // delete DEL.DAT → 期待 CF=0
      ...int21save(0x348),
      0xB8, 0x00, 0x3D, 0xBA, 0x28, 0x03,             // open DEL.DAT → 期待 AX=2 (消えた)
      ...int21save(0x34C),
      0xB8, 0x00, 0x4C, 0xCD, 0x21,                   // exit
    ];
    const data = new Uint8Array(0x60).fill(0xEE);
    data.set(Buffer.from('NODIR\\MISSING.DAT\0', 'latin1'), 0x00);
    data.set(Buffer.from('MISSING.DAT\0', 'latin1'), 0x18);
    data.set(Buffer.from('DEL.DAT\0', 'latin1'), 0x28);
    const t = await boot(buildCom(code, data));
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    expect(t.getExit(0) === 1, 'delete: COM が終了');
    expect(word(t, 0x342) === 0xFFFF && word(t, 0x340) === 3,
           `途中ディレクトリ欠の delete が AX=3 (path not found) (got cf=${h4(word(t, 0x342))} ax=${word(t, 0x340)})`);
    expect(word(t, 0x346) === 0xFFFF && word(t, 0x344) === 2,
           `親はあるがファイル無しの delete が AX=2 (file not found) (got cf=${h4(word(t, 0x346))} ax=${word(t, 0x344)})`);
    expect(word(t, 0x34A) === 0x0000,
           `実在ファイルの delete は成功 (CF=0) (got cf=${h4(word(t, 0x34A))})`);
    expect(word(t, 0x34E) === 0xFFFF && word(t, 0x34C) === 2,
           `delete 後の open が AX=2 (実際に消えた) (got cf=${h4(word(t, 0x34E))} ax=${word(t, 0x34C)})`);
    let gone = false;
    try { t.M.FS.stat('/run/DEL.DAT'); } catch (_) { gone = true; }
    expect(gone, 'MEMFS からも DEL.DAT が消えている');
  }

  // ===== テスト 3 (§4-2-15): IOCTL AL=01h のハンドル検証 =====
  {
    const code = [
      0xB8, 0x01, 0x44, 0xBB, 0x1E, 0x00, 0xBA, 0x00, 0x00,   // 4401h BX=30 (範囲内・未 open) → 期待 AX=6
      ...int21save(0x340),
      0xB8, 0x01, 0x44, 0xBB, 0x01, 0x00, 0xBA, 0x00, 0x00,   // 4401h BX=1 (CON) → 期待 CF=0
      ...int21save(0x344),
      0xB8, 0x01, 0x44, 0xBB, 0x63, 0x00, 0xBA, 0x00, 0x00,   // 4401h BX=99 (範囲外) → 期待 AX=6
      ...int21save(0x348),
      0xB8, 0x00, 0x4C, 0xCD, 0x21,                            // exit
    ];
    const data = new Uint8Array(0x10).fill(0xEE);
    const t = await boot(buildCom(code, data));
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    expect(t.getExit(0) === 1, 'ioctl: COM が終了');
    expect(word(t, 0x342) === 0xFFFF && word(t, 0x340) === 6,
           `4401h 未 open ハンドル (30) が CF=1/AX=6 (got cf=${h4(word(t, 0x342))} ax=${word(t, 0x340)})`);
    expect(word(t, 0x346) === 0x0000,
           `4401h CON (handle 1) は従来どおり成功 (got cf=${h4(word(t, 0x346))})`);
    expect(word(t, 0x34A) === 0xFFFF && word(t, 0x348) === 6,
           `4401h 範囲外ハンドル (99) が CF=1/AX=6 (got cf=${h4(word(t, 0x34A))} ax=${word(t, 0x348)})`);
  }

  // ===== テスト 4 (§4-2-10): AH=0Ah の Enter エコーは CR のみ (行が進まない) =====
  {
    // 'P' を AH=02h で出してから AH=0Ah。CR+LF エコーだと確定時に行 (0:0710) が +1 進む。
    const code = [
      0xB4, 0x02, 0xB2, 0x50, 0xCD, 0x21,             // mov ah,02h / mov dl,'P' / int 21h
      0xB4, 0x0A, 0xBA, 0x00, 0x03, 0xCD, 0x21,       // AH=0Ah buf=0x300
      0xB8, 0x00, 0x4C, 0xCD, 0x21,                   // exit
    ];
    const data = new Uint8Array(0x20);
    data[0] = 16;                                     // cap
    const t = await boot(buildCom(code, data));
    for (let f = 0; f < 300; f++) t.runFrame(t.handle);   // 'P' 表示 → 0Ah 入力待ちへ
    const row0 = t.peek(0x710), col0 = t.peek(0x71C);
    expect(col0 >= 1, `0Ah 待機中: 'P' エコー後の桁が 1 以上 (got row=${row0} col=${col0})`);
    t.inject([0x41, 0x42, 0x0D]);                     // "AB" + Enter
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    expect(t.getExit(0) === 1, '0Ah echo: COM が終了');
    const row1 = t.peek(0x710), col1 = t.peek(0x71C);
    expect(col1 === 0, `Enter エコーで桁が 0 に戻る (CR) (got col=${col1})`);
    expect(row1 === row0, `行は進まない (LF を出さない・実 DOS 契約) (got ${row0} → ${row1})`);
    const len = t.peek(0x1000 + 0x301);
    const b = [0, 1, 2].map((i) => t.peek(0x1000 + 0x302 + i));
    expect(len === 2 && b[0] === 0x41 && b[1] === 0x42 && b[2] === 0x0D,
           `バッファは len=2 "AB"+CR (got len=${len} ${b.map(h4).join(' ')})`);
  }

  console.log(ok ? 'PASS: dos_hle_gaps §4 faithful 化 4 点 (ro-write 5 / delete 2・3・5 / IOCTL 01h 検証 / 0Ah CR エコー)'
                 : 'FAIL: faithful_gap_test');
  process.exit(ok ? 0 : 1);
})();
