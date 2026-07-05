/*
 * dos_mouse33.c — INT 33h マウスドライバ HLE (設計方針は dos_mouse33.h 冒頭を参照)
 *
 * 実測正典 (MOUSETEST.COM、2026-07-03):
 *   fn (AX) | MS 仕様 (= MS Mouse 7.06 実測)         | NEC 仕様 (= HImouse v0.2 -n 実測)
 *   --------+------------------------------------------+----------------------------------
 *   0000h   | AX=FFFF, BX=2 (ボタン数)                 | AX=FFFF (BX 不変)
 *   0003h   | AX 不変, BX=bit0左/bit1右, CX/DX=座標    | AX=左(0/FFFF), BX=右(0/FFFF), CX/DX=座標
 *   0005/06h| press/release 情報 (BX でボタン選択)     | 左ボタンの press/release 情報
 *   0007/08h| X/Y 範囲設定 (戻りなし)                  | 右ボタンの press/release 情報
 *   000Ah   | テキストカーソル定義 (戻りなし)          | 実測 no-op (レジスタ echo)
 *   000Bh   | モーションカウンタ (CX/DX 返し・リセット)| 実測で CX/DX=0 を返す → MS と共通実装
 *   0010/11h| 更新除外領域 / no-op (7.06 実測 echo)    | X/Y 範囲設定 (クランプ実測)
 *   00FE/FFh| no-op (7.06 実測: レジスタ完全 echo)     | no-op (HImouse 実測 echo)
 *   座標系  | 両仕様とも 640×400 ネイティブ・粒度 1、リセット後は範囲中央 (320,200)
 *
 * カーソル描画はゲスト VRAM に書かず、表示フレーム (RGB16 dispsurf) への合成オーバーレイで行う。
 * VRAM を読み戻すソフトにはカーソルが「見えない」が、ゲスト状態を一切壊さない側を採った
 * (実 NEC 仕様の XOR プレーン描画とは異なる。詳細 docs/dos_hle_gaps.md)。
 *
 * Tier 1 での未対応 (正直に空振り + 初回ログ):
 *   - fn0C/14h イベントハンドラ: 登録は受理・保存するが呼び出さない (要 IRQ13 トランポリン = Tier 2)
 *   - NEC fn0 の「グラフィック画面表示を ON にする」副作用 (Orange House 系が依存、DOSBox-X 由来知見)
 *   - NEC fn9 カーソルパターン (形式が MS と異なる)・fn12h プレーン選択は保存のみ (オーバーレイには反映)
 */
#include <compiler.h>
#include <string.h>
#include <stdio.h>

#include <i386c/cpumem.h>
#include <i386c/ia32/cpu.h>

#include "dos_loader.h"
#include "dos_mouse33.h"
#include "qb_guestmem.h"

/* ---- 既定カーソル (MS 標準の矢印。screen=AND マスク / cursor=XOR マスク、bit15=左端) ---- */
static const uint16_t k_def_screen_mask[16] = {
    0x3FFF, 0x1FFF, 0x0FFF, 0x07FF, 0x03FF, 0x01FF, 0x00FF, 0x007F,
    0x003F, 0x001F, 0x01FF, 0x00FF, 0x30FF, 0xF87F, 0xF87F, 0xFCFF,
};
static const uint16_t k_def_cursor_mask[16] = {
    0x0000, 0x4000, 0x6000, 0x7000, 0x7800, 0x7C00, 0x7E00, 0x7F00,
    0x7F80, 0x7C00, 0x6C00, 0x4600, 0x0600, 0x0300, 0x0300, 0x0000,
};

