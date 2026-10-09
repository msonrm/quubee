#!/usr/bin/env node
// vz_fkey_probe.js — VZ Editor が画面最下行のファンクションキー表示をどう要求するかの計測 (2026-10-09)。
//
// 実機 PC-98 の最下行のファンクションキー表示は DOS (NEC の CON ドライバ) が描く。QuuBee の HLE-DOS は
// 描かない (docs/dos_hle_gaps.md 11)。描くなら VZ がどの経路で表示を求め、ラベルをどこに置くかを先に
// 確かめる:
//   - INT DCh の呼び出し (未実装の CL は qb_dos_intdc_hook が "[intdc] unimpl" を stderr に出す)
//   - CON ワークエリア 0:0711h (fkey 行の表示状態。ESC[>1l/h で追従) と 0:0712h (行数 - 1) の変化
//   - 最下行 (25 行目) のテキスト VRAM の中身 (VZ 自身が描いているか)
//   - ゲストのメモリ上の VZ のラベル (VZ.DEF の "ﾌｧｲﾙ" 等) の位置と前後の並び
// VZ.COM / *.DEF / README.DOC は BSD-3 (tools/testdata/VZ.LICENSE.txt、原作 中村満 c.mos)。
//
// 使い方: node tools/vz_fkey_probe.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const VZCOM  = path.join(__dirname, 'testdata', 'VZ.COM');
const VZDATA = path.join(__dirname, 'testdata', 'vz');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
  const errs = [];
  const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: (s) => errs.push(s) });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets', 'font.bmp'))));
  try { M.FS.mkdir('/run'); } catch (_) {}
  const handle = M.ccall('np2kai_create', 'number', [], []);
  for (const n of fs.readdirSync(VZDATA))
    M.FS.writeFile('/run/' + n, new Uint8Array(fs.readFileSync(path.join(VZDATA, n))));
  const com = new Uint8Array(fs.readFileSync(VZCOM));
  const ptr = M._malloc(com.length); M.HEAPU8.set(com, ptr);
  M.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'],
    [ptr, com.length, 'README.DOC', 'VZ.COM']);
  M._free(ptr);
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets', 'loader.d88'))));
  M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);

  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const pk = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
  const keyDown = M.cwrap('np2kai_key_down', null, ['number', 'number']);
  const keyUp = M.cwrap('np2kai_key_up', null, ['number', 'number']);

  const con = () => ({ '0711': pk(handle, 0x711), '0712': pk(handle, 0x712), '0713': pk(handle, 0x713) });
  const timeline = [];
  let last = '';
  for (let f = 0; f < 400; f++) {
    runFrame(handle);
    const c = JSON.stringify(con());
    if (c !== last) { timeline.push(`frame ${f}: ${c}`); last = c; }
  }

  // テキスト VRAM の 1 行 (ANK だけ読む。全角は "＊" で示す)
  function row(r) {
    let s = '', attrs = new Set();
    for (let c = 0; c < 80; c++) {
      const lo = pk(handle, 0xA0000 + (r * 80 + c) * 2), hi = pk(handle, 0xA0001 + (r * 80 + c) * 2);
      attrs.add(pk(handle, 0xA2000 + (r * 80 + c) * 2).toString(16));
      if (hi) s += '＊';
      else s += (lo >= 0x20 && lo < 0x7f) ? String.fromCharCode(lo) : (lo >= 0xa1 && lo <= 0xdf ? '[k]' : '.');
    }
    return { s, attrs: [...attrs].join(',') };
  }

  console.log('== CON ワークエリアの変化 (0711h=fkey 行表示 / 0712h=行数-1 / 0713h=25 行フラグ)');
  for (const t of timeline) console.log('  ' + t);
  console.log('== INT DCh / tty の診断ログ ([intdc] と ESC 関係)');
  const seen = new Map();
  for (const e of errs) if (/intdc|esc|csi/i.test(e)) seen.set(e, (seen.get(e) || 0) + 1);
  for (const [e, n] of seen) console.log(`  ${n}x ${e}`);
  console.log('== テキスト VRAM 0 行目・23 行目・24 行目 (最下行)');
  for (const r of [0, 23, 24]) { const x = row(r); console.log(`  row ${r} attrs=[${x.attrs}]: ${x.s}`); }

  // ゲストのメモリから VZ のラベル "ﾌｧｲﾙ" (半角カナ SJIS = CC A7 B2 D9) を探す
  console.log('== ゲストのメモリ上の "ﾌｧｲﾙ" (VZ.DEF の F 節のラベル)');
  const pat = [0xCC, 0xA7, 0xB2, 0xD9];
  const hits = [];
  for (let a = 0; a < 0xA0000 && hits.length < 8; a++) {
    let ok = true;
    for (let i = 0; i < pat.length; i++) if (pk(handle, a + i) !== pat[i]) { ok = false; break; }
    if (ok) hits.push(a);
  }
  for (const a of hits) {
    let hex = '', txt = '';
    for (let i = -8; i < 72; i++) {
      const b = pk(handle, a + i);
      hex += b.toString(16).padStart(2, '0') + ' ';
      txt += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : (b >= 0xa1 && b <= 0xdf ? 'k' : '.');
    }
    console.log(`  0x${a.toString(16)}:\n    ${hex}\n    ${txt}`);
  }

  // 画面を PNG に (OUT、既定 /tmp/vz_fkey.png)。VZ Editor のリポジトリの画面写真と見比べる
  {
    const { encodePng } = require('./lib/machine.js');
    const getFB = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
    const pw = M._malloc(12);
    const fb = getFB(handle, pw, pw + 4, pw + 8);
    const w = M.HEAP32[pw >> 2], h = M.HEAP32[(pw + 4) >> 2];
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const v = M.HEAPU16[(fb >> 1) + i];
      rgb[i * 3] = ((v >> 11) & 31) * 255 / 31; rgb[i * 3 + 1] = ((v >> 5) & 63) * 255 / 63; rgb[i * 3 + 2] = (v & 31) * 255 / 31;
    }
    const out = process.env.OUT || '/tmp/vz_fkey.png';
    fs.writeFileSync(out, encodePng(w, h, rgb));
    console.log(`== 画面: ${out} (${w}x${h})`);
  }

  // SHIFT を押している間に最下行が変わるか (VZ 自身が裏ファンクションを描くか)
  keyDown(handle, 0x70);
  for (let f = 0; f < 20; f++) runFrame(handle);
  const shifted = row(24);
  keyUp(handle, 0x70);
  for (let f = 0; f < 20; f++) runFrame(handle);
  console.log(`== SHIFT 押下中の最下行: ${shifted.s}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
