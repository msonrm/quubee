#!/usr/bin/env node
// bat_ab_compare.js — .bat の実行を旧方式 (JS の事前線形化) と新方式 (C の実行時解釈) で比べる
// (2026-09-27、dos_batch.c への移行の確認)。compat_survey.js が展開した書庫 (WORK/x) の .bat を、
// 両方式で同じ打鍵のもと走らせ、画面ハッシュ・テキスト 1 行目・終了したか・EXEC した列を比べる。
// 旧方式で buildStatements が null (= 旧方式ではそもそも .bat として走らない) ものは新方式だけ走らせる。
// 1 対象 1 子プロセス。使い方: node tools/bat_ab_compare.js [--frames N] [filter]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const WORK = process.env.WORK || '/tmp/qb_compat_survey';
const bat = require(path.join(ROOT, 'web', 'player', 'batscript.js'));
const MARK = '__AB__';

function walk(dir, rel = '') {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel + e.name;
        if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r + '/')); else out.push(r);
    }
    return out;
}
async function runOne(dir, batName, legacy, frames) {
    const { Machine } = require('./lib/machine');
    const execs = [];
    const m = await Machine.boot({ dir, bat: batName, legacyBat: legacy, quiet: false });
    const tap = (code) => { m.M.ccall('np2kai_key_down', null, ['number', 'number'], [m.h, code]); m.runFrames(2); m.M.ccall('np2kai_key_up', null, ['number', 'number'], [m.h, code]); };
    let exited = false;
    for (let f = 0; f < frames; f += 100) {
        m.runFrames(100);
        if (f === 400 || f === 800) tap(0x1c);
        if (m.M.ccall('np2kai_dos_get_exit', 'number', ['number'], [0])) { exited = true; break; }
    }
    const t = m.textVram();
    return { screen: m.screenHash(), row0: t[0].trim().slice(0, 40), rows: t.slice(0, 25).join('\n').trim().slice(0, 400), exited };
}
(async () => {
    const argv = process.argv.slice(2);
    if (argv[0] === '--one') {
        const [dir, b, legacy, frames] = argv.slice(1);
        // C の stderr から EXEC の列を拾う
        const lines = [];
        const orig = process.stderr.write.bind(process.stderr);
        process.stderr.write = (s) => { lines.push(String(s)); return true; };
        let r;
        try { r = await runOne(dir, b, legacy === '1', Number(frames)); } catch (e) { r = { error: String(e.message || e) }; }
        process.stderr.write = orig;
        const all = lines.join('');
        r.execs = [...all.matchAll(/EXEC child=(\S+)/g)].map((x) => x[1].toUpperCase());
        process.stdout.write(MARK + JSON.stringify(r) + '\n');
        process.exit(0);
    }
    let frames = 1200, filter = '';
    for (let i = 0; i < argv.length; i++) { if (argv[i] === '--frames') frames = Number(argv[++i]); else filter = argv[i].toLowerCase(); }
    const X = path.join(WORK, 'x');
    const jobs = [];
    for (const arc of fs.readdirSync(X)) {
        const root = path.join(X, arc);
        for (const b of walk(root).filter((n) => /\.bat$/i.test(n))) {
            if (filter && !(arc + '/' + b).toLowerCase().includes(filter)) continue;
            const base = path.join(root, path.dirname(b));
            const names = walk(base);
            const ok = !!bat.buildStatements(bat.parse(fs.readFileSync(path.join(root, b))), names, '',
                (n) => { try { return fs.readFileSync(path.join(base, n)); } catch (_) { return null; } });
            jobs.push({ key: arc + '/' + b, dir: base, bat: path.basename(b), legacyOk: ok });
        }
    }
    const one = (j, legacy) => new Promise((resolve) => {
        const ch = cp.spawn(process.execPath, [__filename, '--one', j.dir, j.bat, legacy ? '1' : '0', String(frames)], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = ''; const timer = setTimeout(() => ch.kill('SIGKILL'), 180000);
        ch.stdout.on('data', (d) => { out += d; });
        ch.on('close', () => { clearTimeout(timer); const l = out.split('\n').find((x) => x.startsWith(MARK)); resolve(l ? JSON.parse(l.slice(MARK.length)) : { error: 'timeout/crash' }); });
    });
    let i = 0; const res = [];
    await Promise.all(Array.from({ length: Math.min(6, os.cpus().length) }, async () => {
        while (i < jobs.length) {
            const j = jobs[i++];
            const [a, b] = await Promise.all([j.legacyOk ? one(j, true) : Promise.resolve(null), one(j, false)]);
            const same = a && !a.error && !b.error && a.screen === b.screen && a.row0 === b.row0 && a.exited === b.exited && a.execs.join() === b.execs.join();
            res.push({ j, a, b, same });
            console.log(`${same ? 'SAME' : a ? 'DIFF' : 'NEW '} ${j.key}` + (same ? '' : `\n   旧: ${a ? (a.error || `execs=${a.execs.join(',')} exit=${a.exited} row0="${a.row0}" screen=${a.screen}`) : '(旧方式では .bat として走らない)'}\n   新: ${b.error || `execs=${b.execs.join(',')} exit=${b.exited} row0="${b.row0}" screen=${b.screen}`}`));
        }
    }));
    console.log(`\n計 ${res.length}: 同じ ${res.filter((r) => r.same).length} / 違う ${res.filter((r) => r.a && !r.same).length} / 新方式だけ ${res.filter((r) => !r.a).length}`);
})().catch((e) => { console.error(e); process.exit(1); });
