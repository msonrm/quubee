#!/usr/bin/env node
// GDC ハードウェアカーソル追従 回帰テスト (2026-07-02)
// ------------------------------------------------------------------------------
// 実 PC-98 DOS の CON はカーソル移動のたび GDC (master) に CSRW を発行するので、GDC の
// CSRR で「実カーソル位置」を読み戻せる。QuickBASIC ランタイムはこれを利用して起動時に
// 「ESC[21;1H でカーソルを 21 行目へ→CSRR 読み戻しが 21 行目か?」で 20/25 行を判定する。
// HLE tty が論理カーソルだけ動かして GDC を更新しないと、この読み戻しが常に古い位置になり
// QB が 20 行と誤認 → 以後の LOCATE x,25 が一律「引数が許される範囲ではありません (ERR=5)」
// (maze-776 / MAZE_999 = QB 製アプリ全般で実証)。修正 = tty_store_cursor が GDC_CSRW を追従。
//
// テスト: ESC[13;6H を INT 29h で出力 → CSRR (0xE0) を I/O で発行 → EAD 2 バイトを読み
// (13-1)*80+(6-1) = 965 = 0x03C5 になることを確認する (QB プローブの縮小再現)。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

function com() {
  const b = [];
  for (const ch of '\x1b[13;6H') b.push(0xB0, ch.charCodeAt(0), 0xCD, 0x29);  // mov al,c ; int 29h
  b.push(0xB0, 0xE0,        // mov al,0E0h (CSRR)
         0xE6, 0x62);       // out 62h,al (master GDC command)
  b.push(0xE4, 0x60,        // wait: in al,60h (status)
         0xA8, 0x01,        // test al,1 (data ready)
         0x74, 0xFA);       // jz wait
  b.push(0xE4, 0x62,        // in al,62h → EAD low
         0x88, 0xC3,        // mov bl,al
         0xE4, 0x62,        // in al,62h → EAD high
         0x88, 0xC7);       // mov bh,al
  const storeAt = b.length;
  b.push(0x89, 0x1E, 0, 0,  // mov [ead],bx (placeholder)
         0xB4, 0x4C, 0xCD, 0x21);
  const eadOff = 0x100 + b.length;
  b[storeAt + 2] = eadOff & 0xFF; b[storeAt + 3] = (eadOff >> 8) & 0xFF;
  b.push(0xEE, 0xEE);       // ead sentinel
  return { bin: Uint8Array.from(b), eadLin: 0x1000 + eadOff };
}

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const { bin, eadLin } = com();
  M.FS.writeFile('/run/CSR.COM', bin);
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, bin.length, '', 'CSR.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = (a) => M.ccall('np2kai_debug_peek8', 'number', ['number','number'], [handle, a]) & 0xff;
  for (let f = 0; f < 600 && !getExit(0); f++) runFrame(handle);

  const ead = peek(eadLin) | (peek(eadLin + 1) << 8);
  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  expect(getExit(0) === 1, 'COM が完走 (CSRR data-ready が来ないハング無し)');
  expect(ead === 12 * 80 + 5, `CSRR 読み戻し EAD = 0x3C5 (ESC[13;6H → row12*80+col5) (got 0x${ead.toString(16)})`);
  console.log(ok ? 'PASS: GDC ハードウェアカーソルが tty カーソルに追従 (QB 20/25 行プローブ互換)'
                 : 'FAIL: GDC カーソル追従回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
