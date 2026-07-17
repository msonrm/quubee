#!/usr/bin/env node
// make_package.js — npm 配布物 `quubee-mcp` の組み立て (MCP 計画トラック A)。
//
// リポジトリのサブセットを「同じ相対構造」で dist/quubee-mcp/ に集めて npm pack する。
// 相対構造を保つのが肝: tools/lib/*.js や server.js の ROOT 解決 (__dirname/../..) が
// 無変更でパッケージ内でも機能する (パッケージ root = リポジトリ root の写像)。
//
// 使い方:
//   node tools/mcp/make_package.js          # dist/quubee-mcp/ 組み立て + npm pack → .tgz
//   node tools/mcp/make_package.js --no-pack # 組み立てのみ (npm 不要)
//
// publish は人間の作業 (npm アカウント):
//   cd tools/mcp/dist/quubee-mcp && npm publish
//
// ライセンス: 同梱物は「寛容ライセンスの集合体・GPL なし」(正典 = CREDITS.md / LICENSE)。
// package.json の license は MIT 単独ではないので "SEE LICENSE IN CREDITS.md"。
// CREDITS.md / LICENSE / licenses/ の同梱は剥がさないこと (公開 web ビルドと同じ流儀)。

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'dist', 'quubee-mcp');

// リポジトリ相対パスをそのままの位置で同梱する (構造の写像が正しさの根拠)
const FILES = [
    'tools/mcp/server.js',
    'tools/quubee_run.js',
    'tools/lib/machine.js',
    'tools/lib/stage.js',
    'tools/lib/tier.js',
    'web/np2kai_core.js',
    'web/np2kai_core.wasm',
    'web/player/batscript.js',
    'web/player/archive.js',
    'web/player/diskimage.js',
    'web/assets/font.bmp',
    'web/assets/loader.d88',
    'docs/dos_hle_gaps.md',
    'CREDITS.md',
    'LICENSE',
    'LICENSE-MIT',
];
const DIRS = ['licenses'];   // LICENSE が参照する第三者ライセンス全文 (公開ビルド同様に同梱)

for (const f of FILES) {
    if (!fs.existsSync(path.join(ROOT, f))) {
        console.error('欠品: ' + f + (f.includes('np2kai_core') ? ' (bash emscripten/build.sh で生成)' : ''));
        process.exit(1);
    }
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const f of FILES) {
    const dst = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dst);
}
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'README.npm.md'), path.join(OUT, 'README.md'));

// version と dependencies は tools/mcp/package.json (開発用・private) を単一の正とする
const devPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const pkg = {
    name: 'quubee-mcp',
    version: devPkg.version,
    description: 'QuuBee headless MCP server + CLI — smoke-testing & instrumentation for ' +
        'PC-98 freeware (HLE-DOS + NP2kai Wasm; NOT real DOS, not a reference platform)',
    bin: { 'quubee-mcp': 'tools/mcp/server.js', 'quubee-run': 'tools/quubee_run.js' },
    license: 'SEE LICENSE IN CREDITS.md',
    repository: { type: 'git', url: 'git+https://github.com/msonrm/quubee.git' },
    homepage: 'https://quubee.pages.dev',
    keywords: ['pc-98', 'pc98', 'retro', 'freeware', 'mcp', 'model-context-protocol', 'headless'],
    engines: { node: '>=18' },
    dependencies: devPkg.dependencies,
};
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

const wasmMB = (fs.statSync(path.join(OUT, 'web/np2kai_core.wasm')).size / 1048576).toFixed(1);
console.log('組み立て完了: ' + OUT + ' (v' + pkg.version + ', wasm ' + wasmMB + 'MB)');

if (!process.argv.includes('--no-pack')) {
    cp.execSync('npm pack --pack-destination ..', { cwd: OUT, stdio: 'inherit' });
    console.log('tgz: ' + path.join(__dirname, 'dist',
        'quubee-mcp-' + pkg.version + '.tgz'));
}
