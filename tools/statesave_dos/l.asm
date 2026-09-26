; L.COM — AH=0Ah で 1 行読み、入力された文字列を行 5 へ表示して停止。
; 打ちかけ (再ポーリング中) でセーブして、ロード後の続きの打鍵で同じ行になることを試す。
org 100h
    mov dx, lbuf
    mov ah, 0Ah
    int 21h
    mov ax, 0A000h
    mov es, ax
    mov di, 160 * 5
    mov si, lbuf + 2
    xor ch, ch
    mov cl, [lbuf + 1]
    jcxz .e
.c: lodsb
    xor ah, ah
    stosw
    loop .c
.e: mov ax, '#'
    stosw
hang: jmp hang
lbuf db 40, 0
    times 42 db 0
