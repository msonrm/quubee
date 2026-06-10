/*
 * Phase 3 ミニマル DOS ローダ — bridge.c / dos_int21.c から共有する宣言。
 *
 * トランポリン番地 (BIOS RAM 領域 0xF8000-0xFFFFF 内、既存ハンドラと衝突しない位置):
 *   0xFEE00 : loader-start フック (boot sector から far jmp で踏まれる)
 *   0xFEE10 : INT 21h ディスパッチャ (NOP + IRET)
 *   0xFEE20 : INT 20h (= DOS exit ショートカット) (NOP + IRET)
 *   0xFEE30 : HLT ループ (image 終了後の停止用)
 *   0xFEE40 : IRET-only stub (未使用 software INT の安全停止用、IVT[0x22..0xFF] の
 *             未初期化エントリをここに向ける。INT 33h 等の事故防止)
 *   0xFEE50 : INT 2Fh (XMS インストールチェック AX=43xx)
 *   0xFEE60 : INT 67h (EMS 検出)
 *   0xFEE70 : XMS (HIMEM 相当) ドライバ entry (far CALL なので NOP + RETF)
 *   0xFEE80 : INT 29h (DOS 高速文字出力、master.lib text_clear の ESC[2J 用)
 *   0xFEE90 : .bat 文インタプリタ「次コマンド?」(シェルの far CALL、NOP + RETF)
 * (各番地の詳細は下の QB_TRAMP_* マクロ定義を参照。これが正本)
 *
 * IVT セットアップ後、ゲーム image は CS:IP = 0x0100:0x0100 (COM) か
 * image_base + e_cs : e_ip (EXE) から実行開始。
 */

#ifndef QB_DOS_LOADER_H
#define QB_DOS_LOADER_H

#include <stdint.h>
#include <stddef.h>

/* トランポリン番地 (linear address)。物理 segment F000、offset EExx。
 * 例: F000:EE00 → linear = (0xF000 << 4) + 0xEE00 = 0xFEE00
 *
 * 既存 NP2kai BIOS は次の番地を予約済 — 衝突しない場所を選ぶ:
 *   - 0xFD800-0xFEC37: biosfd80.res の中身 (約 5KB の BIOS ROM 模擬)
 *   - 0xFFFE8/0xFFFEC: bootstrap entry (NOP+RETF, ROM 初期化時に設置)
 *   - 0xFFFF0:         reset vector (JMP FAR FD80:0000)
 * → 我々は 0xFEE00 以降の空き領域に置く。 */
#define QB_TRAMP_LOADER_START   0xFEE00u  /* F000:EE00 */
#define QB_TRAMP_INT21          0xFEE10u  /* F000:EE10 */
#define QB_TRAMP_INT20          0xFEE20u  /* F000:EE20 */
/* 終了 (INT 21h AH=4Ch / INT 20h) 後に CPU を停止させる HLT ループ */
#define QB_TRAMP_HALT_LOOP      0xFEE30u  /* F000:EE30 */
/* "未使用の software INT" 用の素の IRET スタブ (NOP なしで biosfunc を呼ばない、
 * ただ単に IRET して戻る)。同じ NOP+IRET だと毎回 biosfunc 経由になり重い + ログが
 * 騒がしい + UNIMPL 警告が出るので別経路。 */
#define QB_TRAMP_IRET_STUB      0xFEE40u  /* F000:EE40 — 1 byte: 0xCF */
/* XMS/EMS 需要プローブ (2026-06-05)。INT 2Fh / INT 67h を IRET スタブから「NOP+IRET で
 * C フックを踏みログ」に格上げする計測器用。応答は従来通り「未インストール」を保つ
 * (レジスタ不変) ので回帰ゼロ。将来 XMS/EMS を HLE する時の entry 足場にもなる。 */
#define QB_TRAMP_INT2F          0xFEE50u  /* F000:EE50 — INT 2Fh (XMS AX=43xx 検出) */
#define QB_TRAMP_INT67          0xFEE60u  /* F000:EE60 — INT 67h (EMS 検出) */
/* XMS (HIMEM 相当) ドライバ entry。INT 2Fh AX=4310h が ES:BX=F000:EE70 として返す far アドレス。
 * INT で踏まれず far CALL されるので NOP + RETF (0xCB)。NOP が biosfunc→qb_dos_xms_entry_hook を踏む。 */
