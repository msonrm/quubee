#!/usr/bin/env node
// AH=3Fh handle 0 (STDIN) cooked 行入力 回帰テスト (2026-06-30)
// ------------------------------------------------------------------------------
// 実 DOS / np21w: STDIN (handle 0) を AH=3Fh で読むと CON の cooked 行入力になり、
// Enter まで待って「行 + CR LF」を返す ("Hi"+Enter → 48 69 0D 0A、count=4)。
// 旧実装は fh_get(0)=NULL で AX=6 (invalid handle) を返し、TurboC の getchar/scanf/gets が
// 全滅していた (AH=40h は h=1/2 を tty へ分岐するのに read 側に STDIN 分岐が無かった非対称)。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// COM: AH=3Fh BX=0 CX=64 DX=buf で STDIN を読み、AX を count へ格納して終了。
function com() {
  const b = [];
  // 配置: code(0x100..) → buf(64) → count(2)。offset を後で確定。
  const head = [
    0xB4, 0x3F,             // mov ah,3Fh
    0xBB, 0x00, 0x00,       // mov bx,0 (STDIN)
    0xB9, 0x40, 0x00,       // mov cx,64
    0xBA, 0, 0,             // mov dx,buf  (placeholder @9,10)
    0xCD, 0x21,             // int 21h
    0xA3, 0, 0,             // mov [count],ax (placeholder @15,16)
    0xB4, 0x4C, 0xCD, 0x21, // mov ah,4Ch ; int 21h
  ];
  const codeLen = head.length;            // 20
  const bufOff = 0x100 + codeLen;         // buffer 先頭
  const countOff = bufOff + 64;
  head[9]  = bufOff & 0xFF;   head[10] = (bufOff >> 8) & 0xFF;   // mov dx,buf のオペランド (index 9,10)
  head[14] = countOff & 0xFF; head[15] = (countOff >> 8) & 0xFF; // mov [count],ax のオペランド (index 14,15)
  for (const x of head) b.push(x);
  for (let i = 0; i < 64 + 2; i++) b.push(0);   // buf + count 領域
  return { bin: Uint8Array.from(b), bufLin: 0x1000 + bufOff, countLin: 0x1000 + countOff };
}

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const { bin, bufLin, countLin } = com();
  M.FS.writeFile('/run/STDINR.COM', bin);
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, bin.length, '', 'STDINR.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  const inject = (s) => { const a = Array.from(s).map(c => c.charCodeAt(0)); const p = M._malloc(a.length);
    M.HEAPU8.set(Uint8Array.from(a), p); M.ccall('np2kai_inject_text', null, ['number','number','number'], [handle, p, a.length]); M._free(p); };

  // 起動を少し進めてから "Hi" + CR を注入 (cooked 行入力は Enter で確定)
  for (let f = 0; f < 200; f++) runFrame(handle);
  inject('Hi\r');
  for (let f = 0; f < 600 && !getExit(0); f++) runFrame(handle);

  const count = (peek(handle, countLin) & 0xff) | ((peek(handle, countLin + 1) & 0xff) << 8);
  const bytes = []; for (let i = 0; i < count && i < 16; i++) bytes.push(peek(handle, bufLin + i) & 0xff);
  const hex = bytes.map(x => x.toString(16).padStart(2, '0')).join(' ');

  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  expect(getExit(0) === 1, 'COM が終了 (AH=3Fh がエラーにならず読めた)');
  expect(count === 4, `count=4 ("Hi"+CR LF) (got ${count})`);
  expect(hex === '48 69 0d 0a', `bytes = 48 69 0d 0a ("Hi"<CR><LF>) (got "${hex}")`);
  console.log(ok ? 'PASS: AH=3Fh handle 0 = STDIN cooked 行入力 (行+CR LF を返す)' : 'FAIL: STDIN read 回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
