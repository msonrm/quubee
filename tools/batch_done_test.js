#!/usr/bin/env node
// 起動 .bat の「完走」検出 (np2kai_dos_batch_done) の回帰。
//
// シェル (tools/dos_loader/shell.asm) は文列を消化し終えても AH=4Ch を出さず .idle で
// sti+hlt し続ける (常駐音源ドライバの ISR を生かすため)。したがって np2kai_dos_get_exit は
// 永遠に立たず、UI がこれだけを見ていると「running」のまま固まる (Suika3 のデモが exit 0 で
// 正常終了しても running のままだった)。ホスト側の文インタプリタだけが「列が尽きた」瞬間を
// 知っているので、それを np2kai_dos_batch_done() で公開している。本テストはその契約を守る:
//
//   1) stage 直後は 0 (まだ 1 つも実行していない)
//   2) 子 COM (mov ax,4c00h; int 21h) が終了し、シェルが次コマンドを問い合わせて列が尽きたら 1
//   3) get_exit は最後まで立たない (シェルはアイドルし続ける = 常駐 TSR を殺さない)
//   4) 次の stage (= 新セッション) で 0 に戻る
//
// 使い方: node tools/batch_done_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// 最小 COM: mov ax,4c00h / int 21h (即 exit 0)
const EXIT_COM = Uint8Array.from([0xB8, 0x00, 0x4C, 0xCD, 0x21]);

let fails = 0;
const ok = (cond, what, got) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${got !== undefined ? ` (got ${got})` : ''}`);
    if (!cond) fails++;
};

(async () => {
    const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const h = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/T.COM', EXIT_COM);

    const runFrame  = M.cwrap('np2kai_run_frame', null, ['number']);
    const batchDone = M.cwrap('np2kai_dos_batch_done', 'number', []);
    const getExitFn = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const exitPtr   = M._malloc(4);
    const getExit   = () => !!getExitFn(exitPtr);

    // ---- stage: 1 cmd 文だけの文列 ("C\t名前\t引数" の行列) ----
    const stage = () => {
        const prog = Buffer.from('C\tT.COM\t\n', 'latin1');
        const p = M._malloc(prog.length); M.HEAPU8.set(prog, p);
        const r = M.ccall('np2kai_dos_stage_batch', 'number',
            ['number', 'number', 'string'], [p, prog.length, 'batch_done_test']);
        M._free(p);
        return r;
    };

    ok(stage() === 0, 'stage_batch が成功する');
    ok(batchDone() === 0, 'stage 直後は batch_done=0', batchDone());

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [h, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [h]);

    let doneAt = -1, exitSeen = false;
    for (let f = 0; f < 900; f++) {
        runFrame(h);
        if (doneAt < 0 && batchDone()) doneAt = f;
        if (getExit()) exitSeen = true;
    }

    ok(doneAt >= 0, '子 COM の終了後に batch_done=1 が立つ', doneAt >= 0 ? `frame ${doneAt}` : 'never');
    ok(!exitSeen, 'get_exit は立たない (シェルは .idle で常駐 TSR を生かす)');

    // ---- 新しい stage = 新セッション → 旗はクリアされる ----
    ok(stage() === 0, '2 回目の stage_batch が成功する');
    ok(batchDone() === 0, '再 stage で batch_done=0 に戻る', batchDone());

    console.log(fails === 0
        ? '\nPASS — batch_done は「列が尽きた瞬間」だけ立ち、get_exit とは独立で、stage 毎にクリアされる'
        : `\nFAIL — ${fails} 件`);
    process.exit(fails === 0 ? 0 : 1);
})();
