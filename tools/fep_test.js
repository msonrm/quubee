#!/usr/bin/env node
// HLE FEP (dos_fep.c) の headless 回帰 (2026-07-07 新設)。
//
// M1 ゴール「VZ Editor で不具合が生じない」を実物 (VZ 1.60 編集画面) の上で検証する:
//   ① 未確定文字列がカーソル位置に正しいセル符号化 + 指定属性で描かれる
//   ② 表示更新 (restore-all → redraw) で古い表示が残らない
//   ③ hide で退避セルが完全復元される (表示前と 1 バイトも違わない)
//   ④ アプリが overlay を上書きしたセルは復元しない (所有権検証)
//   ⑤ 確定注入が VZ にエコーされる (VZ 直書き形式: 左=ku/右=ku|0x80、高位=生JIS2)
//   ⑥ 確定直後に次の composition を重ねても VZ のエコーを壊さない (高速タイプの取り合い)
//
// VZ.COM は BSD-3 の tools/testdata/VZ.COM。設定 (VZ.DEF 等) は games/mem_test/VZ_98.XDF
// から抽出して /run に置く (XDF はローカル素材・非コミット)。XDF が無い環境では
// VZ が DEF 探しプロンプトで止まった画面の上で ①〜④ だけ検証する (SKIP ではなく縮退)。
//
// 使い方: node tools/fep_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const VZCOM  = path.join(__dirname, 'testdata', 'VZ.COM');
const VZXDF  = path.join(__dirname, '..', 'games', 'mem_test', 'VZ_98.XDF');

