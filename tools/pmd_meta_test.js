#!/usr/bin/env node
// PMD (.M) memo パーサ (web/player/pmdmeta.js) の headless 回帰。
//
// pmdmeta.js は KAJA PMD の正典 get_memo (PMD.ASM) を移植したもの = .M ヘッダの MC
// バージョンから titleOffset を決定論的に決める (内容を見ない)。本テストは:
//   1. 合成 .M (正典フォーマット: part 表 + バージョンマーカ + 前方 memo テーブル) で
//      ver 0x40/0x42/0x48 のスロット数分岐・base 0/1・ASCII 曲名・バージョン検証を確認。
//   2. 東方旧作 BGM の実 .M コーパス (games/touhou/pmd_music/*.lzh) で曲名+作曲を抽出し、
//      全曲 作曲=「ＺＵＮ（太田）」を correctness 検査 (offset ズレを実検出)。
//
// ローカル限定: コーパスは再配布不可。不在なら SKIP (CI 安全)。展開には lha/lhasa。
// 使い方: node tools/pmd_meta_test.js   (VERBOSE=1 で各曲表示)

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const CORPUS = path.join(ROOT, 'games', 'touhou', 'pmd_music');
const { parseMemo } = require(path.join(ROOT, 'web', 'player', 'pmdmeta.js'));

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }

// ── 正典フォーマットの合成 .M を作る ───────────────────────────────────────────
// レイアウト (D = base):
//   D+0x00: word 0x001A (part 表先頭マーカ)   D+0x18: word P=0x1E (memo 情報への入口)
//   D+0x1A: word tableOff=0x1E (memo テーブル位置)   D+0x1C: version 語 (bl=ver, bh=0FEh)
//   D+0x1E..: memo テーブル (各 word = 文字列の D 相対オフセット)
//   その後: 各文字列 (SJIS + NUL)。空スロットは 0x00 1 個を指す (driver は entry!=0 を期待)。
// version は Ver4.0=0x40 (bh 任意), 以外は bh=0xFE。base に 1 を渡すと先頭に 0x00 を 1 個足す。
function makeMemoM(version, tableStrings, base) {
    base = base || 0;
    const HEADER = 0x1A, P = 0x1E, tableOff = 0x1E;
    const n = tableStrings.length;
    const entries = [];
    const strBytes = [];
    let off = tableOff + n * 2;                 // 最初の文字列の D 相対オフセット
    for (const s of tableStrings) {
        entries.push(off);
        if (s === '') { strBytes.push(0x00); off += 1; }
        else {
            for (const b of Buffer.from(s, 'binary')) { strBytes.push(b); off += 1; }
            strBytes.push(0x00); off += 1;
        }
    }
    const d = Buffer.alloc(base + off, 0);
    d.writeUInt16LE(0x001A, base + 0x00);
    d.writeUInt16LE(P, base + 0x18);
    d.writeUInt16LE(tableOff, base + 0x1A);
    d[base + 0x1C] = version & 0xFF;
    d[base + 0x1D] = (version === 0x40) ? 0x00 : 0xFE;
    for (let i = 0; i < n; i++) d.writeUInt16LE(entries[i], base + tableOff + i * 2);
    for (let i = 0; i < strBytes.length; i++) d[base + tableOff + n * 2 + i] = strBytes[i];
    return new Uint8Array(d);
}

