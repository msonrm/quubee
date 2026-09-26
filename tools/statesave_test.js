#!/usr/bin/env node
// statesave_test.js — ステートセーブの一致テスト (フェーズ 2)。
//
// A: そのまま走らせ続ける / B: A と同じ時点でセーブ → **別モジュール**を起動してロード → 続きを走らせる。
// 両者の続き (TAIL フレーム) を比べ、ロードで「続きが同じになる」ことを確かめる。
//
// 題材は手順書 (plan_np2kai_bump_and_statesave.md 付録 A) の T.COM: VSYNC ごとにカウンタを 1 行目へ、
// 開いた DATA.BIN から 1 バイトずつ読んで 2 行目へ表示し、OPN の ch1 で音を鳴らし続けて 64 フレーム
// ごとに音程を変える。CPU・画面・タイミング・FM・HLE-DOS のファイル状態を一度に試せる。
//
// 段階ごとに合格条件を増やす (段階の定義 = TODO.md「フェーズ 2」):
//   A: NP2kai 区画 (statsave) — ロードの戻り値 0 (HRTIMER の WARNING が無い = patch 09) /
//      1 行目のカウンタ一致 (CPU・画面・VSYNC タイミング) / INT 21h の呼び出し増分一致
//   B: QuuBee 区画 (HLE-DOS 等) — 2 行目 = DATA.BIN から読んだ内容 (開いているファイルの
//      位置) の一致 / 画面ハッシュの一致
//   C (現在): 音声が全区間一致。statsave のロードは sound_reset で「合成済みで未再生」の分を捨て、
//      最後に合成した時刻を付け替えるため、そのままでは先頭 ~16000 サンプル (約 0.37 秒) が食い違った。
//      QuuBee 区画 SND_ (patch 10 の sound_pending_get/set + soundcfg.lastclock) で差し戻す
//
// T.COM (nasm -f bin) のソース:
//   org 100h
//       mov dx, fname
//       mov ax, 3D00h
//       int 21h
//       jc  fail
//       mov [hnd], ax
//       mov si, opntab
//   .o: lodsw
//       cmp al, 0FFh
//       je  .odone
//       call opnw
//       jmp .o
//   .odone:
//   main:
//   .w1: in al, 0A0h
//       test al, 20h
//       jnz .w1
//   .w2: in al, 0A0h
//       test al, 20h
//       jz .w2
//       inc word [cnt]
//       mov ax, 0A000h
//       mov es, ax
//       mov bx, [cnt]
//       xor di, di
//       mov cx, 4
//   .h: rol bx, 4
//       mov al, bl
//       and al, 0Fh
//       add al, '0'
//       cmp al, '9'
//       jbe .d
//       add al, 7
//   .d: xor ah, ah
//       stosw
//       loop .h
//       mov bx, [hnd]
//       mov dx, buf
//       mov cx, 1
//       mov ah, 3Fh
//       int 21h
//       jc  rerr
//       or  ax, ax
//       jnz .got
//       mov bx, [hnd]
//       xor cx, cx
//       xor dx, dx
//       mov ax, 4200h
//       int 21h
//       jmp main
//   .got:
//       mov ax, [cnt]
//       xor dx, dx
//       mov cx, 80
//       div cx
//       mov di, dx
//       shl di, 1
//       add di, 160
//       mov al, [buf]
//       xor ah, ah
//       stosw
//       test word [cnt], 3Fh
//       jnz main
//       add byte [fnum], 13h
//       mov al, 0A4h
//       mov ah, 22h
//       call opnw
//       mov al, 0A0h
//       mov ah, [fnum]
//       call opnw
//       mov al, 28h
//       mov ah, 00h
//       call opnw
//       mov al, 28h
//       mov ah, 0F0h
//       call opnw
//       jmp main
//   rerr:
//       mov ax, 0A000h
//       mov es, ax
//       mov word [es:160+158], 'E'
//       jmp main
//   fail:
//       mov ax, 4C01h
//       int 21h
//   opnw:
//       push dx
//       mov dx, 188h
//       out dx, al
//       mov dx, 18Ah
//       mov al, ah
//       out dx, al
//       pop dx
//       ret
//   fname db 'DATA.BIN',0
//   hnd  dw 0
//   cnt  dw 0
//   buf  db 0
//   fnum db 69h
//   opntab:
//       db 30h,01h, 34h,01h, 38h,01h, 3Ch,01h
//       db 40h,7Fh, 44h,7Fh, 48h,7Fh, 4Ch,00h
//       db 50h,1Fh, 54h,1Fh, 58h,1Fh, 5Ch,1Fh
//       db 60h,00h, 64h,00h, 68h,00h, 6Ch,00h
//       db 70h,00h, 74h,00h, 78h,00h, 7Ch,00h
//       db 80h,0Fh, 84h,0Fh, 88h,0Fh, 8Ch,0Fh
//       db 0B0h,07h, 0B4h,0C0h, 0A4h,22h, 0A0h,69h, 28h,0F0h
//       db 0FFh,0FFh
//
// 使い方: node tools/statesave_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Machine } = require('./lib/machine');

const T_COM = Buffer.from(
    'bad801b8003dcd210f82ba00a3e101bee701ad3cff7405e8b100ebf6e4a0a820' +
    '75fae4a0a82074faff06e301b800a08ec08b1ee30131ffb90400c1c30488d824' +
    '0f04303c397602040730e4abe2ec8b1ee101bae501b90100b43fcd21725909c0' +
    '750f8b1ee10131c931d2b80042cd21ebaba1e30131d2b95000f7f189d7d1e781' +
    'c7a000a0e50130e4abf706e3013f00758b8006e60113b0a4b422e82e00b0a08a' +
    '26e601e82500b028b400e81e00b028b4f0e81700e965ffb800a08ec026c7063e' +
    '014500e956ffb8014ccd2152ba8801eeba8a0188e0ee5ac3444154412e42494e' +
    '000000000000693001340138013c01407f447f487f4c00501f541f581f5c1f60' +
    '00640068006c007000740078007c00800f840f880f8c0fb007b4c0a422a06928' +
    'f0ffff',
    'hex');
