#!/usr/bin/env node
// mouse_chain_probe.js — mouse.com を常駐させた後、後続プログラムが INT 33h を呼んで
// 暴走しない (= TSR で常駐したドライバの INT 33h ハンドラに届く) ことの end-to-end 確認。
// シェル列 "MOUSE.COM" → "MTEST.COM" を 1 セッションで EXEC。MTEST は INT 33h AX=0 (reset)
// を呼び、戻ってきたら sentinel を書いて終了する。旧 (INT 27h 未実装) では mouse.com が
// 自身を解放 → INT 33h ダングリングで MTEST の int 0x33 がゴミへ飛び暴走 (sentinel 無し)。
// 使い方: node tools/mouse_chain_probe.js [path-to-mouse.com]
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const MOUSE = process.argv[2] || path.join(ROOT, 'games/fixture/mouse.com');
if (!fs.existsSync(MOUSE)) {   // MS Mouse は再配布不可 → 不在なら SKIP (jed_cursor_test と同方針)
    console.log('SKIP — mouse.com 不在 (' + MOUSE + ')。Microsoft Mouse は再配布不可のため未コミット。');
    process.exit(0);
}
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// MTEST.COM (org 0x100): INT 33h AX=0 → AL/AH を保存 → 完走 sentinel → 終了
const MTEST = Uint8Array.from([
    0xb8, 0x00, 0x00,         // mov ax, 0x0000      ; INT 33h reset/installed check
    0xcd, 0x33,               // int 0x33
    0xa2, 0x80, 0x00,         // mov [0x0080], al    ; AX low (FFFF=installed)
    0x88, 0x26, 0x81, 0x00,   // mov [0x0081], ah    ; AX high
    0xc6, 0x06, 0x82, 0x00, 0x55, // mov byte [0x0082], 0x55  ; MTEST 完走 sentinel
    0xb8, 0x00, 0x4c,         // mov ax, 0x4C00
    0xcd, 0x21,               // int 0x21
]);

(async () => {
    const logs = [];
    const M = await NP2KaiModule({ print: (s)=>logs.push(s), printErr: (s)=>logs.push(s),
        locateFile: (p) => path.join(WEB, p) });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);

    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/MOUSE.COM', new Uint8Array(fs.readFileSync(MOUSE)));
    M.FS.writeFile('/run/MTEST.COM', MTEST);

    const script = 'C\tMOUSE.COM\r\nC\tMTEST.COM\r\n';
    const r = M.ccall('np2kai_dos_stage_batch', 'number',
        ['string', 'number', 'string'], [script, script.length, 'mousechain']);
    if (r !== 0) { console.log('FAIL stage_batch r=' + r); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const pk = M.cwrap('np2kai_debug_peek8', 'number', ['number','number']);
    for (let i = 0; i < 2000; i++) runFrame(handle);

    // MTEST は mouse の上に EXEC されるので PSP は 0x0100 ではない。ログから実 PSP を拾い、
    // PSP*16 + 0x80/0x81/0x82 を読む (sentinel/INT33h 戻り値は MTEST のセグメント相対)。
    const mline = logs.find(l => /EXEC child=MTEST\.COM/.test(l));
    const pline = logs.slice(logs.indexOf(mline)).find(l => /child @ PSP=/.test(l)) || '';
    const psp = parseInt((pline.match(/PSP=([0-9A-Fa-f]{4})/) || [0,'0100'])[1], 16);
    const base = psp * 16;
    const done = pk(handle, base + 0x82);
    const axlo = pk(handle, base + 0x80), axhi = pk(handle, base + 0x81);
    console.log(`MTEST PSP=0x${psp.toString(16)}`);
    console.log(`MTEST done sentinel=0x${done.toString(16)}  INT33h reset AX=0x${axhi.toString(16).padStart(2,'0')}${axlo.toString(16).padStart(2,'0')}`);
    const tsr = logs.filter(l => /TSR|halt|exited|exec/i.test(l));
    console.log('--- TSR/EXEC ログ ---'); console.log(tsr.slice(-12).join('\n'));
    if (done === 0x55) console.log('\nOK — 後続 MTEST が INT 33h を呼んでも暴走せず完走 (常駐ドライバに到達・ダングリング解消)');
    else console.log('\nNG — MTEST 未完走 (INT 33h 呼び出しで暴走/ハングの可能性)');
})().catch(e => { console.error(e); process.exit(1); });
