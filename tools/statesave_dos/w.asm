; W.COM — OUT.TXT を作って毎 VSYNC 1 バイト ('A'+cnt%26) 書く。600 バイトで閉じて停止。
; 1 行目 = 書いたバイト数。セーブ時点で開いている書き込みハンドル (w+b) の位置とフラッシュを試す。
org 100h
    mov dx, fname
    xor cx, cx
    mov ah, 3Ch
    int 21h
    jc fail
    mov [hnd], ax
    mov ax, 0A000h
    mov es, ax
main:
    call vsync
    inc word [cnt]
    mov ax, [cnt]
    xor dx, dx
    mov cx, 26
    div cx
    add dl, 'A'
    mov [buf], dl
    mov bx, [hnd]
    mov dx, buf
    mov cx, 1
    mov ah, 40h
    int 21h
    xor di, di
    mov ax, [cnt]
    call hex4
    cmp word [cnt], 600
    jb main
    mov bx, [hnd]
    mov ah, 3Eh
    int 21h
hang: jmp hang
fail:
    mov ax, 4C01h
    int 21h
%include "common.inc"
fname db 'OUT.TXT', 0
hnd dw 0
cnt dw 0
buf db 0
