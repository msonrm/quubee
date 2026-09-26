#!/usr/bin/env node
// statesave_file_test.js — ステートセーブの保存ファイル (段階 E、web/player/statefmt.js) の検証。
//
// ブラウザと同じ statefmt.js (gzip 済みの保存ファイル = ヘッダ + 縮小画像 + NP2K + QBST + FILE) を
// machine.js から使い、次を確かめる:
//   1. 保存ファイル経由でも続きが一致 (A = 走らせ続ける / B = 無関係の IDLE セッションで読み込む)。
//      1 行目のカウンタ・2 行目のファイル内容・画面ハッシュ・音声の全区間。/run は FILE 区画から作り直す
//   2. 大きさと所要時間 (表示のみ)
//   3. NP2kai の互換識別子が違うセーブは読み込まずに断る (状態に触らない)
//   4. 適用の途中で失敗したら読み込み前の状態に戻す (QuuBee 区画を壊して NP2kai 区画だけ通る状況を作る)
//   5. 「元に戻す」(load の undo) で読み込み前の状態に戻る
//   6. ゲームの識別子が同じ入力で同じ・違う入力で違う
//
// 題材は statesave_test.js と同じ T.COM (tools/statesave_test.js のコメントにソース)。
// 使い方: node tools/statesave_file_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine } = require('./lib/machine');
const SF = require('../web/player/statefmt.js');

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

