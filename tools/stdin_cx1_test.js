#!/usr/bin/env node
// AH=3Fh handle 0 (STDIN) cooked 行入力 — CX=1 ブロッキング + 行持ち越し + SJIS BS 回帰テスト (2026-07-02)
// ------------------------------------------------------------------------------
// takapyu 氏実機指摘: cooked では CX に関わらず Enter が押されるまで戻らない。旧実装は
// CX<2 を 0 バイト即返ししており「文字入力が無いのに戻ってくる」退行だった。
// 実 DOS は行が CX より長ければ CX バイトだけ返して残りを持ち越し、次の read が
// 待たずに続きを受け取る (getchar のような 1 バイト読みは行を 1 バイトずつ配る形)。
// 併せて BS 行編集の SJIS 判定: 末尾近傍バイトのリード範囲判定はトレイル (0x40-0xFC) が
// リード範囲と重なり誤爆する (「画」89 E6 + 'a' の BS が 2 バイト消しになり孤立リード残留)。
// 行頭からのパリティ走査 (line_last_char_len) に修正。AH=0Ah の BS も同じヘルパで統一。
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'web/assets/font.bmp');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const NP2 = require(path.join(ROOT, 'web/np2kai_core.js'));

let ok = true;
const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) ok = false; };

// 1 インスタンス起動 → COM を stage → boot。inject/runFrame/peek を返す共通ハーネス。
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
  const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
  const peek = (a) => M.ccall('np2kai_debug_peek8', 'number', ['number','number'], [handle, a]) & 0xff;
  const inject = (bytes) => { const p = M._malloc(bytes.length);
    M.HEAPU8.set(Uint8Array.from(bytes), p);
    M.ccall('np2kai_inject_text', null, ['number','number','number'], [handle, p, bytes.length]); M._free(p); };
  for (let f = 0; f < 200; f++) runFrame(handle);   // boot 進行
  return { handle, runFrame, getExit, peek, inject };
}

// ---- COM 1: AH=3Fh CX=1 を 4 連続 (1 バイト読み × 4)。各 AX を cnt スロットへ ----
function comCx1() {
  const b = [];
  const reads = 4;
  const codeLen = reads * 16 + 4;                 // 16 bytes/read + exit 4
  const bufOff = 0x100 + codeLen;                 // buf: 1 byte × 4
  const cntOff = bufOff + reads;                  // cnt: 2 bytes × 4 (sentinel 0xEE)
  for (let i = 0; i < reads; i++) {
    const dx = bufOff + i, a3 = cntOff + i * 2;
    b.push(0xB4, 0x3F,                            // mov ah,3Fh
           0xBB, 0x00, 0x00,                      // mov bx,0
           0xB9, 0x01, 0x00,                      // mov cx,1
           0xBA, dx & 0xFF, (dx >> 8) & 0xFF,     // mov dx,buf+i
           0xCD, 0x21,                            // int 21h
           0xA3, a3 & 0xFF, (a3 >> 8) & 0xFF);    // mov [cnt+i*2],ax
  }
  b.push(0xB4, 0x4C, 0xCD, 0x21);                 // mov ah,4Ch ; int 21h
  for (let i = 0; i < reads; i++) b.push(0x00);   // buf
  for (let i = 0; i < reads * 2; i++) b.push(0xEE); // cnt sentinel
  return { bin: Uint8Array.from(b), bufLin: 0x1000 + bufOff, cntLin: 0x1000 + cntOff };
}

// ---- COM 2: AH=3Fh CX=64 単発 (stdin_read_test と同型、SJIS BS 注入用) ----
function comRead64() {
  const head = [
    0xB4, 0x3F, 0xBB, 0x00, 0x00, 0xB9, 0x40, 0x00,
    0xBA, 0, 0, 0xCD, 0x21, 0xA3, 0, 0,
    0xB4, 0x4C, 0xCD, 0x21,
  ];
  const bufOff = 0x100 + head.length, countOff = bufOff + 64;
  head[9] = bufOff & 0xFF; head[10] = (bufOff >> 8) & 0xFF;
  head[14] = countOff & 0xFF; head[15] = (countOff >> 8) & 0xFF;
  const b = head.slice();
  for (let i = 0; i < 64 + 2; i++) b.push(0);
  return { bin: Uint8Array.from(b), bufLin: 0x1000 + bufOff, countLin: 0x1000 + countOff };
}

