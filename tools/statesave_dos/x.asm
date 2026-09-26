; X.COM — XMS に 64KB 確保し 'A'..'Z' を書き込み (AH=0Bh Move)、手元を消して 200 VSYNC 待った後に
; EMB から読み戻して行 3 へ表示。待っている間 (EMB 確保中) にセーブ → ロードしても読み戻せることを試す。
org 100h
    mov ax, 0A000h
    mov es, ax
    mov ax, 4300h
    int 2Fh
    cmp al, 80h
    jne fail
    mov ax, 4310h
    int 2Fh
    mov [xms], bx
    mov [xms + 2], es
    mov ax, 0A000h
    mov es, ax
    mov ah, 09h
    mov dx, 64
    call far [xms]
    or ax, ax
    jz fail
    mov [hdl], dx
    mov di, src
    mov al, 'A'
    mov cx, 26
.f: mov [di], al
    inc di
    inc al
    loop .f
    ; src (conv) → EMB
    mov word [mv_sh], 0
    mov word [mv_so], src
    mov [mv_so + 2], ds
    mov ax, [hdl]
    mov [mv_dh], ax
    mov word [mv_do], 0
    mov word [mv_do + 2], 0
    mov si, mv
    mov ah, 0Bh
    call far [xms]
    ; 手元を消す (stosb は ES:DI に書くので ES を DS に合わせる)
    push ds
    pop es
    mov di, src
    mov cx, 26
    xor al, al
    rep stosb
    mov ax, 0A000h
    mov es, ax
    mov cx, 200
.w: push cx
    call vsync
    xor di, di
    pop ax
    push ax
    call hex4
    pop cx
    loop .w
    ; EMB → src
    mov ax, [hdl]
    mov [mv_sh], ax
    mov word [mv_so], 0
    mov word [mv_so + 2], 0
    mov word [mv_dh], 0
    mov word [mv_do], src
    mov [mv_do + 2], ds
    mov si, mv
    mov ah, 0Bh
    call far [xms]
    mov si, src
    mov di, 160 * 3
    mov cx, 26
.s: lodsb
    xor ah, ah
    stosw
    loop .s
hang: jmp hang
fail:
    xor di, di
    mov ax, 'F'
    stosw
    jmp hang
%include "common.inc"
xms dd 0
hdl dw 0
mv:
mv_len dd 26
mv_sh  dw 0
mv_so  dd 0
mv_dh  dw 0
mv_do  dd 0
src times 32 db 0
