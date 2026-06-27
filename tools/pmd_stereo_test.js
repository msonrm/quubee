#!/usr/bin/env node
// PMD パン処理が QuuBee で効くことの回帰 (2026-06-17)。
//
// 問い: PMD86.COM が MML の 'p' パン命令を OPNA の pan レジスタ (0xB4-0xB6 / 0x1B4-0x1B6) に
//   書き、fmgen がそれを左右別出力に反映しているか。
//
// 方法: KAJA 公式サンプル uke10.m は 'p1'(右)/'p2'(左) のハードパン命令を持つ
//   (.M 内で 0xEC の直後が 0x01/0x02/0x03)。我々の PMD86.COM + PMP.COM で全曲鳴らし、
//   各オーディオ窓ごとに L 系列 / R 系列の RMS を別測定して **最大 L/R 非対称** を追う。
//   パンが効く区間 (曲頭付近) で L≠R が出れば PASS。
//   【注意】曲全体を平均すると center 区間に薄まって L≒R に見えるので、必ず窓ごとに走査する。
//
// サンプルはローカルの games/driver/pmd48o.lzh (→ ネスト pmd_sam.lzh → uke10.m) から取り出す。
// 書庫 / lha が無ければ SKIP (CI 安全・書庫は再配布不可でコミットしない)。
//
// 使い方: node tools/pmd_stereo_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const PMD86  = path.join(WEB, 'assets', 'pmd', 'PMD86.COM');
const PMP    = path.join(WEB, 'assets', 'pmd', 'PMP.COM');
const OUTER  = path.join(ROOT, 'games', 'driver', 'pmd48o.lzh');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
for (const [p, n] of [[LOADER, 'loader.d88'], [FONT, 'font.bmp'], [PMD86, 'PMD86.COM'], [PMP, 'PMP.COM']])
    if (!fs.existsSync(p)) skip(`${n} 不在`);
if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) skip('np2kai_core.js 不在 (ビルドしてください)');
if (!fs.existsSync(OUTER)) skip('games/driver/pmd48o.lzh 不在 (ローカル限定)');
function haveCmd(c) { try { cp.execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch (_) { return false; } }
if (!haveCmd('lha')) skip('lha が無い');

// pmd48o.lzh → pmd_sam.lzh → uke10.m + *.ppc を取り出す。
const TMP = fs.mkdtempSync('/tmp/pmd_stereo_');
try {
    cp.execSync(`lha -xqw=${TMP} "${OUTER}" pmd_sam.lzh`, { stdio: 'ignore' });
    cp.execSync(`lha -xqw=${TMP} "${path.join(TMP, 'pmd_sam.lzh')}"`, { stdio: 'ignore' });
} catch (_) {}
function find(name) {
    const hit = fs.readdirSync(TMP).find((f) => f.toLowerCase() === name);
    return hit ? path.join(TMP, hit) : null;
}
const ukePath = find('uke10.m');
if (!ukePath) { fs.rmSync(TMP, { recursive: true, force: true }); skip('uke10.m を展開できなかった'); }
const ppcs = fs.readdirSync(TMP).filter((f) => /\.ppc$/i.test(f));

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
(async () => {
    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } };

    const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) throw new Error('create failed');

    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/PMD86.COM', new Uint8Array(fs.readFileSync(PMD86)));
    M.FS.writeFile('/run/PMP.COM',   new Uint8Array(fs.readFileSync(PMP)));
    M.FS.writeFile('/run/UKE10.M',   new Uint8Array(fs.readFileSync(ukePath)));
    for (const pc of ppcs) M.FS.writeFile('/run/' + pc.toUpperCase(), new Uint8Array(fs.readFileSync(path.join(TMP, pc))));
    fs.rmSync(TMP, { recursive: true, force: true });

    M.ccall('np2kai_dos_stage_music', 'number', [], []);
    M.ccall('np2kai_dos_music_play', 'number', ['string'], ['UKE10.M']);
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_set_pmd_irq', 'number', ['number'], [1]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr     = M._malloc(bufsize * 2 * 2);

    let maxDiff = 0, maxAt = -1, asymWindows = 0, peakAny = 0;
    const N = 6000;
    for (let f = 0; f < N; f++) {
        runFrame(handle);
        fillFn(handle, aptr, bufsize);
        const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
        let sL = 0, sR = 0, n = 0;
        for (let i = 0; i < pcm.length; i += 2) {
            sL += pcm[i] * pcm[i]; sR += pcm[i + 1] * pcm[i + 1]; n++;
            const a = Math.max(Math.abs(pcm[i]), Math.abs(pcm[i + 1])); if (a > peakAny) peakAny = a;
        }
        const rL = Math.sqrt(sL / n), rR = Math.sqrt(sR / n), hi = Math.max(rL, rR);
        if (hi > 500) { const d = Math.abs(rL - rR) / hi * 100; if (d > maxDiff) { maxDiff = d; maxAt = f; } if (d >= 8) asymWindows++; }
    }
    M._free(aptr);

    console.log(`uke10.m: ${N}フレーム走査 peak=${peakAny} 最大L/R非対称=${maxDiff.toFixed(1)}% @frame ${maxAt} (8%超 ${asymWindows}窓)`);
    chk(peakAny > 3000, 'uke10.m が発音している');
    chk(maxDiff >= 8, 'パン区間で L≠R = PMD のパン処理が QuuBee で効いている (STEREO)');

    console.log(`\npmd_stereo_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
