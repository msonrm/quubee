#!/usr/bin/env node
// compat_survey.js — 手持ちのコーパスで「HLE-DOS の何が足りないか」を数える (2026-09-27、PC98PLAYER からの
// 取り込み候補の優先順位づけ)。
//
// games/ の書庫を展開し、書庫ごとに起動の対象を選んで headless で走らせ、次を記録する:
//   - INT 21h の未対応 (AH 単位、machine.js int21Stats) と、使った AH の一覧
//   - XMS / EMS / EMMXXXX0 open / INT 33h の問い合わせ回数 (np2kai_debug_memprobe)
//   - 終了したか・画面の色数 (動いたかの目安)
// 対象の選び方: その書庫の .bat のうち batscript.js の文インタプリタで通るもの全部 (ブラウザの Run と同じ)。
// 通る .bat が無ければ、実行ファイル (.exe/.com) を大きい順に 4 本 (音源ドライバ名は除く)。
// 1 対象 = 1 子プロセス (同一プロセスで wasm を何度も作ると止まる。bio100_triage.js と同じ理由)。
//
// これは「このコーパスでは」の数字: 動作確認のために集めた書庫なので、すでに動くものに偏っている。
// 無入力 + Enter/Space 数回で届く範囲しか踏まない (ゲーム中盤の機能は見えない)。
//
// 使い方: node tools/compat_survey.js [--jobs N] [--frames N] [--fresh] [filter]
//   結果は WORK/results.json に逐次保存 (再実行は済みを飛ばす)。最後に集計を表示。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const GAMES = path.join(ROOT, 'games');
const WORK = process.env.WORK || '/tmp/qb_compat_survey';
const CACHE = path.join(WORK, 'results.json');
const DIRS = ['bio_100', 'game', 'tool', 'mem_test', 'driver', 'touhou', 'music'];
const MARK = '__SURVEY__';
const bat = require(path.join(ROOT, 'web', 'player', 'batscript.js'));

// ---- 展開と対象の選択 ----
function extract(arcPath) {
    const dir = path.join(WORK, 'x', path.relative(GAMES, arcPath).replace(/[\\/]/g, '__'));
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        if (/\.zip$/i.test(arcPath)) cp.spawnSync('unzip', ['-qq', '-o', arcPath, '-d', dir], { stdio: 'ignore' });
        else cp.spawnSync('lha', ['xw=' + dir, arcPath], { stdio: 'ignore' });   // .lzh と自己展開 .exe
    }
    return dir;
}
function walk(dir, rel = '') {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel + e.name;
        if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r + '/'));
        else out.push(r);
    }
    return out;
}
function targetsOf(arcPath) {
    const root = extract(arcPath);
    const all = walk(root);
    const out = [];
    for (const b of all.filter((n) => /\.bat$/i.test(n))) {
        const base = path.join(root, path.dirname(b));
        const names = walk(base);
        const stmts = bat.buildStatements(bat.parse(fs.readFileSync(path.join(root, b))), names, '',
            (n) => { try { return fs.readFileSync(path.join(base, n)); } catch (_) { return null; } });
        if (stmts) out.push({ dir: base, bat: path.basename(b), label: b });
    }
    if (out.length) return out;
    const exes = all.filter((n) => /\.(exe|com)$/i.test(n))
        .filter((n) => !bat.DRIVER_NAMES.has(path.basename(n).toLowerCase().replace(/\.(exe|com)$/, '')))
        .map((n) => ({ n, size: fs.statSync(path.join(root, n)).size }))
        .sort((a, b) => b.size - a.size).slice(0, 4);
    return exes.map(({ n }) => ({ dir: path.join(root, path.dirname(n)), exe: path.basename(n), label: n }));
}

// ---- 子プロセス: 1 対象を走らせる ----
async function runOne(t, frames) {
    const { Machine } = require('./lib/machine');
    let dir = t.dir, batName = t.bat;
    if (t.exe) {   // 実行ファイル単体: 写しを作って 1 行の .bat で起動する
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey_'));
        cp.spawnSync('cp', ['-r', t.dir + '/.', dir]);
        batName = '__RUN__.BAT';
        fs.writeFileSync(path.join(dir, batName), t.exe + '\r\n');
    }
    const m = await Machine.boot({ dir, bat: batName });
    const tap = (code) => { m.M.ccall('np2kai_key_down', null, ['number', 'number'], [m.h, code]); m.runFrames(2); m.M.ccall('np2kai_key_up', null, ['number', 'number'], [m.h, code]); };
    let maxColors = 0, exited = false, f = 0;
    const colors = () => { const fb = m.M.ccall('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number'], [m.h, m._wP, m._hP, m._bP]);
        const w = m.M.HEAP32[m._wP >> 2], h = m.M.HEAP32[m._hP >> 2]; if (!fb || w <= 0) return 0;
        const set = new Set(), base = fb >> 1; for (let i = 0; i < w * h; i += 17) set.add(m.M.HEAPU16[base + i]); return set.size; };
    for (; f < frames; f += 100) {
        m.runFrames(100);
        if (f === 400 || f === 800) tap(0x1c);   // Enter
        if (f === 1100) tap(0x34);               // Space
        maxColors = Math.max(maxColors, colors());
        if (m.M.ccall('np2kai_dos_get_exit', 'number', ['number'], [0])) { exited = true; break; }
    }
    const st = m.int21Stats();
    const mp = (i) => m.M.ccall('np2kai_debug_memprobe', 'number', ['number', 'number'], [m.h, i]);
    return { calls: Object.keys(st.calls), unimpl: st.unimplemented,
        probe: { xms: mp(0), ems: mp(1), emmOpen: mp(2), mouse33: mp(3) }, exited, frames: f, maxColors };
}