// ---- COM 4: raw モード (takapyu 氏 RAWMODE.COM と同じ IOCTL シーケンスの合成版) ----
// AX=4400h get → DL|=20h, DH=0 → AX=4401h set (raw) → AX=4400h get (bit5 反映確認) →
// AH=3Fh CX=1 read × 2 (raw は Enter 不要で 1 キーごとに即返る) → exit
function comRaw() {
  const code = [
    0xB8, 0x00, 0x44,       // mov ax,4400h (Get Device Info)
    0xBB, 0x00, 0x00,       // mov bx,0 (STDIN)
    0xCD, 0x21,
    0x80, 0xCA, 0x20,       // or dl,20h (bit5 = raw)
    0x30, 0xF6,             // xor dh,dh (実 DOS: DH は 0 必須)
    0xB8, 0x01, 0x44,       // mov ax,4401h (Set Device Info)
    0xCD, 0x21,
    0xB8, 0x00, 0x44,       // mov ax,4400h (再取得 — bit5 が反映されるか)
    0xCD, 0x21,
    0x89, 0x16, 0, 0,       // mov [dxsave],dx (placeholder @25,26)
    0xB4, 0x3F,             // mov ah,3Fh
    0xB9, 0x01, 0x00,       // mov cx,1
    0xBA, 0, 0,             // mov dx,buf0 (placeholder @33,34)
    0xCD, 0x21,
    0xA3, 0, 0,             // mov [cnt0],ax (placeholder @38,39)
    0xB4, 0x3F,
    0xB9, 0x01, 0x00,
    0xBA, 0, 0,             // mov dx,buf1 (placeholder @46,47)
    0xCD, 0x21,
    0xA3, 0, 0,             // mov [cnt1],ax (placeholder @51,52)
    0xB4, 0x4C, 0xCD, 0x21, // exit
  ];
  const dxsaveOff = 0x100 + code.length, buf0Off = dxsaveOff + 2, buf1Off = buf0Off + 1,
        cnt0Off = buf1Off + 1, cnt1Off = cnt0Off + 2;
  code[25] = dxsaveOff & 0xFF; code[26] = (dxsaveOff >> 8) & 0xFF;
  code[33] = buf0Off & 0xFF;   code[34] = (buf0Off >> 8) & 0xFF;
  code[38] = cnt0Off & 0xFF;   code[39] = (cnt0Off >> 8) & 0xFF;
  code[46] = buf1Off & 0xFF;   code[47] = (buf1Off >> 8) & 0xFF;
  code[51] = cnt1Off & 0xFF;   code[52] = (cnt1Off >> 8) & 0xFF;
  const b = code.slice();
  b.push(0xEE, 0xEE);          // dxsave sentinel
  b.push(0x00, 0x00);          // buf0, buf1
  b.push(0xEE, 0xEE, 0xEE, 0xEE); // cnt0, cnt1 sentinel
  return { bin: Uint8Array.from(b), dxsaveLin: 0x1000 + dxsaveOff, buf0Lin: 0x1000 + buf0Off,
           buf1Lin: 0x1000 + buf1Off, cnt0Lin: 0x1000 + cnt0Off, cnt1Lin: 0x1000 + cnt1Off };
}

// ---- COM 3: AH=0Ah 行バッファ入力 (SJIS BS 注入用) ----
function comBuffered() {
  const head = [
    0xB4, 0x0A,             // mov ah,0Ah
    0xBA, 0, 0,             // mov dx,struct (placeholder @3,4)
    0xCD, 0x21,             // int 21h
    0xB4, 0x4C, 0xCD, 0x21, // exit
  ];
  const structOff = 0x100 + head.length;
  head[3] = structOff & 0xFF; head[4] = (structOff >> 8) & 0xFF;
  const b = head.slice();
  b.push(16, 0);                                  // [0]=cap=16 [1]=len(出力)
  for (let i = 0; i < 16; i++) b.push(0);         // 本体
  return { bin: Uint8Array.from(b), structLin: 0x1000 + structOff };
}

