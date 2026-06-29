#!/usr/bin/env node
// ESC/CSI シーケンス回帰テスト (2026-06-29) — TEXTTEST(SimK) が突いた「消費するが無視」系を根治
// ------------------------------------------------------------------------------
// (A) ESC[6n  DSR カーソル位置レポート: 応答 ESC[<row>;<col>R を入力ストリームへ注入する
//     (未実装だと PC98ADV1 が応答待ちでハングしていた)。
// (B) ESC[s / ESC[u: カーソル位置 + 属性 (PC-98 CON は属性も) の保存/復元。
// (C) ESC M: reverse index (1 行上・上端で逆スクロール)。生 ESC を破棄していたのを根治。
//
// 各機能を独立した合成 COM で叩く (互いのスクロール干渉を避ける)。カーソル/属性/文字は
// INT DCh CL=10h (AH=03/02/00) で、生 ESC バイトは INT 21h AH=02h (tty_putc 直結) で発行。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// ---- COM エミッタ ----
function emit() {
  const b = [];
  const dch = (ah, dx) => b.push(0xB1,0x10, 0xB4,ah, 0xBA,dx&0xFF,(dx>>8)&0xFF, 0xCD,0xDC); // INT DCh CL=10h
  const cls    = () => dch(0x0A, 2);
  const setpos = (r,c) => dch(0x03, ((r&0xFF)<<8)|(c&0xFF));   // AH=03h DH=r DL=c
  const attr   = (a) => dch(0x02, a&0xFF);                     // AH=02h DL=attr
  const putc   = (ch) => dch(0x00, ch&0xFF);                   // AH=00h DL=char
  const raw    = (s) => { for (const ch of s) b.push(0xB4,0x02, 0xB2,ch.charCodeAt(0)&0xFF, 0xCD,0x21); }; // INT 21h AH=02h
  const rawb   = (arr) => { for (const ch of arr) b.push(0xB4,0x02, 0xB2,ch&0xFF, 0xCD,0x21); };
  const exit   = () => b.push(0xB4,0x4C, 0xCD,0x21);
  return { b, cls, setpos, attr, putc, raw, rawb, exit, bytes: () => Uint8Array.from(b) };
}

// (A) DSR: cursor→(13,50) 0-based, send ESC[6n, exit. 応答は ESC[14;51R (1-based) のはず。
function comDSR() {
  const e = emit();
  e.setpos(13, 50);
  e.raw('\x1b[6n');
  e.exit();
  return e.bytes();
}
// (B) save/restore: (5,10)attr05 を save → (20,0)attr E1 で 'X' → restore → (5,10) で 'Y'
function comSaveRestore() {
  const e = emit();
  e.cls();
  e.setpos(5, 10); e.attr(0x05);
  e.raw('\x1b[s');                 // save (5,10,attr05)
  e.setpos(20, 0); e.attr(0xE1); e.putc(0x58 /*X*/);
  e.raw('\x1b[u');                 // restore → (5,10), attr05
  e.putc(0x59 /*Y*/);
  e.exit();
  return e.bytes();
}
// (D) ESC = l c (VT52/PC-98 直接カーソル位置指定): row8 col10 (1-based) → 0-based (7,9) に 'Q'
function comEscEq() {
  const e = emit();
  e.cls();
  e.rawb([0x1b, 0x3d, 0x20 + 8 - 1, 0x20 + 10 - 1]);  // ESC = (row8) (col10)
  e.putc(0x51 /*Q*/);                                  // 'Q' → (7,9)
  e.exit();
  return e.bytes();
}
// (C) reverse index: top で ESC M=逆スクロール、非 top で 1 行上
function comReverseIndex() {
  const e = emit();
  e.cls();
  e.setpos(0, 0); e.putc(0x5A /*Z*/);   // Z@(0,0)
  e.setpos(0, 0); e.rawb([0x1b, 0x4D]); // ESC M @top → Z が row1 へ、row0 空
  e.setpos(5, 0); e.putc(0x57 /*W*/);   // W@(5,0)
  e.setpos(5, 3); e.rawb([0x1b, 0x4D]); // ESC M @row5 → cursor (4,3)
  e.putc(0x56 /*V*/);                   // V@(4,3)
  e.exit();
  return e.bytes();
}

