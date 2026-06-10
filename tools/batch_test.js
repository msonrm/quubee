#!/usr/bin/env node
// batch_test.js — .bat errorlevel 分岐インタプリタ (③) の end-to-end headless 検証。
//
// loader 実ブート (exec_env_test と同型) で、buildStatements → serializeStatements →
// np2kai_dos_stage_batch → ミニ COMMAND.COM が C インタプリタに問い合わせながら EXEC、
// までの全経路を 2 サイクル走らせる:
//   サイクル 1: 逆順ラダー — RET3.COM (exit 3) の errorlevel を if errorlevel 4 /
//     if not errorlevel 2 で判定し、正解枝 (WIN.COM) だけ実行・誤答枝 (LOSE.COM) は
//     実行されないこと + echo が text VRAM に出ることを確認。素通り/全取りの
//     ヒューリスティックだと必ず誤答枝を踏む並びにしてある。
//   サイクル 2: 後方 goto ループ (FINALTY 型) — FLIP.COM は自分のファイルの flag byte を
//     書き換えて 1 回目 exit 0 / 2 回目 exit 1 を返す。:loop → flip → if errorlevel 1 →
//     goto loop が 2 周で抜け、WIN.COM に到達することを確認 (分岐の遅延評価 = ループ成立)。
// 使い方: node tools/batch_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const bat = require(path.join(WEB, 'player/batscript.js'));

