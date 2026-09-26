#!/usr/bin/env node
// statesave_dos_test.js — ステートセーブの HLE-DOS 区画 (段階 B) を場面ごとに試す一致テスト。
//
// 各場面で A = そのまま走らせる / B = A と同じフレームでセーブ → 別モジュールを**無関係の IDLE.COM**
// で起動してロード → 同じ続き (同じフレームで同じキー) を走らせ、結果を比べる。B を A と同じプログラムで
// 起動すると、ロード前の 1 フレームで同じ XMS 確保や TSR 常駐まで済んで偶然一致してしまう (2026-09-27、
// QuuBee 区画を読まない版で X・R が通ったことで判明) ので、B は別のセッションから読み込む形にする。セーブ時点の /run の中身も B に写す
// (本番の保存形式 = 段階 E と同じく /run を巻き戻す)。A と B がそろって失敗して一致するのを防ぐため、
// A 自身の期待値 (書いたバイト数・表示された文字列など) も確かめる。
//
// 場面 (COM のソースと組み直し手順は tools/statesave_dos/):
//   W  書き込み用に開いたファイル (w+b) に毎フレーム 1 バイト → 位置とフラッシュ、/run の受け渡し
//   F  FindFirst/FindNext の途中 → 読み進めた件数から開き直して続きの名前
//   L  AH=0Ah の行入力を打ちかけ (キー待ちの再ポーリング中) → 続きの打鍵で同じ行
//   X  XMS に確保して書いたデータ → ハンドル表 + 拡張メモリ (NP2kai 区画) から読み戻せる
//   R  バッチ TSR.COM → CHILD.COM → ECHO の子の実行中 → EXEC スタック・常駐・バッチの続き
//
// 使い方: node tools/statesave_dos_test.js [filter]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine, NKEY } = require('./lib/machine');

const COM_DIR = path.join(__dirname, 'statesave_dos');
const com = (n) => fs.readFileSync(path.join(COM_DIR, n));

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

