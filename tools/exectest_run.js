#!/usr/bin/env node
// SimK 氏の EXECTEST.COM (DOS 子プロセス/EXEC テスト) を headless 実行し、
// 各 pause (AH=08h キー待ち) 時点の framebuffer PNG + テキスト VRAM ダンプを保存する。
// np21w 同梱スクリーンショット (games/EXECTEST.zip の np21w/*.bmp) との突合用。
// 使い方: node tools/exectest_run.js <EXECTEST.COM のパス> <出力 dir>
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
const ROOT = path.join(__dirname, '..'); const WEB = path.join(ROOT, 'web');
const FONT = path.join(WEB, 'assets', 'font.bmp'); const LOADER = path.join(WEB, 'assets', 'loader.d88');
const COM = process.argv[2]; const OUTDIR = process.argv[3] || '/tmp/exectest_out';
if (!COM) { console.error('usage: node exectest_run.js <EXECTEST.COM> [outdir]'); process.exit(2); }
fs.mkdirSync(OUTDIR, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgb) {
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const idat = zlib.deflateSync(raw);
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
(async () => {
  const errlog = [];
  const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: (s) => errlog.push(s) });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const img = new Uint8Array(fs.readFileSync(COM));
  M.FS.writeFile('/run/EXECTEST.COM', img);   // EXEC 自己起動が open できるよう実ファイルも置く
  const ptr = M._malloc(img.length); M.HEAPU8.set(img, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, img.length, '', 'EXECTEST.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getFB = M.cwrap('np2kai_get_framebuffer', 'number', ['number','number','number','number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number','number']);
  const inject = (s) => { const a = Array.from(s).map(c => c.charCodeAt(0)); const p = M._malloc(a.length);
    M.HEAPU8.set(Uint8Array.from(a), p); M.ccall('np2kai_inject_text', null, ['number','number','number'], [handle, p, a.length]); M._free(p); };
  const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);

  const savePNG = (file) => {
    const fbptr = getFB(handle, wP, hP, bP);
    const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
    if (!fbptr || w <= 0) return;
    const rgb = Buffer.alloc(w * h * 3); const base = fbptr >> 1;
    for (let i = 0; i < w * h; i++) {
      const px = M.HEAPU16[base + i];
      rgb[i*3]   = ((px >> 11) & 0x1f) << 3;
      rgb[i*3+1] = ((px >> 5) & 0x3f) << 2;
      rgb[i*3+2] = (px & 0x1f) << 3;
    }
    writePNG(file, w, h, rgb);
  };
  // テキスト VRAM ダンプ: ASCII 行はそのまま、非 ASCII セルを含む行は生 16 進も併記
  const dumpText = () => {
    const lines = [];
    for (let r = 0; r < 25; r++) {
      let s = '', hex = '', dirty = false;
      for (let c = 0; c < 80; c++) {
        const lo = peek(handle, 0xA0000 + (r * 80 + c) * 2) & 0xff;
        const hi = peek(handle, 0xA0000 + (r * 80 + c) * 2 + 1) & 0xff;
        if (hi === 0 && (lo === 0 || (lo >= 0x20 && lo < 0x7f))) s += lo ? String.fromCharCode(lo) : ' ';
        else { s += '·'; dirty = true; }
        hex += (hi.toString(16).padStart(2,'0') + lo.toString(16).padStart(2,'0')) + ' ';
      }
      if (s.trim() !== '') lines.push(`${String(r).padStart(2)}| ${s.replace(/\s+$/,'')}`);
      if (dirty) lines.push(`  | raw: ${hex.replace(/\s+$/,'')}`);
    }
    return lines.join('\n');
  };

  // 進行: フレームを回し、画面が安定 (テキスト VRAM ハッシュが一定時間不変) したら
  // capture → キー注入。exit まで繰り返し。
  const textHash = () => {
    let hsh = 0;
    for (let i = 0; i < 25*80*2; i += 2) hsh = (hsh * 31 + peek(handle, 0xA0000 + i)) >>> 0;
    return hsh;
  };
  let shot = 0, stable = 0, lastHash = -1, frames = 0;
  const MAXFRAMES = 20000;
  while (frames < MAXFRAMES && !getExit(0) && shot < 12) {
    runFrame(handle); frames++;
    if (frames % 20 !== 0) continue;
    const hsh = textHash();
    if (hsh === lastHash) stable++; else { stable = 0; lastHash = hsh; }
    if (stable >= 5) {   // 100 フレーム不変 = キー待ちで安定と見なす
      shot++;
      savePNG(path.join(OUTDIR, `shot_${shot}.png`));
      fs.writeFileSync(path.join(OUTDIR, `shot_${shot}.txt`), dumpText() + '\n');
      console.log(`--- shot ${shot} (frame ${frames}) ---`);
      inject(' ');
      stable = 0; lastHash = -1;
      for (let i = 0; i < 30; i++) runFrame(handle), frames++;   // キー消化
    }
  }
  // 終了時 (done 画面) も保存
  savePNG(path.join(OUTDIR, `final.png`));
  fs.writeFileSync(path.join(OUTDIR, `final.txt`), dumpText() + '\n');
  fs.writeFileSync(path.join(OUTDIR, `stderr.log`), errlog.join('\n') + '\n');
  console.log(`done: exit=${getExit(0)} frames=${frames} shots=${shot} → ${OUTDIR}`);
})().catch((e) => { console.error(e); process.exit(1); });