#define QB_TRAMP_XMS_ENTRY      0xFEE70u  /* F000:EE70 */
/* INT 29h (DOS 高速文字出力)。AL を CON へ。master.lib text_clear() が "ESC[2J" を
 * INT 29h で送って画面消去するため、未実装(IRET スタブ)だと text_clear が無効化され
 * テキストが残留する。NOP+IRET で C フック (AL→tty_putc) を踏む。 */
#define QB_TRAMP_INT29          0xFEE80u  /* F000:EE80 */
/* .bat 文インタプリタの「次コマンド?」entry。ミニ COMMAND.COM (shell.asm) が各コマンド後に
 * far CALL するので NOP + RETF。C フック (qb_dos_batch_next_hook) が文テーブルを解釈し
 * AX=1 + DX=path_off + CX=tail_off (次の EXEC) か AX=0 (列が尽きた → 4Ch) を返す。 */
#define QB_TRAMP_BATCH_NEXT     0xFEE90u  /* F000:EE90 */

/* PSP/COM のロードセグメント (PSP 自体もここに置く)。
 * EXE は PSP の直後 (256 byte = 16 paragraphs 先) に image を配置する慣例。 */
#define QB_DOS_LOAD_SEG         0x0100u
#define QB_DOS_EXE_IMAGE_SEG    0x0110u
/* 環境セグメント。PSP[0x2C] = この値。実機 DOS では program path 等が
 * 入っているので、ここを空 + program path だけの最小 env として作る。
 * PSP の直前 (0x00F0:0000 = linear 0x0F00、256 byte 確保) に配置。
 * 当該領域は BIOS data area 後の DOS work area で、我々は他用途なし。 */
#define QB_DOS_ENV_SEG          0x00F0u

/* ゲスト RAM (NP2kai `mem[0x200000]` = 2MB 固定配列) のアドレスマスク。
 * poke/peek の linear アドレスをこの境界に収める。リアルモードの最大線形
 * アドレスは 0xFFFF:0xFFFF = 0x10FFEF (1MB+64KB) なので 2MB に余裕で収まり、
 * かつ 1MB 境界での誤ラップ (旧 dos_int21.c の `& 0xFFFFF` = HMA を低位へ折り返す
 * 潜在バグ) を起こさない。配列範囲外アクセス (Wasm では即トラップ) の安全ネットも兼ねる。
 * 注: 値は mem[] のサイズ (cpumem.h: `mem[0x200000]`) と一致させること。 */
#define QB_GUEST_MEM_MASK       0x1FFFFFu

/* image 種別 */
typedef enum {
    QB_DOS_IMG_NONE = 0,
    QB_DOS_IMG_COM  = 1,
    QB_DOS_IMG_EXE  = 2,
} qb_dos_image_kind;

/* image staging — JS bridge から呼ばれる。次回 loader-start フック発火時に
 * メモリへ展開される。cmdline / name は NULL 可。
 * name は image の表示名 (例 "DEPTH.EXE")。argv[0] = "A:\<basename>" の生成に使う。
 * COM: size 上限は 64KB - PSP - stack 程度。
 * EXE: body (header strip 後) が 640KB (PC-98 基本メモリ上限) 以下。
 * 戻り値 0 = OK、< 0 = エラー。 */
int qb_dos_stage_com(const uint8_t *image, size_t size, const char *cmdline,
                     const char *name);
int qb_dos_stage_exe(const uint8_t *image, size_t size, const char *cmdline,
                     const char *name);

/* Phase 3 ②: 起動 .bat を「1 DOS セッション内で順に EXEC」するミニ COMMAND.COM を
 * 最上位プログラムとして stage する。シェル (tools/dos_loader/shell.asm の blob) の末尾に
 * コマンド表を組んで COM として展開し、シェルが各コマンドを AH=4Bh EXEC する。子の TSR
 * (音源ドライバ等) は既存 AH=31h でそのまま常駐継続するので、driver→game→driver -r の
 * 同一セッション逐次実行 (= 実 DOS の COMMAND.COM /C batch 相当) が成立する。
 *   script = "PATH\tARGS\nPATH\tARGS\n…" (タブ=パス/引数、改行=コマンド区切り、ARGS 省略可)。
 *            PATH は /run 相対 (AH=4Bh が case-insensitive 解決して fopen する)。
 *            SJIS ダメ文字名を壊さないよう NUL 終端でなく len 指定の生バイトで渡す。
 *   name   = 表示/argv[0] 用 (例 "GAME")。NULL 可。
 * 子イメージのバイトは渡さない (展開済 /run から AH=4Bh が読む)。
 * 戻り値 0=OK、<0=エラー (-1 引数不正 / -2 0 コマンド / -11 image がシェル保持領域に収まらない)。 */
