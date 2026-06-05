/*
 * dos_xms.c — XMS (HIMEM.SYS 相当) HLE / Tier 1 MVP (2026-06-05)
 *
 * 設計方針 = 「実 DOS で HIMEM.SYS がロードされている」状態を素直に再現する:
 *  - EMB は実拡張メモリ CPU_EXTMEM (32MB) のサブ領域に first-fit で確保。先頭 64KB は HMA 用に
 *    予約する (実機 HIMEM と同じく HMA は別管理。今は HMA 自体は未提供)。
 *  - Move (AH=0Bh) は物理メモリの memmove。EMB 側は CPU_EXTMEM[offset]、conventional 側 (handle=0)
 *    は mem[seg*16+off] を直接触る (HIMEM の INT 15h ブロック転送と同じく A20/セグメントを介さない物理コピー)。
 *  - Lock (AH=0Ch) は実 linear (0x100000 + offset) を返す。CPU_EXTMEMBASE = ext - 0x100000 なので
 *    ゲストが A20 を上げて linear をアクセスすれば memp_* がこの同じバイトに届く (faithful)。
 *  - 戻り値は XMS 3.0 のレジスタ契約: 成功 AX=0001h、失敗 AX=0000h かつ BL=エラーコード。
 *    (AH=00h Version と AH=07h Query A20 は別契約: それぞれ AX に版数 / A20 状態を返す)
 *
 * 未提供 (素直に「無い」と答える): HMA (AH=01/02 → BL=0x90)、UMB (AH=10/11 → BL=0xB1)、
 *   32-bit 版 query/alloc (AH=88/89)。A20 制御 (AH=03..07) は move では不要なので成功を返すのみ。
 */
#include <compiler.h>
#include <string.h>
#include <stdio.h>

#include <i386c/cpumem.h>
#include <i386c/ia32/cpu.h>

#include "dos_loader.h"   /* QB_GUEST_MEM_MASK, QB_TRAMP_XMS_ENTRY */
#include "dos_xms.h"

/* XMS 3.0 エラーコード */
#define XMS_E_NOTIMPL   0x80
#define XMS_E_HMA_NONE  0x90
#define XMS_E_NOMEM     0xA0
#define XMS_E_NOHANDLE  0xA1
#define XMS_E_BADHANDLE 0xA2
#define XMS_E_SRCHANDLE 0xA3
#define XMS_E_SRCOFF    0xA4
#define XMS_E_DSTHANDLE 0xA5
#define XMS_E_DSTOFF    0xA6
#define XMS_E_BADLEN    0xA7
#define XMS_E_NOTLOCKED 0xAA
#define XMS_E_LOCKED    0xAB
#define XMS_E_NOUMB     0xB1
#define XMS_E_BADUMB    0xB2

#define XMS_MAX_HANDLES 64
#define XMS_HMA_RESERVE 0x10000u   /* 先頭 64KB を HMA 用に予約 (EMB はこの先から) */

typedef struct {
    int      used;
    int      lockcount;
    uint32_t offset;   /* CPU_EXTMEM 内バイトオフセット */
    uint32_t size;     /* バイト */
} xms_handle_t;

static int          g_enabled = 1;             /* 既定 ON */
static xms_handle_t g_h[XMS_MAX_HANDLES];      /* index 1..63 が有効ハンドル (0 は無効) */
static uint32_t     g_pool_base = XMS_HMA_RESERVE;
static uint32_t     g_pool_end  = 0;           /* = CPU_EXTMEMSIZE (バイト) */

void qb_xms_set_enabled(int on) { g_enabled = on ? 1 : 0; }

int qb_xms_enabled(void) {
    return g_enabled && (CPU_EXTMEM != NULL) && (g_pool_end > g_pool_base);
}

void qb_xms_reset(void) {
    memset(g_h, 0, sizeof(g_h));
    g_pool_base = XMS_HMA_RESERVE;
    g_pool_end  = (CPU_EXTMEM != NULL) ? CPU_EXTMEMSIZE : 0;
}

