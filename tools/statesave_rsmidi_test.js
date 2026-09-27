#!/usr/bin/env node
// statesave_rsmidi_test.js — ステートセーブと RS-MIDI (シリアル) の検証。題材は TW212 の TWMIDI.BAT
// (MIDDRV -X1 = RS-MIDI。tools/midi_serial_test.js と同じ)。
//
// A: タイトルを送って曲が鳴っているところでセーブ (保存ファイル = web/player/statefmt.js)。
// 次の 2 つのセッションへ読み込み、合成器のチャンネル設定 (全ハンドル・全チャンネル) が A と一致し、
// その後も RS-MIDI のバイトが届いて鳴り続けることを確かめる:
//   B1: 起動時から MIDI 有効の無関係な IDLE セッション (普通のケース)
//   B2: MIDI 無効で起動し、ロードの直前に np2kai_enable_midi_now した IDLE セッション (ブラウザで MIDI を
//       鳴らしていたセーブを MIDI 未ロードのセッションで読む場合。bridge.js は読み込み前に合成器を用意する)
//
// B2 は破棄済みの MIDI ハンドルの use-after-free の回帰: statsave のロードは sound_reset の後で
// mpu98ii_reset が MIDI ハンドルを作り、COM 区画がそれを破棄して作り直す。破棄したハンドルは音声
// ストリームに登録されたまま残るので、すぐ解放すると解放済みメモリを読み書きする (ASan で確認)。
// B2 の順序ではヒープが壊れて opna_sfload の malloc が戻らなくなっていた (= このテストがタイムアウト)。
// 今は qb_tsf.c が解放を次の soundmng_reset まで遅らせる。
//
// ローカル限定: TW212.LZH・soundfont.sf2 が無ければ SKIP。
// 使い方: node tools/statesave_rsmidi_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { Machine } = require('./lib/machine');

const ROOT = path.join(__dirname, '..');
const GAME_LZH = path.join(ROOT, 'games', 'bio_100', 'TW212.LZH');
const SF2 = path.join(ROOT, 'web', 'assets', 'soundfont.sf2');
if (!fs.existsSync(GAME_LZH)) { console.log('SKIP — TW212.LZH 不在 (ローカル限定テスト)'); process.exit(0); }
if (!fs.existsSync(SF2)) { console.log('SKIP — soundfont.sf2 不在 (tools/setup_soundfont.sh)'); process.exit(0); }

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

const WHAT = ['preset', 'bank', 'volume', 'pan', 'pitchrange', 'pitchwheel'];
function midiState(m) {    // キーは役割 (r1=MPU r2=シリアル) とチャンネル
    const q = (h, ch, w) => m.M.ccall('np2kai_debug_midi_ch', 'number', ['number', 'number', 'number'], [h, ch, w]);
    const out = {};
    for (let h = 0, n = q(0, 0, -1); h < n; h++) {
        const role = q(h, 0, -2);
        for (let ch = 0; ch < 16; ch++) out[`r${role}c${ch}`] = WHAT.map((_, w) => q(h, ch, w)).join(',');
    }
    return out;
}
const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
const serialBytes = (m) => m.M.ccall('np2kai_debug_serial_midi_bytes', 'number', ['number'], [m.h]) >>> 0;
const rms = (p) => { let s = 0; for (let i = 0; i < p.length; i++) s += p[i] * p[i]; return Math.sqrt(s / Math.max(1, p.length)); };
function tap(m, code) {
    m.M.ccall('np2kai_key_down', null, ['number', 'number'], [m.h, code]); m.runFrames(2);
    m.M.ccall('np2kai_key_up', null, ['number', 'number'], [m.h, code]);
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_rsmidi_'));
    try { cp.execSync(`lha xgw=${dir} "${GAME_LZH}"`, { stdio: 'ignore' }); }
    catch (_) { cp.execSync(`cd ${dir} && lhasa e "${GAME_LZH}"`, { stdio: 'ignore', shell: '/bin/bash' }); }
    const bat = fs.readdirSync(dir).find((f) => /^twmidi\.bat$/i.test(f));
    if (!bat) { console.log('SKIP — TWMIDI.BAT が無い'); process.exit(0); }
    const idle = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_idle_'));
    fs.writeFileSync(path.join(idle, 'IDLE.COM'), Buffer.from([0xEB, 0xFE]));
    fs.writeFileSync(path.join(idle, 'IDLE.BAT'), 'IDLE.COM\r\n');

    // A: タイトル送り (tools/midi_serial_test.js と同じ打鍵) の後、曲が鳴っているところでセーブ
    const A = await Machine.boot({ dir, bat, midi: true });
    for (let f = 0; f < 1200; f += 100) {
        A.runFrames(100);
        if (f === 300 || f === 700) tap(A, 0x1c);
        if (f === 500) tap(A, 0x34);
    }
    const stA = midiState(A);
    const serialSet = Object.entries(stA).filter(([k, v]) => k.startsWith('r2') && v.split(',')[0] !== '0').length;
    chk(serialBytes(A) > 0 && serialSet > 0, `A: RS-MIDI で鳴っている (シリアル ${serialBytes(A)} バイト・音色を設定したチャンネル ${serialSet})`);
    const saved = await A.stateSave({ gameId: 'tw212', settings: { midi: true } });
    chk(saved.ok, `A: セーブ (${saved.reason || ''})`);

    for (const late of [false, true]) {
        const label = late ? 'B2 (ロード直前に MIDI 有効化)' : 'B1 (起動時から MIDI 有効)';
        console.log(`[${label}]`);
        const B = await Machine.boot({ dir: idle, bat: 'IDLE.BAT', midi: !late });
        B.runFrames(1);
        if (late) {
            B.M.FS.writeFile('/tmp/soundfont.sf2', new Uint8Array(fs.readFileSync(SF2)));
            chk(B.M.ccall('np2kai_enable_midi_now', 'number', ['number'], [B.h]) === 1, 'enable_midi_now');
        }
        const before = midiState(B);
        const r = await B.stateLoad(saved.bytes);
        chk(r.ok, `読み込みが成功 (${r.reason || ''} ${r.detail || ''})`);
        const d0 = diff(stA, midiState(B));
        chk(diff(stA, before).length > 0 && d0.length === 0,
            `読み込み直後の合成器のチャンネル設定が A と一致 (${Object.keys(stA).length} 項目${d0.length ? '・違う: ' + d0.slice(0, 3).join(' ') : ''})`);
        const b0 = serialBytes(B);
        const pcm = B.captureAudio(6);
        chk(serialBytes(B) - b0 > 0 && rms(pcm) > 100,
            `その後も RS-MIDI が届いて鳴る (6 秒でシリアル ${serialBytes(B) - b0} バイト・RMS ${rms(pcm).toFixed(0)})`);
    }

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(idle, { recursive: true, force: true });
    console.log(`\nstatesave_rsmidi_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
