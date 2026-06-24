#!/usr/bin/env node
// VZ Editor のカーソル/編集キー回帰 (2026-06-20 新設)。
//
// 背景: VZ エディタは INT 21h の文字入力 (AH=06 F_CONIO) でキーを読むが、PC-98 のカーソル/
// 編集キーは bios09 のキー変換表で char=0x00 (scan=高位) になる。VZ は起動時に INT DCh の
// setkey (CL=0Dh) で自前のキー定義テーブル (vzktbl) を流し込み、各ソフトキーが「定義文字列」
// (0x7F=FKEYCODE + コード) を発行するようにする。我々が INT DCh を no-op スタブにしていたため
// 再定義が効かず、カーソルキーが char=0x00 のままコマンド誤解釈され (ステータス行に全角Ｃ/Ｐ)
// 移動できなかった。
// 修正 = INT DCh CL=0Ch/0Dh を実装し (native/dos_int21.c qb_dos_intdc_hook)、DOS コンソール入力が
// install されたテーブルを引いてソフトキーの発行文字列に翻訳する。編集キーの並びは
// RLUP/RLDN/INS/DEL/↑/←/→/↓/CLR/HELP (scan 0x36 起点、カーソルは ↑0x3a=slot4 ‥ ↓0x3d=slot7)。
//
// 判定: VZ で README.DOC を開き、↓/↑/→/← でステータス行の "行:桁" が期待どおり動くこと。
// 旧実装ではカーソルキーが移動コマンドにならず行:桁が変わらない (= FAIL)。
//
// VZ.COM / *.DEF / README.DOC は BSD-3 (tools/testdata/VZ.LICENSE.txt、原作 中村満 c.mos)。
//
// 使い方: node tools/vz_cursor_test.js

const path = require('path');
const fs   = require('fs');

const WEB     = path.join(__dirname, '..', 'web');
const FONT    = path.join(WEB, 'assets', 'font.bmp');
const LOADER  = path.join(WEB, 'assets', 'loader.d88');
const VZCOM   = path.join(__dirname, 'testdata', 'VZ.COM');
const VZDATA  = path.join(__dirname, 'testdata', 'vz');

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');
if (!fs.existsSync(VZCOM))  skip('tools/testdata/VZ.COM 不在');
if (!fs.existsSync(VZDATA)) skip('tools/testdata/vz/ (DEF/README) 不在');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
  const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  try { M.FS.mkdir('/run'); } catch (_) {}
  const handle = M.ccall('np2kai_create', 'number', [], []);

  // A: ドライブ (/run) に VZ データ一式 (DEF/README) を配置
  for (const n of fs.readdirSync(VZDATA))
    M.FS.writeFile('/run/' + n, new Uint8Array(fs.readFileSync(path.join(VZDATA, n))));

  const com = new Uint8Array(fs.readFileSync(VZCOM));
  const ptr = M._malloc(com.length); M.HEAPU8.set(com, ptr);
  const r = M.ccall('np2kai_dos_stage_com', 'number',
    ['number', 'number', 'string', 'string'], [ptr, com.length, 'README.DOC', 'VZ.COM']);
  M._free(ptr);
  if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }

  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
    [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);

  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const keyDown  = M.cwrap('np2kai_key_down', null, ['number', 'number']);
  const keyUp    = M.cwrap('np2kai_key_up',   null, ['number', 'number']);
  const pk       = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);

  for (let f = 0; f < 400; f++) runFrame(handle);   // エディタ起動 + README.DOC オープン待ち

  // CON ワークエリア 0:0713h (dosscrn_25) が 25 行 (非ゼロ) で初期化されていること。
  // VZ の check_20 (SCRN98.ASM) がここを tstb で読み行高を選ぶ。未設定 (=0) だと
  // 25 行モードでも 20 行と誤認され縦のラスタ/カーソル計算がずれる (2026-06-24 是正)。
  const conarea0713 = pk(handle, 0x713);
  if (conarea0713 === 0) {
    console.log('FAIL — 0:0713h (dosscrn_25) が 0 = VZ が 20 行と誤認 (25 行で非ゼロを期待)');
    process.exit(1);
  }

  // ステータス行 (row 0) 先頭の "行:桁" を読む
  function statusLC() {
    let s = '';
    for (let c = 0; c < 20; c++) {
      const x = pk(handle, 0xA0000 + c * 2) & 0xff;
      s += (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : ' ';
    }
    const m = s.match(/(\d+)\s*:\s*(\d+)/);
    return m ? { line: +m[1], col: +m[2] } : null;
  }
  function tap(k) { keyDown(handle, k); for (let f = 0; f < 8; f++) runFrame(handle);
                    keyUp(handle, k);   for (let f = 0; f < 8; f++) runFrame(handle); }
  const NK_UP = 0x3a, NK_LEFT = 0x3b, NK_RIGHT = 0x3c, NK_DOWN = 0x3d;

  const start = statusLC();
  if (!start) { console.log('FAIL — ステータス行に "行:桁" が出ない (エディタ未起動?)'); process.exit(1); }

  const fails = [];
  tap(NK_DOWN);  const aDown  = statusLC();
  if (!(aDown && aDown.line === start.line + 1)) fails.push(`Down: ${JSON.stringify(start)}→${JSON.stringify(aDown)} (行+1 を期待)`);
  tap(NK_UP);    const aUp    = statusLC();
  if (!(aUp && aUp.line === start.line))         fails.push(`Up: →${JSON.stringify(aUp)} (元の行 ${start.line} へ戻るを期待)`);
  tap(NK_RIGHT); const aRight = statusLC();
  if (!(aRight && aRight.col > aUp.col))          fails.push(`Right: ${JSON.stringify(aUp)}→${JSON.stringify(aRight)} (桁増を期待)`);
  tap(NK_LEFT);  const aLeft  = statusLC();
  if (!(aLeft && aLeft.col < aRight.col))         fails.push(`Left: ${JSON.stringify(aRight)}→${JSON.stringify(aLeft)} (桁減を期待)`);

  console.log(`start=${JSON.stringify(start)} Down=${JSON.stringify(aDown)} Up=${JSON.stringify(aUp)} Right=${JSON.stringify(aRight)} Left=${JSON.stringify(aLeft)}`);
  if (fails.length) { console.log('FAIL — カーソル移動が不正:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS — INT DCh 経由で ↑↓←→ がエディタ内でカーソル移動として機能 (全角Ｃ/Ｐ回帰なし)');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
