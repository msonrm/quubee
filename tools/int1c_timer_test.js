#!/usr/bin/env node
// INT 1Ch 単発タイマ (タイマ BIOS) と「DOS 内割り込み窓」の回帰テスト (2026-07-06)
// ------------------------------------------------------------------------------
// SimK 氏報告: sol110 (DOS 版ソリティア) がカードを中途半端な場所へ動かすとフリーズ、
// -T (タイマ割り込み不使用) なら OK。真因は HLE INT 21h が C で原子的に処理して即 IRET
// するため、実 MS-DOS ディスパッチャの入口 CLD; STI が作っていた「DOS コール中だけ
// 係属 IRQ が配送される窓」が消えていたこと。CLI したまま (Borland disable() 系) INT 21h
// をポーリングして INT 1Ch 単発タイマの tick を待つプログラムは、1 tick も受け取れず
// 永久ループする。修正 = INT 21h トランポリンを NOP; STI; CLD; IRET にして IRET 直前に
// 配送点を 1 回開く (dos_loader.c put_trampoline_sti)。
//   T1: 単発発火 — AH=02h CX=5 で arm、callback が flag を立てるまで poll (IF=1 開始)
//   T2: 自己再アーム — callback 内から AH=02h CX=1 で再 arm ×50 (周期タイマ化, SOL 同型)
//   T3: SOL フリーズ再現 — CLI したまま INT 21h AH=0Bh を poll しつつ tick×30 を待つ。
//       DOS 窓が無いと永久ループ。窓が IF を呼び出し元へ漏らさないことも同時に検査
//       (漏れたら exit 2)。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

let ok = true;
const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

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
  const run = (frames) => { let f = 0; for (; f < frames && !getExit(); f++) runFrame(handle); return f; };
  return { run, getExit, exitCode };
}

// ---- テスト COM (nasm で確定させた実バイト列。asm はコメントの通り) ----

// T1: 単発発火 (sti 無し = ローダの初期 IF=1 のまま)
//   0100 push cs / pop es            0E 07
//   0102 mov bx,0120h (cb)           BB 20 01
//   0105 mov cx,5                    B9 05 00
//   0108 mov ah,02h / int 1Ch        B4 02 CD 1C
//   010C nop                         90
//   010D poll: cmp byte [0127h],0    80 3E 27 01 00
//   0112 je 010D                     74 F9
//   0114 mov dx,0128h / mov ah,09h / int 21h   BA 28 01 B4 09 CD 21
//   011B mov ax,4C00h / int 21h      B8 00 4C CD 21
//   0120 cb: mov byte [cs:0127h],1   2E C6 06 27 01 01
//   0126 iret                        CF
//   0127 flag: db 0 / 0128 'FIRED$'
const T1 = '0e07bb2001b90500b402cd1c90803e27010074f9ba2801b409cd21b8004ccd212ec606270101cf00464952454424';

// T2: 自己再アーム ×50 (callback 内から AH=02h CX=1 → 周期タイマ化)
//   0100 push cs / pop es / mov bx,0119h / mov cx,1 / mov ah,02h / int 1Ch / sti
//   010D poll: cmp word [0133h],50 / jb poll
//   0113 mov ax,4C00h / int 21h
//   0119 cb: push ax/bx/cx/es / inc word [cs:0133h] / push cs / pop es /
//        mov bx,0119h / mov cx,1 / mov ah,02h / int 1Ch / pop es/cx/bx/ax / iret
//   0133 ticks: dw 0
const T2 = '0e07bb1901b90100b402cd1cfb833e33013272f9b8004ccd21505351062eff0633010e07bb1901b90100b402cd1c07595b58cf0000';

// T3: SOL (sol110) 同型 — CLI + INT 21h AH=0Bh ポーリング + 自己再アーム ×30
//   0100 cli                                        FA
//   0101 push cs / pop es / mov bx,0129h / mov cx,1 / mov ah,02h / int 1Ch
//   010D poll: mov ah,0Bh / int 21h                 B4 0B CD 21
//   0111 cmp word [0143h],30 / jb poll              83 3E 43 01 1E 72 F5
//   0118 pushf / pop dx / test dh,2 / jz okexit     9C 5A F6 C6 02 74 05
//   011F mov ax,4C02h / int 21h  (IF 漏れ → exit 2)
//   0124 okexit: mov ax,4C00h / int 21h
//   0129 cb: push ax/bx/cx/es / inc word [cs:0143h] / push cs / pop es /
//        mov bx,0129h / mov cx,1 / mov ah,02h / int 1Ch / pop es/cx/bx/ax / iret
//   0143 ticks: dw 0
const T3 = 'fa0e07bb2901b90100b402cd1cb40bcd21833e43011e72f59c5af6c6027405b8024ccd21b8004ccd21505351062eff0643010e07bb2901b90100b402cd1c07595b58cf0000';

const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));

(async () => {
  {
    const t = await boot(hex(T1));
    t.run(600);
    expect(t.getExit() === 1 && t.exitCode() === 0,
           `T1: 単発タイマ発火 (exit=${t.getExit()} code=${t.exitCode()})`);
  }
  {
    const t = await boot(hex(T2));
    t.run(600);   // 50 tick × 10ms = 500ms ≈ 30 フレーム
    expect(t.getExit() === 1 && t.exitCode() === 0,
           `T2: 自己再アーム周期タイマ ×50 (exit=${t.getExit()} code=${t.exitCode()})`);
  }
  {
    const t = await boot(hex(T3));
    t.run(600);   // 30 tick。窓が無いと永久ループでここに到達しない
    expect(t.getExit() === 1 && t.exitCode() === 0,
           `T3: CLI + INT 21h ポーリングでも tick が届く (DOS 内割り込み窓)、IF 漏れなし ` +
           `(exit=${t.getExit()} code=${t.exitCode()}${t.exitCode() === 2 ? ' = IF 漏れ' : ''})`);
  }
  console.log(ok ? 'ALL OK' : 'SOME FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
