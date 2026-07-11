#!/usr/bin/env node
// quubee_run.js — 書庫/ディレクトリを 1 コマンドで起動し、観察結果を JSON で報告する headless CLI。
//
// bio100_triage.js の「1 本走らせて分類する」部分の一般化 + machine.js の観測
// (スクリーンショット/テキスト VRAM/音声 RMS)。MCP アダプタ (「目と耳」を渡す) の土台。
//
// ⚠ 位置づけ: QuuBee の HLE-DOS は実 DOS ではない (差異の正典 = docs/dos_hle_gaps.md)。
//   この出力は「実機/実 DOS で動く」ことの証明ではなく、煙感知器と計測器 (動く兆候・
//   落ちる兆候の検出) として使うこと。JSON の note フィールドにも常にこの旨を含める。
//
// 使い方:
//   node tools/quubee_run.js <game.lzh|.lha|.lzs|.zip|ディレクトリ> [options]
//     --bat NAME       起動 .bat を明示 (既定: 自動解決 — buildStatements が通る .bat を採用)
//     --exe NAME       起動実行ファイルを明示 (.bat 解決より優先。単一 .exe/.com なら自動)
//     --args "..."     コマンドライン引数 (.bat の %1.. / 単一起動の cmdline)
//     --frames N       観察フレーム数 (既定 3000 ≒ エミュ 53 秒)
//     --multiple N     クロック倍率 (既定 20 = headless 正典。回帰の暖機前提と同じ)
//     --screenshot F   終了時点の画面を PNG で保存
//     --text           テキスト VRAM 25 行を JSON に含める
//     --audio SEC      末尾 SEC 秒の音声を汲んで RMS を測る (発音の煙感知)
//     --keys SPEC      キー投入 "RETURN@500,SPACE@1200" (NKEY 名@フレーム。6 フレーム保持)
//     --quiet          JSON 1 行のみ出力 (機械消費用)
//
// 制約 (v1):
//   - 書庫のサブディレクトリは /run に持ち込まない (トップレベルのファイルのみ。triage と同じ)
//   - ディスクイメージ (.d88/.fdi 等) 入力は未対応 (diskimage.js 統合は次段)
//   - キー入力は投入のみ (対話ループは MCP 段で)

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const { Machine, NKEY } = require('./lib/machine');
const tier = require('./lib/tier');
const qbBatScript = require(path.join(WEB, 'player', 'batscript.js'));
const qbArchive = require(path.join(WEB, 'player', 'archive.js'));

const NOTE = 'QuuBee HLE-DOS is not real DOS (see docs/dos_hle_gaps.md). ' +
    'Treat results as smoke detection + instrumentation, not real-machine compatibility proof.';

function usage(msg) {
    if (msg) console.error('ERROR: ' + msg);
    console.error('usage: node tools/quubee_run.js <game.lzh|.zip|dir> [--bat N] [--exe N] [--args S]');
    console.error('       [--frames N] [--multiple N] [--screenshot F] [--text] [--audio SEC]');
    console.error('       [--keys "RETURN@500,SPACE@1200"] [--quiet]');
    process.exit(2);
}

function parseArgs(argv) {
    const o = { frames: 3000, multiple: 20, args: '', text: false, quiet: false };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => { if (++i >= argv.length) usage(a + ' の値が無い'); return argv[i]; };
        if (a === '--bat') o.bat = next();
        else if (a === '--exe') o.exe = next();
        else if (a === '--args') o.args = next();
        else if (a === '--frames') o.frames = +next() | 0;
        else if (a === '--multiple') o.multiple = +next() | 0;
        else if (a === '--screenshot') o.screenshot = next();
        else if (a === '--text') o.text = true;
        else if (a === '--audio') o.audio = +next();
        else if (a === '--keys') o.keys = next();
        else if (a === '--quiet') o.quiet = true;
        else if (a.startsWith('--')) usage('未知のオプション: ' + a);
        else rest.push(a);
    }
    if (rest.length !== 1) usage('入力 (書庫かディレクトリ) をちょうど 1 つ指定してください');
    o.input = rest[0];
    if (!(o.frames > 0)) usage('--frames は正の整数');
    return o;
}

