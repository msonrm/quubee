#!/usr/bin/env node
// dosver_test.js — HLE-DOS が名乗るバージョンの実行時設定 (issue #3) の headless 回帰。
//
// 背景: INT 21h AH=30h は DOS 5.00 決め打ちだったため、自前で版数を検査する MS-DOS 6.2 の
// 標準コマンドが「DOSのバージョンが違います」で弾かれていた (報告: vyv03354 氏)。
// 既定は 5.00 のまま (90 年代ソフトの大半は 3.30 以上を期待するだけで、5.00 が最も無難な中庸)
// 据え置き、持ち込んだ DOS のツール群に合わせて名乗り直せる上級者オプションを足した
// (qbDebug.dosver('6.20') → np2kai_set_dos_version)。設定ダイアログには出さない。
//
// 確認する 3 点:
//   ① 既定は 5.00 (AH=30h → AL=5, AH=0)。既定を動かしていないことのガード。
//   ② dosver('6.20') 後は 6.20 を名乗る (AL=6, AH=20)。'6.2' も同値に解釈される DOS 慣例。
//   ③ AX=3306h (true version) も同じ値を答える。従来は 33h の default に落ちて BL/BH が
//      未定義のまま返っていた (SETVER 迂回でバージョンを訊く経路)。
// ゲスト側は AH=30h と AX=3306h の結果 4 byte を VER.TXT に書き出す COM で観測する。
//
// 使い方: node tools/dosver_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// ---- COM (org 0x100、DS=CS=PSP なのでデータは直接触れる) ----
function buildVerCom() {
    const code = [
        0xB4, 0x30,                   // [ 0] mov ah, 0x30      ; get version
        0xCD, 0x21,                   // [ 2] int 0x21          ; AL=major AH=minor
        0xA3, 0x00, 0x00,             // [ 4] mov [ver30], ax   ; imm16 @5,6
        0xB8, 0x06, 0x33,             // [ 7] mov ax, 0x3306    ; get TRUE version
        0xCD, 0x21,                   // [10] int 0x21          ; BL=major BH=minor
        0x89, 0x1E, 0x00, 0x00,       // [12] mov [ver33], bx   ; imm16 @14,15
        0xB4, 0x3C,                   // [16] mov ah, 0x3C      ; create
        0x31, 0xC9,                   // [18] xor cx, cx
        0xBA, 0x00, 0x00,             // [20] mov dx, fname     ; imm16 @21,22
        0xCD, 0x21,                   // [23] int 0x21
        0x72, 0x10,                   // [25] jc  bad (@43)
        0x89, 0xC3,                   // [27] mov bx, ax        ; handle
        0xB4, 0x40,                   // [29] mov ah, 0x40      ; write 4 byte
        0xB9, 0x04, 0x00,             // [31] mov cx, 4
        0xBA, 0x00, 0x00,             // [34] mov dx, ver30     ; imm16 @35,36
        0xCD, 0x21,                   // [37] int 0x21
        0xB4, 0x3E,                   // [39] mov ah, 0x3E      ; close
        0xCD, 0x21,                   // [41] int 0x21
        0xB8, 0x00, 0x4C,             // [43] bad: mov ax, 0x4C00
        0xCD, 0x21,                   // [46] int 0x21
        0x00, 0x00,                   // [48] ver30
        0x00, 0x00,                   // [50] ver33
    ];
    const ORG = 0x100;
    const VER30 = ORG + 48, VER33 = ORG + 50, FNAME = ORG + code.length;   // FNAME = 0x134
    code[5]  = VER30 & 0xFF; code[6]  = VER30 >> 8;
    code[14] = VER33 & 0xFF; code[15] = VER33 >> 8;
    code[21] = FNAME & 0xFF; code[22] = FNAME >> 8;
    code[35] = VER30 & 0xFF; code[36] = VER30 >> 8;
    return Uint8Array.from(code.concat(Array.from('VER.TXT\0', (c) => c.charCodeAt(0))));
}