/* ---- conventional メモリ read (move struct / handle=0 の解決に使う) ---- */
static uint16_t cmem16(uint32_t a) {
    a &= QB_GUEST_MEM_MASK;
    return (uint16_t)(mem[a] | (mem[a + 1] << 8));
}
static uint32_t cmem32(uint32_t a) {
    return (uint32_t)cmem16(a) | ((uint32_t)cmem16(a + 2) << 16);
}

/* ---- アロケータ: [g_pool_base, g_pool_end) で既存ハンドルと重ならない size バイトの
 *      最小開始オフセットを first-fit で探す。見つかれば *out=オフセットで 1、無ければ 0。 ---- */
static int xms_find_gap(uint32_t size, uint32_t *out) {
    uint32_t cur = g_pool_base;
    int moved = 1;
    while (moved) {
        moved = 0;
        if (cur + size > g_pool_end) return 0;
        for (int i = 1; i < XMS_MAX_HANDLES; i++) {
            if (!g_h[i].used) continue;
            uint32_t a = g_h[i].offset, b = g_h[i].offset + g_h[i].size;
            if (cur < b && (cur + size) > a) { cur = b; moved = 1; break; }  /* 重なる→後ろへ */
        }
    }
    if (cur + size > g_pool_end) return 0;
    *out = cur;
    return 1;
}

/* 空き総量と最大連続空きブロック (バイト) を求める。 */
static void xms_free_query(uint32_t *largest, uint32_t *total) {
    uint32_t used = 0;
    for (int i = 1; i < XMS_MAX_HANDLES; i++) if (g_h[i].used) used += g_h[i].size;
    *total = (g_pool_end - g_pool_base) - used;

    /* 最大連続空き: 候補開始点 = pool_base と各使用ブロック末尾。各点から次の使用ブロック開始までの隙間。 */
    uint32_t best = 0;
    uint32_t cand[XMS_MAX_HANDLES + 1]; int nc = 0;
    cand[nc++] = g_pool_base;
    for (int i = 1; i < XMS_MAX_HANDLES; i++) if (g_h[i].used) cand[nc++] = g_h[i].offset + g_h[i].size;
    for (int c = 0; c < nc; c++) {
        uint32_t s = cand[c];
        if (s < g_pool_base || s >= g_pool_end) continue;
        int inside = 0;
        uint32_t nextstart = g_pool_end;
        for (int i = 1; i < XMS_MAX_HANDLES; i++) {
            if (!g_h[i].used) continue;
            uint32_t a = g_h[i].offset, b = g_h[i].offset + g_h[i].size;
            if (s >= a && s < b) { inside = 1; break; }
            if (a >= s && a < nextstart) nextstart = a;
        }
        if (inside) continue;
        uint32_t gap = nextstart - s;
        if (gap > best) best = gap;
    }
    *largest = best;
}

/* move 用にアドレスを実ポインタへ解決。handle=0 は conventional (off=seg:off 遠ポインタ)、
 * それ以外は EMB。範囲外なら NULL + *err にエラーコード。 */
static uint8_t *xms_resolve(uint16_t handle, uint32_t off, uint32_t len, int is_src, int *err) {
    if (handle == 0) {
        uint32_t lin = ((off >> 16) << 4) + (off & 0xFFFFu);   /* 遠ポインタ seg:off */
        return &mem[lin & QB_GUEST_MEM_MASK];
    }
    if (handle >= XMS_MAX_HANDLES || !g_h[handle].used) {
        *err = is_src ? XMS_E_SRCHANDLE : XMS_E_DSTHANDLE; return NULL;
    }
    if (off > g_h[handle].size || len > g_h[handle].size - off) {
        *err = is_src ? XMS_E_SRCOFF : XMS_E_DSTOFF; return NULL;
    }
    return CPU_EXTMEM + g_h[handle].offset + off;
}