int qb_dos_stage_script(const char *script, size_t len, const char *name);

/* ③ if errorlevel / goto 入り .bat: JS (batscript.js buildStatements → serializeStatements) の
 * 直列化文列を stage する。文形式 (\n 区切り、フィールドは \t 区切り、TEXT/ARGS は生バイト):
 *   C \t PATH \t ARGS      EXEC するコマンド (PATH は /run 相対)
 *   E \t TEXT              echo (tty へ表示、SJIS 可)
 *   G \t TARGET            無条件 goto (TARGET = 文 index、文数 = 終了)
 *   I \t N \t NEG \t TARGET   if [not] errorlevel N goto TARGET
 * シェル + 文字列プールを stage し、文テーブルはホスト側に保持。シェルが実行中に
 * far CALL (QB_TRAMP_BATCH_NEXT) で問い合わせ、qb_dos_batch_next_hook が errorlevel
 * (= 直近 EXEC 子の終了コード) を遅延評価して次コマンドを返す。
 * 戻り値 0=OK / <0=エラー (dos_loader.c の定義参照)。エラー時は stage されない。 */
int qb_dos_stage_batch(const char *prog, size_t len, const char *name);

/* 「次コマンド?」フック (0xFEE90 で biosfunc から呼ばれる)。常に 1 を返す。 */
int qb_dos_batch_next_hook(void);

/* loader-start フック (0xFEE00 で biosfunc から呼ばれる)。
 * 戻り値: 1 = CPU 状態を書き換えたので caller は return(1) すること
 *         0 = stage されていないので素通り */
int qb_dos_loader_start_hook(void);

/* AH=4Bh EXEC 子ロード (親常駐・子をアリーナの最大空きブロックに置いて CPU 切替)。
 * image=子イメージ (MZ/ZM ヘッダなら EXE、それ以外は COM として PSP:0x100 にロード)、
 * cmdtail=子 PSP[0x80] に入れるコマンドテイル (先頭スペース込み可)、
 * env_seg=パラメータブロック由来の環境セグメント (0 なら親 env 継承)、
 * child_name=子の basename (argv[0] を "A:\\NAME" に正規化するのに使う。NULL/空なら既定)。
 * fcb1_lin/fcb2_lin=EXEC パラメータブロックの FCB1/FCB2 linear addr (0=複写しない)。
 *   子 PSP の 0x5C/0x6C へ 16B 複写する (親が AH=29h で組んだ FCB を子へ渡す経路)。
 * 戻り値 0=成功、<0=失敗。 */
int qb_dos_exec_load(const uint8_t *image, size_t size,
                     const char *cmdtail, uint16_t env_seg,
                     const char *child_name,
                     uint32_t fcb1_lin, uint32_t fcb2_lin);

/* AH=4Bh AL=03h Load Overlay。子イメージを呼び出し元が指定した load_seg:0000 にロードし、
 * EXE の relocation は reloc_factor を各セグメントワードに加算して適用する。AL=00 と違い PSP は
 * 作らず CPU も切り替えず、呼び出し元へそのまま返る (呼び出し元が overlay へ far call する)。
 * 東方封魔録の op.exe がオープニング後に main.exe を overlay 読み込みして本編へ遷移する経路で必要。
 * 戻り値 0=成功、<0=失敗 (呼び出し側で DOS error にマップ)。 */
int qb_dos_overlay_load(const uint8_t *image, size_t size,
                        uint16_t load_seg, uint16_t reloc_factor);

/* AH=31h Keep Process (TSR): 子を keep_paras パラグラフに縮めて常駐させ、親へ復帰。
 * code = 子の終了コード (AL)。Ray の RIN.COM 等の常駐ドライバ用。
 * 戻り値 1=親復帰 (CPU リダイレクト済)、0=最上位プログラム (halt 扱い)。 */
int qb_dos_signal_tsr(uint16_t keep_paras, int code);

/* 現在実行中プロセスの PSP segment (AH=4Ah の self-shrink 判定に使う)。 */
uint16_t qb_dos_cur_psp(void);

/* INT 21h ディスパッチャ (0xFEE10 で biosfunc から呼ばれる)。常に 1 を返す。 */
int qb_dos_int21_hook(void);

