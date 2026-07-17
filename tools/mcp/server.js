#!/usr/bin/env node
// server.js — QuuBee headless MCP サーバ (stdio)。他の開発者/エージェントに「目と耳」を渡す。
//
// ⚠ 位置づけ (docs/dos_hle_gaps.md が正典): QuuBee の HLE-DOS は実 DOS ではない。
//   このサーバは「参照プラットフォーム」ではなく**煙感知器と計測器** — 動く兆候・落ちる兆候を
//   検出する道具であって、実機/実 DOS 互換の証明にはならない。全ツール応答の JSON に
//   note フィールドとしてこの注意書きを必ず同梱する (剥がさないこと)。
//
// 形 = 対話セッション型: quubee_boot が起動中の Machine (tools/lib/machine.js) をサーバ内に保持し、
// quubee_run (フレーム進行) / quubee_key (キー投入) / quubee_screenshot / quubee_text /
// quubee_audio / quubee_classify で観察を繰り返せる。ワンショットで良いなら CLI
// (tools/quubee_run.js) の方が軽い。
//
// セットアップ: cd tools/mcp && npm install
// 登録例 (Claude Code): claude mcp add quubee -- node /path/to/qb/tools/mcp/server.js
// 詳細 = tools/mcp/README.md

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const ROOT = path.resolve(__dirname, '..', '..');
const { Machine, NKEY } = require(path.join(ROOT, 'tools', 'lib', 'machine'));
const tier = require(path.join(ROOT, 'tools', 'lib', 'tier'));
const { NOTE, stageInput, planLaunch } = require(path.join(ROOT, 'tools', 'lib', 'stage'));

const MAX_SESSIONS = 3;          // Machine 1 台 ≈ 数十 MB の wasm heap。使い終わったら quubee_close
const MAX_FRAMES_PER_CALL = 6000; // 1 コールの上限 (≈ エミュ 106 秒。ホスト実時間で最悪 ~2 分)
const MAX_SNAPS_PER_SESSION = 2; // snapshot は圧縮しても MB オーダー。上書き保存で回す

const sessions = new Map();      // id → { m, cleanup, samples: {maxColors, hashes[]}, launch, snaps: Map }
let nextId = 1;

function json(obj) { return { content: [{ type: 'text', text: JSON.stringify({ ...obj, note: NOTE }) }] }; }
function jsonError(msg) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: String(msg), note: NOTE }) }] };
}
function getSession(id) {
    const s = sessions.get(id);
    if (!s) throw new Error('セッションが無い: ' + id + ' (quubee_boot で作る。生存: ' +
        [...sessions.keys()].join(',') + ')');
    return s;
}
function sample(s) {
    const { ptr, w, h } = s.m.framebuffer();
    const met = tier.fbMetrics(s.m.M, ptr, w, h);
    if (met.colors > s.samples.maxColors) s.samples.maxColors = met.colors;
    s.samples.hashes.push(met.hash);
    return met;
}
function observe(s, met) {
    const pc = s.m.M.ccall('np2kai_debug_get_linear_pc', 'number', ['number'], [s.m.h]) >>> 0;
    const exited = s.m.exited();
    return {
        frame: s.m.frame,
        state: tier.classifyPc(pc, exited),
        pc: '0x' + pc.toString(16).toUpperCase(),
        colorsNow: met.colors,
        exited,
        batchDone: s.m.batchDone(),
    };
}

// version の正 = package.json (開発時 = tools/mcp/package.json、npm 配布時 = パッケージ root)
const VERSION = (() => {
    for (const p of [path.join(__dirname, 'package.json'), path.join(ROOT, 'package.json')]) {
        try {
            const j = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (j.name === 'quubee-mcp') return j.version;
        } catch (_) {}
    }
    return '0.0.0';
})();

const server = new McpServer({ name: 'quubee', version: VERSION });

