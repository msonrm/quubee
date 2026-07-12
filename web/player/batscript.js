// batscript.js — 起動 .bat を「作者の意図した起動レシピ」として解釈する (qbBatScript)。
//
// PC-98 フリーソフトの約 1/3 は起動 .bat を同梱する (調査: games/ の 40 書庫中 14 本)。
// .bat は作者が書いた機械可読の起動レシピ ―― 主プログラム名・引数 (%1..%9)・音源ドライバの
// 常駐手順が書かれている。本モジュールは .bat をパースして「実際に走らせる主プログラム + cmdline」
// を取り出し、フロントのエントリ自動検出に橋渡しする (ゲームごとの手書き起動テーブルを不要にする)。
//
// 実行は 2 段構え: ① 単一起動 (resolveMain — 単一 cmd で set/cd も分岐も無い .bat と素の COM/EXE) /
// ③ 文インタプリタ (buildStatements — 複数コマンド・set/cd・if errorlevel/goto・call/cls。ドライバ TSR
// の常駐 mdrv98 → game → mdrv98 -r を 1 DOS セッション内で保ち、分岐は C 側が errorlevel で実行時評価。
// call は呼び先 .bat を bat 単位のローカルラベル空間でインライン展開)。
// 未対応構文 (for/if exist 等) は null を返し ① へ退避する (honest fallback)。
// かつて存在した ② 線形列経路 (resolveSequence → qb_dos_stage_script) は ③ の部分集合であり
// 2026-07-11 に ③ へ統合・撤去した。
//
// 純 JS・Wasm 不変。tools/batscript_test.js が合成 fixture で振る舞いを守る。