const T_COM = Buffer.from(fs.readFileSync(path.join(__dirname, 'statesave_test.js'), 'utf8')
    .match(/const T_COM = Buffer\.from\(\n([\s\S]*?)'hex'\);/)[1].replace(/[\s'+,]/g, ''), 'hex');
const WARM = 300, TAIL = 300;

function tail(m) {
    const pcm = m.captureAudio(TAIL / 56.42);
    const t = m.textVram();
    return { pcm, row0: t[0].slice(0, 4), row1: t[1], screen: m.screenHash() };
}
function view(m) { const t = m.textVram(); return JSON.stringify([t[0].slice(0, 4), t[1], m.screenHash()]); }
function samePcm(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

async function idle() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_idle_'));
    fs.writeFileSync(path.join(d, 'IDLE.COM'), Buffer.from([0xEB, 0xFE]));
    fs.writeFileSync(path.join(d, 'IDLE.BAT'), 'IDLE.COM\r\n');
    const m = await Machine.boot({ dir: d, bat: 'IDLE.BAT' });
    m.runFrames(1);
    return m;
}

(async () => {
    if (!SF.available()) { console.log('SKIP — CompressionStream が無い Node'); process.exit(0); }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_file_'));
    fs.writeFileSync(path.join(dir, 'T.COM'), T_COM);
    fs.writeFileSync(path.join(dir, 'DATA.BIN'), Buffer.from(Array.from({ length: 0x7f - 0x21 }, (_, i) => 0x21 + i)));
    fs.writeFileSync(path.join(dir, 'RUN.BAT'), 'T.COM\r\n');

    // ---- 1. 保存ファイル経由の一致 ----
    console.log('[1] 保存ファイル経由の一致');
    const A = await Machine.boot({ dir, bat: 'RUN.BAT' });
    A.runFrames(WARM);
    const t0 = process.hrtime.bigint();
    const saved = await A.stateSave({ gameId: 'test', gameName: 'T.COM', settings: { multiple: 20 } });
    const tSave = Number(process.hrtime.bigint() - t0) / 1e6;
    const at = { frame: A.frame, produced: A.produced };
    const obsA = tail(A);

    const B = await idle();
    const t1 = process.hrtime.bigint();
    const ld = await B.stateLoad(saved.bytes);
    const tLoad = Number(process.hrtime.bigint() - t1) / 1e6;
    B.frame = at.frame; B.produced = at.produced;
    const obsB = tail(B);
    chk(saved.ok && ld.ok, `保存・読み込みが成功 (save ${saved.ok}${saved.reason || ''} / load ${ld.ok} ${ld.reason || ''} ${ld.detail || ''})`);
    chk(obsA.row0 === obsB.row0 && obsA.row1 === obsB.row1 && obsA.screen === obsB.screen,
        `画面が一致 (row0 ${obsA.row0}/${obsB.row0}・2 行目・ハッシュ ${obsA.screen.toString(16)}/${obsB.screen.toString(16)})`);
    chk(samePcm(obsA.pcm, obsB.pcm), `音声が全区間一致 (${obsA.pcm.length / 2} サンプル)`);
    chk(saved.header.gameId === 'test' && saved.header.compat === B.M.ccall('np2kai_state_compat_id', 'string', [], []),
        `ヘッダ: gameId=${saved.header.gameId} compat=${saved.header.compat} qbRev=${saved.header.qbRev}`);
    const thumbLit = saved.thumb.some((v) => v > 0);
    chk(saved.thumb.length === SF.THUMB_W * SF.THUMB_H * 3 && thumbLit, `縮小画像 ${SF.THUMB_W}x${SF.THUMB_H} (真っ黒でない)`);

    // ---- 2. 大きさと時間 ----
    const raw = await SF.decode(saved.bytes);
    console.log(`[2] 大きさ: 保存ファイル ${(saved.bytes.length / 1024).toFixed(1)} KB (展開前 NP2K ${(raw.snap.np2k.length / 1048576).toFixed(1)} MB・` +
        `QBST ${(raw.snap.qbst.length / 1024).toFixed(1)} KB・/run ${raw.snap.files.length} 件) / 時間: save ${tSave.toFixed(0)} ms・load ${tLoad.toFixed(0)} ms`);

    // ---- 3. 互換識別子の違うセーブは断る ----
    console.log('[3] 互換識別子');
    const C = await idle();
    const before3 = view(C);
    const other = await SF.encode(Object.assign({}, raw.header, { compat: 'np2kai-000000000000+p0000000000000000' }), raw.thumb, raw.snap);
    const r3 = await C.stateLoad(other);
    chk(!r3.ok && r3.reason === 'version', `違う互換識別子は reason=version で断る (${r3.reason}: ${r3.detail})`);
    chk(view(C) === before3, '断ったとき状態に触らない');

    // ---- 4. 適用の途中で失敗したら戻す ----
    console.log('[4] 失敗時の巻き戻し');
    const D = await idle();
    D.runFrames(5);
    const before4 = view(D);
    const qbBad = new Uint8Array(raw.snap.qbst);
    const di = Buffer.from(qbBad).indexOf('DI21');
    qbBad[di] = 0x58;   // 'DI21' → 'XI21' = QuuBee 区画の DOS 区画が見つからない (NP2kai 区画は通る)
    const bad = await SF.encode(raw.header, raw.thumb, Object.assign({}, raw.snap, { qbst: qbBad }));
    const r4 = await D.stateLoad(bad);
    chk(!r4.ok && r4.reason === 'failed', `QuuBee 区画の失敗は reason=failed (${r4.reason}: ${r4.detail})`);
    chk(view(D) === before4, '読み込み前の状態に戻っている (画面・カウンタ)');
    D.runFrames(3);
    chk(D.M.FS.readdir('/run').includes('IDLE.COM') && !D.M.FS.readdir('/run').includes('T.COM'), '/run も読み込み前に戻っている');

    // ---- 5. 元に戻す ----
    console.log('[5] 元に戻す');
    const E = await idle();
    E.runFrames(5);
    const before5 = view(E);
    const r5 = await E.stateLoad(saved.bytes);
    const loaded5 = view(E);
    const back = SF.restore(E.stateAdapter(), r5.undo);
    chk(r5.ok && loaded5 !== before5, '読み込みで状態が変わった');
    chk(back.ok && view(E) === before5 && E.M.FS.readdir('/run').includes('IDLE.COM'), `元に戻すで読み込み前の状態 (${back.detail})`);

    // ---- 6. ゲームの識別子 ----
    console.log('[6] ゲームの識別子');
    const g1 = await SF.gameId('RUN.BAT', new Uint8Array([1, 2, 3]));
    const g2 = await SF.gameId('run.bat', new Uint8Array([1, 2, 3]));
    const g3 = await SF.gameId('RUN.BAT', new Uint8Array([1, 2, 4]));
    chk(g1 === g2 && g1 !== g3 && /^[0-9a-f]{16}$/.test(g1), `同じ入力で同じ (大小文字は無視)・違う入力で違う (${g1} / ${g3})`);

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\nstatesave_file_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
