; mousetest.asm — 実マウスドライバ (MOUSE.COM 常駐後) の INT 33h 挙動測定
; 各ファンクション呼び出し前にレジスタへセンチネル (0x5A5A) を入れ、呼び出し後の
; AX/BX/CX/DX を DUMPBUF に順次記録する。ホスト (JS) は測定フェーズに合わせて
; ボタン押下/移動を注入し、終了後に DUMPBUF をメモリダンプで回収する。
;
; ダンプレイアウト (DUMPBUF から 8 byte × N):
;   [0] fn0  reset       : AX BX CX DX
;   [1] fn3  ボタン無し   : AX BX CX DX  (CX/DX=座標)
;   [2] fn3  左ボタン押下 : AX BX CX DX
;   [3] fn3  右ボタン押下 : AX BX CX DX
;   [4] fn0A CX=0 DX=27F : AX BX CX DX  (X範囲設定 or 別機能の戻り)
;   [5] fn0B CX=0 DX=18F : AX BX CX DX
;   [6] fn07 CX=0 DX=27F : AX BX CX DX
;   [7] fn08 CX=0 DX=18F : AX BX CX DX
;   [8] fnFF BX=0F       : AX BX CX DX  (bepn が MS 判定枝で呼ぶ謎ファンクション)
;   [9] fn3  範囲設定後   : AX BX CX DX  (JS が大きく右下へ移動注入 → クランプ確認)
;   [10] fn10 CX=0 DX=27F: AX BX CX DX
;   [11] fn11 CX=0 DX=18F: AX BX CX DX
;   [12] fn3 ペア範囲テスト後: コマンドライン引数 (A=0A/0B, B=10/11, C=07/08) で選んだ
;        ペアに狭い範囲 (0..100h, 0..80h) を設定 → JS が大移動+左クリック → クランプ先で
;        「そのペアが本当に範囲設定か」を判別する
; 完走センチネル: DUMPBUF-1 に 0x55

        org 0x100

SENT    equ 0x5A5A

start:
        mov     di, dumpbuf

        ; --- [0] fn0 reset ---
        xor     ax, ax
        mov     bx, SENT
        mov     cx, SENT
        mov     dx, SENT
        int     0x33
        call    dump4

        ; --- [1] fn3 ボタン無し ---
        call    fn3dump

        ; --- 左ボタン待ち → [2] ---
.waitL: call    fn3press
        jz      .waitL
        call    fn3dump

        ; --- 全ボタン解放待ち ---
.waitR0:call    fn3press
        jnz     .waitR0

        ; --- 右ボタン待ち → [3] ---
.waitR: call    fn3press
        jz      .waitR
        call    fn3dump

        ; --- 右ボタン解放待ち ---
.waitR2:call    fn3press
        jnz     .waitR2

        ; --- [4] fn0A / [5] fn0B (NEC 流の範囲設定?) ---
        mov     ax, 0x000A
        mov     bx, SENT
        xor     cx, cx
        mov     dx, 0x027F
        int     0x33
        call    dump4
        mov     ax, 0x000B
        mov     bx, SENT
        xor     cx, cx
        mov     dx, 0x018F
        int     0x33
        call    dump4

        ; --- [6] fn07 / [7] fn08 (MS 流の範囲設定?) ---
        mov     ax, 0x0007
        mov     bx, SENT
        xor     cx, cx
        mov     dx, 0x027F
        int     0x33
        call    dump4
        mov     ax, 0x0008
        mov     bx, SENT
        xor     cx, cx
        mov     dx, 0x018F
        int     0x33
        call    dump4

        ; --- [8] fnFF BX=0F ---
        mov     ax, 0x00FF
        mov     bx, 0x000F
        mov     cx, SENT
        mov     dx, SENT
        int     0x33
        call    dump4

        ; --- 移動注入待ち: 左ボタン press/release をもう一周合図に使う ---
.waitM: call    fn3press
        jz      .waitM
.waitM2:call    fn3press
        jnz     .waitM2

        ; --- [9] fn3 大移動後 (範囲クランプの観測) ---
        call    fn3dump

        ; --- [10] fn10 / [11] fn11 (DOSBox-X 説の NEC 範囲設定?) ---
        mov     ax, 0x0010
        mov     bx, SENT
        xor     cx, cx
        mov     dx, 0x027F
        int     0x33
        call    dump4
        mov     ax, 0x0011
        mov     bx, SENT
        xor     cx, cx
        mov     dx, 0x018F
        int     0x33
        call    dump4

        ; --- ペア範囲テスト: 引数 (PSP:0081h 以降の先頭非空白文字) でペア選択 ---
        mov     si, 0x0081
.scan:  lodsb
        cmp     al, ' '
        je      .scan
        mov     bx, 0x0A0B          ; 既定 'A' = fn0A/fn0B
        cmp     al, 'B'
        jne     .notB
        mov     bx, 0x1011          ; 'B' = fn10/fn11
.notB:  cmp     al, 'C'
        jne     .notC
        mov     bx, 0x0708          ; 'C' = fn07/fn08
.notC:  mov     [pair], bx

        mov     al, bh              ; X 側 fn
        xor     ah, ah
        xor     cx, cx
        mov     dx, 0x0100          ; X range 0..100h
        int     0x33
        mov     al, [pair]          ; Y 側 fn (下位バイト)
        xor     ah, ah
        xor     cx, cx
        mov     dx, 0x0080          ; Y range 0..80h
        int     0x33

        ; --- 左クリック合図待ち → [12] fn3 (クランプ観測) ---
.waitP: call    fn3press
        jz      .waitP
        call    fn3dump

        mov     byte [dumpbuf-1], 0x55      ; 完走センチネル
        mov     ax, 0x4C00
        int     0x21

pair    dw      0x0A0B

; fn3 を呼ぶ (センチネル入り)。戻り: AX/BX/CX/DX
fn3:    mov     ax, 0x0003
        mov     bx, SENT
        mov     cx, SENT
        mov     dx, SENT
        int     0x33
        ret

; fn3 を呼び「何かボタンが押されているか」を ZF で返す (ZF=1: 未押下)。
; MS 流: AX 温存 (=3)・BX=ビットフィールド → BX!=0 で押下。
; NEC 流 (DOSBox-X 説): AX=左 (0/FFFF)・BX=右 (0/FFFF) → AX==FFFF or BX!=0 で押下。
fn3press:
        call    fn3
        cmp     ax, 0xFFFF      ; NEC: AX=左 (FFFF)
        je      .pressed
        cmp     ax, 1           ; ビットフィールドを AX に返す変種も保険で拾う
        je      .pressed
        cmp     ax, 2
        je      .pressed
        test    bx, bx          ; MS: BX=ビットフィールド / NEC: BX=右 (FFFF)
        ret                     ; ZF = (BX==0)
.pressed:
        or      sp, sp          ; ZF=0 (SP は非 0)
        ret

; fn3 を呼んで dump
fn3dump:
        call    fn3
        ; fallthrough

; AX/BX/CX/DX を [di] へ 8 byte 記録
dump4:
        mov     [di], ax
        mov     [di+2], bx
        mov     [di+4], cx
        mov     [di+6], dx
        add     di, 8
        ret

        align 16
        db      0                   ; dumpbuf-1 = 完走センチネル置き場
dumpbuf:
        times 80 dw 0xDEAD