typedef struct {
    int      mode;            /* QB_MOUSE33_OFF/MS/NEC (Run をまたいで維持) */
    int      resetted;        /* fn0 を一度でも受けたか (カーソル可視判定に使用) */
    int32_t  x, y;            /* 現在位置 (pixel) */
    int32_t  fx, fy;          /* mickey→pixel 変換の余り (ratio 適用用) */
    int32_t  minx, maxx, miny, maxy;
    int      hidden;          /* MS 隠蔽カウンタ (0 で表示。fn0 後は 1 = 非表示) */
    uint8_t  buttons;         /* bit0=左 bit1=右 (物理状態、Run/リセットでも維持) */
    uint16_t press_cnt[2], rel_cnt[2];
    int16_t  press_x[2], press_y[2], rel_x[2], rel_y[2];
    int32_t  mickey_x, mickey_y;   /* fn0B 用累積 */
    uint16_t ratio_x, ratio_y;     /* fn0F mickey/8pixel 比。既定 8/8 = 1:1 */
    uint16_t dspeed;               /* fn13h (MS) 倍速閾値。保存のみ */
    uint16_t sub_mask, sub_seg, sub_off;  /* fn0C/14h イベントハンドラ (保存のみ) */
    uint16_t screen_mask[16], cursor_mask[16];
    int16_t  hotx, hoty;
    uint16_t text_type, text_and, text_xor; /* fn0A (MS) 保存のみ */
    uint8_t  nec_plane;            /* fn12h (NEC) 保存のみ */
    uint32_t calls;
    uint64_t logged_fns;           /* ファンクション毎の初回ログ管理 */
    int      warned_handler;
} mouse33_t;

/* ratio 8/8 (= m33_soft_reset と同値) を静的初期化にも入れる。soft_reset は初回 Run
 * (loader-start) まで走らないが、ホストの mousemove は待機画面でも qb_mouse33_post_move
 * の除算を踏むため、0 のままだと Wasm の i32.div_s trap でランタイム全体が落ちる。 */
static mouse33_t g_m33 = { .mode = QB_MOUSE33_MS, .ratio_x = 8, .ratio_y = 8 };

/* ---------------- 内部ヘルパ ---------------- */

static void m33_log_fn(uint16_t ax, const char *note) {
    int bit = (ax < 63) ? (int)ax : 63;
    if (g_m33.logged_fns & (1ULL << bit)) return;
    g_m33.logged_fns |= (1ULL << bit);
    fprintf(stderr, "[mouse33] INT 33h AX=%04X (%s persona=%s, total %u)\n",
            ax, note, g_m33.mode == QB_MOUSE33_NEC ? "NEC" : "MS", g_m33.calls);
}

static void m33_clamp(void) {
    if (g_m33.x < g_m33.minx) g_m33.x = g_m33.minx;
    if (g_m33.x > g_m33.maxx) g_m33.x = g_m33.maxx;
    if (g_m33.y < g_m33.miny) g_m33.y = g_m33.miny;
    if (g_m33.y > g_m33.maxy) g_m33.y = g_m33.maxy;
}

/* 動的状態を初期化 (fn0 / fn21h / Run リセット共通)。物理ボタン状態は維持する。 */
static void m33_soft_reset(void) {
    g_m33.resetted = 1;
    g_m33.minx = 0; g_m33.maxx = 639;
    g_m33.miny = 0; g_m33.maxy = 399;
    g_m33.x = (g_m33.minx + g_m33.maxx + 1) / 2;   /* = 320,200 (MS 7.06 実測と同じ中央) */
    g_m33.y = (g_m33.miny + g_m33.maxy + 1) / 2;
    g_m33.fx = g_m33.fy = 0;
    g_m33.hidden = 1;
    memset(g_m33.press_cnt, 0, sizeof(g_m33.press_cnt));
    memset(g_m33.rel_cnt, 0, sizeof(g_m33.rel_cnt));
    g_m33.mickey_x = g_m33.mickey_y = 0;
    g_m33.ratio_x = g_m33.ratio_y = 8;
    g_m33.dspeed = 64;
    g_m33.sub_mask = g_m33.sub_seg = g_m33.sub_off = 0;
    memcpy(g_m33.screen_mask, k_def_screen_mask, sizeof(k_def_screen_mask));
    memcpy(g_m33.cursor_mask, k_def_cursor_mask, sizeof(k_def_cursor_mask));
    g_m33.hotx = g_m33.hoty = 0;
    g_m33.text_type = 0; g_m33.text_and = 0x77FF; g_m33.text_xor = 0x7700;
    g_m33.nec_plane = 2;
}

/* fn5-8 共通: ボタン情報を返す。which: 0=左 1=右、rel: 0=press 1=release。
 * 戻り AX = ボタン状態 (MS: 全ボタン bitfield / NEC: 当該ボタンの 0/FFFF)。 */
static void m33_button_info(int which, int rel) {
    if (g_m33.mode == QB_MOUSE33_NEC)
        CPU_AX = (uint16_t)((g_m33.buttons >> which) & 1 ? 0xFFFF : 0);
    else
        CPU_AX = g_m33.buttons;
    if (rel) {
        CPU_BX = g_m33.rel_cnt[which];  g_m33.rel_cnt[which] = 0;
        CPU_CX = (uint16_t)g_m33.rel_x[which];
        CPU_DX = (uint16_t)g_m33.rel_y[which];
    } else {
        CPU_BX = g_m33.press_cnt[which]; g_m33.press_cnt[which] = 0;
        CPU_CX = (uint16_t)g_m33.press_x[which];
        CPU_DX = (uint16_t)g_m33.press_y[which];
    }
}

/* fn7/8 (MS) / fn10h/11h (NEC) 共通: 範囲設定。axis: 0=X 1=Y。CX/DX は大小どちらでも可。 */
static void m33_set_range(int axis) {
    int32_t a = (int16_t)CPU_CX, b = (int16_t)CPU_DX;
    int32_t lo = (a < b) ? a : b, hi = (a < b) ? b : a;
    if (axis == 0) { g_m33.minx = lo; g_m33.maxx = hi; }
    else           { g_m33.miny = lo; g_m33.maxy = hi; }
    m33_clamp();
}

/* ---------------- ホスト入力 ---------------- */

void qb_mouse33_post_move(int dx, int dy) {
    if (g_m33.mode == QB_MOUSE33_OFF) return;
    g_m33.mickey_x += dx;
    g_m33.mickey_y += dy;
    /* mickey → pixel: 8 mickey = ratio_x pixel の逆比。既定 8/8 = 1:1。余りは持ち越す。 */
    g_m33.fx += dx * 8;
    g_m33.fy += dy * 8;
    g_m33.x += g_m33.fx / (int32_t)g_m33.ratio_x;  g_m33.fx %= (int32_t)g_m33.ratio_x;
    g_m33.y += g_m33.fy / (int32_t)g_m33.ratio_y;  g_m33.fy %= (int32_t)g_m33.ratio_y;
    m33_clamp();
}

void qb_mouse33_post_button(int button, int down) {
    if (g_m33.mode == QB_MOUSE33_OFF) return;
    if (button < 0 || button > 1) return;
    uint8_t bit = (uint8_t)(1u << button);
    if (down) {
        if (!(g_m33.buttons & bit)) {
            g_m33.press_cnt[button]++;
            g_m33.press_x[button] = (int16_t)g_m33.x;
            g_m33.press_y[button] = (int16_t)g_m33.y;
        }
        g_m33.buttons |= bit;
    } else {
        if (g_m33.buttons & bit) {
            g_m33.rel_cnt[button]++;
            g_m33.rel_x[button] = (int16_t)g_m33.x;
            g_m33.rel_y[button] = (int16_t)g_m33.y;
        }
        g_m33.buttons &= (uint8_t)~bit;
    }
}

/* ---------------- INT 33h ディスパッチ ---------------- */

