#!/usr/bin/env node
// mouse33_test.js — INT 33h マウスドライバ HLE (native/dos_mouse33.c) の回帰テスト。
//
// tools/mousetest/MOUSETEST.COM (実ドライバ測定に使ったのと同じ測定プログラム) を
// HLE に対して流し、実測済みの正典と全項目突合する:
//   MS 仕様 = 実物 MS Mouse Driver 7.06 の実測値 (2026-07-03)
//   NEC 仕様 = HImouse v0.2 -n の実測値 (座標中央のみ 319/199→320/200 の実装差を採用)
// 範囲設定ペアの判別 (pair A/B/C) も含めて 4 構成を検証する。
//
// 使い方: node tools/mouse33_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const MTEST = path.join(__dirname, 'mousetest', 'MOUSETEST.COM');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

const SENT_OFF = 0x130;    // COM 内 offset: 完走センチネル (dumpbuf-1)。mousetest.lst で確認
const DUMP_OFF = 0x131;    // dumpbuf 先頭
const N_DUMPS = 13;

// 期待値表: [AX, BX, CX, DX] × 13 ダンプ。null = 検査しない。
const E = 0x5A5A;          // センチネル echo
function expectMS(pairClamp) {
    return [
        [0xFFFF, 0x0002, E, E],                 // [0] reset
        [0x0003, 0x0000, 0x0140, 0x00C8],       // [1] fn3 no-button (AX 温存が MS の分水嶺)
        [0x0003, 0x0001, 0x0140, 0x00C8],       // [2] fn3 left-held
        [0x0003, 0x0002, 0x0140, 0x00C8],       // [3] fn3 right-held
        [0x000A, E, 0x0000, 0x027F],            // [4] fn0A echo (テキストカーソル定義)
        [0x000B, E, 0x0000, 0x0000],            // [5] fn0B モーションカウンタ (未移動=0)
        [0x0007, E, 0x0000, 0x027F],            // [6] fn07 X 範囲設定 (戻りなし)
        [0x0008, E, 0x0000, 0x018F],            // [7] fn08 Y 範囲設定 (戻りなし)
        [0x00FF, 0x000F, E, E],                 // [8] fnFF no-op (7.06 実測)
        [0x0003, 0x0000, 0x027F, 0x018F],       // [9] fn3 大移動後 (640×400 クランプ)
        [0x0010, E, 0x0000, 0x027F],            // [10] fn10 echo (更新領域は無視)
        [0x0011, E, 0x0000, 0x018F],            // [11] fn11 echo (no-op)
        pairClamp ? [0x0003, 0x0001, 0x0100, 0x0080]    // [12] pair=C: fn7/8 が範囲設定
                  : [0x0003, 0x0001, 0x027F, 0x018F],   // [12] pair=A/B: 効かない
    ];
}
function expectNEC(pairClamp) {
    return [
        [0xFFFF, E, E, E],                      // [0] reset (BX 不変が NEC)
        [0x0000, 0x0000, 0x0140, 0x00C8],       // [1] fn3 no-button (AX クロバー)
        [0xFFFF, 0x0000, 0x0140, 0x00C8],       // [2] fn3 left-held (AX=左)
        [0x0000, 0xFFFF, 0x0140, 0x00C8],       // [3] fn3 right-held (BX=右)
        [0x000A, E, 0x0000, 0x027F],            // [4] fn0A no-op echo (HImouse 実測)
        [0x000B, E, 0x0000, 0x0000],            // [5] fn0B モーションカウンタ (HImouse 実測)
        [0x0000, 0x0001, 0x0140, 0x00C8],       // [6] fn07 = 右 press 情報 (回数 1)
        [0x0000, 0x0001, 0x0140, 0x00C8],       // [7] fn08 = 右 release 情報 (回数 1)
        [0x00FF, 0x000F, E, E],                 // [8] fnFF no-op
        [0x0000, 0x0000, 0x027F, 0x018F],       // [9] fn3 大移動後
        [0x0010, E, 0x0000, 0x027F],            // [10] fn10 X 範囲設定 (戻りなし)
        [0x0011, E, 0x0000, 0x018F],            // [11] fn11 Y 範囲設定 (戻りなし)
        pairClamp ? [0xFFFF, 0x0000, 0x0100, 0x0080]    // [12] pair=B: fn10/11 が範囲設定
                  : [0xFFFF, 0x0000, 0x027F, 0x018F],   // [12] pair=A/C: 効かない
    ];
}

