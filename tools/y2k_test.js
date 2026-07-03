#!/usr/bin/env node
// Y2K クランプ (np2kai_set_y2k_clamp / qbDebug.y2k) の恒久回帰 (2026-07-04)。
//
// 背景: 90 年代の pre-Y2K タイトル (例: 蟹味噌 1992 の KANI.SCR) は PC-98 RTC (μPD4990A) の年を
//   「年-1900」の 2 桁前提で扱う。現在年 2026 を素直に渡すと "126" の 3 桁になり固定幅セーブが壊れて
//   ゲームが自分の出力を読めなくなる。既定 ON のクランプが年 20xx を 1999 に写像して 2 桁を保つ。
//   このクランプは 3 系統 (RTC 種=qb_timemng・RTC 直読み=calendar.c date2bcd・DOS AH=2Ah=dos_int21) が
//   共有フラグ g_qb_y2k_clamp を見る形で、qbDebug.y2k(0|1) で一括オン/オフできる。
//
// 何を確かめるか:
//   [RTC 経路] RTC 年 BCD = np2kai_debug_rtc_bcd idx=0 を読む (種=qb_timemng + 読出=calendar.c の両方):
//     1) get の既定が ON (1)。
//     2) クランプ ON で年が "99" に丸まる (host 2026 → 1999 → 99)。
//     3) set(0) で OFF になり、RTC 年が本当の host 年下 2 桁になる (トグルが効く証拠)。
//     4) set(1) で再び 99 に戻る。
//   [DOS 経路] INT 21h AH=2Ah (日付取得) の CX(年) を DATE.COM に書かせて peek (dos_int21 の qb_era_year):
//     5) クランプ ON で CX=1999。
//     6) set(0) で CX=本当の host 年。
// フラグは RTC の「種」も左右するので、変えたら reset して host 時刻から再シードし読み直す。
//
// 使い方: node tools/y2k_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const FONT   = path.join(WEB, 'assets', 'font.bmp');

function skip(m){ console.log('SKIP — ' + m); process.exit(0); }
for (const [p, n] of [[LOADER, 'loader.d88'], [FONT, 'font.bmp']]) if (!fs.existsSync(p)) skip(n + ' 不在');
if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) skip('np2kai_core.js 不在 (bash emscripten/build.sh)');

const bcd2dec = (b) => (b >> 4) * 10 + (b & 0x0f);
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
  const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);

  const setClamp = (on) => M.ccall('np2kai_set_y2k_clamp', 'number', ['number'], [on]);
  const getClamp = () => M.ccall('np2kai_get_y2k_clamp', 'number', [], []);
  const rtcYear = () => {
    M.ccall('np2kai_reset', null, ['number'], [handle]);   // host 時刻から RTC を再シード
    for (let i = 0; i < 8; i++) runFrame(handle);          // 数フレーム進めて RTC を安定させる
    const b = M.ccall('np2kai_debug_rtc_bcd', 'number', ['number', 'number'], [handle, 0]);
    return { bcd: b, dec: bcd2dec(b) };
  };

  const hostYear = new Date().getFullYear();
  const hostYY   = hostYear % 100;

  let pass = 0, fail = 0;
  const chk = (c, m) => { if (c) { pass++; console.log('  PASS: ' + m); } else { fail++; console.log('  FAIL: ' + m); } };

  chk(getClamp() === 1, `既定は ON (get=${getClamp()})`);

  setClamp(1);
  const on = rtcYear();
  console.log(`clamp ON : RTC年 BCD=0x${on.bcd.toString(16).padStart(2, '0')} (=${on.dec})`);
  chk(on.dec === 99, `ON で年が 99 に丸まる (host ${hostYear})`);

  setClamp(0);
  chk(getClamp() === 0, `set(0) で OFF になる`);
  const off = rtcYear();
  console.log(`clamp OFF: RTC年 BCD=0x${off.bcd.toString(16).padStart(2, '0')} (=${off.dec})`);
  chk(off.dec === hostYY, `OFF で本当の年下2桁 ${hostYY} が出る`);
  chk(off.dec !== 99 || hostYY === 99, `OFF は ON と異なる (トグルが効いている)`);

  setClamp(1);
  const on2 = rtcYear();
  chk(on2.dec === 99, `set(1) で再び 99 に戻る`);

  // ---- DOS 経路 (INT 21h AH=2Ah = dos_int21 の qb_era_year) ----
  // DATE.COM: mov ah,2Ah / int 21h / xor bx,bx / mov es,bx / mov es:[0500h],cx / jmp $
  // → INT 21h AH=2Ah が返す CX(年) を 0000:0500 (linear 0x500) に書いて hang。peek8 で読む。
  const DATE_COM = Buffer.from([
    0xB4, 0x2A,             // mov ah,2Ah
    0xCD, 0x21,             // int 21h        (CX=year)
    0x31, 0xDB,             // xor bx,bx
    0x8E, 0xC3,             // mov es,bx      (es=0)
    0x26, 0x89, 0x0E, 0x00, 0x05,  // mov es:[0500h],cx
    0xEB, 0xFE,             // jmp $
  ]);
  const dosYear = async (clampOn) => {
    const m = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
    m.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    m.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    m.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    const h = m.ccall('np2kai_create', 'number', [], []);
    m.ccall('np2kai_set_y2k_clamp', 'number', ['number'], [clampOn]);
    try { m.FS.mkdir('/run'); } catch (_) {}
    const ip = m._malloc(DATE_COM.length); m.HEAPU8.set(DATE_COM, ip);
    const sr = m.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'], [ip, DATE_COM.length, null, 'DATE.COM']);
    m._free(ip);
    if (sr !== 0) throw new Error('stage_com err=' + sr);
    m.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/loader.d88', 0, 0]);
    m.ccall('np2kai_reset', null, ['number'], [h]);
    const rf = m.cwrap('np2kai_run_frame', null, ['number']);
    for (let i = 0; i < 240; i++) rf(h);   // loader が DATE.COM を exec して store するまで進める
    const lo = m.ccall('np2kai_debug_peek8', 'number', ['number', 'number'], [h, 0x500]);
    const hi = m.ccall('np2kai_debug_peek8', 'number', ['number', 'number'], [h, 0x501]);
    return lo | (hi << 8);
  };

  const dosOn  = await dosYear(1);
  console.log(`DOS AH=2Ah clamp ON : CX(年)=${dosOn}`);
  chk(dosOn === 1999, `DOS 経路 ON で年=1999 (実 ${dosOn})`);
  const dosOff = await dosYear(0);
  console.log(`DOS AH=2Ah clamp OFF: CX(年)=${dosOff}`);
  chk(dosOff === hostYear, `DOS 経路 OFF で本当の年 ${hostYear} (実 ${dosOff})`);

  console.log(`\ny2k_test: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
