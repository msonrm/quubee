#!/usr/bin/env node
// batscript.js 検証ハーネス。
//   起動 .bat の解釈 (主プログラム抽出 / 引数 %N / ドライバ分類 / ドライブレター / ^Z 切り) を
//   合成 fixture で守る。実 .bat は games/ にあり再配布不可でコミットしないので (project 方針)、
//   調査で観測した実パターンを再現する合成データで検証する (diskimage/lzh の合成テストと同方針)。
//
// 使い方: node tools/batscript_test.js

const bat = require('../web/player/batscript.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// CRLF + 末尾 ^Z を付けて「実ファイルらしい」バイト列にする helper。
function batBytes(lines) {
    let s = lines.join('\r\n') + '\r\n\x1a';
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
}
// レシピ → 解決した主プログラムの素名 (小文字) を返す。
function mainOf(recipe, entries) {
    const m = bat.resolveMain(recipe, entries);
    return m ? m.name.toLowerCase() : null;
}

// ---- 1. 引数パススルー: zar.bat 相当 "ZAR %1" ----
{
    const r = bat.parse(batBytes(['ZAR %1']));
    eq(r.mains.map(m => m.base), ['ZAR'], 'zar: main は ZAR');
    eq(r.drivers.length, 0, 'zar: ドライバ無し');
    eq(mainOf(r, ['zar.exe', 'zar.doc', 'siz3.exe']), 'zar.exe', 'zar: ZAR→zar.exe 解決');
    eq(bat.buildCmdline(r.mains[0].args, 'PLAY'), 'PLAY', 'zar: %1←PLAY');
    eq(bat.buildCmdline(r.mains[0].args, ''), '', 'zar: %1 未入力→空');
}

// ---- 2. 音源ドライバで包む: cz.bat 相当 ----
{
    const r = bat.parse(batBytes(['mdrv98', 'camelzoo', 'mdrv98 -r']));
    eq(r.mains.map(m => m.base), ['camelzoo'], 'cz: 主は camelzoo のみ (mdrv98 は除外)');
    eq(r.drivers.length, 2, 'cz: ドライバ行 2 (ロード/アンロード)');
    eq(mainOf(r, ['camelzoo.exe', 'mdrv98.com']), 'camelzoo.exe', 'cz: camelzoo→.exe');
}

// ---- 3. 複数ドライバ + echo off: dd.bat 相当 ----
{
    const r = bat.parse(batBytes(['echo off', 'ssgdrv', 'opndrv', 'tkydrv', 'dd_opn', 'mfree']));
    eq(r.mains.map(m => m.base), ['dd_opn'], 'dd: 主は dd_opn (drv 群と mfree は除外)');
    eq(r.drivers.map(d => d.base).sort(), ['mfree', 'opndrv', 'ssgdrv', 'tkydrv'], 'dd: ドライバ4');
}

// ---- 4. .COM > .EXE の解決順 ----
{
    const r = bat.parse(batBytes(['game']));
    eq(mainOf(r, ['game.exe', 'game.com']), 'game.com', '解決順: .com 優先');
    eq(mainOf(r, ['game.exe']), 'game.exe', '解決順: .com 無→.exe');
    eq(mainOf(r, ['other.exe']), null, '解決: 該当無→null');
}

// ---- 5. ドライブレター / パス付き起動 "A:GAME" "\\PROG\\GAME" ----
{
    eq(bat.programBasename('A:GAME.EXE'), 'GAME.EXE', 'drive: A: 除去');
    eq(bat.programBasename('A:\\PROG\\GAME'), 'GAME', 'drive+path: 最終要素');
    eq(bat.programBasename('.\\game'), 'game', 'rel path: ./ 除去');
    const r = bat.parse(batBytes(['A:GAME %1 %2']));
    eq(mainOf(r, ['game.exe']), 'game.exe', 'drive: A:GAME→game.exe (大小無視)');
}

// ---- 6. リテラルフラグ保持 + %N 混在: "finmain -B1 %1 %2" ----
{
    const r = bat.parse(batBytes(['finmain -B1 %1 %2']));
    eq(bat.buildCmdline(r.mains[0].args, 'save01'), '-B1 save01', 'flag+%1: -B1 残し %1←save01');
    eq(bat.buildCmdline(r.mains[0].args, ''), '-B1', 'flag のみ (未入力 %N は消える)');
    eq(bat.buildCmdline(r.mains[0].args, 'a b c'), '-B1 a b', 'flag + %1=a %2=b (%3 余り無視)');
}

// ---- 7. 制御フロー検出: finalty.bat 相当 ----
{
    const r = bat.parse(batBytes(['echo off', 'middrv -T3', ':LOOP', 'findemo %1',
        'finmain %1 %2', 'IF ERRORLEVEL == 1 GOTO END', 'GOTO LOOP', ':END', 'middrv -R']));
    ok(r.hasControlFlow, 'finalty: 制御フロー検出');
    eq(r.mains.map(m => m.base), ['findemo', 'finmain'], 'finalty: 主候補 2 (demo→main)');
    // MVP: 解決可能な最初の main を採る (= findemo)。完全な逐次は ② の課題。
    eq(mainOf(r, ['findemo.exe', 'finmain.exe']), 'findemo.exe', 'finalty: 先頭 main を採用');
}

// ---- 8. ^Z 直後切り (改行なしで EOF): "stbopn\x1a..." ----
{
    let s = 'echo off\r\nstbopn\x1a\xff\xff\xff';   // ^Z 以降にゴミ
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    const r = bat.parse(u);
    eq(r.mains.map(m => m.base), ['stbopn'], '^Z: 切って stbopn だけ (ゴミ混入なし)');
}

// ---- 9. 引数なし主プログラム: "oz1" ----
{
    const r = bat.parse(batBytes(['echo off', 'mdrv98', 'oz1', 'mdrv98 -r']));
    eq(r.mains.map(m => m.base), ['oz1'], 'oz: 主は oz1');
    eq(bat.buildCmdline(r.mains[0].args, 'ignored'), '', 'oz: 引数テンプレ無→空 cmdline');
}

// ---- 10. 線形 .bat → 文列: ドライバ常駐の逐次実行 (元順序保持 + 各 cmd の引数) ----
// (旧 ② resolveSequence の守備範囲。2026-07-11 に buildStatements へ統合 — 線形列は
//  cmd 文だけの文プログラムとして同じ経路を通る。)
{
    const r = bat.parse(batBytes(['echo off', 'mdrv98 /v', 'camelzoo %1', 'mdrv98 -r']));
    const stmts = bat.buildStatements(r, ['mdrv98.com', 'camelzoo.exe'], 'hard');
    eq(stmts.map(s => s.op), ['cmd', 'cmd', 'cmd'], 'seq: 線形 .bat は cmd 文のみ (echo off は消える)');
    eq(stmts.map(c => c.name), ['mdrv98.com', 'camelzoo.exe', 'mdrv98.com'],
        'seq: 元順序でドライバ→本体→解除');
    eq(stmts.map(c => c.args), ['/v', 'hard', '-r'], 'seq: 各 cmd の引数 (%1←hard)');
}

// ---- 11. 制御フロー入りも同じ経路: goto がラベルの文 index へ解決される ----
// (旧 ② では null → ① 退避だったケース。統合後は文インタプリタが実行時に分岐する。)
{
    const r = bat.parse(batBytes(['middrv -T3', ':LOOP', 'finmain %1', 'GOTO LOOP', 'middrv -R']));
    ok(r.hasControlFlow, 'seq: hasControlFlow が立つ (Run 側のラベル表示用)');
    const stmts = bat.buildStatements(r, ['middrv.com', 'finmain.exe'], '');
    eq(stmts.map(s => s.op), ['cmd', 'cmd', 'goto', 'cmd'], 'seq: 制御フロー入りも文列に落ちる');
    eq(stmts[2].target, 1, 'seq: goto LOOP は :LOOP 直後 (finmain) の文 index へ解決');
}

// ---- 12. 単一本体は cmd 1 文 (Run 側はシェル不要と判定 → ① 単一起動) ----
{
    const stmts = bat.buildStatements(bat.parse(batBytes(['game %1'])), ['game.exe'], '');
    eq(stmts.filter(s => s.op === 'cmd').length, 1, 'seq: 単一本体は cmd 1 文');
    eq(stmts[0].name, 'game.exe', 'seq: 本体 game.exe');
}

// ---- 13. 束に無いコマンドは skip / 本体が無ければ null ----
{
    const stmts = bat.buildStatements(
        bat.parse(batBytes(['mdrv98', 'setup', 'game'])), ['mdrv98.com', 'game.exe'], '');
    eq(stmts.map(c => c.name), ['mdrv98.com', 'game.exe'], 'seq: 束に無い setup を skip');
    eq(bat.buildStatements(bat.parse(batBytes(['mdrv98', 'mdrv98 -r'])), ['mdrv98.com'], ''),
        null, 'seq: 本体無し (ドライバのみ) は null');
}

// ---- 14. ③ buildStatements: errorlevel ラダー (降順) のラベル/分岐 index 解決 ----
// 注意: target は「ラベル順序でなく実際の文 index」に解くので、ラダーの並び順に依存せず正しい。
{
    const summ = (s) => s === null ? null : s.map(x =>
        x.op === 'cmd'   ? `cmd:${x.name}|${x.args}` :
        x.op === 'echo'  ? `echo:${x.text}` :
        x.op === 'goto'  ? `goto:${x.target}` :
        x.op === 'iferr' ? `iferr:${x.neg ? '!' : ''}${x.n}->${x.target}` : '?');

    const r = bat.parse(batBytes([
        'detect',
        'if errorlevel 2 goto two',
        'if errorlevel 1 goto one',
        'def', 'goto fin',
        ':one',  'oneprog', 'goto fin',
        ':two',  'twoprog', 'goto fin',
        ':fin',  'cleanup']));
    const st = bat.buildStatements(r, ['detect.exe','def.exe','oneprog.exe','twoprog.exe','cleanup.exe'], '');
    eq(summ(st), [
        'cmd:detect.exe|',
        'iferr:2->7',          // :two の本体 (twoprog) = index 7
        'iferr:1->5',          // :one の本体 (oneprog) = index 5
        'cmd:def.exe|',
        'goto:9',              // :fin = index 9
        'cmd:oneprog.exe|',
        'goto:9',
        'cmd:twoprog.exe|',
        'goto:9',
        'cmd:cleanup.exe|',
    ], 'buildStatements: ラダーの label→文 index 解決 (順序非依存)');
}

// ---- 15. ③ ループ (後方 goto) + iferr 前方分岐: FINAL 型 ----
{
    const summ = (s) => s.map(x =>
        x.op === 'cmd' ? `cmd:${x.name}` : x.op === 'goto' ? `goto:${x.target}` :
        x.op === 'iferr' ? `iferr:${x.n}->${x.target}` : '?');
    const r = bat.parse(batBytes([
        ':loop', 'findemo %1', 'finmain %1', 'if errorlevel 1 goto end',
        'finend', 'goto loop', ':end', 'middrv -r']));
    const st = bat.buildStatements(r, ['findemo.exe','finmain.exe','finend.exe','middrv.com'], '');
    eq(summ(st), ['cmd:findemo.exe','cmd:finmain.exe','iferr:1->5','cmd:finend.exe','goto:0','cmd:middrv.com'],
        'buildStatements: 後方 goto(loop=0) と前方 iferr(end=5)');
}

// ---- 16. ③ 文字列分岐の静的畳み込み (ユーザ引数で評価): life X.BAT 型 / 引数なし=既定枝 ----
{
    const summ = (s) => s.map(x =>
        x.op === 'cmd' ? `cmd:${x.name}|${x.args}` : x.op === 'echo' ? `echo:${x.text}` :
        x.op === 'goto' ? `goto:${x.target}` : '?');
    const lines = [
        'if not "%1"=="-?" goto skip1', 'echo usage : x [pattern]', 'goto exit',
        ':skip1', 'if not "%1"=="" goto skip2', 'life -egc life.ref', 'goto exit',
        ':skip2', 'life -egc %1', ':exit'];
    // 引数なし: %1="" → 1つ目「not ""==-?」=真→goto skip1、2つ目「not ""==""」=偽→畳んで消える
    //   → skip1 に飛び、life -egc life.ref (既定パターン) を実行
    // 引数なし: %1="" → 1つ目「not ""==-?」=真→goto skip1、2つ目「not ""==""」=偽→畳んで消える。
    //   無条件コマンド文 (life -egc %1 = skip2 本体) は到達不能でも常に emit される (PC 流で未踏になるだけ)。
    //   実行: goto skip1(3) → life -egc life.ref(3) → goto exit(=6=末尾超え=終了)。life.ref のみ走る。
    const st0 = bat.buildStatements(bat.parse(batBytes(lines)), ['life.exe'], '');
    eq(summ(st0), ['goto:3','echo:usage : x [pattern]','goto:6','cmd:life.exe|-egc life.ref','goto:6','cmd:life.exe|-egc'],
        'buildStatements: 引数なし→ skip1 経由で既定 life.ref (false枝 if は消滅・到達不能 cmd は残す)');
    // 引数あり "my.lif": 両 if とも真→goto。実行: skip1(3)→skip2(6)→life -egc my.lif のみ走る。
    const st1 = bat.buildStatements(bat.parse(batBytes(lines)), ['life.exe'], 'my.lif');
    eq(summ(st1), ['goto:3','echo:usage : x [pattern]','goto:7','goto:6','cmd:life.exe|-egc life.ref','goto:7','cmd:life.exe|-egc my.lif'],
        'buildStatements: 引数あり→ skip2 経由で life -egc my.lif (両 if が true枝 goto)');
}

// ---- 17. ③ echo を作者メッセージとして保持 (echo on/off は捨てる) ----
{
    // 注: batBytes は &0xff で latin1 化するので Japanese は壊れる (SJIS は C 側 tty の責務、
    //     buildStatements は echo 文字列を素通しするだけ)。ここでは ASCII で機構を検証。
    const r = bat.parse(batBytes(['echo off', 'echo  HELLO  PLAYER', 'echo.', 'game', 'echo on']));
    const st = bat.buildStatements(r, ['game.exe'], '');
    eq(st.map(x => x.op), ['echo','echo','cmd'], 'echo: on/off は捨て text 行と空行を保持');
    eq(st[0].text, ' HELLO  PLAYER', 'echo: text 保持 (先頭1空白のみ除去・以降は維持)');
    eq(st[1].text, '', 'echo.: 空行');
}

// ---- 18. ③ 未対応構文は null (① 単一起動へ honest fallback) ----
{
    // then が goto 以外 (if errorlevel N <command>) = life M.BAT (ビルド用) 型
    eq(bat.buildStatements(bat.parse(batBytes(['tmake', 'if errorlevel 1 mi2 err', 'type err'])),
        ['tmake.exe'], ''), null, 'buildStatements: if-then-command は null');
    // for ループ
    eq(bat.buildStatements(bat.parse(batBytes(['for %i in (*.dat) do copy %i z', 'game'])),
        ['game.exe'], ''), null, 'buildStatements: for は null');
    // 未知ラベルへの goto
    eq(bat.buildStatements(bat.parse(batBytes(['game', 'goto nowhere'])),
        ['game.exe'], ''), null, 'buildStatements: 未知ラベル goto は null');
    // 本体なし (ドライバのみ)
    eq(bat.buildStatements(bat.parse(batBytes(['mdrv98', 'mdrv98 -r'])),
        ['mdrv98.com'], ''), null, 'buildStatements: 本体無しは null');
    // %VAR% (set 由来) 比較は静的に畳めない → null (literal 比較で誤分岐しない)
    eq(bat.buildStatements(bat.parse(batBytes(
        ['set SND=ON', 'if "%SND%"=="ON" goto fm', 'game', ':fm', 'fmgame'])),
        ['game.exe', 'fmgame.exe'], ''), null, 'buildStatements: %VAR% 比較は null');
    // ラベル無し goto
    eq(bat.buildStatements(bat.parse(batBytes(['game', 'goto'])),
        ['game.exe'], ''), null, 'buildStatements: ラベル無し goto は null');
}

// ---- 18b. ③ 文字列比較の trim / goto 語境界 (2026-06-10 コードレビュー修正分) ----
{
    const summ = (s) => s.map(x => x.op === 'cmd' ? `cmd:${x.name}` : `${x.op}:${x.target}`);
    // クォート無しスペース入り比較: キャプチャが '==' 前の空白を含む → trim して評価
    const lines = ['if %1 == FM goto fm', 'game', 'goto end', ':fm', 'fmgame', ':end'];
    const stFM = bat.buildStatements(bat.parse(batBytes(lines)), ['game.exe', 'fmgame.exe'], 'FM');
    eq(summ(stFM), ['goto:3', 'cmd:game.exe', 'goto:4', 'cmd:fmgame.exe'],
        'parseIf: クォート無し空白入り比較は trim して評価 (引数 FM 一致→goto 枝)');
    const st0 = bat.buildStatements(bat.parse(batBytes(lines)), ['game.exe', 'fmgame.exe'], '');
    eq(summ(st0), ['cmd:game.exe', 'goto:3', 'cmd:fmgame.exe'],
        'parseIf: 引数なし→不一致で if 消滅 (既定枝)');
    // goto 語境界: goto* 名のコマンド (gotoxy 等) は goto 文と誤分類しない
    const r = bat.parse(batBytes(['gotoxy 0 0', 'game']));
    eq(r.hasControlFlow, false, 'parseLine: gotoxy は制御フロー扱いしない');
    const stG = bat.buildStatements(r, ['gotoxy.com', 'game.exe'], '');
    eq(stG.map(x => x.name), ['gotoxy.com', 'game.exe'],
        'buildStatements: gotoxy はコマンドとして emit');
}

// ---- 19. ③ serializeStatements (C qb_dos_stage_batch へ渡す直列化形式) ----
{
    const r = bat.parse(batBytes([
        'detect', 'if not errorlevel 2 goto low', 'echo HI MODE', 'game -hi', 'goto end',
        ':low', 'game -lo', ':end']));
    const st = bat.buildStatements(r, ['detect.com', 'game.exe'], '');
    eq(bat.serializeStatements(st),
        'C\tdetect.com\t\nI\t2\t1\t5\nE\tHI MODE\nC\tgame.exe\t-hi\nG\t6\nC\tgame.exe\t-lo\n',
        'serializeStatements: C/I/E/G 行形式 (\\t 区切り・neg=1・target=文index)');
}

// ---- 20. AMEL の MIDI レシピ (amelmidi.bat) — MIDRV は MIDI ドライバ TSR として認識する ----
// midrv.com (Midrv Ver1.60、MIDDRV とは別物) を MIDI_DRIVER_NAMES/DRIVER_NAMES に追加した回帰。
// これが無いと usesMidi=false で on-demand MIDI 結線が発火せず、midrv が RS232C へ落ちても無音になる。
{
    const r = bat.parse(batBytes(['midrv.com', 'amel.exe %1 %2 %3 %4', 'midrv.com']));
    const entries = ['amelmidi.bat', 'amel.exe', 'midrv.com', 'amel_00.dat'];
    ok(bat.usesMidi(r), 'amelmidi: usesMidi=true (midrv で MIDI 結線が発火する)');
    eq(mainOf(r, entries), 'amel.exe', 'amelmidi: 主プログラムは amel.exe (midrv はドライバ扱い)');
    eq(bat.buildStatements(r, entries, '').filter((s) => s.op === 'cmd').map((s) => s.name.toLowerCase()),
        ['midrv.com', 'amel.exe', 'midrv.com'],
        'amelmidi: 逐次列 = midrv(常駐)→amel.exe→midrv');
    // FM レシピ (amelfm.bat) は MIDI を発火させない (回帰の取り違え防止)。
    const rf = bat.parse(batBytes(['amel.exe /f %1 %2 %3 %4']));
    ok(!bat.usesMidi(rf), 'amelfm: usesMidi=false (FM 専用は MIDI ロードしない)');
}

// ---- 21. ③ call インライン展開 — NP21/W 開発者報告の bat そのままの形 (2026-07-12) ----
// 「NPCNGCLK 8 / KANI / PWOFF / CALL END」+ END.BAT。旧 ② は CALL 行を黙殺して線形実行、
// 7/11 の ②→③ 統合で CALL が null → ① 退避 → NPCNGCLK 単体実行に化けた (KANI が起動しない)
// 回帰。call 対応後は 3 cmd + END.BAT の cls/echo が 1 列に並ぶのが正。
{
    const files = { 'END.BAT': batBytes(['ECHO OFF', 'CLS', 'ECHO プログラムは終了しました']) };
    const readEntry = (n) => files[n.toUpperCase()] || null;
    const r = bat.parse(batBytes(['NPCNGCLK 8', 'KANI', 'PWOFF', 'CALL END']));
    const entries = ['NPCNGCLK.EXE', 'KANI.EXE', 'PWOFF.COM', 'END.BAT', 'TEST.BAT'];
    const st = bat.buildStatements(r, entries, '', readEntry);
    ok(st !== null, 'call: 開発者 bat が null にならない (① 退避しない)');
    eq(st.map((s) => s.op), ['cmd', 'cmd', 'cmd', 'cls', 'echo'],
        'call: NPCNGCLK→KANI→PWOFF→(END.BAT: cls→echo) の 1 列');
    eq(st.filter((s) => s.op === 'cmd').map((s) => s.name), ['NPCNGCLK.EXE', 'KANI.EXE', 'PWOFF.COM'],
        'call: cmd 3 本の順序 (KANI が起動列に居る = 回帰の本丸)');
    eq(st[0].args, '8', 'call: NPCNGCLK の引数 8 保持');
}

// ---- 22. ③ call の正直な読み飛ばし (実 DOS は missing コマンドでも続行する) ----
{
    const origWarn = console.warn; console.warn = () => {};   // 意図的スキップの警告を黙らせる
    try {
        const r = bat.parse(batBytes(['call NOTHERE', 'game']));
        const st = bat.buildStatements(r, ['game.exe'], '', () => null);
        ok(st !== null && st.length === 1 && st[0].name === 'game.exe',
            'call: 呼び先が束に無い → その行だけスキップして続行');
        // readEntry 未指定 (旧シグネチャ呼び出し) でも同じく行スキップ = 後方互換
        const r2 = bat.parse(batBytes(['call SUB', 'game']));
        const st2 = bat.buildStatements(r2, ['sub.bat', 'game.exe'], '');
        ok(st2 !== null && st2.filter((s) => s.op === 'cmd').length === 1,
            'call: readEntry 無し → スキップ (旧呼び出し互換)');
        // 循環 call (A→A) は 1 段だけ展開して循環ガードで打ち切る (無限展開しない)。
        // 展開列 = [子コピーの game, 親の game] の 2 cmd (実 DOS の再帰 1 段目と同じ形)。
        const files = { 'LOOP.BAT': batBytes(['call LOOP', 'game']) };
        const r3 = bat.parse(files['LOOP.BAT']);
        const st3 = bat.buildStatements(r3, ['loop.bat', 'game.exe'], '', (n) => files[n.toUpperCase()] || null);
        ok(st3 !== null && st3.filter((s) => s.op === 'cmd').length === 2,
            'call: 循環 call は 1 段で打ち切り (無限展開しない)');
    } finally { console.warn = origWarn; }
}

// ---- 23. ③ call の .com/.exe 透過 (実 DOS: CALL はバッチ以外にはただの実行) ----
{
    const r = bat.parse(batBytes(['call setup -x', 'game']));
    const st = bat.buildStatements(r, ['setup.com', 'game.exe'], '', () => null);
    eq(st.filter((s) => s.op === 'cmd').map((s) => [s.name, s.args]),
        [['setup.com', '-x'], ['game.exe', '']],
        'call: .com 透過 (引数付き通常 cmd)');
}

// ---- 24. ③ call のラベル空間はバッチ単位でローカル (同名 :END の衝突が起きない) ----
// 実 DOS: GOTO は現在実行中のバッチファイル内だけを探す。呼び元と呼び先の同名ラベルは
// それぞれ独立解決 — フラット展開でも target index が交差しないことを厳密に守る。
{
    const files = { 'SUB.BAT': batBytes(['goto END', 'echo CHILD-SKIP', ':END', 'echo CHILD-TAIL']) };
    const r = bat.parse(batBytes(['call SUB', 'goto END', 'echo PARENT-SKIP', ':END', 'game']));
    const st = bat.buildStatements(r, ['sub.bat', 'game.exe'], '', (n) => files[n.toUpperCase()] || null);
    // 展開列: [0]=goto(子) [1]=echo CHILD-SKIP [2]=echo CHILD-TAIL [3]=goto(親) [4]=echo PARENT-SKIP [5]=cmd game
    eq(st.map((s) => s.op), ['goto', 'echo', 'echo', 'goto', 'echo', 'cmd'], 'call ラベル: 展開列の形');
    eq(st[0].target, 2, 'call ラベル: 子の goto END → 子の :END (=2、CHILD-TAIL へ)');
    eq(st[3].target, 5, 'call ラベル: 親の goto END → 親の :END (=5、game へ)');
}

// ---- 25. ③ call の位置パラメータ伝播 (call SUB %1 X → 呼び先の %1 %2) ----
{
    const files = { 'SUB.BAT': batBytes(['game %1 %2']) };
    const r = bat.parse(batBytes(['call SUB %1 X']));
    const st = bat.buildStatements(r, ['sub.bat', 'game.exe'], 'AAA', (n) => files[n.toUpperCase()] || null);
    eq(st[0] && st[0].args, 'AAA X', 'call 引数: 親 %1 置換 → 子の %1 %2 に届く');
}

// ---- 26. ③ for/choice/shift は依然 null (call だけを解禁した回帰ガード) + cls 直列化 ----
{
    ok(bat.buildStatements(bat.parse(batBytes(['for %%i in (a) do game', 'game'])), ['game.exe'], '', () => null) === null,
        'for は依然 null → ① 退避');
    const st = bat.buildStatements(bat.parse(batBytes(['cls', 'game'])), ['game.exe'], '');
    eq(bat.serializeStatements(st), 'L\nC\tgame.exe\t\n', 'serializeStatements: cls は "L" 行');
}

console.log(`\nbatscript_test: pass=${pass} fail=${fail}`);