const WARM = 300, TAIL = 300;

let pass = 0, fail = 0;
function chk(ok, msg) { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); ok ? pass++ : fail++; }

function int21Delta(a, b) {
    const d = {};
    for (const k of new Set([...Object.keys(a.calls), ...Object.keys(b.calls)])) {
        const n = (b.calls[k] || 0) - (a.calls[k] || 0);
        if (n) d[k] = n;
    }
    return d;
}

// 続き TAIL フレームの観測: 音声 (TAIL フレームぶん)・テキスト VRAM・画面ハッシュ・INT 21h の増分
function observeTail(m) {
    const s0 = m.int21Stats();
    const pcm = m.captureAudio(TAIL / 56.42);
    const text = m.textVram();
    return { pcm, row0: text[0].slice(0, 4), row1: text[1], screen: m.screenHash(), int21: int21Delta(s0, m.int21Stats()) };
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statesave_'));
    fs.writeFileSync(path.join(dir, 'T.COM'), T_COM);
    fs.writeFileSync(path.join(dir, 'DATA.BIN'), Buffer.from(Array.from({ length: 0x7f - 0x21 }, (_, i) => 0x21 + i)));
    fs.writeFileSync(path.join(dir, 'RUN.BAT'), 'T.COM\r\n');

    // ---- A: 走らせ続ける (途中でセーブ) ----
    const A = await Machine.boot({ dir, bat: 'RUN.BAT' });
    A.runFrames(WARM);
    const saveRet = A.M.ccall('np2kai_state_np2_save', 'number', ['string'], ['/tmp/s.np2']);
    const busy = A.M.ccall('np2kai_state_qb_busy', 'number', [], []);
    const qbSaveRet = A.M.ccall('np2kai_state_qb_save', 'number', ['string'], ['/tmp/s.qb']);
    const blob = A.M.FS.readFile('/tmp/s.np2');
    const qbBlob = A.M.FS.readFile('/tmp/s.qb');
    const at = { frame: A.frame, produced: A.produced };
    const obsA = observeTail(A);

    // ---- B: 別モジュールでロードして続き ----
    const B = await Machine.boot({ dir, bat: 'RUN.BAT' });
    B.runFrames(1);
    B.M.FS.writeFile('/tmp/s.np2', blob);
    const loadRet = B.M.ccall('np2kai_state_np2_load', 'number', ['string'], ['/tmp/s.np2']);
    B.M.FS.writeFile('/tmp/s.qb', qbBlob);
    const qbLoadRet = B.M.ccall('np2kai_state_qb_load', 'number', ['string'], ['/tmp/s.qb']);
    B.frame = at.frame; B.produced = at.produced;   // 音声の汲み出し位置を A にそろえる
    const obsB = observeTail(B);

    console.log(`statsave: save=${saveRet} load=${loadRet} size=${blob.length} bytes / qb: busy=${busy} save=${qbSaveRet} load=${qbLoadRet} size=${qbBlob.length} bytes / wasm=${A.info().wasm.sha256.slice(0, 16)}`);
    console.log(`  A row0=${obsA.row0} row1=${JSON.stringify(obsA.row1.trim().slice(0, 40))}`);
    console.log(`  B row0=${obsB.row0} row1=${JSON.stringify(obsB.row1.trim().slice(0, 40))}`);

    chk(saveRet === 0, `statsave の保存が成功 (戻り値 ${saveRet})`);
    chk(loadRet === 0, `statsave の読み込みが WARNING なしで成功 (戻り値 0x${(loadRet >>> 0).toString(16)}。0x80 = HRTIMER 等のイベント欠落)`);
    chk(busy === 0 && qbSaveRet === 0 && qbLoadRet === 0, `QuuBee 区画の保存・読み込みが成功 (busy=${busy} save=${qbSaveRet} load=${qbLoadRet})`);
    chk(obsA.row0 === obsB.row0 && /^[0-9A-F]{4}$/.test(obsA.row0), `1 行目のカウンタが一致 (CPU・画面・VSYNC タイミング): ${obsA.row0} / ${obsB.row0}`);
    chk(JSON.stringify(obsA.int21) === JSON.stringify(obsB.int21), `続きの INT 21h 呼び出しが一致: ${JSON.stringify(obsA.int21)} / ${JSON.stringify(obsB.int21)}`);

    chk(obsA.row1 === obsB.row1, '2 行目 (DATA.BIN から読んだ内容 = HLE-DOS の開いているファイルの位置) が一致');
    chk(obsA.screen === obsB.screen, `画面ハッシュが一致 (${obsA.screen.toString(16)} / ${obsB.screen.toString(16)})`);
    let firstDiff = -1, lastDiff = -1;
    const n = Math.min(obsA.pcm.length, obsB.pcm.length);
    for (let i = 0; i < n; i++) if (obsA.pcm[i] !== obsB.pcm[i]) { if (firstDiff < 0) firstDiff = i; lastDiff = i; }
    chk(firstDiff < 0 && obsA.pcm.length === obsB.pcm.length,
        `音声が全区間一致 (${n / 2} サンプル中、食い違い ${firstDiff < 0 ? 'なし' : `${firstDiff >> 1}〜${lastDiff >> 1}`})`);

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\nstatesave_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
