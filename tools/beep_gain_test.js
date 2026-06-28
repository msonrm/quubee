#!/usr/bin/env node
// BEEP 音量ブースト (np2kai_set_beep_gain / qbDebug.beepgain) の恒久回帰 (2026-06-28)。
//
// 背景: np2kai 標準の BEEP は beepcfg.vol が 0..3 の 4 段階しか持たず矩形波が peak 2048 (-24dBFS) で
//   頭打ちのため、FM(fmgen)/MIDI(TSF) 楽曲の下で効果音 (SE) が ~18-23dB 埋もれて聴こえない
//   (amel133 作者報告)。vol_master が fmgen FM / TSF MIDI に効かず BEEP・ADPCM/PCM だけに効く性質を
//   使い、ADPCM/PCM を相殺しつつ BEEP だけを既定 ~3.8x (+11.7dB) に持ち上げる。
//
// 何を確かめるか:
//   1) 既定 (np2kai_create が beep_gain(400)) で BEEP peak が素の np2kai より十分大きい (>= 6000)。
//   2) np2kai_set_beep_gain(100) で素の np2kai (peak ~2048) に戻せる。
//   3) ブースト倍率が ~3.8x (3.4x..4.0x の範囲)。
// PIT ch1 mode3 + system port 0x37 でスピーカを叩く極小 COM を走らせ、連続矩形波の peak を測る
// (corpus 不要・loader.d88 + font.bmp + ビルドさえあれば常時実行可能)。
//
// 使い方: node tools/beep_gain_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const FONT   = path.join(WEB, 'assets', 'font.bmp');

function skip(m){ console.log('SKIP — ' + m); process.exit(0); }
for (const [p, n] of [[LOADER, 'loader.d88'], [FONT, 'font.bmp']]) if (!fs.existsSync(p)) skip(n + ' 不在');
if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) skip('np2kai_core.js 不在 (bash emscripten/build.sh)');

// PIT ch1 を mode3 (矩形波) にし、周波数を入れ、system port でブザーを ON にして hang する極小 COM。
const BEEP_COM = Buffer.from([
  0xB0,0x76, 0xE6,0x77,   // mov al,76h ; out 77h,al  (PIT ctrl ch1 lo/hi mode3 -> beep mode1)
  0xB0,0xC0, 0xE6,0x73,   // mov al,C0h ; out 73h,al  (count low)
  0xB0,0x09, 0xE6,0x73,   // mov al,09h ; out 73h,al  (count high = 09C0h ~ 800Hz)
  0xB0,0x06, 0xE6,0x37,   // mov al,06h ; out 37h,al  (sysport clr bit3 -> buzzer ON)
  0xEB,0xFE               // jmp $
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

async function measureBeep(gainPct) {
  const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  if (gainPct !== undefined) M.ccall('np2kai_set_beep_gain', 'number', ['number'], [gainPct]);
  try { M.FS.mkdir('/run'); } catch (_) {}
  const ip = M._malloc(BEEP_COM.length); M.HEAPU8.set(BEEP_COM, ip);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'], [ip, BEEP_COM.length, null, 'BEEP.COM']);
  M._free(ip);
  if (sr !== 0) { console.log('  stage_com err=' + sr); process.exit(1); }
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number','number','number']);
  const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
  const aptr     = M._malloc(bufsize * 2 * 2);
  let peak = 0;
  for (let f = 0; f < 1200; f++) {
    runFrame(handle);
    if (f >= 300) {
      fillFn(handle, aptr, bufsize);
      const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
      for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
    }
  }
  M._free(aptr);
  return peak;
}

(async () => {
  let pass = 0, fail = 0;
  const chk = (cond, msg) => { if (cond) { pass++; console.log('  PASS: ' + msg); } else { fail++; console.log('  FAIL: ' + msg); } };

  const def = await measureBeep();      // 既定 (C が beep_gain(400) を適用)
  const x1  = await measureBeep(100);   // 素の np2kai
  console.log(`BEEP peak: 既定(4x)=${def}  beepgain(1)=${x1}  比=${(def / x1).toFixed(2)}x`);

  chk(x1 > 1500 && x1 < 2600, `beepgain(1) が素の np2kai レベル (peak ${x1} ≈ 2048)`);
  chk(def >= 6000,            `既定ブーストで BEEP が十分大きい (peak ${def} >= 6000)`);
  chk(def / x1 >= 3.4 && def / x1 <= 4.0, `ブースト倍率が ~3.8x (実 ${(def / x1).toFixed(2)}x)`);

  console.log(`\nbeep_gain_test: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
