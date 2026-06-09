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

// ---- 10. ② resolveSequence: ドライバ常駐の逐次実行 (元順序保持 + 各 cmd の引数) ----
{
    const r = bat.parse(batBytes(['echo off', 'mdrv98 /v', 'camelzoo %1', 'mdrv98 -r']));
    const seq = bat.resolveSequence(r, ['mdrv98.com', 'camelzoo.exe'], 'hard');
    eq(seq.map(c => c.name), ['mdrv98.com', 'camelzoo.exe', 'mdrv98.com'],
        'seq: 元順序でドライバ→本体→解除');
    eq(seq.map(c => c.args), ['/v', 'hard', '-r'], 'seq: 各 cmd の引数 (%1←hard)');
}

// ---- 11. ② 制御フロー入りは null (① 単一起動にフォールバック) ----
{
    const r = bat.parse(batBytes(['middrv -T3', ':LOOP', 'finmain %1', 'GOTO LOOP', 'middrv -R']));
    eq(bat.resolveSequence(r, ['middrv.com', 'finmain.exe'], ''), null, 'seq: 制御フロー入りは null');
}

// ---- 12. ② 単一本体は length 1 (シェル不要 → ① 単一起動) ----
{
    const seq = bat.resolveSequence(bat.parse(batBytes(['game %1'])), ['game.exe'], '');
    eq(seq.length, 1, 'seq: 単一本体は 1 要素');
    eq(seq[0].name, 'game.exe', 'seq: 本体 game.exe');
}

// ---- 13. ② 束に無いコマンドは skip / 本体が無ければ null ----
{
    const seq = bat.resolveSequence(
        bat.parse(batBytes(['mdrv98', 'setup', 'game'])), ['mdrv98.com', 'game.exe'], '');
    eq(seq.map(c => c.name), ['mdrv98.com', 'game.exe'], 'seq: 束に無い setup を skip');
    eq(bat.resolveSequence(bat.parse(batBytes(['mdrv98', 'mdrv98 -r'])), ['mdrv98.com'], ''),
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
}

console.log(`\nbatscript_test: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
