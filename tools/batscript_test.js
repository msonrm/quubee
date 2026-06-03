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

console.log(`\nbatscript_test: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
