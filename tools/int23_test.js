#!/usr/bin/env node
// INT 23h (Ctrl-C ハンドラ) 発火の回帰テスト (2026-07-05)
// ------------------------------------------------------------------------------
// Stosstruppe 氏の X 投稿 (fig5.c / fig5.asm) で指摘された「INT 23h 未サポート」の根治確認。
// 実 DOS の契約: cooked コンソール入力 (AH=01/08/0Ah/0Bh/3Fh handle 0) が ^C (03h) を
// 見たら INT 23h を発火する。既定ハンドラ = プログラム中断。ユーザーハンドラ
// (AX=2523h) は IRET 復帰で呼び出し再開、far RET 復帰は CF=1 なら中断・CF=0 なら再開。
// 終了時は PSP+0Eh から IVT[0x23] を復元する (差し替えたハンドラを残さない)。
//   T1: 既定中断 (AH=01h ループ + ^C → exit、"^C" エコー)
//   T2: fig5.asm 同型 (ハンドラが "hoge" を出して IRET → 継続、ESC で exit 7、ベクタ復元)
//   T3: far RET + CF=1 (stc; retf) → 中断
//   T4: far RET + CF=0 (clc; retf) → 再開、ESC で exit 7
//   T5: AH=0Bh ポーリングループ + ^C → 中断 (状態問い合わせでも発火する)
//   T6: AH=3Fh handle 0 cooked 行入力の途中 ^C → 中断
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

let ok = true;
const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

