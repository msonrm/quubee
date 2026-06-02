#!/usr/bin/env node
// diskimage.js 検証ハーネス。
//   - np2tool/*.hdm (実 FAT12 2HD・サブディレクトリ持ち) で抽出を検証
//   - img2d88.py で .hdm→.d88 変換、FDI ヘッダ合成 → raw/d88/fdi の3経路がバイト一致
//   - 自己起動 .d88 は「非FAT」になることを確認
//
// 使い方: node tools/diskimage_test.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const di = require('../web/player/diskimage.js');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } };

function sha(u8) {
    return require('crypto').createHash('sha1').update(Buffer.from(u8)).digest('hex').slice(0, 12);
}
function fileMap(res) {
    const m = {};
    for (const f of res.files) m[f.name.toLowerCase()] = { size: f.data.length, sha: sha(f.data) };
    return m;
}

// ---- 1. raw .hdm 抽出 ----
const HDMS = [
    'core/np2kai/np2tool/npmouse/npmouse.hdm',
    'core/np2kai/np2tool/npstor/npstor.hdm',
    'core/np2kai/np2tool/hostdrvnt/hstdrvnt.hdm',
];
const rawResults = {};
for (const rel of HDMS) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { console.log('  (skip, missing) ' + rel); continue; }
    const bytes = new Uint8Array(fs.readFileSync(p));
    const res = di.extractDiskImage(bytes, path.basename(p));
    console.log(`\n[raw .hdm] ${rel}`);
    ok(res.ok, `${rel} should extract (reason=${res.reason})`);
    if (!res.ok) continue;
    rawResults[rel] = res;
    console.log(`  ${res.info.kind} clusters=${res.info.clusters}  files=${res.files.length}`);
    for (const f of res.files.slice(0, 30)) {
        console.log(`    ${f.name}  ${f.data.length}B  ${f.mtime ? f.mtime.toISOString().slice(0,16) : '-'}  ${sha(f.data)}`);
    }
}

// 既知の中身を assert (Python で読んだ ground truth)
if (rawResults['core/np2kai/np2tool/npmouse/npmouse.hdm']) {
    const m = fileMap(rawResults['core/np2kai/np2tool/npmouse/npmouse.hdm']);
    ok(m['readme.txt'] && m['readme.txt'].size === 2425, 'npmouse README.TXT size=2425');
    // WNT/ W2K/ サブディレクトリのファイルが取れている (再帰)
    const hasSub = Object.keys(m).some(k => k.includes('wnt/')) &&
                   Object.keys(m).some(k => k.includes('w2k/'));
    ok(hasSub, 'npmouse should recurse WNT/ and W2K/ subdirs');
    console.log('  subdir keys:', Object.keys(m).filter(k => k.includes('/')).join(', '));
}
if (rawResults['core/np2kai/np2tool/hostdrvnt/hstdrvnt.hdm']) {
    const m = fileMap(rawResults['core/np2kai/np2tool/hostdrvnt/hstdrvnt.hdm']);
    ok(m['hdrvmnt.exe'] && m['hdrvmnt.exe'].size === 45056, 'hostdrvnt HDRVMNT.EXE size=45056');
    ok(m['readme.txt'] && m['readme.txt'].size === 5750, 'hostdrvnt README.TXT size=5750');
}

// ---- 2. .hdm → .d88 変換し、抽出が raw と一致 ----
console.log('\n[d88 round-trip] via tools/img2d88.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qbdi-'));
for (const rel of HDMS) {
    if (!rawResults[rel]) continue;
    const src = path.join(ROOT, rel);
    const d88 = path.join(tmp, path.basename(rel, '.hdm') + '.d88');
    try {
        execFileSync('python3', [path.join(ROOT, 'tools/img2d88.py'), src, d88], { stdio: 'pipe' });
    } catch (e) { ok(false, `img2d88 failed for ${rel}: ${e.message}`); continue; }
    const res = di.extractDiskImage(new Uint8Array(fs.readFileSync(d88)), path.basename(d88));
    ok(res.ok, `${path.basename(d88)} should extract`);
    if (!res.ok) continue;
    const a = JSON.stringify(fileMap(rawResults[rel]));
    const b = JSON.stringify(fileMap(res));
    ok(a === b, `d88 extraction must byte-match raw for ${path.basename(rel)}`);
    console.log(`  ${path.basename(d88)}: ${res.files.length} files, match=${a === b}`);
}

