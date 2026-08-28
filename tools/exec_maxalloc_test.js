#!/usr/bin/env node
// exec_maxalloc_test.js — INT 21h AH=4Bh (EXEC) の子 EXE が MZ ヘッダの e_maxalloc を
// honor することの headless 回帰 (2026-08-28、issue #5)。
//
// 背景: 実 DOS の EXEC は子 EXE に PSP + body + clamp(e_maxalloc, e_minalloc, 空き) paragraphs
// だけを与え、余りは空きのまま残す。旧実装は e_maxalloc を無視して最大空きブロックを丸ごと
// 子に渡していたため、e_maxalloc が小さい EXE (LSI C-86 系に多い) が起動直後の AH=48h で
// 「空きゼロ」に出くわして落ちた。報告 (vyv03354 氏) は MAG.EXE を
//     MAG
//     MAG
// と 2 行書いた .bat から実行すると「メモリが足りません」、1 行なら通る、というもの。
// 1 行のときは staging (loader-start) 経路で e_maxalloc が honor され、2 行以上だと
// ミニ COMMAND.COM → INT 21h/4Bh 経路に切り替わって honor されない、という非対称が真因。
//
// そこで報告と同じ「.bat の 2 行」経路で 2 本の子 EXE を EXEC し、両側から挟む:
//   ① SMALLMAX.EXE (e_maxalloc=0x0010 = 小さい申告) … 起動直後の AH=48h BX=0x0100 (4KB) が
//      *成功* すべき。失敗するのが報告されたバグ (= 旧実装ならここで落ちる)。
//   ② FULLMAX.EXE  (e_maxalloc=0xFFFF = 大半の EXE の既定) … 同じ AH=48h が *失敗* すべき
//      (実 DOS どおり子が全空きメモリを所有)。成功したら「全部を空きに残した」回帰。
// 子は CF の結果を '0' (成功) / '1' (失敗) の 1 byte としてファイルに書き出し、それを検証する。
// stderr の EXEC ログに出る block=N para も併せて見て、②だけがブロックを丸ごと取ることを確認する。
//
// 使い方: node tools/exec_maxalloc_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const bat = require(path.join(WEB, 'player/batscript.js'));

// ---- 子 EXE (手アセンブル) ----
// EXE の entry では DS=ES=PSP なので、まず DS=CS にしてから自セグメントのデータを触る。
// CF (AH=48h の成否) は sbb dl,dl → and dl,1 → add dl,'0' で '0'/'1' に写して書き出す。
function buildChildExe(fname, maxalloc) {
    const name = Array.from(fname + '\0', (c) => c.charCodeAt(0));
    const code = [
        0x8C, 0xC8,                   // [ 0] mov ax, cs
        0x8E, 0xD8,                   // [ 2] mov ds, ax
        0xBB, 0x00, 0x01,             // [ 4] mov bx, 0x0100    ; 4KB
        0xB4, 0x48,                   // [ 7] mov ah, 0x48      ; allocate
        0xCD, 0x21,                   // [ 9] int 0x21
        0x1A, 0xD2,                   // [11] sbb dl, dl        ; CF=1 → FF / CF=0 → 00
        0x80, 0xE2, 0x01,             // [13] and dl, 1
        0x80, 0xC2, 0x30,             // [16] add dl, '0'
        0x88, 0x16, 0x00, 0x00,       // [19] mov [res], dl     ; disp16 @21,22
        0xB4, 0x3C,                   // [23] mov ah, 0x3C      ; create
        0x31, 0xC9,                   // [25] xor cx, cx
        0xBA, 0x00, 0x00,             // [27] mov dx, fname     ; imm16 @28,29
        0xCD, 0x21,                   // [30] int 0x21
        0x72, 0x10,                   // [32] jc  bad (@50)
        0x89, 0xC3,                   // [34] mov bx, ax        ; handle
        0xB4, 0x40,                   // [36] mov ah, 0x40      ; write
        0xB9, 0x01, 0x00,             // [38] mov cx, 1
        0xBA, 0x00, 0x00,             // [41] mov dx, res       ; imm16 @42,43
        0xCD, 0x21,                   // [44] int 0x21
        0xB4, 0x3E,                   // [46] mov ah, 0x3E      ; close
        0xCD, 0x21,                   // [48] int 0x21
        0xB8, 0x00, 0x4C,             // [50] bad: mov ax, 0x4C00
        0xCD, 0x21,                   // [53] int 0x21          ; exit 0
        0x00,                         // [55] res
    ];
    const RES = 55, FNAME = code.length;   // FNAME = 56
    code[21] = RES & 0xFF;   code[22] = RES >> 8;
    code[28] = FNAME & 0xFF; code[29] = FNAME >> 8;
    code[42] = RES & 0xFF;   code[43] = RES >> 8;
    const body = Buffer.from(code.concat(name));

    const HDR_PARA = 2;                      // 32 byte header
    const header = Buffer.alloc(HDR_PARA * 16);
    const total = header.length + body.length;
    header.write('MZ', 0, 'ascii');
    header.writeUInt16LE(total % 512, 0x02);   // e_cblp
    header.writeUInt16LE(Math.ceil(total / 512), 0x04);  // e_cp
    header.writeUInt16LE(0, 0x06);             // e_crlc (reloc 無し)
    header.writeUInt16LE(HDR_PARA, 0x08);      // e_cparhdr
    header.writeUInt16LE(0x0020, 0x0A);        // e_minalloc (スタックぶん)
    header.writeUInt16LE(maxalloc, 0x0C);      // e_maxalloc ← 本テストの主役
    header.writeUInt16LE(0x0000, 0x0E);        // e_ss (image_base 相対)
    header.writeUInt16LE(0x0200, 0x10);        // e_sp
    header.writeUInt16LE(0x0000, 0x12);        // e_csum
    header.writeUInt16LE(0x0000, 0x14);        // e_ip
    header.writeUInt16LE(0x0000, 0x16);        // e_cs (image_base 相対)
    header.writeUInt16LE(0x001C, 0x18);        // e_lfarlc
    header.writeUInt16LE(0x0000, 0x1A);        // e_ovno
    return new Uint8Array(Buffer.concat([header, body]));
}