/* ---- XMS ディスパッチャ (entry far call) ---- */
int qb_xms_dispatch(void) {
    uint8_t ah = (uint8_t)CPU_AH;

    switch (ah) {
    case 0x00:  /* Get Version */
        CPU_AX = 0x0300;  /* XMS 3.0 (BCD) */
        CPU_BX = 0x0300;  /* internal rev */
        CPU_DX = 0x0000;  /* HMA 無し */
        break;

    case 0x08: {  /* Query Free Extended Memory (KB) */
        uint32_t largest, total;
        xms_free_query(&largest, &total);
        uint32_t lk = largest >> 10, tk = total >> 10;
        if (lk > 0xFFFF) lk = 0xFFFF;
        if (tk > 0xFFFF) tk = 0xFFFF;
        CPU_AX = (uint16_t)lk;
        CPU_DX = (uint16_t)tk;
        CPU_BL = 0x00;
        break; }

    case 0x09: {  /* Allocate Extended Memory Block (DX=KB) */
        uint32_t sz = (uint32_t)CPU_DX << 10;
        int hnd = -1;
        for (int i = 1; i < XMS_MAX_HANDLES; i++) if (!g_h[i].used) { hnd = i; break; }
        if (hnd < 0) { CPU_AX = 0; CPU_BL = XMS_E_NOHANDLE; break; }
        uint32_t off;
        if (!xms_find_gap(sz, &off)) { CPU_AX = 0; CPU_BL = XMS_E_NOMEM; break; }
        g_h[hnd].used = 1; g_h[hnd].lockcount = 0; g_h[hnd].offset = off; g_h[hnd].size = sz;
        CPU_AX = 1; CPU_DX = (uint16_t)hnd;
        break; }

    case 0x0A: {  /* Free Extended Memory Block (DX=handle) */
        uint16_t h = (uint16_t)CPU_DX;
        if (h == 0 || h >= XMS_MAX_HANDLES || !g_h[h].used) { CPU_AX = 0; CPU_BL = XMS_E_BADHANDLE; break; }
        if (g_h[h].lockcount > 0) { CPU_AX = 0; CPU_BL = XMS_E_LOCKED; break; }
        g_h[h].used = 0;
        CPU_AX = 1;
        break; }

    case 0x0B: {  /* Move Extended Memory Block (DS:SI=ExtMemMoveStruct) */
        uint32_t sa = ((uint32_t)CPU_DS << 4) + (uint16_t)CPU_SI;
        uint32_t length = cmem32(sa);
        uint16_t sh = cmem16(sa + 4);
        uint32_t so = cmem32(sa + 6);
        uint16_t dh = cmem16(sa + 10);
        uint32_t dofs = cmem32(sa + 12);
        if (length == 0) { CPU_AX = 1; break; }       /* 0 長は no-op で成功 */
        if (length & 1) { CPU_AX = 0; CPU_BL = XMS_E_BADLEN; break; }
        int err = 0;
        uint8_t *src = xms_resolve(sh, so,  length, 1, &err);
        if (!src) { CPU_AX = 0; CPU_BL = (uint8_t)err; break; }
        uint8_t *dst = xms_resolve(dh, dofs, length, 0, &err);
        if (!dst) { CPU_AX = 0; CPU_BL = (uint8_t)err; break; }
        memmove(dst, src, length);                     /* 重なりも正しくコピー */
        CPU_AX = 1;
        break; }

    case 0x0C: {  /* Lock Extended Memory Block (DX=handle) → DX:BX = linear */
        uint16_t h = (uint16_t)CPU_DX;
        if (h == 0 || h >= XMS_MAX_HANDLES || !g_h[h].used) { CPU_AX = 0; CPU_BL = XMS_E_BADHANDLE; break; }
        g_h[h].lockcount++;
        uint32_t lin = 0x100000u + g_h[h].offset;      /* CPU_EXTMEMBASE = ext-0x100000 と整合 */
        CPU_DX = (uint16_t)(lin >> 16);
        CPU_BX = (uint16_t)(lin & 0xFFFF);
        CPU_AX = 1;
        break; }

    case 0x0D: {  /* Unlock Extended Memory Block (DX=handle) */
        uint16_t h = (uint16_t)CPU_DX;
        if (h == 0 || h >= XMS_MAX_HANDLES || !g_h[h].used) { CPU_AX = 0; CPU_BL = XMS_E_BADHANDLE; break; }
        if (g_h[h].lockcount == 0) { CPU_AX = 0; CPU_BL = XMS_E_NOTLOCKED; break; }
        g_h[h].lockcount--;
        CPU_AX = 1;
        break; }

    case 0x0E: {  /* Get EMB Handle Information (DX=handle) */
        uint16_t h = (uint16_t)CPU_DX;
        if (h == 0 || h >= XMS_MAX_HANDLES || !g_h[h].used) { CPU_AX = 0; CPU_BL = XMS_E_BADHANDLE; break; }
        int freeh = 0;
        for (int i = 1; i < XMS_MAX_HANDLES; i++) if (!g_h[i].used) freeh++;
        CPU_AX = 1;
        CPU_BH = (uint8_t)(g_h[h].lockcount > 255 ? 255 : g_h[h].lockcount);
        CPU_BL = (uint8_t)(freeh > 255 ? 255 : freeh);
        CPU_DX = (uint16_t)(g_h[h].size >> 10);
        break; }

    case 0x0F: {  /* Reallocate EMB (BX=new KB, DX=handle) */
        uint16_t h = (uint16_t)CPU_DX;
        uint32_t ns = (uint32_t)CPU_BX << 10;
        if (h == 0 || h >= XMS_MAX_HANDLES || !g_h[h].used) { CPU_AX = 0; CPU_BL = XMS_E_BADHANDLE; break; }
        if (g_h[h].lockcount > 0) { CPU_AX = 0; CPU_BL = XMS_E_LOCKED; break; }
        if (ns <= g_h[h].size) { g_h[h].size = ns; CPU_AX = 1; break; }   /* 縮小は in place */
        uint32_t oldoff = g_h[h].offset, oldsize = g_h[h].size;
        g_h[h].used = 0;                                  /* 自分を除外して空きを探す */
        uint32_t off;
        if (!xms_find_gap(ns, &off)) { g_h[h].used = 1; CPU_AX = 0; CPU_BL = XMS_E_NOMEM; break; }
        if (off != oldoff) memmove(CPU_EXTMEM + off, CPU_EXTMEM + oldoff, oldsize);
        g_h[h].used = 1; g_h[h].offset = off; g_h[h].size = ns;
        CPU_AX = 1;
        break; }

    case 0x03: case 0x04: case 0x05: case 0x06:  /* A20 enable/disable (move では不要、成功のみ) */
        CPU_AX = 1; CPU_BL = 0x00;
        break;

    case 0x07:  /* Query A20 (常に有効と応答) */
        CPU_AX = 1; CPU_BL = 0x00;
        break;

    case 0x01: case 0x02:  /* Request/Release HMA — 未提供 */
        CPU_AX = 0; CPU_BL = XMS_E_HMA_NONE;
        break;

    case 0x10:  /* Request UMB — 未提供 */
        CPU_AX = 0; CPU_BL = XMS_E_NOUMB; CPU_DX = 0;
        break;
    case 0x11:  /* Release UMB — 未提供 */
        CPU_AX = 0; CPU_BL = XMS_E_BADUMB;
        break;

    default:    /* 未実装ファンクション */
        CPU_AX = 0; CPU_BL = XMS_E_NOTIMPL;
        fprintf(stderr, "[xms] unimplemented AH=%02X\n", ah);
        break;
    }
    return 1;
}

uint32_t qb_xms_stat(int which) {
    uint32_t nh = 0, used = 0;
    for (int i = 1; i < XMS_MAX_HANDLES; i++) if (g_h[i].used) { nh++; used += g_h[i].size; }
    switch (which) {
        case 0:  return (uint32_t)qb_xms_enabled();
        case 1:  return nh;
        case 2:  return used;
        case 3:  return (g_pool_end > g_pool_base) ? (g_pool_end - g_pool_base) - used : 0;
        default: return 0;
    }
}
