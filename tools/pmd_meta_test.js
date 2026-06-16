#!/usr/bin/env node
// PMD (.M) memo パーサ (web/player/pmdmeta.js) の headless 回帰 (2026-06-16)。
//
// 何を確かめるか:
//   東方旧作 BGM の .M コーパス (games/touhou/pmd_music/*.lzh, 各 1 曲) を展開し、
//   parseMemo が全ファイルで「曲名 (slot3) と作曲 (slot4) を非空で抽出」できること。
//   末尾 index 表の後方走査 + 区切りバイト判定 + 自己参照チェーン整合トリムが
//   楽曲データの偽エントリを正しく落とすことの担保 (先頭ズレの再発防止)。
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
    process.exit(1);
}
if (mFiles.length === 0) skip('.M が展開されなかった');
console.log('PASS');
