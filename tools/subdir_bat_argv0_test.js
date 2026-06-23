#!/usr/bin/env node
// subdir_bat_argv0_test.js — サブディレクトリ内の本体を「起動 .bat の cd + EXEC」で起動した
// とき、子の argv[0] がサブディレクトリ込み (A:\DEPTH\DEPTH.EXE) になることの headless 回帰。
//
// 背景: Super Depth の depth.exe は argv[0] の最後の '\' でデータディレクトリを切り出す。
// 直接起動 (subdir_cwd_test) は build_env が g_stage.dir 込みで argv[0] を作るので動くが、
// ルートに置いた depth.bat:
//     cd depth
//     depth
// を Run すると、ミニ COMMAND.COM が "\depth\depth.exe" を AH=4Bh EXEC する経路に入る。
// EXEC 子の argv[0] を作る build_child_env が basename しか受け取っていなかったため argv[0] が
// "A:\DEPTH.EXE" (サブディレクトリ欠落) になり、depth.exe がデータを A:\ に探して起動できなかった。
// 修正 = EXEC ハンドラが /run 相対フルパス (read_dos_rel) を build_child_env に渡し、argv[0] に
// サブディレクトリを含める (直接起動の build_env と同じ書式)。
//
// 本テストは本番経路を忠実に通す: batscript.js parse → buildStatements → serializeStatements →
// np2kai_dos_stage_batch → ミニ COMMAND.COM が C インタプリタに問い合わせながら EXEC。
//   Case A: ルート depth.bat ("cd depth" + "depth")、本体は DEPTH/PROG.COM。
//           → argv[0] = A:\DEPTH\PROG.COM (サブディレクトリ込み) かつ相対 DATA.BIN open 成功。
//   Case B: ルート run.bat ("prog")、本体は PROG.COM (ルート直下)。
//           → argv[0] = A:\PROG.COM (余計なサブディレクトリが付かない = 回帰なし)。
// 使い方: node tools/subdir_bat_argv0_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const bat = require(path.join(WEB, 'player/batscript.js'));

