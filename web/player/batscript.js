// batscript.js — 起動 .bat を「作者の意図した起動レシピ」として解釈する (qbBatScript)。
//
// PC-98 フリーソフトの約 1/3 は起動 .bat を同梱する (調査: games/ の 40 書庫中 14 本)。
// .bat は作者が書いた機械可読の起動レシピ ―― 主プログラム名・引数 (%1..%9)・音源ドライバの
// 常駐手順が書かれている。本モジュールは .bat をパースして「実際に走らせる主プログラム + cmdline」
// を取り出し、フロントのエントリ自動検出に橋渡しする (db/games.json への手書きを不要にする)。
//
// MVP (①) のスコープ: 主プログラムを 1 本起動するところまで。音源ドライバ TSR の常駐 (mdrv98 →
// game → mdrv98 -r を 1 セッションで保つ) は、Run 毎に pccore_reset で別セッションになる都合上
// JS だけでは無理で、C 側 (AH=4Bh EXEC ベースの COMMAND.COM もどき) が要る ―― これは ② の課題。
// それまでは「ゲームが FM ポートを直叩きなら鳴る / ドライバ依存音源なら無音」のグレースフル動作。
//
// 純 JS・Wasm 不変。tools/batscript_test.js が合成 fixture で振る舞いを守る。

(function (root) {
    'use strict';

    // 起動 .bat がゲーム本体の「周り」でロードする音源ドライバ / セットアップ常駐ユーティリティ。
    // MVP ① ではこれらを読み飛ばし、主プログラムだけを直接起動する (上のコメント参照)。
    // 拡張子は付けず素の名前で照合する (.bat 内も素の名前で呼ぶため)。
    const DRIVER_NAMES = new Set([
        'mdrv98', 'mdrv', 'middrv', 'middrv98', 'middrvpc',
        'opndrv', 'ssgdrv', 'tkydrv', 'fmpdrv', 'fmp', 'spbdrv',
        'pmd', 'pmd98', 'pmdb2', 'cats', 'calib', 'mfree',
    ]);

    // .bat の 1 行を解釈して { kind, ... } に分類する。
    function parseLine(line) {
        let t = line.trim();
        if (!t) return null;
        if (t[0] === '@') t = t.slice(1).trim();      // @ (echo 抑止) は捨てて中身を再評価
        if (!t) return null;
        const lc = t.toLowerCase();
        // ディレクティブ / 制御フロー (MVP ① では無視。制御フロー有無だけ記録する)
        if (lc === 'echo on' || lc === 'echo off' || lc.startsWith('echo ') ||
            lc === 'rem' || lc.startsWith('rem ') ||
            lc === 'cls' || lc.startsWith('pause') || lc.startsWith('set ') ||
            t[0] === ':' || lc.startsWith('goto') || lc.startsWith('if ')) {
            const ctrl = (t[0] === ':' || lc.startsWith('goto') || lc.startsWith('if '));
            return { kind: 'directive', ctrl, text: t };
        }
        const toks = t.split(/\s+/);
        return { kind: 'command', program: toks[0], args: toks.slice(1), base: programBasename(toks[0]) };
    }

    // プログラムトークンを素の basename に落とす: ドライブ "X:" を剥がし、パス区切り (\ /) の
    // 最終要素を取る。実行時パス解決 (C 側 read_dos_rel) と同じ正規化を JS 側でも行う。
    function programBasename(tok) {
        let t = tok;
        if (t.length >= 2 && t[1] === ':') t = t.slice(2);   // "A:" を除去
        const parts = t.split(/[\\/]/);
        return parts[parts.length - 1] || t;
    }

    // .bat バイト列 (Uint8Array | number[] | string) → 起動レシピ。
    function parse(bytes) {
        let s;
        if (typeof bytes === 'string') {
            s = bytes;
        } else {
            // latin1 として読み、最初の 0x1A (^Z DOS EOF) で打ち切る。
            let end = bytes.length;
            for (let i = 0; i < bytes.length; i++) { if (bytes[i] === 0x1a) { end = i; break; } }
            s = '';
            for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i] & 0xff);
        }
        const lines = s.split(/\r\n|\r|\n/).map(parseLine).filter(Boolean);
        const drivers = [], mains = [];
        let hasControlFlow = false;
        for (const l of lines) {
            if (l.kind === 'directive') { if (l.ctrl) hasControlFlow = true; continue; }
            const key = l.base.toLowerCase().replace(/\.(com|exe|bat)$/, '');
            if (DRIVER_NAMES.has(key)) drivers.push(l); else mains.push(l);
        }
        return { mains, drivers, hasControlFlow, lines };
    }

    // 末尾要素を小文字 basename で取る (照合用)。
    function lcBase(name) {
        return name.split(/[\\/]/).pop().toLowerCase();
    }

    // レシピ + 展開済みエントリ名一覧 → 実際に起動する主プログラムを解決する。
    // DOS の拡張子補完順 (.COM > .EXE) と大小無視で当てる。{ name, args } か null。
    function resolveMain(recipe, entryNames) {
        const byBase = new Map();
        for (const n of entryNames) {
            const b = lcBase(n);
            if (!byBase.has(b)) byBase.set(b, n);   // 先勝ち (同名はまず無い)
        }
        const find = (base) => {
            const b = base.toLowerCase();
            if (/\.(com|exe)$/.test(b)) return byBase.get(b) || null;
            return byBase.get(b + '.com') || byBase.get(b + '.exe') || null;   // DOS 解決順
        };
        for (const m of recipe.mains) {
            const hit = find(m.base);
            if (hit) return { name: hit, args: m.args.slice() };
        }
        return null;
    }

    // レシピの引数 (%1..%9 入り) + ユーザー入力 (Run の cmdline 欄、空白区切り) → 最終 cmdline。
    // リテラルなフラグ (-B1 等) は保持し、埋まらない %N は消える。%0 (プログラム名) は捨てる。
    function buildCmdline(args, userArgs) {
        const pos = (userArgs || '').trim().split(/\s+/).filter(Boolean);
        const out = [];
        for (const a of args) {
            if (/^%[0-9]$/.test(a)) {                       // 単独プレースホルダ
                const i = +a[1];
                if (i === 0) continue;
                if (pos[i - 1]) out.push(pos[i - 1]);
            } else if (/%[0-9]/.test(a)) {                  // トークン内に %N が埋まっている
                const sub = a.replace(/%([0-9])/g, (_, d) => (+d === 0 ? '' : (pos[+d - 1] || '')));
                if (sub) out.push(sub);
            } else {
                out.push(a);
            }
        }
        return out.join(' ');
    }

    const api = { parse, resolveMain, buildCmdline, programBasename, DRIVER_NAMES };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.qbBatScript = api;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
