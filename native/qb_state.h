/* qb_state.h — ステートセーブの QuuBee 側区画の読み書き道具 (フェーズ 2)。
 *
 * NP2kai の状態は statsave (bridge.c の np2kai_state_np2_*) が持つ。ここは HLE-DOS 等、QuuBee が
 * C の静的変数に持つ状態のための入れ物。形式:
 *   "QBST" u32 形式版 | 区画 ... (区画 = タグ 4 文字 + u32 区画版 + u32 長さ + 中身)
 * 区画は長さを持つので、読み手は知らない区画を読み飛ばせる。区画版が合わなければその区画の
 * 読み込み関数が変換するか失敗する。
 *
 * 変数は qb_sw_var / qb_sr_var で「u32 大きさ + 中身」として書く。読むときに大きさが一致しなければ
 * 失敗にする = 構造体の配置が変わったセーブを黙って誤読しない (配置を変えたら区画版を上げる)。
 * ポインタ (FILE* / DIR*) は書かない。各モジュールがパス等から作り直す。 */
#ifndef QB_STATE_H
#define QB_STATE_H

#include <stddef.h>
#include <stdint.h>

#define QB_STATE_MAGIC   "QBST"
#define QB_STATE_FORMAT  1u

typedef struct {
    uint8_t *buf;
    size_t   len, cap;
    int      err;          /* 確保失敗 */
} qb_sw;

typedef struct {
    const uint8_t *p;
    size_t         n, pos;
    int            err;    /* 途中で足りなくなった / 大きさの食い違い */
} qb_sr;

void   qb_sw_bytes(qb_sw *w, const void *p, size_t n);
void   qb_sw_u32(qb_sw *w, uint32_t v);
void   qb_sw_blob(qb_sw *w, const void *p, size_t n);          /* u32 大きさ + 中身 */
size_t qb_sw_begin(qb_sw *w, const char tag[4], uint32_t ver); /* 区画の開始 (戻り値を end へ) */
void   qb_sw_end(qb_sw *w, size_t mark);                        /* 区画の長さを確定 */
#define qb_sw_var(w, v) qb_sw_blob((w), &(v), sizeof(v))

void     qb_sr_bytes(qb_sr *r, void *p, size_t n);
uint32_t qb_sr_u32(qb_sr *r);
void     qb_sr_blob(qb_sr *r, void *p, size_t n);   /* 大きさが n でなければ err */
#define qb_sr_var(r, v) qb_sr_blob((r), &(v), sizeof(v))

/* 区画を探して *sec に中身だけの読み手を作る。見つかれば 1 (*ver に区画版)、無ければ 0。
 * blob は "QBST" ヘッダを含む全体。 */
int qb_sr_section(const uint8_t *blob, size_t n, const char tag[4], qb_sr *sec, uint32_t *ver);

/* ---- 各モジュールの区画 (実装は各 .c)。戻り値 0 = 成功 / 負 = 失敗 ---- */
int qb_dos_int21_state_save(qb_sw *w);
int qb_dos_int21_state_load(const uint8_t *blob, size_t n);
int qb_dos_loader_state_save(qb_sw *w);
int qb_dos_loader_state_load(const uint8_t *blob, size_t n);
int qb_xms_state_save(qb_sw *w);
int qb_xms_state_load(const uint8_t *blob, size_t n);
int qb_mouse33_state_save(qb_sw *w);
int qb_mouse33_state_load(const uint8_t *blob, size_t n);
int qb_sound_state_save(qb_sw *w);
int qb_sound_state_load(const uint8_t *blob, size_t n);
int qb_midi_state_save(qb_sw *w);
int qb_midi_state_load(const uint8_t *blob, size_t n);
int qb_batch_state_save(qb_sw *w);
int qb_batch_state_load(const uint8_t *blob, size_t n);
int qb_fep_busy(void);   /* FEP の変換を表示中なら 1 (セーブを断る) */

#endif
