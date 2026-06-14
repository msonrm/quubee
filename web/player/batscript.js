// batscript.js — 起動 .bat を「作者の意図した起動レシピ」として解釈する (qbBatScript)。
//
// PC-98 フリーソフトの約 1/3 は起動 .bat を同梱する (調査: games/ の 40 書庫中 14 本)。
// .bat は作者が書いた機械可読の起動レシピ ―― 主プログラム名・引数 (%1..%9)・音源ドライバの
// 常駐手順が書かれている。本モジュールは .bat をパースして「実際に走らせる主プログラム + cmdline」
// を取り出し、フロントのエントリ自動検出に橋渡しする (ゲームごとの手書き起動テーブルを不要にする)。
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
        'mdrv98', 'mdrv', 'middrv', 'middrv98', 'middrvpc', 'mmd',
        'opndrv', 'ssgdrv', 'tkydrv', 'fmpdrv', 'fmp', 'spbdrv',
        'pmd', 'pmd98', 'pmdb2', 'cats', 'calib', 'mfree',
    ]);

    // MIDI (RS-MIDI/MPU) を鳴らす常駐ドライバ。これらを使うレシピは VERMOUTH (soundfont) が
    // 要るので、Run 時に遅延ロード+有効化する (FM 専用の mdrv98 等とは区別する)。
    //  - MIDDRV: 標準 MIDI ファイル演奏ドライバ (-X1 で RS-MIDI シリアルへ送出)。
    //  - MMD: KAJA の MIDI 音楽ドライバ (PMD の MIDI 版相棒)。MPU-PC98 (0xE0D0) を直接叩く。
    //    huma_ts2 (東方封魔録) の「MIDI(MPU)」モードがこれ。enable_midi_now が MPU98II も attach する。
    const MIDI_DRIVER_NAMES = new Set(['middrv', 'middrv98', 'middrvpc', 'mmd']);

    // .bat の 1 行を解釈して { kind, ... } に分類する。
    function parseLine(line) {
        let t = line.trim();
        if (!t) return null;
        if (t[0] === '@') t = t.slice(1).trim();      // @ (echo 抑止) は捨てて中身を再評価
        if (!t) return null;
        const lc = t.toLowerCase();
        // ディレクティブ / 制御フロー (MVP ① では無視。制御フロー有無だけ記録する)
        if (lc === 'echo' || lc.startsWith('echo ') || lc.startsWith('echo.') ||  /* echo / echo X / echo. / echo.X */
            lc === 'rem' || lc.startsWith('rem ') ||
            lc === 'cls' || lc.startsWith('pause') || lc.startsWith('set ') ||
            t[0] === ':' || /^goto(\s|$)/.test(lc) || lc.startsWith('if ')) {
            const ctrl = (t[0] === ':' || /^goto(\s|$)/.test(lc) || lc.startsWith('if '));
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

    // 展開済みエントリ名一覧 → 「素の basename → 実エントリ名」を DOS の拡張子補完順
    // (.COM > .EXE)・大小無視で引く find(base) を返す。resolveMain / resolveSequence 共用。
    function entryFinder(entryNames) {
        const byBase = new Map();
        for (const n of entryNames) {
            const b = lcBase(n);
            if (!byBase.has(b)) byBase.set(b, n);   // 先勝ち (同名はまず無い)
        }
        return (base) => {
            const b = base.toLowerCase();
            if (/\.(com|exe)$/.test(b)) return byBase.get(b) || null;
            return byBase.get(b + '.com') || byBase.get(b + '.exe') || null;   // DOS 解決順
        };
    }

    // レシピ + 展開済みエントリ名一覧 → 実際に起動する主プログラムを解決する。{ name, args } か null。
    // (① 単一起動 / 表示の見出し用。複数コマンド逐次実行は resolveSequence。)
    function resolveMain(recipe, entryNames) {
        const find = entryFinder(entryNames);
        for (const m of recipe.mains) {
            const hit = find(m.base);
            if (hit) return { name: hit, args: m.args.slice() };
        }
        return null;
    }

    // ② レシピを「.bat の元の順序で実行するコマンド列」に解決する (ドライバ常駐込み)。
    // ミニ COMMAND.COM (C 側 qb_dos_stage_script) に渡して 1 DOS セッション内で順に EXEC する用。
    // 各要素 { name(実エントリ), args(buildCmdline 済) }。userArgs は各コマンドの %N に差し込む。
    // 線形化できない (goto/if 等の制御フロー入り) / 主プログラムが束に無い → null (① にフォールバック)。
    // 束に無いコマンド (システム依存ユーティリティ等) は best-effort で読み飛ばす。
    function resolveSequence(recipe, entryNames, userArgs) {
        if (recipe.hasControlFlow) return null;        // 分岐入りは順序が確定しない → ①
        const find = entryFinder(entryNames);
        const seq = [];
        let sawMain = false;
        for (const l of recipe.lines) {
            if (l.kind !== 'command') continue;        // directive (echo/rem/set/cls/pause) は無視
            const hit = find(l.base);
            if (!hit) continue;                        // 束に無い → スキップ
            const key = l.base.toLowerCase().replace(/\.(com|exe|bat)$/, '');
            if (!DRIVER_NAMES.has(key)) sawMain = true; // ドライバ以外 = ゲーム本体相当
            seq.push({ name: hit, args: buildCmdline(l.args, userArgs) });
        }
        if (!sawMain) return null;                     // 本体が無い列は無効 → ①
        return seq;
    }

    // ③ レシピを「制御フロー込みの文ステートメント列」に解決する (errorlevel ラダー対応)。
    // C 側インタプリタ (PC + 直近 exit code = g_last_exit_code で解釈) に渡す中間表現。各文:
    //   { op:'cmd',   name, args }       実エントリ名 + buildCmdline 済 cmdline
    //   { op:'echo',  text }             作者メッセージ (生バイト文字列、実行時に tty へ流す)
    //   { op:'goto',  target }           無条件ジャンプ (target = 文 index、末尾超え = 終了)
    //   { op:'iferr', n, neg, target }   if [not] errorlevel n goto target (実行時 (code>=n) を neg で反転)
    // ラベルは文にせず「直後の文 index」へ解決する。`if "%N"=="..."` はユーザ引数が起動時に既知なので
    // 静的に畳む (真→無条件 goto / 偽→捨てる)。未対応の if (then が goto 以外・if exist) や
    // for/call/choice/shift が出たら null を返し、フロントは ① 単一起動へ退避する (honest fallback)。
    const CONTROL_KEYWORDS = new Set(['for', 'call', 'choice', 'shift']);
    function buildStatements(recipe, entryNames, userArgs) {
        const find = entryFinder(entryNames);
        const pos = (userArgs || '').trim().split(/\s+/).filter(Boolean);
        const stmts = [];
        const labelIndex = Object.create(null);   // label(小文字) -> 直後の文 index
        const pend = [];                          // {i, name}: goto/iferr の target 解決待ち
        let sawMain = false;

        for (const l of recipe.lines) {
            if (l.kind === 'command') {
                const key = l.base.toLowerCase().replace(/\.(com|exe|bat)$/, '');
                if (CONTROL_KEYWORDS.has(key)) return null;   // for/call 等は線形化不能 → ①
                const hit = find(l.base);
                if (!hit) continue;                           // 束に無い → skip (現挙動踏襲, best-effort)
                if (!DRIVER_NAMES.has(key)) sawMain = true;
                stmts.push({ op: 'cmd', name: hit, args: buildCmdline(l.args, userArgs) });
                continue;
            }
            const t = l.text;
            const lc = t.toLowerCase();
            if (t[0] === ':') {                               // :label
                const name = t.slice(1).trim().split(/\s+/)[0].toLowerCase();
                if (name) labelIndex[name] = stmts.length;
                continue;
            }
            if (/^goto(\s|$)/.test(lc)) {                     // goto label
                const name = t.slice(4).trim().split(/\s+/)[0].toLowerCase();
                if (!name) return null;
                pend.push({ i: stmts.length, name });
                stmts.push({ op: 'goto', target: -1 });
                continue;
            }
            if (lc === 'if' || lc.startsWith('if ')) {        // 条件分岐
                const cond = parseIf(t, pos);
                if (!cond) return null;                       // 未対応 if → ① へ退避
                if (cond.kind === 'err') {
                    pend.push({ i: stmts.length, name: cond.label });
                    stmts.push({ op: 'iferr', n: cond.n, neg: cond.neg, target: -1 });
                } else if (cond.kind === 'str' && cond.taken) {   // 静的に畳む (偽は捨てる)
                    pend.push({ i: stmts.length, name: cond.label });
                    stmts.push({ op: 'goto', target: -1 });
                }
                continue;
            }
            if (lc.startsWith('echo')) {                      // 作者メッセージ
                if (lc === 'echo on' || lc === 'echo off') continue;  // コマンドエコー指令 (我々は元から非表示)
                let text = t.slice(4);
                if (text[0] === '.') text = text.slice(1);    // "echo." = 空行 / "echo.X" = X
                else if (text[0] === ' ') text = text.slice(1);  // "echo X" の先頭1空白を除去
                stmts.push({ op: 'echo', text });
                continue;
            }
            // rem / cls / pause / set / prompt / path → 無視 (errorlevel も変えない、実 DOS と一致)
        }

        if (!sawMain) return null;                            // 本体が無い → ①
        for (const p of pend) {
            if (!(p.name in labelIndex)) return null;         // 未知ラベルへの goto → ①
            stmts[p.i].target = labelIndex[p.name];
        }
        return stmts;
    }

    // "if ..." 1 行を解析。{kind:'err', n, neg, label} | {kind:'str', taken, label} | null (未対応)。
    // 対応: `if [not] errorlevel N goto LABEL` / `if [not] "A"=="B" goto LABEL`
    //   (errorlevel の余分な `=`/`==`・前後空白を許容)。then 節が goto 以外 (例 `if errorlevel 1 mi2 err`)
    //   や `if exist ...` は未対応 → null。文字列側の %N はユーザ引数で置換してから比較する。
    function parseIf(t, pos) {
        let s = t.replace(/^if\s+/i, '');
        let neg = false;
        const mNot = s.match(/^not\s+/i);
        if (mNot) { neg = true; s = s.slice(mNot[0].length); }
        let m = s.match(/^errorlevel\s*=*\s*(\d+)\s+goto\s+(\S+)/i);
        if (m) return { kind: 'err', n: +m[1], neg, label: m[2].toLowerCase() };
        m = s.match(/^"?([^"=]*)"?\s*==\s*"?([^"=]*)"?\s+goto\s+(\S+)/i);
        if (m) {
            // trim: クォート無し形 (`if %1 == FM`) でキャプチャが '==' 前の空白を含む
            const a = substArg(m[1].trim(), pos), b = substArg(m[2].trim(), pos);
            // %VAR% 等の未置換参照が残る比較は静的に畳めない (set は未対応) → ① へ退避
            if (a.includes('%') || b.includes('%')) return null;
            const taken = neg ? (a !== b) : (a === b);
            return { kind: 'str', taken, label: m[3].toLowerCase() };
        }
        return null;
    }

    // 文字列オペランド内の %N をユーザ引数 (位置パラメータ配列) で置換する。
    function substArg(s, pos) {
        return s.replace(/%([0-9])/g, (_, d) => (+d === 0 ? '' : (pos[+d - 1] || '')));
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

    // buildStatements の文列 → C (qb_dos_stage_batch) へ渡す直列化文字列。1 文 1 行、
    // フィールドは \t 区切り (SJIS の lead/trail に \t \n は現れないので生バイトと衝突しない):
    //   C \t PATH \t ARGS   /   E \t TEXT   /   G \t TARGET   /   I \t N \t NEG \t TARGET
    function serializeStatements(stmts) {
        return stmts.map((s) => {
            if (s.op === 'cmd')  return 'C\t' + s.name + '\t' + (s.args || '');
            if (s.op === 'echo') return 'E\t' + s.text;
            if (s.op === 'goto') return 'G\t' + s.target;
            return 'I\t' + s.n + '\t' + (s.neg ? 1 : 0) + '\t' + s.target;   // iferr
        }).join('\n') + '\n';
    }

    // レシピが MIDI ドライバ (MIDDRV 等) を起動するか。Run 時に VERMOUTH (soundfont) を
    // 遅延ロードするかの判定に使う。
    function usesMidi(recipe) {
        if (!recipe || !recipe.lines) return false;
        return recipe.lines.some((l) =>
            l.kind === 'command' &&
            MIDI_DRIVER_NAMES.has(l.base.toLowerCase().replace(/\.(com|exe|bat)$/, '')));
    }

    const api = { parse, resolveMain, resolveSequence, buildStatements, serializeStatements, buildCmdline, programBasename, usesMidi, DRIVER_NAMES };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.qbBatScript = api;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