const CASES = [
    { name: 'MS  persona / pair C (fn07/08=範囲設定)', mode: 1, pair: 'C', expect: expectMS(true) },
    { name: 'MS  persona / pair B (fn10/11 は無効)',   mode: 1, pair: 'B', expect: expectMS(false) },
    { name: 'NEC persona / pair B (fn10/11=範囲設定)', mode: 2, pair: 'B', expect: expectNEC(true) },
    { name: 'NEC persona / pair A (fn0A/0B は無効)',   mode: 2, pair: 'A', expect: expectNEC(false) },
];

async function runCase(c) {
    const logs = [];
    const M = await NP2KaiModule({ noInitialRun: true,
        print: (s) => logs.push(s), printErr: (s) => logs.push(s) });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) return { fail: 'create 失敗' };
    M.ccall('np2kai_mouse33_ctl', null, ['number', 'number'], [handle, c.mode]);

    const img = new Uint8Array(fs.readFileSync(MTEST));
    const ptr = M._malloc(img.length); M.HEAPU8.set(img, ptr);
    const sr = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, img.length, c.pair, 'MTEST.COM']);
    M._free(ptr);
    if (sr !== 0) return { fail: 'stage エラー ' + sr };

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const pk = M.cwrap('np2kai_debug_peek8', 'number', ['number','number']);
    const btn = M.cwrap('np2kai_mouse_button', null, ['number','number','number']);
    const mov = M.cwrap('np2kai_mouse_move', null, ['number','number','number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);

    // 注入タイムライン (measure_real.js と同一): MOUSETEST の wait ループに合わせる
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
        if (f > 2400 && getExit(handle)) break;
    }

    const base = 0x0100 * 16 + 0x100;   // 直接 stage した COM の PSP=0x0100 固定
    const rd16 = (off) => pk(handle, base + off) | (pk(handle, base + off + 1) << 8);
    if (pk(handle, base + SENT_OFF) !== 0x55) return { fail: '完走センチネル無し (wait ループ滞留?)' };

    const diffs = [];
    for (let i = 0; i < N_DUMPS; i++) {
        const got = [0, 2, 4, 6].map((o) => rd16(DUMP_OFF + i * 8 + o));
        const exp = c.expect[i];
        for (let r = 0; r < 4; r++) {
            if (exp[r] !== null && got[r] !== exp[r]) {
                diffs.push(`[${i}] ${'AX BX CX DX'.split(' ')[r]}: got=${got[r].toString(16).toUpperCase().padStart(4, '0')} ` +
                           `want=${exp[r].toString(16).toUpperCase().padStart(4, '0')}`);
            }
        }
    }
    return { diffs };
}

(async () => {
    let pass = 0, fail = 0;
    for (const c of CASES) {
        const r = await runCase(c);
        if (r.fail) { console.log('FAIL ' + c.name + ' — ' + r.fail); fail++; continue; }
        if (r.diffs.length) {
            console.log('FAIL ' + c.name);
            for (const d of r.diffs) console.log('       ' + d);
            fail++;
        } else {
            console.log('PASS ' + c.name);
            pass++;
        }
    }
    console.log(fail === 0
        ? `PASS — ${pass}/${CASES.length} 構成が実測正典 (MS 7.06 / HImouse-NEC) と一致`
        : `FAIL — ${fail}/${CASES.length} 構成に差分`);
    process.exit(fail === 0 ? 0 : 1);
})();