(async () => {
    const logs = [];
    const M = await NP2KaiModule({
        print: () => {}, printErr: (s) => logs.push(s),
        locateFile: (p) => path.join(WEB, p),
    });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    try { M.FS.mkdir('/run'); } catch (_) {}
    M.FS.writeFile('/run/SMALLMAX.EXE', buildChildExe('SMALL.TXT', 0x0010));
    M.FS.writeFile('/run/FULLMAX.EXE',  buildChildExe('FULL.TXT',  0xFFFF));

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);

    // 報告と同じ「2 行の .bat」= ミニ COMMAND.COM 経由 → 両方とも INT 21h/4Bh 経路で起動される
    const recipe = bat.parse('smallmax\r\nfullmax\r\n');
    const stmts = bat.buildStatements(recipe, ['SMALLMAX.EXE', 'FULLMAX.EXE'], '');
    if (!stmts) { console.error('buildStatements returned null'); process.exit(1); }
    const bytes = Buffer.from(bat.serializeStatements(stmts), 'latin1');
    const ptr = M._malloc(bytes.length); M.HEAPU8.set(bytes, ptr);
    const sr = M.ccall('np2kai_dos_stage_batch', 'number', ['number', 'number', 'string'],
                       [ptr, bytes.length, 'exec_maxalloc_test']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_batch failed r=' + sr); process.exit(1); }

    M.ccall('np2kai_reset', null, ['number'], [handle]);
    for (let i = 0; i < 2400; i++) runFrame(handle);

    const readMarker = (name) => {
        for (const dir of ['/run/', '/']) {
            try { return Buffer.from(M.FS.readFile(dir + name)).toString('latin1'); } catch (_) {}
        }
        return null;
    };
    const small = readMarker('SMALL.TXT');
    const full  = readMarker('FULL.TXT');

    // EXEC ログから各子に渡したブロックサイズ (para) を拾う
    const blocks = {};
    let pending = null;
    for (const l of logs) {
        let m = l.match(/\[int21h\/4B\] EXEC child=(\S+)/);
        if (m) { pending = m[1]; continue; }
        m = l.match(/\[dos_exec\] child @ .*block=(\d+) para/);
        if (m && pending) { blocks[pending] = parseInt(m[1], 10); pending = null; }
    }

    let pass = 0, fail = 0;
    const chk = (cond, msg, extra) => {
        if (cond) { pass++; console.log(`  PASS: ${msg}`); }
        else { fail++; console.log(`  FAIL: ${msg}${extra ? '  ' + extra : ''}`); }
    };

    chk(small !== null, 'SMALLMAX.EXE が走ってマーカを書いた');
    chk(full !== null,  'FULLMAX.EXE が走ってマーカを書いた');
    // ← 本丸。旧実装 (e_maxalloc 無視で丸ごと割り当て) はここで '1' になる = issue #5 の再現
    chk(small === '0', 'e_maxalloc が小さい子は直上が空き → AH=48h 成功 (issue #5)',
        `SMALL.TXT=${JSON.stringify(small)}`);
    // ← 回帰ガード。e_maxalloc=FFFF の子は従来どおり全空きメモリを所有し 48h は失敗する
    chk(full === '1', 'e_maxalloc=FFFF の子は全メモリ所有 → AH=48h 失敗 (回帰なし)',
        `FULL.TXT=${JSON.stringify(full)}`);
    chk(blocks['SMALLMAX.EXE'] !== undefined && blocks['FULLMAX.EXE'] !== undefined,
        'EXEC ログから両子のブロックサイズを取得', JSON.stringify(blocks));
    chk(blocks['SMALLMAX.EXE'] < blocks['FULLMAX.EXE'] / 4,
        '小さい申告の子には申告どおり小さいブロックだけを渡す', JSON.stringify(blocks));

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) {
        console.log('--- logs (tail) ---\n' + logs.slice(-60).join('\n'));
    }
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
