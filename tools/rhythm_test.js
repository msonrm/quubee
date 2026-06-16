#!/usr/bin/env node
// OPNA リズム音源 (2608modoki 代替サンプル) が効くことの回帰 (2026-06-17)。
//
// 何を確かめるか: 同梱の `web/assets/rhythm/2608_*.wav` をデータディレクトリに置くと、
//   東方曲 (OPNA リズムを叩く) の出力に **リズムのヒット (peak 上昇) と左右パン (L/R 非対称)** が
//   現れること。サンプルが無いと OPNA リズム部 (reg 0x10 キーオン) は無音 → ハイハット等が欠ける。
//   ブラウザでは bridge.js が同じファイルを同じ場所へ fetch する (純資産/JS、Wasm 不変)。
//
// 曲はローカル games/touhou/pmd_music から 1 本展開。書庫/lha が無ければ SKIP (CI 安全)。
//
// 使い方: node tools/rhythm_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const PMD86  = path.join(WEB, 'assets', 'pmd', 'PMD86.COM');
const PMP    = path.join(WEB, 'assets', 'pmd', 'PMP.COM');
const RDIR   = path.join(WEB, 'assets', 'rhythm');
const CORPUS = path.join(ROOT, 'games', 'touhou', 'pmd_music');
const NAMES  = ['bd', 'sd', 'top', 'hh', 'tom', 'rim'];

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
for (const [p, n] of [[LOADER, 'loader.d88'], [FONT, 'font.bmp'], [PMD86, 'PMD86.COM'], [PMP, 'PMP.COM']])
    if (!fs.existsSync(p)) skip(`${n} 不在`);
if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) skip('np2kai_core.js 不在 (ビルドしてください)');
for (const nm of NAMES) if (!fs.existsSync(path.join(RDIR, `2608_${nm}.wav`))) skip(`assets/rhythm/2608_${nm}.wav 不在`);
if (!fs.existsSync(CORPUS)) skip('games/touhou/pmd_music 不在 (ローカル限定)');
function haveCmd(c) { try { cp.execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch (_) { return false; } }
if (!haveCmd('lha')) skip('lha が無い');

const TMP = fs.mkdtempSync('/tmp/rhythm_test_');
const lzh = fs.readdirSync(CORPUS).filter((f) => /\.lzh$/i.test(f)).sort()[0];
if (!lzh) { fs.rmSync(TMP, { recursive: true, force: true }); skip('コーパスに .lzh が無い'); }
cp.execSync(`lha -xqw=${TMP} "${path.join(CORPUS, lzh)}"`, { stdio: 'ignore' });
const songSrc = fs.readdirSync(TMP).find((f) => /\.m$/i.test(f));
if (!songSrc) { fs.rmSync(TMP, { recursive: true, force: true }); skip('.M を展開できなかった'); }
const SONG = songSrc.toUpperCase();
const songBytes = new Uint8Array(fs.readFileSync(path.join(TMP, songSrc)));
const wavs = Object.fromEntries(NAMES.map((nm) => [nm, new Uint8Array(fs.readFileSync(path.join(RDIR, `2608_${nm}.wav`)))]));
fs.rmSync(TMP, { recursive: true, force: true });

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
async function run(withRhythm) {
    const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    if (withRhythm) for (const nm of NAMES) {
        M.FS.writeFile('/tmp/2608_' + nm.toUpperCase() + '.WAV', wavs[nm]); // fmgen
        M.FS.writeFile('/tmp/2608_' + nm + '.wav', wavs[nm]);               // opngen
    }
    const handle = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/PMD86.COM', new Uint8Array(fs.readFileSync(PMD86)));
    M.FS.writeFile('/run/PMP.COM',   new Uint8Array(fs.readFileSync(PMP)));
    M.FS.writeFile('/run/' + SONG, songBytes);
    M.ccall('np2kai_dos_stage_music', 'number', [], []);
    M.ccall('np2kai_dos_music_play', 'number', ['string'], [SONG]);
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_set_pmd_irq', 'number', ['number'], [1]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr     = M._malloc(bufsize * 2 * 2);
    let peak = 0, maxLR = 0;
    for (let f = 0; f < 2500; f++) {
        runFrame(handle);
        if (f >= 800) {
            fillFn(handle, aptr, bufsize);
            const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
            let sL = 0, sR = 0, n = 0;
            for (let i = 0; i < pcm.length; i += 2) {
                const a = Math.max(Math.abs(pcm[i]), Math.abs(pcm[i + 1])); if (a > peak) peak = a;
                sL += pcm[i] * pcm[i]; sR += pcm[i + 1] * pcm[i + 1]; n++;
            }
            const rL = Math.sqrt(sL / n), rR = Math.sqrt(sR / n), hi = Math.max(rL, rR);
            if (hi > 500) { const d = Math.abs(rL - rR) / hi * 100; if (d > maxLR) maxLR = d; }
        }
    }
    M._free(aptr);
    return { peak, maxLR };
}
(async () => {
    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } };
    const off = await run(false);
    const on  = await run(true);
    console.log(`song=${SONG} (${lzh})`);
    console.log(`  リズム無し: peak=${off.peak} 最大L/R非対称=${off.maxLR.toFixed(1)}%`);
    console.log(`  リズム有り: peak=${on.peak} 最大L/R非対称=${on.maxLR.toFixed(1)}%`);
    chk(on.peak > off.peak, 'リズムサンプルでヒットが加わる (peak 上昇)');
    chk(on.maxLR >= 1.0 && on.maxLR > off.maxLR + 0.8, 'リズムにパンが乗る (L/R 非対称が出る = 実機の「左から」を再現)');
    console.log(`\nrhythm_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
