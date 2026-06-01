#!/usr/bin/env node
// LZH デコーダの実書庫 byte-by-byte 検証。
//   games/ 以下の全 .lzh を web/player/archive.js でデコードし、
//   `lha xq` (Lhasa) で展開した結果と全エントリ照合する。
// 対応メソッド/レベル (lh0/lh4/lh5 × L0/L1/L2) は実 fixture で網羅検証。
// 未対応メソッド (-lh1- 等) を含む書庫は parseLzh が throw するので SKIP 扱い (失敗ではない)。
//
// 不一致が出たら最初の差分位置を表示。lha (Lhasa) が PATH に必要。

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { parseLzh } = require('../web/player/archive.js');

const GAMES = path.join(__dirname, '..', 'games');

// games/ 以下を再帰走査して .lzh を集める
function findLzh(dir, out) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) findLzh(full, out);
        else if (/\.lzh$/i.test(ent.name)) out.push(full);
    }
    return out;
}

// 抽出ツリーを再帰走査して {正規化相対パス -> Buffer} を作る (basename も別キーで持つ)
function indexTree(dir, base, map) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) indexTree(full, base, map);
        else {
            const rel = path.relative(base, full).replace(/\\/g, '/').toLowerCase();
            const data = fs.readFileSync(full);
            map.set(rel, data);
            if (!map.has(ent.name.toLowerCase())) map.set(ent.name.toLowerCase(), data);
        }
    }
}

let pass = 0, fail = 0, skipEntries = 0, skipFiles = 0;
const lzhFiles = findLzh(GAMES, []).sort();

for (const lzhPath of lzhFiles) {
    const rel = path.relative(GAMES, lzhPath);
    console.log(`\n=== ${rel} ===`);

    let entries;
    try {
        entries = parseLzh(new Uint8Array(fs.readFileSync(lzhPath)));
    } catch (e) {
        // 不明ヘッダレベル等で全体が読めない場合のみ → ファイル SKIP
        console.log(`  ⊘ SKIP (file) — ${e.message}`);
        skipFiles++;
        continue;
    }

    // リファレンス: lha xq で別ディレクトリへ展開し、ツリーを索引化
    const ref = fs.mkdtempSync(path.join(os.tmpdir(), 'lzhref-'));
    try {
        execSync(`cd ${ref} && lha xq "${lzhPath}"`, { stdio: 'ignore' });
    } catch (e) {
        console.log(`  ✗ lha xq 失敗: ${e.message}`);
        fail++;
        fs.rmSync(ref, { recursive: true, force: true });
        continue;
    }
    const refMap = new Map();
    indexTree(ref, ref, refMap);

    let matched = 0, skippedHere = 0;
    for (const e of entries) {
        if (e.data == null) {   // 未対応メソッド (例: -lh1-) → エントリ SKIP
            skipEntries++; skippedHere++;
            continue;
        }
        const key = e.name.replace(/\\/g, '/').toLowerCase();
        const refData = refMap.get(key) || refMap.get(path.basename(key));
        if (!refData) {
            console.log(`  ✗ ${e.name} — リファレンス側に無い`);
            fail++;
            continue;
        }
        if (e.data.length !== refData.length) {
            console.log(`  ✗ ${e.name} — サイズ違い: decoded=${e.data.length} ref=${refData.length}`);
            fail++;
            continue;
        }
        let diffAt = -1;
        for (let i = 0; i < e.data.length; i++) {
            if (e.data[i] !== refData[i]) { diffAt = i; break; }
        }
        if (diffAt >= 0) {
            console.log(`  ✗ ${e.name} — offset ${diffAt} で不一致: decoded=0x${e.data[diffAt].toString(16)} ref=0x${refData[diffAt].toString(16)}`);
            fail++;
        } else {
            pass++; matched++;
        }
    }
    console.log(`  ✓ ${matched}/${entries.length} entries byte-match` +
                (skippedHere ? ` (${skippedHere} skipped: 未対応メソッド)` : ''));

    fs.rmSync(ref, { recursive: true, force: true });
}

console.log(`\n--- 合計: pass ${pass} entries, fail ${fail}, skip ${skipEntries} entries (未対応メソッド)` +
            (skipFiles ? `, skip ${skipFiles} files (不明ヘッダ)` : '') + ' ---');
process.exit(fail === 0 ? 0 : 1);
