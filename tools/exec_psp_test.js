#!/usr/bin/env node
// EXEC/PSP 回帰テスト (2026-07-02、SimK 氏 EXECTEST で顕在化したギャップの根治確認)
// ------------------------------------------------------------------------------
// ① AH=62h/51h Get PSP: 未実装だと BX=0 のまま → 子が ES=0 (IVT) を自分の PSP と誤読し
//    command tail (0000:0080 の割り込みベクタ列) が SJIS 解釈されて画面が漢字化けする。
// ② AH=50h Set PSP: 4B01h とペアの debugger 契約。
// ③ AX=4B01h load & no-exec: 子を構築するが実行せず、パラメータブロック +0Eh..+15h に
//    初期 SP/SS/IP/CS を書き戻す。current PSP は子に切替わる (呼び出し元が 50h で戻す)。
//    COM は「AX 初期値 word」を通常の 0000 リターン word の上に積むので SP=FFFC (np21w 一致)。
// ④ COMSPEC /C: EXEC 先が COMMAND.COM で tail が "/C <cmd>" なら合成スタブ (中間プロセス)
//    経由で <cmd> を起動し、実 COMMAND.COM 同様 子の終了コードを破棄して 0 で終了する。
//    拡張子無し <cmd> の .COM 補完も踏む。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

// ---- 孫 COM: MARK.TXT に "OK" を書いて exit 5 (COMSPEC /C が code を破棄する検証用) ----
function childCom() {
  const b = [
    0xB4, 0x3C, 0x31, 0xC9,              //  0: mov ah,3Ch / xor cx,cx (create)
    0xBA, 0, 0,                          //  4: mov dx,fname (placeholder @5,6)
    0xCD, 0x21,                          //  7: int 21h
    0x72, 0,                             //  9: jc exit (placeholder @10)
    0x89, 0xC3,                          // 11: mov bx,ax
    0xB4, 0x40, 0xB9, 0x02, 0x00,        // 13: mov ah,40h / mov cx,2
    0xBA, 0, 0,                          // 18: mov dx,msg (placeholder @19,20)
    0xCD, 0x21,                          // 21: int 21h (write)
    0xB4, 0x3E, 0xCD, 0x21,              // 23: mov ah,3Eh / int 21h (close)
  ];
  const fname = 0x100 + b.length;
  for (const c of 'MARK.TXT') b.push(c.charCodeAt(0));
  b.push(0);
  const msg = 0x100 + b.length;
  for (const c of 'OK') b.push(c.charCodeAt(0));
  const exitOff = b.length;              // exit: (org 相対 0x100+exitOff)
  b.push(0xB8, 0x05, 0x4C, 0xCD, 0x21);  // mov ax,4C05h / int 21h
  b[5] = fname & 0xFF; b[6] = fname >> 8;
  b[19] = msg & 0xFF; b[20] = msg >> 8;
  b[10] = exitOff - 11;                  // jc rel8 (次命令 idx11 からの相対)
  return Uint8Array.from(b);
}

