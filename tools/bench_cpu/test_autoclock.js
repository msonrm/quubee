#!/usr/bin/env node
// test_autoclock.js — async 自動クロック コントローラ (web/player/bridge.js の autoClock) の
// 収束テスト (headless)。bridge.js のロジックを複製し、実 run_frame の wall-time で駆動して、
//   - CPU 飽和 (busy.d88) では低めの倍率で安定 (real-time を割らない範囲に収束)
//   - HLT-idle (np2kai_boot.d88) では ceil まで上昇して安定 (HLT は倍率が無料)
//   - 発振しない
// ことを確認する。headless の run_frame はブラウザより速いので収束「値」は高めに出るが、
// 検証対象は収束「挙動」(regime 適応 + 無発振)。
//
// 使い方: node tools/bench_cpu/test_autoclock.js
const path = require('path');
const fs   = require('fs');
const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const WEB  = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// --- bridge.js の autoClock と同一ロジック (ceil は引数で可変) ---
function makeController(setMul, ceil) {
    return {
        enabled: true, floor: 20, ceil, step: 2, cur: 20, emaMs: 0,
        budgetMs: 1000 / 56, evalEvery: 30, evalCount: 0, hi: 0.70, lo: 0.40,
        sample(ms) { this.emaMs = this.emaMs ? this.emaMs * 0.9 + ms * 0.1 : ms; },
        tick() {
            if (!this.enabled || ++this.evalCount < this.evalEvery) return;
            this.evalCount = 0;
            const load = this.emaMs / this.budgetMs;
            let next = this.cur;
            if      (load > this.hi && this.cur > this.floor) next = Math.max(this.floor, this.cur - this.step);
            else if (load < this.lo && this.cur < this.ceil)  next = Math.min(this.ceil,  this.cur + this.step);
            if (next !== this.cur) this.cur = setMul(next);
        },
    };
}

async function run(disk, label, ceil) {
    const M = await NP2KaiModule({ print: () => {}, printErr: () => {}, locateFile: (p) => path.join(WEB, p) });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const h = M.ccall('np2kai_create', 'number', [], []);
    M.FS.writeFile('/tmp/d.d88', new Uint8Array(fs.readFileSync(disk)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/d.d88', 0, 0]);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const setMul   = M.cwrap('np2kai_set_clock_multiple', 'number', ['number']);
    setMul(20);
    for (let i = 0; i < 700; i++) runFrame(h);   // boot まで暖機
    const ac = makeController(setMul, ceil);
    const samples = [];   // eval 境界 (evalEvery フレーム毎) ごとの cur を記録
    for (let f = 0; f < 2400; f++) {
        const t = process.hrtime.bigint();
        runFrame(h);
        ac.sample(Number(process.hrtime.bigint() - t) / 1e6);
        ac.tick();
        if ((f + 1) % ac.evalEvery === 0) samples.push(ac.cur);
    }
    // 安定 = 末尾 5 eval の cur が ±step 以内 (ランプ完了後に発振せず一定値で落ち着く)
    const tail = samples.slice(-5);
    const settled = Math.max(...tail) - Math.min(...tail) <= ac.step;
    console.log(`${label}: 収束=${ac.cur} 安定=${settled} (末尾5eval=[${tail.join(',')}])`);
    return settled;
}

(async () => {
    const CEIL = 42;
    const a = await run(path.join(HERE, 'busy.d88'), 'busy(CPU飽和)        ', CEIL);
    const b = await run(path.join(WEB, 'assets/np2kai_boot.d88'), 'np2kai_boot(HLT-idle)', CEIL);
    console.log(a && b ? 'PASS — 両 regime で発振なく収束' : 'FAIL — 発振または未収束');
    process.exit(a && b ? 0 : 1);
})().catch((e) => { console.error('TEST ERROR:', e); process.exit(1); });
