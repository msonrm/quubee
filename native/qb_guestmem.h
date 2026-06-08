/*
 * qb_guestmem.h — ゲスト RAM (NP2kai `mem[]`) アクセスの共有ヘルパー。
 *
 * 2 系統を提供する:
 *   (A) 生アクセス poke8/peek8 系 — PSP/IVT/env/DTA/FCB 等「構造化された小さな書き込み」用。
 *       VRAM は通らない前提 (VRAM 宛なら下の (C) を使うこと)。dos_int21.c / dos_loader.c で共有。
 *   (C) VRAM 対応バルク転送 qb_mem_read/qb_mem_write 系 — DOS の read/write (INT 21h AH=3Fh/40h)・
 *       XMS Move など「宛先/元が VRAM になり得るバルク転送」用。
 *
 * なぜ (C) が要るか: PC-98 の VRAM 窓へ書く/から読む時は、生の mem[] 直アクセスではなく NP2kai の
 * 正規 CPU アクセス memp_write8/memp_read8 を通すこと。これらは memvga/PEGC の GRCG/EGC 処理と
 * 「表示 dirty」を発火させる。生 mem[] 直書きだと:
 *   (a) グラフィック面が再描画されない (テキスト面 dirty 問題のグラフィック版)、
 *   (b) GRCG read 経路と不整合になり、VRAM へ画像を直 read/copy してそこで自前展開するソフトが
 *       破綻する (Ray IV オープニング RAY_IV.RAY の黒画面・無限スピンの真因, 2026-06-08)。
 *
 * 前提: includer 側で <i386c/cpumem.h> (mem[], memp_read8/write8, REG8) と "dos_loader.h"
 *       (QB_GUEST_MEM_MASK) が見えていること。念のためここでも include する。
 */
#ifndef QB_GUESTMEM_H
#define QB_GUESTMEM_H

#include <stdint.h>
#include <string.h>
#include <i386c/cpumem.h>    /* mem[], memp_read8, memp_write8, REG8 */
#include "dos_loader.h"       /* QB_GUEST_MEM_MASK */

/* ===== (A) 生アクセス (構造化された小書き込み用、VRAM は通らない前提) ===== */
static inline void poke8(uint32_t a, uint8_t v)  { mem[a & QB_GUEST_MEM_MASK] = v; }
static inline void poke16(uint32_t a, uint16_t v){ poke8(a, (uint8_t)v); poke8(a + 1, (uint8_t)(v >> 8)); }
static inline void poke32(uint32_t a, uint32_t v){ poke16(a, (uint16_t)v); poke16(a + 2, (uint16_t)(v >> 16)); }
static inline uint8_t  peek8(uint32_t a)  { return mem[a & QB_GUEST_MEM_MASK]; }
static inline uint16_t peek16(uint32_t a) { return (uint16_t)peek8(a) | ((uint16_t)peek8(a + 1) << 8); }

/* ===== (B) PC-98 VRAM 窓の判定 =====
 * テキスト/属性/CG 窓 0xA0000-0xA7FFF・グラフィック 0xA8000-0xBFFFF・輝度(E)プレーン 0xE0000-0xE7FFF。
 * memp_read8/write8 が各領域 (memvga0/PEGC/text) を正しく振り分ける。 */
static inline int qb_addr_is_vram(uint32_t a) {
    a &= QB_GUEST_MEM_MASK;
    return (a >= 0xA0000u && a < 0xC0000u) || (a >= 0xE0000u && a < 0xE8000u);
}
/* [s, s+len) が VRAM 窓と少しでも重なるか。 */
static inline int qb_range_hits_vram(uint32_t s, uint32_t len) {
    uint32_t e = s + len;
    return ((s < 0xC0000u) && (e > 0xA0000u)) || ((s < 0xE8000u) && (e > 0xE0000u));
}

/* ===== (C) VRAM 対応バルク転送 ===== */

/* 1 バイト書き: VRAM 宛は memp_write8 経由 (GRCG/EGC + 表示 dirty)、他は生 mem[]。 */
static inline void qb_mem_put8(uint32_t a, uint8_t v) {
    a &= QB_GUEST_MEM_MASK;
    if (qb_addr_is_vram(a)) memp_write8(a, (REG8)v);
    else                    mem[a] = v;
}
/* 1 バイト読み: VRAM 元は memp_read8 経由 (GRCG read モードを反映)、他は生 mem[]。 */
static inline uint8_t qb_mem_get8(uint32_t a) {
    a &= QB_GUEST_MEM_MASK;
    return qb_addr_is_vram(a) ? (uint8_t)memp_read8(a) : mem[a];
}

/* dst へ src から len バイト書く。VRAM 窓に少しでも掛かる転送はバイト単位で memp_write8 経由、
 * 非 VRAM は memmove 一括 (自己重なり安全・高速、XMS Move の overlap を保持)。
 * 注: VRAM 宛は前進バイトコピー。VRAM 内自己重なりは想定外 (DOS read / XMS Move とも src は VRAM 外)。 */
static inline void qb_mem_write(uint32_t dst, const uint8_t *src, uint32_t len) {
    uint32_t s = dst & QB_GUEST_MEM_MASK;
    if (qb_range_hits_vram(s, len)) {
        for (uint32_t i = 0; i < len; i++) qb_mem_put8(dst + i, src[i]);
    } else {
        memmove(&mem[s], src, len);
    }
}
/* src から dst へ len バイト読む。VRAM 窓に少しでも掛かる読みはバイト単位で memp_read8 経由、
 * 非 VRAM は memcpy 一括。dst はホスト側バッファ (mem[] 外) 想定。 */
static inline void qb_mem_read(uint32_t src, uint8_t *dst, uint32_t len) {
    uint32_t s = src & QB_GUEST_MEM_MASK;
    if (qb_range_hits_vram(s, len)) {
        for (uint32_t i = 0; i < len; i++) dst[i] = qb_mem_get8(src + i);
    } else {
        memcpy(dst, &mem[s], len);
    }
}

#endif /* QB_GUESTMEM_H */
