#!/usr/bin/env node
// bench_ray.js — Ray IV (16bit 実モードゲーム実走) の CPU スループット計測。
//
// bench_game.js (Suika3 = DOS/4GW 32bit PM) と対になる 16bit 実モード側の基準ワークロード。
// プロファイルの形が全く違う (Suika3 = codefetch/32bit 命令、Ray = LES/load_segreg/16bit 命令 +
// EGC VRAM) ので、CPU 最適化の A/B は必ず両方で測る。素材 games/game/ray_iv2a.lzh は
// 再配布不可 (ローカル限定)。無ければ SKIP (CI 安全)。
//
// 使い方: node tools/bench_ray.js [multiple]   (既定 20)
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { Machine } = require('./lib/machine');

const ROOT = path.resolve(__dirname, '..');
const LZH = path.join(ROOT, 'games', 'game', 'ray_iv2a.lzh');
const multiple = +(process.argv[2] || 20);

if (!fs.existsSync(LZH)) { console.log('SKIP — games/game/ray_iv2a.lzh 不在 (再配布不可・ローカル限定)'); process.exit(0); }
try { cp.execSync('command -v lha', { stdio: 'ignore' }); } catch (_) { console.log('SKIP — lha 不在'); process.exit(0); }

const WARM = 1200;      // フィールド描画 + 動作まで
const MEAS = 600;

const TMP = fs.mkdtempSync('/tmp/bench_ray_');
cp.execSync(`lha xfw=${TMP} "${LZH}"`, { stdio: 'ignore' });
const files = fs.readdirSync(TMP, { recursive: true }).filter(f => fs.statSync(path.join(TMP, f)).isFile());
const RUN = path.join(TMP, 'run'); fs.mkdirSync(RUN);
for (const f of files) fs.copyFileSync(path.join(TMP, f), path.join(RUN, path.basename(f).toUpperCase()));
fs.writeFileSync(path.join(RUN, 'R.BAT'), 'RAY.EXE SILK_FLD.RAY\r\n');

(async () => {
    const m = await Machine.boot({ dir: RUN, bat: 'R.BAT', multiple });
    m.runFrames(WARM);
    const h1 = m.screenHash(); m.runFrames(30); const h2 = m.screenHash();
    const pcm = m.captureAudio(0.5);
    let rms = 0; for (let i = 0; i < pcm.length; i++) rms += pcm[i] * pcm[i];
    rms = Math.round(Math.sqrt(rms / pcm.length));
    const t0 = process.hrtime.bigint();
    m.runFrames(MEAS);
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    console.log(JSON.stringify({
        wasm: m.info().wasm.sha256.slice(0, 16),
        multiple, audioRms: rms, screenAnimated: h1 !== h2,
        frames: MEAS,
        ms_per_frame: +(ms / MEAS).toFixed(3),
        fps: +(1000 / (ms / MEAS)).toFixed(1),
    }));
    fs.rmSync(TMP, { recursive: true, force: true });
})().catch(e => { console.error('BENCH ERROR:', e); process.exit(1); });