// ---- 子 COM (手アセンブル) ----
const RET3 = [0xB8, 0x03, 0x4C, 0xCD, 0x21];              // mov ax,4C03h / int 21h
const EXIT0 = [0xB8, 0x00, 0x4C, 0xCD, 0x21];             // mov ax,4C00h / int 21h
// FLIP.COM: AL=自ファイル内 flag (初回 0) を控え、flag を 1 に書き換えてから AL で exit。
// EXEC は毎回 /run から読み直すので 1 回目 exit 0 / 2 回目 exit 1 になる (open/seek/write/close も踏む)。
const FLIP = [
    0xA0, 0x2D, 0x01,        // 0100 mov al,[012Dh]    (flag)
    0x50,                    // 0103 push ax
    0xB8, 0x02, 0x3D,        // 0104 mov ax,3D02h      (open RW)
    0xBA, 0x2F, 0x01,        // 0107 mov dx,012Fh      (fname)
    0xCD, 0x21,              // 010A int 21h
    0x72, 0x1A,              // 010C jc  0128h         (open 失敗なら書き換えスキップ)
    0x8B, 0xD8,              // 010E mov bx,ax
    0xB8, 0x00, 0x42,        // 0110 mov ax,4200h      (seek SET)
    0x33, 0xC9,              // 0113 xor cx,cx
    0xBA, 0x2D, 0x00,        // 0115 mov dx,002Dh      (flag のファイル内オフセット)
    0xCD, 0x21,              // 0118 int 21h
    0xB4, 0x40,              // 011A mov ah,40h        (write 1 byte)
    0xB9, 0x01, 0x00,        // 011C mov cx,1
    0xBA, 0x2E, 0x01,        // 011F mov dx,012Eh      (one)
    0xCD, 0x21,              // 0122 int 21h
    0xB4, 0x3E,              // 0124 mov ah,3Eh        (close)
    0xCD, 0x21,              // 0126 int 21h
    0x58,                    // 0128 pop ax            (AL = 元の flag)
    0xB4, 0x4C,              // 0129 mov ah,4Ch
    0xCD, 0x21,              // 012B int 21h
    0x00,                    // 012D flag
    0x01,                    // 012E one
    ...Array.from('FLIP.COM\0', (c) => c.charCodeAt(0)),  // 012F fname ASCIZ
];

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
    M.FS.writeFile('/run/RET3.COM', new Uint8Array(RET3));
    M.FS.writeFile('/run/WIN.COM',  new Uint8Array(EXIT0));
    M.FS.writeFile('/run/LOSE.COM', new Uint8Array(EXIT0));

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const peek8 = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);

    // .bat テキスト → buildStatements → 直列化 → stage_batch (bridge.js stageAndRunBatch と同経路)
    const stageBat = (lines, names, userArgs) => {
        const recipe = bat.parse(lines.join('\r\n') + '\r\n');
        const stmts = bat.buildStatements(recipe, names, userArgs || '');
        if (!stmts) throw new Error('buildStatements returned null');
        const progStr = bat.serializeStatements(stmts);
        const bytes = Buffer.from(progStr, 'latin1');
        const ptr = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, ptr);
        const r = M.ccall('np2kai_dos_stage_batch', 'number',
            ['number', 'number', 'string'], [ptr, bytes.length, 'batch_test']);
        M._free(ptr);
        return r;
    };

    // text VRAM (0xA0000, 2 byte/セル) の低位バイト列を文字列で取り出す
    const vramText = () => {
        let s = '';
        for (let a = 0xA0000; a < 0xA0000 + 80 * 2 * 25; a += 2) {
            const c = peek8(handle, a) & 0xff;
            s += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : ' ';
        }
        return s;
    };
    const execsIn = (slice) => slice.filter((l) => /\[int21h\/4B\] EXEC child=/.test(l))
        .map((l) => l.match(/EXEC child=(\S+)/)[1]);

    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); }
                                 else { fail++; console.log(`  FAIL: ${msg}`); } };

    // ---- サイクル 1: 逆順ラダー (RET3 の exit 3 で正解枝だけ実行) ----
    console.log('cycle 1: reverse errorlevel ladder');
    let r = stageBat([
        '@echo off',
        'ret3',
        'if errorlevel 4 goto wrong',      // 3>=4 偽 → fall
        'if not errorlevel 2 goto wrong',  // not(3>=2) 偽 → fall
        'goto ok',
        ':wrong',
        'lose',
        'goto end',
        ':ok',
        'echo LADDER-OK',
        'win',
        ':end',
        'echo ALL-DONE',
    ], ['RET3.COM', 'WIN.COM', 'LOSE.COM'], '');
    chk(r === 0, `stage_batch r=${r}`);
    const mark1 = logs.length;
    M.ccall('np2kai_reset', null, ['number'], [handle]);
    for (let i = 0; i < 2200; i++) runFrame(handle);
    const ex1 = execsIn(logs.slice(mark1));
    const vt1 = vramText();
    chk(ex1.join(',') === 'RET3.COM,WIN.COM',
        `EXEC 列 = RET3→WIN のみ (LOSE 不実行): [${ex1.join(',')}]`);
    chk(vt1.includes('LADDER-OK') && vt1.includes('ALL-DONE'),
        'echo "LADDER-OK"/"ALL-DONE" が text VRAM に表示');
    chk(logs.slice(mark1).some((l) => /if errorlevel 4 \(code=3\) -> fall-through/.test(l)),
        'iferr が errorlevel=3 を遅延評価 (4 は fall-through)');

    // ---- サイクル 2: 後方 goto ループ (FINALTY 型、FLIP が 2 周目で exit 1) ----
    console.log('cycle 2: backward goto loop');
    M.FS.writeFile('/run/FLIP.COM', new Uint8Array(FLIP));   // flag=0 で配置
    r = stageBat([
        ':loop',
        'echo ITER',
        'flip',
        'if errorlevel 1 goto done',
        'goto loop',
        ':done',
        'win',
        'echo LOOP-DONE',
    ], ['FLIP.COM', 'WIN.COM'], '');
    chk(r === 0, `stage_batch r=${r}`);
    const mark2 = logs.length;
    M.ccall('np2kai_reset', null, ['number'], [handle]);
    for (let i = 0; i < 2600; i++) runFrame(handle);
    const ex2 = execsIn(logs.slice(mark2));
    const vt2 = vramText();
    chk(ex2.join(',') === 'FLIP.COM,FLIP.COM,WIN.COM',
        `EXEC 列 = FLIP×2 → WIN (ループ 2 周で脱出): [${ex2.join(',')}]`);
    chk(logs.slice(mark2).some((l) => /if errorlevel 1 \(code=0\) -> fall-through/.test(l)) &&
        logs.slice(mark2).some((l) => /if errorlevel 1 \(code=1\) -> goto/.test(l)),
        'iferr が周回ごとの errorlevel (0→1) を評価');
    chk(vt2.includes('LOOP-DONE'), 'echo "LOOP-DONE" が text VRAM に表示');

    console.log(`\nbatch_test: pass=${pass} fail=${fail}`);
    if (fail) {
        console.log('---- 末尾ログ ----');
        logs.slice(-40).forEach((l) => console.log('  ' + l));
    }
    process.exit(fail ? 1 : 0);
})();
