// stage.js — 「入力 (書庫/ディレクトリ) → 作業ディレクトリ → 起動計画」の共有部品。
// 消費者 = tools/quubee_run.js (CLI) と tools/mcp/server.js (MCP)。展開は本番と同じ
// web/player/archive.js、起動解決は bio100_triage.js の planLaunch と同じ考え方。
//
// ⚠ 位置づけ (全消費者共通): QuuBee の HLE-DOS は実 DOS ではない (docs/dos_hle_gaps.md)。
//   観察結果は煙感知器と計測器であって、実機互換の証明ではない。NOTE を必ず応答に同梱する。

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
const qbBatScript = require(path.join(WEB, 'player', 'batscript.js'));
const qbArchive = require(path.join(WEB, 'player', 'archive.js'));

const NOTE = 'QuuBee HLE-DOS is not real DOS (see docs/dos_hle_gaps.md). ' +
    'Treat results as smoke detection + instrumentation, not real-machine compatibility proof.';

/* --- 書庫/ディレクトリ → 一時作業ディレクトリ。名前は SJIS 生バイトの latin1 写像のまま扱う
 *     (MEMFS 正準形)。区切りは '/' のみ (0x5C は SJIS 2 バイト目と衝突するため区切りにしない)。
 *     ディレクトリ入力も複製する (合成 .bat を書くことがあるため入力を汚さない)。 --- */
async function stageInput(input) {
    const st = fs.statSync(input);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quubee_run_'));
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    try {
        if (st.isDirectory()) {
            for (const nb of fs.readdirSync(input, { encoding: 'buffer' })) {
                const src = Buffer.concat([Buffer.from(input + '/'), nb]);
                if (!fs.statSync(src).isFile()) continue;
                fs.writeFileSync(Buffer.concat([Buffer.from(dir + '/'), nb]), fs.readFileSync(src));
            }
            return { dir, cleanup };
        }
        const buf = fs.readFileSync(input);
        let entries;
        if (/\.(lzh|lha|lzs)$/i.test(input)) entries = qbArchive.parseLzh(new Uint8Array(buf));
        else if (/\.zip$/i.test(input)) entries = await qbArchive.parseZip(new Uint8Array(buf));
        else throw new Error('未対応の入力形式 (対応: .lzh/.lha/.lzs/.zip/ディレクトリ): ' + input);
        if (!entries || !entries.length) throw new Error('書庫からエントリを取り出せなかった: ' + input);
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
        return { dir, cleanup };
    } catch (e) {
        cleanup();
        throw e;
    }
}

/* --- 起動計画: opts.exe 明示 > .bat 自動解決 > 単一 .exe/.com。
 *     単一起動も 1 行 .bat を合成して stage_batch (③ 文インタプリタ) の正典経路に一本化する
 *     (Machine.boot がそのまま食える)。曖昧 (exe 複数) は候補列挙つきの正直な失敗。 --- */
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
        const readEntry = (n) => { try { return fs.readFileSync(path.join(dir, n)); } catch (_) { return null; } };
        const stmts = qbBatScript.buildStatements(recipe, names, opts.args || '', readEntry);
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

module.exports = { NOTE, stageInput, planLaunch };
