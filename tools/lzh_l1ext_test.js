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
//
// ext 要素は 2 形式を許す:
//   数値 span    … type/data 不問の不透明ヘッダ (compSize/next 経路の検証用)
//   {type, data} … type byte と data を実際に書き込む (ファイル名 0x01 / ディレクトリ 0x02)。
//                  span は 1(type) + data + 2(nextsize) で自動算出。
function extSpan(e) {
    return (typeof e === 'number') ? e : 1 + Buffer.from(e.data, 'latin1').length + 2;
}
function buildEntry(name, data, exts) {
    const nameBuf = Buffer.from(name, 'latin1');
    const nameLen = nameBuf.length;
    const headerSize = 25 + nameLen;            // byte2 以降の basic header 長
    const extParts = [];
    let extTotal = 0;
    for (let i = 0; i < exts.length; i++) {
        const e = exts[i];
        const span = extSpan(e);
        const part = Buffer.alloc(span);        // 0 埋め (数値 span は type/data 不問)
        if (typeof e !== 'number') {
            part[0] = e.type;
            Buffer.from(e.data, 'latin1').copy(part, 1);
        }
        const next = (i + 1 < exts.length) ? extSpan(exts[i + 1]) : 0;
        part.writeUInt16LE(next, span - 2);     // 末尾 2 byte = 次 ext のサイズ
        extParts.push(part);
        extTotal += span;
    }
    const firstNext = exts.length ? extSpan(exts[0]) : 0;
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
    // ↓ ディレクトリ名 ext (type 0x02, 0xFF 区切り) — issue kiss218 の回帰。
    //   Level1 でもディレクトリ名は basic header でなく拡張ヘッダに入る。
    { name: 'SVCEL.EXE', data: 'MZ...',  expect: 'TOOL/SVCEL.EXE',
      ext: [{ type: 0x02, data: 'TOOL\xff' }, { type: 0x00, data: '\x00\x00' }] },
    // ネストしたディレクトリ (0xFF が複数 = パス区切り)。
    { name: 'DEEP.DAT', data: 'xyz',     expect: 'A/B/DEEP.DAT',
      ext: [{ type: 0x02, data: 'A\xffB\xff' }] },
    // type 0x01 ファイル名 ext は basic header の名前を上書きする。
    { name: 'SHORT.$$$', data: 'body',   expect: 'REALNAME.EXT',
      ext: [{ type: 0x01, data: 'REALNAME.EXT' }] },
    // basic header の filename フィールド自体に 0xFF 区切りパスが埋まるケース (level 0/1 共通経路)。
    //   level 0 は ext header を持てないのでサブディレクトリはこの形でしか表せない。
    //   0xFF は SJIS 不在バイトなので '/' へ正規化する (A-1)。
    { name: 'DIR\xffFILE.TXT', data: 'zzz', expect: 'DIR/FILE.TXT', ext: [] },
    { name: 'A\xffB\xffDEEP.BIN', data: 'q', expect: 'A/B/DEEP.BIN', ext: [] },
];

const archive = Buffer.concat(cases.map((c) => buildEntry(c.name, c.data, c.ext)));
const full = Buffer.concat([archive, Buffer.from([0])]);   // headerSize=0 で終端

const got = parseLzh(full);
assert.strictEqual(got.length, cases.length,
    `entry 数: got ${got.length}, expect ${cases.length} (ext 長の取りこぼし?)`);
for (let i = 0; i < cases.length; i++) {
    const g = got[i], c = cases[i];
    const data = Buffer.from(g.data).toString('latin1');
    const wantName = c.expect || c.name;
    assert.strictEqual(g.name, wantName, `[${i}] name (dir/filename ext を拾えているか)`);
    assert.strictEqual(data, c.data, `[${i}] data (ext 長を compSize から引けているか)`);
    console.log(`  ✓ [${i}] ${g.name} = "${data}"`);
}
console.log(`\nPASS: Level1 + ext header ${cases.length} cases`);