/* --- キー投入 "NAME@FRAME,..." → Map(frame → NKEY 値) --- */
function parseKeys(spec) {
    const plan = new Map();
    if (!spec) return plan;
    for (const part of spec.split(',')) {
        const m = /^([A-Z0-9_]+)@(\d+)$/i.exec(part.trim());
        if (!m) usage('--keys の書式が不正: ' + part);
        const key = NKEY[m[1].toUpperCase()];
        if (key === undefined) usage('NKEY に無いキー名: ' + m[1]);
        plan.set(+m[2], key);
    }
    return plan;
}

/* --- 書庫 → 作業ディレクトリ。名前は SJIS 生バイトの latin1 写像のまま扱う (MEMFS 正準形)。
 *     区切りは '/' のみ (0x5C は SJIS 2 バイト目と衝突するため区切りとして扱わない)。 --- */
async function stageInput(input) {
    const st = fs.statSync(input);
    if (st.isDirectory()) {
        // ユーザーのディレクトリを汚さない (合成 .bat を書くことがある) ため一時ディレクトリへ複製
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quubee_run_'));
        for (const nb of fs.readdirSync(input, { encoding: 'buffer' })) {
            const src = Buffer.concat([Buffer.from(input + '/'), nb]);
            if (!fs.statSync(src).isFile()) continue;
            fs.writeFileSync(Buffer.concat([Buffer.from(dir + '/'), nb]), fs.readFileSync(src));
        }
        return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    }

    const buf = fs.readFileSync(input);
    let entries;
    if (/\.(lzh|lha|lzs)$/i.test(input)) entries = qbArchive.parseLzh(new Uint8Array(buf));
    else if (/\.zip$/i.test(input)) entries = await qbArchive.parseZip(new Uint8Array(buf));
    else usage('未対応の入力形式 (対応: .lzh/.lha/.lzs/.zip/ディレクトリ): ' + input);
    if (!entries || !entries.length) throw new Error('書庫からエントリを取り出せなかった: ' + input);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quubee_run_'));
    for (const e of entries) {
        if (!e.data) continue;
        const parts = e.name.split('/').filter((p) => p && p !== '.' && p !== '..');
        if (!parts.length) continue;
        let cur = dir;
        for (const p of parts.slice(0, -1)) {
            cur = path.join(cur, Buffer.from(p, 'latin1').toString('latin1'));
            if (!fs.existsSync(cur)) fs.mkdirSync(cur);
        }
        fs.writeFileSync(Buffer.from(path.join(cur, parts[parts.length - 1]), 'latin1'), e.data);
    }
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/* --- 起動計画: --exe > .bat 自動解決 > 単一 .exe/.com。triage の planLaunch と同じ考え方。
 *     単一起動も stage_batch (③ 文インタプリタ) に乗せるため 1 行 .bat を合成する
 *     (bench_ray.js と同型・Machine.boot の正典経路に一本化)。 --- */
function planLaunch(dir, opts) {
    const names = fs.readdirSync(dir).filter((f) => {
        try { return fs.statSync(path.join(dir, f)).isFile(); } catch (_) { return false; }
    });
    if (opts.exe) {
        const exe = names.find((f) => f.toLowerCase() === opts.exe.toLowerCase());
        if (!exe) throw new Error('--exe が見つからない: ' + opts.exe + ' (候補: ' + names.join(' ') + ')');
        return synth(dir, names, exe, opts.args);
    }
    const bats = names.filter((n) => /\.bat$/i.test(n) && !/^__RUN__/i.test(n)).sort();
    const tryBats = opts.bat ? [opts.bat] : bats;
    for (const b of tryBats) {
        const f = names.find((n) => n.toLowerCase() === b.toLowerCase());
        if (!f) { if (opts.bat) throw new Error('--bat が見つからない: ' + b); continue; }
        const recipe = qbBatScript.parse(fs.readFileSync(path.join(dir, f)));
        const stmts = qbBatScript.buildStatements(recipe, names, opts.args);
        const cmds = stmts ? stmts.filter((s) => s.op === 'cmd') : [];
        if (cmds.length) {
            const main = cmds.find((c) => {
                const key = c.name.toLowerCase().replace(/\.(com|exe|bat)$/, '');
                return !qbBatScript.DRIVER_NAMES.has(key);
            }) || cmds[cmds.length - 1];
            return { bat: f, names, label: `bat:${f}→${main.name}${cmds.length > 1 ? '+drv' : ''}` };
        }
        if (opts.bat) throw new Error('--bat から起動列を組めなかった: ' + b);
    }
    const exes = names.filter((n) => /\.(exe|com)$/i.test(n));
    if (exes.length === 1) return synth(dir, names, exes[0], opts.args);
    throw new Error(exes.length === 0
        ? '起動対象が見つからない (.bat 解決不能・実行ファイル無し)'
        : '実行ファイルが複数あり選べない。--exe で指定してください: ' + exes.join(' '));
}
function synth(dir, names, exe, args) {
    const bat = '__RUN__.BAT';
    fs.writeFileSync(path.join(dir, bat), exe + (args ? ' ' + args : '') + '\r\n');
    return { bat, names: names.concat(bat), label: `exe:${exe}${args ? ' ' + args : ''} (合成 .bat)`, synthetic: true };
}

(async () => {
    const opts = parseArgs(process.argv.slice(2));
    const keys = parseKeys(opts.keys);
    const staged = await stageInput(opts.input);
    let result;
    try {
        const plan = planLaunch(staged.dir, opts);
        const m = await Machine.boot({
            dir: staged.dir, bat: plan.bat, args: plan.synthetic ? '' : opts.args,
            multiple: opts.multiple,
        });

        // --- 観察ループ: 途中 4 点 + 最終でフレームバッファをサンプル。位置は triage の
        //     SAMPLE_AT (800/1500/2200/2900 ÷ 3000) と同比率に揃える (分類の互換性のため) ---
        const sampleAt = new Set([800, 1500, 2200, 2900].map((f) => Math.floor(opts.frames * f / 3000)));
        let maxColors = 0, exited = false;
        const hashes = [];
        const sample = () => {
            const { ptr, w, h } = m.framebuffer();
            const met = tier.fbMetrics(m.M, ptr, w, h);
            if (met.colors > maxColors) maxColors = met.colors;
            hashes.push(met.hash);
        };
        for (let f = 0; f < opts.frames; f++) {
            const k = keys.get(f);
            if (k !== undefined) m.pressKey(k, 6);
            m.runFrames(1);
            if (sampleAt.has(f)) sample();
            if (m.exited()) { exited = true; break; }
        }
        sample();
        if (opts.audio && !exited) {
            var pcm = m.captureAudio(opts.audio);
            sample();   // 音声汲みでフレームが進むため最終画面を取り直す
        }

        const pc = m.M.ccall('np2kai_debug_get_linear_pc', 'number', ['number'], [m.h]) >>> 0;
        const animated = new Set(hashes.filter((x) => x !== 0)).size >= 2;
        const state = tier.classifyPc(pc, exited);
        const t = tier.classifyTier(state, maxColors, animated);

        result = {
            input: opts.input,
            launch: plan.label,
            frames: m.frame,
            tier: t,
            state,
            pc: '0x' + pc.toString(16).toUpperCase(),
            maxColors,
            animated,
            exited,
            batchDone: m.batchDone(),
            xms: m.xms(),
            wasm: m.info().wasm.sha256.slice(0, 16),
            multiple: opts.multiple,
            note: NOTE,
        };
        if (opts.audio) {
            if (pcm) {
                let sum = 0;
                for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
                result.audioRms = pcm.length ? Math.round(Math.sqrt(sum / pcm.length)) : 0;
            } else {
                result.audioRms = null;   // プログラムが終了済みで計測できなかった
            }
            result.audioSeconds = opts.audio;
        }
        if (opts.text) result.textVram = m.textVram();
        if (opts.screenshot) { m.screenshotPng(opts.screenshot); result.screenshot = opts.screenshot; }
    } finally {
        if (staged.cleanup) staged.cleanup();
    }

    if (!opts.quiet) {
        const ICON = { ALIVE: '●', RENDER: '◐', BOOT: '▫', WAIT: '⌨', EXIT: '⏏', CRASH: '✗', BUSY: '?' };
        console.error(`${ICON[result.tier] || '?'} ${result.tier} (${result.state})  ` +
            `colors=${result.maxColors} ${result.animated ? 'anim' : 'still'}  ` +
            `pc=${result.pc}  launch=${result.launch}`);
        if (result.tier === 'CRASH') console.error('  ※ CRASH は偽陰性がありうる (GETS 前例)。ブラウザ確認候補として扱う。');
    }
    console.log(JSON.stringify(result));
})().catch((e) => { console.error('quubee_run ERROR: ' + (e && e.message || e)); process.exit(1); });
