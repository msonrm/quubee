#!/usr/bin/env node
// PMD 音楽セッション (再起動なしの曲差し替え) の headless 回帰 (2026-06-16, Part 2)。
//
// 何を確かめるか:
//   np2kai_dos_stage_music で PMD86 常駐セッションを 1 度だけ起動し、
//   np2kai_dos_music_play(songA) → 演奏 → np2kai_dos_music_play(songB) を
//   **reset / loader 再挿入なし**で行っても、両方とも steady-state で発音すること。
//   = どの書庫の .M も別 DOS セッションを起こさずに次々演奏できる (shell.asm の AX=2 待機 +
//     dos_loader.c の音楽コマンドキュー)。
//
// エンジン (PMD86.COM/PMP.COM) は同梱済みの web/assets/pmd/ から。曲は東方旧作 BGM コーパス
// (games/touhou/pmd_music/*.lzh) から 2 本展開。どちらか無ければ SKIP (CI 安全)。展開は lha/lhasa。
//
// 使い方: node tools/pmd_session_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const PMD86  = path.join(WEB, 'assets', 'pmd', 'PMD86.COM');
const PMP    = path.join(WEB, 'assets', 'pmd', 'PMP.COM');
const CORPUS = path.join(ROOT, 'games', 'touhou', 'pmd_music');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
for (const [p, n] of [[LOADER, 'loader.d88'], [FONT, 'font.bmp'], [PMD86, 'PMD86.COM'], [PMP, 'PMP.COM']])
    if (!fs.existsSync(p)) skip(`${n} 不在`);
if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) skip('np2kai_core.js 不在 (ビルドしてください)');
if (!fs.existsSync(CORPUS)) skip('コーパス games/touhou/pmd_music 不在 (ローカル限定)');

// コーパスから 2 本展開 (異なる曲)。
function haveCmd(c) { try { cp.execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch (_) { return false; } }
const EX = haveCmd('lha') ? 'lha' : (haveCmd('lhasa') ? 'lhasa' : null);
if (!EX) skip('lha / lhasa が無い');
const TMP = fs.mkdtempSync('/tmp/pmd_session_');
const lzhs = fs.readdirSync(CORPUS).filter((f) => /\.lzh$/i.test(f)).sort();
for (const lzh of lzhs) {
    try {
        if (EX === 'lha') cp.execSync(`lha -xqw=${TMP} "${path.join(CORPUS, lzh)}"`, { stdio: 'ignore' });
        else              cp.execSync(`cd ${TMP} && lhasa -xq "${path.join(CORPUS, lzh)}"`, { stdio: 'ignore', shell: '/bin/bash' });
    } catch (_) {}
}
const songs = fs.readdirSync(TMP).filter((f) => /\.m$/i.test(f)).sort().slice(0, 2);
if (songs.length < 2) skip('コーパスから .M を 2 本展開できなかった');

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
    for (const s of songs) M.FS.writeFile('/run/' + s, new Uint8Array(fs.readFileSync(path.join(TMP, s))));
    fs.rmSync(TMP, { recursive: true, force: true });

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr     = M._malloc(bufsize * 2 * 2);

    // 指定フレーム数だけ進め、終盤の steady-state 区間で peak/rms を測る。
    function runAndMeasure(frames, measureFrom) {
        let peak = 0, sumSq = 0, n = 0;
        for (let f = 0; f < frames; f++) {
            runFrame(handle);
            if (f >= measureFrom && f % 4 === 0) {
                fillFn(handle, aptr, bufsize);
                const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
                for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; sumSq += pcm[i] * pcm[i]; n++; }
            }
        }
        return { peak, rms: n ? Math.sqrt(sumSq / n) : 0 };
    }

    // --- セッション起動 + 曲 A ---
    const r = M.ccall('np2kai_dos_stage_music', 'number', [], []);
    if (r !== 0) throw new Error('stage_music r=' + r);
    M.ccall('np2kai_dos_music_play', 'number', ['string'], [songs[0]]);
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);   // ★ ここが唯一の reset

    const a = runAndMeasure(1500, 1100);
    console.log(`song A (${songs[0]}): peak=${a.peak} rms=${a.rms.toFixed(1)}`);
    chk(a.peak > 4000 && a.rms > 500, `曲 A が steady-state 演奏 (${songs[0]})`);

    // --- 曲 B へ差し替え (reset / loader 再挿入なし) ---
    const exitedBefore = M.ccall('np2kai_dos_get_exit', 'number', ['number'], [0]);
    M.ccall('np2kai_dos_music_play', 'number', ['string'], [songs[1]]);   // queue only — NO reset
    const b = runAndMeasure(1500, 1100);
    console.log(`song B (${songs[1]}): peak=${b.peak} rms=${b.rms.toFixed(1)}`);
    chk(b.peak > 4000 && b.rms > 500, `曲 B が同一セッションで steady-state 演奏 — reset なし (${songs[1]})`);
    chk(exitedBefore === 0, 'セッションは曲切り替えの間も exit していない (常駐維持)');

    M._free(aptr);
    console.log(`\npmd_session_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
