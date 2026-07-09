#!/usr/bin/env node
// Machine.snapshot() / Machine.restore() の忠実性を falsify する。
//
// 主張: Wasm の線形メモリ + MEMFS + JS が握るポインタだけで、エミュレータと HLE-DOS の全状態が
//       復元できる。ならば「連続して走らせた続き」と「snapshot を別モジュールへ復元した続き」は
//       画面・INT 21h カウンタ・音声まで完全に一致するはずである。
//
// 一致しなければ snapshot は使いものにならない (暖機を消せない = 土台の価値が半減する)。
// 「たぶん合っている」ではなく、最も差が出る一点 (音声の中身のハッシュ) まで比べる。
//
// 使い方: node tools/snapshot_test.js [ゲームディレクトリ]
//   省略時は ~/suika3_audio/suika3-D-final.zip を展開したものを探す。無ければ SKIP。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Machine, NKEY } = require('./lib/machine');

const WARM = 1500;      // 暖機 (グラフィック画面 + BGM 再生まで)
const TAIL = 300;       // snapshot 後に走らせる長さ
const AUDIO_SEC = 1.0;  // 比較に使う音声の長さ

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }

const dir = process.argv[2] || path.join(os.homedir(), 'suika3_audio', 'game-d');
if (!fs.existsSync(dir)) skip(`ゲームディレクトリが無い: ${dir}`);
if (!fs.existsSync(path.join(__dirname, '..', 'web', 'np2kai_core.wasm'))) skip('wasm 未ビルド');

let fails = 0;
const ok = (cond, what, got) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${got !== undefined ? ` (${got})` : ''}`);
    if (!cond) fails++;
};
const sha = (buf) => crypto.createHash('sha256').update(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)).digest('hex').slice(0, 12);

// 決定論的な入力: Enter を 2 回だけ (連打するとエッジが立たず進まないエンジンがある)
function drive(m, frames) {
    for (let i = 0; i < frames; i++) {
        if (m.frame === 500 || m.frame === 1200) m.pressKey(NKEY.RETURN, 6);
        m.runFrames(1);
    }
}

// snapshot 後に走らせる「続き」。両者に同じ手順を適用する。
function tail(m) {
    m.runFrames(TAIL);
    const pcm = m.captureAudio(AUDIO_SEC);
    let rms = 0;
    for (let i = 0; i < pcm.length; i++) rms += pcm[i] * pcm[i];
    return {
        screen: m.screenHash(),
        kbhit: m.int21(0x0b),
        getch: m.int21(0x08),
        frame: m.frame,
        audioSha: sha(pcm),
        audioRms: Math.round(Math.sqrt(rms / pcm.length)),
        text: m.textVram().join('\n'),
    };
}

(async () => {
    console.log(`ゲーム: ${dir}`);

    // ---- 基準: 連続して走らせる ----
    const t0 = Date.now();
    const a = await Machine.boot({ dir, multiple: 20 });
    console.log(`wasm: ${a.info().wasm.sha256} (${a.info().wasm.mtime})`);
    drive(a, WARM);
    const warmMs = Date.now() - t0;
    const snap = a.snapshot();
    const refA0Screen = a.screenHash();     // snapshot を取った瞬間の画面 (復元直後と突き合わせる)
    const blob = Machine.serialize(snap);
    const refA = tail(a);
    ok(refA.audioRms > 100, '暖機後に音が鳴っている (鳴っていないと比較の意味が薄い)', `RMS ${refA.audioRms}`);

    // ---- 直列化 → 逆直列化 (ディスク往復と同じ経路) ----
    const tmp = path.join(os.tmpdir(), `qbsn_${process.pid}.qbsn`);
    fs.writeFileSync(tmp, blob);
    const reloaded = fs.readFileSync(tmp);
    ok(reloaded.length === blob.length, 'snapshot がディスクを往復する', `${(blob.length / 1048576).toFixed(1)} MiB`);

    // ---- 検証: 新しいモジュールへ復元して同じ続きを走らせる ----
    const t1 = Date.now();
    const b = await Machine.restore(reloaded);
    const restoreMs = Date.now() - t1;
    fs.unlinkSync(tmp);
    ok(b.frame === WARM, '復元直後のフレーム番号が一致する', `${b.frame}`);
    ok(b.screenHash() === refA0Screen, '復元直後の画面が snapshot 時点と一致する');
    const refB = tail(b);

    ok(refA.frame === refB.frame, 'フレーム番号が一致', `${refA.frame}`);
    ok(refA.screen === refB.screen, '画面 (全画素ハッシュ) が一致', `0x${refA.screen.toString(16)}`);
    ok(refA.kbhit === refB.kbhit && refA.getch === refB.getch, 'INT 21h カウンタが一致', `kbhit=${refA.kbhit} getch=${refA.getch}`);
    ok(refA.text === refB.text, 'テキスト VRAM が一致');
    ok(refA.audioSha === refB.audioSha, '**音声の中身が 1 サンプルまで一致**', refA.audioSha);

    // ---- 復元の再現性: 同じ snapshot から 2 度復元しても同じ ----
    const c = await Machine.restore(blob);
    const refC = tail(c);
    ok(refC.audioSha === refA.audioSha && refC.screen === refA.screen, '同じ snapshot から何度でも同じ続きになる');

    // ---- 素性が違う snapshot は拒む (関数テーブルの索引はビルド固有) ----
    const bad = Machine.deserialize(blob);
    bad.meta.wasm = { ...bad.meta.wasm, sha256: 'deadbeefdeadbeef' };
    let rejected = false;
    try { await Machine.restore(Machine.serialize({ ...bad, files: bad.files })); }
    catch (e) { rejected = /wasm が違う/.test(e.message); }
    ok(rejected, 'wasm の SHA が違う snapshot は復元を拒否する');

    console.log(`\n暖機 (boot + ${WARM} フレーム) = ${(warmMs / 1000).toFixed(1)}s / 復元 = ${(restoreMs / 1000).toFixed(2)}s` +
                `  → ${(warmMs / restoreMs).toFixed(0)} 倍速で「バグの直前」に戻れる`);
    console.log(fails === 0
        ? `PASS — snapshot は忠実 (画面・テキスト・INT21・音声が 1 サンプルまで一致)`
        : `FAIL — ${fails} 件`);
    process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
