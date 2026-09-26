#!/usr/bin/env node
// statesave_touhou_test.js — 東方旧作 4 作 (TH02〜05 体験版) の場面でのステートセーブの一致テスト (フェーズ 2 段階 F)。
//
// 各作を公式配布書庫から展開 (TH02 = LZH、TH03〜05 = 自己展開 .exe をゲスト内で実行) し、実 GAME.BAT を
// ブラウザと同じ経路で起動、決まった入力でタイトル → ステージへ進める。A は 1 回の起動で最後まで走らせ、途中の
// 各場面で保存ファイル (web/player/statefmt.js) を作る。場面ごとに B = 無関係の IDLE セッションを起動して読み込み、
// 同じ入力で続き TAIL フレームを走らせ、A の同じ区間と比べる:
//   FM の場面: テキスト VRAM・画面ハッシュ・音声 (全区間 1 サンプルも違わない)
//   TH02 の MIDI(MPU) の場面 (ちびおと構成・MUSIC=MIDI): 合成器の内部は保存しない (MIDI の控えを送り直す) ので
//     音声のビット一致は求めない。画面が一致し、続きの時点で合成器のチャンネル設定が一致し、MIDI が鳴っていること
//
// 場面は無入力で届く範囲: タイトル (BGM)・ステージ開始の直後 (切り替わり)・敵と弾の多い場面・ゲームオーバー。
// ボス戦は無入力では手前でゲームオーバーになるので、ブラウザでの実プレイで確かめる。
// キーを押して 6 フレーム以内 (押しっぱなしの最中) でセーブすると B 側でキーの離しが起きずに食い違うので避ける。
//
// 素材 games/touhou/ は再配布不可 (ローカル限定)。無ければ SKIP。
// 使い方: node tools/statesave_touhou_test.js [filter]   (filter = "th03" 等)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine, NKEY } = require('./lib/machine');
const archive = require('../web/player/archive.js');

const TOUHOU = path.join(__dirname, '..', 'games', 'touhou');
if (!fs.existsSync(TOUHOU)) { console.log('SKIP — games/touhou 不在 (ローカル限定)'); process.exit(0); }
const HAS_SF2 = fs.existsSync(path.join(__dirname, '..', 'web', 'assets', 'soundfont.sf2'));

const TAIL = 400;
const R = (f) => ['RETURN', f], Z = (f) => ['Z', f], D = (f) => ['DOWN', f], RT = (f) => ['RIGHT', f];
const GAMES = [
    { id: 'th02', file: 'huma_ts2.lzh', keys: [R(1300), R(1550), R(1800)],
      scenes: { 'タイトル': 1200, 'ステージ開始直後': 1830, '敵の多い場面': 3500, 'ゲームオーバー': 5200 } },
    { id: 'th03', file: 'yume_ts2.exe', keys: [R(1300), R(1550), Z(1800), Z(2050), Z(2300), R(2550), Z(2800)],
      scenes: { 'タイトル': 1450, '対戦開始直後': 2180, '弾の多い場面': 3400 } },
    { id: 'th04', file: 'gen_ts1.exe', keys: [R(1300), R(1550), R(1800), R(2050), R(2300), R(2550), R(2800)],
      scenes: { 'タイトル': 2200, 'ステージ開始直後': 3100, '弾の多い場面': 5000, 'ゲームオーバー': 6600 } },
    { id: 'th05', file: 'kai_ts1.exe', keys: [R(1300), R(1550), R(1800), R(2050), R(2300), R(2550)],
      scenes: { 'タイトル': 2250, 'ステージ開始直後': 2950, '弾の多い場面': 4000, 'ゲームオーバー': 5600 } },
    // TH02 の MIDI(MPU): ちびおと構成 + MIDI 有効で起動し、OPTION で MUSIC を MIDI に (tools/th02_midi_probe.js と同じ手順)
    { id: 'th02-midi', base: 'th02', file: 'huma_ts2.lzh', soundboard: 'adpcm', midi: true,
      keys: [D(1520), D(1560), R(1600), D(1720), RT(1760)],
      scenes: { 'OPTION で MIDI 演奏中': 2000 } },
];

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