(async () => {
    const logs = [];
    const M = await NP2KaiModule({
        print: () => {}, printErr: (s) => logs.push(s),
        locateFile: (p) => path.join(WEB, p),
    });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const setVer   = M.cwrap('np2kai_set_dos_version', 'number', ['number']);
    const getVer   = M.cwrap('np2kai_get_dos_version', 'number', []);
    const com = buildVerCom();

    // COM を staging して 1 回走らせ、VER.TXT の 4 byte [major30,minor30,major33,minor33] を返す
    const runOnce = () => {
        try { M.FS.mkdir('/run'); } catch (_) {}
        try { M.FS.unlink('/run/VER.TXT'); } catch (_) {}
        try { M.FS.unlink('/VER.TXT'); } catch (_) {}
        const ptr = M._malloc(com.length); M.HEAPU8.set(com, ptr);
        const r = M.ccall('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string'],
                          [ptr, com.length, '', 'VERTEST.COM']);
        M._free(ptr);
        if (r !== 0) return null;
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        for (let i = 0; i < 1200; i++) runFrame(handle);
        for (const dir of ['/run/', '/']) {
            try { return Array.from(M.FS.readFile(dir + 'VER.TXT')); } catch (_) {}
        }
        return null;
    };

    let pass = 0, fail = 0;
    const chk = (cond, msg, extra) => {
        if (cond) { pass++; console.log(`  PASS: ${msg}`); }
        else { fail++; console.log(`  FAIL: ${msg}${extra ? '  ' + extra : ''}`); }
    };

    // ---- ① 既定 = 5.00 ----
    chk(getVer() === 0x0500, '既定の packed 値が 0x0500 (5.00)', `got 0x${getVer().toString(16)}`);
    const v1 = runOnce();
    chk(v1 !== null, '既定でゲストが版数を書き出した');
    chk(v1 && v1[0] === 5 && v1[1] === 0, '既定は AH=30h → 5.00 を名乗る', JSON.stringify(v1));
    chk(v1 && v1[2] === 5 && v1[3] === 0, '既定は AX=3306h も 5.00 を答える', JSON.stringify(v1));

    // ---- ② dosver('6.20') 相当 ----
    chk(setVer((6 << 8) | 20) === 0x0614, 'set_dos_version(6.20) が packed 値を返す');
    const v2 = runOnce();
    chk(v2 && v2[0] === 6 && v2[1] === 20, '設定後は AH=30h → 6.20 を名乗る (issue #3)', JSON.stringify(v2));
    chk(v2 && v2[2] === 6 && v2[3] === 20, '設定後は AX=3306h も 6.20 を答える', JSON.stringify(v2));

    // ---- ③ 不正値は既定へ戻す (major 0 は名乗れない) ----
    chk(setVer(0x0020) === 0x0500, 'major=0 の指定は既定 5.00 に戻す');

    // ---- ④ qbDebug.dosver の文字列パーサ ('6.2' も '6.20' も minor=20 = DOS の言い方) ----
    const src = fs.readFileSync(path.join(WEB, 'player/bridge.js'), 'utf8');
    const beg = src.indexOf('function qbParseDosVer');
    const end = src.indexOf('\n\n', src.indexOf('const qbFmtDosVer'));
    const { qbParseDosVer, qbFmtDosVer } =
        new Function(src.slice(beg, end) + '\nreturn { qbParseDosVer, qbFmtDosVer };')();
    chk(qbParseDosVer('6.20') === 0x0614, "パーサ: '6.20' → 6.20");
    chk(qbParseDosVer('6.2') === 0x0614, "パーサ: '6.2' も 6.20 (DOS 慣例で小数部は 2 桁)");
    chk(qbParseDosVer('5') === 0x0500, "パーサ: '5' → 5.00");
    chk(qbParseDosVer('') === null && qbParseDosVer('6.2.1') === null && qbParseDosVer('x') === null,
        'パーサ: 解釈できない指定は null');
    chk(qbFmtDosVer(0x0614) === '6.20' && qbFmtDosVer(0x0500) === '5.00', '表示: packed → "M.mm"');

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log('--- logs (tail) ---\n' + logs.slice(-40).join('\n')); }
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
