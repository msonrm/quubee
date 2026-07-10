#!/usr/bin/env node
// bench_game.js — 実ゲーム (既定 Suika3) での CPU インタプリタ・スループット計測 (最適化 A/B 用)。
//
// bench_frame.js (FreeDOS boot.d88) はブート後のスピンが BOUND 例外を連発し、時間の 65% が
// __emscripten_throw_longjmp = JS 例外スローの計測になってしまう (2026-07-10 プロファイルで確認)。
// インタプリタ本体 (memp_read8 / exec_allstep / cpu_codefetch) の速度を測るには、実ワークロードで
// 測る必要がある → 題材は Suika3 (DOS/4GW・BGM 再生中のゲームループ)。
//
// 使い方: node tools/bench_game.js [ゲームディレクトリ]
//   省略時は ~/suika3_audio/game-d (snapshot_test.js と同じ)。無ければ SKIP。
// 注意: snapshot は wasm SHA に紐付くためビルド間 A/B には使えない。暖機は毎回素で回す。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine, NKEY } = require('./lib/machine');

const WARM = 1500;      // 暖機: グラフィック画面 + BGM 再生まで (snapshot_test.js と同一)
const MEAS = 600;       // 計測フレーム数

const dir = process.argv[2] || path.join(os.homedir(), 'suika3_audio', 'game-d');
if (!fs.existsSync(dir)) { console.log('SKIP — ゲームディレクトリが無い: ' + dir); process.exit(0); }

(async () => {
    const m = await Machine.boot({ dir, multiple: 20 });
    // 決定論的な入力: Enter を 2 回だけ (snapshot_test.js の drive と同一)
    for (let i = 0; i < WARM; i++) {
        if (m.frame === 500 || m.frame === 1200) m.pressKey(NKEY.RETURN, 6);
        m.runFrames(1);
    }
    const t0 = process.hrtime.bigint();
    m.runFrames(MEAS);
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    console.log(JSON.stringify({
        wasm: m.info().wasm.sha256.slice(0, 16),
        screen: m.screenHash().toString(16),
        frames: MEAS,
        total_ms: +ms.toFixed(1),
        ms_per_frame: +(ms / MEAS).toFixed(3),
        fps: +(1000 / (ms / MEAS)).toFixed(1),
    }));
})().catch((e) => { console.error('BENCH ERROR:', e); process.exit(1); });