int qb_mouse33_int33(void) {
    uint16_t ax = (uint16_t)CPU_AX;
    g_m33.calls++;
    if (g_m33.mode == QB_MOUSE33_OFF) {
        m33_log_fn(ax, "disabled -> reports absent");
        return 1;   /* レジスタ不変 = ドライバ不在 (需要プローブと同値) */
    }
    int nec = (g_m33.mode == QB_MOUSE33_NEC);

    switch (ax) {
    case 0x0000:   /* reset: 実測 MS = AX=FFFF/BX=2、NEC = AX=FFFF (BX 不変) */
        m33_log_fn(ax, "reset");
        m33_soft_reset();
        CPU_AX = 0xFFFF;
        if (!nec) CPU_BX = 2;
        break;

    case 0x0001:   /* show cursor */
        if (g_m33.hidden > 0) g_m33.hidden--;
        break;
    case 0x0002:   /* hide cursor */
        g_m33.hidden++;
        break;

    case 0x0003:   /* 状態取得。二流派の分水嶺 (MS は AX 温存 — bepn/brpn がこれで流派判定) */
        if (nec) {
            CPU_AX = (uint16_t)((g_m33.buttons & 1) ? 0xFFFF : 0);
            CPU_BX = (uint16_t)((g_m33.buttons & 2) ? 0xFFFF : 0);
        } else {
            CPU_BX = g_m33.buttons;
        }
        CPU_CX = (uint16_t)g_m33.x;
        CPU_DX = (uint16_t)g_m33.y;
        break;

    case 0x0004:   /* set position (両仕様共通、brpn が使用) */
        g_m33.x = (int16_t)CPU_CX;
        g_m33.y = (int16_t)CPU_DX;
        m33_clamp();
        break;

    case 0x0005:   /* MS: press 情報 (BX 選択) / NEC: 左 press 情報 */
        m33_button_info(nec ? 0 : ((CPU_BX & 0xFF) ? 1 : 0), 0);
        break;
    case 0x0006:   /* MS: release 情報 (BX 選択) / NEC: 左 release 情報 */
        m33_button_info(nec ? 0 : ((CPU_BX & 0xFF) ? 1 : 0), 1);
        break;

    case 0x0007:   /* MS: X 範囲設定 / NEC: 右 press 情報 */
        if (nec) m33_button_info(1, 0);
        else     m33_set_range(0);
        break;
    case 0x0008:   /* MS: Y 範囲設定 / NEC: 右 release 情報 */
        if (nec) m33_button_info(1, 1);
        else     m33_set_range(1);
        break;

    case 0x0009:   /* グラフィックカーソル定義 */
        if (nec) {
            /* NEC 形式はカーソルマスクのみ・ワード big-endian (DOSBox-X 実装より)。保存だけして
             * オーバーレイは screen マスク全透過 + XOR 相当で近似する。 */
            uint32_t src = ((uint32_t)CPU_ES << 4) + (uint16_t)CPU_DX;
            for (int i = 0; i < 16; i++) {
                g_m33.cursor_mask[i] = (uint16_t)((peek8(src) << 8) | peek8(src + 1));
                g_m33.screen_mask[i] = 0xFFFF;
                src += 2;
            }
            m33_log_fn(ax, "define cursor (NEC form, overlay approximation)");
        } else {
            uint32_t src = ((uint32_t)CPU_ES << 4) + (uint16_t)CPU_DX;
            for (int i = 0; i < 16; i++) g_m33.screen_mask[i] = peek16(src + (uint32_t)i * 2);
            for (int i = 0; i < 16; i++) g_m33.cursor_mask[i] = peek16(src + 32 + (uint32_t)i * 2);
            g_m33.hotx = (int16_t)CPU_BX;
            g_m33.hoty = (int16_t)CPU_CX;
        }
        break;

    case 0x000A:   /* MS: テキストカーソル定義 (保存のみ) / NEC: 実測 no-op (HImouse echo) */
        if (!nec) {
            g_m33.text_type = (uint16_t)CPU_BX;
            g_m33.text_and  = (uint16_t)CPU_CX;
            g_m33.text_xor  = (uint16_t)CPU_DX;
            m33_log_fn(ax, "define text cursor (stored, not rendered)");
        }
        break;

    case 0x000B:   /* モーションカウンタ (実測: HImouse は NEC モードでも CX/DX を返す) */
        CPU_CX = (uint16_t)(int16_t)g_m33.mickey_x;
        CPU_DX = (uint16_t)(int16_t)g_m33.mickey_y;
        g_m33.mickey_x = g_m33.mickey_y = 0;
        break;

    case 0x000C:   /* イベントハンドラ登録: 保存のみ (呼び出しは Tier 2)。正直に警告する。 */
        g_m33.sub_mask = (uint16_t)CPU_CX;
        g_m33.sub_seg  = (uint16_t)CPU_ES;
        g_m33.sub_off  = (uint16_t)CPU_DX;
        if (g_m33.sub_mask && !g_m33.warned_handler) {
            g_m33.warned_handler = 1;
            fprintf(stderr, "[mouse33] UNIMPL: fn0C event handler registered "
                            "(mask=%04X %04X:%04X) — stored but NEVER CALLED (Tier 2)\n",
                    g_m33.sub_mask, g_m33.sub_seg, g_m33.sub_off);
        }
        break;
    case 0x0014: { /* イベントハンドラ交換 (旧値を返す)。呼び出し未実装は fn0C と同じ。 */
        uint16_t om = g_m33.sub_mask, os = g_m33.sub_seg, oo = g_m33.sub_off;
        g_m33.sub_mask = (uint16_t)CPU_CX;
        g_m33.sub_seg  = (uint16_t)CPU_ES;
        g_m33.sub_off  = (uint16_t)CPU_DX;
        CPU_CX = om; CPU_DX = oo; CPU_ES = os;
        if (g_m33.sub_mask && !g_m33.warned_handler) {
            g_m33.warned_handler = 1;
            fprintf(stderr, "[mouse33] UNIMPL: fn14 event handler registered — stored but NEVER CALLED\n");
        }
        break;
    }

    case 0x000D: case 0x000E:   /* ライトペンエミュレーション: no-op */
        m33_log_fn(ax, "lightpen (no-op)");
        break;

    case 0x000F:   /* mickey/8pixel 比。0 は無視 (実 DOS ドライバも 0 除算回避)。 */
        if (CPU_CX) g_m33.ratio_x = (uint16_t)CPU_CX;
        if (CPU_DX) g_m33.ratio_y = (uint16_t)CPU_DX;
        break;

    case 0x0010:   /* MS: 更新除外領域 (保存せず無視、7.06 実測 echo) / NEC: X 範囲設定 */
        if (nec) m33_set_range(0);
        else     m33_log_fn(ax, "update region (ignored)");
        break;
    case 0x0011:   /* MS: no-op (7.06 実測 echo。CuteMouse 拡張は名乗らない) / NEC: Y 範囲設定 */
        if (nec) m33_set_range(1);
        else     m33_log_fn(ax, "no-op (matches MS 7.06)");
        break;

    case 0x0012:   /* MS: 大型カーソル (未対応) / NEC: 描画プレーン選択 (保存のみ) */
        if (nec) g_m33.nec_plane = (uint8_t)CPU_BX;
        else     m33_log_fn(ax, "large cursor (no-op)");
        break;
    case 0x0013:   /* MS: 倍速閾値 / NEC: 有効プレーン取得 (DOSBox-X より BX=FFFF) */
        if (nec) CPU_BX = 0xFFFF;
        else     g_m33.dspeed = (uint16_t)(CPU_DX ? CPU_DX : 64);
        break;

    case 0x0015:   /* ドライバ状態サイズ */
        CPU_BX = (uint16_t)sizeof(mouse33_t);
        break;
    case 0x0016: { /* 状態保存 (ES:DX へ) */
        uint32_t dst = ((uint32_t)CPU_ES << 4) + (uint16_t)CPU_DX;
        const uint8_t *p = (const uint8_t *)&g_m33;
        for (uint32_t i = 0; i < sizeof(mouse33_t); i++) poke8(dst + i, p[i]);
        m33_log_fn(ax, "save state");
        break;
    }
    case 0x0017: { /* 状態復元 (ES:DX から)。mode/ログ管理は上書きしない。 */
        uint32_t src = ((uint32_t)CPU_ES << 4) + (uint16_t)CPU_DX;
        mouse33_t tmp;
        uint8_t *p = (uint8_t *)&tmp;
        for (uint32_t i = 0; i < sizeof(mouse33_t); i++) p[i] = peek8(src + i);
        tmp.mode = g_m33.mode;
        tmp.calls = g_m33.calls;
        tmp.logged_fns = g_m33.logged_fns;
        tmp.warned_handler = g_m33.warned_handler;
        /* ゲスト由来バイトなので ratio=0 (post_move の除数) は受け入れない (fn0F と同じ 0 拒否) */
        if (!tmp.ratio_x) tmp.ratio_x = 8;
        if (!tmp.ratio_y) tmp.ratio_y = 8;
        g_m33 = tmp;
        m33_log_fn(ax, "restore state");
        break;
    }

    case 0x0021:   /* software reset (MS 6.0+): fn0 相当 (実ハード再初期化なし) */
        m33_soft_reset();
        CPU_AX = 0xFFFF;
        if (!nec) CPU_BX = 2;
        break;

    case 0x00FE:   /* PC-98 実ドライバの拡張らしき番号 (brpn が MS 枝で BX=5 を渡す)。 */
    case 0x00FF:   /* 7.06/HImouse とも実測レジスタ完全 echo → 忠実に no-op。 */
        m33_log_fn(ax, "extension (no-op, matches measured drivers)");
        break;

    default:
        m33_log_fn(ax, "UNIMPL -> regs unchanged");
        break;
    }
    return 1;
}

