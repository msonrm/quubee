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
//   サイクル 3: 付加データ付き EXE の EXEC (FINALTY finmain.exe 型) — MZ ヘッダ記載の
//     ロードイメージ 37 byte + 付加データ 300KB (EXEC バッファ 256KB 超) の合成 EXE を
//     EXEC できること (実 DOS 同様ヘッダ記載分だけ読む) + `IF ERRORLEVEL == N` 変種構文
//     (実 DOS は `=` を区切り扱い。finalty.bat が使用) の遅延評価を確認。
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

    // ---- サイクル 3: 付加データ付き EXE (256KB 超ファイル・ロードイメージは 37 byte) ----
    console.log('cycle 3: appended-data EXE exec (FINALTY finmain 型)');
    {
        // 最小 MZ EXE: header 32B (e_cparhdr=2) + body 5B (mov ax,4C05h / int 21h = exit 5)。
        // image_in_file = 37 → e_cp=1, e_cblp=37。後ろに 0xAA を 300KB 連結 (ロード対象外)。
        const hdr = Buffer.alloc(32);
        hdr.write('MZ', 0, 'latin1');
        hdr.writeUInt16LE(37, 0x02);        // e_cblp
        hdr.writeUInt16LE(1, 0x04);         // e_cp
        hdr.writeUInt16LE(0, 0x06);         // e_crlc
        hdr.writeUInt16LE(2, 0x08);         // e_cparhdr (32 byte header)
        hdr.writeUInt16LE(0x100, 0x0A);     // e_minalloc
        hdr.writeUInt16LE(0xFFFF, 0x0C);    // e_maxalloc
        hdr.writeUInt16LE(0, 0x0E);         // e_ss
        hdr.writeUInt16LE(0x1000, 0x10);    // e_sp
        hdr.writeUInt16LE(0, 0x14);         // e_ip
        hdr.writeUInt16LE(0, 0x16);         // e_cs
        hdr.writeUInt16LE(0x1E, 0x18);      // e_lfarlc
        const body = Buffer.from([0xB8, 0x05, 0x4C, 0xCD, 0x21]);   // exit code 5
        const appended = Buffer.alloc(300 * 1024, 0xAA);
        M.FS.writeFile('/run/BIGRET.EXE', new Uint8Array(Buffer.concat([hdr, body, appended])));
        r = stageBat([
            'bigret',
            'IF ERRORLEVEL == 6 GOTO wrong',    // 5>=6 偽 → fall (== 変種は finalty.bat の実構文)
            'IF ERRORLEVEL == 5 GOTO ok',       // 5>=5 真 → goto
            ':wrong',
            'lose',
            'goto end',
            ':ok',
            'win',
            'echo BIG-OK',
            ':end',
        ], ['BIGRET.EXE', 'WIN.COM', 'LOSE.COM'], '');
        chk(r === 0, `stage_batch r=${r}`);
        const mark3 = logs.length;
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        for (let i = 0; i < 2200; i++) runFrame(handle);
        const ex3 = execsIn(logs.slice(mark3));
        chk(ex3.join(',') === 'BIGRET.EXE,WIN.COM',
            `EXEC 列 = BIGRET→WIN (307KB ファイルの EXE が EXEC 成功・LOSE 不実行): [${ex3.join(',')}]`);
        chk(logs.slice(mark3).some((l) => /if errorlevel 5 \(code=5\) -> goto/.test(l)),
            'IF ERRORLEVEL == 5 (変種構文) が code=5 で goto 評価');
        chk(vramText().includes('BIG-OK'), 'echo "BIG-OK" が text VRAM に表示');

        // ---- サイクル 3b: 付加データ EXE の SFT stale エントリ = 実ファイル全長 ----
        // EXEC の SFT エントリは「直近ロード 1 本」なので、BIGRET を唯一の EXEC にした
        // ミニランで終了後の SFT を見る (サイクル 3 本編は WIN.COM が上書きするため不可)。
        // サイズはロードイメージ 37B でなく stat した実ファイル全長 (付加データ込み) が
        // 入るべき — 実 DOS の stale エントリと同じ (PMD86 型の自己照合が使う値)。
        // entry0: linear 0xB06、file size +0x11、FCB 名 +0x20。
        r = stageBat(['bigret'], ['BIGRET.EXE'], '');
        chk(r === 0, `stage_batch r=${r} (3b)`);
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        for (let i = 0; i < 1200; i++) runFrame(handle);
        let sftNm = '';
        for (let k = 0; k < 11; k++) sftNm += String.fromCharCode(peek8(handle, 0xB26 + k));
        const sftSz = (peek8(handle, 0xB17) | (peek8(handle, 0xB18) << 8) |
                       (peek8(handle, 0xB19) << 16) | (peek8(handle, 0xB1A) << 24)) >>> 0;
        const bigretTotal = 32 + 5 + 300 * 1024;   // header+body+付加データ = 実ファイル全長
        chk(sftNm === 'BIGRET  EXE' && sftSz === bigretTotal,
            `SFT stale エントリ = "BIGRET  EXE" + 実ファイル全長 ${bigretTotal} ` +
            `(実測 "${sftNm}" ${sftSz})`);
    }

    // ---- サイクル 4: set (環境変数) + cd (カレント移動) (MUAP98 型) ----
    // `cd \sub` でカレントをサブディレクトリへ移し、相対 open が通ることで cd を検証する
    // (/run/MARK.DAT は無く /run/SUB/MARK.DAT だけ置く → cd 無しなら open 失敗 = 区別がつく)。
    // `set FOO=BAR` がマスタ env (QB_DOS_ENV_SEG=0x00F0, linear 0xF00) に入ることも確認する。
    console.log('cycle 4: set (env) + cd (chdir)');
    {
        // OPENREL.COM: 相対 "MARK.DAT" を open、成功で exit 0 / 失敗で exit 1。
        const OPENREL = [
            0xB8, 0x00, 0x3D,    // 0100 mov ax,3D00h   (open read)
            0xBA, 0x12, 0x01,    // 0103 mov dx,0112h   (fname)
            0xCD, 0x21,          // 0106 int 21h
            0xB0, 0x00,          // 0108 mov al,0
            0x73, 0x02,          // 010A jnc 010E       (成功なら al=0 のまま)
            0xB0, 0x01,          // 010C mov al,1        (失敗)
            0xB4, 0x4C,          // 010E mov ah,4Ch
            0xCD, 0x21,          // 0110 int 21h
            ...Array.from('MARK.DAT\0', (c) => c.charCodeAt(0)),  // 0112 fname
        ];
        M.FS.writeFile('/run/OPENREL.COM', new Uint8Array(OPENREL));
        try { M.FS.mkdir('/run/SUB'); } catch (_) {}
        M.FS.writeFile('/run/SUB/MARK.DAT', new Uint8Array([0x4f, 0x4b]));   // "OK"
        r = stageBat([
            '@echo off',
            'cd \\sub',
            'set FOO=BAR',
            'openrel',
            'if errorlevel 1 goto bad',
            'echo CD-OK',
            'win',
            'goto end',
            ':bad',
            'lose',
            ':end',
            'echo DONE4',
        ], ['OPENREL.COM', 'WIN.COM', 'LOSE.COM'], '');
        chk(r === 0, `stage_batch r=${r} (4)`);
        const mark4 = logs.length;
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        for (let i = 0; i < 2200; i++) runFrame(handle);
        const ex4 = execsIn(logs.slice(mark4));
        chk(ex4.join(',') === 'OPENREL.COM,WIN.COM',
            `EXEC 列 = OPENREL→WIN (cd \\sub で相対 open 成功・LOSE 不実行): [${ex4.join(',')}]`);
        chk(vramText().includes('CD-OK') && vramText().includes('DONE4'),
            'echo "CD-OK"/"DONE4" が text VRAM に表示');
        // マスタ env (0xF00) に "FOO=BAR" が入っているか (build_child_env が子へ verbatim コピー)
        let env = '';
        for (let a = 0xF00; a < 0xF00 + 256; a++) {
            const c = peek8(handle, a) & 0xff;
            env += (c === 0) ? '\n' : String.fromCharCode(c);
        }
        chk(/(^|\n)FOO=BAR(\n|$)/.test(env), `set FOO=BAR がマスタ env に反映 (env=${JSON.stringify(env.replace(/\n+/g, '|'))})`);
        chk(logs.slice(mark4).some((l) => /cd "\\sub" -> ok/.test(l)), '[batch] cd \\sub が ok ログ');
    }

    // ---- サイクル 5: バッチの「表示ラベル」を name に渡しても起動時 CWD が壊れないこと (回帰) ----
    // 0cc0ab0 で stage_shell_image が bridge.js の表示ラベル (例 "GAME.BAT (if/goto 分岐を実行時評価,
    // 6 cmd)") を stage_com の name に渡し、stage_dir がラベル中の "if/goto" の '/' を区切りと誤認して
    // 起動時 CWD を "GAME.BAT (if" 等の存在しないディレクトリに設定 → .bat が EXEC する本体の root 相対
    // open が全滅 (制御フロー .bat = 東方旧作 4 作が全滅) する回帰があった。シェルは常にルートで起動する
    // のが正しい (cd は文インタプリタが処理) ので、スラッシュ入りラベルでも root 相対 open が通ることを確認。
    console.log('cycle 5: slash-containing batch label must not corrupt boot CWD (regression for 0cc0ab0)');
    {
        M.FS.writeFile('/run/MARK.DAT', new Uint8Array([0x4f, 0x4b]));   // root 直下 "OK" (cd しない)
        const recipe5 = bat.parse([
            '@echo off',
            'openrel',
            'if errorlevel 1 goto bad',
            'echo OPENOK',
            'goto end',
            ':bad',
            'echo OPENFAIL',
            ':end',
        ].join('\r\n') + '\r\n');
        const stmts5 = bat.buildStatements(recipe5, ['OPENREL.COM'], '');
        if (!stmts5) throw new Error('buildStatements returned null (5)');
        const bytes5 = Buffer.from(bat.serializeStatements(stmts5), 'latin1');
        const ptr5 = M._malloc(bytes5.length); M.HEAPU8.set(bytes5, ptr5);
        // bridge.js が stageAndRunBatch で渡すのと同型の「表示ラベル」(スラッシュ "if/goto" 入り)
        const label5 = 'GAME.BAT (if/goto 分岐を実行時評価, 1 cmd)';
        r = M.ccall('np2kai_dos_stage_batch', 'number',
            ['number', 'number', 'string'], [ptr5, bytes5.length, label5]);
        M._free(ptr5);
        chk(r === 0, `stage_batch r=${r} (5)`);
        const mark5 = logs.length;
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        for (let i = 0; i < 2200; i++) runFrame(handle);
        const vram5 = vramText();
        chk(vram5.includes('OPENOK') && !vram5.includes('OPENFAIL'),
            'スラッシュ入りラベルでも CWD=root を保ち root 相対 open 成功 (0cc0ab0 回帰)');
    }

    console.log(`\nbatch_test: pass=${pass} fail=${fail}`);
    if (fail) {
        console.log('---- 末尾ログ ----');
        logs.slice(-40).forEach((l) => console.log('  ' + l));
    }
    process.exit(fail ? 1 : 0);
})();