(function (root) {
    'use strict';

    // 起動 .bat がゲーム本体の「周り」でロードする音源ドライバ / セットアップ常駐ユーティリティ。
    // MVP ① ではこれらを読み飛ばし、主プログラムだけを直接起動する (上のコメント参照)。
    // 拡張子は付けず素の名前で照合する (.bat 内も素の名前で呼ぶため)。
    const DRIVER_NAMES = new Set([
        'mdrv98', 'mdrv', 'middrv', 'middrv98', 'middrvpc', 'mmd', 'midrv',
        'opndrv', 'ssgdrv', 'tkydrv', 'fmpdrv', 'fmp', 'spbdrv',
        'pmd', 'pmd98', 'pmdb2', 'cats', 'calib', 'mfree',
    ]);

    // MIDI (RS-MIDI/MPU) を鳴らす常駐ドライバ。これらを使うレシピは VERMOUTH (soundfont) が
    // 要るので、Run 時に遅延ロード+有効化する (FM 専用の mdrv98 等とは区別する)。
    //  - MIDDRV: 標準 MIDI ファイル演奏ドライバ (-X1 で RS-MIDI シリアルへ送出)。
    //  - MIDRV: AMEL (amel133) 同梱の MIDI ドライバ (Midrv Ver1.60、MIDDRV とは別物)。MPU/SB98 を
    //    探し、見つからなければ RS232C (RS-MIDI) へフォールバックして常駐する。enable_midi_now で
    //    MPU98II が attach されれば MPU 経由、されなくても RS-MIDI が結線済みなので合成器に届く。
    //  - MMD: KAJA の MIDI 音楽ドライバ (PMD の MIDI 版相棒)。MPU-PC98 (0xE0D0) を直接叩く。
    //    huma_ts2 (東方封魔録) の「MIDI(MPU)」モードがこれ。enable_midi_now が MPU98II も attach する。
    const MIDI_DRIVER_NAMES = new Set(['middrv', 'middrv98', 'middrvpc', 'mmd', 'midrv']);

    // .bat の 1 行を解釈して { kind, ... } に分類する。
    function parseLine(line) {
        let t = line.trim();
        if (!t) return null;
        if (t[0] === '@') t = t.slice(1).trim();      // @ (echo 抑止) は捨てて中身を再評価
        if (!t) return null;
        const lc = t.toLowerCase();
        // set VAR=VALUE → 環境変数。cd/chdir PATH → カレント移動。どちらも C 側インタプリタが
        // 実行する (ドライバ TSR と同じ 1 セッション内)。環境変数でデータディレクトリを知る
        // ソフト (MUAP98 等) や、本体ディレクトリへ cd してから起動するレシピのため。
        if (/^set\s+\S/i.test(t)) {
            return { kind: 'set', text: t.replace(/^set\s+/i, '') };   // "VAR=VALUE" (値の大小は保持)
        }
        // cd/chdir: "cd \dir" (空白) も "cd\dir"/"cd.." (グルー) も拾う。"cdplayer" 等は除外
        // (cd/chdir の直後が空白か区切り [\ / .] か行末のときだけ)。引数無し cd (cwd 表示) は無視。
        const mCd = t.match(/^(?:cd|chdir)(?:\s+|(?=[\\/.]))(\S.*)$/i);
        if (mCd) return { kind: 'cd', path: mCd[1].trim() };
        if (/^(?:cd|chdir)\s*$/i.test(t)) return null;

        // ディレクティブ / 制御フロー (MVP ① では無視。制御フロー有無だけ記録する)
        if (lc === 'echo' || lc.startsWith('echo ') || lc.startsWith('echo.') ||  /* echo / echo X / echo. / echo.X */
            lc === 'rem' || lc.startsWith('rem ') ||
            lc === 'cls' || lc.startsWith('pause') ||
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
        let hasControlFlow = false, hasEnvOps = false;
        for (const l of lines) {
            if (l.kind === 'directive') { if (l.ctrl) hasControlFlow = true; continue; }
            if (l.kind === 'set' || l.kind === 'cd') { hasEnvOps = true; continue; }
            const key = l.base.toLowerCase().replace(/\.(com|exe|bat)$/, '');
            if (DRIVER_NAMES.has(key)) drivers.push(l); else mains.push(l);
        }
        return { mains, drivers, hasControlFlow, hasEnvOps, lines };
    }

    // 末尾要素を小文字 basename で取る (照合用)。
    function lcBase(name) {
        return name.split(/[\\/]/).pop().toLowerCase();
    }

    // 展開済みエントリ名一覧 → 「素の basename → 実エントリ名」を DOS の拡張子補完順
    // (.COM > .EXE)・大小無視で引く find(base) を返す。resolveMain / buildStatements 共用。
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
    // (① 単一起動 / 表示の見出し用。複数コマンド逐次実行は buildStatements。)
    function resolveMain(recipe, entryNames) {
        const find = entryFinder(entryNames);
        for (const m of recipe.mains) {
            const hit = find(m.base);
            if (hit) return { name: hit, args: m.args.slice() };
        }
        return null;
    }

    // ③ レシピを「制御フロー込みの文ステートメント列」に解決する (errorlevel ラダー対応)。
    // C 側インタプリタ (PC + 直近 exit code = g_last_exit_code で解釈) に渡す中間表現。各文:
    //   { op:'cmd',   name, args }       実エントリ名 + buildCmdline 済 cmdline
    //   { op:'echo',  text }             作者メッセージ (生バイト文字列、実行時に tty へ流す)
    //   { op:'goto',  target }           無条件ジャンプ (target = 文 index、末尾超え = 終了)
    //   { op:'iferr', n, neg, target }   if [not] errorlevel n goto target (実行時 (code>=n) を neg で反転)
    //   { op:'cls' }                     画面クリア (実 DOS の CLS = ESC[2J 相当)
    // ラベルは文にせず「直後の文 index」へ解決する。`if "%N"=="..."` はユーザ引数が起動時に既知なので
    // 静的に畳む (真→無条件 goto / 偽→捨てる)。未対応の if (then が goto 以外・if exist) や
    // for/choice/shift が出たら null を返し、フロントは ① 単一起動へ退避する (honest fallback)。
    //
    // `call X` は実 DOS 同様に対応する (2026-07-12、NP21/W 開発者報告の bat が契機):
    //   - X が .com/.exe → 通常の cmd 文 (実 DOS の CALL はバッチ以外には透過)。
    //   - X が .bat → readEntry で読んでその場にインライン展開。ラベル空間は bat ごとに
    //     ローカル (実 DOS: GOTO は現在実行中のバッチファイル内だけを探す) なので、呼び元と
    //     呼び先に同名ラベルがあっても互いに独立に解決される。呼び先の位置パラメータ %N は
    //     call の引数 (呼び元の %N を先に置換)。深さ上限 4 + 循環ガード。
    //   - X が束に無い / readEntry が無い・読めない → その行だけ読み飛ばして続行
    //     (実 DOS も missing コマンドはエラー表示して続行する。console.warn で診断可能に)。
    const CONTROL_KEYWORDS = new Set(['for', 'choice', 'shift']);
    const CALL_DEPTH_MAX = 4;
    function buildStatements(recipe, entryNames, userArgs, readEntry) {
        const find = entryFinder(entryNames);
        const batByBase = new Map();              // 素の basename → .bat 実エントリ名 (CALL 先解決用)
        for (const n of entryNames) {
            const b = lcBase(n);
            if (/\.bat$/.test(b) && !batByBase.has(b)) batByBase.set(b, n);
        }
        const stmts = [];
        const callStack = new Set();              // 循環 call ガード (実エントリ名)
        let sawMain = false;
        const warn = (m) => { try { console.warn('[batscript] ' + m); } catch (_) { /* console 無し環境 */ } };

        // 1 つの .bat (最上位 or CALL 先) の行列を stmts へ追記する。labelIndex/pend を
        // 呼び出しごとのローカルに持つ = ラベル空間が bat 単位で独立 (文 index は共有配列の
        // 絶対値なので衝突しない)。末尾ラベルは「この bat の直後 = 呼び元の次の文」に自然に
        // 解決される。戻り値 true=OK / false=線形化不能 (全体を null → ① へ)。
        function appendLines(lines, userArgsStr, depth) {
            const pos = (userArgsStr || '').trim().split(/\s+/).filter(Boolean);
            const labelIndex = Object.create(null);   // label(小文字) -> 直後の文 index
            const pend = [];                          // {i, name}: goto/iferr の target 解決待ち

            for (const l of lines) {
                if (l.kind === 'command') {
                    const key = l.base.toLowerCase().replace(/\.(com|exe|bat)$/, '');
                    if (CONTROL_KEYWORDS.has(key)) return false;  // for/choice/shift は線形化不能 → ①
                    if (key === 'call') {
                        if (!appendCall(l, pos, depth)) return false;
                        continue;
                    }
                    const hit = find(l.base);
                    if (!hit) continue;                           // 束に無い → skip (現挙動踏襲, best-effort)
                    if (!DRIVER_NAMES.has(key)) sawMain = true;
                    stmts.push({ op: 'cmd', name: hit, args: buildCmdline(l.args, userArgsStr) });
                    continue;
                }
                if (l.kind === 'set') { stmts.push({ op: 'set', text: l.text }); continue; }
                if (l.kind === 'cd')  { stmts.push({ op: 'cd',  path: l.path }); continue; }
                const t = l.text;
                const lc = t.toLowerCase();
                if (t[0] === ':') {                               // :label
                    const name = t.slice(1).trim().split(/\s+/)[0].toLowerCase();
                    if (name) labelIndex[name] = stmts.length;
                    continue;
                }
                if (/^goto(\s|$)/.test(lc)) {                     // goto label
                    const name = t.slice(4).trim().split(/\s+/)[0].toLowerCase();
                    if (!name) return false;
                    pend.push({ i: stmts.length, name });
                    stmts.push({ op: 'goto', target: -1 });
                    continue;
                }
                if (lc === 'if' || lc.startsWith('if ')) {        // 条件分岐
                    const cond = parseIf(t, pos);
                    if (!cond) return false;                      // 未対応 if → ① へ退避
                    if (cond.kind === 'err') {
                        pend.push({ i: stmts.length, name: cond.label });
                        stmts.push({ op: 'iferr', n: cond.n, neg: cond.neg, target: -1 });
                    } else if (cond.kind === 'str' && cond.taken) {   // 静的に畳む (偽は捨てる)
                        pend.push({ i: stmts.length, name: cond.label });
                        stmts.push({ op: 'goto', target: -1 });
                    }
                    continue;
                }
                if (lc === 'cls') { stmts.push({ op: 'cls' }); continue; }
                if (lc.startsWith('echo')) {                      // 作者メッセージ
                    if (lc === 'echo on' || lc === 'echo off') continue;  // コマンドエコー指令 (我々は元から非表示)
                    let text = t.slice(4);
                    if (text[0] === '.') text = text.slice(1);    // "echo." = 空行 / "echo.X" = X
                    else if (text[0] === ' ') text = text.slice(1);  // "echo X" の先頭1空白を除去
                    stmts.push({ op: 'echo', text });
                    continue;
                }
                // rem / pause / prompt / path → 無視 (errorlevel も変えない、実 DOS と一致)
            }

            for (const p of pend) {
                if (!(p.name in labelIndex)) return false;        // 未知ラベルへの goto → ①
                stmts[p.i].target = labelIndex[p.name];
            }
            return true;
        }

        // `call X [args...]` 1 行の処理 (appendLines から)。戻り値 false = 全体を ① へ。
        function appendCall(l, pos, depth) {
            const rawTgt = l.args[0];
            if (!rawTgt) return true;                             // 裸の "call" は無視
            const tgt = substArg(rawTgt, pos);
            const base = programBasename(tgt);
            const callArgs = l.args.slice(1).map((a) => substArg(a, pos)).join(' ');
            const exe = find(base);
            if (exe) {                                            // .com/.exe → 通常 cmd (実 DOS 準拠)
                const key = base.toLowerCase().replace(/\.(com|exe|bat)$/, '');
                if (!DRIVER_NAMES.has(key)) sawMain = true;
                stmts.push({ op: 'cmd', name: exe, args: callArgs });
                return true;
            }
            const b = base.toLowerCase();
            const bat = /\.bat$/.test(b) ? batByBase.get(b) : batByBase.get(b + '.bat');
            if (!bat) { warn('call ' + tgt + ': 束に見つからないため読み飛ばし (実 DOS も続行する)'); return true; }
            if (!readEntry) { warn('call ' + tgt + ': readEntry 未指定のため読み飛ばし'); return true; }
            if (depth >= CALL_DEPTH_MAX) { warn('call ' + tgt + ': 深さ上限 ' + CALL_DEPTH_MAX + ' 超過のため読み飛ばし'); return true; }
            if (callStack.has(bat)) { warn('call ' + tgt + ': 循環 call のため読み飛ばし'); return true; }
            const data = readEntry(bat);
            if (data == null) { warn('call ' + tgt + ': 読めないため読み飛ばし'); return true; }
            callStack.add(bat);
            const ok = appendLines(parse(data).lines, callArgs, depth + 1);
            callStack.delete(bat);
            return ok;
        }

        if (!appendLines(recipe.lines, userArgs || '', 0)) return null;
        if (!sawMain) return null;                            // 本体が無い → ①
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
    //   C \t PATH \t ARGS   /   E \t TEXT   /   S \t VAR=VALUE   /   D \t PATH
    //   G \t TARGET         /   I \t N \t NEG \t TARGET          /   L (cls)
    function serializeStatements(stmts) {
        return stmts.map((s) => {
            if (s.op === 'cmd')  return 'C\t' + s.name + '\t' + (s.args || '');
            if (s.op === 'echo') return 'E\t' + s.text;
            if (s.op === 'set')  return 'S\t' + s.text;
            if (s.op === 'cd')   return 'D\t' + s.path;
            if (s.op === 'goto') return 'G\t' + s.target;
            if (s.op === 'cls')  return 'L';
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

    const api = { parse, resolveMain, buildStatements, serializeStatements, buildCmdline, programBasename, usesMidi, DRIVER_NAMES };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.qbBatScript = api;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