/* ---------------- ライフサイクル / 制御 ---------------- */

void qb_mouse33_reset_run(void) {
    int mode = g_m33.mode;
    uint8_t buttons = g_m33.buttons;   /* 物理状態は Run をまたいで維持 */
    memset(&g_m33, 0, sizeof(g_m33));
    g_m33.mode = mode;
    g_m33.buttons = buttons;
    m33_soft_reset();
    g_m33.resetted = 0;   /* fn0 前はカーソルを出さない (実 DOS も常駐直後は非表示) */
}

void qb_mouse33_set_mode(int mode) {
    if (mode < QB_MOUSE33_OFF || mode > QB_MOUSE33_NEC) return;
    g_m33.mode = mode;
    fprintf(stderr, "[mouse33] mode=%s\n",
            mode == QB_MOUSE33_OFF ? "off" : mode == QB_MOUSE33_NEC ? "NEC" : "MS");
}

uint32_t qb_mouse33_stat(int which) {
    switch (which) {
        case 0:  return (uint32_t)g_m33.mode;
        case 1:  return g_m33.calls;
        case 2:  return (uint32_t)g_m33.x;
        case 3:  return (uint32_t)g_m33.y;
        case 4:  return g_m33.buttons;
        case 5:  return (uint32_t)g_m33.hidden;
        default: return 0;
    }
}

