#!/usr/bin/env node
// PC-98 .PI (Pi 形式) デコーダの回帰テスト。
//
// 検証戦略: 同一画像の MAG 版と PI 版がペアで入った書庫 (例 C165_206.LZH = c165.{pi,mag} /
// c206.{pi,mag}) を使い、「既に動いている MAG デコーダの出力」を ground truth として
// PI デコーダの RGBA がピクセル単位で一致するかを確かめる。MAG/PI は別アルゴリズムなので、
// 両者が同じ絵を出せば PI の展開・パレット・寸法すべてが正しいことの強い証拠になる。
//
// 素材は版権物 (転載不可) でリポジトリにコミットできないため、games/ 配下に書庫が在るときだけ
// 走り、無ければ SKIP する (jed_cursor_test.js と同じ方針)。
//
//   素材の置き方: games/ に PI と MAG が同名で入った LZH/ZIP を置く (既定 C165_206.LZH)。
//   別書庫を使う場合は第1引数にパスを渡す:  node tools/pi_test.js games/foo.lzh

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseLzh } = require('../web/player/archive.js');
require('../web/player/magimage.js');   // → global.QBMag
require('../web/player/piimage.js');    // → global.QBPi

const archivePath = process.argv[2] || path.join(__dirname, '..', 'games', 'C165_206.LZH');

if (!fs.existsSync(archivePath)) {
    console.log(`SKIP: ${archivePath} が無いため PI デコードの突合をスキップ`);
    console.log('  (版権素材につき非コミット。PI と MAG が同名で入った書庫を games/ に置くと走ります)');
    process.exit(0);
}

const buf = new Uint8Array(fs.readFileSync(archivePath));
const entries = parseLzh(buf);
const byBase = new Map();   // 拡張子なしの基底名 → { pi, mag }
for (const e of entries) {
    const m = /^(.*)\.(pi|mag)$/i.exec(e.name);
    if (!m) continue;
    const base = m[1].toLowerCase();
    const ext = m[2].toLowerCase();
    if (!byBase.has(base)) byBase.set(base, {});
    byBase.get(base)[ext] = e.data;
}

const pairs = [...byBase.entries()].filter(([, v]) => v.pi && v.mag);
if (pairs.length === 0) {
    console.log(`SKIP: ${path.basename(archivePath)} に PI/MAG の同名ペアが無い`);
    process.exit(0);
}

let pass = 0, fail = 0;
for (const [base, v] of pairs) {
    const mag = global.QBMag.decode(v.mag);
    const pi = global.QBPi.decode(v.pi);

    // 寸法一致 (MAG の scaleY は縦 200 ライン展開分。PI height と突き合わせる)
    const magW = mag.width, magH = mag.height * mag.scaleY;
    const piW = pi.width, piH = pi.height * pi.scaleY;
    try {
        assert.strictEqual(piW, magW, `${base}: 幅 PI=${piW} != MAG=${magW}`);
        assert.strictEqual(piH, magH, `${base}: 高さ PI=${piH} != MAG=${magH}`);

        // RGBA ピクセル突合。MAG は 8bit パレット、PI は 4bit パレット (上位ニブルのみ) なので
        // RGB の生値は一致しない (例 MAG 0xED=237 ↔ PI 0xE0|0xE=238)。だが同一画像なら色番号
        // インデックスは一致するはずなので、各成分を上位ニブル (= 元の 4bit パレット値) に
        // 量子化してから突き合わせる。これで「展開した色番号が全ピクセル一致するか」を検証する。
        const q = (v) => v >> 4;
        let diff = 0, firstAt = -1;
        const n = magW * magH;
        // scaleY を畳んで実ピクセルを比較するため、両者の「表示ピクセル」を作る
        const expand = (img) => {
            if (img.scaleY === 1) return img.rgba;
            const out = new Uint8ClampedArray(img.width * img.height * img.scaleY * 4);
            for (let y = 0; y < img.height; y++)
                for (let s = 0; s < img.scaleY; s++)
                    out.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4),
                            ((y * img.scaleY + s) * img.width) * 4);
            return out;
        };
        const a = expand(mag), b = expand(pi);
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            if (q(a[o]) !== q(b[o]) || q(a[o + 1]) !== q(b[o + 1]) || q(a[o + 2]) !== q(b[o + 2])) {
                if (firstAt < 0) firstAt = i;
                diff++;
            }
        }
        const fo = firstAt * 4;
        assert.strictEqual(diff, 0,
            `${base}: ${diff}/${n} px 不一致 (最初 px#${firstAt} 色番号 MAG=(${q(a[fo])},${q(a[fo+1])},${q(a[fo+2])}) vs PI=(${q(b[fo])},${q(b[fo+1])},${q(b[fo+2])}))`);

        console.log(`PASS ${base}: ${piW}x${piH} 全 ${n} px が MAG と一致`);
        pass++;
    } catch (err) {
        console.log(`FAIL ${err.message}`);
        fail++;
    }
}

console.log(`\n${pass}/${pass + fail} ペア一致`);
process.exit(fail === 0 ? 0 : 1);
