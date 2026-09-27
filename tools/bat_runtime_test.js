#!/usr/bin/env node
// bat_runtime_test.js — .bat の実行時解釈 (native/dos_batch.c、2026-09-27) の回帰。
//
// 合成した .bat と小さな COM (終了コードを返すだけ) を Machine.boot で走らせ、画面 (テキスト VRAM) と
// /run のファイルで確かめる。旧方式 (JS の事前線形化) では扱えなかったもの: %VAR%・IF の後ろの任意の
// コマンド・IF EXIST・CALL なしの .bat 呼び出し・SHIFT・FOR・内部コマンド (TYPE/COPY/DEL/REN/MD/RD/
// XCOPY)・見つからないコマンドのメッセージ・PAUSE のキー待ち・COMMAND /C。
// 使い方: node tools/bat_runtime_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine } = require('./lib/machine');

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }
const exitCom = (code) => Buffer.from([0xB8, code, 0x4C, 0xCD, 0x21]);   // mov ax,4Cxx / int 21h

function mkdir(files) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bat_rt_'));
    for (const [n, v] of Object.entries(files)) {
        const p = path.join(d, n);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, typeof v === 'string' ? v.replace(/\n/g, '\r\n') : v);
    }
    return d;
}
async function run(files, bat, frames = 120, opts = {}) {
    const m = await Machine.boot({ dir: mkdir(files), bat, ...opts });
    m.runFrames(frames);
    return m;
}
const screen = (m) => m.textVram().join('\n');
const exists = (m, p) => { try { m.M.FS.stat('/run/' + p); return true; } catch (_) { return false; } };
const read = (m, p) => { try { return Buffer.from(m.M.FS.readFile('/run/' + p)).toString('latin1'); } catch (_) { return null; } };
const ls = (m, d = '') => m.M.FS.readdir('/run/' + d).filter((n) => n !== '.' && n !== '..');

