#!/usr/bin/env node
// LArc (-lz5- / -lzs- / -lz4-) デコーダの回帰テスト。
//
// なぜ実書庫 fixture か:
//   LArc は本物のツール (larc.exe, 1988-90) でしか作れず、手元に作成系が無い
//   (Debian の lha/lhasa は Lhasa = 展開専用)。合成データで閉じると「エンコーダと
//   デコーダが同じ思い込みで一致するだけ」になり、フォーマットの正しさを保証できない。
//   そこで Lhasa プロジェクトのテスト書庫 (本物の LArc 3.33 / 世代別ツール製) を
//   tools/testdata/larc/ に vendoring し、その展開結果 (Lhasa = 独立実装オラクル)
//   の md5 を焼き込んで突合する。ゲーム書庫ではなく ISC ライセンスのテスト素材
//   (中身は GPL-2 テキスト等) なので再配布可。出所は同ディレクトリの README を参照。
//
//   authoring 時の検証: 11 個の実 LArc 書庫 (larc333 / generated/lzs / lengths /
//   lharc_atari_313a、-lz5-/-lzs-/-lz4- 各サイズ・0/1 byte エッジ・226KB/338KB の大物)
//   を lhasa で展開し自前デコーダと byte 完全一致を確認済。下はそのうち小容量の 4 本。

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseLzh } = require('../web/player/archive.js');

const DIR = path.join(__dirname, 'testdata', 'larc');

// { 書庫: [ 先頭エントリの method / 展開名 / 原サイズ / Lhasa 展開 md5 ] }
// md5 は lhasa (独立オラクル) で展開したバイト列のもの。
const cases = [
    // -lz5-: 初期リングバッファ (fill_initial の特殊パターン) を参照するデータを含む。
    { file: 'initial.lzs', method: '-lz5-', name: 'initial.bin', size: 4234,
      md5: 'd8b78b322c18b7f450e549aabd3c769b' },
    // -lz5-: 実マッチ (長コピー) を多用する GPL-2 テキスト。
    { file: 'lz5.lzs',     method: '-lz5-', name: 'GPL-2',       size: 18092,
      md5: 'b234ee4d69f5fce4486a80fdaf4a4263' },
    // -lzs- (旧版, MSB-first ビットストリーム): 同じ GPL-2 を別メソッドで復元 = 相互検算。
    { file: 'lzs.lzs',     method: '-lzs-', name: 'GPL-2',       size: 18092,
      md5: 'b234ee4d69f5fce4486a80fdaf4a4263' },
    // -lz4- (LArc 無圧縮 = stored): 1 byte のエッジ。method 分岐が -lh0- 相当に落ちるか。
    { file: 'lz4.lzs',     method: '-lz4-', name: '1.BIN',       size: 1,
      md5: '93b885adfe0da089cdf634904fd59f71' },
];

let pass = 0;
for (const c of cases) {
    const buf = new Uint8Array(fs.readFileSync(path.join(DIR, c.file)));
    const entries = parseLzh(buf);
    const e = entries[0];
    assert.ok(e && e.data, `${c.file}: 先頭エントリが復号できていない (data=null)`);
    assert.strictEqual(e.method, c.method, `${c.file}: method`);
    assert.strictEqual(e.name, c.name, `${c.file}: 展開名`);
    assert.strictEqual(e.data.length, c.size, `${c.file}: 原サイズ`);
    const md5 = crypto.createHash('md5').update(Buffer.from(e.data)).digest('hex');
    assert.strictEqual(md5, c.md5, `${c.file}: 展開バイト md5 (lhasa オラクル不一致)`);
    console.log(`  ✓ ${c.file.padEnd(13)} ${c.method} [${c.name}] ${c.size}B md5 一致`);
    pass++;
}
console.log(`\nPASS: LArc ${pass} cases (lhasa オラクル byte 一致)`);
