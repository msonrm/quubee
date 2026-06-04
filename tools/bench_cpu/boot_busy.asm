; PC-98 2HD boot sector: CPU 飽和 busy ループ (HLT しない) で multiple スケーリングを測る用。
; boot_hello/boot.asm をベースに、末尾の hlt ループを算術 busy ループへ差し替えただけ。
; assemble: nasm -f bin boot_busy.asm -o boot_busy.bin
BITS 16
ORG 0x0000
start:
    cli
    mov  ax, 0x1FC0
    mov  ds, ax
    mov  ss, ax
    mov  sp, 0x0100
    ; テキストモード設定 (描画コスト混入を避けるため最小限。画面は触らない)
    mov  ah, 0x0a
    mov  al, 0x04
    int  0x18
    mov  ah, 0x0c
    int  0x18
    ; レジスタ初期化
    xor  ax, ax
    xor  bx, bx
    mov  cx, 1
    mov  dx, 2
    xor  bp, bp
    xor  si, si
    sti
    ; CPU 飽和 busy ループ: HLT を含まないので毎フレーム CPU_EXEC が realclock/56
    ; サイクルぶん回る。算術命令の混合で「ただの jmp $」より現実的な命令コストにする。
.busy:
    add  ax, bx
    sub  dx, cx
    imul si, si, 3
    xor  bp, ax
    inc  bx
    add  cx, 5
    rol  ax, 1
    jmp  .busy

times 1024-($-$$) db 0
