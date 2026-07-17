#!/usr/bin/env node
// mcp_server_test.js — QuuBee MCP サーバ (tools/mcp/server.js) の回帰。
//
// 前提: tools/mcp で `npm install` 済み (@modelcontextprotocol/sdk)。無ければ SKIP。
// 素材: games/liotest.zip (ローカル限定)。無ければ SKIP。
// 見るもの: initialize/tools・対話セッション一巡 (boot→run→key→run→classify→screenshot→text→close)・
//   全応答の not-real-DOS 注意書き・存在しないセッションの正直なエラー。
// クライアント側は SDK に依存せず素の JSON-RPC (newline-delimited) で書く (プロトコル互換の検証を兼ねる)。

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// QB_MCP_SERVER で被検体を差し替えられる (npm 配布物 dist/quubee-mcp の server.js を同じ回帰で検証する用)
const SRV = process.env.QB_MCP_SERVER || path.join(ROOT, 'tools', 'mcp', 'server.js');
const ZIP = path.join(ROOT, 'games', 'liotest.zip');

if (!process.env.QB_MCP_SERVER && !fs.existsSync(path.join(ROOT, 'tools', 'mcp', 'node_modules'))) {
    console.log('SKIP — tools/mcp/node_modules 不在 (cd tools/mcp && npm install)'); process.exit(0);
}
if (!fs.existsSync(ZIP)) { console.log('SKIP — games/liotest.zip 不在 (ローカル限定素材)'); process.exit(0); }

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const srv = cp.spawn('node', [SRV], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const waiters = new Map();
srv.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.id !== undefined && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
    }
});
let seq = 0;
function rpc(method, params) {
    return new Promise((res, rej) => {
        const id = ++seq;
        const t = setTimeout(() => rej(new Error('RPC タイムアウト: ' + method)), 120000);
        waiters.set(id, (m) => { clearTimeout(t); res(m); });
        srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
}
async function tool(name, args) {
    const r = await rpc('tools/call', { name, arguments: args || {} });
    const t = r.result && r.result.content && r.result.content.find((c) => c.type === 'text');
    const img = r.result && r.result.content && r.result.content.find((c) => c.type === 'image');
    return { rpcError: r.error, isError: !!(r.result && r.result.isError),
        json: t ? JSON.parse(t.text) : null, imgBytes: img ? Buffer.from(img.data, 'base64').length : 0 };
}

(async () => {
    const init = await rpc('initialize', {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' },
    });
    check('initialize が通る (serverInfo=quubee)', init.result && init.result.serverInfo.name === 'quubee');
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

    const tl = await rpc('tools/list', {});
    const names = (tl.result.tools || []).map((t) => t.name);
    check('11 ツールが列挙される', names.length === 11 && names.includes('quubee_save') &&
        names.includes('quubee_restore') && names.includes('quubee_gaps'), names.join(','));

    // 対話セッション一巡 (liotest T1: キー待ち → RETURN で描画が進む)
    const b = await tool('quubee_boot', { path: ZIP, exe: 'T1.EXE' });
    check('boot がセッションを返す', !b.isError && !!(b.json && b.json.session), JSON.stringify(b.json));
    check('boot に wasm SHA', !!(b.json && /^[0-9a-f]{16}$/.test(b.json.wasm)));
    check('boot 既定は実時計 (y2kClamp=false)', b.json && b.json.y2kClamp === false, JSON.stringify(b.json));
    const sid = b.json.session;

    const r1 = await tool('quubee_run', { session: sid, frames: 600 });
    check('run が state を返す (キー待ち=WAIT)', !r1.isError && r1.json.state === 'WAIT', JSON.stringify(r1.json));
    check('全応答に not-real-DOS 注意書き', /not real DOS/.test(r1.json.note || ''));

    const c1 = await tool('quubee_classify', { session: sid });
    check('キー無しは静止 (animated=false)', c1.json && c1.json.animated === false, JSON.stringify(c1.json));

    // --- snapshot: キー投入で分岐する前に保存 ---
    const sv = await tool('quubee_save', { session: sid });
    check('save がスナップショットを返す', !sv.isError && sv.json.saved === 'snap' && sv.json.frame === 600,
        JSON.stringify(sv.json));

    await tool('quubee_key', { session: sid, key: 'RETURN' });
    await tool('quubee_run', { session: sid, frames: 200 });
    await tool('quubee_key', { session: sid, key: 'RETURN' });
    await tool('quubee_run', { session: sid, frames: 200 });
    const c2 = await tool('quubee_classify', { session: sid });
    check('RETURN 投入で画面が進む (animated=true)', c2.json && c2.json.animated === true, JSON.stringify(c2.json));
    check('classify に INT 21h 診断が載る', c2.json && typeof c2.json.int21Unimplemented === 'object' &&
        typeof c2.json.int21Calls === 'object' && Object.keys(c2.json.int21Calls).length > 0,
        JSON.stringify(c2.json && c2.json.int21Calls));

    // --- restore: 保存時点 (キー投入前・静止) へ巻き戻る ---
    const rs = await tool('quubee_restore', { session: sid });
    check('restore でフレームが巻き戻る (600)', !rs.isError && rs.json.frame === 600, JSON.stringify(rs.json));
    const c3 = await tool('quubee_classify', { session: sid });
    check('restore 後は保存時点の観察 (animated=false) に戻る', c3.json && c3.json.animated === false,
        JSON.stringify(c3.json));
    const rs2 = await tool('quubee_restore', { session: sid, name: 'nope' });
    check('無いスナップショットは正直なエラー', rs2.isError && /スナップショットが無い/.test(rs2.json.error || ''));

    const shot = await tool('quubee_screenshot', { session: sid });
    check('screenshot が PNG を返す', shot.imgBytes > 100, 'bytes=' + shot.imgBytes);
    const txt = await tool('quubee_text', { session: sid });
    check('text が 25 行返す', txt.json && txt.json.textVram && txt.json.textVram.length === 25);

    const bad = await tool('quubee_key', { session: 'nope', key: 'RETURN' });
    check('無いセッションは isError + 生存一覧', bad.isError && /セッションが無い/.test(bad.json.error || ''));

    const cl = await tool('quubee_close', { session: sid });
    check('close で解放される', cl.json && cl.json.closed === sid && cl.json.remaining.length === 0);

    console.log(`\nmcp_server_test: ${pass} PASS / ${fail} FAIL  (wasm ${b.json && b.json.wasm})`);
    srv.kill();
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL —', e.message || e); srv.kill(); process.exit(1); });
