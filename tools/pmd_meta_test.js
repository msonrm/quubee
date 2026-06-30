#!/usr/bin/env node
// PMD (.M) memo パーサ (web/player/pmdmeta.js) の headless 回帰 (2026-06-16)。
//
// 何を確かめるか:
//   1. 合成 .M バイナリで MC バージョン別スロット数 (1/2/3 予約) の検出を検証。
//   2. 東方旧作 BGM の .M コーパス (games/touhou/pmd_music/*.lzh, 各 1 曲) を展開し、
//      parseMemo が全ファイルで「曲名と作曲を非空で抽出」できること。
//      末尾 index 表の後方走査 + 区切りバイト判定 + 自己参照チェーン整合トリムが
//      楽曲データの偽エントリを正しく落とすことの担保 (先頭ズレの再発防止)。
//
// ローカル限定: コーパスは再配布不可。不在なら SKIP (CI 安全)。展開には lha/lhasa。
//
// 使い方: node tools/pmd_meta_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const CORPUS = path.join(ROOT, 'games', 'touhou', 'pmd_music');
const { parseMemo } = require(path.join(ROOT, 'web', 'player', 'pmdmeta.js'));

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }

// ── 合成 .M で MCバージョン別スロット数検出を単体テスト ──────────────────────
//
// PMD memo ブロックの正確な構造 (PMDDATA.DOC + バイナリ突合):
//   ent[i] は「文字列の 1 バイト前」を指す。
//   - 文字列スロット: data[ent[i]] = 0x00 (NUL), decode1 は ent[i]+1 から次 NUL まで読む
//   - 空スロット:     data[ent[i]] = 0xFF, decode1 は '' を返す (allFF か空配列)
//   自己参照チェーン: nulAfter(data[ent[i]+1]) === ent[i+1]
//
// バイナリ配置の慣習 (実 .M を再現):
//   先頭スロットが文字列なら先頭 NUL を 1 個置く。
//   空スロット (0xFF) の後には 0x00 を 1 個置き次スロットの前 NUL にする。
//   各文字列スロットは末尾 NUL を持つ (次スロットの前 NUL を兼ねる)。
//
// ファイル先頭 2 バイト LE = ヘッダサイズ (PMD86=0x1A, 旧=<0x1A)。

function makeMemo(headerSz, strings) {
    // headerSz: 先頭 2 バイト LE に書き込む値 (PMD ヘッダサイズ)
    // strings: '' = 空スロット (0xFF マーカー), 非空 = 文字列スロット
    const hdr = Buffer.alloc(Math.max(headerSz, 2), 0);
    hdr.writeUInt16LE(headerSz, 0);

    const bodyBytes = [];
    const ents = [];        // ファイル内絶対オフセット
    let pos = hdr.length;

    // 最初のスロットが文字列なら先頭 NUL を追加 (その NUL が ent[0] の指す位置)
    if (strings.length > 0 && strings[0] !== '') {
        bodyBytes.push(0x00);
        pos++;
    }

    for (const s of strings) {
        if (s === '') {
            ents.push(pos);          // 0xFF バイトを指す
            bodyBytes.push(0xFF);
            pos++;
            bodyBytes.push(0x00);   // 次スロット用の前 NUL
            pos++;
        } else {
            ents.push(pos - 1);     // 前の 0x00 (NUL) を指す
            for (const b of Buffer.from(s, 'binary')) { bodyBytes.push(b); pos++; }
            bodyBytes.push(0x00);   // 末尾 NUL = 次スロットの前 NUL を兼ねる
            pos++;
        }
    }

    const body = Buffer.from(bodyBytes);
    const idx  = Buffer.alloc(ents.length * 2 + 2, 0);
    for (let i = 0; i < ents.length; i++) idx.writeUInt16LE(ents[i], i * 2);

    return Buffer.concat([hdr, body, idx]);
}

