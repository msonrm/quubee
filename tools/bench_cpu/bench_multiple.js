#!/usr/bin/env node
// bench_multiple.js — CPU クロック倍率 (np2cfg.multiple) ごとの run_frame スループットを headless 計測。
//
// 題材は boot_busy.d88 = CPU 飽和の自己起動 busy ループ (HLT を含まない算術ループ)。実ゲームの
// 多くは vsync 待ちで HLT し、その間は HLT fast-forward で倍率コストがほぼ無料になるが、ここでは
// 「毎フレーム CPU を使い切る最悪ケース」を測って倍率の real-time 上限を出す。
//
// 倍率は np2kai_set_clock_multiple() で live 変更 (reset 不要。engine と同一の changeclock +
// gdc_updateclock カスケードで gdc.dispclock を再計算するので、フレームあたり CPU 予算が即追従する)。
//
// 使い方: node tools/bench_cpu/bench_multiple.js
// 期待: fps(M) ≈ K/M (反比例)。fps < TARGET(56.4) の倍率は host が real-time を維持できず、
//       pull 型音声バッファが枯れる領域 (= autoclock の floor..ceil 設計根拠)。
const path = require('path');
const fs   = require('fs');
const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const WEB  = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const TARGET = 56.4;   // PC-98 400 ライン垂直同期

(async () => {
    const M = await NP2KaiModule({ print: () => {}, printErr: () => {}, locateFile: (p) => path.join(WEB, p) });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const h = M.ccall('np2kai_create', 'number', [], []);
    if (!h) { console.error('np2kai_create failed'); process.exit(1); }
    M.FS.writeFile('/tmp/busy.d88', new Uint8Array(fs.readFileSync(path.join(HERE, 'busy.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/busy.d88', 0, 0]);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const setMul   = M.cwrap('np2kai_set_clock_multiple', 'number', ['number']);
    const linpc    = M.cwrap('np2kai_debug_get_linear_pc', 'number', ['number']);

    // busy ループに入るまで暖機
    setMul(20);
    for (let i = 0; i < 700; i++) runFrame(h);
    const pc = linpc(h);

    const MULS = [10, 20, 24, 30, 42, 50, 60, 80];
    const rows = [];
    for (const m of MULS) {
        setMul(m);
        for (let i = 0; i < 60; i++) runFrame(h);   // settle at this clock
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < 300; i++) runFrame(h);
        const ms  = Number(process.hrtime.bigint() - t0) / 1e6 / 300;
        const fps = 1000 / ms;
        rows.push({ multiple: m, ms_per_frame: +ms.toFixed(3), fps: +fps.toFixed(1),
                    rt_headroom: +(fps / TARGET).toFixed(2), realtime: fps >= TARGET ? 'OK' : 'UNDER' });
    }
    console.log('CPU-saturated busy loop @ linpc=0x' + pc.toString(16) + ', target=' + TARGET + 'fps:');
    console.table(rows);
})().catch((e) => { console.error('BENCH ERROR:', e); process.exit(1); });
