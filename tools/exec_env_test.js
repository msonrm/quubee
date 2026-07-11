#!/usr/bin/env node
// exec_env_test.js — C1 (per-child env で argv[0] 正規化) の headless 検証。
// ミニ COMMAND.COM (stage_batch) が子 HELLO.COM を AH=4Bh EXEC する経路を走らせ、
// build_child_env が子固有 env に "A:\HELLO.COM" を argv[0] として書くことを確認する。
// env は子終了で free されるがバイトは上書きまで残るので、conventional RAM を走査して
// 文字列の有無で判定する (生きている間に捕まえる必要がない)。
// 使い方: node tools/exec_env_test.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

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

    // 子 HELLO.COM を /run/ に置く (ミニ COMMAND.COM が EXEC する)
    try { M.FS.mkdir('/run'); } catch (_) {}
    const hello = new Uint8Array(fs.readFileSync(path.join(ROOT, 'tools/dos_loader/hello.com')));
    M.FS.writeFile('/run/HELLO.COM', hello);

    // 1 文スクリプト = HELLO.COM を実行。シェル(親)が子をEXEC → build_child_env が走る
    const script = 'C\tHELLO.COM\r\n';
    const r = M.ccall('np2kai_dos_stage_batch', 'number',
        ['string', 'number', 'string'], [script, script.length, 'test']);
    console.log('stage_batch r =', r);

    // Run フロー (bridge.js runStaged 相当): loader.d88 を A: に挿入 + reset → boot sector が
    // ローダトランポリン (0xFEE00) へ far jmp → loader-start が staged image を起動する。
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const peek8 = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    // POST→IPL(loader.d88)→shell→子EXEC まで進めるのに ~1k フレーム要る (ヘッドレス POST は重い)。
    for (let i = 0; i < 1200; i++) runFrame(handle);

    // conventional RAM (0x1000..0x60000) を走査して argv[0] 文字列を探す
    const scan = (lo, hi) => {
        const buf = Buffer.alloc(hi - lo);
        for (let a = lo; a < hi; a++) buf[a - lo] = peek8(handle, a) & 0xff;
        const s = buf.toString('latin1');
        return s;
    };
    const mem = scan(0x1000, 0x60000);
    const childPath = mem.includes('A:\\HELLO.COM');        // build_child_env の期待出力 (子の argv[0])
    const execLog   = logs.find(l => /\[int21h\/4B\] EXEC child=HELLO\.COM/.test(l)) || '';
    const inherited = / env=0000 /.test(execLog);           // env_seg=0 (継承) = build_child_env が走る経路
    const resumed   = logs.some(l => /child exited code=0 → 親 PSP=0100/.test(l));  // 親復帰 = EXEC 機構の回帰なし

    console.log('EXEC log         :', execLog.trim() || '(なし)');
    console.log('inherit env(=0)  :', inherited);
    console.log('parent resumed   :', resumed);
    console.log('argv[0] A:\\HELLO.COM in child env :', childPath);

    if (childPath && inherited && resumed) {
        console.log('PASS — 継承 EXEC で子固有 env に子自身の argv[0] が書かれ、親も正常復帰 (C1 解消・回帰なし)');
        process.exit(0);
    }
    console.log('FAIL — 期待 (childPath && inherited && resumed) を満たさず');
    logs.forEach(l => console.log('  ' + l));
    process.exit(1);
})();