// ---- 親 COM: PSP 取得 → 自己縮小 → 4B01h → PSP 復元 → COMSPEC /C → 結果を固定番地へ ----
function parentCom() {
  // データレイアウト (org 0x100、セグメントは staged COM 固定の 0x0100 を直書き)
  const RES0 = 0x102, RES1 = 0x104, RES2 = 0x106, RES3 = 0x108;
  const RES4 = 0x10A, RES5 = 0x10C, RES6 = 0x10E, RES7 = 0x110;
  const PB1 = 0x112;                     // 22 bytes (14 + 4B01h 書き戻し 8)
  const PB2 = 0x128;                     // 14 bytes
  const PATH_CHILD = 0x136;              // "CHILD.COM\0" (10)
  const PATH_COMSPEC = 0x140;            // "A:\COMMAND.COM\0" (15)
  const TAIL1 = 0x14F;                   // [0][0D]
  const TAIL2 = 0x151;                   // [11]"/C CHILD 42"[0D] — 拡張子無し .COM 補完を踏む
  const CODE = 0x15E;
  const SEG = 0x0100;

  const img = new Uint8Array(0x300).fill(0);
  const put16 = (off, v) => { img[off - 0x100] = v & 0xFF; img[off - 0x100 + 1] = (v >> 8) & 0xFF; };
  const puts = (off, s, z) => { for (let i = 0; i < s.length; i++) img[off - 0x100 + i] = s.charCodeAt(i); if (z) img[off - 0x100 + s.length] = 0; };

  img[0] = 0xEB; img[1] = CODE - 0x102;  // jmp code
  put16(PB1 + 2, TAIL1); put16(PB1 + 4, SEG);
  put16(PB2 + 2, TAIL2); put16(PB2 + 4, SEG);
  puts(PATH_CHILD, 'CHILD.COM', true);
  puts(PATH_COMSPEC, 'A:\\COMMAND.COM', true);
  img[TAIL1 - 0x100] = 0; img[TAIL1 - 0x100 + 1] = 0x0D;
  const t2 = '/C CHILD 42';
  img[TAIL2 - 0x100] = t2.length;
  puts(TAIL2 + 1, t2, false);
  img[TAIL2 - 0x100 + 1 + t2.length] = 0x0D;

  const code = [];
  const emit = (...b) => code.push(...b);
  const e16 = (v) => emit(v & 0xFF, (v >> 8) & 0xFF);
  // R0/R1: Get PSP (62h/51h)
  emit(0xB4, 0x62, 0xCD, 0x21, 0x89, 0x1E); e16(RES0);
  emit(0xB4, 0x51, 0xCD, 0x21, 0x89, 0x1E); e16(RES1);
  // スタックを縮小域内へ → 自己縮小 0x200 para (EXEC の空きを作る)
  emit(0xFA, 0xBC, 0xFE, 0x1F, 0xFB);                      // cli / mov sp,1FFEh / sti
  emit(0xB4, 0x4A, 0xBB, 0x00, 0x02, 0xCD, 0x21);          // mov ah,4Ah / mov bx,200h / int 21h
  // ③ 4B01h load-only
  emit(0xB8, 0x01, 0x4B, 0xBA); e16(PATH_CHILD); emit(0xBB); e16(PB1); emit(0xCD, 0x21);
  emit(0x72, 0x05, 0xC6, 0x06); e16(RES2); emit(0x01);     // jc +5 / mov byte [RES2],1
  emit(0xB4, 0x62, 0xCD, 0x21, 0x89, 0x1E); e16(RES3);     // RES3 = ロード済 PSP
  emit(0x8B, 0x1E); e16(RES0);                             // mov bx,[RES0]
  emit(0xB4, 0x50, 0xCD, 0x21);                            // AH=50h 親へ復元
  emit(0xB4, 0x62, 0xCD, 0x21, 0x89, 0x1E); e16(RES4);     // RES4 = 復元後の PSP
  // 4B01 成功時のみ子 env + 子ブロックを解放 (EXECTEST と同じ後始末)
  emit(0x80, 0x3E); e16(RES2); emit(0x01);                 // cmp byte [RES2],1
  emit(0x75, 0x18);                                        // jne +24
  emit(0x8B, 0x1E); e16(RES3);                             // mov bx,[RES3]
  emit(0x8E, 0xC3);                                        // mov es,bx
  emit(0x26, 0xA1, 0x2C, 0x00);                            // mov ax,[es:2Ch]
  emit(0x8E, 0xC0);                                        // mov es,ax
  emit(0xB4, 0x49, 0xCD, 0x21);                            // free env
  emit(0x8E, 0x06); e16(RES3);                             // mov es,[RES3]
  emit(0xB4, 0x49, 0xCD, 0x21);                            // free 子ブロック
  emit(0x0E, 0x07);                                        // push cs / pop es (EXEC の ES:BX 用)
  // ④ COMSPEC /C
  emit(0xB8, 0x00, 0x4B, 0xBA); e16(PATH_COMSPEC); emit(0xBB); e16(PB2); emit(0xCD, 0x21);
  emit(0x72, 0x05, 0xC6, 0x06); e16(RES5); emit(0x01);
  emit(0xB4, 0x4D, 0xCD, 0x21, 0xA3); e16(RES6);           // RES6 = AH=4Dh (期待 0000)
  emit(0xB4, 0x62, 0xCD, 0x21, 0x89, 0x1E); e16(RES7);     // RES7 = 復帰後 PSP
  emit(0xB8, 0x00, 0x4C, 0xCD, 0x21);                      // exit 0

  img.set(Uint8Array.from(code), CODE - 0x100);
  const total = CODE - 0x100 + code.length;
  return { bin: img.slice(0, total), RES0, RES1, RES2, RES3, RES4, RES5, RES6, RES7, PB1 };
}

(async () => {
  const M = await NP2({ noInitialRun: true, print: () => {}, printErr: () => {} });
  M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
  M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
  const handle = M.ccall('np2kai_create', 'number', [], []);
  try { M.FS.mkdir('/run'); } catch (_) {}
  M.FS.writeFile('/run/CHILD.COM', childCom());
  const { bin, RES0, RES1, RES2, RES3, RES4, RES5, RES6, RES7, PB1 } = parentCom();
  M.FS.writeFile('/run/EXECPSP.COM', bin);
  const ptr = M._malloc(bin.length); M.HEAPU8.set(bin, ptr);
  const sr = M.ccall('np2kai_dos_stage_com', 'number', ['number','number','string','string'],
                     [ptr, bin.length, '', 'EXECPSP.COM']);
  M._free(ptr);
  if (sr !== 0) { console.log('stage 失敗 r=' + sr); process.exit(1); }
  M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
  M.ccall('np2kai_insert_fdd', 'number', ['number','string','number','number'], [handle, '/tmp/loader.d88', 0, 0]);
  M.ccall('np2kai_reset', null, ['number'], [handle]);
  const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = M.cwrap('np2kai_debug_peek8', 'number', ['number','number']);
  const p16 = (off) => (peek(handle, 0x1000 + off) & 0xff) | ((peek(handle, 0x1000 + off + 1) & 0xff) << 8);

  for (let f = 0; f < 3000 && !getExit(0); f++) runFrame(handle);

  const res = {
    r0: p16(RES0), r1: p16(RES1), r2: p16(RES2) & 0xff, r3: p16(RES3),
    r4: p16(RES4), r5: p16(RES5) & 0xff, r6: p16(RES6), r7: p16(RES7),
    sp: p16(PB1 + 0x0E), ss: p16(PB1 + 0x10), ip: p16(PB1 + 0x12), cs: p16(PB1 + 0x14),
  };
  let mark = '';
  try { mark = Buffer.from(M.FS.readFile('/run/MARK.TXT')).toString('latin1'); } catch (_) {}

  let ok = true;
  const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };
  const h = (v) => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
  expect(getExit(0) === 1, '親 COM が完走');
  expect(res.r0 === 0x0100, `AH=62h Get PSP = 0100 (got ${h(res.r0)})`);
  expect(res.r1 === 0x0100, `AH=51h Get PSP = 0100 (got ${h(res.r1)})`);
  expect(res.r2 === 1, `4B01h load-only が CF=0 (got flag=${res.r2})`);
  expect(res.r3 !== 0x0100 && res.r3 !== 0, `4B01h 後の current PSP = ロード済子 (got ${h(res.r3)})`);
  expect(res.cs === res.r3 && res.ip === 0x0100,
         `書き戻し CS:IP = 子PSP:0100 (got ${h(res.cs)}:${h(res.ip)})`);
  expect(res.ss === res.r3 && res.sp === 0xFFFC,
         `書き戻し SS:SP = 子PSP:FFFC — AX word 込み (got ${h(res.ss)}:${h(res.sp)})`);
  expect(res.r4 === 0x0100, `AH=50h で親 PSP へ復元 (got ${h(res.r4)})`);
  expect(res.r5 === 1, `EXEC A:\\COMMAND.COM /C が CF=0 (got flag=${res.r5})`);
  expect(mark === 'OK', `孫 CHILD.COM が実行された — MARK.TXT="OK" (got "${mark}")`);
  expect(res.r6 === 0x0000, `AH=4Dh = 0000 (/C は孫の exit 5 を破棄) (got ${h(res.r6)})`);
  expect(res.r7 === 0x0100, `COMSPEC 復帰後の current PSP = 親 (got ${h(res.r7)})`);
  console.log(ok ? 'PASS: AH=50h/51h/62h + 4B01h load-only + COMSPEC /C スタブ'
                 : 'FAIL: EXEC/PSP 回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
