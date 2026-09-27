/* dos_batch.h — .bat を実行時に 1 行ずつ解釈する (ミニ COMMAND.COM の頭脳)。
 *
 * シェル (tools/dos_loader/shell.asm) が「次コマンド?」を問い合わせるたびに、C が .bat の次の行を
 * 読んで %0〜%9・%VAR% を展開し、内部コマンドはその場で実行、外部プログラムなら EXEC するパスと
 * コマンドテイルを返す。制御構文 (IF・GOTO・CALL・SHIFT・FOR…) も実行時に評価する = 実 DOS の
 * COMMAND.COM と同じ意味論 (2026-09-27、旧 JS 事前線形化 buildStatements の置き換え)。 */
#ifndef DOS_BATCH_H
#define DOS_BATCH_H

#include <stddef.h>
#include <stdint.h>

/* 実行を始める。bat_dos = 起動する .bat の DOS パス (/run 相対、'\\' 区切り可)、args = ユーザー引数。
 * 0 = 成功 / 負 = .bat が読めない等。シェルの stage 後に呼ぶ (stage が状態を消すため)。 */
int  qb_batch_begin(const char *bat_dos, const char *args);
int  qb_batch_active(void);
void qb_batch_reset(void);

/* 次にシェルがすること。戻り値 1 = EXEC (path_out = ルート起点の DOS パス、tail_out = コマンドテイル本文) /
 * 0 = 終わり / 3 = PAUSE (キーを 1 つ待って再問い合わせ)。 */
int  qb_batch_next(char *path_out, size_t pcap, char *tail_out, size_t tcap);

/* シェルの作業領域 (シェルのセグメント内のオフセット)。設定するとこのセッションは実行時解釈を使う */
int      qb_batch_rt(void);
void     qb_batch_set_scratch(uint16_t path_off, uint16_t tail_off);
uint16_t qb_batch_scratch_path(void);
uint16_t qb_batch_scratch_tail(void);

#endif
