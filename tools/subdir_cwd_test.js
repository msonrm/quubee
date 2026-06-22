#!/usr/bin/env node
// subdir_cwd_test.js — サブディレクトリに在る image を直接起動したとき、起動時カレント
// ディレクトリ (g_cwd) がその場所に設定されることの headless 回帰。
//
// 背景: Super Depth のように「自分のデータファイルを相対パスで開く」ゲームを書庫内の
// サブディレクトリ (例 A:\SDEPTH\) に置いて直接起動すると、CWD がルートのままだと
// データが見つからず起動できなかった。loader-start が image のディレクトリを起動時 CWD に
// 合わせる修正 (案A) を検証する。
//
// テスト COM: INT 21h AH=3Dh で相対パス "DATA.BIN" を open し、成功なら exit 0 / 失敗なら
// exit 1 して終わる。CWD がデータと同じディレクトリに設定されていれば open 成功 = exit 0。
//
// 使い方: node tools/subdir_cwd_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// 相対 "DATA.BIN" を open → 成功 exit0 / 失敗 exit1 する最小 COM (CS:0x100 ロード)。
const PROBE_COM = new Uint8Array([
    0xB4, 0x3D,             // mov ah, 0x3D   ; open existing
    0xB0, 0x00,             // mov al, 0x00   ; read access
    0xBA, 0x15, 0x01,       // mov dx, 0x0115 ; DS:DX -> "DATA.BIN"
    0xCD, 0x21,             // int 0x21
    0x72, 0x05,             // jc  fail (-> 0x110)
    0xB8, 0x00, 0x4C,       // mov ax, 0x4C00 ; success: exit 0
    0xCD, 0x21,             // int 0x21
    0xB8, 0x01, 0x4C,       // mov ax, 0x4C01 ; fail: exit 1
    0xCD, 0x21,             // int 0x21
    0x44, 0x41, 0x54, 0x41, 0x2E, 0x42, 0x49, 0x4E, 0x00,  // "DATA.BIN\0" at 0x115
]);
const DATA = new Uint8Array([0x4F, 0x4B]);  // 中身は何でもよい (open できるかだけ見る)

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

    const stageCom = M.cwrap('np2kai_dos_stage_com', 'number', ['number', 'number', 'string', 'string']);
    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const peek8    = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);

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

    // 1 ケース実行: /run をクリア → ファイル配置 → COM を stage (name=フルパス) → loader 起動 →
    // exit を読む。argv[0] 検証用に conventional RAM も走査する。
    function runCase(comRel, dataRel, stageName) {
        try { for (const e of M.FS.readdir('/run')) if (e !== '.' && e !== '..') rmrf('/run/' + e); } catch (_) {}
        writeRun(comRel, PROBE_COM);
        writeRun(dataRel, DATA);
        const ptr = M._malloc(PROBE_COM.length); M.HEAPU8.set(PROBE_COM, ptr);
        const r = stageCom(ptr, PROBE_COM.length, '', stageName);
        M._free(ptr);
        if (r !== 0) throw new Error(`stage_com failed r=${r} (name=${stageName})`);
        M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
            [handle, '/tmp/loader.d88', 0, 0]);
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        // POST→IPL(loader.d88)→loader-start→COM 実行→exit まで進める。
        let exited = 0, code = -1;
        const p = M._malloc(4);
        for (let i = 0; i < 2000; i++) {
            runFrame(handle);
            if (getExit(p)) { exited = 1; code = M.getValue(p, 'i32'); break; }
        }
        M._free(p);
        // argv[0] 文字列を conventional RAM から探す (build_env が env セグメント 0x00F0 = linear
        // 0xF00 に書く)。env は load seg の下なので 0xF00 から走査する。
        const LO = 0xF00, HI = 0x41000;
        const buf = Buffer.alloc(HI - LO);
        for (let a = LO; a < HI; a++) buf[a - LO] = peek8(handle, a) & 0xff;
        const ram = buf.toString('latin1');
        return { exited, code, ram };
    }

    let pass = 0, fail = 0;
    const check = (name, cond, extra) => {
        if (cond) { pass++; console.log(`  ok   ${name}`); }
        else      { fail++; console.log(`  FAIL ${name}${extra ? '  ' + extra : ''}`); }
    };

    // --- Case A: サブディレクトリ起動 (修正の本丸)。CWD=SDEPTH なら相対 DATA.BIN を開ける。
    console.log('[Case A] subdir launch  A:\\SDEPTH\\PROG.COM  (data in SDEPTH)');
    const a = runCase('SDEPTH/PROG.COM', 'SDEPTH/DATA.BIN', 'SDEPTH/PROG.COM');
    check('exited', a.exited, `exited=${a.exited}`);
    check('open succeeded (exit code 0 = CWD set to SDEPTH)', a.code === 0, `code=${a.code}`);
    check('argv[0] includes subdir (A:\\SDEPTH\\PROG.COM)', a.ram.includes('A:\\SDEPTH\\PROG.COM'));

    // --- Case B: ルート直下起動 (回帰なし)。CWD=ルートで /run 直下のデータを開ける。
    console.log('[Case B] root launch    A:\\PROG.COM        (data in root)');
    const b = runCase('PROG.COM', 'DATA.BIN', 'PROG.COM');
    check('exited', b.exited, `exited=${b.exited}`);
    check('open succeeded (exit code 0)', b.code === 0, `code=${b.code}`);
    check('argv[0] = A:\\PROG.COM (no spurious subdir)', b.ram.includes('A:\\PROG.COM') && !b.ram.includes('A:\\\\PROG.COM'));

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