// 相対 "DATA.BIN" を open → 成功 exit0 / 失敗 exit1 する最小 COM (CS:0x100 ロード)。
// 本体名はケースごとに変える (bat のコマンドと一致させて find が解決できるように) が、
// 中身 (DATA.BIN を相対 open) は共通なので 1 つの blob を使い回す。
const PROBE_COM = new Uint8Array([
    0xB4, 0x3D,             // mov ah, 0x3D   ; open existing
    0xB0, 0x00,             // mov al, 0x00   ; read access
    0xBA, 0x15, 0x01,       // mov dx, 0x0115 ; DS:DX -> "DATA.BIN"
    0xCD, 0x21,             // int 0x21
    0x72, 0x05,             // jc  fail
    0xB8, 0x00, 0x4C,       // mov ax, 0x4C00 ; success: exit 0
    0xCD, 0x21,             // int 0x21
    0xB8, 0x01, 0x4C,       // mov ax, 0x4C01 ; fail: exit 1
    0xCD, 0x21,             // int 0x21
    0x44, 0x41, 0x54, 0x41, 0x2E, 0x42, 0x49, 0x4E, 0x00,  // "DATA.BIN\0" at 0x115
]);
const DATA = new Uint8Array([0x4F, 0x4B]);

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

    const runFrame   = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit    = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const peek8      = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const stageBatch = M.cwrap('np2kai_dos_stage_batch', 'number', ['number', 'number', 'string']);

    const rmrf = (p) => { try {
        const st = M.FS.stat(p);
        if (M.FS.isDir(st.mode)) { for (const e of M.FS.readdir(p)) if (e !== '.' && e !== '..') rmrf(p + '/' + e); M.FS.rmdir(p); }
        else M.FS.unlink(p);
    } catch (_) {} };
    const writeRun = (rel, data) => {
        try { M.FS.mkdir('/run'); } catch (_) {}
        const parts = rel.split('/');
        let dir = '/run';
        for (let k = 0; k < parts.length - 1; k++) { dir += '/' + parts[k]; try { M.FS.mkdir(dir); } catch (_) {} }
        M.FS.writeFile('/run/' + rel, data);
    };

    // batData(=.bat 生バイト) + entries(展開済みエントリ名) を本番経路で stage_batch に通す。
    function runBat(batData, entries, files) {
        try { for (const e of M.FS.readdir('/run')) if (e !== '.' && e !== '..') rmrf('/run/' + e); } catch (_) {}
        for (const [rel, data] of files) writeRun(rel, data);

        // 本番 (bridge.js) と同じ: parse → buildStatements → serializeStatements。
        const bytes = new Uint8Array([...batData].map((c) => c.charCodeAt(0)));
        const recipe = bat.parse(bytes);
        const stmts = bat.buildStatements(recipe, entries, '');
        if (!stmts) return { err: 'buildStatements returned null' };
        const progStr = bat.serializeStatements(stmts);
        const prog = new Uint8Array(progStr.length);
        for (let i = 0; i < progStr.length; i++) prog[i] = progStr.charCodeAt(i) & 0xff;

        const ptr = M._malloc(prog.length); M.HEAPU8.set(prog, ptr);
        const r = stageBatch(ptr, prog.length, 'test.bat');
        M._free(ptr);
        if (r !== 0) return { err: `stage_batch r=${r}` };

        M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
            [handle, '/tmp/loader.d88', 0, 0]);
        M.ccall('np2kai_reset', null, ['number'], [handle]);

        // 子の exit を捕まえる (SHELL 自体は子ゲームが常駐する間 exit しない。子の exit code を見る)。
        let childCode = null;
        const p = M._malloc(4);
        for (let i = 0; i < 4000; i++) {
            runFrame(handle);
            if (getExit(p)) { childCode = M.getValue(p, 'i32'); break; }
            // 子が exit したかはログでも拾えるが、ここでは EXEC ログから後で判定する。
        }
        M._free(p);

        // conventional RAM を走査して子 env の argv[0] (A:\...PROG.COM) を回収する
        // (subdir_cwd_test と同じイディオム: env は load seg の下に在る)。
        const LO = 0x400, HI = 0x60000;
        const buf = Buffer.alloc(HI - LO);
        for (let a = LO; a < HI; a++) buf[a - LO] = peek8(handle, a) & 0xff;
        const ram = buf.toString('latin1');
        const argv0s = [...new Set([...ram.matchAll(/A:\\[A-Z0-9\\._]+\.COM/g)].map((m) => m[0]))];
        // 子の exit code は EXEC ログ末尾の "child exited code=N" から取る (相対 DATA.BIN open の成否)。
        const m = [...logs.join('\n').matchAll(/child exited code=(\d+)/g)];
        const lastChildCode = m.length ? +m[m.length - 1][1] : null;
        return { argv0s, lastChildCode };
    }

    let pass = 0, fail = 0;
    const check = (name, cond, extra) => {
        if (cond) { pass++; console.log(`  ok   ${name}`); }
        else      { fail++; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); }
    };

    // --- Case A: ルート depth.bat ("cd depth" + "depth")、本体 = DEPTH/DEPTH.COM (実シナリオと同型:
    //     bat のコマンド名と本体名が一致するので find が DEPTH/DEPTH.COM を解決する)。
    console.log('[Case A] root .bat "cd depth" + "depth", body in DEPTH/  (argv[0] must include subdir)');
    logs.length = 0;
    const a = runBat('cd depth\r\ndepth\r\n',
        ['depth.bat', 'DEPTH/DEPTH.COM', 'DEPTH/DATA.BIN'],
        [['DEPTH/DEPTH.COM', PROBE_COM], ['DEPTH/DATA.BIN', DATA]]);
    if (a.err) { check('ran', false, a.err); }
    else {
        check('argv[0] includes subdir (A:\\DEPTH\\DEPTH.COM)',
            a.argv0s.some((s) => /^A:\\DEPTH\\DEPTH\.COM$/.test(s)), `argv0s=${JSON.stringify(a.argv0s)}`);
        check('child opened relative DATA.BIN (exit code 0 = CWD=DEPTH honored)',
            a.lastChildCode === 0, `childCode=${a.lastChildCode}`);
    }

    // --- Case B: ルート run.bat ("run")、本体 = RUN.COM (ルート直下)。回帰: 余計な subdir 無し。
    console.log('[Case B] root .bat "run", body in root  (argv[0] must NOT gain a spurious subdir)');
    logs.length = 0;
    const b = runBat('run\r\n',
        ['run.bat', 'RUN.COM', 'DATA.BIN'],
        [['RUN.COM', PROBE_COM], ['DATA.BIN', DATA]]);
    if (b.err) { check('ran', false, b.err); }
    else {
        check('argv[0] = A:\\RUN.COM (no subdir)',
            b.argv0s.some((s) => /^A:\\RUN\.COM$/.test(s)) && !b.argv0s.some((s) => /A:\\[A-Z0-9]+\\RUN\.COM/.test(s)),
            `argv0s=${JSON.stringify(b.argv0s)}`);
        check('child opened DATA.BIN (exit code 0)', b.lastChildCode === 0, `childCode=${b.lastChildCode}`);
    }

    console.log(`\nsubdir_bat_argv0_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})();