function syntheticTest() {
    let failures = 0;
    function check(label, buf, expectTitle) {
        const meta = parseMemo(buf);
        const got = meta ? meta.title : null;
        if (got !== expectTitle) {
            console.error(`  FAIL ${label}: title=${JSON.stringify(got)} want=${JSON.stringify(expectTitle)}`);
            failures++;
        } else if (process.env.VERBOSE) {
            console.log(`  OK   ${label}: title=${JSON.stringify(got)}`);
        }
    }
    function checkNull(label, buf) {
        const meta = parseMemo(buf);
        if (meta !== null) {
            console.error(`  FAIL ${label}: 期待 null, got ${JSON.stringify(meta && meta.title)}`);
            failures++;
        } else if (process.env.VERBOSE) {
            console.log(`  OK   ${label}: null`);
        }
    }

    // ver 0x48 (MC v4.8+): 3 予約 (PPZ/PPS/PCM) → titleOffset=3
    check('ver48 3予約(空) base0',
        makeMemoM(0x48, ['', '', '', 'TITLE48', 'ZUN', 'ARR']), 'TITLE48');
    // 同じく base=1 (先頭プレフィックス 1 バイト・東方コーパスと同形)
    check('ver48 3予約 base1',
        makeMemoM(0x48, ['', '', '', 'TITLE48b', 'ZUN'], 1), 'TITLE48b');
    // ver 0x44 (MC v4.2-4.7): 2 予約 (PPS/PCM) → titleOffset=2
    check('ver44 2予約(空)',
        makeMemoM(0x44, ['', '', 'TITLE44', 'ZUN']), 'TITLE44');
    // ver 0x41 (MC v4.1): 1 予約 (PCM) → titleOffset=1
    check('ver41 1予約(空)',
        makeMemoM(0x41, ['', 'TITLE41', 'ZUN']), 'TITLE41');
    // ver 0x40 (MC v4.0、マーカ 0FEh 不要): 1 予約 → titleOffset=1
    check('ver40 1予約(空)',
        makeMemoM(0x40, ['', 'TITLE40', 'ZUN']), 'TITLE40');

    // ASCII 曲名は内容を見ないので常に安全 ("OP.M" / 単語 / ファイル名形でも誤判定しない)
    check('ver48 ASCII曲名 "OP.M"',
        makeMemoM(0x48, ['', '', '', 'OP.M', 'ZUN']), 'OP.M');
    check('ver48 予約に実PCM名 + ASCII曲名 "GAME"',
        makeMemoM(0x48, ['FOO.PPZ', 'BAR.PPS', 'BAZ.PPC', 'GAME', 'ZUN']), 'GAME');

    // バージョン検証: 0FEh マーカ無し (bl>=0x41) は null、bl<0x41 も null
    checkNull('marker無し(bh!=0FEh) → null',
        (() => { const b = makeMemoM(0x48, ['', '', '', 'X', 'Y']); b[1 /*base0 0x1D*/ + 0x1C] = 0x12; return b; })());
    checkNull('MC<=4.1(bl=0x39) → null',
        makeMemoM(0x39, ['', 'X', 'Y']));

    // PMD86 形式でない (先頭 word != 0x001A) → null
    checkNull('非PMD86ヘッダ → null', Uint8Array.from([0x2a, 0x00, 0, 0, 0, 0]));

    // memo 中の生 ANSI CSI エスケープは除去される (ANDRO_02.M で実見: ESC[4;34m...ESC[m)。
    check('ANSI CSI 除去 (色付け直書き)',
        makeMemoM(0x48, ['', '', '', '\x1b[4;34mTITLE\x1b[m', 'ZUN']), 'TITLE');

    console.log(`合成テスト: ${failures === 0 ? 'PASS' : `FAIL(${failures}件)`}`);
    return failures;
}

// bridge.js は DOM (document/window) 前提で Node から直接 require できないため、decodeSjisText
// (+ 依存する NEC_RULED_TO_UNICODE/decorAsciiFromTrail) の実ソースだけを切り出して評価する
// (別実装を書くと本体からドリフトするリスクがあるため、本体そのものをテストする)。
function loadDecodeSjisTextFromBridge() {
    const src = fs.readFileSync(path.join(ROOT, 'web', 'player', 'bridge.js'), 'utf8');
    const startMarker = '    const NEC_RULED_TO_UNICODE = {';
    const endMarker = '\n    // Unicode → Shift-JIS エンコーダ';
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('bridge.js から decodeSjisText の切り出しに失敗 (マーカ不一致)');
    const snippet = src.slice(start, end);
    const sjis = new TextDecoder('shift_jis');
    return new Function('sjis', snippet + '\nreturn decodeSjisText;')(sjis);
}

