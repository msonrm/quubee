; common.inc — statesave_dos_test の COM 共通ルーチン (nasm)。
; vsync: 次の VSYNC の立ち上がりまで待つ (GDC ステータス 0A0h bit5)。
; hex4:  AX を 16 進 4 桁で ES:DI (テキスト VRAM, ES=0A000h) へ書く。DI は進む。
vsync:
.w1: in al, 0A0h
    test al, 20h
    jnz .w1
.w2: in al, 0A0h
    test al, 20h
    jz .w2
    ret
hex4:
    push bx
    push cx
    mov bx, ax
    mov cx, 4
.h: rol bx, 4
    mov al, bl
    and al, 0Fh
    add al, '0'
    cmp al, '9'
    jbe .d
    add al, 7
.d: xor ah, ah
    stosw
    loop .h
    pop cx
    pop bx
    ret
