#!/usr/bin/env node
// fmp_test.js — FMP (Guu) ドライバ + ちびおと(86+ADPCM) の headless 回帰。
//
// 何を確かめるか (loader 実ブート + 逐次シェル経路で、bridge.js の FMP セッションと同経路):
//   1. `FMP s` (サイレント常駐) → `PLAY <song.opi>` で FM 音楽が鳴る (audio peak > 閾値)。
//      = FMP が YM2608/INT5(IRQ12)/INT D2h を認識して常駐し、PLAY が常駐 FMP に曲をロードして
//        IRQ 駆動演奏が回る (FMDSP の code 7 = ドライバ未常駐、の裏返し)。
//   2. ちびおと OFF/ON で .opi(FM のみ) の発音が変わらない (= 0x14 化が FM を壊さない回帰)。
//   3. ちびおと ON + `PLAY <song.ovi>` (+ .pvi 音色) で ADPCM 声部が鳴る (audio peak > 閾値)。
//
// 素材は再配布不可 (games/ は .gitignore) なので、無ければ SKIP (CI 安全)。
//   games/driver/fmp428u.lzh  … FMP ドライバ一式 (fmp.com / play.com)
//   games/music/fmpdata.lzh   … 曲データ (コンパイル済み .opi=FM / .ovi=ADPCM + .pvi 音色)
// 展開は lha / lhasa。
//
// 使い方: node tools/fmp_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEB  = path.join(ROOT, 'web');
const G    = path.join(ROOT, 'games');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const FONT   = path.join(WEB, 'assets', 'font.bmp');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
for (const [p, n] of [[LOADER, 'loader.d88'], [FONT, 'font.bmp']]) if (!fs.existsSync(p)) skip(`${n} 不在`);
if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) skip('np2kai_core.js 不在 (ビルドしてください)');
const FMP_DRV = path.join(G, 'driver', 'fmp428u.lzh');   // 音源ドライバ
const FMP_DAT = path.join(G, 'music', 'fmpdata.lzh');    // 曲データ
for (const [p, rel] of [[FMP_DRV, 'driver/fmp428u.lzh'], [FMP_DAT, 'music/fmpdata.lzh']]) if (!fs.existsSync(p)) skip(`games/${rel} 不在 (再配布不可・ローカル限定)`);
function haveCmd(c) { try { cp.execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch (_) { return false; } }
const EX = haveCmd('lha') ? 'lha' : (haveCmd('lhasa') ? 'lhasa' : null);
if (!EX) skip('lha / lhasa が無い');

const TMP = fs.mkdtempSync('/tmp/fmp_test_');
function extract(lzh, sub) {
    const d = path.join(TMP, sub); fs.mkdirSync(d, { recursive: true });
    if (EX === 'lha') cp.execSync(`lha xfw=${d} "${lzh}"`, { stdio: 'ignore' });
    else              cp.execSync(`cd ${d} && lhasa -xq "${lzh}"`, { stdio: 'ignore', shell: '/bin/bash' });
    return d;
}
function find(dir, re) { for (const f of fs.readdirSync(dir, { recursive: true })) if (re.test(f)) return path.join(dir, f); return null; }
function biggest(dir, re) { let b = null, m = 0; for (const f of fs.readdirSync(dir, { recursive: true })) { if (!re.test(f)) continue; const p = path.join(dir, f), s = fs.statSync(p).size; if (s > m) { m = s; b = p; } } return b; }

const dDrv = extract(FMP_DRV, 'drv');
const dDat = extract(FMP_DAT, 'dat');
const FMP  = find(dDrv, /(^|\/)fmp\.com$/i);
const PLAY = find(dDrv, /(^|\/)play\.com$/i);
const OPI  = biggest(dDat, /\.opi$/i);
const OVI  = biggest(dDat, /\.ovi$/i);
const PVIs = []; for (const f of fs.readdirSync(dDat, { recursive: true })) if (/\.pvi$/i.test(f)) PVIs.push(path.join(dDat, f));
if (!FMP || !PLAY) skip('fmp.com / play.com が書庫に無い');
if (!OPI) skip('コンパイル済み .opi が書庫に無い');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// FMP s 常駐 → PLAY <song> を逐次シェルで起動し、後半の audio peak を測る。
async function playPeak(chibi, songPath, frames) {
    const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) throw new Error('create failed');
    M.ccall('np2kai_set_pmd_irq',  'number', ['number'], [1]);          // 全ブート既定の IRQ12 (browser と同条件)
    M.ccall('np2kai_set_chibioto', 'number', ['number'], [chibi ? 1 : 0]); // reset(board bind) 前に設定
    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/FMP.COM',  new Uint8Array(fs.readFileSync(FMP)));
    M.FS.writeFile('/run/PLAY.COM', new Uint8Array(fs.readFileSync(PLAY)));
    const song = path.basename(songPath).toUpperCase();
    M.FS.writeFile('/run/' + song, new Uint8Array(fs.readFileSync(songPath)));
    for (const pv of PVIs) M.FS.writeFile('/run/' + path.basename(pv).toUpperCase(), new Uint8Array(fs.readFileSync(pv)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);

    const script = `FMP.COM\ts\nPLAY.COM\t${song}\n`;
    const bytes = Buffer.from(script, 'latin1');
    const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
    M.ccall('np2kai_dos_stage_script', 'number', ['number', 'number', 'string'], [ptr, bytes.length, 'fmp_test']);
    M._free(ptr);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const fill = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const bufsize = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr = M._malloc(bufsize * 2 * 2);
    let peak = 0;
    for (let f = 0; f < frames; f++) {
        runFrame(handle);
        if (f >= frames * 0.45 && f % 4 === 0) {
            fill(handle, aptr, bufsize);
            const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
            for (let i = 0; i < bufsize * 2; i++) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; }
        }
    }
    M._free(aptr);
    return peak;
}

(async () => {
    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } };
    const TH = 2000;   // FM/ADPCM が鳴っていると判定する peak 閾値 (無音は ~0)

    const opiOff = await playPeak(false, OPI, 2500);
    const opiOn  = await playPeak(true,  OPI, 2500);
    console.log(`opi(${path.basename(OPI)}) peak: chibioto OFF=${opiOff} ON=${opiOn}`);
    chk(opiOff > TH, 'FMP s + PLAY .opi で FM 音楽が鳴る (ちびおと OFF)');
    chk(opiOn  > TH, '.opi が ちびおと ON でも鳴る (FM 回帰なし)');

    if (OVI) {
        const oviOn = await playPeak(true, OVI, 3000);
        console.log(`ovi(${path.basename(OVI)}) peak: chibioto ON=${oviOn}`);
        chk(oviOn > TH, 'ちびおと ON + PLAY .ovi で ADPCM 入り曲が鳴る');
    } else {
        console.log('  (.ovi が書庫に無いため ADPCM 発音テストは省略)');
    }

    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`\nfmp_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { fs.rmSync(TMP, { recursive: true, force: true }); console.error(e); process.exit(1); });
