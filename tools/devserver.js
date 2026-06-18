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

const http = require('http');
const fs   = require('fs');
const path = require('path');

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

server.listen(PORT, () => {
    console.log(`QuuBee devserver: http://localhost:${PORT}/  (root=${ROOT})`);
    console.log('COOP/COEP 付き。確認: DevTools で crossOriginIsolated === true');
});