(async () => {
  // ===== テスト 1: CX=1 は Enter までブロックし、行を 1 バイトずつ配る =====
  {
    const { bin, bufLin, cntLin } = comCx1();
    const t = await boot(bin);
    t.inject([0x41]);                             // 'A' のみ (Enter 無し)
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    const cnt0pre = t.peek(cntLin) | (t.peek(cntLin + 1) << 8);
    expect(t.getExit(0) === 0, 'Enter 前は COM が終了しない (CX=1 でもブロック)');
    expect(cnt0pre === 0xEEEE, `Enter 前は read1 が戻らない (cnt sentinel 維持) (got 0x${cnt0pre.toString(16)})`);
    t.inject([0x42, 0x0D]);                       // 'B' + Enter → 行 "AB"+CR LF を 1 バイトずつ
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    expect(t.getExit(0) === 1, 'Enter 後に 4 読み完走して終了');
    const cnts = [], bufs = [];
    for (let i = 0; i < 4; i++) {
      cnts.push(t.peek(cntLin + i * 2) | (t.peek(cntLin + i * 2 + 1) << 8));
      bufs.push(t.peek(bufLin + i));
    }
    expect(cnts.join(',') === '1,1,1,1', `各 read が AX=1 (got ${cnts.join(',')})`);
    const hex = bufs.map(x => x.toString(16).padStart(2, '0')).join(' ');
    expect(hex === '41 42 0d 0a', `1 バイトずつ 'A','B',CR,LF を持ち越し配布 (got "${hex}")`);
  }

  // ===== テスト 2: AH=3Fh の BS — 「画」(89 E6) + 'a' + BS は 'a' だけ消す =====
  {
    const { bin, bufLin, countLin } = comRead64();
    const t = await boot(bin);
    t.inject([0x89, 0xE6, 0x61, 0x08, 0x21, 0x0D]);   // 画 a BS ! Enter
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    const count = t.peek(countLin) | (t.peek(countLin + 1) << 8);
    const bytes = []; for (let i = 0; i < count && i < 16; i++) bytes.push(t.peek(bufLin + i));
    const hex = bytes.map(x => x.toString(16).padStart(2, '0')).join(' ');
    expect(t.getExit(0) === 1, '3Fh SJIS BS: COM が終了');
    expect(hex === '89 e6 21 0d 0a', `BS が 'a' 1 バイトだけ消す (トレイル E6 をリード誤認しない) (got "${hex}")`);
  }

  // ===== テスト 3: AH=0Ah の BS — BS×2 で 'a' → 「画」(2 バイトごと) の順に消える =====
  {
    const { bin, structLin } = comBuffered();
    const t = await boot(bin);
    t.inject([0x89, 0xE6, 0x61, 0x08, 0x08, 0x78, 0x0D]);  // 画 a BS BS x Enter
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    const len = t.peek(structLin + 1);
    const b0 = t.peek(structLin + 2);
    expect(t.getExit(0) === 1, '0Ah SJIS BS: COM が終了');
    expect(len === 1 && b0 === 0x78, `BS×2 が 'a' と「画」を消し 'x' のみ残る (got len=${len} b0=0x${b0.toString(16)})`);
  }

  // ===== テスト 4: raw モード — IOCTL 4401h bit5 で Enter 不要の 1 キー即返しに =====
  {
    const { bin, dxsaveLin, buf0Lin, buf1Lin, cnt0Lin, cnt1Lin } = comRaw();
    const t = await boot(bin);
    t.inject([0x61]);                             // 'a' のみ (Enter 無し)
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    const dxsave = t.peek(dxsaveLin) | (t.peek(dxsaveLin + 1) << 8);
    const cnt0 = t.peek(cnt0Lin) | (t.peek(cnt0Lin + 1) << 8);
    expect(dxsave === 0x80F3, `set 後の Get Device Info に bit5 が反映 (0x80F3) (got 0x${dxsave.toString(16)})`);
    expect(t.getExit(0) === 0 && cnt0 === 1 && t.peek(buf0Lin) === 0x61,
           `raw read1 が Enter 無しで 'a' を即受領 (AX=1) (got exit=${t.getExit(0)} cnt0=${cnt0} buf0=0x${t.peek(buf0Lin).toString(16)})`);
    t.inject([0x7A]);                             // 'z' のみ
    for (let f = 0; f < 600 && !t.getExit(0); f++) t.runFrame(t.handle);
    const cnt1 = t.peek(cnt1Lin) | (t.peek(cnt1Lin + 1) << 8);
    expect(t.getExit(0) === 1 && cnt1 === 1 && t.peek(buf1Lin) === 0x7A,
           `raw read2 が 'z' を即受領して完走 (got exit=${t.getExit(0)} cnt1=${cnt1} buf1=0x${t.peek(buf1Lin).toString(16)})`);
  }

  console.log(ok ? 'PASS: CX=1 ブロッキング + 行持ち越し + SJIS BS パリティ走査 + raw モード'
                 : 'FAIL: stdin CX=1 / SJIS BS / raw 回帰');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
