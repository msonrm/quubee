; F.COM — FindFirst/FindNext("*.DAT") で見つけた名前を 1 件ずつ 40 VSYNC おきに行 1.. へ表示。
; 検索の途中 (FindNext 待ち) でセーブして、ロード後に同じ続きの名前が出ることを試す。
org 100h
    mov ax, 0A000h
    mov es, ax
    mov word [row], 160
    mov dx, pat
    xor cx, cx
    mov ah, 4Eh
    int 21h
    jc done
show:
    mov si, 80h + 1Eh
    mov di, [row]
    mov cx, 13
.c: lodsb
    or al, al
    jz .e
    xor ah, ah
    stosw
    loop .c
.e: add word [row], 160
    mov cx, 40
.w: push cx
    call vsync
    pop cx
    loop .w
    mov ah, 4Fh
    int 21h
    jnc show
done:
    mov di, 0
    mov ax, 'E'
    stosw
hang: jmp hang
%include "common.inc"
pat db '*.DAT', 0
row dw 0
