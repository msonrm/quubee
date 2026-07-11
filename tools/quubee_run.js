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
//     --y2k-clamp      RTC の Y2K クランプ (1999 固定) を ON にする。既定 OFF = 実時計
//                      (2026 年の実機相当。計測器は Y2K バグの煙を隠さない。ブラウザは ON 相当)
//     --quiet          JSON 1 行のみ出力 (機械消費用)
//
// 制約 (v1):
//   - 書庫のサブディレクトリは /run に持ち込まない (トップレベルのファイルのみ。triage と同じ)
//   - ディスクイメージ (.d88/.fdi 等) 入力は未対応 (diskimage.js 統合は次段)
//   - キー入力は投入のみ (対話ループは MCP 段で)

const { Machine, NKEY } = require('./lib/machine');
const tier = require('./lib/tier');
const { NOTE, stageInput, planLaunch } = require('./lib/stage');

function usage(msg) {
    if (msg) console.error('ERROR: ' + msg);
    console.error('usage: node tools/quubee_run.js <game.lzh|.zip|dir> [--bat N] [--exe N] [--args S]');
    console.error('       [--frames N] [--multiple N] [--screenshot F] [--text] [--audio SEC]');
    console.error('       [--keys "RETURN@500,SPACE@1200"] [--quiet]');
    process.exit(2);
}

function parseArgs(argv) {
    const o = { frames: 3000, multiple: 20, args: '', text: false, quiet: false, y2kClamp: false };
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
        else if (a === '--y2k-clamp') o.y2kClamp = true;
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

(async () => {
    const opts = parseArgs(process.argv.slice(2));
    const keys = parseKeys(opts.keys);
    const staged = await stageInput(opts.input);
    let result;
    try {
        const plan = planLaunch(staged.dir, opts);
        const m = await Machine.boot({
            dir: staged.dir, bat: plan.bat, args: plan.synthetic ? '' : opts.args,
            multiple: opts.multiple, y2kClamp: opts.y2kClamp,
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
            y2kClamp: opts.y2kClamp,
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
