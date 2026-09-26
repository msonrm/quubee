; CHILD.COM — 毎 VSYNC INT 60h (TSR.COM) を呼んで返り値を 3 行目へ表示 (1 行目はバッチの ECHO が使う)、300 回で終了 (AH=4Ch)。
; RUN.BAT = TSR.COM → CHILD.COM → ECHO。子の実行中 (EXEC スタック・バッチ位置・常駐) にセーブする。
org 100h
    mov ax, 0A000h
    mov es, ax
    mov cx, 300
.l: push cx
    call vsync
    int 60h
    mov di, 160 * 2
    call hex4
    pop cx
    loop .l
    mov ax, 4C00h
    int 21h
%include "common.inc"
