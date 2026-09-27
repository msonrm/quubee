#!/usr/bin/env node
// dos_ext_calls_test.js — INT 21h AH=6Ch (拡張オープン)・59h (拡張エラー)・65h (拡張国別情報) と、
// 純正 COMMAND.COM 流のリダイレクトの需要計測 (NUL 装置を開く・標準ハンドルへ DUP2) の回帰 (2026-09-27)。
//
// きっかけ = GitHub Issue #6: 純正 MS-DOS 6.2 の COMMAND.COM で TYPE が AH=6Ch で失敗し、理由を AH=59h で
// 訊いても未対応で "Extended Error 1" になっていた (起動のたびに AH=65h AL=04 も呼ぶ)。
// EXT.COM (ソースは下のコメント) が 6Ch の各処置・59h・65h を呼んで結果を RES.BIN に書き、ここで検める。
// 使い方: node tools/dos_ext_calls_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine } = require('./lib/machine');

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

// EXT.COM (nasm):
//   [0] 6Ch DX=11h (あれば開く・無ければ作る) を NEW.TXT に → 作った (CX=2)
//   [1] 同じ → 開いた (CX=1)   [2] DX=12h (あれば置き換える) → CX=3
//   [3] DX=10h (あれば失敗) → CF=1 AX=50h   [4] 無い NONE.TXT に DX=01h → CF=1 AX=2
//   [5] 59h → AX=2 BH=8 (not found) BL=3 (user) CH=2 (block device)
//   [6] 65h AL=01 CX=41 → CF=0 CX=41 [id=1][38][country 81][code page 932]
//   [7] 65h AL=04 → [id=4][far ptr] → 表の長さ 80h   [8] 65h AL=20h DL='a' → 'A'
//   [9] 65h AL=23h DL='Y'/'n'/'?' → 1/0/2
// 各 [0]〜[4] は CF(1) AX(2) CX(2) の 5 バイトで記録
const EXT = Buffer.from('fcbf6202be1902bb020031c9ba1100b8006ccd21e8f20089c3b43ecd21be1902bb020031c9ba1100b8006ccd21e8d90089c3b43ecd21be1902bb020031c9ba1200b8006ccd21e8c00089c3b43ecd21be1902bb020031c9ba1000b8006ccd21e8a700be2102bb000031c9ba0100b8006ccd21e8940031dbb459cd21ab89d8ab88e8aa57bf3202b92900bbffffbaffffb80165cd215f9c582401aa89c8abbe3202b90700f3a457bf3202b90500bbffffbaffffb80465cd215fa03202aa1ec5363302ad1fabb261b82065cd2188d0aab259b82365cd21aab26eb82365cd21aab23fb82365cd21aa89f981e9620251b43c31c9ba2a02cd2189c359b440ba6202cd21b43ecd21b8004ccd219c509c582401aa58ab5089c8ab589dc34e45572e545854004e4f4e452e545854005245532e42494e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', 'hex');
// PROBE.COM: DATA.TXT を開いてハンドル 1 へ DUP2 (未対応で失敗するが数える)、NUL を開く (数える)
const PROBE = Buffer.from('b8003dba1e01cd2189c3b90100b446cd21b8003dba2701cd21b8004ccd21444154412e545854004e554c00', 'hex');

function mkdir(files) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dosext_'));
    for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(d, n), v);
    return d;
}

(async () => {
    console.log('[1] AH=6Ch・59h・65h');
    const m = await Machine.boot({ dir: mkdir({ 'EXT.COM': EXT, 'T.BAT': 'EXT\r\n' }), bat: 'T.BAT' });
    m.runFrames(60);
    let r;
    try { r = Buffer.from(m.M.FS.readFile('/run/RES.BIN')); } catch (_) { r = null; }
    chk(r && r.length === 47, `RES.BIN が書かれた (${r ? r.length : 0} バイト)`);
    if (r) {
        const rec = (i) => ({ cf: r[i * 5], ax: r.readUInt16LE(i * 5 + 1), cx: r.readUInt16LE(i * 5 + 3) });
        chk(rec(0).cf === 0 && rec(0).cx === 2, `6Ch 無ければ作る → CX=2 (${JSON.stringify(rec(0))})`);
        chk(rec(1).cf === 0 && rec(1).cx === 1, `6Ch あれば開く → CX=1 (${JSON.stringify(rec(1))})`);
        chk(rec(2).cf === 0 && rec(2).cx === 3, `6Ch あれば置き換える → CX=3 (${JSON.stringify(rec(2))})`);
        chk(rec(3).cf === 1 && rec(3).ax === 0x50, `6Ch あれば失敗 → AX=50h (${JSON.stringify(rec(3))})`);
        chk(rec(4).cf === 1 && rec(4).ax === 2, `6Ch 無ければ失敗 → AX=2 (${JSON.stringify(rec(4))})`);
        chk(r.readUInt16LE(25) === 2 && r.readUInt16LE(27) === 0x0803 && r[29] === 2,
            `59h → AX=2 BX=0803h CH=2 (AX=${r.readUInt16LE(25)} BX=${r.readUInt16LE(27).toString(16)} CH=${r[29]})`);
        chk(r[30] === 0 && r.readUInt16LE(31) === 41 && r[33] === 1 && r.readUInt16LE(34) === 38 &&
            r.readUInt16LE(36) === 81 && r.readUInt16LE(38) === 932, '65h AL=01 国別情報 (日本 81・コードページ 932)');
        chk(r[40] === 4 && r.readUInt16LE(41) === 0x80, `65h AL=04 ファイル名大文字表 (id=${r[40]} 長さ=${r.readUInt16LE(41)})`);
        chk(r[43] === 0x41, '65h AL=20h 大文字化');
        chk(r[44] === 1 && r[45] === 0 && r[46] === 2, '65h AL=23h Y/N 判定');
    }

    console.log('[2] 需要の計測 (NUL を開く・標準ハンドルへ DUP2)');
    const p = await Machine.boot({ dir: mkdir({ 'PROBE.COM': PROBE, 'DATA.TXT': 'x', 'T.BAT': 'PROBE\r\n' }), bat: 'T.BAT' });
    p.runFrames(60);
    const sp = (i) => p.M.ccall('np2kai_debug_stdprobe', 'number', ['number'], [i]);
    chk(sp(0) === 1 && sp(1) === 1, `NUL 1 回・DUP2 1 回を数える (${sp(0)} / ${sp(1)})`);

    console.log(`\ndos_ext_calls_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
