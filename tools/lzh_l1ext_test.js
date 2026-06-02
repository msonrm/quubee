#!/usr/bin/env node
// LZH Level 1 + 拡張ヘッダ (ext header) の回帰テスト。
//
// なぜ専用テストが要るか:
//   実 fixture (games/ 以下) の Level1 エントリは全て ext header チェーンが空なので、
//   lh5_test.js では「Level1 の compSize が ext header 長を含む」経路を一切踏まない。
//   実際この経路にバグがあった (compSize から ext 長を引かず data 終端 / next が
//   ext 長ぶん行き過ぎ → 2 件目以降を取りこぼす)。games/ では再現しないので、
//   ext header 付き Level1 を合成して直接検証する。lha (Lhasa) は展開専用で
//   Level1+ext 書庫を作れないため、ここは合成データで閉じる (外部依存なし)。
//
// LHA Level1 仕様: 先頭の compSize (skip size) = 圧縮データ長 + 全 ext header 長。
//   展開側は ext header 長を引いて実圧縮データ長にする (lha 本家 get_header_level1 が
//   `packed_size -= extend_size`)。Lhasa を独立オラクルにした実書庫照合で確認済み。

const assert = require('assert');
const { parseLzh } = require('../web/player/archive.js');

// Level1 の -lh0- (無圧縮) エントリを合成。ext header の総バイト数を
// compSize に含める = LHA Level1 仕様。各 ext header は [type(1)][data][nextsize(2)] で
// 末尾 2 byte が次サイズ (=0 で終端)。span はその全長。
function buildEntry(name, data, extSpans) {
    const nameBuf = Buffer.from(name, 'latin1');
    const nameLen = nameBuf.length;
    const headerSize = 25 + nameLen;            // byte2 以降の basic header 長
    const extParts = [];
    let extTotal = 0;
    for (let i = 0; i < extSpans.length; i++) {
        const span = extSpans[i];
        const part = Buffer.alloc(span);        // 0 埋め (type/data は中身不問)
        const next = (i + 1 < extSpans.length) ? extSpans[i + 1] : 0;
        part.writeUInt16LE(next, span - 2);     // 末尾 2 byte = 次 ext のサイズ
        extParts.push(part);
        extTotal += span;
    }
    const firstNext = extSpans.length ? extSpans[0] : 0;
    const compSize  = data.length + extTotal;   // skip size = data + ext
    const hdr = Buffer.alloc(2 + headerSize);
    hdr[0] = headerSize; hdr[1] = 0;            // checksum は parseLzh が検証しない
    hdr.write('-lh0-', 2, 'latin1');
    hdr.writeUInt32LE(compSize, 7);
    hdr.writeUInt32LE(data.length, 11);
    hdr.writeUInt32LE(0, 15);                   // timestamp (date=0 → mtime null)
    hdr[19] = 0x20; hdr[20] = 0x01; hdr[21] = nameLen;
    nameBuf.copy(hdr, 22);
    hdr[22 + nameLen + 2] = 0x4D;               // OS id 'M'
    hdr.writeUInt16LE(firstNext, 2 + headerSize - 2);  // basic header 末尾 = 最初の ext サイズ
    return Buffer.concat([hdr, ...extParts, Buffer.from(data, 'latin1')]);
}

const cases = [
    { name: 'A.TXT', data: 'HELLO',      ext: [5] },     // ext header 1 個
    { name: 'B.TXT', data: 'WORLD!',     ext: [] },      // ext なし (従来も通る境界)
    { name: 'C.DAT', data: '0123456789', ext: [4, 6] },  // ext header 2 個 (チェーン)
];

const archive = Buffer.concat(cases.map((c) => buildEntry(c.name, c.data, c.ext)));
const full = Buffer.concat([archive, Buffer.from([0])]);   // headerSize=0 で終端

const got = parseLzh(full);
assert.strictEqual(got.length, cases.length,
    `entry 数: got ${got.length}, expect ${cases.length} (ext 長の取りこぼし?)`);
for (let i = 0; i < cases.length; i++) {
    const g = got[i], c = cases[i];
    const data = Buffer.from(g.data).toString('latin1');
    assert.strictEqual(g.name, c.name, `[${i}] name`);
    assert.strictEqual(data, c.data, `[${i}] data (ext 長を compSize から引けているか)`);
    console.log(`  ✓ [${i}] ${g.name} = "${data}"`);
}
console.log(`\nPASS: Level1 + ext header ${cases.length} cases`);
