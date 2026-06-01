; PC-98 2HD boot sector: "HELLO QuuBee" を text VRAM に書いてループ
; assemble: nasm -f bin boot.asm -o boot.bin

BITS 16
ORG 0x0000

start:
    cli
    ; DS と SS をブートセグメント (0x1FC0) にそろえる。
    ; BIOS から boot sector に飛んできた直後の DS は不定 (通常 0)。msg を
    ; [si] で読むには DS = CS = 0x1FC0 にしておく必要がある。
    mov  ax, 0x1FC0
    mov  ds, ax
    mov  ss, ax
    mov  sp, 0x0100

    ; PC-98 BIOS INT 18h でテキストモードを 80x25 ANK 8x16 にセットする。
    ; BIOS POST が POST 時に自動で gdc.mode1 を 8x16 モードに設定しないケース
    ; があり、設定されていないと NP2kai のテキスト描画が「8x8 char graphic」
    ; パスに落ちて、文字が記号化したパターンで化ける。
    ; AH=0Ah, AL=4 (bit 2 = 属性モード有効、それ以外は 80x25 標準)
    mov  ah, 0x0a
    mov  al, 0x04
    int  0x18
    ; テキスト表示を有効化 (AH=0Ch)
    mov  ah, 0x0c
    int  0x18

    ; PC-98 text code plane: segment A000h
    ; offset = (row*80 + col) * 2  (row=12, col=34)
    ; (12*80 + 34) * 2 = 994*2 = 1988 = 0x07C4
    mov  ax, 0xA000
    mov  es, ax
    mov  di, 0x07C4

    mov  si, msg
    mov  cx, msg_len

.write_code:
    mov  al, [si]
    mov  ah, 0               ; high byte = 0 for ANK
    stosw
    inc  si
    loop .write_code

    ; PC-98 text attribute plane: segment A200h
    ; attribute: bit7=blink, bit4=GVRAMcolor, bit3=bright, bit0=?
    ; 0xE1 = 1110_0001b  → regular white-on-black visible character
    mov  ax, 0xA200
    mov  es, ax
    mov  di, 0x07C4
    mov  cx, msg_len

.write_attr:
    mov  ax, 0x00E1          ; lo=attribute(0xE1), hi=color(0x00)
    stosw
    loop .write_attr

    ; cursor off, loop forever
    sti
.halt:
    hlt
    jmp .halt

msg:     db "HELLO QuuBee"
msg_len  equ $ - msg

; 1024バイトにパディング (N=3 sector = 1024 bytes)
times 1024-($-$$) db 0
