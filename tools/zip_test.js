#!/usr/bin/env node
// ZIP パーサの回帰テスト (中央ディレクトリ経由 / data descriptor / bit11 UTF-8 名 / LFH フォールバック)。
//
// なぜ専用テストが要るか:
//   実書庫 MUAP641.zip が「開けない」と報告された。真因は Info-ZIP 系ツールが書く
//   data descriptor (General Purpose bit 3): Local File Header の compSize/origSize が 0 で、
//   真の長さは圧縮データの後ろ (data descriptor) と中央ディレクトリにしか無い。旧 parseZip は
//   LFH チェーンだけを辿り bit 3 で throw していたため書庫全体が開けなかった。
//   さらに同書庫は一部の日本語名に bit 11 (UTF-8 名フラグ) を立てている。MEMFS の規約は
//   「名前 = 生 SJIS バイトの latin1 写像」なので、UTF-8 名は SJIS バイトへ戻す必要がある。
//   games/ は再配布不可でコミットできないため、これらの経路を合成 zip で自己完結検証する。
//
// 合成する zip:
//   1. 通常 zip (中央ディレクトリあり・bit3 なし) — 基本経路
//   2. data descriptor 付き zip (bit3=1, LFH サイズ 0, descriptor + 中央ディレクトリに真値)
//   3. bit11 UTF-8 名 (半角カナ「ｵﾘｼﾞﾅﾙ」+ 漢字「君ヶ代」) — SJIS バイトへ戻るか
//   4. サブディレクトリ + ディレクトリエントリ — dir は skip・ファイルは保持
//   5. 中央ディレクトリ無し (EOCD 不在) — LFH フォールバック経路

const assert = require('assert');
const zlib = require('zlib');
const { parseZip } = require('../web/player/archive.js');

const sjisDec = new TextDecoder('shift_jis');
const sjisName = (n) => {
    const b = new Uint8Array(n.length);
    for (let i = 0; i < n.length; i++) b[i] = n.charCodeAt(i) & 0xff;
    return sjisDec.decode(b);
};
const latin1 = (s) => { const b = Buffer.alloc(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

// ---- 最小 ZIP ライタ ----------------------------------------------------------
// nameBytes は Buffer (生バイト)。flags/method を制御し、bit3 のときは LFH サイズ 0 +
// data descriptor を後置する。withCentralDir=false で EOCD 無し zip を作る。
function dosTime() { return 0; }  // 日時は本テストの対象外 (0 = null mtime)
function dosDate() { return 0; }

function buildZip(files, { withCentralDir = true } = {}) {
    const chunks = [];
    const records = [];   // 中央ディレクトリ用メタ
    let offset = 0;
    const push = (b) => { chunks.push(b); offset += b.length; };

    for (const f of files) {
        const stored = f.method === 0;
        const comp = stored ? Buffer.from(f.data) : zlib.deflateRawSync(Buffer.from(f.data));
        const crc = zlib.crc32 ? zlib.crc32(Buffer.from(f.data)) >>> 0 : 0;  // crc は parser 不検証
        const dd = !!(f.flags & 0x08);
        const lhOffset = offset;

        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(0x04034b50, 0);
        lfh.writeUInt16LE(20, 4);                 // version needed
        lfh.writeUInt16LE(f.flags, 6);
        lfh.writeUInt16LE(f.method, 8);
        lfh.writeUInt16LE(dosTime(), 10);
        lfh.writeUInt16LE(dosDate(), 12);
        lfh.writeUInt32LE(dd ? 0 : crc, 14);      // bit3: サイズ/CRC は 0 (descriptor に置く)
        lfh.writeUInt32LE(dd ? 0 : comp.length, 18);
        lfh.writeUInt32LE(dd ? 0 : f.data.length, 22);
        lfh.writeUInt16LE(f.nameBytes.length, 26);
        lfh.writeUInt16LE(0, 28);                 // extra len
        push(lfh);
        push(f.nameBytes);
        push(comp);
        if (dd) {                                 // data descriptor (署名つき)
            const d = Buffer.alloc(16);
            d.writeUInt32LE(0x08074b50, 0);
            d.writeUInt32LE(crc, 4);
            d.writeUInt32LE(comp.length, 8);
            d.writeUInt32LE(f.data.length, 12);
            push(d);
        }
        records.push({ f, lhOffset, comp, crc });
    }

    if (!withCentralDir) return Buffer.concat(chunks);

    const cdStart = offset;
    for (const r of records) {
        const { f, lhOffset, comp, crc } = r;
        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(0x02014b50, 0);
        cdh.writeUInt16LE(20, 4);
        cdh.writeUInt16LE(20, 6);
        cdh.writeUInt16LE(f.flags, 8);
        cdh.writeUInt16LE(f.method, 10);
        cdh.writeUInt16LE(dosTime(), 12);
        cdh.writeUInt16LE(dosDate(), 14);
        cdh.writeUInt32LE(crc, 16);
        cdh.writeUInt32LE(comp.length, 20);       // CD には常に真のサイズ
        cdh.writeUInt32LE(f.data.length, 24);
        cdh.writeUInt16LE(f.nameBytes.length, 28);
        cdh.writeUInt16LE(0, 30);                 // extra
        cdh.writeUInt16LE(0, 32);                 // comment
        cdh.writeUInt16LE(0, 34);                 // disk #
        cdh.writeUInt16LE(0, 36);                 // internal attr
        cdh.writeUInt32LE(0, 38);                 // external attr
        cdh.writeUInt32LE(lhOffset, 42);
        push(cdh);
        push(f.nameBytes);
    }
    const cdSize = offset - cdStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(records.length, 8);
    eocd.writeUInt16LE(records.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);                    // comment len
    push(eocd);
    return Buffer.concat(chunks);
}

(async () => {
    let pass = 0;
    const find = (entries, name) => entries.find(e => e.name === name);

    // ---- テスト 1: 基本 (中央ディレクトリ・bit3 なし・stored + deflate) ----------
    {
        const files = [
            { nameBytes: Buffer.from('HELLO.TXT', 'latin1'), data: Buffer.from('hello world\n'.repeat(50)), method: 8, flags: 0 },
            { nameBytes: Buffer.from('RAW.BIN', 'latin1'),   data: Buffer.from([0, 1, 2, 3, 255, 254]),       method: 0, flags: 0 },
        ];
        const zip = buildZip(files);
        const entries = await parseZip(new Uint8Array(zip));
        assert.strictEqual(entries.length, 2, 'T1: 2 エントリ');
        assert.deepStrictEqual([...find(entries, 'HELLO.TXT').data], [...files[0].data], 'T1: deflate 一致');
        assert.deepStrictEqual([...find(entries, 'RAW.BIN').data], [...files[1].data], 'T1: stored 一致');
        console.log('T1 基本 (CD 経由 stored+deflate) PASS'); pass++;
    }

    // ---- テスト 2: data descriptor (bit3) — LFH サイズ 0 でも CD から復元 ----------
    {
        const big = Buffer.from('A'.repeat(1000) + 'B'.repeat(2000));
        const files = [
            { nameBytes: Buffer.from('DD1.DAT', 'latin1'), data: big,                         method: 8, flags: 0x08 },
            { nameBytes: Buffer.from('DD2.DAT', 'latin1'), data: Buffer.from('second entry'), method: 8, flags: 0x08 },
        ];
        const zip = buildZip(files);
        // LFH のサイズ欄が本当に 0 になっていることを確認 (テスト前提の自己検証)
        assert.strictEqual(zip.readUInt32LE(18), 0, 'T2: LFH compSize は 0 のはず');
        const entries = await parseZip(new Uint8Array(zip));
        assert.strictEqual(entries.length, 2, 'T2: 2 エントリ復元');
        assert.deepStrictEqual([...find(entries, 'DD1.DAT').data], [...big], 'T2: 1件目 data descriptor 展開一致');
        assert.deepStrictEqual([...find(entries, 'DD2.DAT').data], [...Buffer.from('second entry')], 'T2: 2件目一致');
        console.log('T2 data descriptor (bit3) PASS'); pass++;
    }

    // ---- テスト 3: bit11 UTF-8 名 → 生 SJIS バイトへ戻る ----------
    {
        // 「ｵﾘｼﾞﾅﾙ1」(半角カナ) と「君ヶ代」(漢字) を UTF-8 名 + bit11 で格納。
        const utf8name1 = Buffer.from('ORIG/ｵﾘｼﾞﾅﾙ1.MUS', 'utf8');
        const utf8name2 = Buffer.from('ORIG/君ヶ代.MUS', 'utf8');
        const files = [
            { nameBytes: utf8name1, data: Buffer.from('mus1'), method: 8, flags: 0x0808 },  // bit3+bit11
            { nameBytes: utf8name2, data: Buffer.from('mus2'), method: 8, flags: 0x0800 },  // bit11 のみ
        ];
        const zip = buildZip(files);
        const entries = await parseZip(new Uint8Array(zip));
        // 期待: 名前は SJIS 生バイト (latin1 文字列)。表示デコードで元の日本語に戻る。
        const expect1 = latin1('ORIG/').toString('latin1') + 'µØ¼ÞÅÙ' + '1.MUS';
        // (上の手書きは脆いので、SJIS 再エンコードの実バイトで照合する)
        const e1 = entries.find(e => sjisName(e.name) === 'ORIG/ｵﾘｼﾞﾅﾙ1.MUS');
        const e2 = entries.find(e => sjisName(e.name) === 'ORIG/君ヶ代.MUS');
        assert.ok(e1, 'T3: 半角カナ名が SJIS に戻り表示復元できる');
        assert.ok(e2, 'T3: 漢字名が SJIS に戻り表示復元できる');
        // 名前バイトが全て 0x00-0xFF (= latin1 1バイト/char) であること = MEMFS 規約
        for (const e of [e1, e2]) for (const ch of e.name) assert.ok(ch.charCodeAt(0) <= 0xff, 'T3: 名前は生バイト latin1');
        // 半角カナ「ｵﾘｼﾞﾅﾙ」は SJIS 単バイト 0xb5 0xd8 0xbc 0xde 0xc5 0xd9
        assert.deepStrictEqual([...latin1(e1.name)].slice(5, 11), [0xb5, 0xd8, 0xbc, 0xde, 0xc5, 0xd9], 'T3: 半角カナ SJIS バイト');
        assert.deepStrictEqual([...e1.data], [...Buffer.from('mus1')], 'T3: data 一致');
        console.log('T3 bit11 UTF-8 名 → SJIS PASS'); pass++;
    }

    // ---- テスト 4: サブディレクトリ + ディレクトリエントリ ----------
    {
        const files = [
            { nameBytes: Buffer.from('DIR/', 'latin1'),       data: Buffer.alloc(0),          method: 0, flags: 0 },     // dir マーカ
            { nameBytes: Buffer.from('DIR/SUB/', 'latin1'),   data: Buffer.alloc(0),          method: 0, flags: 0 },     // dir マーカ
            { nameBytes: Buffer.from('DIR/SUB/F.TXT', 'latin1'), data: Buffer.from('nested'), method: 8, flags: 0x08 },
        ];
        const zip = buildZip(files);
        const entries = await parseZip(new Uint8Array(zip));
        assert.strictEqual(entries.length, 1, 'T4: ディレクトリエントリは skip され file のみ');
        assert.strictEqual(entries[0].name, 'DIR/SUB/F.TXT', 'T4: ネストしたパス保持');
        assert.deepStrictEqual([...entries[0].data], [...Buffer.from('nested')], 'T4: data 一致');
        console.log('T4 dir エントリ skip + ネスト PASS'); pass++;
    }

    // ---- テスト 5: 中央ディレクトリ無し → LFH フォールバック ----------
    {
        const files = [
            { nameBytes: Buffer.from('A.TXT', 'latin1'), data: Buffer.from('alpha'), method: 8, flags: 0 },
            { nameBytes: Buffer.from('B.BIN', 'latin1'), data: Buffer.from([9, 8, 7]), method: 0, flags: 0 },
        ];
        const zip = buildZip(files, { withCentralDir: false });
        const entries = await parseZip(new Uint8Array(zip));
        assert.strictEqual(entries.length, 2, 'T5: LFH フォールバックで 2 エントリ');
        assert.deepStrictEqual([...find(entries, 'A.TXT').data], [...Buffer.from('alpha')], 'T5: deflate 一致');
        assert.deepStrictEqual([...find(entries, 'B.BIN').data], [9, 8, 7], 'T5: stored 一致');
        console.log('T5 LFH フォールバック (EOCD 無し) PASS'); pass++;
    }

    console.log(`\n全 ${pass} テスト PASS`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
