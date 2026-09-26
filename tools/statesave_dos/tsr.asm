; TSR.COM — INT 60h に「呼ばれるたびに数を 1 増やして AX に返す」処理を置いて常駐 (AH=31h)。
org 100h
    jmp install
count dw 0
handler:
    inc word [cs:count]
    mov ax, [cs:count]
    iret
install:
    mov dx, handler
    mov ax, 2560h
    int 21h
    mov dx, (install - $$ + 100h + 15) / 16
    mov ax, 3100h
    int 21h
