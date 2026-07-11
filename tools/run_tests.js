#!/usr/bin/env node
// 一括テストランナー — tools/*_test.js を 1 コマンドで並列実行する (2026-07-11)。
//
// 背景: headless 回帰は 69 本 (tools/*_test.js) に育ったが、全部を回す仕組みが無く
//   「どのテストを回すか」を毎回人が選んでいた。横断リファクタ (例: .bat 経路 ②→③ 統合) の
//   安全網として、全回帰を 1 コマンド・並列・要約付きにする。並列プールと個別タイムアウトは
//   bio100_triage.js の型 (1 本 = 1 子プロセス + SIGKILL) を流用。
//
// 各テストの規約 (既存 69 本が全て従う):
//   - 成功       → exit 0
//   - 失敗       → exit 非 0
//   - 前提不足   → 行頭 "SKIP — 理由" を出力して exit 0 (games/ 等 local-only 素材の不在など)
//
// 分類: PASS / SKIP / FAIL / TIMEOUT。FAIL と TIMEOUT があれば出力末尾を添えて exit 1。
//
// 使い方: node tools/run_tests.js [filter] [--jobs N] [--timeout S] [--list]
//   filter   = ファイル名の部分一致 (例: "pmd" → pmd_*_test.js だけ)
//   --jobs   = 並列数 (既定 min(8, CPU数))
//   --timeout= 1 本あたりの上限秒 (既定 300、超過は SIGKILL して TIMEOUT)
//   --list   = 対象一覧を出して終了

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const os   = require('os');

const TOOLS = __dirname;
const ROOT  = path.join(__dirname, '..');

function parseArgs(argv) {
    const opts = { filter: '', jobs: Math.min(8, os.cpus().length || 4), timeout: 300, list: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--jobs' || a === '-j') opts.jobs = Math.max(1, parseInt(argv[++i], 10) || opts.jobs);
        else if (a === '--timeout') opts.timeout = Math.max(5, parseInt(argv[++i], 10) || opts.timeout);
        else if (a === '--list') opts.list = true;
        else if (!a.startsWith('-')) opts.filter = a.toLowerCase();
    }
    return opts;
}

// 1 テスト = 1 子プロセス。stdout/stderr を丸ごと保持し、timeout 超過は SIGKILL。
function runOne(file, timeoutMs) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const child = cp.spawn(process.execPath, [path.join(TOOLS, file)],
                               { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', timedOut = false;
        const killTimer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch (_) {} }, timeoutMs);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        child.on('close', (code) => {
            clearTimeout(killTimer);
            const sec = (Date.now() - t0) / 1000;
            const skipLine = out.split('\n').find((l) => /^SKIP\b/.test(l));
            let status;
            if (timedOut) status = 'TIMEOUT';
            else if (code === 0 && skipLine) status = 'SKIP';
            else if (code === 0) status = 'PASS';
            else status = 'FAIL';
            resolve({ file, status, sec, code, out, skipReason: skipLine ? skipLine.replace(/^SKIP\s*[—-]?\s*/, '') : '' });
        });
    });
}

async function runPool(files, jobs, timeoutMs, onDone) {
    const results = [];
    let idx = 0;
    async function worker() {
        while (idx < files.length) {
            const file = files[idx++];
            const res = await runOne(file, timeoutMs);
            results.push(res);
            onDone(res, results.length, files.length);
        }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, () => worker()));
    return results;
}

const ICON = { PASS: '✓', SKIP: '–', FAIL: '✗', TIMEOUT: '⏱' };

(async () => {
    const opts = parseArgs(process.argv);
    const files = fs.readdirSync(TOOLS)
        .filter((f) => f.endsWith('_test.js'))
        .filter((f) => !opts.filter || f.toLowerCase().includes(opts.filter))
        .sort();
    if (!files.length) { console.error(`filter "${opts.filter}" に一致するテストなし`); process.exit(2); }
    if (opts.list) { files.forEach((f) => console.log(f)); return; }

    const t0 = Date.now();
    console.log(`run_tests: ${files.length} 本  jobs=${opts.jobs} timeout=${opts.timeout}s`);
    const width = Math.max(...files.map((f) => f.length));
    const results = await runPool(files, opts.jobs, opts.timeout * 1000, (r, done, total) => {
        const extra = r.status === 'SKIP' ? `  (${r.skipReason})`
                    : r.status === 'FAIL' ? `  (exit ${r.code})` : '';
        console.log(`  ${ICON[r.status]} ${r.file.padEnd(width)} ${r.status.padEnd(7)} ${r.sec.toFixed(1)}s${extra}  [${done}/${total}]`);
    });

    const tally = { PASS: 0, SKIP: 0, FAIL: 0, TIMEOUT: 0 };
    for (const r of results) tally[r.status]++;
    const totalSec = (Date.now() - t0) / 1000;

    console.log('');
    console.log(`計 ${results.length} 本 / PASS ${tally.PASS}  SKIP ${tally.SKIP}  FAIL ${tally.FAIL}  TIMEOUT ${tally.TIMEOUT}  (${totalSec.toFixed(0)}s)`);
    const slow = results.slice().sort((a, b) => b.sec - a.sec).slice(0, 5);
    console.log('遅い順: ' + slow.map((r) => `${r.file.replace(/_test\.js$/, '')} ${r.sec.toFixed(0)}s`).join(' / '));

    const bad = results.filter((r) => r.status === 'FAIL' || r.status === 'TIMEOUT');
    for (const r of bad) {
        console.log(`\n===== ${r.file} — ${r.status}${r.status === 'FAIL' ? ` (exit ${r.code})` : ` (${opts.timeout}s 超過)`} — 出力末尾 =====`);
        const lines = r.out.trimEnd().split('\n');
        console.log(lines.slice(-25).map((l) => '  ' + l).join('\n'));
    }
    process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
