; QuuBee ミニ COMMAND.COM — 起動 .bat を「1 つの DOS セッション内で順に EXEC」するシェル。
;
; 役割 (Phase 3 ②): PC-98 フリーソフトの起動 .bat は約 1/3 が
;     音源ドライバ TSR を常駐 → ゲーム本体 → ドライバ -r で解除
;   という「1 セッション内の逐次実行」を前提にする。Run 毎に pccore_reset で別 DOS
;   セッションになる我々の構造では、別 Run でドライバを常駐させてもゲームには効かない。
;   そこでこの小さなシェルを最上位プログラムとして起動し、コマンドを順に AH=4Bh EXEC
;   する。子の TSR (AH=31h) は既存機構でそのまま常駐し続けるので、実 DOS の
;   `COMMAND.COM /C batch` と同じ理屈でドライバ常駐が成立する。
;
;   コマンド表は native/dos_loader.c (qb_dos_stage_script) が末尾 (table:) に append する:
;     db  count
;     count 回: dw path_off ; dw tail_off      ; いずれも本セグメント内オフセット
;     文字列領域: ASCIZ パス群 + DOS コマンドテイル群 ([len][bytes][0Dh])
;
; 既知の割り切り: 子は env_seg=0 (継承) で起動するので argv[0] は最上位 = このシェルの
;   パスになる (C1)。mdrv98 等は argv[0] を読まないので未影響。argv[0] 依存の子が出たら
;   C 側 (qb_dos_exec_load) で per-child env を作る (別ステップ)。
;
; assemble: nasm -f bin shell.asm -o shell.bin   (build.sh が native/dos_shell_blob.h を生成)

BITS 16
ORG 0x0100

; 自己縮小して残りを子に渡す。KEEP_PARAS = 保持するパラグラフ数 (PSP 含む)。
; 0x200 para = 8KB。コード+表+文字列 (数百 byte) と退避後スタックを十分収める。
; 子はアリーナ (0x100+KEEP = 0x0300 〜 0xA000 ≈ 632KB) を使える。
KEEP_PARAS  equ 0x0200
KEEP_BYTES  equ KEEP_PARAS * 16          ; = 0x2000

start:
    ; ES = このセグメント (パラメータブロック・文字列・コマンド表は全部ここ)。
    ; SS は既にこのセグメント (loader が COM 用に CS=DS=ES=SS=PSP を設定済)。
    mov     ax, cs
    mov     es, ax
    ; スタックを KEEP 領域内へ退避してから self-shrink する。loader 既定の SP=0xFFFE は
    ; 縮小後ブロック (0x2000) の外 → そのままだと子ロードでスタックが踏まれる。SP 単独の
    ; 書き換えは 8086 で割り込み的に安全 (SS をいじらないため atomic)。
    mov     sp, KEEP_BYTES - 2           ; = 0x1FFE

    mov     [pb_tail_seg], ax            ; EXEC パラメータブロックの cmdtail far-ptr セグメント = CS

    ; --- self-shrink (AH=4Ah, ES=ブロック seg=PSP, BX=保持 para) ---
    mov     ah, 0x4A
    mov     bx, KEEP_PARAS
    int     0x21                         ; 失敗しても続行 (子に渡す空間が減るだけ)

    ; --- コマンド表を順に EXEC ---
    mov     si, table
    lodsb                                ; AL = コマンド数
    mov     cl, al
    xor     ch, ch
    jcxz    .done                        ; 0 本なら何もせず終了

.next:
    push    cx
    lodsw                                ; path オフセット → DS:DX
    mov     dx, ax
    lodsw                                ; cmdtail オフセット → パラメータブロック +2
    mov     [pb_tail_off], ax
    mov     bx, pblock                   ; ES:BX = EXEC パラメータブロック
    mov     ax, 0x4B00                   ; AH=4Bh AL=00 (load & execute)
    push    si
    int     0x21                         ; 子終了で SI/CX 等は復元される (失敗時は CF=1 で続行)
    pop     si
    pop     cx
    loop    .next

.done:
    mov     ax, 0x4C00                   ; 全コマンド完了 → セッション終了
    int     0x21
.hang:                                   ; 念のため: 4Ch が戻ったら停止
    hlt
    jmp     .hang

; ---- EXEC パラメータブロック (ES:BX) ----
; +0 env seg (0 = 子は親 env 継承) / +2 cmdtail far-ptr (off,seg) / +6,+0xA FCB ptr (未使用)
align 2
pblock:
pb_env:         dw 0                     ; +0  環境セグメント (0=継承)
pb_tail_off:    dw 0                     ; +2  cmdtail オフセット (コマンド毎に設定)
pb_tail_seg:    dw 0                     ; +4  cmdtail セグメント (起動時に CS をセット)
pb_fcb1_off:    dw 0                     ; +6  FCB1 (HLE-DOS は無視)
pb_fcb1_seg:    dw 0                     ; +8
pb_fcb2_off:    dw 0                     ; +0xA FCB2 (HLE-DOS は無視)
pb_fcb2_seg:    dw 0                     ; +0xC

; ---- コマンド表 (C が append。ここにはバイトを置かない = table オフセット確定用ラベル) ----
table:
