; Phase 3 ミニマル DOS ローダ ブートストラップ
;
; 役割: PC-98 BIOS が boot sector を 0x1FC0:0 にロードして JMP したあと、
;       BIOS-area の "loader-start" トランポリン (linear 0xFEE00 = F000:EE00)
;       に far jmp する。0xFEE00 の NOP 命令が ia32_bioscall → biosfunc(0xFEE00)
;       を呼び、native/dos_loader.c 側の C コードが
;         1) IVT[0x20]/[0x21] に NOP トランポリンを仕込む
;         2) PSP を 0x0100 セグメントに構築
;         3) COM/EXE image を 0x0100:0x100 にロード
;         4) CPU_CS/IP/SS/SP/DS/ES を image エントリに書き換える
;       のすべてをやって return(1) する。CPU は次の命令を image エントリから
;       実行開始する。
;
; このブート sector の本体は **8 byte** で済む。残りは 1024 byte までゼロ詰め。
; assemble: nasm -f bin boot.asm -o boot.bin

BITS 16
ORG 0x0000

start:
    cli
    ; far jmp F000:EE00 — biosfunc(0xFEE00) を踏む
    db 0xEA                  ; JMP FAR (ptr16:16)
    dw 0xEE00                ; offset
    dw 0xF000                ; segment

    ; biosfunc が CS/IP を書き換えなかった場合の保険 (本来到達しない)
.halt:
    hlt
    jmp .halt

; 1024 byte (= N=3 sector) にパディング
times 1024-($-$$) db 0
