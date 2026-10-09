#!/usr/bin/env node
// ファンクションキー行 (画面最下行) の headless 回帰 (2026-10-10 新設)。
//
// 実機の MS-DOS は既定で最下行にファンクションキーのガイドを出す (NEC MS-DOS 3.1 ユーザーズマニュアル)。
// VZ Editor は表示を要求せず、最下行を空けてキー定義表 (INT DCh CL=0Dh) にラベルだけを入れる =
// DOS が描く前提 (計測 = tools/vz_fkey_probe.js)。QuuBee の HLE-DOS が描く (native/dos_int21.c sysline_*)。
// 配置は VZ Editor のリポジトリ (vcraftjp/VZEditor) の PC-98 の画面写真から: 幅 6 桁の反転表示の枠 10 個、
// 開始桁 4,11,18,25,32 / 42,49,56,63,70。
//
//   A. 既定 = 表示・24 行 (0711h=1 / 0712h=23)、キー定義表が未設定なら既定のラベル (C1 CU … ^Z)。
//      30 行ぶん改行してスクロールさせても最下行は無傷で、本文は 23 行目まで
//   B. ESC[>1h で消える (0711h=0 / 0712h=24)。非表示のまま ESC[>1h を送り直しても、プログラムが最下行に
//      描いたものを消さない (状態が変わったときだけ描く・消す)
//   C. ESC[>1h → ESC[>1l で既定のラベルが戻る
//   D. VZ Editor: 最下行に VZ のラベル (ﾌｧｲﾙ 窓換 …) が枠どおりに出る
//
// VZ.COM / *.DEF / README.DOC は BSD-3 (tools/testdata/VZ.LICENSE.txt、原作 中村満 c.mos)。
// 使い方: node tools/sysline_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const VZCOM  = path.join(__dirname, 'testdata', 'VZ.COM');
const VZDATA = path.join(__dirname, 'testdata', 'vz');

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const ESC = '\x1b';
const BOX_COLS = [4, 11, 18, 25, 32, 42, 49, 56, 63, 70];
const DEFAULT_LABELS = [' C1  ', ' CU  ', ' CA  ', ' S1  ', ' SU  ', 'VOID ', 'NWL  ', 'INS  ', 'REP  ', ' ^Z  '];
const REV = 0xE5, NORMAL = 0xE1, ROW = 24;