(async () => {
    console.log('[1] %VAR% と IF の後ろの任意のコマンド・IF EXIST・errorlevel');
    let m = await run({
        'T.BAT': '@echo off\nset GREET=HELLO\nif "%GREET%"=="HELLO" echo VAR-OK\nif not "%GREET%"=="X" echo NOT-OK\n' +
                 'if exist DATA.TXT echo EXIST-OK\nif not exist NONE.TXT echo NOEXIST-OK\nif exist SUB\\NUL echo DIR-OK\n' +
                 'if exist *.TXT echo WILD-OK\nE3\nif errorlevel 3 echo EL3-OK\nif errorlevel 4 echo EL4-NG\n',
        'DATA.TXT': 'x', 'SUB/IN.TXT': 'y', 'E3.COM': exitCom(3),
    }, 'T.BAT');
    let t = screen(m);
    for (const w of ['VAR-OK', 'NOT-OK', 'EXIST-OK', 'NOEXIST-OK', 'DIR-OK', 'WILD-OK', 'EL3-OK']) chk(t.includes(w), w);
    chk(!t.includes('EL4-NG'), 'errorlevel 4 は偽');

    console.log('[2] CALL は戻る・CALL なしは戻らない・SHIFT・%0');
    m = await run({
        'T.BAT': '@echo off\ncall SUB.BAT A1 B2\necho BACK-FROM-CALL\nCHAIN.BAT Z9\necho NEVER\n',
        'SUB.BAT': '@echo off\necho SUB %1 %2\nshift\necho SHIFTED %1\n',
        'CHAIN.BAT': '@echo off\necho CHAIN %1 %0\n',
    }, 'T.BAT');
    t = screen(m);
    chk(t.includes('SUB A1 B2') && t.includes('SHIFTED B2'), 'CALL の引数と SHIFT');
    chk(t.includes('BACK-FROM-CALL'), 'CALL の後に戻る');
    chk(t.includes('CHAIN Z9 CHAIN'), 'CALL なしの .bat (引数・%0)');
    chk(!t.includes('NEVER'), 'CALL なしの .bat からは戻らない');

    console.log('[3] FOR (ワイルドカード・GOTO で抜ける)・TYPE');
    m = await run({
        'T.BAT': '@echo off\nfor %%f in (*.DAT) do type %%f\nfor %%i in (1 2 3) do if "%%i"=="2" goto OUT\necho NG-FOR\n:OUT\necho FOR-DONE\n',
        'A.DAT': 'AAA-CONTENT\r\n', 'B.DAT': 'BBB-CONTENT\r\n',
    }, 'T.BAT');
    t = screen(m);
    chk(t.includes('AAA-CONTENT') && t.includes('BBB-CONTENT'), 'FOR + TYPE で 2 ファイルとも表示');
    chk(t.includes('FOR-DONE') && !t.includes('NG-FOR'), 'FOR の中の GOTO でループを抜ける');

    console.log('[4] COPY・DEL・REN・MD・RD・XCOPY');
    m = await run({
        'T.BAT': '@echo off\ncopy ONE.TXT COPY1.TXT\ncopy ONE.TXT+TWO.TXT BOTH.TXT\ncopy *.TXT *.BAK\n' +
                 'md NEWDIR\ncopy ONE.TXT NEWDIR\nren COPY1.TXT RENAMED.TXT\ndel TWO.BAK\n' +
                 'md GONE\nrd GONE\nxcopy SRC OUT /s\necho FILEOPS-DONE\n',
        'ONE.TXT': '111', 'TWO.TXT': '222', 'SRC/A.X': 'a', 'SRC/DEEP/B.X': 'b',
    }, 'T.BAT');
    t = screen(m);
    chk(read(m, 'RENAMED.TXT') === '111' && !exists(m, 'COPY1.TXT'), 'COPY → REN');
    chk(read(m, 'BOTH.TXT') === '111222', 'COPY A+B C (連結)');
    chk(exists(m, 'ONE.BAK') && !exists(m, 'TWO.BAK'), 'COPY *.TXT *.BAK → DEL TWO.BAK');
    chk(read(m, 'NEWDIR/ONE.TXT') === '111', 'MD → COPY でディレクトリへ');
    chk(!exists(m, 'GONE'), 'MD → RD');
    chk(read(m, 'OUT/A.X') === 'a' && read(m, 'OUT/DEEP/B.X') === 'b', 'XCOPY /S (下の階層も)');
    chk(t.includes('file(s) copied') && t.includes('FILEOPS-DONE'), 'COPY のメッセージと続行');

    console.log('[5] 見つからないコマンド・COMMAND /C・PAUSE');
    m = await run({
        'T.BAT': '@echo off\nNOSUCHPROG\necho AFTER-BAD\ncommand /c SUB.BAT\necho AFTER-COMMAND\npause\necho AFTER-PAUSE\n',
        'SUB.BAT': '@echo off\necho IN-SUB\n',
    }, 'T.BAT', 120);
    t = screen(m);
    chk(t.includes('Bad command or file name') && t.includes('AFTER-BAD'), '"Bad command or file name" を出して続ける');
    chk(t.includes('IN-SUB') && t.includes('AFTER-COMMAND'), 'COMMAND /C の .bat から戻る');
    chk(t.includes('Press any key') && !t.includes('AFTER-PAUSE'), 'PAUSE でキーを待つ');
    m.M.ccall('np2kai_key_down', null, ['number', 'number'], [m.h, 0x34]); m.runFrames(3);
    m.M.ccall('np2kai_key_up', null, ['number', 'number'], [m.h, 0x34]); m.runFrames(30);
    chk(screen(m).includes('AFTER-PAUSE'), 'キーを押すと続く');

    console.log('[6] サブディレクトリの .bat はそこで始まる・PATH 検索');
    m = await run({
        'GAME/RUN.BAT': '@echo off\nif exist LOCAL.DAT echo IN-GAMEDIR\nset PATH=\\TOOLS\nE7\nif errorlevel 7 echo PATH-OK\n',
        'GAME/LOCAL.DAT': 'z', 'TOOLS/E7.COM': exitCom(7),
    }, 'GAME/RUN.BAT');
    t = screen(m);
    chk(t.includes('IN-GAMEDIR'), '.bat の置き場所がカレント');
    chk(t.includes('PATH-OK'), 'PATH のディレクトリから探す');

    console.log('[7] リダイレクト < > >> NUL とパイプ |');
    // UPPER.COM: 標準入力 (AH=3Fh handle 0) を 1 バイトずつ読み、英小文字を大文字にして標準出力 (AH=40h handle 1) へ
    const UPPER = Buffer.from('b43f31dbb90100ba3401cd2185c0741fa034013c6172093c7a77052c20a23401b440bb0100b90100ba3401cd21ebd1b8004ccd2100', 'hex');
    m = await run({
        'T.BAT': '@echo off\necho HELLO>OUT.TXT\necho MORE >> OUT.TXT\ntype OUT.TXT > COPY.TXT\n' +
                 'UPPER < IN.TXT > UP.TXT\ntype IN.TXT | UPPER > PIPED.TXT\ntype IN.TXT | UPPER | UPPER > PIPE2.TXT\n' +
                 'echo HIDDEN > NUL\npause > nul\necho REDIR-DONE\n',
        'IN.TXT': 'abc xyz\n', 'UPPER.COM': UPPER,
    }, 'T.BAT', 200);
    chk(read(m, 'OUT.TXT') === 'HELLO\r\nMORE \r\n', `echo > と >> (${JSON.stringify(read(m, 'OUT.TXT'))})`);
    chk(read(m, 'COPY.TXT') === read(m, 'OUT.TXT'), 'TYPE の出力を > でファイルへ');
    chk(read(m, 'UP.TXT') === 'ABC XYZ\r\n', `外部プログラムの < と > (${JSON.stringify(read(m, 'UP.TXT'))})`);
    chk(read(m, 'PIPED.TXT') === 'ABC XYZ\r\n', `パイプ (${JSON.stringify(read(m, 'PIPED.TXT'))})`);
    chk(read(m, 'PIPE2.TXT') === 'ABC XYZ\r\n', '3 段のパイプ');
    chk(!ls(m).some((n) => /^QBPIPE/i.test(n)), 'パイプの一時ファイルを消す');
    t = screen(m);
    chk(!t.includes('HIDDEN') && !t.includes('Press any key'), '> NUL は捨てる (PAUSE の案内も)');
    chk(!t.includes('REDIR-DONE'), 'PAUSE > NUL でもキーは待つ');
    m.M.ccall('np2kai_key_down', null, ['number', 'number'], [m.h, 0x34]); m.runFrames(3);
    m.M.ccall('np2kai_key_up', null, ['number', 'number'], [m.h, 0x34]); m.runFrames(30);
    chk(screen(m).includes('REDIR-DONE'), 'キーで続く');

    // 実物: life98 (ライフゲーム) の起動 .bat は LBMP.COM <パターン / RANDOM.COM | LBMP.COM で初期配置を読む。
    // LBMP は標準入力を BMP として読んでみて、違えば AH=42h で先頭へ戻してテキストとして読み直す。
    // 旧方式は < や | をそのまま引数に渡していて「Read Error」だった。書庫が無ければ飛ばす
    const LIFE = path.join(__dirname, '..', 'games', 'mem_test', 'life98.lzh');
    if (fs.existsSync(LIFE)) {
        console.log('[8] life98 (< と | で初期配置を読む)');
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'life98_'));
        require('child_process').spawnSync('lha', ['xw=' + d, LIFE], { stdio: 'ignore' });
        for (const b of ['fpent.bat', 'rnd.bat']) {
            const lm = await Machine.boot({ dir: d, bat: b });
            lm.runFrames(600);
            const row0 = lm.textVram()[0].trim();
            const fb = lm.M.ccall('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number'], [lm.h, lm._wP, lm._hP, lm._bP]);
            const w = lm.M.HEAP32[lm._wP >> 2], h = lm.M.HEAP32[lm._hP >> 2];
            let lit = 0;
            for (let i = 0; i < w * h; i++) if (lm.M.HEAPU16[(fb >> 1) + i]) lit++;
            chk(row0 !== 'Read Error' && lit > 20, `${b}: 初期配置を読んでライフゲームが進む (row0="${row0}"・点灯 ${lit})`);
        }
    }

    console.log(`\nbat_runtime_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
