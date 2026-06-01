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

/* DTA (Disk Transfer Address) の get/set。EXEC の親/子 DTA 退避・復元に dos_loader.c
 * が使う (DTA は本来プロセスごとだが我々は 1 本しか持たないため明示的に切り替える)。 */
uint32_t qb_dos_dta_get_packed(void);   /* (seg << 16) | off */
void     qb_dos_dta_set(uint16_t seg, uint16_t off);

#endif /* QB_DOS_INT21_H */