let fails = 0;
function ok(cond, name, detail) {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond || detail === undefined ? '' : '  ' + detail}`);
    if (!cond) fails++;
}

// AH=09h で msg ($ 終端) を出して終わる COM
function comPrint(msg) {
    const code = [0xB4, 0x09, 0xBA, 0x0C, 0x01, 0xCD, 0x21, 0xB8, 0x00, 0x4C, 0xCD, 0x21];
    return Uint8Array.from([...code, ...Array.from(msg + '$', (c) => c.charCodeAt(0) & 0xff)]);
}

async function boot(com, name, cmdline, files) {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    try { M.FS.mkdir('/run'); } catch (_) {}
    for (const [n, bytes] of files || []) M.FS.writeFile('/run/' + n, bytes);
    const h = M.ccall('np2kai_create', 'number', [], []);
    const ptr = M._malloc(com.length); M.HEAPU8.set(com, ptr);
    const r = M.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'], [ptr, com.length, cmdline, name]);
    M._free(ptr);
    if (r !== 0) throw new Error('stage_com r=' + r);
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [h]);
    const pk = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    return {
        run(frames, untilExit) {
            for (let f = 0; f < frames; f++) { runFrame(h); if (untilExit && getExit(0)) return true; }
            return false;
        },
        code: (r, c) => pk(h, 0xA0000 + (r * 80 + c) * 2) & 0xff,
        hi:   (r, c) => pk(h, 0xA0001 + (r * 80 + c) * 2) & 0xff,
        attr: (r, c) => pk(h, 0xA2000 + (r * 80 + c) * 2) & 0xff,
        peek: (a) => pk(h, a) & 0xff,
    };
}

// 最下行の枠 (反転属性のセル) が写真どおりの 10 個か
function boxesOk(m, row = ROW) {
    for (let c = 0; c < 80; c++) {
        const inBox = BOX_COLS.some((b) => c >= b && c < b + 6);
        if ((m.attr(row, c) === REV) !== inBox) return `col ${c} attr=0x${m.attr(row, c).toString(16)}`;
    }
    return '';
}
const ankAt = (m, row, col, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(m.code(row, col + i)); return s; };

(async () => {
    // ---- A. 既定 = 表示・既定のラベル・スクロールしても無傷 ----
    console.log('A. 既定 (キー定義表なし) + 30 行の改行');
    {
        let msg = `${ESC}[2J`;
        for (let i = 0; i < 30; i++) msg += `line${i}\r\n`;
        msg += 'END';
        const m = await boot(comPrint(msg), 'SYSA', '');
        ok(m.run(1500, true), 'プログラムが終わる');
        ok(m.peek(0x711) === 1 && m.peek(0x712) === 23, '0711h=1・0712h=23 (表示・24 行)', `0711=${m.peek(0x711)} 0712=${m.peek(0x712)}`);
        const bad = boxesOk(m);
        ok(!bad, '最下行に反転の枠が 10 個 (幅 6・写真の桁)', bad);
        const labels = BOX_COLS.map((b) => ankAt(m, ROW, b + 1, 5));
        ok(JSON.stringify(labels) === JSON.stringify(DEFAULT_LABELS), '既定のラベル C1 CU CA S1 SU VOID NWL INS REP ^Z', JSON.stringify(labels));
        ok(ankAt(m, 23, 0, 3) === 'END', 'スクロール後の最終行は 23 行目 (最下行に食い込まない)', JSON.stringify(ankAt(m, 23, 0, 6)));
    }

    // ---- B. ESC[>1h で消える・非表示のまま送り直しても最下行を消さない ----
    console.log('B. ESC[>1h で非表示 → 最下行に描く → ESC[>1h を送り直す');
    {
        const m = await boot(comPrint(`${ESC}[>1h${ESC}[25;1HZZZ${ESC}[>1h`), 'SYSB', '');
        ok(m.run(1500, true), 'プログラムが終わる');
        ok(m.peek(0x711) === 0 && m.peek(0x712) === 24, '0711h=0・0712h=24 (非表示・25 行)', `0711=${m.peek(0x711)} 0712=${m.peek(0x712)}`);
        ok(ankAt(m, ROW, 0, 3) === 'ZZZ', '非表示中は 25 行目に書ける・>1h の送り直しで消えない', JSON.stringify(ankAt(m, ROW, 0, 3)));
        let rev = 0;
        for (let c = 0; c < 80; c++) if (m.attr(ROW, c) === REV) rev++;
        ok(rev === 0, '枠が消えている', `反転セル ${rev}`);
    }

    // ---- C. 非表示 → 表示で戻る ----
    console.log('C. ESC[>1h → ESC[>1l');
    {
        const m = await boot(comPrint(`${ESC}[>1h${ESC}[>1l`), 'SYSC', '');
        ok(m.run(1500, true), 'プログラムが終わる');
        ok(m.peek(0x711) === 1 && m.peek(0x712) === 23, '0711h=1・0712h=23', `0711=${m.peek(0x711)} 0712=${m.peek(0x712)}`);
        const bad = boxesOk(m);
        ok(!bad && ankAt(m, ROW, 5, 5) === ' C1  ', '既定のラベルが戻る', bad || JSON.stringify(ankAt(m, ROW, 5, 5)));
    }

    // ---- D. VZ Editor のラベル ----
    console.log('D. VZ Editor (README.DOC)');
    if (!fs.existsSync(VZCOM) || !fs.existsSync(VZDATA)) {
        console.log('  skip (tools/testdata/VZ.COM / vz/ 不在)');
    } else {
        const files = fs.readdirSync(VZDATA).map((n) => [n, new Uint8Array(fs.readFileSync(path.join(VZDATA, n)))]);
        const m = await boot(new Uint8Array(fs.readFileSync(VZCOM)), 'VZ.COM', 'README.DOC', files);
        m.run(400, false);
        const bad = boxesOk(m);
        ok(!bad, '枠が写真どおり', bad);
        // f·1 = 半角カナ "ﾌｧｲﾙ" (CC A7 B2 D9) / f·2 = 漢字 "窓換" (全角 2 文字 = 4 セル、漢字ビット付き)
        const f1 = [0, 1, 2, 3].map((i) => m.code(ROW, 5 + i));
        ok(JSON.stringify(f1) === JSON.stringify([0xCC, 0xA7, 0xB2, 0xD9]), 'f·1 = ﾌｧｲﾙ', JSON.stringify(f1.map((x) => x.toString(16))));
        ok((m.hi(ROW, 12) & 0x80) && (m.hi(ROW, 14) & 0x80), 'f·2 = 漢字 (窓換)', `hi=${m.hi(ROW, 12).toString(16)},${m.hi(ROW, 14).toString(16)}`);
        ok(ankAt(m, 23, 56, 13) === 'ESC-Q to Exit', 'VZ の本文は 23 行目まで', JSON.stringify(ankAt(m, 23, 56, 13)));
    }

    if (fails) { console.log(`FAIL — ${fails} 件`); process.exit(1); }
    console.log('PASS — ファンクションキー行: 既定で表示・既定のラベル・スクロール無傷・>1h/>1l・VZ のラベル');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