// ---- 展開 ----
async function extract(g, dst) {
    const src = fs.readFileSync(path.join(TOUHOU, g.file));
    const put = (name, data) => fs.writeFileSync(Buffer.concat([Buffer.from(dst + '/'), Buffer.from(name, 'latin1')]), data);
    if (g.file.endsWith('.lzh')) {
        for (const e of archive.parseLzh(new Uint8Array(src))) {
            const base = e.data && e.name.split(/[\\/]/).pop();
            if (base) put(base, e.data);
        }
        return;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'th_sfx_'));
    const up = g.file.toUpperCase();
    fs.writeFileSync(path.join(tmp, up), src);
    fs.writeFileSync(path.join(tmp, 'X.BAT'), up + '\r\n');
    const m = await Machine.boot({ dir: tmp, bat: 'X.BAT' });
    const press = new Map([[600, 'Y'], [900, 'RETURN'], [1500, 'Y'], [1800, 'RETURN'], [2400, 'Y'], [2700, 'RETURN']]);
    for (let f = 0; f < 6000 && !m.exited() && !m.batchDone(); f++) { if (press.has(f)) m.pressKey(NKEY[press.get(f)], 4); m.runFrames(1); }
    for (const n of m.M.FS.readdir('/run')) {
        if (n === '.' || n === '..' || n === up || n === 'X.BAT') continue;
        if (m.M.FS.isFile(m.M.FS.stat('/run/' + n).mode)) put(n, m.M.FS.readFile('/run/' + n));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- 走らせる (キーは絶対フレームで。A も B も同じ表で押す) ----
function stepTo(m, end, keys, onFrame) {
    while (m.frame < end) {
        const k = keys.get(m.frame);
        if (k) m.pressKey(NKEY[k]);
        m.runFrames(1);
        if (onFrame) onFrame(m);
    }
}
function midiState(m) {
    const q = (h, ch, w) => m.M.ccall('np2kai_debug_midi_ch', 'number', ['number', 'number', 'number'], [h, ch, w]);
    // ハンドルは作成順でなく役割 (1=MPU 2=シリアル) で並べる (statsave のロードで作り直され順番が変わる)
    const n = q(0, 0, -1), hs = [];
    for (let h = 0; h < n; h++) hs.push({ h, role: q(h, 0, -2) });
    hs.sort((a, b) => a.role - b.role);
    // 比べるのは TH02 の MIDI が実際に流れる MPU (役割 1) だけ。RS-MIDI (シリアル) のハンドルはロード後に
    // 作り直されて控えが届かないことがある (TODO「フェーズ 2」に記録。TH02 の音には影響しない)
    const out = [];
    for (const { h } of hs.filter((x) => x.role === 1)) for (let ch = 0; ch < 16; ch++) out.push([0, 1, 2, 3, 4].map((w) => q(h, ch, w)).join(','));
    return out.join('|');
}
function midiDiff(a, b) {   // "h,ch: A の値 → B の値" (音色,バンク,音量,パン,ベンド幅)
    const x = a.split('|'), y = b.split('|'), out = [];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(`h${i >> 4}c${i & 15}: ${x[i]} → ${y[i]}`);
    return out.slice(0, 6).join(' / ');
}
function samePcm(a, b) { if (a.length !== b.length) return -2; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i >> 1; return -1; }
function rms(p) { let s = 0; for (const v of p) s += v * v; return Math.sqrt(s / Math.max(1, p.length)); }

async function idleMachine(opts) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'th_idle_'));
    fs.writeFileSync(path.join(d, 'IDLE.COM'), Buffer.from([0xEB, 0xFE]));
    fs.writeFileSync(path.join(d, 'IDLE.BAT'), 'IDLE.COM\r\n');
    const m = await Machine.boot(Object.assign({ dir: d, bat: 'IDLE.BAT' }, opts));
    m.runFrames(1);
    return m;
}

