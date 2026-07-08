/* dos_fep.c — HLE FEP: 未確定文字列のインライン描画 (設計は dos_fep.h 参照)。
 *
 * カーソル位置は GDC ハードウェアカーソル (master CSRW、EAD = row*80+col) を正とする。
 * VZ 等のフルスクリーンアプリは DOS CON を通らず GDC カーソルだけを編集点に置くので、
 * 実 FEP のインライン表示と同じ基準になる。DOS CON 経由の出力は tty_store_cursor が
 * CSRW を追従させているので、どちらの世界でも同じ読み方で正しい位置が取れる。
 *
 * 表示範囲はカーソルから始まる「線形セル範囲」(VRAM は 80 桁×行の線形メモリ) で、
 * 行末に達したら次の行へ折り返す (実 FEP と同じ)。全角が行末 1 桁に残る場合は
 * 空白 1 セルでパディングして次行頭から描く (tty の折り返しと同じ規律 — 漢字を
 * 左右に割らない)。画面最下端を越える長さは先頭から削って末尾を優先表示する
 * (打っている場所 = 末尾が見える)。退避・復元・所有権検証も同じ線形範囲で行う。 */

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

/* 画面全体まで表示できる (25 行/30 行モードの大きい方)。 */
#define FEP_MAX_CELLS (FEP_COLS * 30)
/* op 上限。1 op ≥ 1 セルなので画面よりずっと大きく取れば十分 (超過分は先頭が
 * 消えるだけ = 末尾優先表示の退化形)。 */
#define FEP_MAX_OPS   4096

static int g_shown = 0;
static int g_start = 0;    /* 表示開始セル (線形 index = row*80+col) */
static int g_cells = 0;
static uint8_t g_save_code[FEP_MAX_CELLS * 2];   /* 描画前にそこに在った内容 (復元用) */
static uint8_t g_save_attr[FEP_MAX_CELLS * 2];
static uint8_t g_draw_code[FEP_MAX_CELLS * 2];   /* 自分が描いた内容 (所有権検証用) */
static uint8_t g_draw_attr[FEP_MAX_CELLS * 2];

/* op リスト (静的: 単一スレッド・呼び出し毎に作り直し) */
static uint8_t s_kind[FEP_MAX_OPS], s_b1[FEP_MAX_OPS], s_b2[FEP_MAX_OPS], s_at[FEP_MAX_OPS];

/* 退避セルの復元。セル単位で「今の VRAM がまだ自分の描いたままか」を検証し、
 * アプリが上書きしたセルには触らない (アプリ優先)。確定注入 → アプリのエコーの
 * 直後に次の composition が始まると、エコーが overlay を上書きしていることがあり、
 * 無条件復元はエコー済みの文字を退避時の古い内容で潰してしまう (取り合いの実害)。 */
static void fep_restore(void) {
	uint32_t base;
	int k;
	if (!g_shown) return;
	base = (uint32_t)g_start * 2;
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

static int fep_caret(void) {
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
	return r * FEP_COLS + c;
}

/* ops[from..nops) を start セルから折り返しレイアウトしたときの総セル数
 * (行末またぎ全角のパディング込み)。 */
static int fep_layout_cells(int from, int nops, int start) {
	int pos = start;
	int k;
	for (k = from; k < nops; k++) {
		if (s_kind[k]) {
			if (pos % FEP_COLS == FEP_COLS - 1) pos++;   /* 行末 1 桁 → 空白パディング */
			pos += 2;
		} else {
			pos += 1;
		}
	}
	return pos - start;
}

int qb_fep_show(const uint8_t *sjis, const uint8_t *attrs, int len) {
	int nops = 0, cells, avail, from;
	int start, pos, i, k;

	fep_restore();
	if (!sjis || len <= 0) return 0;

	start = fep_caret();
	avail = qb_tty_text_rows() * FEP_COLS - start;   /* カーソル〜画面末尾 */
	if (avail > FEP_MAX_CELLS) avail = FEP_MAX_CELLS;

	/* パス 1: SJIS を歩いて op リスト化 (kind 0=ANK 1セル / 1=全角 2セル)。 */
	for (i = 0; i < len && nops < FEP_MAX_OPS; ) {
		uint8_t b = sjis[i];
		uint8_t a = attrs ? attrs[i] : FEP_DEF_ATTR;
		if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
			if (i + 1 >= len) break;                  /* 後続なしの孤立先行バイト */
			s_kind[nops] = 1; s_b1[nops] = b; s_b2[nops] = sjis[i + 1];
			s_at[nops] = a;
			i += 2;
		} else {
			s_kind[nops] = 0; s_b1[nops] = b; s_b2[nops] = 0;
			s_at[nops] = a;
			i += 1;
		}
		nops++;
	}
	if (nops == 0) return 0;

	/* 画面に収まる最長の末尾部分列を選ぶ (通常は全体が収まり from=0)。 */
	for (from = 0; from < nops; from++) {
		if (fep_layout_cells(from, nops, start) <= avail) break;
	}
	if (from >= nops) return 0;
	cells = fep_layout_cells(from, nops, start);

	/* パス 2: 退避してから折り返し描画。描画後の実セル内容を控える (所有権検証用)。 */
	memcpy(g_save_code, &mem[VRAM_CODE + (uint32_t)start * 2], (size_t)cells * 2);
	memcpy(g_save_attr, &mem[VRAM_ATTR + (uint32_t)start * 2], (size_t)cells * 2);
	g_start = start; g_cells = cells; g_shown = 1;

	for (k = from, pos = start; k < nops; k++) {
		if (s_kind[k]) {
			if (pos % FEP_COLS == FEP_COLS - 1) {    /* 行末 1 桁 → 同属性の空白で埋めて次行へ */
				qb_tty_put_ank(pos / FEP_COLS, pos % FEP_COLS, ' ', s_at[k]);
				pos++;
			}
			qb_tty_put_kanji_sjis(pos / FEP_COLS, pos % FEP_COLS, s_b1[k], s_b2[k], s_at[k]);
			pos += 2;
		} else {
			qb_tty_put_ank(pos / FEP_COLS, pos % FEP_COLS, s_b1[k], s_at[k]);
			pos += 1;
		}
	}
	memcpy(g_draw_code, &mem[VRAM_CODE + (uint32_t)start * 2], (size_t)cells * 2);
	memcpy(g_draw_attr, &mem[VRAM_ATTR + (uint32_t)start * 2], (size_t)cells * 2);
	return cells;
}

void qb_fep_hide(void) {
	fep_restore();
}

void qb_fep_reset(void) {
	g_shown = 0;
	g_cells = 0;
}
