#!/usr/bin/env node
// quubee_run_test.js — headless CLI (tools/quubee_run.js) の回帰。
//
// 素材は games/liotest.zip (報告者提供・再配布不可・ローカル限定)。無ければ SKIP (CI 安全)。
// 見るもの:
//   1. ZIP 入力 + --exe 明示で完走し、JSON に wasm SHA と HLE 注意書き (note) が必ず載る
//   2. 実行ファイル複数の書庫を --exe 無しで食わせると「候補を列挙して」エラー終了する (正直な失敗)
//   3. --keys でキーが届く: キー無し = 静止 (animated=false) / RETURN 投入 = 画面が進む (animated=true)
// 実行: node tools/quubee_run_test.js

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'tools', 'quubee_run.js');
const ZIP = path.join(ROOT, 'games', 'liotest.zip');

if (!fs.existsSync(ZIP)) { console.log('SKIP — games/liotest.zip 不在 (ローカル限定素材)'); process.exit(0); }

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function run(args) {
    const r = cp.spawnSync('node', [CLI, ...args], { encoding: 'utf8', timeout: 240000 });
    let json = null;
    try { json = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (_) {}
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}

// 1. ZIP + --exe: 完走・素性 (wasm SHA)・HLE 注意書き
const a = run([ZIP, '--exe', 'T1.EXE', '--frames', '600', '--quiet']);
check('ZIP+--exe が exit 0', a.status === 0, 'status=' + a.status + ' ' + a.stderr.slice(0, 200));
check('JSON が出る', !!a.json);
check('wasm SHA を伴う', !!(a.json && /^[0-9a-f]{16}$/.test(a.json.wasm)), a.json && a.json.wasm);
check('HLE 注意書き (note) を伴う', !!(a.json && /not real DOS/.test(a.json.note || '')));
check('tier/state が付く', !!(a.json && a.json.tier && a.json.state));
const aAnim = a.json ? a.json.animated : null;

// 2. --exe 無し (T1/T2 の 2 本入り) は候補列挙つきの正直な失敗
const b = run([ZIP, '--frames', '60']);
check('曖昧な書庫は非 0 で終了', b.status !== 0, 'status=' + b.status);
check('候補 (T1/T2) を列挙する', /T1\.EXE/.test(b.stderr) && /T2\.EXE/.test(b.stderr), b.stderr.slice(0, 200));

// 3. --keys が届く (キー無し静止 vs RETURN で進む)
const c = run([ZIP, '--exe', 'T1.EXE', '--frames', '900', '--keys', 'RETURN@300,RETURN@500', '--quiet']);
check('--keys 付きが exit 0', c.status === 0, 'status=' + c.status + ' ' + c.stderr.slice(0, 200));
check('キー無しは静止 (animated=false)', aAnim === false, 'animated=' + aAnim);
check('RETURN 投入で画面が進む (animated=true)', !!(c.json && c.json.animated === true),
    c.json && 'animated=' + c.json.animated);

console.log(`\nquubee_run_test: ${pass} PASS / ${fail} FAIL` + (a.json ? `  (wasm ${a.json.wasm})` : ''));
process.exit(fail ? 1 : 0);