async function runGame(g, dir) {
    const bat = fs.readdirSync(dir).find((n) => n.toLowerCase() === 'game.bat');
    const opts = { soundboard: g.soundboard || 'matex', midi: !!g.midi };
    const keys = new Map(g.keys.map(([k, f]) => [f, k]));
    const scenes = Object.entries(g.scenes).sort((a, b) => a[1] - b[1]);
    const lastEnd = scenes[scenes.length - 1][1] + TAIL;

    // A: 1 回の起動で最後まで。音声は全部取っておき、場面ごとの区間を produced の位置で切り出す
    const A = await Machine.boot(Object.assign({ dir, bat }, opts));
    A._capture = [];
    const saves = [], ends = new Map();
    for (const [name, at] of scenes) {
        stepTo(A, at, keys, (m) => { const e = ends.get(m.frame); if (e) e(m); });
        const s = await A.stateSave({ gameId: g.id });
        if (!s.ok) { chk(false, `${g.id} ${name}: セーブに失敗 (${s.reason} ${s.detail || ''})`); continue; }
        const rec = { name, at, bytes: s.bytes, frame: A.frame, produced: A.produced };
        ends.set(at + TAIL, (m) => {
            rec.endProduced = m.produced;
            rec.text = m.textVram().join('\n'); rec.screen = m.screenHash();
            if (g.midi) rec.midi = midiState(m);
        });
        saves.push(rec);
    }
    stepTo(A, lastEnd, keys, (m) => { const e = ends.get(m.frame); if (e) e(m); });
    const pcmA = new Int16Array(A._capture.reduce((n, c) => n + c.length, 0));
    { let o = 0; for (const c of A._capture) { pcmA.set(c, o); o += c.length; } }
    A._capture = null;

    for (const rec of saves) {
        const B = await idleMachine(opts);
        const ld = await B.stateLoad(rec.bytes);
        B.frame = rec.frame; B.produced = rec.produced;
        B._capture = [];
        stepTo(B, rec.at + TAIL, keys);
        const pcmB = new Int16Array(B._capture.reduce((n, c) => n + c.length, 0));
        { let o = 0; for (const c of B._capture) { pcmB.set(c, o); o += c.length; } }
        B._capture = null;
        const aWin = pcmA.subarray(rec.produced * 2, rec.endProduced * 2);
        const sameScreen = B.textVram().join('\n') === rec.text && B.screenHash() === rec.screen;
        const label = `${g.id} ${rec.name} (frame ${rec.at}, ${(rec.bytes.length / 1024).toFixed(0)} KB)`;
        if (!ld.ok) { chk(false, `${label}: 読み込みに失敗 (${ld.reason} ${ld.detail || ''})`); continue; }
        if (!g.midi) {
            const d = samePcm(aWin, pcmB);
            chk(sameScreen && d === -1, `${label}: 続き ${TAIL} フレームの画面・音声が一致` +
                (sameScreen ? '' : ' [画面が違う]') + (d === -1 ? '' : ` [音声が ${d === -2 ? '長さ' : d + ' サンプル目'} から違う]`));
        } else {
            const midiB = midiState(B);
            const r = rms(pcmB.subarray(pcmB.length >> 1));
            chk(sameScreen && midiB === rec.midi && r > 100,
                `${label}: 画面が一致・合成器のチャンネル設定が一致・MIDI が鳴り続ける (後半の rms ${r.toFixed(0)})` +
                (sameScreen ? '' : ' [画面が違う]') + (midiB === rec.midi ? '' : ' [チャンネル設定が違う: ' + midiDiff(rec.midi, midiB) + ']'));
        }
    }
}

(async () => {
    const filter = process.argv[2];
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_touhou_'));
    const dirs = {};
    for (const g of GAMES) {
        if (filter && !g.id.includes(filter)) continue;
        if (!fs.existsSync(path.join(TOUHOU, g.file))) { console.log(`${g.id}: SKIP (${g.file} 不在)`); continue; }
        if (g.midi && !HAS_SF2) { console.log(`${g.id}: SKIP (soundfont.sf2 不在)`); continue; }
        const base = g.base || g.id;
        if (!dirs[base]) { dirs[base] = path.join(work, base); fs.mkdirSync(dirs[base]); await extract(g, dirs[base]); }
        const t0 = Date.now();
        console.log(`[${g.id}]`);
        await runGame(g, dirs[base]);
        console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\nstatesave_touhou_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