// 1 インスタンス起動 → COM を stage → boot (stdin_cx1_test.js と同型ハーネス)
async function boot(comBin) {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/T.COM', comBin);
  const ptr = M._malloc(comBin.length); M.HEAPU8.set(comBin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, comBin.length, '', 'T.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const codePtr = M._malloc(4);
  const getExit = () => M.ccall('np2kai_dos_get_exit', 'number', ['number'], [codePtr]);
  const exitCode = () => M.HEAP32[codePtr >> 2];
  const peek = (a) => M.ccall('np2kai_debug_peek8', 'number', ['number','number'], [handle, a]) & 0xff;
  const inject = (bytes) => { const p = M._malloc(bytes.length);
    M.HEAPU8.set(Uint8Array.from(bytes), p);
    M.ccall('np2kai_inject_text', null, ['number','number','number'], [handle, p, bytes.length]); M._free(p); };
  // テキスト VRAM (0xA0000、2 byte/セル) に ANK 文字列 s があるか
  const vramHas = (s) => {
    const want = [];
    for (const ch of s) { want.push(ch.charCodeAt(0)); want.push(0); }
    const buf = [];
    for (let i = 0; i < 80 * 25 * 2; i++) buf.push(peek(0xA0000 + i));
    outer: for (let i = 0; i + want.length <= buf.length; i += 2) {
      for (let j = 0; j < want.length; j++) if (buf[i + j] !== want[j]) continue outer;
      return true;
    }
    return false;
  };
  const run = (frames) => { for (let f = 0; f < frames && !getExit(); f++) runFrame(handle); };
  for (let f = 0; f < 200; f++) runFrame(handle);   // boot 進行
  return { handle, run, getExit, exitCode, peek, inject, vramHas };
}

// ---- COM ビルダ ----
// 共通骨格: AH=01h ループ (ESC=1Bh で AX=4C07h exit)。fig1/fig5.lst の実バイト列と同じ。
function comGetchLoop() {
  return [
    0xB4, 0x01,             // 0100 mov ah,01h
    0xCD, 0x21,             // 0102 int 21h
    0x3C, 0x1B,             // 0104 cmp al,1Bh
    0x75, 0xF8,             // 0106 jne 0100
    0xB8, 0x07, 0x4C,       // 0108 mov ax,4C07h
    0xCD, 0x21,             // 010B int 21h
  ];
}

// fig5.asm 同型: AX=2523h でハンドラ登録 + AH=01h ループ。handlerBytes を 0115h に置く。
function comWithHandler(handlerBytes) {
  const b = [
    0xBA, 0x15, 0x01,       // 0100 mov dx,0115h (ctrl_c)
    0xB8, 0x23, 0x25,       // 0103 mov ax,2523h
    0xCD, 0x21,             // 0106 int 21h
    0xB4, 0x01,             // 0108 mov ah,01h
    0xCD, 0x21,             // 010A int 21h
    0x3C, 0x1B,             // 010C cmp al,1Bh
    0x75, 0xF8,             // 010E jne 0108
    0xB8, 0x07, 0x4C,       // 0110 mov ax,4C07h
    0xCD, 0x21,             // 0113 int 21h
  ];
  b.push(...handlerBytes);  // 0115 ctrl_c:
  return b;
}

(async () => {
  // ===== T1: 既定ハンドラ = プログラム中断 =====
  {
    const t = await boot(Uint8Array.from(comGetchLoop()));
    t.inject([0x41]);                             // 'A' → 通常入力 (継続)
    t.run(300);
    expect(t.getExit() === 0, 'T1: ^C 前は終了しない');
    t.inject([0x03]);                             // ^C
    t.run(300);
    expect(t.getExit() === 1 && t.exitCode() === 0,
           `T1: ^C で既定中断 (exit=1 code=0) (got exit=${t.getExit()} code=${t.exitCode()})`);
    expect(t.vramHas('^C'), 'T1: "^C" がエコーされる');
  }

  // ===== T2: fig5.asm 同型 — ハンドラが "hoge" を出して IRET → 呼び出し再開 =====
  {
    // 0115: pusha / mov dx,011Fh / mov ah,09h / int 21h / popa / iret、011F: 'hoge',CR,LF,'$'
    const handler = [
      0x60,                   // 0115 pusha
      0xBA, 0x1F, 0x01,       // 0116 mov dx,011Fh (msg)
      0xB4, 0x09,             // 0119 mov ah,09h
      0xCD, 0x21,             // 011B int 21h
      0x61,                   // 011D popa
      0xCF,                   // 011E iret
      0x68, 0x6F, 0x67, 0x65, 0x0D, 0x0A, 0x24,   // 011F 'hoge',CR,LF,'$'
    ];
    const t = await boot(Uint8Array.from(comWithHandler(handler)));
    t.inject([0x03]);                             // ^C → ハンドラ → IRET → 入力待ち再開
    t.run(300);
    expect(t.getExit() === 0, 'T2: ハンドラ IRET 後もプログラム継続');
    expect(t.vramHas('hoge'), 'T2: ハンドラの "hoge" が表示される');
    t.inject([0x03]);                             // 2 発目も同様 (再発火できる)
    t.run(300);
    expect(t.getExit() === 0, 'T2: 2 発目の ^C でも継続');
    t.inject([0x41, 0x1B]);                       // 'A' (再開後の通常入力) → ESC で終了
    t.run(300);
    expect(t.getExit() === 1 && t.exitCode() === 7,
           `T2: ESC で exit 7 (got exit=${t.getExit()} code=${t.exitCode()})`);
    const vec = [t.peek(0x8C), t.peek(0x8D), t.peek(0x8E), t.peek(0x8F)];
    expect(vec[0] === 0x20 && vec[1] === 0xEE && vec[2] === 0x00 && vec[3] === 0xF0,
           `T2: 終了後 IVT[0x23] が既定 (F000:EE20) へ復元 (got ${vec.map(x => x.toString(16)).join(' ')})`);
  }

  // ===== T3: far RET + CF=1 → 中断 =====
  {
    const t = await boot(Uint8Array.from(comWithHandler([0xF9, 0xCB])));   // stc; retf
    t.inject([0x03]);
    t.run(300);
    expect(t.getExit() === 1 && t.exitCode() === 0,
           `T3: far RET CF=1 で中断 (got exit=${t.getExit()} code=${t.exitCode()})`);
  }

  // ===== T4: far RET + CF=0 → 再開 =====
  {
    const t = await boot(Uint8Array.from(comWithHandler([0xF8, 0xCB])));   // clc; retf
    t.inject([0x03]);
    t.run(300);
    expect(t.getExit() === 0, 'T4: far RET CF=0 で継続');
    t.inject([0x1B]);
    t.run(300);
    expect(t.getExit() === 1 && t.exitCode() === 7,
           `T4: 継続後 ESC で exit 7 (got exit=${t.getExit()} code=${t.exitCode()})`);
  }

  // ===== T5: AH=0Bh ポーリングでも ^C を発火 =====
  {
    const bin = Uint8Array.from([
      0xB4, 0x0B,             // 0100 mov ah,0Bh
      0xCD, 0x21,             // 0102 int 21h
      0xEB, 0xFA,             // 0104 jmp 0100
    ]);
    const t = await boot(bin);
    t.run(120);
    expect(t.getExit() === 0, 'T5: ^C 前はポーリングループ継続');
    t.inject([0x03]);
    t.run(300);
    expect(t.getExit() === 1 && t.exitCode() === 0,
           `T5: AH=0Bh ポーリング中の ^C で中断 (got exit=${t.getExit()} code=${t.exitCode()})`);
  }

  // ===== T6: AH=3Fh handle 0 cooked 行入力の途中 ^C → 中断 =====
  {
    const bin = Uint8Array.from([
      0xB4, 0x3F,             // 0100 mov ah,3Fh
      0xBB, 0x00, 0x00,       // 0102 mov bx,0
      0xB9, 0x40, 0x00,       // 0105 mov cx,64
      0xBA, 0x20, 0x01,       // 0108 mov dx,0120h
      0xCD, 0x21,             // 010B int 21h
      0xB8, 0x05, 0x4C,       // 010D mov ax,4C05h
      0xCD, 0x21,             // 0110 int 21h
    ]);
    const t = await boot(bin);
    t.inject([0x41, 0x42, 0x03]);                 // "AB" + ^C (Enter 前)
    t.run(300);
    expect(t.getExit() === 1 && t.exitCode() === 0,
           `T6: 3Fh cooked 行入力途中の ^C で中断 (exit code 5 でない) (got exit=${t.getExit()} code=${t.exitCode()})`);
  }

  console.log(ok ? '\nint23_test: ALL PASS' : '\nint23_test: FAILED');
  process.exit(ok ? 0 : 1);
})();
