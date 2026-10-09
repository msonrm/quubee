#!/usr/bin/env node
// QuuBee ローカル開発サーバ (zero-dep)。
//
// なぜ emrun でなくこれ: 音声スレッド再設計 (docs/audio_worker_migration.md) で SharedArrayBuffer を
// 使うため cross-origin isolation が要る。本番は web/_headers (Cloudflare Pages) が COOP/COEP を出すが、
// emrun はこれらのヘッダを出せない。本サーバは全レスポンスに COOP: same-origin / COEP: require-corp を
// 付け、`.wasm` を application/wasm で返す (streaming compile に必須)。
//
// 使い方:  node tools/devserver.js [port] [root]
//   既定 port=8080, root=web/  →  http://localhost:8080/
// 確認:    DevTools コンソールで  crossOriginIsolated === true  /  typeof SharedArrayBuffer
//
// /api/pair/<room> = リモートキーボード (web/remote/) のシグナリング中継の代役。本番は別の Worker
// (relay/worker.js、Durable Object) で、`wrangler dev` はこの開発機 (aarch64 / 39 ビット) では起動しない
// ので、同じ規則をここに持つ (受け手 1 + キーボード 4 まで・入退室で peers の一覧・宛先 to へ from 付きで流す・
// 同じ id の入り直しは古い方を 4001 で閉じる)。Worker そのものの検査ではない。
// /api/dev-origin = QR に載せる URL の元 (LAN の IP)。localhost のままでは別の端末から開けないため。

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.argv[2], 10) || 8080;
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'web'));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.bmp':  'image/bmp',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.wav':  'audio/wav',
    '.txt':  'text/plain; charset=utf-8',
    '.md':   'text/plain; charset=utf-8',
    // バイナリ素材 (ディスク/実行ファイル/PMD/SF2 等) は octet-stream
    '.d88':  'application/octet-stream',
    '.com':  'application/octet-stream',
    '.exe':  'application/octet-stream',
    '.m':    'application/octet-stream',
    '.sf2':  'application/octet-stream',
    '.bin':  'application/octet-stream',
    '.lzh':  'application/octet-stream',
    '.zip':  'application/zip',
};

// COOP/COEP を全レスポンスに付ける。これが本サーバの存在理由。
function isolationHeaders(res) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-cache');
}

const server = http.createServer((req, res) => {
    isolationHeaders(res);

    if (req.url === '/api/dev-origin') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ origin: lanOrigin() }));
    }

    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch (_) { res.writeHead(400); return res.end('bad url'); }
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';

    // パストラバーサル防止: ROOT 配下に正規化
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403); return res.end('forbidden');
    }

    fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('404 ' + urlPath);
        }
        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Content-Length', st.size);
        if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
        fs.createReadStream(filePath)
            .on('error', () => { res.writeHead(500); res.end('read error'); })
            .pipe(res);
    });
});

// ---- /api/pair/<room>: シグナリング中継の代役 (relay/worker.js と同じ規則) ----

function lanOrigin() {
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
            if (a.family === 'IPv4' && !a.internal) return `http://${a.address}:${PORT}`;
        }
    }
    return null;
}

const ROOM_PATH = /^\/api\/pair\/([A-Za-z0-9_-]{16,64})$/;
const PEER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_KEYBOARDS = 4;
const MAX_MESSAGE = 16 * 1024;
const rooms = new Map();   // room → Set(conn)。conn = { sock, id, role, sid, send, close }

// 最小の WebSocket (RFC 6455)。テキストフレームと close / ping だけ扱う (SDP は分割されない大きさ)。
function wsAccept(req, sock) {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = { sock, onmessage: null, onclose: null, closed: false };
    const frame = (op, payload) => {
        const n = payload.length;
        const head = n < 126 ? Buffer.from([0x80 | op, n])
            : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
            : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
        if (!sock.destroyed) sock.write(Buffer.concat([head, payload]));
    };
    conn.send = (text) => frame(1, Buffer.from(text, 'utf8'));
    conn.close = (code) => {
        if (conn.closed) return;
        const b = Buffer.alloc(2); b.writeUInt16BE(code || 1000);
        frame(8, b);
        sock.end();
        finish();
    };
    const finish = () => { if (conn.closed) return; conn.closed = true; if (conn.onclose) conn.onclose(); };
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
            if (buf.length < 2) return;
            const op = buf[0] & 15, masked = buf[1] & 0x80;
            let len = buf[1] & 127, off = 2;
            if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
            if (len > MAX_MESSAGE * 2) return conn.close(1009);
            const mask = masked ? buf.subarray(off, off + 4) : null;
            if (masked) off += 4;
            if (buf.length < off + len) return;
            const data = Buffer.from(buf.subarray(off, off + len));
            if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
            buf = buf.subarray(off + len);
            if (op === 1 && conn.onmessage) conn.onmessage(data.toString('utf8'));
            else if (op === 8) return conn.close(1000);
            else if (op === 9) frame(10, data);
        }
    });
    sock.on('close', finish);
    sock.on('error', finish);
    return conn;
}

function announce(set) {
    const msg = JSON.stringify({ t: 'peers', list: [...set].map((c) => ({ id: c.id, role: c.role, sid: c.sid })) });
    for (const c of set) c.send(msg);
}

server.on('upgrade', (req, sock) => {
    const u = new URL(req.url, 'http://x');
    const m = ROOM_PATH.exec(u.pathname);
    const role = u.searchParams.get('role'), id = u.searchParams.get('id') || '', sid = u.searchParams.get('sid') || '';
    if (!m || (role !== 'host' && role !== 'kbd') || !PEER_ID.test(id) || !PEER_ID.test(sid)) {
        sock.write('HTTP/1.1 400 Bad Request\r\n\r\n'); return sock.destroy();
    }
    const set = rooms.get(m[1]) || new Set();
    rooms.set(m[1], set);
    const stale = [...set].filter((c) => c.id === id || (role === 'host' && c.role === 'host'));
    const kbds = [...set].filter((c) => c.role === 'kbd' && !stale.includes(c));
    if (role === 'kbd' && kbds.length >= MAX_KEYBOARDS) {
        sock.write('HTTP/1.1 409 Conflict\r\n\r\n'); return sock.destroy();
    }
    for (const c of stale) { set.delete(c); c.close(4001); }
    const conn = wsAccept(req, sock);
    Object.assign(conn, { id, role, sid });
    set.add(conn);
    conn.onmessage = (text) => {
        if (text.length > MAX_MESSAGE) return conn.close(1009);
        let msg;
        try { msg = JSON.parse(text); } catch (_) { return; }
        if (!msg || typeof msg.to !== 'string' || !PEER_ID.test(msg.to)) return;
        const out = JSON.stringify({ ...msg, to: undefined, from: id });
        for (const c of set) if (c !== conn && c.id === msg.to) c.send(out);
    };
    conn.onclose = () => {
        if (!set.delete(conn)) return;
        announce(set);
        if (!set.size) rooms.delete(m[1]);
    };
    announce(set);
});

server.listen(PORT, () => {
    console.log(`QuuBee devserver: http://localhost:${PORT}/  (root=${ROOT})`);
    console.log('COOP/COEP 付き。確認: DevTools で crossOriginIsolated === true');
    console.log(`リモートキーボードの中継 (代役): /api/pair/<room>  LAN: ${lanOrigin() || '(なし)'}`);
});
