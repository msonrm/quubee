#!/usr/bin/env node
// パート別音量バランス API (np2kai_set_vol / np2kai_get_vol) の回帰 (2026-06-17)。
//
// 何を確かめるか:
//   ① get_vol が現在の np2cfg.vol_* を返す / set_vol の部分更新 (負値=据え置き) が効く
//   ② set_vol が「鳴っている」fmgen インスタンスに live 反映される — 全パートを 0 にすると
//      FM 出力が無音近くまで落ち、既定値へ戻すと回復する (= reset を待たず A/B 可)。
//   症状②「リズムがメロより前に出すぎ」の live バランス調整 (qbDebug.vol) の土台。
//
// 曲は games/touhou/pmd_music から 1 本展開 (FM/SSG が鳴れば十分・リズム samples 不要)。
//   書庫/lha が無ければ SKIP (CI 安全)。使い方: node tools/vol_test.js

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
if (!fs.existsSync(CORPUS)) skip('games/touhou/pmd_music 不在 (ローカル限定)');
function haveCmd(c) { try { cp.execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch (_) { return false; } }
if (!haveCmd('lha')) skip('lha が無い');

const TMP = fs.mkdtempSync('/tmp/vol_test_');
const lzh = fs.readdirSync(CORPUS).filter((f) => /\.lzh$/i.test(f)).sort()[0];
if (!lzh) { fs.rmSync(TMP, { recursive: true, force: true }); skip('コーパスに .lzh が無い'); }
cp.execSync(`lha -xqw=${TMP} "${path.join(CORPUS, lzh)}"`, { stdio: 'ignore' });
const songSrc = fs.readdirSync(TMP).find((f) => /\.m$/i.test(f));
if (!songSrc) { fs.rmSync(TMP, { recursive: true, force: true }); skip('.M を展開できなかった'); }
const SONG = songSrc.toUpperCase();
const songBytes = new Uint8Array(fs.readFileSync(path.join(TMP, songSrc)));
fs.rmSync(TMP, { recursive: true, force: true });

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
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
    const setVol   = M.cwrap('np2kai_set_vol', null, ['number', 'number', 'number', 'number']);
    const getVol   = M.cwrap('np2kai_get_vol', 'number', ['number']);
    const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr     = M._malloc(bufsize * 2 * 2);

    // 定常状態まで進める (常駐 ISR が刻み始めるまで)
    for (let f = 0; f < 1000; f++) runFrame(handle);

    // 各 vol で frames フレーム回し、出力 RMS を測る
    function captureRms(frames) {
        let sum = 0, n = 0;
        for (let f = 0; f < frames; f++) {
            runFrame(handle);
            fillFn(handle, aptr, bufsize);
            const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
            for (let i = 0; i < pcm.length; i++) { sum += pcm[i] * pcm[i]; n++; }
        }
        return Math.sqrt(sum / n);
    }

    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } };

    // 既定値を控える
    const def = { fm: getVol(0), ssg: getVol(1), rhythm: getVol(2), adpcm: getVol(3), master: getVol(4) };
    console.log(`song=${SONG} (${lzh})`);
    console.log(`  既定 vol: fm=${def.fm} ssg=${def.ssg} rhythm=${def.rhythm} adpcm=${def.adpcm} master=${def.master}`);

    // 基準 RMS (既定値のまま)
    const rmsBase = captureRms(200);
    console.log(`  基準 RMS=${rmsBase.toFixed(1)}`);
    chk(rmsBase > 300, '既定で FM が鳴っている (基準 RMS が有意)');

    // ① 部分更新: rhythm だけ 0、他は据え置き (負値)
    setVol(-1, -1, 0, -1);
    chk(getVol(2) === 0 && getVol(0) === def.fm && getVol(1) === def.ssg,
        '部分更新: rhythm だけ 0、fm/ssg は据え置き (負値=触らない)');

    // ② get/set 往復: fm を 77 に
    setVol(77, -1, -1, -1);
    chk(getVol(0) === 77, 'get/set 往復: fm=77 が読み戻せる');

    // ③ live 反映: 全パート 0 → 無音近くまで落ちる
    setVol(0, 0, 0, 0);
    const rmsMute = captureRms(150);
    console.log(`  全ミュート RMS=${rmsMute.toFixed(1)}`);
    chk(rmsMute < rmsBase * 0.25, 'live 反映: 全パート 0 で FM 出力が無音近くへ (reset 不要で効く)');

    // ④ 既定へ戻すと回復する
    setVol(def.fm, def.ssg, def.rhythm, def.adpcm);
    const rmsBack = captureRms(200);
    console.log(`  復帰 RMS=${rmsBack.toFixed(1)}`);
    chk(rmsBack > rmsBase * 0.5, '既定へ戻すと音量が回復する');

    M._free(aptr);
    console.log(`\nvol_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
