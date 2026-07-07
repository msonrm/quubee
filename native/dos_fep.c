/* dos_fep.c — HLE FEP: 未確定文字列のインライン描画 (設計は dos_fep.h 参照)。
 *
 * カーソル位置は GDC ハードウェアカーソル (master CSRW、EAD = row*80+col) を正とする。
 * VZ 等のフルスクリーンアプリは DOS CON を通らず GDC カーソルだけを編集点に置くので、
 * 実 FEP のインライン表示と同じ基準になる。DOS CON 経由の出力は tty_store_cursor が
 * CSRW を追従させているので、どちらの世界でも同じ読み方で正しい位置が取れる。 */

#include <compiler.h>
#include <string.h>

#include <i386c/cpumem.h>
#include <io/iocore.h>
#include <io/gdc.h>

#include "dos_fep.h"
#include "dos_int21.h"

extern UINT8 mem[];

#define FEP_COLS   80
#define VRAM_CODE  0xA0000u
#define VRAM_ATTR  0xA2000u
#define FEP_DEF_ATTR 0xE9   /* 白・下線・表示 (attrs=NULL 時の既定 = よみ表示) */

static int g_shown = 0;
static int g_row = 0, g_col = 0, g_cells = 0;
static uint8_t g_save_code[FEP_COLS * 2];   /* 描画前にそこに在った内容 (復元用) */
static uint8_t g_save_attr[FEP_COLS * 2];
static uint8_t g_draw_code[FEP_COLS * 2];   /* 自分が描いた内容 (所有権検証用) */
static uint8_t g_draw_attr[FEP_COLS * 2];

/* 退避セルの復元。セル単位で「今の VRAM がまだ自分の描いたままか」を検証し、
 * アプリが上書きしたセルには触らない (アプリ優先)。確定注入 → アプリのエコーの
 * 直後に次の composition が始まると、エコーが overlay を上書きしていることがあり、
 * 無条件復元はエコー済みの文字を退避時の古い内容で潰してしまう (取り合いの実害)。 */
static void fep_restore(void) {
	uint32_t base;
	int k;
	if (!g_shown) return;
	base = (uint32_t)(g_row * FEP_COLS + g_col) * 2;
	for (k = 0; k < g_cells; k++) {
		uint32_t c = base + (uint32_t)k * 2;
		if (mem[VRAM_CODE + c]     != g_draw_code[k * 2]     ||
		    mem[VRAM_CODE + c + 1] != g_draw_code[k * 2 + 1] ||
		    mem[VRAM_ATTR + c]     != g_draw_attr[k * 2]     ||
		    mem[VRAM_ATTR + c + 1] != g_draw_attr[k * 2 + 1])
			continue;                        /* アプリが上書き済み → アプリの勝ち */
		mem[VRAM_CODE + c]     = g_save_code[k * 2];
		mem[VRAM_CODE + c + 1] = g_save_code[k * 2 + 1];
		mem[VRAM_ATTR + c]     = g_save_attr[k * 2];
		mem[VRAM_ATTR + c + 1] = g_save_attr[k * 2 + 1];
	}
	gdcs.textdisp |= GDCSCRN_ALLDRAW2;   /* 直書きは dirty が立たない (dos_int21.c と同じ) */
	g_shown = 0;
	g_cells = 0;
}

static void fep_caret(int *row, int *col) {
	int rows = qb_tty_text_rows();
	int r, c;
	uint16_t ead;
	gdc_forceready(GDCWORK_MASTER);
	ead = LOADINTELWORD(gdc.m.para + GDC_CSRW);
	r = ead / FEP_COLS;
	c = ead % FEP_COLS;
	if (r >= rows) {           /* カーソル退避中 (画面外 EAD) → DOS CON ワークへ */
		r = mem[0x710];
		c = mem[0x71C];
	}
	if (r >= rows)      r = rows - 1;
	if (c >= FEP_COLS)  c = FEP_COLS - 1;
	*row = r;
	*col = c;
}

int qb_fep_show(const uint8_t *sjis, const uint8_t *attrs, int len) {
	/* op リスト: kind 0=ANK(1セル) / 1=全角(2セル) */
	uint8_t op_kind[FEP_COLS], op_b1[FEP_COLS], op_b2[FEP_COLS], op_at[FEP_COLS];
	int nops = 0, cells = 0;
	int row, col, i, k;

	fep_restore();
	if (!sjis || len <= 0) return 0;

	fep_caret(&row, &col);

	/* パス 1: SJIS を歩いてセル数を確定。行末をまたぐ全角の手前で打ち切り (M1 制限)。 */
	for (i = 0; i < len && col + cells < FEP_COLS; ) {
		uint8_t b = sjis[i];
		uint8_t a = attrs ? attrs[i] : FEP_DEF_ATTR;
		if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
			if (i + 1 >= len) break;                  /* 後続なしの孤立先行バイト */
			if (col + cells + 2 > FEP_COLS) break;    /* 全角が右端をまたぐ */
			op_kind[nops] = 1; op_b1[nops] = b; op_b2[nops] = sjis[i + 1];
			op_at[nops] = a;
			cells += 2; i += 2;
		} else {
			op_kind[nops] = 0; op_b1[nops] = b; op_b2[nops] = 0;
			op_at[nops] = a;
			cells += 1; i += 1;
		}
		nops++;
	}
	if (cells == 0) return 0;

	/* パス 2: 退避してから描画。描画後の実セル内容を控える (fep_restore の所有権検証用)。 */
	memcpy(g_save_code, &mem[VRAM_CODE + ((uint32_t)(row * FEP_COLS + col) * 2)],
	       (size_t)cells * 2);
	memcpy(g_save_attr, &mem[VRAM_ATTR + ((uint32_t)(row * FEP_COLS + col) * 2)],
	       (size_t)cells * 2);
	g_row = row; g_col = col; g_cells = cells; g_shown = 1;

	for (k = 0, i = col; k < nops; k++) {
		if (op_kind[k]) {
			qb_tty_put_kanji_sjis(row, i, op_b1[k], op_b2[k], op_at[k]);
			i += 2;
		} else {
			qb_tty_put_ank(row, i, op_b1[k], op_at[k]);
			i += 1;
		}
	}
	memcpy(g_draw_code, &mem[VRAM_CODE + ((uint32_t)(row * FEP_COLS + col) * 2)],
	       (size_t)cells * 2);
	memcpy(g_draw_attr, &mem[VRAM_ATTR + ((uint32_t)(row * FEP_COLS + col) * 2)],
	       (size_t)cells * 2);
	return cells;
}

void qb_fep_hide(void) {
	fep_restore();
}

void qb_fep_reset(void) {
	g_shown = 0;
	g_cells = 0;
}