/* INT 20h (DOS exit ショートカット) (0xFEE20 で biosfunc から呼ばれる)。常に 1。 */
int qb_dos_int20_hook(void);

/* XMS/EMS 需要プローブのフック (0xFEE50 / 0xFEE60 で biosfunc から呼ばれる)。検出だけして
 * ログ+カウントし、レジスタは変えず (= 未インストール応答を維持) 1 を返す。 */
int qb_dos_int2f_hook(void);   /* INT 2Fh: AX=43xx (XMS インストールチェック) を記録/応答 */
int qb_dos_int67_hook(void);   /* INT 67h: EMS 呼び出しを記録 */

/* XMS ドライバ entry フック (0xFEE70 で biosfunc から呼ばれる)。qb_xms_dispatch へ委譲。 */
int qb_dos_xms_entry_hook(void);

/* 需要プローブのカウンタ取得 (bridge → qbDebug.memprobe)。which: 0=XMS / 1=EMS / 2=EMMXXXX0 open。
 * カウンタは Run 毎 (loader-start) にリセットされ、現タイトルの要求回数を表す。 */
uint32_t qb_dos_memprobe_count(int which);
/* dos_int21 の AH=3Dh open が "EMMXXXX0" デバイスを開こうとした時に呼ぶ (EMS 検出の別経路)。 */
void qb_dos_memprobe_note_emm_open(void);

/* exit 状態の取得 (JS bridge から polling)。
 * 0 = まだ動作中、1 = INT 21h AH=4Ch / INT 20h で終了済み。
 * `code_out` が non-NULL なら exit code を書き込む。 */
int qb_dos_get_exit(int *code_out);

/* 1 = image が CPU で実行中 (loader-start hook 発火後、exit 前)。0 = それ以外。 */
int qb_dos_is_running(void);

/* INT 21h AH=48h/49h/4Ah 用の DOS メモリマネージャ (MCB チェーン)。
 * ゲストメモリに 'M'/'Z'+所有者 PSP+サイズ の Memory Control Block を実体として
 * 置き、アリーナ (プログラム末尾〜0xA000) を first-fit + coalesce + 分割で管理する。
 * loader-start で `qb_dos_alloc_reset(arena_base_para)` で初期化し、最上位プログラム
 * の 4Ah self-shrink がアリーナ起点を確定する。EXEC の子割当・子終了時の一括解放も
 * このチェーンで行う。 */
void qb_dos_alloc_reset(uint16_t arena_base_para);
/* paragraphs = 要求セグメント数。
 * 戻り値 0 = OK (out_seg にセグメント値)
 *        -1 = 不足 (out_largest_free に最大利用可能 paragraphs) */
int qb_dos_alloc_request(uint16_t paragraphs,
                         uint16_t *out_seg,
                         uint16_t *out_largest_free);
/* AH=49h: ES-1 の MCB を空きにする。0 = OK、-1 = 無効ブロック。 */
int qb_dos_alloc_free(uint16_t seg);
/* AH=4Ah: ブロックの拡大/縮小。seg==最上位 PSP は self-shrink (アリーナ起点確定)。
 * 0 = OK、-1 = 拡大不能 (out_largest に最大可能サイズ)。 */
int qb_dos_alloc_resize(uint16_t seg, uint16_t newparas, uint16_t *out_largest);
/* プロセス終了時: その PSP が所有する全ブロックを解放する (DOS free-on-terminate)。 */
void qb_dos_alloc_free_owner(uint16_t psp);

/* AH=58h メモリ確保ストラテジ (0=first-fit / 1=best-fit / 2=last-fit、上位ビット=UMB は無視)。
 * last-fit はメモリ上端から確保するゲームが多用する (PSP ブロックを直上へ拡大する余地を残す慣用)。 */
void     qb_dos_set_alloc_strategy(uint16_t strat);
uint16_t qb_dos_get_alloc_strategy(void);

/* exit 状態をクリア (新しい image をロードする前に呼ぶ) */
void qb_dos_reset_state(void);

/* トランポリン (NOP + IRET/RETF/HLT 等) を BIOS area に書き込む。
 * NP2kai の bios_initialize() から毎リセットごとに呼ばれる。
 * これがないと、boot sector が F000:EE00 に jmp しても NOP がなくて
 * biosfunc が呼ばれない。 */
void qb_dos_install_trampolines(void);

#endif /* QB_DOS_LOADER_H */