// decodeSjisText 単体の回帰: NEC 罫線 (0x86xx) 既存動作 + 区9 の2バイト半角英数字 (0x85xx) 新規復元。
// DE_TOW.M の実バイト列 "[ Dungeon Explorer ]" (0x85xx の2バイト半角文字そのもの) で検証する。
function decodeSjisTextTest() {
    let failures = 0;
    const decodeSjisText = loadDecodeSjisTextFromBridge();
    function check(label, hex, want) {
        const got = decodeSjisText(Uint8Array.from(Buffer.from(hex, 'hex')));
        if (got !== want) {
            console.error(`  FAIL ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
            failures++;
        } else if (process.env.VERBOSE) {
            console.log(`  OK   ${label}: ${JSON.stringify(got)}`);
        }
    }
    check('NEC 罫線 0x86xx (既存動作の保護)', '86a2', '─');
    check('区9 の2バイト半角英数字 (DE_TOW.M 実バイト列)',
        '857a2085638595858e85878585858f858e20856485988590858c858f85928585859220857c',
        '[ Dungeon Explorer ]');
    console.log(`decodeSjisText テスト: ${failures === 0 ? 'PASS' : `FAIL(${failures}件)`}`);
    return failures;
}

const synFails = syntheticTest();
const decodeFails = decodeSjisTextTest();
// 合成テストはコーパスに依存しないので、コーパス不在で SKIP する前に確定させる
// (そうしないと corpus 不在環境で合成テストの FAIL が exit(0) に埋もれてしまう)。
if (synFails > 0 || decodeFails > 0) process.exit(1);
if (!fs.existsSync(CORPUS)) skip('コーパス games/touhou/pmd_music 不在 (ローカル限定テスト)');

const lzhs = fs.readdirSync(CORPUS).filter((f) => /\.lzh$/i.test(f));
if (lzhs.length === 0) skip('pmd_music に .lzh が無い');

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
// 東方旧作は全曲 作曲=「ＺＵＮ（太田）」。composer に「太田」が入ることまで確認すると
// titleOffset が正しい (曲名/作曲が 1 ズレていない) ことまで担保できる。
for (const f of mFiles.sort()) {
    const data = new Uint8Array(fs.readFileSync(path.join(TMP, f)));
    const meta = parseMemo(data);
    const okTitle = meta && typeof meta.title === 'string' && meta.title.trim().length > 0;
    const okComp  = meta && typeof meta.composer === 'string' && meta.composer.includes('太田');
    if (okTitle && okComp) {
        pass++;
        if (process.env.VERBOSE) console.log(`  OK  ${f.padEnd(14)} ${meta.title}  /  ${meta.composer}`);
    } else {
        fails.push(`${f}: title=${JSON.stringify(meta && meta.title)} composer=${JSON.stringify(meta && meta.composer)} (作曲に「太田」を期待)`);
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

// games/music/pmddata.lzh (実 PC-98 フリーソフト同人音楽コーパス、再配布不可でローカル限定・
// gitignore 対象) があれば、報告された実バグの再現を追加検証する:
//   DE_TOW.M   = 区9 の2バイト半角英数字 (0x85xx) が曲名に直書き → decodeSjisText の復元を確認
//   ANDRO_02.M = ANSI CSI エスケープが曲名に直書き → stripAnsi の除去を確認
// 不在なら黙ってスキップ (CI 安全・他コーパスと同じ方針)。
const PMDDATA = path.join(ROOT, 'games', 'music', 'pmddata.lzh');
const pmddataExtract = haveCmd('lha') ? 'lha' : (haveCmd('lhasa') ? 'lhasa' : null);
if (fs.existsSync(PMDDATA) && pmddataExtract) {
    const TMP2 = fs.mkdtempSync('/tmp/pmd_meta_test_real_');
    const wantTitle = {
        'de_tow.m': '街の曲 [ Dungeon Explorer ]',
        'andro_02.m': '反生命戦機アンドロギュヌス ／ IN THE WAKE OF ANDROGYNUS',
    };
    let realFails = 0;
    try {
        if (pmddataExtract === 'lha') cp.execSync(`lha -xqw=${TMP2} "${PMDDATA}" de_tow.m andro_02.m`, { stdio: 'ignore' });
        else                          cp.execSync(`cd ${TMP2} && lhasa -xq "${PMDDATA}" de_tow.m andro_02.m`, { stdio: 'ignore' });
        const decodeSjisText = loadDecodeSjisTextFromBridge();
        for (const [f, want] of Object.entries(wantTitle)) {
            const fp = path.join(TMP2, f);
            if (!fs.existsSync(fp)) { console.log(`  SKIP pmddata/${f}: 展開されず`); continue; }
            const data = new Uint8Array(fs.readFileSync(fp));
            const meta = parseMemo(data, (u) => decodeSjisText(u));
            const got = meta && meta.title;
            if (got !== want) {
                console.error(`  FAIL pmddata/${f}: title=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
                realFails++;
            } else if (process.env.VERBOSE) {
                console.log(`  OK   pmddata/${f}: ${JSON.stringify(got)}`);
            }
        }
        console.log(`pmddata.lzh 実バグ再現テスト: ${realFails === 0 ? 'PASS' : `FAIL(${realFails}件)`}`);
    } catch (e) {
        console.log('  SKIP pmddata.lzh 展開失敗: ' + e.message);
    } finally {
        fs.rmSync(TMP2, { recursive: true, force: true });
    }
    if (realFails > 0) process.exit(1);
} else if (process.env.VERBOSE) {
    console.log('SKIP pmddata.lzh 不在 (ローカル限定テスト)');
}

console.log('PASS');
