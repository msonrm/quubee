#!/usr/bin/env node
// 回帰: np2kai_set_audio_rate(R) を create 前に呼んだら、エンジンの実出力レートが R になること。
//
// 背景 (2026-06-20 根治): np2kai_create 内の initload() が np2cfg を既定構造体に戻し samplingrate を
// 44100 にリセットしていたため、create 前の set_audio_rate が無視され、エンジンは常に 44100 で生成
// していた。AudioContext が 48000 の端末では再生レートと食い違い、Beep/MIDI/FM すべてが 48000/44100
// ≒ 1.5 半音 高く鳴っていた (ユーザー報告)。修正 = set_audio_rate の値を static に退避し create 内
// (initload 直後) で再適用。soundmng_create は s_opened ガードで最初の 1 回しか rate を確定しないので、
// その「最初」が正しいレートで起きることが要。
//
// この回帰は「create 前に指定したレートがそのまま反映される」ことだけを直接検査する (外部書庫不要・高速)。
//
// 使い方: node tools/audio_rate_test.js

const path = require('path');
const fs   = require('fs');
const WEB  = path.join(__dirname, '..', 'web');

if (!fs.existsSync(path.join(WEB, 'np2kai_core.js'))) { console.log('SKIP — np2kai_core.js 不在 (ビルドしてください)'); process.exit(0); }
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// 各レートは独立した Wasm インスタンスで検証する (soundmng_create は s_opened で一度きり確定するため、
// 同一インスタンス内ではレートを変えられない = 実アプリも 1 インスタンス 1 レート)。
async function rateFor(setTo) {
    const M = await NP2KaiModule({ noInitialRun: true, locateFile: p => path.join(WEB, p), print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    if (setTo) M.ccall('np2kai_set_audio_rate', 'number', ['number'], [setTo]);
    const h = M.ccall('np2kai_create', 'number', [], []);
    if (!h) throw new Error('create failed');
    return M.ccall('np2kai_audio_get_rate', 'number', ['number'], [h]);
}

(async () => {
    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } };

    const def = await rateFor(0);
    chk(def === 44100, `既定 (set_audio_rate なし) のエンジンレート = ${def} (期待 44100)`);

    for (const r of [48000, 22050, 96000]) {
        const got = await rateFor(r);
        chk(got === r, `set_audio_rate(${r}) → エンジンレート = ${got} (期待 ${r}) ※initload に上書きされない`);
    }

    console.log(`\naudio_rate_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
