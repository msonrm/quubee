#!/usr/bin/env node
// Ray を起動して framebuffer を PNG に書き出す (RGB565→RGB888)。罫線の実描画を目視するため。
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
const ROOT = '/home/msonrm/development/qb'; const WEB = path.join(ROOT, 'web');
const FONT = path.join(WEB, 'assets', 'font.bmp'); const LOADER = path.join(WEB, 'assets', 'loader.d88');
// 使い方: node ray_png.js [arg] [out] [frames] [workdir] [mainfile]
const WORK = process.argv[5] || '/tmp/qb_ray';
const ARG = process.argv[2] || 'SILK_FLD.RAY';
const OUT = process.argv[3] || '/tmp/ray_out.png';
const FRAMES = parseInt(process.argv[4] || '4000', 10);
const MAIN = process.argv[6] || 'ray.exe';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
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
  const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  for (const f of fs.readdirSync(WORK)) { const p = path.join(WORK, f); if (fs.statSync(p).isFile()) M.FS.writeFile('/run/' + f, new Uint8Array(fs.readFileSync(p))); }
  const img = new Uint8Array(fs.readFileSync(path.join(WORK, MAIN)));
  const ptr = M._malloc(img.length); M.HEAPU8.set(img, ptr);
  const stageFn = /\.com$/i.test(MAIN) ? 'np2kai_dos_stage_com' : 'np2kai_dos_stage_exe';
  const sr = M.ccall(stageFn, 'number', ['number','number','string','string'], [ptr, img.length, ARG, MAIN.toUpperCase()]);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getFB = M.cwrap('np2kai_get_framebuffer', 'number', ['number','number','number','number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  for (let f = 0; f < FRAMES; f++) { runFrame(handle); if (getExit(0)) break; }
  const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);
  const fbptr = getFB(handle, wP, hP, bP);
  const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
  console.log('framebuffer', w + 'x' + h, 'bpp=' + M.HEAP32[bP >> 2]);
  const rgb = Buffer.alloc(w * h * 3);
  const base = fbptr >> 1;
  for (let i = 0; i < w * h; i++) {
    const px = M.HEAPU16[base + i];
    const r = (px >> 11) & 0x1f, g = (px >> 5) & 0x3f, b = px & 0x1f;
    rgb[i * 3] = (r << 3) | (r >> 2); rgb[i * 3 + 1] = (g << 2) | (g >> 4); rgb[i * 3 + 2] = (b << 3) | (b >> 2);
  }
  writePNG(OUT, w, h, rgb);
  console.log('wrote', OUT);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
