#!/usr/bin/env node
// JED (jed194n.lzh) のカーソルキー回帰 (2026-06-24 新設)。
//
// 背景: JED は INT DCh setkey の **1 キー単位 API** (CL=0Dh, AX=key# 1..31, DS:DX=発行文字列) で
// 各ソフトキーを定義する。カーソル ↑/←/→/↓ は key#25-28 にそれぞれ "FF <scancode>" を割り当て、
// 押下時に 0xFF+scan の 2 バイトを発行させる (JED の reader は AH=06 で 0xFF を検出→AH=07 で scan を
// 読む拡張キー方式)。我々の旧 INT DCh は VZ の「全体一括」(AX=0) しか想定せず、渡された linear を
// そのまま保持していたため、JED の使い捨て 2 byte バッファを掴んで softkey_fill がゴミを読み、
// カーソルキーが char=0x00 のまま死んでいた。修正 = C 側正準テーブル g_keytbl を持ち、全体一括と
// 1 キー単位の両 API で populate する (native/dos_int21.c qb_dos_intdc_hook / keynum_issue_slot)。
//
// 判定: JED で JED.CFG を開き、↓/↑/→/← でステータス行 (row 0) の "行:桁" が期待どおり動くこと。
// 旧実装ではカーソルキーが移動コマンドにならず行:桁が変わらない (= FAIL)。
//
// JED 本体 (jed.exe/jed.cfg) は再配布不可なので games/mem_test/jed194n.lzh が無ければ SKIP
// (lha が無くても SKIP)。本テストは local 専用 (CI でも安全)。
//
// 使い方: node tools/jed_cursor_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const ARCHIVE = path.join(ROOT, 'games', 'mem_test', 'jed194n.lzh');
const WORK   = '/tmp/qb_jed_cursor';

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER))  skip('loader.d88 不在 (bash tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))    skip('font.bmp 不在');
if (!fs.existsSync(ARCHIVE)) skip('games/mem_test/jed194n.lzh 不在 (再配布不可・local-only)');
if (cp.spawnSync('sh', ['-c', 'command -v lha']).status !== 0) skip('lha 不在 (展開できない)');

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
cp.spawnSync('lha', ['xw=' + WORK, ARCHIVE], { stdio: 'ignore' });
const exePath = path.join(WORK, 'jed.exe');
if (!fs.existsSync(exePath)) skip('jed.exe を展開できなかった');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
  const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  try { M.FS.mkdir('/run'); } catch (_) {}
  const handle = M.ccall('np2kai_create', 'number', [], []);

  for (const n of fs.readdirSync(WORK))
    M.FS.writeFile('/run/' + n, new Uint8Array(fs.readFileSync(path.join(WORK, n))));

  // JED.CFG を引数で開いてエディタ画面へ直行
  const exe = new Uint8Array(fs.readFileSync(exePath));
  const ptr = M._malloc(exe.length); M.HEAPU8.set(exe, ptr);
  const r = M.ccall('np2kai_dos_stage_exe', 'number',
    ['number', 'number', 'string', 'string'], [ptr, exe.length, 'JED.CFG', 'JED.EXE']);
  M._free(ptr);
  if (r !== 0) { console.log('FAIL — stage_exe r=' + r); process.exit(1); }

  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
    [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);

  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const keyDown  = M.cwrap('np2kai_key_down', null, ['number', 'number']);
  const keyUp    = M.cwrap('np2kai_key_up',   null, ['number', 'number']);
  const pk       = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);

  for (let f = 0; f < 600; f++) runFrame(handle);   // エディタ起動 + JED.CFG オープン待ち

  // ステータス行 (row 0) の "行:桁" を読む
  function statusLC() {
    let s = '';
    for (let c = 0; c < 80; c++) {
      const x = pk(handle, 0xA0000 + c * 2) & 0xff;
      s += (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : ' ';
    }
    const m = s.match(/(\d+)\s*:\s*(\d+)/);
    return m ? { line: +m[1], col: +m[2] } : null;
  }
  function tap(k) { keyDown(handle, k); for (let f = 0; f < 10; f++) runFrame(handle);
                    keyUp(handle, k);   for (let f = 0; f < 10; f++) runFrame(handle); }
  const NK_UP = 0x3a, NK_LEFT = 0x3b, NK_RIGHT = 0x3c, NK_DOWN = 0x3d;

  const start = statusLC();
  if (!start) { console.log('FAIL — ステータス行に "行:桁" が出ない (エディタ未起動?)'); process.exit(1); }

  const fails = [];
  tap(NK_DOWN);  const aDown  = statusLC();
  if (!(aDown && aDown.line === start.line + 1)) fails.push(`Down: ${JSON.stringify(start)}→${JSON.stringify(aDown)} (行+1 を期待)`);
  tap(NK_DOWN);  const aDown2 = statusLC();
  if (!(aDown2 && aDown2.line === start.line + 2)) fails.push(`Down2: →${JSON.stringify(aDown2)} (行+2 を期待)`);
  tap(NK_RIGHT); const aRight = statusLC();
  if (!(aRight && aRight.col > aDown2.col))         fails.push(`Right: ${JSON.stringify(aDown2)}→${JSON.stringify(aRight)} (桁増を期待)`);
  tap(NK_UP);    const aUp    = statusLC();
  if (!(aUp && aUp.line === aRight.line - 1))       fails.push(`Up: ${JSON.stringify(aRight)}→${JSON.stringify(aUp)} (行−1 を期待)`);
  tap(NK_LEFT);  const aLeft  = statusLC();
  if (!(aLeft && aLeft.col < aRight.col))            fails.push(`Left: ${JSON.stringify(aUp)}→${JSON.stringify(aLeft)} (桁減を期待)`);

  console.log(`start=${JSON.stringify(start)} Down=${JSON.stringify(aDown)} Down2=${JSON.stringify(aDown2)} Right=${JSON.stringify(aRight)} Up=${JSON.stringify(aUp)} Left=${JSON.stringify(aLeft)}`);
  if (fails.length) { console.log('FAIL — カーソル移動が不正:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS — INT DCh 1 キー単位 setkey 経由で ↑↓←→ が JED 内でカーソル移動として機能');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
