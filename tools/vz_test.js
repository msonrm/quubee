#!/usr/bin/env node
// VZ Editor 起動回帰 (2026-06-20 新設)。
//
// 背景: VZ Editor (PC-98 版 Ver1.60) はバナー表示直後に checkhard (VZ ソース scrn98.asm:1922)
// で「INT DCh のベクタ offset (0:0370h) と INT DDh の offset (0:0374h) が等しいか」を調べ、
// 等しいと CY=1 → "Illegal mode!" を出して起動を拒否する (実機では DCh/DDh は別々の BIOS
// ルーチンを指し offset が異なるのが前提)。
// 我々は未使用 software INT 0x22..0xFF を全部同一の IRET スタブ (F000:EE40) に向けていたため
// DCh==DDh となり弾かれていた。修正 = IRET スタブを 16byte パッド (0xEE40..0xEE4F 全部 0xCF)
// にして各ベクタを EE40+(vec&0x0F) に分散 → 隣接ベクタ (DCh/DDh 含む) は必ず別 offset。
// 挙動は全部「裸 IRET」のまま (ゼロ回帰)。詳細は native/dos_loader.c の install_trampolines。
//
// 判定: VZ.COM を loader でステージ実行し、テキスト VRAM に "Illegal mode!" が出ないこと
// (= checkhard 通過)。旧実装ではここで "Illegal mode!" + 即終了 (al=2) になり FAIL する。
//
// VZ.COM は BSD-3 ライセンス (tools/testdata/VZ.LICENSE.txt、原作 中村満 c.mos / 公開 vcraftjp)。
//
// 使い方: node tools/vz_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const VZCOM  = path.join(__dirname, 'testdata', 'VZ.COM');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');
if (!fs.existsSync(VZCOM))  skip('tools/testdata/VZ.COM 不在');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
  const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);

  const com = new Uint8Array(fs.readFileSync(VZCOM));
  const ptr = M._malloc(com.length);
  M.HEAPU8.set(com, ptr);
  const r = M.ccall('np2kai_dos_stage_com', 'number',
    ['number', 'number', 'string', 'string'], [ptr, com.length, '', 'VZ.COM']);
  M._free(ptr);
  if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }

  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
    [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);

  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const pk       = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);

  // テキスト VRAM (0xA0000, 2byte/cell, 80x25) を ASCII 文字列化。
  const VRAM_CODE = 0xA0000, COLS = 80, ROWS = 25;
  function screenText() {
    const out = [];
    for (let row = 0; row < ROWS; row++) {
      let line = '';
      for (let col = 0; col < COLS; col++) {
        const c = pk(handle, VRAM_CODE + (row * COLS + col) * 2) & 0xff;
        line += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : ' ';
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out.filter(l => l.length).join('\n');
  }

  let exited = 0;
  for (let f = 0; f < 500; f++) {
    runFrame(handle);
    if (getExit(0)) { exited = 1; break; }
  }

  const scr = screenText();
  const illegal = /Illegal mode/i.test(scr);

  console.log('--- text VRAM dump ---');
  console.log(scr || '(empty)');
  console.log('----------------------');
  console.log(`exited=${exited} hasIllegalMode=${illegal}`);

  if (illegal) {
    console.log('FAIL — "Illegal mode!" が出た = checkhard が INT DCh==DDh を検出 (未使用ベクタ共有スタブ回帰)');
    process.exit(1);
  }
  if (!/Z Editor Version/i.test(scr)) {
    console.log('FAIL — VZ のバナーが出ない (VZ.COM がそもそもロード/実行されていない疑い)');
    process.exit(1);
  }
  console.log('PASS — "Illegal mode!" 無し = VZ の checkhard を通過 (INT DCh≠DDh ベクタ)');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
