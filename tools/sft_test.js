#!/usr/bin/env node
// 合成 SFT (System File Table) の headless 検証 (2026-06-11)。
//
// 背景: AH=52h List of Lists の [+4] (first SFT) を旧実装は FFFF:FFFF「無し」マーカに
// していたが、実機の SFT walker (PMD86.COM の install-check 等) は先頭ポインタを
// 終端チェックなしで follow し、offset==FFFF の終端判定は 2 ブロック目以降にしか
// 掛けない。結果 FFFF セグメント先のゴミ count/next を辿る無限走査になり得る
// (TH03 夢時空 GAME.BAT の pmd86 ハングの真因)。
// 修正 = 正規終端された合成 SFT ブロック (DOS 5 形式: ヘッダ 6B + 8 エントリ × 0x3B、
// FCB 名 +0x20 / file size +0x11) を QB_SFT_SEG:0000 に常設し、loader-start / EXEC の
// たびに「直近ロードしたファイルの stale エントリ」(実 DOS が EXEC の open→close 後に
// 残すもの) を書く。PMD86 は名前発見後に +0x11 のサイズで自イメージ末尾シグネチャを
// 照合するため、サイズの正しさまで本テストで検証する。
//
// 合成 COM (nasm 生成、ソース = このリポジトリの履歴 /tmp/sft_walk.asm 相当をコメントで
// 保持) が pmd86 と同型の走査を行う:
//   1) AH=52h → LoL、LoL[+4] を無条件 follow (pmd86 と同じ「先頭は終端チェックなし」)
//   2) 各ブロック: +4 の count 個のエントリ (+6 から 0x3B 刻み) の FCB 名 (+0x20) を
//      自分の名前 "SFTTEST COM" と REPE CMPSB 比較
//   3) 見つかれば entry+0x11 の file size を DS:0082 (dword) へ、DS:0080=0xAA
//   4) next.off==FFFF の終端まで無ければ DS:0080=0x02
//   5) AH=4Ch 終了
// 判定: DS:0080==0xAA (= 走査が終端し、自分の stale エントリを発見) かつ
//       DS:0082 dword == COM の実バイト数 (= pmd86 のサイズ整合チェックが通る形)。
// 旧実装ではゴミ走査でハング → フレーム上限到達で FAIL する (判別力あり)。
//
// 使い方: node tools/sft_test.js

const path = require('path');
const fs   = require('fs');

const WEB    = path.join(__dirname, '..', 'web');
const FONT   = path.join(WEB, 'assets', 'font.bmp');
const LOADER = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
if (!fs.existsSync(FONT))   skip('font.bmp 不在');

// nasm 生成 COM (上記コメントの走査ロジック)。
const COM = Uint8Array.from([
    0xb4, 0x52, 0xcd, 0x21, 0x26, 0xc4, 0x5f, 0x04, 0x26, 0x8b, 0x07, 0x26,
    0x8b, 0x57, 0x02, 0x26, 0x8b, 0x4f, 0x04, 0x83, 0xc3, 0x06, 0xe3, 0x14,
    0x51, 0x8d, 0x7f, 0x20, 0xbe, 0x56, 0x01, 0xb9, 0x0b, 0x00, 0xf3, 0xa6,
    0x59, 0x74, 0x10, 0x83, 0xc3, 0x3b, 0xe2, 0xea, 0x83, 0xf8, 0xff, 0x74,
    0x1b, 0x8e, 0xc2, 0x89, 0xc3, 0xeb, 0xd1, 0x26, 0x8b, 0x47, 0x11, 0xa3,
    0x82, 0x00, 0x26, 0x8b, 0x47, 0x13, 0xa3, 0x84, 0x00, 0xc6, 0x06, 0x80,
    0x00, 0xaa, 0xeb, 0x05, 0xc6, 0x06, 0x80, 0x00, 0x02, 0xb8, 0x00, 0x4c,
    0xcd, 0x21, 0x53, 0x46, 0x54, 0x54, 0x45, 0x53, 0x54, 0x20, 0x43, 0x4f,
    0x4d,
]);

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    const handle = M.ccall('np2kai_create', 'number', [], []);

    const ptr = M._malloc(COM.length);
    M.HEAPU8.set(COM, ptr);
    const r = M.ccall('np2kai_dos_stage_com', 'number',
        ['number', 'number', 'string', 'string'], [ptr, COM.length, '', 'SFTTEST.COM']);
    M._free(ptr);
    if (r !== 0) { console.log('FAIL — stage_com r=' + r); process.exit(1); }

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit  = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const pk       = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);

    let exited = 0;
    for (let f = 0; f < 1200; f++) {           // 旧実装はここでハング (= 上限到達で FAIL)
        runFrame(handle);
        if (getExit(0)) { exited = 1; break; }
    }

    // COM は PSP=0x0100 にロードされる → DS:0080 = linear 0x1080
    const flag = pk(handle, 0x1080);
    const size = pk(handle, 0x1082) | (pk(handle, 0x1083) << 8)
               | (pk(handle, 0x1084) << 16) | (pk(handle, 0x1085) << 24);
    console.log(`exited=${exited} flag=0x${flag.toString(16)} sft_size=${size} com_size=${COM.length}`);

    if (!exited) { console.log('FAIL — SFT 走査が終端しない (旧 FFFF:FFFF 症状 = pmd86 ハング)'); process.exit(1); }
    if (flag !== 0xAA) { console.log('FAIL — 自分の stale エントリが SFT に無い (flag=0x' + flag.toString(16) + ')'); process.exit(1); }
    if (size !== COM.length) { console.log('FAIL — SFT エントリの file size が実バイト数と不一致'); process.exit(1); }
    console.log('PASS — SFT チェーンが正規終端し、直近ロードの stale エントリ (名前+実サイズ) を発見 (pmd86 install-check 同型)');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