// ---- 3. FDI ヘッダ合成し、抽出が raw と一致 ----
console.log('\n[fdi synth] header + raw');
function synthFdi(raw, { sectorsize = 1024, sectors = 8, surfaces = 2, cylinders = 77, fddtype = 0x90, headersize = 4096 } = {}) {
    const out = new Uint8Array(headersize + raw.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0x04, fddtype, true);
    dv.setUint32(0x08, headersize, true);
    dv.setUint32(0x0c, sectorsize * sectors * surfaces * cylinders, true);
    dv.setUint32(0x10, sectorsize, true);
    dv.setUint32(0x14, sectors, true);
    dv.setUint32(0x18, surfaces, true);
    dv.setUint32(0x1c, cylinders, true);
    out.set(raw, headersize);
    return out;
}
for (const rel of HDMS) {
    if (!rawResults[rel]) continue;
    const raw = new Uint8Array(fs.readFileSync(path.join(ROOT, rel)));
    const fdi = synthFdi(raw);
    const res = di.extractDiskImage(fdi, 'synth.fdi');
    ok(res.ok, `synth.fdi from ${path.basename(rel)} should extract`);
    if (!res.ok) continue;
    const a = JSON.stringify(fileMap(rawResults[rel]));
    const b = JSON.stringify(fileMap(res));
    ok(a === b, `fdi extraction must byte-match raw for ${path.basename(rel)}`);
    console.log(`  synth.fdi (${path.basename(rel)}): ${res.files.length} files, match=${a === b}`);
}

// ---- 4. 自作の自己起動 .d88 は非FAT ----
console.log('\n[negative] hand-made self-boot .d88 should be non-FAT');
for (const rel of ['web/assets/loader.d88', 'web/assets/np2kai_boot.d88']) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { console.log('  (skip) ' + rel); continue; }
    const res = di.extractDiskImage(new Uint8Array(fs.readFileSync(p)), path.basename(p));
    ok(!res.ok, `${rel} should NOT extract (got ok=${res.ok}, files=${res.files ? res.files.length : 0})`);
    console.log(`  ${rel}: ok=${res.ok} reason="${res.reason || ''}"`);
}

// ---- 4b. FreeDOS boot.d88 は本物の FAT12 (深い入れ子の再帰検証) ----
console.log('\n[positive] FreeDOS boot.d88 is real FAT12 with deep subdirs');
{
    const p = path.join(ROOT, 'web/assets/boot.d88');
    if (fs.existsSync(p)) {
        const res = di.extractDiskImage(new Uint8Array(fs.readFileSync(p)), 'boot.d88');
        ok(res.ok, 'boot.d88 should extract (FreeDOS FAT12)');
        if (res.ok) {
            const m = fileMap(res);
            ok(!!m['kernel.sys'] && !!m['command.com'], 'boot.d88 has KERNEL.SYS + COMMAND.COM');
            ok(Object.keys(m).some(k => k.split('/').length >= 3),
               'boot.d88 recurses 3+ level subdirs (e.g. DOC/COMMAND/DBCS/...)');
            console.log(`  ${res.files.length} files, deepest=${Math.max(...res.files.map(f => f.name.split('/').length))} levels`);
        }
    }
}

// ---- 5. 恒久対応外の拡張子 ----
console.log('\n[unsupported ext]');
for (const ext of ['nfd', 'fdd', 'ddb']) {
    const res = di.extractDiskImage(new Uint8Array(16), 'x.' + ext);
    ok(!res.ok && /対応外/.test(res.reason), `.${ext} should be rejected as unsupported`);
    console.log(`  .${ext}: ${res.reason}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n==== pass=${pass} fail=${fail} ====`);
process.exit(fail ? 1 : 0);
