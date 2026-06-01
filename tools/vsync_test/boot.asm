; PC-98 VSYNC IRQ 配送パス確認用 boot sector
; assemble: nasm -f bin boot.asm -o boot.bin
;
; 動作:
;   - IVT[0x0A] (= IRQ 2 / CRT VSYNC) に独自 ISR を仕込む
;   - 8259 master IMR の bit2 を解除 (IRQ 2 を有効化)
;   - port 0x64 へ OUT して gdc.vsyncint=1 をセット (NP2kai gdc.c:474)
;   - STI → HLT ループ
;
; ISR は VSYNC 毎に呼ばれ、メモリ上のカウンタを ++ し、
; 中央付近の text VRAM に 8 桁 16 進数として表示。
; さらに port 0x64 へ再 OUT して次の VSYNC を arm (vsyncint は one-shot)。
;
; 期待動作:
;   ブラウザで挿すと 56Hz でカウンタが回り続ける。
;   止まる/出ない → VSYNC IRQ 配送パスに問題あり。

BITS 16
ORG 0x0000

%define BOOT_SEG 0x1FC0

start:
    cli
    ; DS/SS をブートセグメントに揃える (boot_hello と同じ)
    mov  ax, BOOT_SEG
    mov  ds, ax
    mov  ss, ax
    mov  sp, 0x0100

    ; ---- テキストモード初期化 (boot_hello と同じ) ----
    mov  ah, 0x0a
    mov  al, 0x04
    int  0x18
    mov  ah, 0x0c
    int  0x18

    ; ---- ラベル "VSYNC=" を text VRAM に書く ----
    mov  ax, 0xA000
    mov  es, ax
    ; (row*80 + col) * 2  row=12, col=30  → (12*80+30)*2 = 1980 = 0x7BC
    mov  di, 0x07BC
    mov  si, label_msg
    mov  cx, label_len
.write_lbl:
    mov  al, [si]
    mov  ah, 0
    stosw
    inc  si
    loop .write_lbl

    ; 属性: label と数字 8 文字 = 14 文字に bright white を塗る
    mov  ax, 0xA200
    mov  es, ax
    mov  di, 0x07BC
    mov  cx, 14
.write_attr:
    mov  ax, 0x00E1
    stosw
    loop .write_attr

    ; ---- IVT[0x0A] に ISR を設置 ----
    ; PC-98 IRQ 2 (CRT VSYNC) → INT 0x0A → IVT offset = 0x0A * 4 = 0x28
    xor  ax, ax
    mov  es, ax              ; ES = 0 (IVT セグメント)
    mov  word [es:0x28], vsync_isr
    mov  word [es:0x2A], BOOT_SEG

    ; ---- 8259 master IMR の bit2 (IRQ 2) を解除 ----
    in   al, 0x02
    and  al, 0xFB             ; ~0x04 = bit2 clear
    out  0x02, al

    ; ---- VSYNC INT 有効化 (port 0x64) ----
    xor  al, al
    out  0x64, al

    sti

.halt:
    hlt
    jmp .halt


; ============================================================
; ISR (IRQ 2 = VSYNC)
; ============================================================
vsync_isr:
    push ax
    push bx
    push cx
    push dx
    push di
    push es

    ; 32bit カウンタを ++
    add  word [counter],     1
    adc  word [counter + 2], 0

    ; カウンタを 8 桁 16 進で text VRAM に書く
    ; 行 12, 列 36 (= "VSYNC=" の直後) → (12*80+36)*2 = 1992 = 0x7C8
    mov  ax, 0xA000
    mov  es, ax
    mov  di, 0x07C8

    ; 上位ワード → 4 桁
    mov  dx, [counter + 2]
    call write_hex4
    ; 下位ワード → 4 桁
    mov  dx, [counter]
    call write_hex4

    ; VSYNC INT を再 arm (gdc.vsyncint は one-shot)
    xor  al, al
    out  0x64, al

    ; EOI to master 8259 (port 0x00, OCW2 = 0x20 = nonspecific EOI)
    mov  al, 0x20
    out  0x00, al

    pop  es
    pop  di
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    iret


; ------------------------------------------------------------
; write_hex4: DX を 4 桁 16 進文字として ES:DI に書く (stosw 形式)
;             ES = 0xA000 を期待、attribute プレーンは初期化時にまとめて済
; ------------------------------------------------------------
write_hex4:
    mov  cx, 4
.loop:
    mov  ax, dx
    rol  ax, 4
    mov  dx, ax              ; DX も rotate
    and  al, 0x0F
    cmp  al, 10
    jb   .digit
    add  al, 'A' - 10 - '0'
.digit:
    add  al, '0'
    mov  ah, 0
    stosw
    loop .loop
    ret


; ============================================================
; データ
; ============================================================
label_msg:  db "VSYNC="
label_len   equ $ - label_msg

counter:    dd 0

; 1024 バイトにパディング
times 1024-($-$$) db 0