server.tool(
    'quubee_boot',
    'PC-98 フリーソフトの書庫 (.lzh/.lha/.lzs/.zip) かディレクトリを QuuBee (HLE-DOS + NP2kai Wasm) で起動し、' +
    '対話セッションを作る。起動解決は exe 明示 > .bat 自動 > 単一実行ファイル。' +
    '注意: QuuBee は実 DOS ではない。結果は煙感知器 (動く/落ちる兆候) であり実機互換の証明ではない。',
    {
        path: z.string().describe('書庫かディレクトリの絶対パス'),
        exe: z.string().optional().describe('起動実行ファイルを明示 (例 GAME.EXE)'),
        bat: z.string().optional().describe('起動 .bat を明示'),
        args: z.string().optional().describe('コマンドライン引数'),
        multiple: z.number().int().min(1).max(64).optional().describe('クロック倍率 (既定 20 = headless 正典)'),
        y2kClamp: z.boolean().optional().describe('RTC を 1999 に固定するプレイヤー用保護。' +
            '既定 false = 実時計 (2026 年の実機相当。2 桁年ソフトの Y2K バグがそのまま観察できる)'),
    },
    async (a) => {
        try {
            if (sessions.size >= MAX_SESSIONS)
                return jsonError(`セッション上限 (${MAX_SESSIONS})。quubee_close で解放してから`);
            const staged = await stageInput(a.path);
            try {
                const plan = planLaunch(staged.dir, { exe: a.exe, bat: a.bat, args: a.args || '' });
                const m = await Machine.boot({
                    dir: staged.dir, bat: plan.bat, args: plan.synthetic ? '' : (a.args || ''),
                    multiple: a.multiple || 20, y2kClamp: !!a.y2kClamp,
                });
                const id = 's' + nextId++;
                sessions.set(id, { m, cleanup: staged.cleanup, launch: plan.label,
                    samples: { maxColors: 0, hashes: [] }, snaps: new Map() });
                return json({ session: id, launch: plan.label, wasm: m.info().wasm.sha256.slice(0, 16),
                    multiple: a.multiple || 20, y2kClamp: !!a.y2kClamp, frame: 0,
                    hint: 'quubee_run で進める (例 frames=1500) → quubee_screenshot / quubee_text で観察' });
            } catch (e) { staged.cleanup(); throw e; }
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_run',
    'セッションを N フレーム進める (60 フレーム = エミュ 1 秒)。終了/バッチ完了/DOS 入力待ちを検出したら早期に返る。',
    {
        session: z.string(),
        frames: z.number().int().min(1).max(MAX_FRAMES_PER_CALL)
            .describe(`進めるフレーム数 (上限 ${MAX_FRAMES_PER_CALL})`),
    },
    async (a) => {
        try {
            const s = getSession(a.session);
            let exited = false;
            for (let f = 0; f < a.frames; f++) {
                s.m.runFrames(1);
                if (s.m.exited()) { exited = true; break; }
            }
            const met = sample(s);
            return json(observe(s, met));
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_key',
    'キーを押す (押下は直後の quubee_run 中 holdFrames フレーム保持され自動で離す)。' +
    '使えるキー名: ' + Object.keys(NKEY).join(' '),
    {
        session: z.string(),
        key: z.string().describe('NKEY 名 (例 RETURN, SPACE, Z, X, UP, DOWN, F1)'),
        holdFrames: z.number().int().min(1).max(120).optional().describe('保持フレーム数 (既定 6)'),
    },
    async (a) => {
        try {
            const s = getSession(a.session);
            const code = NKEY[a.key.toUpperCase()];
            if (code === undefined) return jsonError('NKEY に無いキー名: ' + a.key);
            s.m.pressKey(code, a.holdFrames || 6);
            return json({ pressed: a.key.toUpperCase(), holdFrames: a.holdFrames || 6,
                hint: '反映には quubee_run でフレームを進める' });
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_screenshot',
    '現在の画面を PNG で返す (640x400)。',
    { session: z.string() },
    async (a) => {
        try {
            const s = getSession(a.session);
            const png = s.m.screenshotPng();
            return { content: [
                { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
                { type: 'text', text: JSON.stringify({ frame: s.m.frame, note: NOTE }) },
            ] };
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_text',
    'テキスト VRAM 25 行を返す (ASCII のみ。漢字セルは空白になる)。',
    { session: z.string() },
    async (a) => {
        try {
            const s = getSession(a.session);
            return json({ frame: s.m.frame, textVram: s.m.textVram() });
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_audio',
    '音声を seconds 秒ぶん汲んで RMS を返す (発音の煙感知。フレームはその分進む)。',
    { session: z.string(), seconds: z.number().min(0.1).max(3).optional().describe('既定 0.5') },
    async (a) => {
        try {
            const s = getSession(a.session);
            const pcm = s.m.captureAudio(a.seconds || 0.5);
            let sum = 0;
            for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
            return json({ frame: s.m.frame, seconds: a.seconds || 0.5,
                audioRms: pcm.length ? Math.round(Math.sqrt(sum / pcm.length)) : 0 });
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_classify',
    'これまでの観察 (quubee_run が蓄積したサンプル) から tier/state を分類する。' +
    'tier: ALIVE=多色+動き / RENDER=多色静止 / BOOT=低色 / WAIT=DOS 入力待ち / EXIT=正常終了 / ' +
    'CRASH=BIOS 暴走域 (偽陰性ありうる・要ブラウザ確認) / BUSY=低色で実行中。',
    { session: z.string() },
    async (a) => {
        try {
            const s = getSession(a.session);
            const met = sample(s);
            const o = observe(s, met);
            const animated = new Set(s.samples.hashes.filter((x) => x !== 0)).size >= 2;
            const stats = s.m.int21Stats();
            return json({ ...o,
                tier: tier.classifyTier(o.state, s.samples.maxColors, animated),
                maxColors: s.samples.maxColors, animated, launch: s.launch,
                int21Unimplemented: stats.unimplemented,   // 未実装 DOS コール踏み = 一級の煙シグナル
                int21Calls: stats.calls,
                wasm: s.m.info().wasm.sha256.slice(0, 16) });
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_save',
    '現在の状態をスナップショットとして保存する (Wasm メモリ + ファイル + フレーム位置)。' +
    'quubee_restore で巻き戻せるので「キーを試す → 駄目なら戻す」の分岐探索ができる。' +
    `セッションあたり ${MAX_SNAPS_PER_SESSION} 個まで (同名は上書き)。`,
    {
        session: z.string(),
        name: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).optional().describe('スナップショット名 (既定 "snap")'),
    },
    async (a) => {
        try {
            const s = getSession(a.session);
            const name = a.name || 'snap';
            if (!s.snaps.has(name) && s.snaps.size >= MAX_SNAPS_PER_SESSION)
                return jsonError(`スナップショット上限 (${MAX_SNAPS_PER_SESSION})。既存: ` +
                    [...s.snaps.keys()].join(',') + ' (同名指定で上書き可)');
            const buf = zlib.deflateSync(Machine.serialize(s.m.snapshot()), { level: 1 });
            s.snaps.set(name, { buf, frame: s.m.frame,
                samples: { maxColors: s.samples.maxColors, hashes: s.samples.hashes.slice() } });
            return json({ saved: name, frame: s.m.frame,
                compressedMB: +(buf.length / 1048576).toFixed(1),
                snapshots: [...s.snaps.keys()] });
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_restore',
    '保存済みスナップショットへ巻き戻す。フレーム位置・画面・メモリ・ファイルすべてが保存時点に戻る' +
    ' (classify の観察履歴も保存時点のものに戻る)。',
    {
        session: z.string(),
        name: z.string().optional().describe('スナップショット名 (既定 "snap")'),
    },
    async (a) => {
        try {
            const s = getSession(a.session);
            const name = a.name || 'snap';
            const rec = s.snaps.get(name);
            if (!rec) return jsonError('スナップショットが無い: ' + name +
                ' (保存済み: ' + ([...s.snaps.keys()].join(',') || '無し') + ')');
            s.m = await Machine.restore(zlib.inflateSync(rec.buf));
            s.samples = { maxColors: rec.samples.maxColors, hashes: rec.samples.hashes.slice() };
            return json({ restored: name, frame: s.m.frame,
                hint: 'ここから quubee_run / quubee_key で別の分岐を試せる' });
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_close',
    'セッションを閉じて資源 (wasm heap・一時ディレクトリ・スナップショット) を解放する。',
    { session: z.string() },
    async (a) => {
        try {
            const s = getSession(a.session);
            try { s.cleanup && s.cleanup(); } catch (_) {}
            sessions.delete(a.session);
            return json({ closed: a.session, remaining: [...sessions.keys()] });
        } catch (e) { return jsonError(e.message || e); }
    });

server.tool(
    'quubee_gaps',
    'QuuBee HLE-DOS と実 DOS の差異・未対応一覧 (docs/dos_hle_gaps.md) を返す。' +
    '「QuuBee で動かない」原因の当たり付けと、「QuuBee で動いた」を実機互換と誤読しないための必読資料。',
    {},
    async () => {
        try {
            const doc = fs.readFileSync(path.join(ROOT, 'docs', 'dos_hle_gaps.md'), 'utf8');
            return json({ doc });
        } catch (e) { return jsonError(e.message || e); }
    });

(async () => {
    await server.connect(new StdioServerTransport());
    // stdout は MCP プロトコル専用。ログは stderr へ
    console.error('quubee MCP server ready (sessions max ' + MAX_SESSIONS + ')');
})().catch((e) => { console.error('quubee MCP server FATAL:', e); process.exit(1); });
