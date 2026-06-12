#!/usr/bin/env node
// bench_frame.js — np2kai_run_frame の headless スループット計測 (最適化 A/B 用)。
// CPU インタプリタが毎フレームの支配項なので、-O0 → -O2/-O3 の効果を倍率で出す。
// 題材は FreeDOS boot.d88 (起動コード + その後のスピンで CPU を密に回す)。決定論的なので
// 同一フレーム列を両ビルドで比較すれば純粋な interpreter 速度比になる。
// 使い方: node tools/bench_frame.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({
        print: () => {}, printErr: () => {},
        locateFile: (p) => path.join(WEB, p),
    });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }
    M.FS.writeFile('/tmp/boot.d88', new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools/testdata/boot.d88'))));
    const r = M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/boot.d88', 0, 0]);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);

    const WARM = 120, MEAS = 600;
    for (let i = 0; i < WARM; i++) runFrame(handle);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < MEAS; i++) runFrame(handle);
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    console.log(JSON.stringify({
        insert_r: r, frames: MEAS,
        total_ms: +ms.toFixed(1),
        ms_per_frame: +(ms / MEAS).toFixed(3),
        fps: +(1000 / (ms / MEAS)).toFixed(1),
    }));
})().catch((e) => { console.error('BENCH ERROR:', e); process.exit(1); });
