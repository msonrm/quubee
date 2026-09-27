#!/usr/bin/env node
// th02_midi_test.js — 東方封魔録 (TH02 体験版) の MIDI(MPU) が Mate-X PCM 構成・高い倍率でも鳴ることの回帰。
//
// 2026-09-27 に判明した不具合のガード: MMD 2.2f は MPU の割り込み番号 (INT) を自動判定し、Clock to Host の
// 割り込みを「ポート 5Fh への書き込み x 4000 回」の間だけ待つ。NP2kai の 5Fh は固定 20 クロックだったので倍率を
// 上げるほど実時間で短くなり、倍率 22 前後から INT2 の判定に失敗 → Mate-X 構成では MIDI が鳴らなかった
// (ちびおと構成は INT5 = IRQ 12 に偶然便乗していた)。patch 12 で 5Fh を実時間 (約 1.3us) にして解消。
// 手順は tools/th02_midi_probe.js (MIDI 有効で起動 → OPTION で MUSIC=MIDI → FM 系を消音して MIDI だけの音量)。
//
// 素材 games/touhou/huma_ts2.lzh はローカル限定。無ければ SKIP (probe 側が判定)。
// 使い方: node tools/th02_midi_test.js
'use strict';
const cp = require('child_process');
const path = require('path');
const out = cp.execFileSync(process.execPath, [path.join(__dirname, 'th02_midi_probe.js'), 'matex', '27,38'], { encoding: 'utf8' });
if (/^SKIP/m.test(out)) { console.log(out.trim()); process.exit(0); }
let pass = 0, fail = 0;
for (const line of out.split('\n').filter((l) => l.startsWith('{'))) {
    const r = JSON.parse(line);
    const ok = r.midiAudible;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}: Mate-X PCM・倍率 ${r.multiple} で MIDI が鳴る (MIDI だけの rms ${r.midiRms})`);
    ok ? pass++ : fail++;
}
if (pass + fail === 0) { console.log('FAIL: probe の出力が無い\n' + out); process.exit(1); }
console.log(`\nth02_midi_test: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
