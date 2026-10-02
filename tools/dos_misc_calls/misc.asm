; MISC.COM — INT 21h AH=1Bh/1Ch・2Eh/54h・56h・5Ah/5Bh・66h・67h・68h/6Ah の回帰用 (dos_misc_calls_test.js)
; 結果を RES.BIN に書く。各レコードは CF(1) AX(2) の 3 バイト (REC マクロ)。
;   nasm -f bin misc.asm -o MISC.COM
org 100h
        cld
        mov di, buf

%macro REC 0
        pushf
        pop dx
        and dl, 1
        mov [di], dl
        mov [di+1], ax
        add di, 3
%endmacro

%macro CREATE 1                 ; 3Ch で作って閉じる
        mov dx, %1
        xor cx, cx
        mov ah, 3Ch
        int 21h
        mov bx, ax
        mov ah, 3Eh
        int 21h
%endmacro

%macro RENAME 2                 ; 56h %1 -> %2 を記録
        mov dx, %1
        mov [di_keep], di
        mov di, %2
        mov ah, 56h
        int 21h
        mov di, [di_keep]
        REC
%endmacro

        CREATE fa
        CREATE fc
; [0] A.TXT -> B.TXT 成功
        RENAME fa, fb
; [1] もう一度 (A.TXT は無い) → AX=2
        RENAME fa, fb
; [2] B.TXT -> C.TXT (C.TXT がある) → AX=5
        RENAME fb, fc
; [3] B.TXT -> NODIR\X.TXT → AX=3
        RENAME fb, fnodir
; [4] 5Bh 既にある C.TXT → AX=50h
        mov dx, fc
        xor cx, cx
        mov ah, 5Bh
        int 21h
        REC
; [5] 5Bh 無い D.TXT → 成功。ハンドルを [6] の 68h に使う
        mov dx, fd
        xor cx, cx
        mov ah, 5Bh
        int 21h
        mov bp, ax
        REC
; [6] 68h (開いているハンドル) → CF=0
        mov bx, bp
        mov ah, 68h
        int 21h
        REC
; [7] 6Ah → CF=0
        mov bx, bp
        mov ah, 6Ah
        int 21h
        REC
; [8] 68h 範囲外 BX=99 → AX=6
        mov bx, 99
        mov ah, 68h
        int 21h
        REC
        mov bx, bp
        mov ah, 3Eh
        int 21h
; [9] 5Ah 一時ファイル。バッファ = "" (カレント)。AX=ハンドル。名前をバッファ先頭 8 文字として記録
        mov byte [tmpbuf], 0
        mov dx, tmpbuf
        xor cx, cx
        mov ah, 5Ah
        int 21h
        REC
        mov bx, ax
        mov ah, 3Eh
        int 21h
        mov si, tmpbuf                  ; 名前 8 バイトを記録 (3 バイトレコードの後ろ)
        mov cx, 8
        rep movsb
; [10] 2Eh AL=1 → 54h AL=1
        mov ax, 2E01h
        int 21h
        mov ah, 54h
        int 21h
        mov ah, 0
        REC
; [11] 2Eh AL=0 → 54h AL=0
        mov ax, 2E00h
        int 21h
        mov ah, 54h
        int 21h
        mov ah, 0
        REC
; [12] 66h AL=1 → BX=932 DX=932 を AX の代わりに記録 (BX を AX 位置へ)
        mov ax, 6601h
        int 21h
        mov bp, dx
        mov ax, bx
        REC
        mov [di], bp
        add di, 2
; [13] 66h AL=2 BX=437 → CF=1
        mov ax, 6602h
        mov bx, 437
        int 21h
        REC
; [14] 66h AL=2 BX=932 → CF=0
        mov ax, 6602h
        mov bx, 932
        int 21h
        REC
; [15] 67h BX=20 → CF=0
        mov ah, 67h
        mov bx, 20
        int 21h
        REC
; [16] 67h BX=500 → CF=1 AX=4
        mov ah, 67h
        mov bx, 500
        int 21h
        REC
; [17] 1Bh: AL / CX / DX / [DS:BX] を記録
        mov ah, 1Bh
        int 21h
        mov [es:di], al                 ; 1Bh/1Ch は DS を書き換える。記録は ES (= CS) へ
        mov [es:di+1], cx
        mov [es:di+3], dx
        mov al, [bx]
        mov [es:di+5], al
        push cs
        pop ds
        add di, 6
; [18] 1Ch DL=1 も同じ
        mov ah, 1Ch
        mov dl, 1
        int 21h
        mov [es:di], al                 ; 1Bh/1Ch は DS を書き換える。記録は ES (= CS) へ
        mov [es:di+1], cx
        mov [es:di+3], dx
        mov al, [bx]
        mov [es:di+5], al
        push cs
        pop ds
        add di, 6
; [19] 36h の DX (全クラスタ数) と AX (セクタ/クラスタ) と CX
        mov ah, 36h
        xor dl, dl
        int 21h
        mov [di], ax
        mov [di+2], cx
        mov [di+4], dx
        add di, 6
; RES.BIN に書く
        mov dx, fres
        xor cx, cx
        mov ah, 3Ch
        int 21h
        mov bx, ax
        mov cx, di
        sub cx, buf
        mov dx, buf
        mov ah, 40h
        int 21h
        mov ah, 3Eh
        int 21h
        mov ax, 4C00h
        int 21h

fa:     db 'A.TXT', 0
fb:     db 'B.TXT', 0
fc:     db 'C.TXT', 0
fd:     db 'D.TXT', 0
fnodir: db 'NODIR\X.TXT', 0
fres:   db 'RES.BIN', 0
di_keep: dw 0
tmpbuf: times 64 db 0
buf:
