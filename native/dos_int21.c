/* SPDX-License-Identifier: MIT OR GPL-2.0-or-later */
/*
 * Phase 3 ローダ — INT 21h ハンドラ実装 (T1-T5 範囲、~35 fn)。
 *
 * システム系:
 *   02h Print Character (DL)
 *   06h Direct Console I/O (DL=FF: 入力、それ以外: 出力)
 *   09h Print String at DS:DX, '$' 終端
 *   1Ah Set DTA  (DS:DX → g_dta_linear)
 *   25h Set Interrupt Vector  (IVT[AL] = DS:DX)
 *   35h Get Interrupt Vector  (ES:BX = IVT[AL])
 *   2Ah Get Date  (CX=年, DH=月, DL=日, AL=曜日)
 *   2Ch Get Time  (CH=時, CL=分, DH=秒, DL=1/100秒)
 *   30h Get DOS Version  (AL=5, AH=0 と返す)
 *   4Ch Terminate with code in AL
 *
 * ファイル系 (Emscripten FS /run/ 配下を stdio でラップ):
 *   3Ch Create File  (DS:DX = path) → AX = handle
 *   3Dh Open File    (DS:DX = path, AL = mode) → AX = handle
 *   3Eh Close File   (BX = handle)
 *   3Fh Read File    (BX, CX, DS:DX) → AX = bytes read
 *   40h Write File   (BX, CX, DS:DX) → AX = bytes written
 *   41h Delete File  (DS:DX = path)
 *   42h Seek File    (BX, AL=whence, CX:DX=offset) → DX:AX = new pos
 *   43h Get/Set Attr (DS:DX = path, AL = 0/1)
 *   44h IOCTL Get Device Info (h=0..4 = CON/AUX/PRN は全て char device)
 *
 * ディレクトリ/ディスク系 (/run 配下を host FS でラップ):
 *   36h Get Disk Free Space (合成ジオメトリで「常に潤沢」を返す)
 *   39h/3Ah MKDIR/RMDIR (host mkdir/rmdir) / 3Bh CHDIR (論理カレント g_cwd を更新)
 *   47h Get Current Dir (g_cwd を返す)
 *
 * メモリ/検索系 (確保は dos_loader.c の MCB チェーンに委譲):
 *   48h Allocate Memory  (BX paragraphs → AX seg。first-fit + 分割)
 *   49h Free Memory      (ES-1 の MCB を空きに + coalesce)
 *   4Ah Resize Memory    (縮小=末尾分割 / 拡大=隣接空きと結合。self-shrink でアリーナ確定)
 *   4Eh Find First  (DS:DX = wildcard pattern) → DTA に最初の一致を書く
 *   4Fh Find Next   → DTA を更新
 *
 * プロセス/その他:
 *   4Bh EXEC (AL=00: 親常駐・子をアリーナにロード) / 4Dh Get Return Code
 *   01-0C コンソール入力 / 19h/2Fh/33h/47h など — 詳細は各 handler を参照
 *
 * テキスト出力経路:
 *   tty_putc (ANSI/PC-98 ESC パーサ込み) → vram_put_char → text VRAM
 *   0xA0000 code plane + 0xA2000 attribute plane (default 0xE1 = 白文字 visible)
 *   メモリ直書き直後に gdcs.textdisp |= GDCSCRN_ALLDRAW2 で NP2kai に再描画通知
 *   (これがないと前フレームのキャッシュが残る — T4 一日中ハマった真因)
 */

#include <compiler.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>

#include <i386c/cpumem.h>
#include <i386c/ia32/cpu.h>
#include <io/iocore.h>      /* gdcs (GDC state) — テキスト面表示制御に使う */
#include <io/gdc.h>         /* GDCSCRN_ENABLE / GDCSCRN_ALLDRAW2 */

#include "dos_int21.h"
#include "dos_loader.h"
#include "qb_guestmem.h"    /* qb_mem_write: VRAM 宛バルク転送を memp_write8 経由に (共有) */

extern UINT8 mem[];

/* dos_loader.c の終了通知。戻り値 1 = EXEC 子の終了で親を復元した (CPU リダイレクト済 →
 * dispatch tail の FLAGS 書き戻しを skip すること)、0 = 最上位プログラム終了で halt。 */
int qb_dos_signal_exit(int code);
/* AH=4Dh 用: 直近に終了した子の (type<<8 | code)。 */
uint16_t qb_dos_exec_last_code(void);
/* AH=52h 用: MCB チェーンの先頭 (空きアリーナ起点) セグメント。List of Lists の [BX-2]。 */
uint16_t qb_dos_first_mcb_seg(void);

#define TEXT_COLS  80
#define TEXT_ROWS  25
#define VRAM_CODE  0xA0000u
#define VRAM_ATTR  0xA2000u
#define DEF_ATTR   0xE1     /* 白文字、表示 ON (boot_hello と同じ値) */

static int g_cur_row = 0;
static int g_cur_col = 0;

/* ---------------- ESC/ANSI シーケンス state ---------------- */
/* PC-98 DOS は ANSI X3.64 風のシーケンスを console driver が解釈する。
 * 我々は driver を持たないので tty_putc 内で最小パーサを動かす。
 * 対応: ESC c (reset) / ESC * (PC-98 clear) /
 *       CSI [n;mH (cursor pos) / [nJ (erase display) / [nK (erase line) /
 *       [nA-D (cursor up/down/right/left) / [nm (SGR、無視) /
 *       [>nh,l と [?nh,l (mode set/reset、無視) */
typedef enum {
    TTY_NORMAL = 0,
    TTY_ESC,      /* 直前が ESC */
    TTY_CSI,      /* "ESC [" 後、パラメータ収集中 */
    TTY_SJIS2,    /* 直前が Shift-JIS 第1バイト、第2バイト待ち */
} tty_state_t;

static tty_state_t g_tty_state = TTY_NORMAL;
static uint8_t g_sjis_lead;    /* TTY_SJIS2 中: 保留した Shift-JIS 第1バイト */
static int     g_csi_param[8];
static int     g_csi_nparam;   /* "見えた" param の最大 index (0 = まだ何も) */
static int     g_csi_has_digit;
static char    g_csi_priv;     /* '?' or '>' or 0 */

/* tty の現在属性 (SGR で変化、各 vram_put が書く)。既定 = 白・表示 (0xE1)。 */
static uint8_t g_tty_attr = DEF_ATTR;

/* ---------------- DOS CON ワークエリア (seg 0000) ----------------
 * 実 PC-98 DOS の console driver はワークエリアを 0:0711h/0:0712h に持ち、
 * master.lib がこれを直読みする (txesc.asm TEXT_HEIGHT / text_fillca.asm):
 *   0711h = ファンクションキー行の表示状態 (0/1)
 *   0712h = テキスト画面の行数 - 1 (例: 25 行・fkey 非表示 → 24)
 * 未初期化 (=0) だと text_fillca が「1 行ぶん」しか塗らず、TH02/TH05 等の
 * text_wipe (全画面を黒反転セルで覆い、VRAM のタイルキャッシュ領域を隠す) が
 * row 0 で切れてゴミが見える (2026-06-11 根治)。
 * 我々の tty はファンクションキー行を描画しないので既定は「非表示・25 行」。 */
static int g_tty_lines20 = 0;   /* ESC[>3h: 20 行モード (l で 25 行) */
static int g_tty_sysline = 0;   /* ESC[>1l: fkey 行表示 (h で非表示) */

static void tty_sync_conarea(void) {
    int rows = (g_tty_lines20 ? 20 : 25) - (g_tty_sysline ? 1 : 0);
    mem[0x711] = (uint8_t)(g_tty_sysline ? 1 : 0);
    mem[0x712] = (uint8_t)(rows - 1);
    mem[0x71D] = g_tty_attr;   /* 0:071Dh = CON の現在属性 (DOSBox-X dev_con.h と同じ位置) */
}

static void vram_put_char(int row, int col, uint8_t ch) {
    uint32_t code_off = VRAM_CODE + ((row * TEXT_COLS + col) * 2);
    uint32_t attr_off = VRAM_ATTR + ((row * TEXT_COLS + col) * 2);
    mem[code_off]     = ch;
    mem[code_off + 1] = 0;
    mem[attr_off]     = g_tty_attr;
    mem[attr_off + 1] = 0;
    /* メモリ直書きでは NP2kai の dirty-flag が立たないので明示通知。
     * 正規 CPU 経路 (memtram_wr8) はセル単位 tramupdate[] + GDCSCRN_REDRAW を立てるが、
     * ALLDRAW2 は maketext に全セル無条件再描画をさせる上位互換通知 (NP2kai 自身の
     * 合成 BIOS bios18.c と同じイディオム)。1 文字の書き込みでも次フレームで反映される。 */
    gdcs.textdisp |= GDCSCRN_ALLDRAW2;
}

/* 全角 (漢字) 1 文字を隣接 2 セルに書く。PC-98 T-VRAM の漢字セル形式は
 *   低位バイト = ku       (= JIS 第1バイト - 0x20、区番号 1-94)
 *   高位バイト = JIS 第2バイト「そのまま」 | 0x80 (kanji ビット)  ← 索引化(-0x20)しない
 * 非対称な点に注意: 低位だけ -0x20 して区索引にし、高位は生の JIS 第2バイトを使う。
 * font.bmp/fontpc98.c (pc98knjcpy) は glyph を fontrom (jis_lo<<12)|(ku<<4) 相当に配置し、
 * maketext.c も (cell & 0x7f7f)<<4 = (高位&0x7f)<<12 | (低位&0x7f)<<4 で引くので、
 * 高位 = jis_lo (生) で初めて一致する (以前は高位も -0x20 して 0x20 ずれ、別グリフに化けた:
 * 「うさちゃん」→「　　ぁっぴ」)。さめがめ等は CG 窓経由で同じ font.bmp を読むので無関係。
 * 0x80 は bitac=0xff/0x80 どちらでも漢字判定されるための kanji ビット (0x7f7f で剥がれる)。
 * 右セルは maketext が左セルの kanji2nd 検出で右半分 (lastbitp+0x800) を自動描画する。 */
static void vram_put_kanji(int row, int col, uint8_t jis_hi, uint8_t jis_lo) {
    /* 漢字判定を保証する: GDC mode1 bit5 (コードアクセス) が立っていると
     * gdc_restorekacmode() が bitac=0x00 にし、maketext は高位バイトの kanji
     * ビット (0x80) を無視して全角セルまで ANK 扱いで描いてしまう
     * (= KANA が低バイト 0x04 の ANK で消え、KANJI が低バイト=ku の ANK で化ける)。
     * 全角を書くこのタイミングで kanji-access mode (bit5 クリア → bitac=0xff) を保証する。 */
    if (gdc.mode1 & 0x20) {
        gdc.mode1 &= (uint8_t)~0x20;
        gdc_restorekacmode();
    }
    uint8_t ku = (uint8_t)(jis_hi - 0x20);   /* 低位 = 区索引 (JIS1 - 0x20) */
    for (int k = 0; k < 2 && (col + k) < TEXT_COLS; k++) {
        uint32_t code_off = VRAM_CODE + ((row * TEXT_COLS + col + k) * 2);
        uint32_t attr_off = VRAM_ATTR + ((row * TEXT_COLS + col + k) * 2);
        mem[code_off]     = ku;
        mem[code_off + 1] = (uint8_t)(jis_lo | 0x80);  /* 高位 = 生 JIS2 | kanji ビット */
        mem[attr_off]     = g_tty_attr;
        mem[attr_off + 1] = 0;
    }
    gdcs.textdisp |= GDCSCRN_ALLDRAW2;
}

static void vram_scroll_one(void) {
    for (int r = 0; r < TEXT_ROWS - 1; r++) {
        memcpy(&mem[VRAM_CODE + (r * TEXT_COLS) * 2],
               &mem[VRAM_CODE + ((r + 1) * TEXT_COLS) * 2],
               TEXT_COLS * 2);
        memcpy(&mem[VRAM_ATTR + (r * TEXT_COLS) * 2],
               &mem[VRAM_ATTR + ((r + 1) * TEXT_COLS) * 2],
               TEXT_COLS * 2);
    }
    for (int c = 0; c < TEXT_COLS; c++) {
        vram_put_char(TEXT_ROWS - 1, c, 0x20);
    }
}

static void vram_clear_all(void) {
    /* 全 cell を space + 現在属性で埋める (CON の ESC[2J 相当。SGR 未使用なら 0xE1 =
     * NP2kai bios_memclear の実機相当初期値と同じ)。 */
    for (int r = 0; r < TEXT_ROWS; r++) {
        for (int c = 0; c < TEXT_COLS; c++) {
            uint32_t code_off = VRAM_CODE + ((r * TEXT_COLS + c) * 2);
            uint32_t attr_off = VRAM_ATTR + ((r * TEXT_COLS + c) * 2);
            mem[code_off]     = 0x20;
            mem[code_off + 1] = 0;
            mem[attr_off]     = g_tty_attr;
            mem[attr_off + 1] = 0;
        }
    }
    /* 我々はメモリ直書きで VRAM を更新したので、NP2kai の dirty-flag
     * 最適化 (セル単位 tramupdate[] の差分検出) に「全セル再描画」を通知する必要がある。
     * これがないと前フレームの描画結果がそのまま画面に残ってしまう。 */
    gdcs.textdisp |= GDCSCRN_ALLDRAW2;
}

static void csi_clamp_cursor(void) {
    if (g_cur_row < 0) g_cur_row = 0;
    if (g_cur_row >= TEXT_ROWS) g_cur_row = TEXT_ROWS - 1;
    if (g_cur_col < 0) g_cur_col = 0;
    if (g_cur_col >= TEXT_COLS) g_cur_col = TEXT_COLS - 1;
}

/* "見えた" param の数 (digit が一つでも来ていれば >=1)。default 値は 1 が多いが
 * 'J' / 'K' は 0、'H'/'f' は 1 が default。ここでは caller が補正する。 */
static int csi_count(void) { return g_csi_has_digit ? (g_csi_nparam + 1) : 0; }
static int csi_param(int idx, int dflt) {
    if (idx >= csi_count()) return dflt;
    return g_csi_param[idx];
}

static void csi_dispatch(uint8_t final) {
    switch (final) {
    case 'H': case 'f': {
        int row = csi_param(0, 1);
        int col = csi_param(1, 1);
        g_cur_row = row - 1;
        g_cur_col = col - 1;
        csi_clamp_cursor();
        break;
    }
    case 'A': g_cur_row -= csi_param(0, 1); csi_clamp_cursor(); break;
    case 'B': g_cur_row += csi_param(0, 1); csi_clamp_cursor(); break;
    case 'C': g_cur_col += csi_param(0, 1); csi_clamp_cursor(); break;
    case 'D': g_cur_col -= csi_param(0, 1); csi_clamp_cursor(); break;
    case 'J': {
        int p = csi_param(0, 0);
        if (p == 2) { vram_clear_all(); g_cur_row = 0; g_cur_col = 0; }
        else if (p == 0) {
            /* cursor から末尾まで */
            for (int c = g_cur_col; c < TEXT_COLS; c++) vram_put_char(g_cur_row, c, 0x20);
            for (int r = g_cur_row + 1; r < TEXT_ROWS; r++)
                for (int c = 0; c < TEXT_COLS; c++) vram_put_char(r, c, 0x20);
        }
        break;
    }
    case 'K': {
        int p = csi_param(0, 0);
        if (p == 0) {
            for (int c = g_cur_col; c < TEXT_COLS; c++) vram_put_char(g_cur_row, c, 0x20);
        } else if (p == 1) {
            for (int c = 0; c <= g_cur_col; c++) vram_put_char(g_cur_row, c, 0x20);
        } else if (p == 2) {
            for (int c = 0; c < TEXT_COLS; c++) vram_put_char(g_cur_row, c, 0x20);
        }
        break;
    }
    case 'm': { /* SGR (色/属性)。NEC CON は毎シーケンス先頭で属性をリセットする絶対指定
                 * 方式 (DOSBox-X dev_con.h の PC-98 実装と同じ)。30-37=文字色 (ANSI RGB 順 →
                 * PC-98 GRB ビットへ写像)、40-47=色+反転 (PC-98 に背景色は無く反転で表現)、
                 * 17-23=NEC 別系色コード、2=bit4、4=下線、5=点滅、7=反転、8/16=シークレット。
                 * 空 param は 0 (リセット) — "ESC[5;46;m" のような末尾 ';' は結果リセットになる
                 * (ANSI 標準/DOSBox-X 準拠。Ray IV の曲タイトルがこの形を実際に送る)。 */
        static const uint8_t SGR_COLOR[8] = {   /* 黒 赤 緑 黄 青 マゼンタ シアン 白 (GRB) */
            0x00, 0x40, 0x80, 0xC0, 0x20, 0x60, 0xA0, 0xE0 };
        uint8_t a = DEF_ATTR;
        int n = csi_count();
        for (int i = 0; i < n && i < 8; i++) {
            /* 空 param ("5;46;" の末尾等) は 0 = リセットとして適用 (ANSI/DOSBox-X と同じ)。 */
            int p = g_csi_param[i];
            if (p >= 17 && p <= 23) {                       /* NEC 別系色コード → 30 系へ */
                static const uint8_t conv[7] = { 31, 34, 35, 32, 33, 36, 37 };
                p = conv[p - 17];
            }
            if (p == 0)      a = DEF_ATTR;
            else if (p == 2) a |= 0x10;
            else if (p == 4) a |= 0x08;                     /* 下線 */
            else if (p == 5) a |= 0x02;                     /* 点滅 */
            else if (p == 7) a |= 0x04;                     /* 反転 */
            else if (p == 8 || p == 16) a &= 0xFE;          /* シークレット (表示ビット OFF) */
            else if (p >= 30 && p <= 37) a = (uint8_t)((a & ~0xE0) | SGR_COLOR[p - 30]);
            else if (p >= 40 && p <= 47) a = (uint8_t)((a & ~0xE0) | SGR_COLOR[p - 40] | 0x04);
        }
        g_tty_attr = a;
        mem[0x71D] = a;   /* DOS CON ワークエリア: 現在属性 */
        break;
    }
    case 'h': case 'l': {
        /* CSI mode set ('h') / reset ('l')。"ESC [ > n h/l" は PC-98 ANSI 拡張で
         * console driver が解釈するハードウェア制御コード (master.lib txesc.asm 準拠):
         *   > 1 h/l  : ファンクションキー行 非表示/表示 → 0:0711h/0712h を更新
         *   > 3 h/l  : 20 行/25 行モード → 0:0712h を更新
         *   > 5 h/l  : カーソル 非表示/表示 → 描画しないので no-op */
        int set = (final == 'h');
        int n = csi_param(0, 0);
        if (g_csi_priv == '>' && n == 1) {
            g_tty_sysline = !set;            /* h = 非表示 */
            tty_sync_conarea();
        } else if (g_csi_priv == '>' && n == 3) {
            g_tty_lines20 = set;             /* h = 20 行 */
            tty_sync_conarea();
        } else if (g_csi_priv == '>' && n == 5) {
            /* >5h/l = カーソル非表示/表示 (master.lib TEXT_CURSOR_HIDE/SHOW)。我々の tty は
             * DOS カーソルを描画しないので no-op が忠実。旧実装は「テキスト面表示 ON/OFF」と
             * 誤解釈しており、ほぼ全ソフトが終了時に送る >5l (カーソル復元) でテキスト面を
             * 消してしまう地雷だった (2026-06-11 修正。corpus 走査で 39 本が >5l を保持)。 */
            (void)set;
        }
        /* それ以外の mode は無視 */
        break;
    }
    case 'n':
    case 's': case 'u':
    case 'r':
        /* device status report / save-restore cursor / scroll region — 無視 */
        break;
    default:
        fprintf(stderr, "[tty] unimpl CSI '%c%c' (params:", g_csi_priv ? g_csi_priv : ' ', final);
        for (int i = 0; i < csi_count(); i++) fprintf(stderr, " %d", g_csi_param[i]);
        fprintf(stderr, ")\n");
        break;
    }
}

static void tty_normal_putc(uint8_t ch) {
    if (ch == 0x0D) { g_cur_col = 0; return; }
    if (ch == 0x0A) {
        g_cur_row++;
        if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
        return;
    }
    if (ch == 0x08) {
        if (g_cur_col > 0) g_cur_col--;
        return;
    }
    if (ch == 0x09) {                       /* HT (tab): 次の 8 桁タブストップへ (PC-98 CON 準拠) */
        g_cur_col = (g_cur_col & ~7) + 8;   /* 文字は書かずカーソルのみ前進 (DOS 標準) */
        if (g_cur_col >= TEXT_COLS) {
            g_cur_col = 0;
            g_cur_row++;
            if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
        }
        return;
    }
    if (ch == 0x07) return;                 /* BEL: グリフ化しない (可聴ビープは未対応、無視) */
    vram_put_char(g_cur_row, g_cur_col, ch);
    g_cur_col++;
    if (g_cur_col >= TEXT_COLS) {
        g_cur_col = 0;
        g_cur_row++;
        if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
    }
}

/* Shift-JIS 2 バイト → JIS X 0208 (区点 +0x20)。標準的な変換式。
 * 例: 'あ' SJIS 0x82A0 → ku=4,ten=2 → JIS 0x2422。 */
static void sjis_to_jis(uint8_t sh, uint8_t sl, uint8_t *jh, uint8_t *jl) {
    int c1 = sh, c2 = sl;
    if (c1 >= 0xE0) c1 -= 0x40;     /* 0xE0-0xFC 帯を 0xA0- に寄せて連続化 */
    c1 -= 0x81;
    if (c2 >= 0x80) c2 -= 1;        /* 0x7F の隙間を詰める */
    c2 -= 0x40;
    int ku  = c1 * 2 + (c2 / 94) + 1;
    int ten = (c2 % 94) + 1;
    *jh = (uint8_t)(ku + 0x20);
    *jl = (uint8_t)(ten + 0x20);
}

/* PC-98 半角グラフィック (JIS 区9-11 = ku 9..11) を 1 セルに書く。NEC が JIS X 0208 の
 * 空き領域 (区9-11) に置いた「半角」の罫線/記号で、SJIS では 0x86xx 帯に当たる。
 * NP2kai maketext.c はテキスト VRAM セルの低位 (= ku) ∈{9,10,11} を半角 (1 セル) で描くため、
 * 全角扱いの vram_put_kanji (2 セル書き) を使うと横幅が 2 倍になる (Ray の罫線崩れの真因)。
 * セル符号化は vram_put_kanji と同じ (低位=ku, 高位=JIS2|0x80) だが書くのは 1 セルだけ。 */
static void vram_put_kanji_half(int row, int col, uint8_t jis_hi, uint8_t jis_lo) {
    if (gdc.mode1 & 0x20) {                 /* kanji-access mode を保証 (vram_put_kanji と同じ) */
        gdc.mode1 &= (uint8_t)~0x20;
        gdc_restorekacmode();
    }
    uint32_t code_off = VRAM_CODE + ((row * TEXT_COLS + col) * 2);
    uint32_t attr_off = VRAM_ATTR + ((row * TEXT_COLS + col) * 2);
    mem[code_off]     = (uint8_t)(jis_hi - 0x20);   /* ku (9..11) */
    mem[code_off + 1] = (uint8_t)(jis_lo | 0x80);
    mem[attr_off]     = g_tty_attr;
    mem[attr_off + 1] = 0;
    gdcs.textdisp |= GDCSCRN_ALLDRAW2;
}

/* 全角文字を tty カーソル位置に描き、カーソルを 2 桁進める (行末は折り返し)。
 * ただし PC-98 半角グラフィック (区9-11) は 1 セル幅なので 1 桁だけ進める。 */
static void tty_kanji_putc(uint8_t sjis_hi, uint8_t sjis_lo) {
    uint8_t jh, jl;
    sjis_to_jis(sjis_hi, sjis_lo, &jh, &jl);
    uint8_t ku = (uint8_t)(jh - 0x20);
    if (ku >= 9 && ku <= 11) {              /* PC-98 半角グラフィック (NEC 罫線等) = 1 セル */
        vram_put_kanji_half(g_cur_row, g_cur_col, jh, jl);
        g_cur_col++;
        if (g_cur_col >= TEXT_COLS) {
            g_cur_col = 0;
            g_cur_row++;
            if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
        }
        return;
    }
    if (g_cur_col >= TEXT_COLS - 1) {       /* 残り 1 桁では全角が入らない → 次行へ */
        g_cur_col = 0;
        g_cur_row++;
        if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
    }
    vram_put_kanji(g_cur_row, g_cur_col, jh, jl);
    g_cur_col += 2;
    if (g_cur_col >= TEXT_COLS) {
        g_cur_col = 0;
        g_cur_row++;
        if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
    }
}

/* tty に流れる生バイトを stderr へエコーするデバッグ出力。既定 OFF。
 * ブラウザでは 1 文字ごとに巨大な async スタックトレースが出てコンソールが
 * 埋まるため、必要なときだけ 1 にする (SJIS バイトも "Invalid UTF-8" 警告を量産する)。 */
static int g_tty_echo_dbg = 0;

static void tty_putc(uint8_t ch) {
    if (g_tty_echo_dbg) fputc(ch, stderr);

    switch (g_tty_state) {
    case TTY_NORMAL:
        if (ch == 0x1B) { g_tty_state = TTY_ESC; return; }
        /* Shift-JIS 第1バイト (0x81-0x9F, 0xE0-0xFC) なら次バイトと合成して全角描画 */
        if ((ch >= 0x81 && ch <= 0x9F) || (ch >= 0xE0 && ch <= 0xFC)) {
            g_sjis_lead = ch;
            g_tty_state = TTY_SJIS2;
            return;
        }
        tty_normal_putc(ch);
        return;
    case TTY_SJIS2:
        /* 第2バイトを受けて全角 1 文字を描画 (ESC 等の制御文字も第2バイト扱い:
         * Shift-JIS のペアは必ず連続2バイトで来るので分岐しない)。 */
        tty_kanji_putc(g_sjis_lead, ch);
        g_tty_state = TTY_NORMAL;
        return;
    case TTY_ESC:
        if (ch == '[') {
            g_tty_state = TTY_CSI;
            g_csi_nparam = 0;
            g_csi_param[0] = 0;
            g_csi_has_digit = 0;
            g_csi_priv = 0;
            return;
        }
        if (ch == 'c' || ch == '*') {
            /* ESC c (reset) / ESC * (PC-98 clear) — 属性も既定 (白) へ戻してから消去 */
            g_tty_attr = DEF_ATTR;
            mem[0x71D] = DEF_ATTR;
            vram_clear_all();
            g_cur_row = 0; g_cur_col = 0;
            g_tty_state = TTY_NORMAL;
            return;
        }
        /* 未知の ESC X — X を捨てて NORMAL に戻す */
        g_tty_state = TTY_NORMAL;
        return;
    case TTY_CSI:
        if ((ch == '?' || ch == '>') && !g_csi_has_digit && g_csi_nparam == 0) {
            g_csi_priv = (char)ch;
            return;
        }
        if (ch >= '0' && ch <= '9') {
            g_csi_param[g_csi_nparam] = g_csi_param[g_csi_nparam] * 10 + (ch - '0');
            g_csi_has_digit = 1;
            return;
        }
        if (ch == ';') {
            if (g_csi_nparam + 1 < (int)(sizeof(g_csi_param)/sizeof(g_csi_param[0]))) {
                g_csi_nparam++;
                g_csi_param[g_csi_nparam] = 0;
            }
            /* ';' を見たら最低 nparam+1 個の param 確定 */
            g_csi_has_digit = 1;
            return;
        }
        /* 終端文字 (英字 or '@'-'~' の記号) */
        csi_dispatch(ch);
        g_tty_state = TTY_NORMAL;
        return;
    }
}

/* ---------------- メモリヘルパ ----------------
 * poke8/poke16/poke32/peek8/peek16 (生アクセス) と qb_mem_read/qb_mem_write (VRAM 対応バルク) は
 * 共有ヘッダ qb_guestmem.h で定義。lin() だけここに置く。 */

static inline uint32_t lin(uint16_t seg, uint16_t off) {
    return ((uint32_t)seg << 4) + off;
}

/* ---------------- PC-98 BIOS キーボードバッファ ----------------
 * NP2kai の INT 18h キーボード BIOS (bios18.c) が使う BIOS データエリアを直読みする。
 * アドレスは core/np2kai/bios/biosmem.h と一致させること:
 *   0x528 = キー数 (MEMB_KB_COUNT), 0x524 = head ptr, 0x526 = tail ptr,
 *   0x502..0x521 = 16 エントリ × 2 byte のリングバッファ (wrap 境界 0x522)。
 * 各エントリは下位 = 文字コード(ANK), 上位 = スキャンコード。DOS 入力は下位を返す。
 * np2kai_key_down → keystat → キーボード IRQ (bios09) がこのバッファに enqueue する。 */
#define QB_KB_BUF      0x502u
#define QB_KB_BUF_WRAP 0x522u
#define QB_KB_HEAD     0x524u
#define QB_KB_TAIL     0x526u
#define QB_KB_COUNT    0x528u

static int kb_available(void) { return mem[QB_KB_COUNT] != 0; }

/* 1 エントリ dequeue。空なら -1。bios18.c:keyget() と同じ巻き戻し規則。 */
static int kb_get_word(void) {
    if (!mem[QB_KB_COUNT]) return -1;
    mem[QB_KB_COUNT]--;
    uint16_t pos = peek16(QB_KB_HEAD);
    uint16_t next = (uint16_t)(pos + 2);
    if (next >= QB_KB_BUF_WRAP) next = QB_KB_BUF;
    poke16(QB_KB_HEAD, next);
    return (int)peek16(pos);
}

/* 入力バッファを空にする (AH=0Ch のプリフラッシュ用)。head を tail に揃える。 */
static void kb_flush(void) {
    poke16(QB_KB_HEAD, peek16(QB_KB_TAIL));
    mem[QB_KB_COUNT] = 0;
}

/* CPU リダイレクト時の「dispatch tail の FLAGS 書き戻しを skip」フラグ。
 * 2 用途: (1) blocking 入力でキー待ち → CPU_IP を NOP に戻して再ポーリング、
 * (2) AH=4Bh EXEC で CPU を子エントリへ切替 (SS:SP も変わるので書き戻すと子スタックを壊す)。
 * どちらも「今回は親の IRET フレームに触らず CPU を別所へ飛ばした」ケース。 */
static int g_int21_repoll;

/* AH=0Ah (行入力) を再ポーリング跨ぎで継続するための状態。
 * 進捗 len をゲスト buf[1] に頼らず C 側で保持する (初回 buf[1] は不定なので)。 */
static int      g_la_active;
static uint32_t g_la_buf;
static uint8_t  g_la_len;

/* DOS は大小を区別しないが Emscripten FS (MEMFS) は区別する。両者を埋めるため
 * DOS パス → host パス変換は「コンポーネント単位で /run 配下を case-insensitive に
 * 実在名へ解決する」リゾルバ方式を採る (旧実装の「両側で強制小文字化」ハックは廃止)。
 * サブディレクトリも保持する。 */

/* ===== ファイル名の不変条件 (正準形) ==================================================
 * MEMFS のノード名 = 「SJIS 生バイト列を 1 文字 1 バイトで U+0000-00FF に写した JS 文字列
 * (latin1)」。JS 側 (archive.js / diskimage.js) はこの形で書き、表示だけ decodeSjisText が
 * SJIS→Unicode に復号する。C 側から見ると:
 *   - readdir の d_name はノード名の UTF-8 符号化 = 0x80-0xFF のバイトが C2/C3 xx の
 *     2 バイトに膨らんで見える (例: "東方封魔.録" の先頭 0x93 → C2 93)
 *   - libc (fopen/mkdir/...) に渡すパスは UTF8ToString で復号される → 同じ UTF-8 符号化で
 *     渡せば正確に latin1 ノード名へ round-trip する
 * C 内部のパス表現は「生 SJIS バイト列」(DOS 世界の通貨そのまま) に統一し、変換は次の
 * 2 箇所だけで行う:
 *   - 読み (d_name → 内部): utf8_next_lowbyte / ci_equal_fsname / fold_fsname_to_sjis
 *   - 書き (内部 → libc): fs_path_utf8 + fs_fopen/fs_opendir/... ラッパ群 (下)
 * ラッパを通さず生 SJIS を fopen 等に渡してはならない: Emscripten がパスを UTF-8 として
 * 復号し、不正バイトを TextDecoder が U+FFFD に潰す。これは不可逆で、例えば「東」(93 60)
 * と「残」(8E 60) は同じ "�`" に衝突する — ゲスト (自己展開書庫等) が AH=3Ch で作る
 * SJIS 名が化け、別ファイル同士が上書きし合い、FindFirst でも見つからなくなる真因だった。 */
static uint8_t utf8_next_lowbyte(const unsigned char **pp) {
    const unsigned char *p = *pp;
    unsigned char c = p[0];
    uint32_t cp;
    if (c < 0x80) {                                                  /* ASCII (1 byte) */
        cp = c; p += 1;
    } else if ((c & 0xE0) == 0xC0 && (p[1] & 0xC0) == 0x80) {        /* 2 byte (U+0080..07FF) */
        cp = ((uint32_t)(c & 0x1F) << 6) | (p[1] & 0x3F); p += 2;
    } else if ((c & 0xF0) == 0xE0 && (p[1] & 0xC0) == 0x80          /* 3 byte (念のため) */
                                  && (p[2] & 0xC0) == 0x80) {
        cp = ((uint32_t)(c & 0x0F) << 12) | ((uint32_t)(p[1] & 0x3F) << 6) | (p[2] & 0x3F); p += 3;
    } else {
        cp = c; p += 1;                                             /* 不正シーケンス: 生バイト扱い */
    }
    *pp = p;
    return (uint8_t)cp;                                             /* 下位 8bit = 元の latin1/SJIS バイト */
}

/* DOS 名 (生 SJIS バイト) と MEMFS d_name (UTF-8 of latin1(SJIS)) を ASCII 大小無視で一致比較。
 * d_name 側だけ UTF-8 を畳んで元バイトへ戻す (上のコメント参照)。ASCII のみなら従来の素朴比較と等価。 */
static int ci_equal_fsname(const char *dname_utf8, const char *dosname) {
    const unsigned char *a = (const unsigned char *)dname_utf8;
    const unsigned char *b = (const unsigned char *)dosname;
    while (*a && *b) {
        uint8_t ca = utf8_next_lowbyte(&a);
        uint8_t cb = *b++;
        if (tolower(ca) != tolower(cb)) return 0;
    }
    return *a == '\0' && *b == '\0';
}

/* MEMFS d_name (UTF-8 of latin1(SJIS)) を「元の生 SJIS バイト列」へ畳んで out に書く (NUL 終端、
 * cap で打ち切り)。find (AH=4Eh/4Fh) の wildcard 照合と DTA への結果書き込みを、open 経路
 * (ci_equal_fsname) と同じ「生 SJIS」基準に揃えるためのもの。これを通さず d_name (UTF-8) を直に
 * DTA へ書くと、ゲームが FindFirst で得た名前を再 open する際 open 側が SJIS を期待して不一致になり、
 * かつ 0x80-0xFF が 2-3 byte に膨れて 8.3 枠でマルチバイト境界の途中で切れる。ASCII 名は恒等。 */
static void fold_fsname_to_sjis(const char *dname_utf8, char *out, size_t cap) {
    if (cap == 0) return;
    const unsigned char *p = (const unsigned char *)dname_utf8;
    size_t i = 0;
    while (*p && i + 1 < cap) out[i++] = (char)utf8_next_lowbyte(&p);
    out[i] = '\0';
}

/* Shift-JIS 第 1 バイト判定 (0x81-0x9F, 0xE0-0xFC)。decodeSjisText (JS) と同一基準。 */
static int sjis_is_lead(uint8_t c) {
    return (c >= 0x81 && c <= 0x9F) || (c >= 0xE0 && c <= 0xFC);
}

/* ---- FS パス境界シム: 内部表現 (生 SJIS) → libc (UTF-8 of latin1) ----
 * 0x80-FF の各バイトを C2/C3 xx の 2 バイトに符号化する。utf8_next_lowbyte の逆写像で、
 * 0x00-FF 全バイトが可逆 (情報を落とさない)。ASCII のみのパスは恒等。 */
static void fs_path_utf8(const char *sjis, char *out, size_t cap) {
    size_t o = 0;
    for (const unsigned char *p = (const unsigned char *)sjis; *p; p++) {
        if (*p < 0x80) {
            if (o + 1 >= cap) break;
            out[o++] = (char)*p;
        } else {
            if (o + 2 >= cap) break;
            out[o++] = (char)(0xC0 | (*p >> 6));
            out[o++] = (char)(0x80 | (*p & 0x3F));
        }
    }
    out[o] = '\0';
}

/* libc 呼び出しの薄いラッパ群。パスは必ず内部表現 (生 SJIS) で受ける。
 * 不変条件 (上のコメント) を守るため、DOS 由来のパスで libc を直接呼んではならない。 */
static FILE *fs_fopen(const char *path, const char *mode) {
    char u[520]; fs_path_utf8(path, u, sizeof(u)); return fopen(u, mode);
}
static DIR *fs_opendir(const char *path) {
    char u[520]; fs_path_utf8(path, u, sizeof(u)); return opendir(u);
}
static int fs_stat(const char *path, struct stat *st) {
    char u[520]; fs_path_utf8(path, u, sizeof(u)); return stat(u, st);
}
static int fs_unlink(const char *path) {
    char u[520]; fs_path_utf8(path, u, sizeof(u)); return unlink(u);
}
static int fs_mkdir(const char *path) {
    char u[520]; fs_path_utf8(path, u, sizeof(u)); return mkdir(u, 0777);
}
static int fs_rmdir(const char *path) {
    char u[520]; fs_path_utf8(path, u, sizeof(u)); return rmdir(u);
}

/* dir 内に name と大小無視で一致する実在エントリがあれば found に実在名を書いて 1。
 * 無ければ (dir が開けない場合含む) 0 を返し found は触らない。
 * dir / found とも内部表現 (生 SJIS)。d_name (UTF-8) は畳んでから返す —
 * これで host パスは常に純粋な生 SJIS になり、libc へは fs_* ラッパが一括符号化する。 */
static int ci_lookup(const char *dir, const char *name, char *found, size_t cap) {
    DIR *d = fs_opendir(dir);
    if (!d) return 0;
    struct dirent *de;
    int hit = 0;
    while ((de = readdir(d)) != NULL) {
        if (ci_equal_fsname(de->d_name, name)) {
            fold_fsname_to_sjis(de->d_name, found, cap);
            hit = 1;
            break;
        }
    }
    closedir(d);
    return hit;
}

/* カレントディレクトリ (/run 相対、'/' 区切り、先頭/末尾スラッシュ無し、'' = ルート)。
 * AH=3Bh CHDIR で更新、AH=47h GetCurDir で返す。相対パス解決時に read_dos_rel が前置する。
 * 実 DOS のカレントディレクトリと同じ意味論 (ドライブは単一なので drive 別 CWD は持たない)。
 * image 起動ごとに qb_dos_tty_reset でルートへ戻す。 */
static char g_cwd[192];

/* DS:DX 等の ASCIZ DOS パスを読み、drive letter 除去・'\\'→'/'・先頭 '/' 除去した
 * 相対パスを rel に書く (大小は保持)。相対パス (先頭 '\\' でない) はカレントディレクトリ
 * g_cwd を前置して /run からの相対に直す (実 DOS のカレント基準解決と同じ)。 */
static void read_dos_rel(uint16_t seg, uint16_t off, char *rel, size_t cap) {
    uint32_t base = lin(seg, off);
    char c0 = (char)peek8(base);
    char c1 = (char)peek8(base + 1);
    uint32_t i = (c0 && c1 == ':') ? 2u : 0u;   /* drive letter "X:" をスキップ */
    char raw[256];
    size_t n = 0;
    while (n + 1 < sizeof(raw)) {
        uint8_t c = peek8(base + i++);
        if (c == 0) break;
        /* DBCS ペアは素通し: SJIS トレイルバイトには 0x5C ("表"=95 5C 等) があり得るので、
         * リードバイトの次の 1 バイトをパス区切りと解釈してはならない (実 DOS と同じ)。 */
        if (sjis_is_lead(c) && n + 2 < sizeof(raw)) {
            uint8_t c2 = peek8(base + i);
            if (c2 != 0) {
                i++;
                raw[n++] = (char)c;
                raw[n++] = (char)c2;
                continue;
            }
        }
        raw[n++] = (c == '\\') ? '/' : (char)c;
    }
    raw[n] = '\0';
    int absolute = (raw[0] == '/');             /* 先頭 '\\' (= '/') があれば絶対パス */
    const char *core = raw;
    while (*core == '/') core++;                  /* 先頭 '/' を除去して相対化 */
    if (!absolute && g_cwd[0] != '\0') {          /* 相対 & カレントがルートでない → 前置 */
        if (*core) snprintf(rel, cap, "%s/%s", g_cwd, core);
        else       snprintf(rel, cap, "%s", g_cwd);
    } else {
        snprintf(rel, cap, "%s", core);
    }
}

/* "data/sub" のようなディレクトリ相対パスを /run 配下の実在パスへ case-insensitive
 * に解決して out に書く。未存在コンポーネント以降は DOS 指定名をそのまま採用する
 * (呼び出し側で opendir が失敗 → 空一致になる)。 */
static void resolve_dir(const char *reldir, char *out, size_t cap) {
    snprintf(out, cap, "/run");
    const char *p = reldir;
    while (*p == '/') p++;
    int missing = 0;
    while (*p) {
        char comp[160];
        size_t cl = 0;
        while (*p && *p != '/' && cl + 1 < sizeof(comp)) comp[cl++] = *p++;
        comp[cl] = '\0';
        while (*p == '/') p++;

        char found[160];
        const char *use = comp;
        if (!missing && ci_lookup(out, comp, found, sizeof(found))) use = found;
        else missing = 1;

        size_t ol = strlen(out);
        snprintf(out + ol, cap - ol, "/%s", use);
    }
}

/* DOS パス (seg:off) を /run 配下の host パスに解決する。
 * 戻り値 (呼び出し側で DOS error code に使う):
 *   0 = 末端まで実在 (= 既存ファイル)
 *   1 = 親までは実在、末端ファイルのみ欠 → file-not-found (AX=2)
 *   2 = 途中ディレクトリが欠 → path-not-found (AX=3)
 * いずれの場合も out には「作るならここ」という確定パスを書く (create 用)。 */
static int dos_path_to_host(uint16_t seg, uint16_t off, char *out, size_t cap) {
    char rel[192];
    read_dos_rel(seg, off, rel, sizeof(rel));

    /* 末端コンポーネント (leaf) と親ディレクトリに分割 */
    char *slash = strrchr(rel, '/');
    char dirpart[192];
    const char *leaf;
    if (slash) {
        size_t dl = (size_t)(slash - rel);
        memcpy(dirpart, rel, dl);
        dirpart[dl] = '\0';
        leaf = slash + 1;
    } else {
        dirpart[0] = '\0';
        leaf = rel;
    }

    char dir[256];
    resolve_dir(dirpart, dir, sizeof(dir));

    int dir_exists = 0;
    { DIR *d = fs_opendir(dir); if (d) { dir_exists = 1; closedir(d); } }

    char found[160];
    int leaf_hit = ci_lookup(dir, leaf, found, sizeof(found));
    snprintf(out, cap, "%s/%s", dir, leaf_hit ? found : leaf);

    if (!dir_exists) return 2;   /* path not found */
    if (!leaf_hit)   return 1;   /* file not found (親はある) */
    return 0;
}

/* ---------------- ファイルハンドルテーブル ---------------- */
/* DOS handle 0-2 = stdin/stdout/stderr (実装は最小限、参照されたら stderr に出すだけ)
 * 5-19 = ユーザがオープン可能。AH=3Ch/3Dh で割り当てる。 */
#define DOS_HANDLE_MAX 32
#define DOS_HANDLE_USER_BASE 5

typedef struct {
    int   used;
    FILE *fp;
    char  path[160];
    char  mode[8];     /* fopen モード ("rb"/"r+b"/"w+b") — AH=45h DUP の再オープン用 */
} qb_fh_t;
static qb_fh_t g_fh[DOS_HANDLE_MAX];

static int fh_alloc(FILE *fp, const char *path, const char *mode) {
    for (int h = DOS_HANDLE_USER_BASE; h < DOS_HANDLE_MAX; h++) {
        if (!g_fh[h].used) {
            g_fh[h].used = 1;
            g_fh[h].fp   = fp;
            strncpy(g_fh[h].path, path ? path : "", sizeof(g_fh[h].path) - 1);
            g_fh[h].path[sizeof(g_fh[h].path) - 1] = '\0';
            strncpy(g_fh[h].mode, mode ? mode : "rb", sizeof(g_fh[h].mode) - 1);
            g_fh[h].mode[sizeof(g_fh[h].mode) - 1] = '\0';
            return h;
        }
    }
    return -1;
}

static FILE *fh_get(int h) {
    if (h < 0 || h >= DOS_HANDLE_MAX) return NULL;
    if (!g_fh[h].used) return NULL;
    return g_fh[h].fp;
}

static int fh_close(int h) {
    if (h < 0 || h >= DOS_HANDLE_MAX) return -1;
    if (!g_fh[h].used) return -1;
    int r = g_fh[h].fp ? fclose(g_fh[h].fp) : 0;
    g_fh[h].used = 0;
    g_fh[h].fp = NULL;
    g_fh[h].path[0] = '\0';
    return r;
}

static void fh_reset_all(void) {
    for (int h = 0; h < DOS_HANDLE_MAX; h++) {
        if (g_fh[h].used && g_fh[h].fp) fclose(g_fh[h].fp);
        g_fh[h].used = 0;
        g_fh[h].fp = NULL;
        g_fh[h].path[0] = '\0';
    }
}

/* EXEC 子のハンドル掃除 (dos_loader.c が使う)。実 DOS は子の終了で子が開いた
 * ファイルを閉じる (free-on-terminate) が、我々のハンドル表はプロセス間共有なので、
 * EXEC 時点で open 中のユーザハンドルを bitmask で記録し (snapshot)、子終了で
 * 「それ以降に開いた分」だけ閉じる。親が開いていたハンドルは温存する。
 * (TSR=31h は常駐させるので呼ばない。) DOS_HANDLE_MAX <= 32 前提 (1u<<h)。 */
uint32_t qb_dos_fh_snapshot(void) {
    uint32_t m = 0;
    for (int h = DOS_HANDLE_USER_BASE; h < DOS_HANDLE_MAX; h++)
        if (g_fh[h].used) m |= (1u << h);
    return m;
}
void qb_dos_fh_close_since(uint32_t snapshot) {
    for (int h = DOS_HANDLE_USER_BASE; h < DOS_HANDLE_MAX; h++) {
        if (g_fh[h].used && !(snapshot & (1u << h))) fh_close(h);
    }
}

/* ---------------- DTA / Find First-Next ---------------- */
/* DTA 既定は PSP:0080 (cmdline 領域と共有)。AH=1Ah で書き換え可能。 */
static uint32_t g_dta_linear = ((uint32_t)0x0100 << 4) + 0x80;
/* AH=2Fh (Get DTA) が元の seg:off をそのまま返せるよう保持 (linear だけだと
 * オフセット granularity を失う)。既定は PSP:0x80。 */
static uint16_t g_dta_seg = 0x0100;
static uint16_t g_dta_off = 0x0080;

/* findfirst 状態。次回 4Fh のために DIR* と pattern を持つ。
 * (DTA reserved 領域への state 埋め込みは諦め、static global で 1 本だけ持つ。
 *  同時に複数 search を回すソフトは想定外。) */
static struct {
    DIR  *dirp;
    char  dir[256];      /* opendir 中のホストディレクトリ (case-insensitive 解決済) */
    char  pattern[64];   /* DOS wildcard (原文。dos_wildcard_match が大小無視で照合) */
    uint8_t attr_mask;
} g_find;

/* DOS wildcard match: '?' は任意 1 文字、'*' は 0 文字以上。大小無視。 */
static int dos_wildcard_match(const char *pat, const char *name) {
    /* "8.3" に正規化せず、生 pattern と name を直接比較。
     * 単純な再帰実装で十分 (パターンは短い)。 */
    if (*pat == '\0') return *name == '\0';
    if (*pat == '*') {
        while (*pat == '*') pat++;
        if (*pat == '\0') return 1;  /* 末尾 * は何でも OK */
        for (; *name; name++) {
            if (dos_wildcard_match(pat, name)) return 1;
        }
        return dos_wildcard_match(pat, name);
    }
    if (*name == '\0') return 0;
    if (*pat != '?' &&
        tolower((unsigned char)*pat) != tolower((unsigned char)*name)) return 0;
    return dos_wildcard_match(pat + 1, name + 1);
}

/* DTA に find 結果を書く。filename は "8.3" + 末尾 NUL を 13 byte 領域に詰める。
 * mtime は FAT date/time に変換 (0 なら 0 のまま)。is_dir なら attr = 0x10。 */
static void dta_write_find(const char *fname, long fsize, time_t mtime, int is_dir) {
    /* DTA レイアウト (DOS 標準):
     *  +0x00..0x14 : reserved (search state) — 触らない
     *  +0x15       : attribute byte
     *  +0x16..0x17 : file time (FAT)
     *  +0x18..0x19 : file date (FAT)
     *  +0x1A..0x1D : file size (32-bit LE)
     *  +0x1E..0x2A : filename (ASCIZ、最大 13 byte) */
    poke8(g_dta_linear + 0x15, (uint8_t)(is_dir ? 0x10 : 0x20));

    uint16_t fat_time = 0, fat_date = 0;
    if (mtime != 0) {
        struct tm *tm = localtime(&mtime);
        if (tm) {
            fat_time = (uint16_t)(((tm->tm_hour & 0x1F) << 11)
                                | ((tm->tm_min  & 0x3F) << 5)
                                | ((tm->tm_sec / 2) & 0x1F));
            int yr = tm->tm_year + 1900 - 1980;
            if (yr < 0)   yr = 0;
            if (yr > 127) yr = 127;
            fat_date = (uint16_t)(((yr & 0x7F) << 9)
                                | (((tm->tm_mon + 1) & 0x0F) << 5)
                                | (tm->tm_mday & 0x1F));
        }
    }
    poke16(g_dta_linear + 0x16, fat_time);
    poke16(g_dta_linear + 0x18, fat_date);
    poke32(g_dta_linear + 0x1A, (uint32_t)fsize);

    /* filename: 生 SJIS バイト (fname は fold_fsname_to_sjis 済) を大文字化して 13 byte 領域
     * (8.3 = 12 + NUL) に書く。末端は明示的に 0 埋めしないと DTA に過去のゴミが残る。
     * DBCS (SJIS 2 バイト文字) を意識する: リードバイトの次 (trail) は 0x40-0x7E に 'a'-'z' を
     * 含むので大文字化してはならず、また 12 byte 境界で 2 バイト文字を割らない。 */
    uint8_t up[13];
    memset(up, 0, sizeof(up));
    size_t i = 0;
    const unsigned char *q = (const unsigned char *)fname;
    while (*q && i + 1 < sizeof(up)) {
        unsigned char c = *q;
        if (sjis_is_lead(c) && q[1]) {          /* DBCS: 2 バイトを verbatim (trail は大文字化しない) */
            if (i + 2 >= sizeof(up)) break;     /* trail が 12 byte 内に収まらない → ここで打ち切り */
            up[i++] = c;
            up[i++] = q[1];
            q += 2;
        } else {                                /* ASCII (or 単独バイト): a-z のみ大文字化 */
            up[i++] = (c >= 'a' && c <= 'z') ? (uint8_t)(c - 32) : c;
            q += 1;
        }
    }
    for (size_t k = 0; k < sizeof(up); k++) {
        poke8(g_dta_linear + 0x1E + k, up[k]);
    }
}

/* g_find.dirp/dir/pattern を使って次の一致を 1 件スキャン。一致を DTA に書いて 0、
 * 尽きたら closedir して 1。
 * DOS の attr 検索意味論: 通常ファイルは search attr に関わらず常にマッチ。
 * ディレクトリは attr_mask に 0x10 がある時だけ含める (hidden/system/volume は
 * /run に存在しないので考慮不要)。 */
static int find_scan(void) {
    struct dirent *de;
    while ((de = readdir(g_find.dirp)) != NULL) {
        if (de->d_name[0] == '.') continue;
        /* DOS 側に見せる名前は生 SJIS。pattern (生 SJIS) との照合も DTA 書き込みも
         * 畳んだ名前で行い、open 経路 (ci_equal_fsname) と round-trip するようにする。
         * stat も内部表現 (生 SJIS) でパスを組み fs_stat が一括符号化する。 */
        char sjisname[260];
        fold_fsname_to_sjis(de->d_name, sjisname, sizeof(sjisname));
        if (!dos_wildcard_match(g_find.pattern, sjisname)) continue;
        char full[512];
        snprintf(full, sizeof(full), "%s/%s", g_find.dir, sjisname);
        struct stat st;
        int have   = (fs_stat(full, &st) == 0);
        int is_dir = have && S_ISDIR(st.st_mode);
        if (is_dir && !(g_find.attr_mask & 0x10)) continue;
        dta_write_find(sjisname,
                       have ? (long)st.st_size  : 0,
                       have ? st.st_mtime       : (time_t)0,
                       is_dir);
        return 0;
    }
    closedir(g_find.dirp);
    g_find.dirp = NULL;
    return 1;
}

/* dir (case-insensitive 解決済 host パス) 内を pattern で検索。最初の一致を DTA へ。
 * 戻り値: 0 = 一致あり、!= 0 = 一致なし (DOS error 02h) */
static int find_first_match(const char *dir, const char *pattern_dos) {
    if (g_find.dirp) { closedir(g_find.dirp); g_find.dirp = NULL; }
    strncpy(g_find.dir, dir, sizeof(g_find.dir) - 1);
    g_find.dir[sizeof(g_find.dir) - 1] = '\0';
    strncpy(g_find.pattern, pattern_dos, sizeof(g_find.pattern) - 1);
    g_find.pattern[sizeof(g_find.pattern) - 1] = '\0';

    g_find.dirp = fs_opendir(dir);
    if (!g_find.dirp) return 1;
    return find_scan();
}

static int find_next_match(void) {
    if (!g_find.dirp) return 1;
    return find_scan();
}

/* ---------------- INT 21h 個別 fn ---------------- */

static void int21_02_putchar(void) { tty_putc(CPU_DL); }

static void int21_06_direct_io(void) {
    /* DL = 0xFF: STDIN を非ブロッキングで読む (あれば ZF=0 AL=char、なければ ZF=1 AL=0)
     * その他  : DL を出力。06h は仕様上ブロックしない (kbhit 相当)。 */
    if (CPU_DL == 0xFF) {
        int w = kb_get_word();
        if (w < 0) { CPU_AL = 0; CPU_FLAG |= Z_FLAG; }
        else       { CPU_AL = (uint8_t)(w & 0xFF); CPU_FLAG &= ~Z_FLAG; }
    } else {
        tty_putc(CPU_DL);
        CPU_FLAG &= ~Z_FLAG;
    }
}

/* blocking 入力の共通部。文字があれば 0-255 を返す。無ければ NP2kai 流に
 * CPU_IP を NOP に巻き戻し IRQ 処理へ譲って (bios18.c AH=00h と同手法) -1 を返す。
 * 呼び出し側は -1 のとき AL を設定せず即 return すること。 */
static int dos_getch_block(void) {
    int w = kb_get_word();
    if (w < 0) {
        /* **IF を立てる (実 DOS の STI 相当)**: INT 21h 命令が IF をクリアした状態で
         * 再ポーリングすると、キーボード IRQ が発火できず 0x502 バッファが永久に
         * 埋まらずデッドロックする (zar の quit パスの AH=07h で顕在化)。待ち中だけ
         * 割り込みを許可してキーが届くようにする。 */
        CPU_FLAG |= I_FLAG;
        CPU_IP--;               /* NOP (トランポリン) を踏み直す */
        CPU_REMCLOCK = -1;      /* スライス終了 → キーボード IRQ を処理させる */
        g_int21_repoll = 1;
        return -1;
    }
    return w & 0xFF;
}

static void int21_01_getch_echo(void) {        /* 文字入力 (echo あり) */
    int c = dos_getch_block();
    if (c < 0) return;
    CPU_AL = (uint8_t)c;
    tty_putc((uint8_t)c);
}

static void int21_07_getch_raw(void) {         /* 文字入力 (echo 無し・Ctrl-C 無視) */
    int c = dos_getch_block();
    if (c < 0) return;
    CPU_AL = (uint8_t)c;
}

static void int21_08_getch_noecho(void) {      /* 文字入力 (echo 無し)。Ctrl-C は無視 */
    int c = dos_getch_block();
    if (c < 0) return;
    CPU_AL = (uint8_t)c;
}

static void int21_0b_instat(void) {            /* 入力状態 (非ブロッキング kbhit) */
    CPU_AL = kb_available() ? 0xFF : 0x00;
}

/* AH=0Ah 行バッファ入力。DS:DX → [0]=最大文字数(CR 含む) [1]=実数(出力) [2..]=本体。
 * CR (0x0D) で確定、BS (0x08) で 1 文字消去。1 文字も無ければ再ポーリング。
 * 進捗は g_la_* に保持し、再ポーリング跨ぎで継続する。 */
static void int21_0a_buffered(void) {
    uint32_t buf = lin(CPU_DS, CPU_DX);
    uint8_t maxlen = peek8(buf);
    if (maxlen == 0) return;                   /* 受け入れ 0 = 即終了 */

    uint8_t len;
    if (g_la_active && g_la_buf == buf) {
        len = g_la_len;                        /* 再ポーリング継続 */
    } else {
        len = 0; g_la_active = 1; g_la_buf = buf;   /* 新規開始 (buf[1] には頼らない) */
    }

    for (;;) {
        int w = kb_get_word();
        if (w < 0) {                           /* 入力待ち → 再ポーリング (IF を立てて IRQ 許可) */
            g_la_len = len;
            CPU_FLAG |= I_FLAG;
            CPU_IP--; CPU_REMCLOCK = -1; g_int21_repoll = 1;
            return;
        }
        uint8_t ch = (uint8_t)(w & 0xFF);
        if (ch == 0x0D) {                      /* 確定 */
            poke8(buf + 2 + len, 0x0D);
            poke8(buf + 1, len);
            tty_putc(0x0D); tty_putc(0x0A);
            g_la_active = 0;
            return;
        }
        if (ch == 0x08) {                      /* バックスペース */
            if (len > 0) { len--; tty_putc(0x08); tty_putc(0x20); tty_putc(0x08); }
            continue;
        }
        if ((int)len + 1 < (int)maxlen) {      /* CR 用に 1 残す */
            poke8(buf + 2 + len, ch);
            len++;
            tty_putc(ch);                      /* echo */
        }
        /* バッファ満杯はだまって無視 (実 DOS は BEEP) */
    }
}

/* AH=0Ch 入力バッファ flush 後に AL の入力 fn を実行。
 *
 * 注意 (再ポーリングとの相互作用): 内側がブロッキング系 (01/07/08/0A) の場合、
 * 入力待ちで CPU_IP を巻き戻して同じ INT 21h を踏み直す。このときゲストの AX は
 * 不変なので AH=0Ch のまま再入する。素朴に毎回 kb_flush() すると、待っている間に
 * 届いたキーを再ポーリングのたびに捨ててしまい永久に入力が完了しない。
 * → flush は「0Ch の最初の 1 回」だけに限定する (g_0c_flushing ラッチ)。
 * 内側 fn が完了 (= 再ポーリングせず) したらラッチを解除する。 */
static int g_0c_flushing;
static void int21_0c_flush_input(void) {
    if (!g_0c_flushing) {
        kb_flush();
        g_0c_flushing = 1;
    }
    switch (CPU_AL) {
    case 0x01: int21_01_getch_echo();   break;
    case 0x06: int21_06_direct_io();    break;
    case 0x07: int21_07_getch_raw();    break;
    case 0x08: int21_08_getch_noecho(); break;
    case 0x0A: int21_0a_buffered();     break;
    default:   CPU_AL = 0;              break;   /* 無効 fn: 何もしない */
    }
    /* g_int21_repoll が立っていれば内側 fn は「キー待ちで再ポーリング中」なので
     * ラッチを保持 (次の再入で再 flush しない)。立っていなければ完了したので解除。 */
    if (!g_int21_repoll) g_0c_flushing = 0;
}

static void int21_19_curdrive(void) {          /* カレントドライブ取得。常に A: (=0) */
    CPU_AL = 0;
}

/* AH=33h Ctrl-Break チェックフラグ get/set。我々は実際の break 検出をしないので
 * 値を保持するだけ。C ランタイムが起動時に AL=00 で読むのを成立させる。 */
static int g_ctrl_break;
static void int21_33_ctrlbreak(void) {
    switch (CPU_AL) {
    case 0x00: CPU_DL = (uint8_t)g_ctrl_break;       break;   /* get */
    case 0x01: g_ctrl_break = (CPU_DL != 0);         break;   /* set */
    default:   CPU_DL = (uint8_t)g_ctrl_break;       break;   /* 02-06: 無害に get 扱い */
    }
}

static void int21_09_putstr(void) {
    uint32_t base = lin(CPU_DS, CPU_DX);
    for (int i = 0; i < 4096; i++) {
        uint8_t ch = peek8(base + i);
        if (ch == '$') return;
        tty_putc(ch);
    }
    fprintf(stderr, "[int21h/09] WARN: '$' 見つからず 4KB で打ち切り\n");
}

static void int21_1a_set_dta(void) {
    g_dta_seg = CPU_DS;
    g_dta_off = CPU_DX;
    g_dta_linear = lin(CPU_DS, CPU_DX);
}

static void int21_2f_get_dta(void) {
    /* ES:BX = 現在の DTA。1Ah で設定された seg:off をそのまま返す。 */
    CPU_ES = g_dta_seg;
    CPU_BX = g_dta_off;
}

/* DTA は実機 DOS ではプロセスごと (既定 = PSP:0080)。我々は g_dta_* を 1 本しか
 * 持たないので、EXEC で子に切り替えるときは dos_loader.c がこのアクセサで親 DTA を
 * 退避し、子の既定 (子 PSP:0080) を設定、子終了で親 DTA を復元する。これがないと
 * 子が AH=1Ah 無しで FindFirst したとき親 PSP に書き込んでしまう。 */
uint32_t qb_dos_dta_get_packed(void) {
    return ((uint32_t)g_dta_seg << 16) | g_dta_off;
}
void qb_dos_dta_set(uint16_t seg, uint16_t off) {
    g_dta_seg = seg;
    g_dta_off = off;
    g_dta_linear = lin(seg, off);
}

static void int21_47_getcurdir(void) {
    /* DL = drive (0=default, 1=A:...), DS:SI = 64 byte バッファ。
     * カレントディレクトリ g_cwd を「drive letter も先頭 '\' も含めず」'\' 区切りで
     * 書く (実 DOS 仕様)。ルートは空文字列 (先頭 NUL)。CHDIR (3Bh) と連動する。 */
    uint32_t buf = lin(CPU_DS, CPU_SI);
    size_t k = 0;
    for (; g_cwd[k] && k < 63; k++) {
        poke8(buf + k, (uint8_t)(g_cwd[k] == '/' ? '\\' : g_cwd[k]));
    }
    poke8(buf + k, 0x00);
    CPU_AX = 0x0100;           /* 実 DOS が返す慣例値 */
    CPU_FLAG &= ~C_FLAG;
}

static void int21_25_set_vec(void) {
    uint8_t vec = CPU_AL;
    uint32_t a = (uint32_t)vec * 4u;
    poke16(a,     CPU_DX);
    poke16(a + 2, CPU_DS);
}

/* PC-98 同時代の年へクランプする。対象は 1990 年代のフリーソフト/同人ゲーム (例: 蟹味噌は
 * 1992 年・PC-9801 用)。当時は完全に pre-Y2K で、年を「年-1900」の 2 桁前提に扱う
 * (蟹味噌の KANI.SCR は固定幅レコードに "YY/MM/DD" を書く)。現在年 2026 を素直に返すと
 * "2026-1900=126" の 3 桁になり日付フィールドがオーバーフロー → ファイル形式が壊れてゲームが
 * 自分の出力を読めず "形式が違います" になる (Y2K 系バグの誘発)。判定基準は pre-Y2K の上限
 * 1999 に置き、20xx は一律 1999 に丸める (表示 "99"・2 桁)。19xx はそのまま。
 * ※蟹味噌は DOS の日付でなく PC-98 RTC を読む → 本丸の対策は calendar.c の date2bcd 側
 *   (同じ 1999 クランプ)。こちらは DOS AH=2Ah を使う他タイトル用の同等対策。 */
static uint16_t qb_era_year(uint16_t year) {
    if (year >= 2000) year = 1999;
    return year;
}

static void int21_2a_get_date(void) {
    time_t t = time(NULL);
    struct tm *tm = localtime(&t);
    if (!tm) { CPU_CX = 1999; CPU_DH = 1; CPU_DL = 1; CPU_AL = 0; return; }
    CPU_CX = qb_era_year((uint16_t)(tm->tm_year + 1900));
    CPU_DH = (uint8_t)(tm->tm_mon + 1);
    CPU_DL = (uint8_t)tm->tm_mday;
    CPU_AL = (uint8_t)tm->tm_wday;
}

static void int21_2c_get_time(void) {
    /* DL (1/100 秒) は time-seed 系ゲームの乱数エントロピー源になるので、
     * 秒未満を gettimeofday から実値で返す (time(NULL) の秒だけだと DL=0 固定で
     * 同一秒内の連続シードが衝突する)。 */
    struct timeval tv;
    gettimeofday(&tv, NULL);
    time_t t = tv.tv_sec;
    struct tm *tm = localtime(&t);
    if (!tm) { CPU_CH = 0; CPU_CL = 0; CPU_DH = 0; CPU_DL = 0; return; }
    CPU_CH = (uint8_t)tm->tm_hour;
    CPU_CL = (uint8_t)tm->tm_min;
    CPU_DH = (uint8_t)tm->tm_sec;
    CPU_DL = (uint8_t)(tv.tv_usec / 10000);   /* 0..99 */
}

static void int21_30_version(void) {
    /* DOS 5.00 を名乗る (90 年代ソフトの大半が ≥ 3.30 を期待) */
    CPU_AL = 5;
    CPU_AH = 0;
    CPU_BX = 0;
    CPU_CX = 0;
}

static void int21_35_get_vec(void) {
    uint8_t vec = CPU_AL;
    uint32_t a = (uint32_t)vec * 4u;
    uint16_t off = (uint16_t)peek8(a)     | ((uint16_t)peek8(a+1) << 8);
    uint16_t seg = (uint16_t)peek8(a+2)   | ((uint16_t)peek8(a+3) << 8);
    CPU_BX = off;
    CPU_ES = seg;
}

/* path から FILE* を開き、ハンドルを返す。失敗時 -err (DOS error)。 */
static int dos_open_common(const char *mode_str) {
    char host[256];
    int st = dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    FILE *fp = fs_fopen(host, mode_str);
    if (!fp) {
        fprintf(stderr, "[int21h/open] fopen(%s, \"%s\") failed (path-status %d)\n",
                host, mode_str, st);
        return (st == 2) ? -3 : -2;  /* path-not-found(3) : file-not-found(2) */
    }
    int h = fh_alloc(fp, host, mode_str);
    if (h < 0) { fclose(fp); return -4; }  /* too many open files */
    fprintf(stderr, "[int21h/open] %s mode=%s → handle %d\n", host, mode_str, h);
    return h;
}

static void int21_3c_create(void) {
    int h = dos_open_common("w+b");
    if (h < 0) { CPU_AX = (uint16_t)-h; CPU_FLAG |= C_FLAG; return; }
    CPU_AX = (uint16_t)h;
    CPU_FLAG &= ~C_FLAG;
}

static void int21_3d_open(void) {
    /* EMS 需要プローブ: MS 標準の EMS 検出は "EMMXXXX0" デバイスを open → IOCTL で entry 取得。
     * デバイスは未実装なので open は失敗する (= EMS 無しと判定される) が、試行を記録する。 */
    {
        uint32_t la = ((uint32_t)CPU_DS << 4) + (uint16_t)CPU_DX;
        char nm[16];
        int k;
        for (k = 0; k < 15; k++) {
            uint8_t c = peek8(la + (uint32_t)k);
            if (c == 0) break;
            nm[k] = (c >= 'a' && c <= 'z') ? (char)(c - 32) : (char)c;  /* 大文字化 */
        }
        nm[k] = 0;
        if (strstr(nm, "EMMXXXX0")) qb_dos_memprobe_note_emm_open();
    }
    /* AL = mode: 0=read, 1=write, 2=rw */
    const char *m = "rb";
    switch (CPU_AL & 0x07) {
        case 0: m = "rb";  break;
        case 1: m = "r+b"; break;  /* 書き込みでも既存ファイル前提 */
        case 2: m = "r+b"; break;
        default: m = "rb"; break;
    }
    int h = dos_open_common(m);
    if (h < 0) { CPU_AX = (uint16_t)-h; CPU_FLAG |= C_FLAG; return; }
    CPU_AX = (uint16_t)h;
    CPU_FLAG &= ~C_FLAG;
}

static void int21_3e_close(void) {
    int h = (int)CPU_BX;
    /* 標準ハンドル 0..4 (CON/AUX/PRN) は int21_44_ioctl で「常に open の
     * char device」として扱っている。実機 DOS でも close 可能なので、整合を
     * 取って no-op 成功にする (invalid handle を返すと矛盾する)。 */
    if (h >= 0 && h <= 4) {
        CPU_FLAG &= ~C_FLAG;
        return;
    }
    if (fh_close(h) < 0) {
        CPU_AX = 6;  /* invalid handle */
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_FLAG &= ~C_FLAG;
}

/* DUP/DUP2 でファイルを開き直す時のモード。作成 (AH=3Ch) ハンドルは "w+b" で記録されており、
 * そのまま fopen し直すと既存内容を 0 バイトに切り詰めてしまう。ファイルは既にディスク上に
 * 存在するので、切り詰めない読み書きモード "r+b" に写像する (読み取り専用 "rb" 等は不変)。 */
static const char *fh_reopen_mode(const char *mode) {
    return (mode && mode[0] == 'w') ? "r+b" : (mode ? mode : "rb");
}

/* AH=45h Duplicate Handle — BX のハンドルと同じファイルを指す新ハンドルを返す (AX)。
 * FILE* ベースなので「ファイルポインタ共有」は再現できない。同じ path/mode で開き直して
 * 元の現在位置へ seek した独立ハンドルを返す (read 用途では実用上等価。Ray が
 * RAY_IV.RAY のハンドルを dup する経路で必要)。 */
static void int21_45_dup(void) {
    int h = (int)CPU_BX;
    if (h < 0 || h >= DOS_HANDLE_MAX || !g_fh[h].used || !g_fh[h].fp) {
        CPU_AX = 6; CPU_FLAG |= C_FLAG; return;   /* invalid handle */
    }
    long pos = ftell(g_fh[h].fp);
    const char *rm = fh_reopen_mode(g_fh[h].mode);
    FILE *nf = fs_fopen(g_fh[h].path, rm);
    if (!nf) { CPU_AX = 4; CPU_FLAG |= C_FLAG; return; }   /* too many open files */
    if (pos >= 0) fseek(nf, pos, SEEK_SET);
    int nh = fh_alloc(nf, g_fh[h].path, rm);
    if (nh < 0) { fclose(nf); CPU_AX = 4; CPU_FLAG |= C_FLAG; return; }
    fprintf(stderr, "[int21h/45] DUP handle %d → %d (%s)\n", h, nh, g_fh[h].path);
    CPU_AX = (uint16_t)nh;
    CPU_FLAG &= ~C_FLAG;
}

/* AH=46h Force Duplicate (DUP2) — CX のハンドルを BX のコピーにする (開いていれば閉じてから)。
 * 標準ハンドル (0..4) への付け替え (= リダイレクト) は未対応。我々の stdout/stderr は tty 直結・
 * stdin はキーボード直結で、ハンドル番号で入出力先を差し替える層が無い。そこを「成功」と偽ると
 * プログラムは「handle 1 をファイルへ向けた」と信じて書くが実際は tty へ流れ、狙ったファイルは
 * 空のまま → 後で自分の出力を読み戻して破綻する (嘘の成功による遠隔破壊)。偽装でなく正直に
 * 失敗 (CF=1, AX=6=DUP2 の文書化済エラー) を返す。 */
static void int21_46_dup2(void) {
    int src = (int)CPU_BX;
    int dst = (int)CPU_CX;
    if (src < 0 || src >= DOS_HANDLE_MAX || !g_fh[src].used || !g_fh[src].fp ||
        dst < 0 || dst >= DOS_HANDLE_MAX) {
        CPU_AX = 6; CPU_FLAG |= C_FLAG; return;
    }
    if (src == dst) { CPU_AX = (uint16_t)dst; CPU_FLAG &= ~C_FLAG; return; }  /* 同一ハンドルは no-op (実 DOS 準拠。fh_close(dst) で src の FILE* を閉じてしまう UAF 回避) */
    if (dst < DOS_HANDLE_USER_BASE) {   /* 標準ハンドルへの redirect は未対応: 正直に失敗 */
        CPU_AX = 6; CPU_FLAG |= C_FLAG; return;
    }
    if (g_fh[dst].used) fh_close(dst);
    long pos = ftell(g_fh[src].fp);
    const char *rm = fh_reopen_mode(g_fh[src].mode);
    FILE *nf = fs_fopen(g_fh[src].path, rm);
    if (!nf) { CPU_AX = 4; CPU_FLAG |= C_FLAG; return; }
    if (pos >= 0) fseek(nf, pos, SEEK_SET);
    g_fh[dst].used = 1;
    g_fh[dst].fp   = nf;
    strncpy(g_fh[dst].path, g_fh[src].path, sizeof(g_fh[dst].path) - 1);
    g_fh[dst].path[sizeof(g_fh[dst].path) - 1] = '\0';
    strncpy(g_fh[dst].mode, rm, sizeof(g_fh[dst].mode) - 1);
    g_fh[dst].mode[sizeof(g_fh[dst].mode) - 1] = '\0';
    CPU_AX = (uint16_t)dst;
    CPU_FLAG &= ~C_FLAG;
}

static void int21_3f_read(void) {
    int h = (int)CPU_BX;
    FILE *fp = fh_get(h);
    if (!fp) { CPU_AX = 6; CPU_FLAG |= C_FLAG; return; }
    uint16_t want = CPU_CX;
    uint32_t dst = lin(CPU_DS, CPU_DX);
    /* チャンク化 (mem は 2MB 連続なので直接書ける) */
    uint8_t buf[4096];
    uint16_t total = 0;
    while (total < want) {
        size_t chunk = (want - total) > sizeof(buf) ? sizeof(buf) : (want - total);
        size_t got = fread(buf, 1, chunk, fp);
        if (got == 0) break;
        /* VRAM 宛 (Ray オープニング等の画像直 read) は memp_write8 経由 / 他は生書き。共有 helper。 */
        qb_mem_write(dst + total, buf, (uint32_t)got);
        total += (uint16_t)got;
        if (got < chunk) break;
    }
    CPU_AX = total;
    CPU_FLAG &= ~C_FLAG;
}

static void int21_40_write(void) {
    int h = (int)CPU_BX;
    uint16_t want = CPU_CX;

    /* handle 1/2 = stdout/stderr へは tty へ流す */
    if (h == 1 || h == 2) {
        uint32_t src = lin(CPU_DS, CPU_DX);
        for (uint16_t i = 0; i < want; i++) tty_putc(peek8(src + i));
        CPU_AX = want;
        CPU_FLAG &= ~C_FLAG;
        return;
    }

    FILE *fp = fh_get(h);
    if (!fp) { CPU_AX = 6; CPU_FLAG |= C_FLAG; return; }
    uint8_t buf[4096];
    uint32_t src = lin(CPU_DS, CPU_DX);
    uint16_t total = 0;
    while (total < want) {
        size_t chunk = (want - total) > sizeof(buf) ? sizeof(buf) : (want - total);
        /* VRAM 元 (画面を file に保存する系) は memp_read8 経由で GRCG read モードを反映。共有 helper。 */
        qb_mem_read(src + total, buf, (uint32_t)chunk);
        size_t put = fwrite(buf, 1, chunk, fp);
        total += (uint16_t)put;
        if (put < chunk) break;
    }
    fflush(fp);
    CPU_AX = total;
    CPU_FLAG &= ~C_FLAG;
}

static void int21_41_delete(void) {
    char host[256];
    dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    if (fs_unlink(host) != 0) {
        fprintf(stderr, "[int21h/41] unlink(%s) failed\n", host);
        CPU_AX = 2;
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_FLAG &= ~C_FLAG;
}

static void int21_42_seek(void) {
    int h = (int)CPU_BX;
    FILE *fp = fh_get(h);
    if (!fp) { CPU_AX = 6; CPU_FLAG |= C_FLAG; return; }
    int whence;
    switch (CPU_AL) {
        case 0: whence = SEEK_SET; break;
        case 1: whence = SEEK_CUR; break;
        case 2: whence = SEEK_END; break;
        default: CPU_AX = 1; CPU_FLAG |= C_FLAG; return;
    }
    /* CX:DX は符号付き 32-bit (DOS 標準) */
    int32_t off = (int32_t)(((uint32_t)CPU_CX << 16) | CPU_DX);
    if (fseek(fp, (long)off, whence) != 0) {
        CPU_AX = 6;
        CPU_FLAG |= C_FLAG;
        return;
    }
    long pos = ftell(fp);
    if (pos < 0) pos = 0;
    CPU_AX = (uint16_t)(pos & 0xFFFF);
    CPU_DX = (uint16_t)((pos >> 16) & 0xFFFF);
    CPU_FLAG &= ~C_FLAG;
}

static void int21_43_attr(void) {
    char host[256];
    dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    if (CPU_AL == 0) {
        /* Get: stat してファイル存在を確認、attribute は archive bit のみ返す */
        struct stat st;
        if (fs_stat(host, &st) != 0) { CPU_AX = 2; CPU_FLAG |= C_FLAG; return; }
        CPU_CX = 0x20;
        CPU_FLAG &= ~C_FLAG;
    } else if (CPU_AL == 1) {
        /* Set: 無視 (FS に属性概念がないので) */
        CPU_FLAG &= ~C_FLAG;
    } else {
        CPU_AX = 1;
        CPU_FLAG |= C_FLAG;
    }
}

static void int21_44_ioctl(void) {
    /* AL = sub-function。AL=0 (Get Device Info) のみ実装。
     * 実機 DOS では h=0..4 が標準で開いている char device (CON/AUX/PRN):
     *   0: stdin  (CON)  → bit 7 (char dev) + bit 0 (= is stdin)
     *   1: stdout (CON)  → bit 7 + bit 1
     *   2: stderr (CON)  → bit 7
     *   3: stdaux (AUX)  → bit 7
     *   4: stdprn (PRN)  → bit 7
     * 同 .exe (さめがめ) はこの全 5 ハンドルを起動時に IOCTL してチェック。
     * h=3/4 を error 返しすると「実機 DOS 環境ではない」と判定されて、
     * INT 18h AH=0Ch (テキスト面 OFF) 経路を通らなくなる。 */
    int h = (int)CPU_BX;
    switch (CPU_AL) {
    case 0x00:  /* Get Device Info */
        if (h >= 0 && h <= 4) {
            uint16_t dx = 0x0080;
            if (h == 0) dx |= 0x0001;   /* stdin */
            if (h == 1) dx |= 0x0002;   /* stdout */
            CPU_DX = dx;
        } else if (fh_get(h)) {
            CPU_DX = 0x0000;
        } else {
            CPU_AX = 6;
            CPU_FLAG |= C_FLAG;
            return;
        }
        CPU_FLAG &= ~C_FLAG;
        break;
    case 0x01:  /* Set Device Info — デバイスモードを保持しないので no-op 成功。
                 * AL=00 と対で呼ばれるため、ここを失敗にすると逆に回帰する。 */
        CPU_FLAG &= ~C_FLAG;
        break;
    default:
        /* 旧実装は全 sub-fn を「何もせず成功 (CF=0)」にしていたが、レジスタ未設定の
         * まま嘘の成功を返すと沈黙の誤動作になる。未対応 sub-fn は明示的に失敗
         * (invalid function) + ログにして、当たったタイトルを可視化する。 */
        fprintf(stderr, "[int21h/44] UNIMPL IOCTL AL=%02X (BX=%04X CX=%04X)\n",
                (unsigned)CPU_AL, (unsigned)CPU_BX, (unsigned)CPU_CX);
        CPU_AX = 1;  /* invalid function */
        CPU_FLAG |= C_FLAG;
        break;
    }
}

static void int21_4a_resize(void) {
    /* ES = resize 対象ブロックの segment、BX = 新サイズ (paragraphs)。
     * MCB チェーンに委譲: 最上位 PSP の self-shrink はアリーナ起点確定、それ以外は
     * ブロックの拡大/縮小 (末尾分割・隣接空きと結合)。拡大不能なら最大可能を返す。 */
    uint16_t largest = 0;
    int r = qb_dos_alloc_resize(CPU_ES, CPU_BX, &largest);
    if (r == -2) {            /* 無効ブロックアドレス (ES が MCB を指していない) */
        CPU_AX = 9;           /* invalid memory block address */
        CPU_FLAG |= C_FLAG;
        return;
    }
    if (r != 0) {
        CPU_AX = 8;            /* insufficient memory */
        CPU_BX = largest;      /* largest available */
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_FLAG &= ~C_FLAG;
}

/* AH=48h: Allocate Memory。BX = 要求 paragraphs → AX = 確保した segment。
 * 失敗時 AX=8 (insufficient)、BX = 最大利用可能 paragraphs、CF=1。 */
static void int21_48_alloc(void) {
    uint16_t seg = 0, largest = 0;
    if (qb_dos_alloc_request(CPU_BX, &seg, &largest) != 0) {
        CPU_AX = 8;
        CPU_BX = largest;
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_AX = seg;
    CPU_FLAG &= ~C_FLAG;
}

/* AH=49h: Free Memory。ES = 解放するセグメント。ES-1 の MCB を空きにして coalesce。
 * ES が有効な MCB を指さないときは実 DOS 同様 AX=9 (invalid block) で失敗を返す
 * (嘘の成功を返すとゲストが解放できたと誤認する)。 */
static void int21_49_free(void) {
    if (qb_dos_alloc_free(CPU_ES) != 0) {
        CPU_AX = 9;            /* invalid memory block address */
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_FLAG &= ~C_FLAG;
}

/* AH=4Bh EXEC (子プログラムのロード&実行)。
 * 【段階1.5】AL=00 のみ。親 (ランチャ zar.exe) を常駐させたまま、子 (siz エンジン) を
 *   親確保領域の上にロードして CPU を子へ切替える。親の IVT フック/コードが生き残るので
 *   段階1 の「置換」で起きた暴走を解消。子終了時の親復帰 (メニュー往復) は段階2 で実装。 */
/* AH=4Bh AL=03h Load Overlay。子イメージを呼び出し元指定の load_seg:0000 へロード&リロケート
 * して呼び出し元へ戻る (PSP も CPU 切替も無し)。op.exe → main.exe の本編遷移で踏む。
 * パラメータブロック ES:BX: +0 = load segment、+2 = relocation factor。 */
static void int21_4b_overlay(void) {
    char host[256];
    int st = dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    if (st != 0) {
        fprintf(stderr, "[int21h/4B/03] overlay not found (status %d): %s\n", st, host);
        CPU_AX = 2; CPU_FLAG |= C_FLAG;   /* file not found */
        return;
    }
    uint32_t pb        = lin(CPU_ES, CPU_BX);
    uint16_t load_seg  = peek16(pb + 0);
    uint16_t reloc_fac = peek16(pb + 2);

    static uint8_t ovbuf[256 * 1024];
    {
        struct stat cst;
        if (fs_stat(host, &cst) == 0 && (size_t)cst.st_size > sizeof(ovbuf)) {
            fprintf(stderr, "[int21h/4B/03] overlay too large: %ld > %zu\n",
                    (long)cst.st_size, sizeof(ovbuf));
            CPU_AX = 8; CPU_FLAG |= C_FLAG;
            return;
        }
    }
    FILE *fp = fs_fopen(host, "rb");
    if (!fp) { CPU_AX = 2; CPU_FLAG |= C_FLAG; return; }
    size_t sz = fread(ovbuf, 1, sizeof(ovbuf), fp);
    fclose(fp);

    const char *base = host;
    for (const char *q = host; *q; q++) if (*q == '/' || *q == '\\') base = q + 1;
    fprintf(stderr, "[int21h/4B/03] LOAD OVERLAY %s → %04X:0000 (reloc factor %04X)\n",
            base, (unsigned)load_seg, (unsigned)reloc_fac);

    int r = qb_dos_overlay_load(ovbuf, sz, load_seg, reloc_fac);
    if (r != 0) {
        fprintf(stderr, "[int21h/4B/03] overlay_load failed r=%d\n", r);
        CPU_AX = (r == -10) ? 8 : 0x0B;
        CPU_FLAG |= C_FLAG;
        return;
    }
    /* 成功: CPU は切り替えず呼び出し元へ CF=0 で戻る (呼び出し元が overlay へ far call する)。 */
    CPU_FLAG &= ~C_FLAG;
}

static void int21_4b_exec(void) {
    if (CPU_AL == 0x03) { int21_4b_overlay(); return; }   /* Load Overlay */
    if (CPU_AL != 0x00) {                 /* AL=01 (load & no exec) 等は未対応 */
        fprintf(stderr, "[int21h/4B] unsupported AL=%02X\n", (unsigned)CPU_AL);
        CPU_AX = 1; CPU_FLAG |= C_FLAG;
        return;
    }

    /* 子パス (DS:DX の ASCIZ) を /run 配下に解決 */
    char host[256];
    int st = dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    if (st != 0) {
        fprintf(stderr, "[int21h/4B] child not found (path-status %d): %s\n", st, host);
        CPU_AX = 2; CPU_FLAG |= C_FLAG;   /* file not found */
        return;
    }

    /* パラメータブロック ES:BX:
     *   +0 = env segment (0 なら親 env 継承)
     *   +2 = コマンドテイル far ptr (PSP[0x80] 形式: 長さ 1B + 文字列 + 0x0D) */
    uint16_t env_seg;
    uint32_t fcb1_lin = 0, fcb2_lin = 0;
    char cmdtail[128];
    cmdtail[0] = '\0';
    {
        uint32_t pb = lin(CPU_ES, CPU_BX);
        env_seg = peek16(pb + 0);
        uint16_t ct_off = peek16(pb + 2);
        uint16_t ct_seg = peek16(pb + 4);
        uint32_t ct = lin(ct_seg, ct_off);
        uint8_t  ct_len = peek8(ct);
        size_t n = 0;
        cmdtail[n++] = ' ';               /* PSP tail 慣例の先頭スペース */
        for (uint8_t i = 0; i < ct_len && n + 1 < sizeof(cmdtail); i++) {
            uint8_t c = peek8(ct + 1 + i);
            if (c == 0x0D) break;
            if (c == ' ' && n == 1) continue;   /* 二重スペース回避 */
            cmdtail[n++] = (char)c;
        }
        cmdtail[n] = '\0';

        /* +0x06=FCB1 far ptr, +0x0A=FCB2 far ptr。親が AH=29h 等で組んだ FCB を子 PSP の
         * 0x5C/0x6C へ複写するため linear に解決する。ポインタが null (seg:off=0) の caller
         * (.bat shell 等、FCB を使わない) は 0 のまま → exec_load 側で複写しない。 */
        uint16_t f1_off = peek16(pb + 0x06), f1_seg = peek16(pb + 0x08);
        uint16_t f2_off = peek16(pb + 0x0A), f2_seg = peek16(pb + 0x0C);
        if (f1_seg || f1_off) fcb1_lin = lin(f1_seg, f1_off);
        if (f2_seg || f2_off) fcb2_lin = lin(f2_seg, f2_off);
    }

    /* 子イメージを host から読む。buffer を超えるサイズはサイレントに切り捨てると
     * 壊れた EXE を実行してしまうので、事前に stat して大きすぎれば明示的に失敗する。 */
    static uint8_t childbuf[256 * 1024];
    {
        struct stat cst;
        if (fs_stat(host, &cst) == 0 && (size_t)cst.st_size > sizeof(childbuf)) {
            fprintf(stderr, "[int21h/4B] child too large: %ld > %zu — 切り捨てを避けて失敗\n",
                    (long)cst.st_size, sizeof(childbuf));
            CPU_AX = 8;   /* insufficient memory 相当 */
            CPU_FLAG |= C_FLAG;
            return;
        }
    }
    FILE *fp = fs_fopen(host, "rb");
    if (!fp) { CPU_AX = 2; CPU_FLAG |= C_FLAG; return; }
    size_t sz = fread(childbuf, 1, sizeof(childbuf), fp);
    fclose(fp);
    if (sz < 2) { CPU_AX = 0x0B; CPU_FLAG |= C_FLAG; return; }

    const char *base = host;
    for (const char *q = host; *q; q++) if (*q == '/' || *q == '\\') base = q + 1;
    fprintf(stderr, "[int21h/4B] EXEC child=%s size=%zu env=%04X cmdtail=\"%s\" (stage1.5: parent resident)\n",
            base, sz, (unsigned)env_seg, cmdtail);
    if (fcb1_lin)
        fprintf(stderr, "[int21h/4B] fcb1 drv=%d name=\"%.8s\" ext=\"%.3s\"\n",
                (int)peek8(fcb1_lin), (char *)&mem[fcb1_lin + 1], (char *)&mem[fcb1_lin + 9]);

    /* 親常駐のまま子を上にロードして CPU を子へ切替える (base = 子の basename → argv[0] 正規化用)。 */
    int r = qb_dos_exec_load(childbuf, sz, cmdtail, env_seg, base, fcb1_lin, fcb2_lin);
    if (r != 0) {
        fprintf(stderr, "[int21h/4B] exec_load failed r=%d\n", r);
        CPU_AX = (r == -10) ? 8 : 0x0B;   /* -10=メモリ不足(8), 他=書式不正(11) */
        CPU_FLAG |= C_FLAG;
        return;
    }

    /* CPU を子エントリへ切替えたので dispatch tail の FLAGS 書き戻しは skip
     * (g_int21_repoll = CPU リダイレクト時の共通スキップフラグ)。 */
    g_int21_repoll = 1;
}

static void int21_4c_exit(void) {
    /* signal_exit が EXEC 子の終了として親を復元したら (戻り 1)、CPU は親へ
     * リダイレクト済なので dispatch tail の FLAGS 書き戻しを skip する。 */
    if (qb_dos_signal_exit((int)CPU_AL)) g_int21_repoll = 1;
}

/* AH=31h Keep Process (TSR 常駐終了)。DX=常駐させる paragraph 数 (PSP 含む)、AL=終了コード。
 * Ray の RIN.COM (常駐音源ドライバ) が自身を常駐させるのに使う。子を縮小して常駐させ、
 * 親 (Ray) へ復帰する。CPU リダイレクト済なら dispatch tail の FLAGS 書き戻しを skip。 */
static void int21_31_keep(void) {
    if (qb_dos_signal_tsr(CPU_DX, (int)CPU_AL)) g_int21_repoll = 1;
}

/* AH=4Dh Get Return Code — 直近に EXEC した子の終了コードを返す。 */
static void int21_4d_retcode(void) {
    CPU_AX = qb_dos_exec_last_code();
    CPU_FLAG &= ~C_FLAG;
}

static void int21_4e_findfirst(void) {
    char rel[192];
    read_dos_rel(CPU_DS, CPU_DX, rel, sizeof(rel));

    /* 末端 (ファイル名 or wildcard) と親ディレクトリに分割。leaf はパターンを
     * 含みうるので case-insensitive 解決はせず、親ディレクトリだけ解決する。 */
    char *slash = strrchr(rel, '/');
    char dirpart[192];
    const char *leaf;
    if (slash) {
        size_t dl = (size_t)(slash - rel);
        memcpy(dirpart, rel, dl);
        dirpart[dl] = '\0';
        leaf = slash + 1;
    } else {
        dirpart[0] = '\0';
        leaf = rel;
    }

    char dir[256];
    resolve_dir(dirpart, dir, sizeof(dir));

    g_find.attr_mask = (uint8_t)CPU_CX;
    if (find_first_match(dir, leaf) != 0) {
        CPU_AX = 2;  /* file not found */
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_AX = 0;
    CPU_FLAG &= ~C_FLAG;
}

static void int21_4f_findnext(void) {
    if (find_next_match() != 0) {
        CPU_AX = 18;  /* no more files (FAT 流儀: 12h) */
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_AX = 0;
    CPU_FLAG &= ~C_FLAG;
}

/* AH=36h Get Disk Free Space。DL = ドライブ (0=default,1=A:...)。
 * 実ディスクが無いので「常に潤沢」な合成ジオメトリを返す (空き容量チェックを通すため)。
 *   AX = sectors/cluster, BX = available clusters, CX = bytes/sector, DX = total clusters
 * 無効ドライブは AX=0xFFFF だが、単一ドライブなので常に有効扱い。
 * 512 B/sec × 8 sec/clus (=4KB) × 16384 free = 64MB 空き (free<total、32-bit に収まる)。 */
static void int21_36_freespace(void) {
    CPU_AX = 8;          /* sectors per cluster */
    CPU_CX = 512;        /* bytes per sector */
    CPU_BX = 0x4000;     /* available clusters = 16384 → 64MB free */
    CPU_DX = 0x7FFF;     /* total clusters     = 32767 → ~128MB */
    CPU_FLAG &= ~C_FLAG;
}

/* AH=39h MKDIR。DS:DX = 作成するディレクトリパス。
 * 既存なら access denied(5)、親が無ければ path not found(3)、それ以外は mkdir。 */
static void int21_39_mkdir(void) {
    char host[256];
    int st = dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    if (st == 0) { CPU_AX = 5; CPU_FLAG |= C_FLAG; return; }   /* 既に存在 */
    if (st == 2) { CPU_AX = 3; CPU_FLAG |= C_FLAG; return; }   /* 親ディレクトリが無い */
    if (fs_mkdir(host) != 0) {
        fprintf(stderr, "[int21h/39] mkdir(%s) failed\n", host);
        CPU_AX = 5; CPU_FLAG |= C_FLAG; return;
    }
    fprintf(stderr, "[int21h/39] mkdir %s\n", host);
    CPU_FLAG &= ~C_FLAG;
}

/* AH=3Ah RMDIR。DS:DX = 削除するディレクトリパス。
 * 無ければ path not found(3)、非空・失敗は access denied(5)。 */
static void int21_3a_rmdir(void) {
    char host[256];
    int st = dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    if (st != 0) { CPU_AX = 3; CPU_FLAG |= C_FLAG; return; }
    if (fs_rmdir(host) != 0) {
        fprintf(stderr, "[int21h/3A] rmdir(%s) failed\n", host);
        CPU_AX = 5; CPU_FLAG |= C_FLAG; return;
    }
    CPU_FLAG &= ~C_FLAG;
}

/* AH=3Bh CHDIR。DS:DX = 目標パス。論理カレント g_cwd (/run 相対) を更新する。
 * '.'/'..' を解決し、実在ディレクトリでなければ path not found(3)。 */
static void int21_3b_chdir(void) {
    /* 絶対 ("\\..." / "X:\\...") か相対かを判定するため raw を別途読む (CWD 前置前)。 */
    uint32_t base = lin(CPU_DS, CPU_DX);
    char c0 = (char)peek8(base), c1 = (char)peek8(base + 1);
    uint32_t i = (c0 && c1 == ':') ? 2u : 0u;
    char raw[256]; size_t n = 0;
    while (n + 1 < sizeof(raw)) {
        uint8_t c = peek8(base + i++);
        if (!c) break;
        /* DBCS ペア素通し (read_dos_rel と同じ: トレイル 0x5C を区切り扱いしない) */
        if (sjis_is_lead(c) && n + 2 < sizeof(raw)) {
            uint8_t c2 = peek8(base + i);
            if (c2 != 0) { i++; raw[n++] = (char)c; raw[n++] = (char)c2; continue; }
        }
        raw[n++] = (c == '\\') ? '/' : (char)c;
    }
    raw[n] = '\0';
    int absolute = (raw[0] == '/');

    /* 候補 cwd を component 単位で構築 ('.'=無視 / '..'=1 段戻る)。相対なら g_cwd 起点。 */
    char cand[192];
    cand[0] = '\0';
    if (!absolute) { strncpy(cand, g_cwd, sizeof(cand) - 1); cand[sizeof(cand) - 1] = '\0'; }
    const char *p = raw;
    while (*p) {
        while (*p == '/') p++;
        if (!*p) break;
        char comp[160]; size_t cl = 0;
        while (*p && *p != '/' && cl + 1 < sizeof(comp)) comp[cl++] = *p++;
        comp[cl] = '\0';
        if (strcmp(comp, ".") == 0) continue;
        if (strcmp(comp, "..") == 0) {
            char *s = strrchr(cand, '/');
            if (s) *s = '\0'; else cand[0] = '\0';
            continue;
        }
        size_t ol = strlen(cand);
        if (ol) snprintf(cand + ol, sizeof(cand) - ol, "/%s", comp);
        else    snprintf(cand, sizeof(cand), "%s", comp);
    }

    /* 候補が実在ディレクトリか検証 (case-insensitive 解決して opendir)。 */
    char host[256];
    resolve_dir(cand, host, sizeof(host));
    DIR *d = fs_opendir(host);
    if (!d) { CPU_AX = 3; CPU_FLAG |= C_FLAG; return; }   /* path not found */
    closedir(d);

    strncpy(g_cwd, cand, sizeof(g_cwd) - 1);
    g_cwd[sizeof(g_cwd) - 1] = '\0';
    fprintf(stderr, "[int21h/3B] chdir → \"%s\"\n", g_cwd);
    CPU_FLAG &= ~C_FLAG;
}

/* AH=29h: Parse Filename。DS:SI の文字列を 8.3 名に解析して ES:DI の (未オープン) FCB へ格納。
 * AL = 制御フラグ: bit0=先頭の区切り(空白)をスキップ / bit1=ドライブ指定がある時のみ FCB ドライブ
 * を書く / bit2=ファイル名がある時のみ書く / bit3=拡張子がある時のみ書く。
 * 返り: AL=0 (ワイルドカード無し) / 1 (有り)。DS:SI は解析後の位置へ前進。
 * 出力 FCB: +0 drive(0=既定,1=A..) / +1..8 name(空白詰め,大文字) / +9..B ext(空白詰め,大文字)。
 * 用途: kanipic.exe は親 kani.exe が EXEC で渡した PSP の FCB から出力名 "KANI.SCR" を読む。 */
#define IS_FCB_SEP(ch) ((ch)==0 || (ch)==0x0D || (ch)==' ' || (ch)=='\t' || (ch)=='.' || \
    (ch)==':' || (ch)==';' || (ch)==',' || (ch)=='=' || (ch)=='+' || (ch)=='/' || \
    (ch)=='\\' || (ch)=='"' || (ch)=='[' || (ch)==']' || (ch)=='<' || (ch)=='>' || (ch)=='|')

static uint8_t ds_byte(uint16_t off) { return peek8(lin(CPU_DS, off)); }

static void int21_29_parse_filename(void) {
    uint8_t  ctrl = CPU_AL;
    uint16_t si   = CPU_SI;
    uint32_t fcb  = lin(CPU_ES, CPU_DI);
    int has_wild  = 0;

    if (ctrl & 0x01) {                         /* bit0: 先頭の空白/タブを読み飛ばす */
        while (ds_byte(si) == ' ' || ds_byte(si) == '\t') si++;
    }

    /* ---- ドライブ (X:) ---- */
    uint8_t c0 = ds_byte(si), c1 = ds_byte((uint16_t)(si + 1));
    if (c1 == ':' && ((c0 >= 'A' && c0 <= 'Z') || (c0 >= 'a' && c0 <= 'z'))) {
        poke8(fcb + 0, (uint8_t)((c0 | 0x20) - 'a' + 1));   /* A→1 */
        si += 2;
    } else if (!(ctrl & 0x02)) {
        poke8(fcb + 0, 0);                     /* 既定ドライブ */
    }

    /* ---- ファイル名 (最大 8) ---- */
    uint8_t name[8]; int nlen = 0, name_present = 0;
    while (nlen < 8) {
        uint8_t c = ds_byte(si);
        if (IS_FCB_SEP(c)) break;
        name_present = 1;
        if (c == '*') {                        /* '*' は残りを '?' で埋め、後続名前文字を捨てる */
            while (nlen < 8) name[nlen++] = '?';
            has_wild = 1; si++;
            while (!IS_FCB_SEP(ds_byte(si))) si++;
            break;
        }
        if (c == '?') has_wild = 1;
        if (c >= 'a' && c <= 'z') c -= 0x20;
        name[nlen++] = c; si++;
    }
    if (name_present || !(ctrl & 0x04)) {
        for (int i = 0; i < 8; i++) poke8(fcb + 1 + i, (uint8_t)(i < nlen ? name[i] : ' '));
    }

    /* ---- 拡張子 (最大 3) ---- */
    uint8_t ext[3]; int elen = 0, ext_present = 0;
    if (ds_byte(si) == '.') {
        si++; ext_present = 1;
        while (elen < 3) {
            uint8_t c = ds_byte(si);
            if (IS_FCB_SEP(c)) break;
            if (c == '*') {
                while (elen < 3) ext[elen++] = '?';
                has_wild = 1; si++;
                while (!IS_FCB_SEP(ds_byte(si))) si++;
                break;
            }
            if (c == '?') has_wild = 1;
            if (c >= 'a' && c <= 'z') c -= 0x20;
            ext[elen++] = c; si++;
        }
    }
    if (ext_present || !(ctrl & 0x08)) {
        for (int i = 0; i < 3; i++) poke8(fcb + 9 + i, (uint8_t)(i < elen ? ext[i] : ' '));
    }

    CPU_SI = si;
    CPU_AL = has_wild ? 1 : 0;

    fprintf(stderr, "[int21h/29] ctrl=%02X → drv=%d name=\"%.8s\" ext=\"%.3s\" wild=%d\n",
            (unsigned)ctrl, (int)peek8(fcb + 0),
            (char *)&mem[fcb + 1], (char *)&mem[fcb + 9], has_wild);
}
#undef IS_FCB_SEP

/* AH=52h: Get List of Lists (SysVars)。ES:BX → DOS 内部構造体。元来は未公開関数だが、
 * master.lib 系 (例: Super Spartan 本体 sspartan.d98) が「先頭 MCB を辿って利用可能メモリを
 * 算定する」用途で叩く。未実装 (UNIMPL) だと有効ポインタが返らず、呼び出し側は環境を
 * 不適と判断して exit code 1 で諦める。最小の合成 LoL を低位 RAM (segment 0x00A0 = linear
 * 0xA00、env 0x00F0 / PSP 0x0100 の手前で未使用) に構築して返す。
 * フィールド配置は DOS 3.1+ の慣例 (RBIL INT 21/AH=52h) に倣い、得られる範囲で妥当な値を
 * 埋める。負オフセット (BX-12..BX-2) の余地を残すため BX は 0x26 に置く。
 * 子が LoL のどのフィールドを読むかは実測で詰める前提 (まずは先頭 MCB を最優先で正しく返す)。
 * [+4] first SFT は合成 SFT (dos_loader.c qb_dos_sft_note_load、QB_SFT_SEG:0000) を指す。
 * かつて FFFF:FFFF「無し」としていたが、SFT walker (PMD86 の install-check 等) は先頭
 * ポインタを終端チェックなしで follow するため、ゴミ count/next を辿る無限走査になった
 * (TH03 GAME.BAT ハングの真因、2026-06-11)。チェーン先頭に「無し」は表現不能。 */
#define QB_LOL_SEG  0x00A0u
static void int21_52_list_of_lists(void) {
    uint32_t base = (uint32_t)QB_LOL_SEG << 4;   /* linear */
    uint16_t bx   = 0x0026;
    uint32_t p    = base + bx;                     /* LoL[+0] の linear */
    uint16_t first_mcb = qb_dos_first_mcb_seg();
    const uint16_t NONE = 0xFFFF;                  /* far ptr「無し」マーカ */

    /* -- 負オフセット (DOS 3.1+) -- */
    poke16(p - 12, 0);            /* sharing retry count */
    poke16(p - 10, 1);            /* sharing retry delay */
    poke16(p - 8, 0); poke16(p - 6, 0);   /* current disk buffer ptr (無し) */
    poke16(p - 4, 0);             /* unread CON input ptr */
    poke16(p - 2, first_mcb);     /* ★ segment of first MCB */

    /* -- 正オフセット -- */
    poke16(p + 0x00, NONE); poke16(p + 0x02, NONE);  /* first DPB (無し) */
    poke16(p + 0x04, 0x0000); poke16(p + 0x06, QB_SFT_SEG);  /* first SFT → 合成 SFT (正規終端) */
    poke16(p + 0x08, NONE); poke16(p + 0x0A, NONE);  /* CLOCK$ device */
    poke16(p + 0x0C, NONE); poke16(p + 0x0E, NONE);  /* CON device */
    poke16(p + 0x10, 512);       /* max bytes per block of any block device */
    poke16(p + 0x12, 0); poke16(p + 0x14, 0);   /* first disk buffer (無し) */
    poke16(p + 0x16, NONE); poke16(p + 0x18, NONE);  /* CDS array */
    poke16(p + 0x1A, NONE); poke16(p + 0x1C, NONE);  /* system FCB tables */
    poke16(p + 0x1E, 0);         /* number of protected FCBs */
    poke8 (p + 0x20, 1);         /* number of block devices */
    poke8 (p + 0x21, 5);         /* LASTDRIVE */
    /* +0x22: NUL device header (18 byte) = デバイスドライバチェーンの先頭 */
    poke16(p + 0x22, NONE); poke16(p + 0x24, NONE);  /* next device ptr = チェーン末端 */
    poke16(p + 0x26, 0x8004);    /* attributes: char device, NUL */
    poke16(p + 0x28, 0);         /* strategy entry offset */
    poke16(p + 0x2A, 0);         /* interrupt entry offset */
    { const char *nm = "NUL     "; for (int i = 0; i < 8; i++) poke8(p + 0x2C + (uint32_t)i, (uint8_t)nm[i]); }

    CPU_ES = QB_LOL_SEG;
    CPU_BX = bx;
    CPU_FLAG &= ~C_FLAG;
}

/* AH=58h メモリ確保ストラテジ / UMB リンク状態の get/set。
 * UMB は持たないが、確保ストラテジ (first/best/last-fit) は実際に効かせる:
 * last-fit を要求するゲームに first-fit で応えると本体直上を埋めてしまい、PSP ブロックの
 * 拡大を阻害して破綻する (GOGGLE2 の exit3/2)。strategy は dos_loader.c の MCB アロケータが honor する。
 * (GBOX の United モードが AX=5803h=「set UMB link state」を呼ぶ。UMB 系は素直に「無し・成功」。) */
static void int21_58_alloc_strategy(void) {
    switch (CPU_AL) {
    case 0x00: CPU_AX = qb_dos_get_alloc_strategy(); CPU_FLAG &= ~C_FLAG; break;  /* get strategy */
    case 0x01: qb_dos_set_alloc_strategy(CPU_BX);    CPU_FLAG &= ~C_FLAG; break;  /* set strategy (BL/BX) */
    case 0x02: CPU_AX = 0x0000; CPU_FLAG &= ~C_FLAG; break;  /* get UMB link state = 0 (未リンク) */
    case 0x03: CPU_FLAG &= ~C_FLAG; break;                   /* set UMB link state (BX) — no-op 成功 */
    default:   CPU_AX = 0x0001; CPU_FLAG |= C_FLAG; break;   /* invalid subfunction */
    }
}

/* AH=63h: DBCS (2 バイト文字) サポート。日本語 DOS ソフトが初期化で「現在の DBCS リードバイト
 * 範囲表」を問い合わせる (東方旧作 op.exe/main.exe が AX=6300h を叩く)。未実装 (UNIMPL) だと
 * 有効ポインタが返らず、呼び出し側は「日本語環境でない/異常」と判断して exit code 1 で諦める。
 * PC-98 は Shift-JIS 固定なので、SJIS のリードバイト範囲表を低位スクラッチ RAM に構築し DS:SI で返す。
 * 表形式 = (lo,hi) バイト対の並び + 00 00 終端 (RBIL INT 21/AX=6300h)。範囲は bridge.js
 * decodeSjisText と同一 (0x81-0x9F, 0xE0-0xFC)。
 *   AL=00h: get lead byte table → DS:SI → 表、CF=0
 *   AL=01h: get interim console flag → DL=0 (通常状態=変換中でない)、CF=0
 *   AL=02h: set interim console flag → no-op (IME を持たない)、CF=0
 * scratch は LoL と同じ segment 0x00A0 だが、LoL 使用域 (~+0x5A) より上の +0x60 に置き衝突回避。
 * 呼び出し毎に書き直す (reset/clobber 耐性、init 順依存なし。int21_52 と同方針)。 */
#define QB_DBCS_SEG  0x00A0u
#define QB_DBCS_OFF  0x0060u
static void int21_63_dbcs(void) {
    switch (CPU_AL) {
    case 0x00: {   /* get DBCS lead byte table → DS:SI */
        uint32_t p = ((uint32_t)QB_DBCS_SEG << 4) + QB_DBCS_OFF;
        poke8(p + 0, 0x81); poke8(p + 1, 0x9F);   /* SJIS リードバイト範囲 1 */
        poke8(p + 2, 0xE0); poke8(p + 3, 0xFC);   /* SJIS リードバイト範囲 2 */
        poke8(p + 4, 0x00); poke8(p + 5, 0x00);   /* 終端 */
        CPU_DS = QB_DBCS_SEG;
        CPU_SI = QB_DBCS_OFF;
        CPU_FLAG &= ~C_FLAG;
        break;
    }
    case 0x01: CPU_DX = (uint16_t)(CPU_DX & 0xFF00); CPU_FLAG &= ~C_FLAG; break;  /* interim flag = 0 */
    case 0x02: CPU_FLAG &= ~C_FLAG; break;                                        /* set interim: no-op */
    default:   CPU_AX = 0x0001; CPU_FLAG |= C_FLAG; break;                         /* 未知 sub-fn: 正直に失敗 */
    }
}

/* ---------------- ディスパッチ ---------------- */

/* AH 別カウンタ + qbDebug.int21Stats() で読めるよう export */
static int g_dbg_ah_count[256] = {0};
int qb_dos_dbg_ah_count(int ah) {
    if (ah < 0 || ah > 255) return -1;
    return g_dbg_ah_count[ah];
}
void qb_dos_dbg_ah_reset(void) {
    for (int i = 0; i < 256; i++) g_dbg_ah_count[i] = 0;
}

/* INT 21h 全コールトレース (qbDebug / 各 game のデバッグ用、既定 OFF)。
 * 普段は dispatch 入口で何も出さない方針なので、解析時だけ on にする。 */
int g_int21_trace = 0;
void qb_dos_set_int21_trace(int on) { g_int21_trace = on ? 1 : 0; }

/* INT 29h (DOS 高速文字出力 / "fast putchar")。AL の 1 文字を CON へ出力する。
 * 我々は CON = テキスト VRAM tty なので tty_putc に流す (ANSI/ESC パーサ込み)。
 * master.lib の text_clear() は "ESC [ 2 J" を INT 29h 4 回で送って画面消去するため、
 * これが無いと text_clear が無効化されテキストが残留する (SSP/KANI 等 master.lib 系全般)。
 * トランポリン F000:EE80 (NOP+IRET) から biosfunc 経由で呼ばれる。レジスタ・フラグ不変。 */
int qb_dos_int29_hook(void) {
    tty_putc((uint8_t)CPU_AL);
    return 1;
}

void qb_dos_int21_dispatch(void) {
    uint8_t ah = CPU_AH;
    g_int21_repoll = 0;
    g_dbg_ah_count[ah]++;
    if (g_int21_trace) {
        fprintf(stderr, "[i21] AH=%02X AL=%02X BX=%04X CX=%04X DX=%04X "
                "DS=%04X SI=%04X ES=%04X DI=%04X @%04X:%04X\n",
                (unsigned)ah, (unsigned)CPU_AL, (unsigned)CPU_BX, (unsigned)CPU_CX,
                (unsigned)CPU_DX, (unsigned)CPU_DS, (unsigned)CPU_SI,
                (unsigned)CPU_ES, (unsigned)CPU_DI, (unsigned)CPU_CS, (unsigned)CPU_IP);
    }
    /* 全コール log は debug 中以外うるさいので、open/close/delete/find/exit
     * 等「ファイル系」と UNIMPL のみ各 handler 側で log する方針。
     * dispatch 入口では何も出さない (cstartup の AH=30/4A/35/25/44 が連発するため)。*/
    switch (ah) {
    case 0x01: int21_01_getch_echo();   break;
    case 0x02: int21_02_putchar();   break;
    case 0x06: int21_06_direct_io(); break;
    case 0x07: int21_07_getch_raw();    break;
    case 0x08: int21_08_getch_noecho(); break;
    case 0x09: int21_09_putstr();    break;
    case 0x0A: int21_0a_buffered();     break;
    case 0x0B: int21_0b_instat();       break;
    case 0x0C: int21_0c_flush_input();  break;
    case 0x19: int21_19_curdrive();     break;
    case 0x1A: int21_1a_set_dta();   break;
    case 0x25: int21_25_set_vec();   break;
    case 0x29: int21_29_parse_filename(); break;
    case 0x2A: int21_2a_get_date();  break;
    case 0x2C: int21_2c_get_time();  break;
    case 0x2F: int21_2f_get_dta();      break;
    case 0x30: int21_30_version();   break;
    case 0x31: int21_31_keep();         break;
    case 0x33: int21_33_ctrlbreak();    break;
    case 0x35: int21_35_get_vec();   break;
    case 0x36: int21_36_freespace();    break;
    case 0x39: int21_39_mkdir();        break;
    case 0x3A: int21_3a_rmdir();        break;
    case 0x3B: int21_3b_chdir();        break;
    case 0x3C: int21_3c_create();    break;
    case 0x3D: int21_3d_open();      break;
    case 0x3E: int21_3e_close();     break;
    case 0x3F: int21_3f_read();      break;
    case 0x40: int21_40_write();     break;
    case 0x41: int21_41_delete();    break;
    case 0x42: int21_42_seek();      break;
    case 0x43: int21_43_attr();      break;
    case 0x44: int21_44_ioctl();     break;
    case 0x45: int21_45_dup();          break;
    case 0x46: int21_46_dup2();         break;
    case 0x47: int21_47_getcurdir();    break;
    case 0x48: int21_48_alloc();     break;
    case 0x49: int21_49_free();      break;
    case 0x4A: int21_4a_resize();    break;
    case 0x4B: int21_4b_exec();         break;
    case 0x4C: int21_4c_exit();      break;
    case 0x4D: int21_4d_retcode();      break;
    case 0x4E: int21_4e_findfirst(); break;
    case 0x4F: int21_4f_findnext();  break;
    case 0x52: int21_52_list_of_lists(); break;
    case 0x58: int21_58_alloc_strategy(); break;
    case 0x63: int21_63_dbcs(); break;
    default:
        fprintf(stderr, "[int21h] UNIMPL AH=%02X (AX=%04X CS:IP=%04X:%04X)\n",
                ah, (unsigned)CPU_AX, (unsigned)CPU_CS, (unsigned)CPU_IP);
        CPU_AX = 0x0001;   /* DOS error 1 = invalid function (AX 全体に設定。AL のみだと AH が残る) */
        CPU_FLAG |= C_FLAG;
        break;
    }

    /* blocking 入力が「キー待ち」で CPU_IP を巻き戻した場合、今回は IRET せず
     * NOP を踏み直す。スタックの FLAGS は次に本当に return する回で書くので、
     * ここでの書き戻しは skip する (ゲストスタックを余計に触らない)。 */
    if (g_int21_repoll) return;

    /* INT 21h トランポリンは F000:EE10 = NOP; IRET。IRET は [SS:SP+4] から
     * FLAGS を pop して復帰するので、ハンドラが CPU_FLAG に立てた CF/ZF は
     * そのままでは破棄されてしまう (汎用レジスタ返値は影響を受けない)。
     * スタック上の FLAGS イメージへ CF/ZF を書き戻して呼び出し元の JC/JZ に
     * 結果を届ける。NP2kai 純正の bios0x1f (bios1f.c) と同じ手法。
     * 注: AH=4Ch/INT 20h は signal_exit が CS:IP を halt loop に書き換えて
     *     IRET を踏まないので、この書き込みは無害 (pop されない)。 */
    {
        uint32_t fl = lin(CPU_SS, (uint16_t)(CPU_SP + 4));
        uint16_t saved = peek16(fl);
        saved = (uint16_t)((saved & ~(C_FLAG | Z_FLAG))
                           | (CPU_FLAG & (C_FLAG | Z_FLAG)));
        poke16(fl, saved);
    }
}

void qb_dos_tty_write(const uint8_t *bytes, int len) {
    for (int i = 0; i < len; i++) tty_putc(bytes[i]);
}

void qb_dos_tty_reset(void) {
    g_cur_row = 0;
    g_cur_col = 0;
    g_tty_state = TTY_NORMAL;
    g_sjis_lead = 0;
    g_csi_nparam = 0;
    g_csi_has_digit = 0;
    g_csi_priv = 0;
    /* DOS CON ワークエリア (0:0711h/0712h/071Dh) を既定 (fkey 非表示・25 行・白属性) に。
     * master.lib text_fillca/TEXT_HEIGHT がここを直読みする (未初期化=0 だと全画面
     * fill が 1 行で切れる)。 */
    g_tty_lines20 = 0;
    g_tty_sysline = 0;
    g_tty_attr = DEF_ATTR;
    tty_sync_conarea();
    /* image 再起動ごとに開きっぱなしのハンドルを掃除 + DTA を既定に戻す。
     * 同様に findfirst イテレータも閉じる。 */
    fh_reset_all();
    if (g_find.dirp) { closedir(g_find.dirp); g_find.dirp = NULL; }
    g_find.pattern[0] = '\0';
    g_dta_linear = ((uint32_t)0x0100 << 4) + 0x80;
    g_dta_seg = 0x0100;
    g_dta_off = 0x0080;
    g_cwd[0] = '\0';     /* カレントディレクトリをルートへ戻す */
    /* 入力系の途中状態をクリア (前回 image の行入力/再ポーリングを持ち越さない) */
    g_int21_repoll = 0;
    g_la_active = 0;
    g_la_buf = 0;
    g_la_len = 0;
    g_0c_flushing = 0;   /* AH=0Ch flush ラッチ (再ポーリング途中での中断対策) */
}

int qb_dos_int21_hook(void) {
    qb_dos_int21_dispatch();
    return 1;
}

int qb_dos_int20_hook(void) {
    fprintf(stderr, "[int20h] hit (CS:IP=%04X:%04X) — DOS exit shortcut\n",
            (unsigned)CPU_CS, (unsigned)CPU_IP);
    qb_dos_signal_exit(0);
    return 1;
}