// ---- 親: 並列に回して集計 ----
function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (_) { return {}; } }
function spawnOne(t, frames, timeoutMs) {
    return new Promise((resolve) => {
        const ch = cp.spawn(process.execPath, [__filename, '--one', JSON.stringify(t), String(frames)], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        const timer = setTimeout(() => { ch.kill('SIGKILL'); }, timeoutMs);
        ch.stdout.on('data', (d) => { out += d; });
        ch.on('close', () => {
            clearTimeout(timer);
            const line = out.split('\n').find((l) => l.startsWith(MARK));
            resolve(line ? JSON.parse(line.slice(MARK.length)) : { error: 'timeout or crash' });
        });
    });
}
function report(results) {
    const rows = Object.entries(results);
    const byArc = (pred) => new Set(rows.filter(([, r]) => pred(r)).map(([k]) => k.split('|')[0]));
    console.log(`\n対象 ${rows.length} (書庫 ${new Set(rows.map(([k]) => k.split('|')[0])).size}) / 失敗 ${rows.filter(([, r]) => r.error).length}`);
    const un = {};
    for (const [k, r] of rows) for (const [ah, n] of Object.entries(r.unimpl || {})) (un[ah] = un[ah] || []).push({ k, n });
    console.log('\nINT 21h の未対応 (AH / 踏んだ書庫の数 / 対象)');
    for (const [ah, list] of Object.entries(un).sort((a, b) => b[1].length - a[1].length))
        console.log(`  AH=${ah}  ${new Set(list.map((x) => x.k.split('|')[0])).size} 書庫  ` + list.map((x) => `${x.k.split('|')[1]}(${x.n})`).join(' '));
    for (const [name, key] of [['EMS (INT 67h)', 'ems'], ['EMMXXXX0 open', 'emmOpen'], ['XMS (INT 2Fh 43h)', 'xms'], ['INT 33h', 'mouse33']]) {
        const s = byArc((r) => r.probe && r.probe[key] > 0);
        console.log(`${name.padEnd(18)} ${s.size} 書庫  ${[...s].join(' ')}`);
    }
    const dead = rows.filter(([, r]) => !r.error && r.maxColors <= 3 && !r.exited);
    console.log(`\n色 3 以下で終了もしない (止まっている疑い) ${dead.length}: ` + dead.map(([k]) => k).join(' '));
}

(async () => {
    const argv = process.argv.slice(2);
    if (argv[0] === '--one') {
        const r = await runOne(JSON.parse(argv[1]), Number(argv[2]));
        process.stdout.write(MARK + JSON.stringify(r) + '\n');
        process.exit(0);
    }
    const opt = { jobs: Math.min(6, os.cpus().length), frames: 1500, fresh: false, filter: '' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--jobs') opt.jobs = Number(argv[++i]);
        else if (argv[i] === '--frames') opt.frames = Number(argv[++i]);
        else if (argv[i] === '--fresh') opt.fresh = true;
        else opt.filter = argv[i].toLowerCase();
    }
    fs.mkdirSync(WORK, { recursive: true });
    const results = opt.fresh ? {} : loadCache();
    const arcs = [];
    for (const d of DIRS) {
        const p = path.join(GAMES, d);
        if (!fs.existsSync(p)) continue;
        for (const f of fs.readdirSync(p)) if (/\.(lzh|zip)$/i.test(f) || (d === 'touhou' && /\.exe$/i.test(f))) arcs.push(path.join(p, f));
    }
    const todo = [];
    for (const a of arcs) {
        const key = path.relative(GAMES, a);
        if (opt.filter && !key.toLowerCase().includes(opt.filter)) continue;
        for (const t of targetsOf(a)) { const k = key + '|' + t.label; if (!results[k]) todo.push([k, t]); }
    }
    console.log(`書庫 ${arcs.length} / これから走らせる対象 ${todo.length} (済み ${Object.keys(results).length})`);
    let i = 0, done = 0;
    await Promise.all(Array.from({ length: opt.jobs }, async () => {
        while (i < todo.length) {
            const [k, t] = todo[i++];
            results[k] = await spawnOne(t, opt.frames, 180000);
            fs.writeFileSync(CACHE, JSON.stringify(results));
            done++;
            const r = results[k];
            console.log(`[${done}/${todo.length}] ${k}  ${r.error || `unimpl ${JSON.stringify(r.unimpl)} probe ${JSON.stringify(r.probe)} colors ${r.maxColors}${r.exited ? ' exit' : ''}`}`);
        }
    }));
    report(results);
})().catch((e) => { console.error(e); process.exit(1); });