/* ---------------- カーソルオーバーレイ (表示専用) ---------------- */

int qb_mouse33_cursor_visible(void) {
    return g_m33.mode != QB_MOUSE33_OFF && g_m33.resetted && g_m33.hidden == 0;
}

void qb_mouse33_overlay(uint16_t *fb, int w, int h) {
    if (!fb) return;
    int ox = g_m33.x - g_m33.hotx;
    int oy = g_m33.y - g_m33.hoty;
    for (int row = 0; row < 16; row++) {
        int y = oy + row;
        if (y < 0 || y >= h) continue;
        uint16_t sm = g_m33.screen_mask[row];
        uint16_t cm = g_m33.cursor_mask[row];
        for (int col = 0; col < 16; col++) {
            int x = ox + col;
            if (x < 0 || x >= w) continue;
            uint16_t bit = (uint16_t)(0x8000u >> col);
            uint16_t *px = &fb[(size_t)y * (size_t)w + (size_t)x];
            if (sm & bit) {
                if (cm & bit) *px = (uint16_t)~*px;   /* AND=1 XOR=1: 反転 */
                /* AND=1 XOR=0: 透過 */
            } else {
                *px = (cm & bit) ? 0xFFFF : 0x0000;   /* AND=0: XOR で白/黒 */
            }
        }
    }
}
