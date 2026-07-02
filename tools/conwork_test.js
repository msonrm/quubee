#!/usr/bin/env node
// CON ワークエリア + AL 戻り値 回帰テスト (2026-07-03、SimK PC98RET/PC98WORK 由来)
// ------------------------------------------------------------------------------
// ① AH=02h/06h/09h の AL 戻り値 (02h: AL=出力文字・TAB は 20h / 06h: AL=DL / 09h: AL=24h)
// ② 起動時ワークエリア既定値 (071Bh=1・073Ch/073Eh=00E1 — 0714h/0719h は③が挙動で検証)
// ③ クリアスロット直書き: 0119h=文字・0114h=属性 → ESC[2K がその文字/属性で埋める (DOS 3.x)
// ④ 属性 011Dh 直書き → 次の出力から反映 (live 読み戻し)
// ⑤ ESC[s → 0726h/0727h/072Bh へ保存 / 直書き → ESC[u が live 読みで位置+属性を復元
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

function buildCom() {
  const code = [];          // {lo/hi ラベル参照} は {L:'name'} で置き、データ確定後に patch
  const patches = [];       // {at, label, half}
  const emit = (...b) => code.push(...b);
  const ref = (label) => { patches.push({ at: code.length, label }); code.push(0, 0); };

  // ① AL 戻り値 4 種
  emit(0xB4, 0x02, 0xB2, 0x41, 0xCD, 0x21, 0xA2); ref('rA');       // AH=02h 'A'
  emit(0xB4, 0x02, 0xB2, 0x09, 0xCD, 0x21, 0xA2); ref('rTab');     // AH=02h TAB
  emit(0xB4, 0x06, 0xB2, 0x42, 0xCD, 0x21, 0xA2); ref('rB');       // AH=06h 'B'
  emit(0xB4, 0x09, 0xBA); ref('sDollar'); emit(0xCD, 0x21, 0xA2); ref('rDollar'); // AH=09h
  // ES = 0060h (CON ワークエリアセグメント)
  emit(0xB8, 0x60, 0x00, 0x8E, 0xC0);                              // mov ax,60h / mov es,ax
  // ④ 011Dh=45h (赤反転) → ESC[10;1H + 'R'
  emit(0x26, 0xC6, 0x06, 0x1D, 0x01, 0x45);
  emit(0xB4, 0x09, 0xBA); ref('sPosR'); emit(0xCD, 0x21);
  // ③ 0119h='%'・0114h=85h (緑反転) → ESC[11;1H + ESC[2K
  emit(0x26, 0xC6, 0x06, 0x19, 0x01, 0x25);
  emit(0x26, 0xC6, 0x06, 0x14, 0x01, 0x85);
  emit(0xB4, 0x09, 0xBA); ref('sClear'); emit(0xCD, 0x21);
  // ⑤ ESC[13;8H + ESC[s → 0726/0727/072B を記録
  emit(0xB4, 0x09, 0xBA); ref('sSave'); emit(0xCD, 0x21);
  emit(0x26, 0xA0, 0x26, 0x01, 0xA2); ref('sY');
  emit(0x26, 0xA0, 0x27, 0x01, 0xA2); ref('sX');
  emit(0x26, 0xA0, 0x2B, 0x01, 0xA2); ref('sAttr');
  // 0726h=14・0727h=20・072Bh=A5h (シアン反転) を直書き → ESC[u + 'Z'
  emit(0x26, 0xC6, 0x06, 0x26, 0x01, 0x0E);
  emit(0x26, 0xC6, 0x06, 0x27, 0x01, 0x14);
  emit(0x26, 0xC6, 0x06, 0x2B, 0x01, 0xA5);
  emit(0xB4, 0x09, 0xBA); ref('sRest'); emit(0xCD, 0x21);
  emit(0xB8, 0x00, 0x4C, 0xCD, 0x21);                              // exit

  const labels = {};
  const bytes = [...code];
  const defData = (name, arr) => { labels[name] = 0x100 + bytes.length; bytes.push(...arr); };
  const S = (s) => Array.from(s).map((c) => c.charCodeAt(0));
  defData('rA', [0]); defData('rTab', [0]); defData('rB', [0]); defData('rDollar', [0]);
  defData('sY', [0xFF]); defData('sX', [0xFF]); defData('sAttr', [0]);
  defData('sDollar', S('X$'));
  defData('sPosR', [0x1B, ...S('[10;1HR$')]);
  defData('sClear', [0x1B, ...S('[11;1H'), 0x1B, ...S('[2K$')]);
  defData('sSave', [0x1B, ...S('[13;8H'), 0x1B, ...S('[s$')]);
  defData('sRest', [0x1B, ...S('[uZ$')]);
  for (const p of patches) {
    const v = labels[p.label];
    bytes[p.at] = v & 0xFF; bytes[p.at + 1] = (v >> 8) & 0xFF;
  }
  return { bin: Uint8Array.from(bytes), labels };
}

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(ROOT, 'web/assets/font.bmp'))));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const { bin, labels } = buildCom();
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, bin.length, '', 'CONWORK.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(ROOT, 'web/assets/loader.d88'))));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number','number']);
  for (let f = 0; f < 2000 && !getExit(0); f++) runFrame(handle);

  const b = (label) => peek(handle, 0x1000 + labels[label]) & 0xff;
  const cell = (r, c) => ({ ch: peek(handle, 0xA0000 + (r * 80 + c) * 2) & 0xff,
                            at: peek(handle, 0xA2000 + (r * 80 + c) * 2) & 0xff });
  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const h = (v) => '0x' + v.toString(16).toUpperCase().padStart(2, '0');
  expect(getExit(0) === 1, 'COM が完走');
  expect(b('rA') === 0x41, `AH=02h 'A' → AL=41 (got ${h(b('rA'))})`);
  expect(b('rTab') === 0x20, `AH=02h TAB → AL=20 (スペース展開) (got ${h(b('rTab'))})`);
  expect(b('rB') === 0x42, `AH=06h 'B' → AL=42 (got ${h(b('rB'))})`);
  expect(b('rDollar') === 0x24, `AH=09h → AL=24 ('$') (got ${h(b('rDollar'))})`);
  expect(peek(handle, 0x71B) === 0x01, `既定 071Bh (カーソル表示) = 01`);
  expect(peek(handle, 0x73C) === 0xE1 && peek(handle, 0x73D) === 0x00, `既定 073Ch (put attr word) = 00E1`);
  expect(peek(handle, 0x73E) === 0xE1 && peek(handle, 0x73F) === 0x00, `既定 073Eh (clear attr word) = 00E1`);
  const rc = cell(9, 0);
  expect(rc.ch === 0x52 && rc.at === 0x45,
         `011Dh=45h 直書き → 'R' が赤反転で出力 (got ch=${h(rc.ch)} at=${h(rc.at)})`);
  const cl = cell(10, 40);
  expect(cl.ch === 0x25 && cl.at === 0x85,
         `0119h='%'+0114h=85h → ESC[2K が '%' 緑反転埋め (got ch=${h(cl.ch)} at=${h(cl.at)})`);
  expect(b('sY') === 12 && b('sX') === 7,
         `ESC[s → 0726h/0727h に Y=12/X=7 保存 (got ${b('sY')}/${b('sX')})`);
  /* ④で 011Dh=45h を直書き済みなので、この時点の現在属性 = 45h。ESC[s はそれを保存する。 */
  expect(b('sAttr') === 0x45, `ESC[s → 072Bh に現在属性 (45h) を保存 (got ${h(b('sAttr'))})`);
  const z = cell(14, 20);
  expect(z.ch === 0x5A && z.at === 0xA5,
         `0726/0727/072B 直書き → ESC[u が (14,20) シアン反転へ復元し 'Z' (got ch=${h(z.ch)} at=${h(z.at)})`);
  console.log(ok ? 'PASS: CON ワークエリア (クリア/属性/保存カーソル) + AL 戻り値'
                 : 'FAIL: conwork 回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