function syntheticTest() {
    let failures = 0;

    function check(label, buf, expect) {
        const meta = parseMemo(new Uint8Array(buf));
        const got = meta ? meta.title : null;
        if (got !== expect.title) {
            console.error(`  FAIL ${label}: title=${JSON.stringify(got)} want=${JSON.stringify(expect.title)}`);
            failures++;
        } else {
            if (process.env.VERBOSE) console.log(`  OK   ${label}: title=${JSON.stringify(got)}`);
        }
    }

    // 3 スロット形式 (MC v4.8a+): PPZFile=0xFF, PPSFile='pps', PCMFile='pcm' → titleOffset=3
    // ent[0]=0xFF → data[ent[0]]=0xFF → titleOffset=3 → ent[3]=Title3
    check('3-slot(PPZFile=0xFF,PPSFile=pps)',
        makeMemo(0x1A, ['', 'pps', 'pcm', 'Title3', 'Comp3']),
        { title: 'Title3' });

    // 2 スロット形式 (MC v4.2a-v4.7x): PPSFile='pps', PCMFile='pcm' → titleOffset=2
    // ent[0] → data[ent[0]]=0x00 (NUL) → headerSize=0x1A >= 0x1A → titleOffset=2 → ent[2]=Title2
    check('2-slot(headerSize=0x1A)',
        makeMemo(0x1A, ['pps', 'pcm', 'Title2', 'Comp2']),
        { title: 'Title2' });

    // 1 スロット形式 (MC < v4.2a): PCMFile='pcm' → titleOffset=1
    // headerSize=0x0A < 0x1A → titleOffset=1 → ent[1]=Title1
    check('1-slot(headerSize=0x0A)',
        makeMemo(0x0A, ['pcm', 'Title1', 'Comp1']),
        { title: 'Title1' });

    console.log(`合成テスト: ${failures === 0 ? 'PASS' : `FAIL(${failures}件)`}`);
    return failures;
}

const synFails = syntheticTest();
if (!fs.existsSync(CORPUS)) skip('コーパス games/touhou/pmd_music 不在 (ローカル限定テスト)');

const lzhs = fs.readdirSync(CORPUS).filter((f) => /\.lzh$/i.test(f));
if (lzhs.length === 0) skip('pmd_music に .lzh が無い');

// 展開ツール (lha → 無ければ lhasa)。
function haveCmd(c) { try { cp.execSync(`command -v ${c}`, { stdio: 'ignore' }); return true; } catch (_) { return false; } }
const EXTRACT = haveCmd('lha') ? 'lha' : (haveCmd('lhasa') ? 'lhasa' : null);
if (!EXTRACT) skip('lha / lhasa が無い (.lzh 展開不可)');

const TMP = fs.mkdtempSync('/tmp/pmd_meta_test_');
let extracted = 0;
for (const lzh of lzhs) {
    try {
        if (EXTRACT === 'lha') cp.execSync(`lha -xqw=${TMP} "${path.join(CORPUS, lzh)}"`, { stdio: 'ignore' });
        else                   cp.execSync(`cd ${TMP} && lhasa -xq "${path.join(CORPUS, lzh)}"`, { stdio: 'ignore' });
        extracted++;
    } catch (_) { /* このアーカイブはスキップ */ }
}
if (extracted === 0) skip('展開に全て失敗 (lha 不調)');

const mFiles = fs.readdirSync(TMP).filter((f) => /\.m$/i.test(f));
let pass = 0;
const fails = [];
for (const f of mFiles.sort()) {
    const data = new Uint8Array(fs.readFileSync(path.join(TMP, f)));
    const meta = parseMemo(data);
    const okTitle = meta && typeof meta.title === 'string' && meta.title.trim().length > 0;
    const okComp  = meta && typeof meta.composer === 'string' && meta.composer.trim().length > 0;
    if (okTitle && okComp) {
        pass++;
        if (process.env.VERBOSE) console.log(`  OK  ${f.padEnd(14)} ${meta.title}  /  ${meta.composer}`);
    } else {
        fails.push(`${f}: title=${JSON.stringify(meta && meta.title)} composer=${JSON.stringify(meta && meta.composer)}`);
    }
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\nparseMemo: ${pass}/${mFiles.length} で曲名+作曲を抽出`);
if (fails.length) {
    console.log('FAIL:');
    for (const m of fails) console.log('  ' + m);
}
if (mFiles.length === 0) skip('.M が展開されなかった');
if (fails.length > 0 || synFails > 0) process.exit(1);
console.log('PASS');
