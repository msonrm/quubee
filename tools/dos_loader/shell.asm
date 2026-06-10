; QuuBee ミニ COMMAND.COM — 起動 .bat を「1 つの DOS セッション内で順に EXEC」するシェル。
;
; 役割 (Phase 3 ②/③): PC-98 フリーソフトの起動 .bat は約 1/3 が
;     音源ドライバ TSR を常駐 → ゲーム本体 → ドライバ -r で解除
;   という「1 セッション内の逐次実行」を前提にし、さらに一部 (封魔録 GAME.BAT 等) は
;     if errorlevel N goto / :label / goto
;   の分岐ラダーで音源ドライバを選ぶ。Run 毎に pccore_reset で別 DOS セッションになる
;   我々の構造では、別 Run でドライバを常駐させてもゲームには効かない。そこでこの小さな
;   シェルを最上位プログラムとして起動し、コマンドを順に AH=4Bh EXEC する。子の TSR
;   (AH=31h) は既存機構でそのまま常駐し続けるので、実 DOS の `COMMAND.COM /C batch` と
;   同じ理屈でドライバ常駐が成立する。
;
; 制御フロー (どのコマンドを次に実行するか) は C 側の文インタプリタが持つ:
;   このシェルは各コマンドの前に F000:EE90 (QB_TRAMP_BATCH_NEXT) を far CALL して
;   「次コマンド?」を問い合わせる。C (qb_dos_batch_next_hook, native/dos_loader.c) が
;   文テーブル (cmd/echo/goto/iferr) を解釈し、
;     AX=1: 次の EXEC あり — DX=path オフセット / CX=cmdtail オフセット (本セグメント内)
;     AX=0: 列が尽きた — AH=4Ch でセッション終了
;   を返す。errorlevel 分岐は C が直近 EXEC 子の終了コードで遅延評価する (実 DOS の意味論)。
;   echo もこの問い合わせの中で C が tty へ流す。
;
;   文字列領域 (ASCIZ パス群 + DOS コマンドテイル群 [len][bytes][0Dh]) は
;   native/dos_loader.c (stage_shell_image) が末尾 (strings:) に append する。
;
; assemble: nasm -f bin shell.asm -o shell.bin   (build.sh が native/dos_shell_blob.h を生成)

BITS 16
ORG 0x0100

; 自己縮小して残りを子に渡す。KEEP_PARAS = 保持するパラグラフ数 (PSP 含む)。
; 0x200 para = 8KB。コード+文字列 (数百 byte) と退避後スタックを十分収める。
; 子はアリーナ (0x100+KEEP = 0x0300 〜 0xA000 ≈ 632KB) を使える。
KEEP_PARAS  equ 0x0200
KEEP_BYTES  equ KEEP_PARAS * 16          ; = 0x2000

start:
    ; ES = このセグメント (パラメータブロック・文字列は全部ここ)。
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

    ; --- C インタプリタに次コマンドを問い合わせながら EXEC を繰り返す ---
.next:
    ; far CALL → F000:EE90 の NOP が biosfunc を踏み qb_dos_batch_next_hook が
    ; AX/DX/CX を設定して RETF で戻る (XMS entry 0xFEE70 と同じ NOP+RETF パターン)。
    ; レジスタは毎周この問い合わせで取り直すので、EXEC 子側で何が起きても影響しない。
    call    0xF000:0xEE90                ; = QB_TRAMP_BATCH_NEXT (native/dos_loader.h)
    test    ax, ax
    jz      .done                        ; AX=0: 列が尽きた

    mov     [pb_tail_off], cx            ; CX = cmdtail オフセット → パラメータブロック +2
    mov     bx, pblock                   ; ES:BX = EXEC パラメータブロック
    mov     ax, 0x4B00                   ; AH=4Bh AL=00 (load & execute)、DS:DX = path
    int     0x21                         ; 失敗 (CF=1) でも続行 = 次コマンドへ (errorlevel 不変)
    jmp     .next

.done:
    mov     ax, 0x4C00                   ; 全コマンド完了 → セッション終了
    int     0x21
.hang:                                   ; 念のため: 4Ch が戻ったら停止
    hlt
    jmp     .hang

; ---- EXEC パラメータブロック (ES:BX) ----
; +0 env seg (0 = 子は親 env 継承、C 側 build_child_env が子固有 env を作って argv[0] を
;   子パスに正規化する) / +2 cmdtail far-ptr (off,seg) / +6,+0xA FCB ptr (未使用)
align 2
pblock:
pb_env:         dw 0                     ; +0  環境セグメント (0=継承)
pb_tail_off:    dw 0                     ; +2  cmdtail オフセット (コマンド毎に設定)
pb_tail_seg:    dw 0                     ; +4  cmdtail セグメント (起動時に CS をセット)
pb_fcb1_off:    dw 0                     ; +6  FCB1 (HLE-DOS は無視)
pb_fcb1_seg:    dw 0                     ; +8
pb_fcb2_off:    dw 0                     ; +0xA FCB2 (HLE-DOS は無視)
pb_fcb2_seg:    dw 0                     ; +0xC

; ---- 文字列領域 (C が append。ここにはバイトを置かない = strings オフセット確定用ラベル) ----
strings:
