#!/usr/bin/env node
// call_bat_test.js — 起動 .bat の `CALL X.BAT` インライン展開の end-to-end 回帰 (2026-07-12)。
//
// 背景: NP21/W 開発者報告「NPCNGCLK が動かなくなった。エラーコードで BAT が止まる?」の真因は、
// bat 末尾の `CALL END` が ②→③ 統合 (2026-07-11 a87038e) で buildStatements=null → ① 単一起動
// 退避となり、先頭の NPCNGCLK だけが実行されてゲーム (KANI) が起動しなくなったこと。
// 旧 ② は CALL 行を黙殺して残りを線形実行していた (= 以前は動いていた)。
//
// 本テストは報告 bat と同型の合成 fixture (実物は再配布不可・games/ 非コミット方針) で、
//   TEST.BAT: FAKECLK 8 (exit code 8 = NPCNGCLK の「倍率を終了コードに返す」仕様) → KANI 相当
//             → PWOFF 相当 → CALL END
//   END.BAT : ECHO OFF / CLS / ECHO PROGRAM OWATTA
// を 1 DOS セッションで完走させ、以下を守る:
//   (1) 非ゼロ errorlevel (8) で後続が止まらない (EXEC 3 本すべて実行)
//   (2) CALL 先の CLS が画面をクリアする (op 'L'、C 側 QB_BATCH_CLS)
//   (3) CALL 先の ECHO が表示され、bat が完走する (batchDone)
//
// 使い方: node tools/call_bat_test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine } = require('./lib/machine.js');

// ---- 合成 fixture ----
// FAKECLK.COM: '8' を表示して exit code 8 (mov dl,'8'; mov ah,2; int21; mov ax,4C08; int21)
const FAKECLK = Buffer.from([0xB2, 0x38, 0xB4, 0x02, 0xCD, 0x21, 0xB8, 0x08, 0x4C, 0xCD, 0x21]);
// KANI.COM: "KANI-RUN" を表示して exit 0 (mov dx,010C; mov ah,9; int21; mov ax,4C00; int21; db "KANI-RUN$")
const KANI = Buffer.concat([
    Buffer.from([0xBA, 0x0C, 0x01, 0xB4, 0x09, 0xCD, 0x21, 0xB8, 0x00, 0x4C, 0xCD, 0x21]),
    Buffer.from('KANI-RUN$', 'latin1'),
]);
// PWOFF.COM: 何もせず exit 0
const PWOFF = Buffer.from([0xB8, 0x00, 0x4C, 0xCD, 0x21]);

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call_bat_'));
    fs.writeFileSync(path.join(dir, 'FAKECLK.COM'), FAKECLK);
    fs.writeFileSync(path.join(dir, 'KANI.COM'), KANI);
    fs.writeFileSync(path.join(dir, 'PWOFF.COM'), PWOFF);
    fs.writeFileSync(path.join(dir, 'TEST.BAT'), 'FAKECLK 8\r\nKANI\r\nPWOFF\r\nCALL END\r\n');
    fs.writeFileSync(path.join(dir, 'END.BAT'), 'ECHO OFF\r\nCLS\r\nECHO PROGRAM OWATTA\r\n');

    const m = await Machine.boot({ dir, bat: 'TEST.BAT' });
    const done = m.runUntil((mm) => mm.batchDone(), 2000);
    const screen = m.textVram().join('\n');
    const st = m.int21Stats();

    let pass = 0, fail = 0;
    const check = (name, cond, extra) => {
        if (cond) { pass++; console.log(`  ok   ${name}`); }
        else      { fail++; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); }
    };

    check('bat が完走した (batchDone)', done, `frame=${m.frame}`);
    check('EXEC 3 本すべて実行 (AH=4Bh)', st.calls['4B'] === 3, `4B=${st.calls['4B']}`);
    check('非ゼロ errorlevel (8) で後続が止まらない (KANI が走った)',
          st.calls['4B'] === 3 && st.calls['09'] >= 1, `09=${st.calls['09']}`);
    check('CALL 先の CLS が画面をクリア ("8"/"KANI-RUN" が残らない)',
          !screen.includes('KANI-RUN') && !/(^|\n)8/.test(screen), JSON.stringify(screen.trim().slice(0, 60)));
    check('CALL 先の ECHO が表示される', screen.includes('PROGRAM OWATTA'),
          JSON.stringify(screen.trim().slice(0, 60)));

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\ncall_bat_test: ${pass} passed, ${fail} failed  (wasm ${m.prov.sha256})`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