function skip(m) { console.log('SKIP — ' + m); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');
if (!fs.existsSync(VZCOM))  skip('tools/testdata/VZ.COM 不在');
const hasXdf = fs.existsSync(VZXDF);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const di = hasXdf ? require(path.join(WEB, 'player', 'diskimage.js')) : null;

// SJIS 全角 1 文字 → [ku, jis2] (dos_int21.c sjis_to_jis と同式)。
// FEP overlay のセル = (ku, jis2|0x80) ×2 / VZ 直書きのセル = (ku, jis2) + (ku|0x80, jis2)。
function sjisKu(sh, sl) {
    let c1 = sh, c2 = sl;
    if (c1 >= 0xE0) c1 -= 0x40;
    c1 -= 0x81;
    if (c2 >= 0x80) c2 -= 1;
    c2 -= 0x40;
    return [c1 * 2 + Math.floor(c2 / 94) + 1, ((c2 % 94) + 1) + 0x20];
}

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}

    if (hasXdf) {   // VZ の設定一式を A: (/run) へ — 編集画面まで到達させる
        const xdf = di.extractDiskImage(new Uint8Array(fs.readFileSync(VZXDF)), 'VZ_98.XDF');
        for (const f of xdf.files) {
            if (/^[A-Z0-9_]+\.DEF$/.test(f.name)) M.FS.writeFile('/run/' + f.name, f.data);
        }
    }

    const com = new Uint8Array(fs.readFileSync(VZCOM));
    const ptr = M._malloc(com.length);
    M.HEAPU8.set(com, ptr);
    const r = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'],
        [ptr, com.length, hasXdf ? 'TEST.TXT' : '', 'VZ.COM']);
    M._free(ptr);
    if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const pk       = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const poke     = M.cwrap('np2kai_debug_poke8', null, ['number', 'number', 'number']);

    const VRAM_CODE = 0xA0000, VRAM_ATTR = 0xA2000, COLS = 80, ROWS = 25;

    function snapshot() {
        const code = new Uint8Array(COLS * ROWS * 2), attr = new Uint8Array(COLS * ROWS * 2);
        for (let i = 0; i < COLS * ROWS * 2; i++) {
            code[i] = pk(handle, VRAM_CODE + i) & 0xff;
            attr[i] = pk(handle, VRAM_ATTR + i) & 0xff;
        }
        return { code, attr };
    }
    function diffCells(a, b) {   // 変化したセル index (昇順)
        const out = [];
        for (let c = 0; c < COLS * ROWS; c++) {
            if (a.code[c*2] !== b.code[c*2] || a.code[c*2+1] !== b.code[c*2+1] ||
                a.attr[c*2] !== b.attr[c*2] || a.attr[c*2+1] !== b.attr[c*2+1]) out.push(c);
        }
        return out;
    }
    function screenText() {
        let s = '';
        for (let i = 0; i < COLS * ROWS; i++) {
            const lo = pk(handle, VRAM_CODE + i * 2) & 0xff;
            s += (lo >= 0x20 && lo < 0x7f) ? String.fromCharCode(lo) : ' ';
        }
        return s;
    }
    function fepShow(sjisBytes, attrByte) {
        const n = sjisBytes.length;
        const p = M._malloc(n * 2);
        M.HEAPU8.set(sjisBytes, p);
        M.HEAPU8.set(new Uint8Array(n).fill(attrByte), p + n);
        const ret = M.ccall('np2kai_fep_show', 'number',
            ['number', 'number', 'number', 'number'], [handle, p, p + n, n]);
        M._free(p);
        return ret;
    }
    const fepHide = () => M.ccall('np2kai_fep_hide', null, ['number'], [handle]);
    function inject(bytes) {
        const p = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, p);
        M.ccall('np2kai_inject_text', 'number', ['number', 'number', 'number'],
            [handle, p, bytes.length]);
        M._free(p);
    }
    const frames = (n) => { for (let f = 0; f < n; f++) runFrame(handle); };

    let fails = 0;
    const ok = (cond, label) => {
        console.log((cond ? 'ok   ' : 'FAIL ') + label);
        if (!cond) fails++;
    };

    // ---- VZ 起動 ----
    frames(500);
    if (hasXdf) {
        inject(Uint8Array.from([0x59]));   // "A:/TEST.TXT を作成しますか (Y/N)" → Y
        frames(120);
        ok(/TEST\.TXT/.test(screenText()), 'VZ が編集モードに到達 (ステータス行に TEST.TXT)');
    } else {
        console.log('info games/mem_test/VZ_98.XDF 不在 — DEF プロンプト画面上で ①〜④ のみ検証');
    }

    const KA = sjisKu(0x82, 0xA9), NA = sjisKu(0x82, 0xC8), A = sjisKu(0x82, 0xA0);
    const base = snapshot();

    // ---- ① "かa" を白下線 0xE9 で表示 → 3 セル (全角 2 + ANK 1) ----
    const n1 = fepShow(Uint8Array.from([0x82, 0xA9, 0x61]), 0xE9);
    ok(n1 === 3, `show("かa") 戻り値 = 3 セル (got ${n1})`);
    const s1 = snapshot();
    const d1 = diffCells(base, s1);
    ok(d1.length === 3, `変化セルがちょうど 3 (got ${d1.length})`);
    const contig = d1.length === 3 && d1[1] === d1[0] + 1 && d1[2] === d1[0] + 2;
    ok(contig, `変化セルが連続 (${d1.join(',')})`);
    if (contig) {
        const at = (c) => [s1.code[c*2], s1.code[c*2+1], s1.attr[c*2], s1.attr[c*2+1]];
        ok(at(d1[0]).join() === [KA[0], KA[1] | 0x80, 0xE9, 0].join(),
           `セル1 = か左 (ku=${KA[0]}, jis2|80=${(KA[1] | 0x80).toString(16)}, attr=E9)`);
        ok(at(d1[1]).join() === [KA[0], KA[1] | 0x80, 0xE9, 0].join(), 'セル2 = か右 (同符号)');
        ok(at(d1[2]).join() === [0x61, 0, 0xE9, 0].join(), "セル3 = 'a' ANK");
        console.log(`     overlay 位置: row=${Math.floor(d1[0] / COLS)} col=${d1[0] % COLS}`);
    }

    // ---- ② 短い "あ" (反転 0xE5) へ更新 → 3 セル目が復元されている ----
    const n2 = fepShow(Uint8Array.from([0x82, 0xA0]), 0xE5);
    ok(n2 === 2, `show("あ") 戻り値 = 2 セル (got ${n2})`);
    const s2 = snapshot();
    const d2 = diffCells(base, s2);
    ok(d2.length === 2, `変化セルがちょうど 2 = 3 セル目が復元済み (got ${d2.length})`);
    ok(d2.length === 2 && s2.code[d2[0]*2] === A[0] && s2.code[d2[0]*2+1] === (A[1] | 0x80) &&
       s2.attr[d2[0]*2] === 0xE5, 'セル = あ左 + 反転属性 E5');

    // ---- ③ hide → 表示前と完全一致 ----
    fepHide();
    ok(diffCells(base, snapshot()).length === 0, 'hide で完全復元 (base と 0 差分)');

    // ---- ④ 所有権: 表示中にアプリが overlay セルを上書き → hide はそのセルに触らない ----
    fepShow(Uint8Array.from([0x82, 0xA9, 0x61]), 0xE9);
    const d4 = diffCells(base, snapshot());
    const owned = d4[2];
    poke(handle, VRAM_CODE + owned * 2, 0x58);   // アプリの 'X' 上書きを模擬
    fepHide();
    const s5 = snapshot();
    ok(s5.code[owned*2] === 0x58, "アプリ上書きセルは復元しない ('X' が残る)");
    ok(diffCells(base, s5).filter((c) => c !== owned).length === 0, '他セルは復元済み');
    poke(handle, VRAM_CODE + owned * 2, base.code[owned*2]);   // 後始末

    if (hasXdf) {
        // ---- ⑤ 確定注入 → VZ のエコー (VZ 直書き形式で本文に現れる) ----
        inject(Uint8Array.from([0x82, 0xA9, 0x82, 0xC8]));   // "かな"
        frames(120);
        const s6 = snapshot();
        let echoAt = -1;
        for (let c = 0; c < COLS * ROWS - 3; c++) {
            if (s6.code[c*2] === KA[0] && s6.code[c*2+1] === KA[1] &&               // か左
                s6.code[(c+1)*2] === (KA[0] | 0x80) && s6.code[(c+1)*2+1] === KA[1] && // か右
                s6.code[(c+2)*2] === NA[0] && s6.code[(c+2)*2+1] === NA[1]) { echoAt = c; break; }
        }
        ok(echoAt >= 0, `確定注入 "かな" が VZ 本文にエコー (row=${Math.floor(echoAt / COLS)} col=${echoAt % COLS})`);

        // ---- ⑥ 高速タイプの取り合い: 確定 → 即 fepShow → VZ エコー → 次の表示更新。
        //      overlay がエコーに踏まれても、所有権検証によりエコー本文が壊れないこと ----
        const before = snapshot();
        fepHide();                                            // (表示なし → no-op)
        inject(Uint8Array.from([0x82, 0xA0]));                // 確定 "あ"
        fepShow(Uint8Array.from([0x73]), 0xE9);               // 即、次の composition "s" (エコー前 = 古いカーソル位置)
        frames(120);                                          // VZ が "あ" をエコー (overlay を踏む)
        fepShow(Uint8Array.from([0x82, 0xB5]), 0xE9);         // 表示更新 "し" (踏まれたセルは復元しない)
        fepHide();                                            // 取消
        const s7 = snapshot();
        let aAt = -1;
        for (let c = 0; c < COLS * ROWS - 1; c++) {
            if (s7.code[c*2] === A[0] && s7.code[c*2+1] === A[1] &&
                s7.code[(c+1)*2] === (A[0] | 0x80) && s7.code[(c+1)*2+1] === A[1]) { aAt = c; break; }
        }
        ok(aAt >= 0, 'エコー "あ" が overlay 越しでも本文に残る (取り合いで壊れない)');
        // overlay の痕跡 ('s' や "し") が画面に残っていないこと
        const diffs = diffCells(before, s7);
        const stray = diffs.filter((c) => {
            const lo = s7.code[c*2], hi = s7.code[c*2+1];
            return lo === 0x73 || (lo === sjisKu(0x82, 0xB5)[0] && hi === (sjisKu(0x82, 0xB5)[1] | 0x80));
        });
        ok(stray.length === 0, `overlay の痕跡が残らない (残 ${stray.length})`);
    }

    console.log(fails ? `FAIL — ${fails} 件` : 'PASS — FEP 表示/復元/所有権/VZ 実地 全チェック通過');
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