const SCENES = [
    {
        id: 'W', files: { 'W.COM': com('W.COM') }, bat: 'W.COM\r\n', save: 200, end: 800,
        check(A, B) {
            const a = A.readRun('OUT.TXT'), b = B.readRun('OUT.TXT');
            chk(a && a.length === 600, `A: OUT.TXT が 600 バイト (${a && a.length})`);
            chk(a && b && Buffer.compare(a, b) === 0, 'OUT.TXT の中身が A と B で一致 (書き込みハンドルの位置・フラッシュ・/run の受け渡し)');
        },
    },
    {
        id: 'F', save: 140, end: 520,
        files: Object.fromEntries([['F.COM', com('F.COM')],
            ...['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8'].map((n) => [`${n}.DAT`, Buffer.from(n)])]),
        bat: 'F.COM\r\n',
        check(A, B) {
            const rowsA = A.text.slice(1, 10).map((r) => r.trim()), rowsB = B.text.slice(1, 10).map((r) => r.trim());
            chk(rowsA.filter((r) => /\.DAT$/.test(r)).length === 8 && A.text[0][0] === 'E',
                `A: 8 件すべて表示して終了 (${rowsA.join(',')})`);
            chk(JSON.stringify(rowsA) === JSON.stringify(rowsB), `FindNext の続きが一致 (B: ${rowsB.join(',')})`);
        },
    },
    {
        id: 'L', files: { 'L.COM': com('L.COM') }, bat: 'L.COM\r\n', save: 150, end: 260,
        keys: { 100: 'A', 120: 'B', 160: 'C', 180: 'D', 200: 'RETURN' },
        check(A, B) {
            chk(A.text[5].trim() === 'abcd#', `A: 行入力が "abcd" (シフトなしの打鍵) (${JSON.stringify(A.text[5].trim())})`);
            chk(A.text[5] === B.text[5], `打ちかけからの続きが一致 (B: ${JSON.stringify(B.text[5].trim())})`);
        },
    },
    {
        id: 'X', files: { 'X.COM': com('X.COM') }, bat: 'X.COM\r\n', save: 120, end: 400,
        check(A, B) {
            chk(A.text[3].trim() === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', `A: EMB から読み戻せた (${JSON.stringify(A.text[3].trim())})`);
            chk(A.text[3] === B.text[3], `B も同じく読み戻せた (${JSON.stringify(B.text[3].trim())})`);
        },
    },
    {
        id: 'R', files: { 'TSR.COM': com('TSR.COM'), 'CHILD.COM': com('CHILD.COM') },
        bat: 'TSR.COM\r\nCHILD.COM\r\nECHO DONE\r\n', save: 150, end: 600,
        check(A, B, st) {
            const all = (m) => m.text.join('\n');
            const atSave = parseInt(st.text[2].slice(0, 4), 16);
            chk(atSave > 0 && atSave < 300, `A: セーブは子の実行中 (その時点の呼び出し回数 ${atSave})`);
            chk(A.text[2].startsWith('012C') && /DONE/.test(all(A)) && A.batchDone,
                `A: 子が 300 回呼んで終わり、バッチが ECHO まで進んだ (row2=${A.text[2].slice(0, 4)} batchDone=${A.batchDone})`);
            chk(all(A) === all(B) && A.batchDone === B.batchDone, `テキスト画面とバッチの終了が一致 (B row2=${B.text[2].slice(0, 4)} batchDone=${B.batchDone})`);
        },
    },
];

function runTo(m, end, keys) {
    while (m.frame < end) {
        if (keys && keys[m.frame]) m.pressKey(NKEY[keys[m.frame]]);
        m.runFrames(1);
    }
}

function listRun(M) {
    return M.FS.readdir('/run').filter((n) => n !== '.' && n !== '..' && M.FS.isFile(M.FS.stat('/run/' + n).mode));
}

function saveState(m) {
    const r = {
        np2: m.M.ccall('np2kai_state_np2_save', 'number', ['string'], ['/tmp/s.np2']),
        busy: m.M.ccall('np2kai_state_qb_busy', 'number', [], []),
        qb: m.M.ccall('np2kai_state_qb_save', 'number', ['string'], ['/tmp/s.qb']),
    };
    r.np2Blob = m.M.FS.readFile('/tmp/s.np2');
    r.qbBlob = m.M.FS.readFile('/tmp/s.qb');
    r.run = listRun(m.M).map((n) => [n, m.M.FS.readFile('/run/' + n)]);   // qb_save が fflush 済み
    r.frame = m.frame; r.produced = m.produced;
    r.text = m.textVram();
    return r;
}

function loadState(m, s) {
    for (const n of listRun(m.M)) m.M.FS.unlink('/run/' + n);          // /run を巻き戻す (セーブ時の順で作り直す)
    for (const [n, d] of s.run) m.M.FS.writeFile('/run/' + n, d);
    m.M.FS.writeFile('/tmp/s.np2', s.np2Blob);
    m.M.FS.writeFile('/tmp/s.qb', s.qbBlob);
    const r = {
        np2: m.M.ccall('np2kai_state_np2_load', 'number', ['string'], ['/tmp/s.np2']),
        qb: m.M.ccall('np2kai_state_qb_load', 'number', ['string'], ['/tmp/s.qb']),
    };
    m.frame = s.frame; m.produced = s.produced;
    return r;
}

function outcome(m) {
    return {
        text: m.textVram(), screen: m.screenHash(), batchDone: m.batchDone(),
        readRun: (n) => { try { return Buffer.from(m.M.FS.readFile('/run/' + n)); } catch (_) { return null; } },
    };
}

(async () => {
    const filter = process.argv[2];
    for (const sc of SCENES) {
        if (filter && !sc.id.includes(filter)) continue;
        console.log(`[${sc.id}]`);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_dos_'));
        for (const [n, d] of Object.entries(sc.files)) fs.writeFileSync(path.join(dir, n), d);
        fs.writeFileSync(path.join(dir, 'RUN.BAT'), sc.bat);

        const A = await Machine.boot({ dir, bat: 'RUN.BAT' });
        runTo(A, sc.save, sc.keys);
        const st = saveState(A);
        runTo(A, sc.end, sc.keys);

        const idle = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_idle_'));
        fs.writeFileSync(path.join(idle, 'IDLE.COM'), Buffer.from([0xEB, 0xFE]));   // jmp $
        fs.writeFileSync(path.join(idle, 'IDLE.BAT'), 'IDLE.COM\r\n');
        const B = await Machine.boot({ dir: idle, bat: 'IDLE.BAT' });
        B.runFrames(1);
        const ld = loadState(B, st);
        runTo(B, sc.end, sc.keys);

        chk(st.np2 === 0 && st.busy === 0 && st.qb === 0 && ld.np2 === 0 && ld.qb === 0,
            `保存・読み込みが成功 (np2 ${st.np2}/${ld.np2}, qb ${st.qb}/${ld.qb}, busy ${st.busy}, /run ${st.run.length} 件)`);
        const oa = outcome(A), ob = outcome(B);
        sc.check(oa, ob, st);
        chk(oa.screen === ob.screen, `画面ハッシュが一致 (${oa.screen.toString(16)} / ${ob.screen.toString(16)})`);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(idle, { recursive: true, force: true });
    }
    console.log(`\nstatesave_dos_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
