#!/usr/bin/env node
// exe_maxalloc_test.js — staged EXE が MZ ヘッダの e_maxalloc を honor して
// 「起動時に全空きメモリを所有する」ことの headless 回帰 (2026-06-27)。
//
// 背景: 実 DOS は EXE に body + clamp(e_maxalloc, e_minalloc, 空き) paragraphs を割り当てる。
// e_maxalloc=0xFFFF (ほぼ全 EXE の既定) なら全コンベンショナルメモリを占有する。
// 旧ローダは e_maxalloc を無視し body+e_minalloc だけ与えていたため、自前ローダ型 EXE
// (bound NE の brpn = ぶろっくでポン 等) が AH=48h で確保した一時バッファが本体の
// セグメントロード先と衝突し、main を上書きして黒画面で暴走していた。
//
// テスト EXE (e_maxalloc=0xFFFF) の動作と期待:
//   ① AH=48h BX=0x1000 (64KB 確保) → 全メモリ所有なら *失敗* (CF=1)。
//      成功 (CF=0) してしまうのは旧バグ (プログラム直上が空き=非 faithful) → exit 1。
//   ② AH=4Ah で自ブロックを 0x0100 para に self-shrink (標準 C cstartup と同じ)。
//   ③ AH=48h BX=0x0080 → shrink で空けたメモリから *成功* するはず。失敗なら exit 2。
//   ④ 全て期待どおりなら exit 0。
// = 「起動時は全メモリ所有 (faithful) かつ shrink 後は通常確保が効く (回帰なし)」を 1 本で確認。
//
// 使い方: node tools/exe_maxalloc_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// --- 最小 MZ EXE を組む (ヘッダ 32 byte = 2 paragraphs、reloc 無し、e_maxalloc=0xFFFF) ---
function buildExe() {
    // body コード (CS:IP = image_base:0x0000 から実行)。jnc/jc のオフセットは下の
    // バイト並びを手計算で解決した値 (rel8 は次命令先頭からの相対):
    //   jnc @off7  → fail1 @off30: rel = 30-9  = 0x15
    //   jc  @off23 → fail2 @off35: rel = 35-25 = 0x0A
    const code = [
        0xBB, 0x00, 0x10,       // [ 0] mov bx, 0x1000      ; 64KB
        0xB4, 0x48,             // [ 3] mov ah, 0x48        ; allocate
        0xCD, 0x21,             // [ 5] int 0x21
        0x73, 0x15,             // [ 7] jnc fail1 (→off30 exit 1)  ; 確保成功 = 旧バグ
        // self-shrink: ES = PSP (entry 時のまま)、BX = 0x100 para
        0xBB, 0x00, 0x01,       // [ 9] mov bx, 0x0100
        0xB4, 0x4A,             // [12] mov ah, 0x4A        ; resize (self-shrink)
        0xCD, 0x21,             // [14] int 0x21
        // 解放後の再確保 (成功すべき)
        0xBB, 0x80, 0x00,       // [16] mov bx, 0x0080
        0xB4, 0x48,             // [19] mov ah, 0x48        ; allocate
        0xCD, 0x21,             // [21] int 0x21
        0x72, 0x0A,             // [23] jc fail2 (→off35 exit 2)   ; 確保失敗 = 回帰
        // success
        0xB8, 0x00, 0x4C,       // [25] mov ax, 0x4C00
        0xCD, 0x21,             // [28] int 0x21            ; exit 0
        // fail1: (jnc 先, off30) — 全メモリ所有でなかった
        0xB8, 0x01, 0x4C,       // [30] mov ax, 0x4C01
        0xCD, 0x21,             // [33] int 0x21            ; exit 1
        // fail2: (jc 先, off35) — shrink 後の確保に失敗
        0xB8, 0x02, 0x4C,       // [35] mov ax, 0x4C02
        0xCD, 0x21,             // [38] int 0x21            ; exit 2
    ];
    const body = Buffer.from(code);

    const HDR_PARA = 2;                 // 32 byte header
    const header = Buffer.alloc(HDR_PARA * 16);
    const total = header.length + body.length;
    const pages = Math.ceil(total / 512);
    const lastpage = total % 512;       // 0 = ちょうど 512 の倍数
    header.write('MZ', 0, 'ascii');
    header.writeUInt16LE(lastpage, 0x02);   // e_cblp
    header.writeUInt16LE(pages, 0x04);       // e_cp
    header.writeUInt16LE(0, 0x06);           // e_crlc (reloc 無し)
    header.writeUInt16LE(HDR_PARA, 0x08);    // e_cparhdr
    header.writeUInt16LE(0x0000, 0x0A);      // e_minalloc
    header.writeUInt16LE(0xFFFF, 0x0C);      // e_maxalloc ← 本テストの主役
    header.writeUInt16LE(0x0000, 0x0E);      // e_ss (image_base 相対)
    header.writeUInt16LE(0x0100, 0x10);      // e_sp
    header.writeUInt16LE(0x0000, 0x12);      // e_csum
    header.writeUInt16LE(0x0000, 0x14);      // e_ip
    header.writeUInt16LE(0x0000, 0x16);      // e_cs (image_base 相対)
    header.writeUInt16LE(0x001C, 0x18);      // e_lfarlc
    header.writeUInt16LE(0x0000, 0x1A);      // e_ovno
    return Buffer.concat([header, body]);
}

(async () => {
    const logs = [];
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: (s) => logs.push(s) });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    const exe = buildExe();
    const ptr = M._malloc(exe.length); M.HEAPU8.set(exe, ptr);
    const sr = M.ccall('np2kai_dos_stage_exe', 'number', ['number', 'number', 'string', 'string'],
                       [ptr, exe.length, '', 'MAXTEST.EXE']);
    M._free(ptr);
    if (sr !== 0) { console.error('stage_exe failed r=' + sr); process.exit(1); }

    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const codeP = M._malloc(4);
    let exited = 0, code = -1;
    for (let i = 0; i < 2000; i++) {
        runFrame(handle);
        if (getExit(codeP)) { exited = 1; code = M.getValue(codeP, 'i32'); break; }
    }
    M._free(codeP);

    let pass = 0, fail = 0;
    const check = (name, cond, extra) => {
        if (cond) { pass++; console.log(`  ok   ${name}`); }
        else      { fail++; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); }
    };
    check('EXE が終了した', exited, `exited=${exited}`);
    check('起動時に全メモリ所有 → AH=48h 大確保が失敗 (exit≠1)', code !== 1, `code=${code}`);
    check('self-shrink 後の AH=48h は成功 (exit≠2)', code !== 2, `code=${code}`);
    check('総合: exit 0 (faithful + 回帰なし)', code === 0, `code=${code}`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) { console.log('--- logs ---\n' + logs.join('\n')); }
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
