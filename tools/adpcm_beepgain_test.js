#!/usr/bin/env node
// adpcm_beepgain_test.js — BEEP ブーストが fmgen ADPCM (ちびおと経路) に波及しない恒久回帰 (2026-07-05)。
//
// 背景 (精査 #15 / グループ B): 旧 beep_gain は vol_master を 255 へ上げ vol_pcm=25 で
// ADPCM/PCM を相殺する設計だったが、この相殺は整数経路 (vol × vol_master) 前提。fmgen 経路の
// ADPCM は vol_master が効かず vol_pcm が opna_reset で素の dB になるため、相殺だけが片効きして
// ADPCM 成分が意図値 (vol 64) より -10dB になっていた (headless ストリーム減算で実測)。
// patch 06 で BEEP 専用ゲイン (beepg.c 内で完結) に移行し、vol_master=100/vol_pcm=64 の中立へ。
//
// 何を確かめるか (fmp_test.js と同じ FMP 経路・ちびおと ON・毎回 reset = ブラウザ Run と同条件):
//   1) 検出力: .ovi の ADPCM 音量ノブ 0 ⇄ 128 でストリームが変わる (= ADPCM 成分が窓に実在)。
//      これが落ちると 2) が空虚に通ってしまうため必須のガード。
//   2) 本命: beepgain 383(既定) ⇄ 100 で .ovi のストリームが完全一致 (= BEEP ブーストが
//      fmgen ADPCM に一切波及しない)。旧設計ではここが不一致 (ADPCM -10dB) だった。
//   3) 既定の ADPCM レベルが意図値: 既定 (無指定) と明示 vol 64 のストリームが完全一致。
//
// 素材は再配布不可 (games/ は .gitignore) なので、無ければ SKIP (CI 安全)。
//   games/driver/fmp428u.lzh / games/music/fmpdata.lzh (fmp_test.js と同じ)
//
// 使い方: node tools/adpcm_beepgain_test.js

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
const FMP_DRV = path.join(G, 'driver', 'fmp428u.lzh');
const FMP_DAT = path.join(G, 'music', 'fmpdata.lzh');
for (const [p, rel] of [[FMP_DRV, 'driver/fmp428u.lzh'], [FMP_DAT, 'music/fmpdata.lzh']]) if (!fs.existsSync(p)) skip(`games/${rel} 不在 (再配布不可・ローカル限定)`);
function haveCmd(c) { try { cp.execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch (_) { return false; } }
const EX = haveCmd('lha') ? 'lha' : (haveCmd('lhasa') ? 'lhasa' : null);
if (!EX) skip('lha / lhasa が無い');

const TMP = fs.mkdtempSync('/tmp/adpcm_bg_test_');
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
const OVI  = biggest(dDat, /\.ovi$/i);
const PVIs = []; for (const f of fs.readdirSync(dDat, { recursive: true })) if (/\.pvi$/i.test(f)) PVIs.push(path.join(dDat, f));
if (!FMP || !PLAY) skip('fmp.com / play.com が書庫に無い');
if (!OVI) skip('コンパイル済み .ovi (ADPCM 入り) が書庫に無い');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// FMP s 常駐 → PLAY <song.ovi> をちびおと ON で走らせ、後半の PCM を丸ごと収集する。
// np2kai_create 内の reset は set_beep_gain(既定) 適用後なので、A/B は create 後に gain を
// 変えてから明示 reset (ブラウザの毎 Run reset と同条件) で fmgen へ反映させる。
async function playCapture(gainPct, adpcmVol, frames) {
    const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    M.ccall('np2kai_set_pmd_irq',  'number', ['number'], [1]);
    M.ccall('np2kai_set_chibioto', 'number', ['number'], [1]);
    if (gainPct >= 0) M.ccall('np2kai_set_beep_gain', 'number', ['number'], [gainPct]);
    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/FMP.COM',  new Uint8Array(fs.readFileSync(FMP)));
    M.FS.writeFile('/run/PLAY.COM', new Uint8Array(fs.readFileSync(PLAY)));
    const song = path.basename(OVI).toUpperCase();
    M.FS.writeFile('/run/' + song, new Uint8Array(fs.readFileSync(OVI)));
    for (const pv of PVIs) M.FS.writeFile('/run/' + path.basename(pv).toUpperCase(), new Uint8Array(fs.readFileSync(pv)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    const script = `FMP.COM\ts\nPLAY.COM\t${song}\n`;
    const bytes = Buffer.from(script, 'latin1');
    const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
    M.ccall('np2kai_dos_stage_script', 'number', ['number', 'number', 'string'], [ptr, bytes.length, 'adpcm_bg']);
    M._free(ptr);
    M.ccall('np2kai_reset', null, ['number'], [handle]);   // opna_reset が vol_pcm を fmgen へ (ブラウザ Run と同条件)
    if (adpcmVol >= 0) M.ccall('np2kai_set_vol', null, ['number','number','number','number'], [-1, -1, -1, adpcmVol]);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const fill = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const bufsize = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr = M._malloc(bufsize * 2 * 2);
    const chunks = [];
    for (let f = 0; f < frames; f++) {
        runFrame(handle);
        if (f >= frames * 0.45 && f % 4 === 0) {
            fill(handle, aptr, bufsize);
            chunks.push(new Int16Array(M.HEAPU8.buffer.slice(aptr, aptr + bufsize * 2 * 2)));
        }
    }
    M._free(aptr);
    return chunks;
}

function sameStream(a, b) {
    if (a.length !== b.length) return false;
    for (let k = 0; k < a.length; k++) {
        const x = a[k], y = b[k];
        if (x.length !== y.length) return false;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    }
    return true;
}

(async () => {
    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } };
    const FRAMES = 3000;
    console.log(`song=${path.basename(OVI)} pvi=${PVIs.length}本`);

    // 1) 検出力ガード: ADPCM ノブ 0 ⇄ 128 で差が出る (= 窓に ADPCM 成分が実在)
    const mute = await playCapture(-1, 0,   FRAMES);
    const full = await playCapture(-1, 128, FRAMES);
    chk(!sameStream(mute, full), '検出力: adpcm 0 ⇄ 128 でストリームが変わる (ADPCM 成分が実在)');

    // 2) 本命: beepgain 383(既定) ⇄ 100 で fmgen ADPCM が不変 (旧設計はここが -10dB で不一致)
    const g383 = await playCapture(383, -1, FRAMES);
    const g100 = await playCapture(100, -1, FRAMES);
    chk(sameStream(g383, g100), 'beepgain 383 ⇄ 100 でストリーム完全一致 (BEEP ブーストが ADPCM に波及しない)');

    // 3) 既定の ADPCM レベル = 意図値 (vol 64)
    const def64 = await playCapture(-1, 64, FRAMES);
    const defRaw = await playCapture(-1, -1, FRAMES);
    chk(sameStream(defRaw, def64), '既定の ADPCM レベルが vol 64 (意図値) と完全一致');

    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`\nadpcm_beepgain_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { fs.rmSync(TMP, { recursive: true, force: true }); console.error(e); process.exit(1); });
