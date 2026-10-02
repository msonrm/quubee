#!/usr/bin/env node
// dos_misc_calls_test.js — INT 21h AH=1Bh/1Ch・2Eh/54h・56h・5Ah/5Bh・66h・67h・68h/6Ah の回帰 (2026-10-02)。
//
// PC98PLAYER (別実装の HLE-DOS) との突き合わせで、QuuBee に無かった関数のうち実害の出うるものを足した:
//   56h Rename (一時ファイル→改名で保存する型) / 5Ah・5Bh (一時・排他作成) / 1Bh・1Ch (ドライブ情報。36h と同じ数字) /
//   54h・2Eh (ベリファイ フラグ) / 66h (コードページ 932 固定) / 67h (ハンドル数。上限超えは 4) / 68h・6Ah (fflush)。
// MISC.COM (ソース tools/dos_misc_calls/misc.asm) が各関数を呼んで結果を RES.BIN に書き、ここで検める。
// 使い方: node tools/dos_misc_calls_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine } = require('./lib/machine');

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

const MISC = Buffer.from('fcbfa803ba3a0331c9b43ccd2189c3b43ecd21ba460331c9b43ccd2189c3b43ecd21ba3a03893e6603bf4003b456cd218b3e66039c5a80e201881589450183c703ba3a03893e6603bf4003b456cd218b3e66039c5a80e201881589450183c703ba4003893e6603bf4603b456cd218b3e66039c5a80e201881589450183c703ba4003893e6603bf5203b456cd218b3e66039c5a80e201881589450183c703ba460331c9b45bcd219c5a80e201881589450183c703ba4c0331c9b45bcd2189c59c5a80e201881589450183c70389ebb468cd219c5a80e201881589450183c70389ebb46acd219c5a80e201881589450183c703bb6300b468cd219c5a80e201881589450183c70389ebb43ecd21c606680300ba680331c9b45acd219c5a80e201881589450183c70389c3b43ecd21be6803b90800f3a4b8012ecd21b454cd21b4009c5a80e201881589450183c703b8002ecd21b454cd21b4009c5a80e201881589450183c703b80166cd2189d589d89c5a80e201881589450183c703892d83c702b80266bbb501cd219c5a80e201881589450183c703b80266bba403cd219c5a80e201881589450183c703b467bb1400cd219c5a80e201881589450183c703b467bbf401cd219c5a80e201881589450183c703b41bcd2126880526894d01268955038a07268845050e1f83c706b41cb201cd2126880526894d01268955038a07268845050e1f83c706b43630d2cd218905894d0289550483c706ba5e0331c9b43ccd2189c389f981e9a803baa803b440cd21b43ecd21b8004ccd21412e54585400422e54585400432e54585400442e545854004e4f4449525c582e545854005245532e42494e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000', 'hex');

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dosmisc_'));
    fs.writeFileSync(path.join(dir, 'MISC.COM'), MISC);
    fs.writeFileSync(path.join(dir, 'T.BAT'), 'MISC\r\n');
    const m = await Machine.boot({ dir, bat: 'T.BAT' });
    m.runFrames(60);
    let r;
    try { r = Buffer.from(m.M.FS.readFile('/run/RES.BIN')); } catch (_) { r = null; }
    chk(r && r.length === 79, `RES.BIN が書かれた (${r ? r.length : 0} バイト)`);
    if (r) {
        // レコード位置: [0]〜[9] は 3 バイトずつ (0..29)、[9] の後に名前 8 バイト、[12] の後に DX 2 バイト
        const OFS = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 38, 41, 44, 49, 52, 55, 58];
        const rec = (i) => ({ cf: r[OFS[i]], ax: r.readUInt16LE(OFS[i] + 1) });
        const is = (i, cf, ax) => rec(i).cf === cf && (ax === undefined || rec(i).ax === ax);
        chk(is(0, 0), `56h A→B 成功 (${JSON.stringify(rec(0))})`);
        chk(is(1, 1, 2), `56h 旧名が無い → AX=2 (${JSON.stringify(rec(1))})`);
        chk(is(2, 1, 5), `56h 新名が既にある → AX=5 (${JSON.stringify(rec(2))})`);
        chk(is(3, 1, 3), `56h 新名の親ディレクトリが無い → AX=3 (${JSON.stringify(rec(3))})`);
        chk(is(4, 1, 0x50), `5Bh 既にある → AX=50h (${JSON.stringify(rec(4))})`);
        chk(is(5, 0), `5Bh 無ければ作る (${JSON.stringify(rec(5))})`);
        chk(is(6, 0) && is(7, 0), '68h / 6Ah 開いているハンドル → CF=0');
        chk(is(8, 1, 6), `68h 無効ハンドル → AX=6 (${JSON.stringify(rec(8))})`);
        chk(is(9, 0), `5Ah 一時ファイル → CF=0 (${JSON.stringify(rec(9))})`);
        const tmp = r.slice(30, 38).toString('latin1');
        chk(/^QB[0-9A-F]{6}$/.test(tmp), `5Ah バッファが新しい名前に書き直された (${tmp})`);
        let names = [];
        try { names = m.M.FS.readdir('/run'); } catch (_) {}
        chk(names.includes('B.TXT') && !names.includes('A.TXT'), `改名が実ファイルに効いた (${names.filter((n) => /^[ABCD]\.TXT$/.test(n)).join(' ')})`);
        chk(names.includes(tmp), '5Ah の名前のファイルが実在する');
        chk(is(10, 0) && rec(10).ax === 1, `2Eh=1 → 54h=1 (${rec(10).ax})`);
        chk(is(11, 0) && rec(11).ax === 0, `2Eh=0 → 54h=0 (${rec(11).ax})`);
        chk(rec(12).ax === 932 && r.readUInt16LE(47) === 932, '66h AL=01 → BX=932 DX=932');
        chk(is(13, 1), '66h 未知のコードページ(437)の設定は失敗');
        chk(is(14, 0), '66h 932 の設定は成功');
        chk(is(15, 0), '67h BX=20 成功');
        chk(is(16, 1, 4), `67h BX=500 は上限超え → AX=4 (${JSON.stringify(rec(16))})`);
        const di = (o) => ({ al: r[o], cx: r.readUInt16LE(o + 1), dx: r.readUInt16LE(o + 3), media: r[o + 5] });
        const d1b = di(61), d1c = di(67);
        chk(d1b.al === 8 && d1b.cx === 512 && d1b.dx === 0x7FFF && d1b.media === 0xF8, `1Bh = 8 / 512 / 7FFFh / media F8h (${JSON.stringify(d1b)})`);
        chk(JSON.stringify(d1b) === JSON.stringify(d1c), '1Ch DL=1 も同じ');
        const a36 = r.readUInt16LE(73), c36 = r.readUInt16LE(75), t36 = r.readUInt16LE(77);
        chk(a36 === d1b.al && c36 === d1b.cx && t36 === d1b.dx, `36h と 1Bh の数字が一致 (${a36}/${c36}/${t36})`);
    }
    console.log(`\ndos_misc_calls_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
