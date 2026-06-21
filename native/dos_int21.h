/*
 * Phase 3 ローダ — INT 21h ハンドラ。dos_loader.c の qb_dos_int21_hook() から呼ばれる。
 * 関数ごとに分けず、AH ベースで switch して一本でディスパッチする。
 *
 * 実装範囲 (T1-T5): 01h-0Ch コンソール / 19h/1Ah/25h/2Ah/2Ch/2Fh/30h/33h/35h /
 * 3Ch-44h ファイル系 / 47h / 48h-4Ah メモリ (MCB チェーン) / 4Bh EXEC / 4Ch/4Dh /
 * 4Eh/4Fh 検索 — 詳細は dos_int21.c 冒頭コメント参照。
 */

#ifndef QB_DOS_INT21_H
#define QB_DOS_INT21_H

#include <stdint.h>

void qb_dos_int21_dispatch(void);  /* CPU_AX 等を直接読んで実行 */

/* tty (text VRAM 風出力) のカーソル位置を (0,0) に戻す。新 image 起動前に呼ぶ。
 * BIOS POST は VRAM 自体は clear するが、我々の static cursor は独立なので
 * 明示リセットしないと連続実行で 1 行ずつズレる。 */
void qb_dos_tty_reset(void);

/* tty へ生バイト列を書く (SJIS / ESC シーケンスは tty_putc が解釈)。.bat 文インタプリタ
 * (dos_loader.c) が echo 文の作者メッセージを表示するのに使う。 */
void qb_dos_tty_write(const uint8_t *bytes, int len);

/* ホスト (ブラウザ) の IME で確定した Shift-JIS バイト列をゲストの注入 FIFO に積む。FIFO は
 * inject_pump で実 BIOS キーバッファ (0x502) へペース供給され、BIOS INT 18h / DOS 文字入力 /
 * AH=0Ah が一律に受け取る (FEP 確定文字列の流し込み相当)。 */
void qb_dos_inject_input(const uint8_t *bytes, int len);

/* 注入 FIFO→BIOS キーバッファ (0x502) のペース供給を 1 回行う。BIOS INT 18h 直読みアプリ向けに
 * np2kai_run_frame から毎フレーム呼ぶ (DOS 文字入力経路は dos_next_input_byte が自前で補充する)。 */
void qb_dos_inject_pump(void);

/* DTA (Disk Transfer Address) の get/set。EXEC の親/子 DTA 退避・復元に dos_loader.c
 * が使う (DTA は本来プロセスごとだが我々は 1 本しか持たないため明示的に切り替える)。 */
uint32_t qb_dos_dta_get_packed(void);   /* (seg << 16) | off */
void     qb_dos_dta_set(uint16_t seg, uint16_t off);

/* EXEC 子プロセスのファイルハンドル掃除 (dos_loader.c が EXEC/子終了で使う)。
 * snapshot = EXEC 時点の open 中ユーザハンドル bitmask。子終了で「それ以降に
 * 開いたハンドル」だけ閉じる (実 DOS の free-on-terminate 相当。TSR では呼ばない)。 */
uint32_t qb_dos_fh_snapshot(void);
void     qb_dos_fh_close_since(uint32_t snapshot);

/* DOS パスで論理カレント (g_cwd) を変更する。.bat の cd と AH=3Bh CHDIR が共用。
 * raw_dos = "\iv" / "..\x" / "A:\y" (バックスラッシュ/ドライブ接頭可)。
 * 戻り値 0=成功 / 3=path not found。 */
int qb_dos_chdir(const char *raw_dos);

#endif /* QB_DOS_INT21_H */
