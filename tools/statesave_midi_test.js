#!/usr/bin/env node
// statesave_midi_test.js — ステートセーブの MIDI の控え (段階 D) の検証。
//
// 合成器 (TinySoundFont) の内部は保存せず、チャンネルごとに TSF が反映する設定 (バンク・音色・音量・
// エクスプレッション・パン・サステイン・RPN 0〜2・ピッチベンド) の最後の値を控え、ロード後に全音停止 +
// コントロール初期化の後で送り直す (native/qb_tsf.c)。
//
// A: M.COM (tools/statesave_dos/m.asm) が MPU-PC98 へ送った設定で鳴らしている時点でセーブ。
// B: MIDI を有効にした**無関係の** IDLE セッションを起動してロード → 合成器のチャンネル設定が A と一致。
// 検出力: A の値が既定値と違うこと・B のロード前の値が A と違うことも確かめる。
//
// ローカル限定: soundfont.sf2 (tools/setup_soundfont.sh) が無ければ SKIP。
// 使い方: node tools/statesave_midi_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine } = require('./lib/machine');

if (!fs.existsSync(path.join(__dirname, '..', 'web', 'assets', 'soundfont.sf2'))) {
    console.log('SKIP — web/assets/soundfont.sf2 不在 (tools/setup_soundfont.sh)'); process.exit(0);
}

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

const WHAT = ['preset', 'bank', 'volume', 'pan', 'pitchrange', 'pitchwheel'];
function snapshot(m) {
    const q = (h, ch, w) => m.M.ccall('np2kai_debug_midi_ch', 'number', ['number', 'number', 'number'], [h, ch, w]);
    const n = q(0, 0, -1);
    const out = { handles: n };
    for (let h = 0; h < n; h++) {
        for (const ch of [0, 1, 9]) out[`h${h}c${ch}`] = WHAT.map((_, w) => q(h, ch, w)).join(',');
    }
    return out;
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_midi_'));
    fs.copyFileSync(path.join(__dirname, 'statesave_dos', 'M.COM'), path.join(dir, 'M.COM'));
    fs.writeFileSync(path.join(dir, 'RUN.BAT'), 'M.COM\r\n');
    const idle = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_idle_'));
    fs.writeFileSync(path.join(idle, 'IDLE.COM'), Buffer.from([0xEB, 0xFE]));
    fs.writeFileSync(path.join(idle, 'IDLE.BAT'), 'IDLE.COM\r\n');

    const A = await Machine.boot({ dir, bat: 'RUN.BAT', midi: true });
    A.runFrames(120);
    const snapA = snapshot(A);
    const np2Save = A.M.ccall('np2kai_state_np2_save', 'number', ['string'], ['/tmp/s.np2']);
    const qbSave = A.M.ccall('np2kai_state_qb_save', 'number', ['string'], ['/tmp/s.qb']);
    const np2Blob = A.M.FS.readFile('/tmp/s.np2'), qbBlob = A.M.FS.readFile('/tmp/s.qb');

    const B = await Machine.boot({ dir: idle, bat: 'IDLE.BAT', midi: true });
    B.runFrames(1);
    const snapBefore = snapshot(B);
    B.M.FS.writeFile('/tmp/s.np2', np2Blob);
    B.M.FS.writeFile('/tmp/s.qb', qbBlob);
    const np2Load = B.M.ccall('np2kai_state_np2_load', 'number', ['string'], ['/tmp/s.np2']);
    const qbLoad = B.M.ccall('np2kai_state_qb_load', 'number', ['string'], ['/tmp/s.qb']);
    const snapB = snapshot(B);

    console.log('  A     :', JSON.stringify(snapA));
    console.log('  B 前  :', JSON.stringify(snapBefore));
    console.log('  B 後  :', JSON.stringify(snapB));
    chk(np2Save === 0 && qbSave === 0 && np2Load === 0 && qbLoad === 0,
        `保存・読み込みが成功 (np2 ${np2Save}/${np2Load}, qb ${qbSave}/${qbLoad})`);
    // M.COM が送った値: ch0 = 音色 40・パン 20/127・ベンド幅 12 半音 (x100 = 1200)・ベンド 1000h / ch1 = 音色 73
    const mpuKey = Object.keys(snapA).find((k) => /c0$/.test(k) && snapA[k].startsWith('40,'));
    chk(!!mpuKey && /,1200,4096$/.test(snapA[mpuKey]) && snapA[mpuKey.replace(/c0$/, 'c1')].startsWith('73,'),
        `A: MPU のハンドルに M.COM の設定が入っている (${mpuKey} = ${mpuKey && snapA[mpuKey]})`);
    chk(JSON.stringify(snapBefore) !== JSON.stringify(snapA), 'B のロード前は A と違う (検出力)');
    chk(JSON.stringify(snapB) === JSON.stringify(snapA), 'B のロード後の合成器のチャンネル設定が A と一致');

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(idle, { recursive: true, force: true });
    console.log(`\nstatesave_midi_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