async function run(name, com) {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/' + name, com);
  const ptr = M._malloc(com.length); M.HEAPU8.set(com, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, com.length, '', name]);
  M._free(ptr);
  if (sr !== 0) throw new Error('stage ' + sr);
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  for (let f = 0; f < 300; f++) runFrame(handle);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  return {
    code: (r, c) => peek(handle, 0xA0000 + (r * 80 + c) * 2) & 0xff,
    attr: (r, c) => peek(handle, 0xA2000 + (r * 80 + c) * 2) & 0xff,
    peek16: (a) => (peek(handle, a) & 0xff) | ((peek(handle, a + 1) & 0xff) << 8),
    peek8: (a) => peek(handle, a) & 0xff,
  };
}

(async () => {
  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

  // ---- (A) DSR ----
  {
    const v = await run('ESCDSR.COM', comDSR());
    // BIOS キーバッファ (0x502) を head から count 個読み、低位 (char) を並べる
    const count = v.peek8(0x528);
    let pos = v.peek16(0x524), s = '';
    for (let i = 0; i < count; i++) {
      s += String.fromCharCode(v.peek16(pos) & 0xff);
      pos += 2; if (pos >= 0x522) pos = 0x502;
    }
    const got = s.replace('\x1b', 'ESC');
    expect(count === 8 && s === '\x1b[14;51R',
      `ESC[6n DSR → 応答 "ESC[14;51R" を入力に注入 (count=${count} got="${got}")`);
  }

  // ---- (B) save/restore cursor + attr ----
  {
    const v = await run('ESCSU.COM', comSaveRestore());
    expect(v.code(20,0) === 0x58 && v.attr(20,0) === 0xE1, `'X'@(20,0) attr=E1 (got code=${v.code(20,0).toString(16)} attr=${v.attr(20,0).toString(16)})`);
    expect(v.code(5,10) === 0x59, `ESC[u: 'Y'@(5,10) (カーソル復元) (got=${v.code(5,10).toString(16)})`);
    expect(v.attr(5,10) === 0x05, `ESC[u: (5,10) の属性が 0x05 に復元 (got=${v.attr(5,10).toString(16)})`);
  }

  // ---- (C) reverse index ESC M ----
  {
    const v = await run('ESCM.COM', comReverseIndex());
    expect(v.code(0,0) === 0x20, `ESC M @top: row0 空 (逆スクロール) (got=${v.code(0,0).toString(16)})`);
    expect(v.code(1,0) === 0x5A, `ESC M @top: 'Z' が row1 へ降下 (got=${v.code(1,0).toString(16)})`);
    expect(v.code(5,0) === 0x57, `'W'@(5,0) 健在 (got=${v.code(5,0).toString(16)})`);
    expect(v.code(4,3) === 0x56, `ESC M @row5: 'V'@(4,3) (1 行上移動・スクロールなし) (got=${v.code(4,3).toString(16)})`);
  }

  // ---- (D) ESC = 直接カーソル位置指定 ----
  {
    const v = await run('ESCEQ.COM', comEscEq());
    expect(v.code(7,9) === 0x51, `ESC = l c: 'Q'@(7,9) (row8/col10) (got=${v.code(7,9).toString(16)})`);
    let row0 = ''; for (let c = 0; c < 6; c++) { const lo = v.code(0,c); row0 += (lo>=0x20&&lo<0x7f)?String.fromCharCode(lo):'.'; }
    expect(row0.trim() === '', `ESC = の位置バイトが row0 に漏れない (got="${row0}")`);
  }

  console.log(ok ? 'PASS: ESC/CSI (DSR / save-restore / reverse-index / ESC=)' : 'FAIL: ESC/CSI 回帰');
  process.exit(ok ? 0 : 1);
})();
