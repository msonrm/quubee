#!/usr/bin/env node
// mousetest_run.js — 実マウスドライバを常駐させ、MOUSETEST.COM で INT 33h の実挙動
// (各 fn の戻りレジスタ + どのペアが範囲設定として効くか) を測定する。
// 使い方: node mousetest_run.js <driver.com> [driverArgs] [modeChar A|B|C]
//   A = fn0A/0B を範囲設定として試す / B = fn10/11 / C = fn07/08
const path = require('path');
const fs = require('fs');
const ROOT = '/home/msonrm/development/qb';
const WEB = path.join(ROOT, 'web');
const SCRATCH = __dirname;
const MOUSE = process.argv[2] || path.join(ROOT, 'games/fixture/mouse.com');
const DRVARGS = process.argv[3] || '';
const MODE = (process.argv[4] || 'A').toUpperCase();
if (!fs.existsSync(MOUSE)) { console.log('SKIP — ドライバ不在: ' + MOUSE); process.exit(0); }
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const logs = [];
    const M = await NP2KaiModule({ print: (s) => logs.push(s), printErr: (s) => logs.push(s),
        locateFile: (p) => path.join(WEB, p) });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);

    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/MOUSE.COM', new Uint8Array(fs.readFileSync(MOUSE)));
    M.FS.writeFile('/run/MTEST.COM', new Uint8Array(fs.readFileSync(path.join(SCRATCH, 'MOUSETEST.COM'))));

    const script = 'MOUSE.COM\t' + DRVARGS + '\r\nMTEST.COM\t' + MODE + '\r\n';
    const r = M.ccall('np2kai_dos_stage_script', 'number',
        ['string', 'number', 'string'], [script, script.length, 'mousetest']);
    if (r !== 0) { console.log('FAIL stage_script r=' + r); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const pk = M.cwrap('np2kai_debug_peek8', 'number', ['number','number']);
    const btn = M.cwrap('np2kai_mouse_button', null, ['number','number','number']);
    const mov = M.cwrap('np2kai_mouse_move', null, ['number','number','number']);

    // 注入タイムライン: MOUSETEST の wait ループに合わせる
    //  800 左 down / 1000 左 up → [2]
    //  1200 右 down / 1400 右 up → [3]
    //  1500-1600 大移動 / 1700 左 down / 1900 左 up → [9]〜[11] + ペア範囲設定
    //  2000-2100 大移動 / 2200 左 down / 2400 左 up → [12]
    for (let f = 0; f < 2700; f++) {
        if (f === 800)  btn(handle, 0, 1);
        if (f === 1000) btn(handle, 0, 0);
        if (f === 1200) btn(handle, 1, 1);
        if (f === 1400) btn(handle, 1, 0);
        if (f >= 1500 && f < 1600) mov(handle, 40, 40);
        if (f === 1700) btn(handle, 0, 1);
        if (f === 1900) btn(handle, 0, 0);
        if (f >= 2000 && f < 2100) mov(handle, 40, 40);
        if (f === 2200) btn(handle, 0, 1);
        if (f === 2400) btn(handle, 0, 0);
        runFrame(handle);
    }

    const mline = logs.find(l => /EXEC child=MTEST\.COM/.test(l));
    const pline = mline ? logs.slice(logs.indexOf(mline)).find(l => /child @ PSP=/.test(l)) || '' : '';
    const psp = parseInt((pline.match(/PSP=([0-9A-Fa-f]{4})/) || [0, '0100'])[1], 16);
    const base = psp * 16 + 0x100;
    const rd16 = (off) => pk(handle, base + off) | (pk(handle, base + off + 1) << 8);

    const PAIR = { A: 'fn0A/0B', B: 'fn10/11', C: 'fn07/08' }[MODE];
    const sentinel = pk(handle, base + 0x130);
    console.log('driver=' + path.basename(MOUSE) + (DRVARGS ? ' ' + DRVARGS : '') +
                '  pair=' + MODE + '(' + PAIR + ')  PSP=' + psp.toString(16) +
                '  完走 sentinel=' + (sentinel === 0x55 ? 'OK' : 'NG(0x' + sentinel.toString(16) + ')'));
    const LABELS = [
        '[0]  fn00 reset          ',
        '[1]  fn03 no-button      ',
        '[2]  fn03 left-held      ',
        '[3]  fn03 right-held     ',
        '[4]  fn0A CX=0 DX=27F    ',
        '[5]  fn0B CX=0 DX=18F    ',
        '[6]  fn07 CX=0 DX=27F    ',
        '[7]  fn08 CX=0 DX=18F    ',
        '[8]  fnFF BX=0F          ',
        '[9]  fn03 after big-move ',
        '[10] fn10 CX=0 DX=27F    ',
        '[11] fn11 CX=0 DX=18F    ',
        '[12] fn03 pair-range test',
    ];
    for (let i = 0; i < LABELS.length; i++) {
        const o = 0x131 + i * 8;
        const v = [rd16(o), rd16(o + 2), rd16(o + 4), rd16(o + 6)]
            .map((x) => x.toString(16).toUpperCase().padStart(4, '0'));
        console.log(LABELS[i] + ' AX=' + v[0] + ' BX=' + v[1] + ' CX=' + v[2] + ' DX=' + v[3]);
    }
    const c12 = rd16(0x131 + 12 * 8 + 4), d12 = rd16(0x131 + 12 * 8 + 6);
    console.log('→ ' + PAIR + ' が範囲設定として効いた? ' +
        (c12 === 0x100 && d12 === 0x80 ? 'YES (100/80 にクランプ)' :
         'NO (クランプ先 ' + c12.toString(16) + '/' + d12.toString(16) + ')'));
    process.exit(0);
})();
