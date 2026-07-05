/* SPDX-License-Identifier: MIT */
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
#include <io/gdc.h>         /* GDCSCRN_ENABLE / GDCSCRN_ALLDRAW2。GDC_CSRW (HW カーソル追従) は
                             * iocore.h → gdc_cmd.h 経由 (gdc_cmd.h はガード無しで直 include 不可) */

#include "dos_int21.h"
#include "dos_loader.h"
#include "qb_guestmem.h"    /* qb_mem_write: VRAM 宛バルク転送を memp_write8 経由に (共有) */

extern UINT8 mem[];

/* dos_loader.c の終了通知。戻り値 1 = EXEC 子の終了で親を復元した (CPU リダイレクト済 →
 * dispatch tail の FLAGS 書き戻しを skip すること)、0 = 最上位プログラム終了で halt。 */
int qb_dos_signal_exit(int code);
/* term_type 付き版 (AH=4Dh の上位バイト)。^C 中断は type 1 で報告する (実 DOS 契約)。 */
int qb_dos_signal_exit2(int code, int term_type);
/* AH=4Dh 用: 直近に終了した子の (type<<8 | code)。 */
uint16_t qb_dos_exec_last_code(void);
/* AH=52h 用: MCB チェーンの先頭 (空きアリーナ起点) セグメント。List of Lists の [BX-2]。 */
uint16_t qb_dos_first_mcb_seg(void);

#define TEXT_COLS  80
/* テキスト画面の行数。25 (標準) か 30 (qbDebug.lines30 = 仮想 30行BIOS) を実行時に取る。
 * #define を実行時変数へ差し替え、既存の TEXT_ROWS 使用箇所 (カーソル/スクロール境界) は無改変。
 * 値は tty_sync_conarea が qb_lines30_enabled から設定する。詳細: docs/30line_spec.md。 */
static int g_text_rows = 25;
#define TEXT_ROWS  (g_text_rows)
#define VRAM_CODE  0xA0000u
#define VRAM_ATTR  0xA2000u
#define DEF_ATTR   0xE1     /* 白文字、表示 ON (boot_hello と同じ値) */

static int g_cur_row = 0;
static int g_cur_col = 0;

/* ESC[s / ESC[u (カーソル・属性の保存/復元) の保存先は CON ワークエリア 0:0726h/0727h/072Bh
 * (内部変数でなくゲストから見える実 DOS の番地。csi_dispatch の 's'/'u' 参照)。 */

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
    TTY_ESC_EQ_ROW,  /* "ESC =" 後、行バイト待ち (VT52/PC-98 直接カーソル位置指定) */
    TTY_ESC_EQ_COL,  /* "ESC =" 後、列バイト待ち */
    TTY_ESC_DESIG,   /* "ESC )" / "ESC (" 後、文字集合指定バイト待ち (漢字/グラフモード切替) */
} tty_state_t;

static tty_state_t g_tty_state = TTY_NORMAL;
static uint8_t g_sjis_lead;    /* TTY_SJIS2 中: 保留した Shift-JIS 第1バイト */
static uint8_t g_esc_eq_row;   /* TTY_ESC_EQ_COL 中: 保留した行バイト */
/* グラフ文字モード (ESC)3 / INT DCh AH=0Eh DX=3)。ON のとき SJIS 第1バイトを全角結合せず
 * 各バイトを ANK 1 文字として描く (実機/np21w の挙動: "テ"=83h 65h の 65h が 'e' として出る)。
 * 既定 OFF=漢字モード (2 バイト結合)。通常ゲームは ESC) を送らないのでゼロ回帰。 */
static int     g_graph_mode = 0;
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

/* 仮想 30行BIOS (qbDebug.lines30 / np2kai_set_lines30)。ON のとき loader-start が 640×480・30 行へ
 * 切替え、tty を 30 行・DOS ワーク 0x712=29 にし、INT 18h で 30BIOS-API を提供する。既定 OFF=ゼロ回帰。
 * 詳細: docs/30line_spec.md。 */
int qb_lines30_enabled = 0;

static void tty_sync_conarea(void) {
    /* 30 行モード時は 30 行・行間なし固定 (lines20 より優先)。それ以外は従来 (20/25 行)。 */
    int base = qb_lines30_enabled ? 30 : (g_tty_lines20 ? 20 : 25);
    int rows = base - (g_tty_sysline ? 1 : 0);
    /* VRAM の実行 row 数 (カーソル/スクロール境界)。20 行モードでも VRAM は 25 行のまま
     * (従来挙動)、30 行モードのみ 30 行に拡張。 */
    g_text_rows = qb_lines30_enabled ? 30 : 25;
    mem[0x711] = (uint8_t)(g_tty_sysline ? 1 : 0);
    mem[0x712] = (uint8_t)(rows - 1);
    /* 0:0713h = dosscrn_25 (20/25 行判定フラグ)。非ゼロ=25 行・ゼロ=20 行。
     * PC-98 版 VZ Editor の check_20 (SCRN98.ASM) がここを tstb で読み、
     * 行高 (lineh=15 か 19) を選ぶ。未設定 (=0) だと 25 行モードでも 20 行と
     * 誤認され縦方向のラスタ/カーソル計算がずれる。VZ は nonzero テストのみ
     * なので 25 行=1 で足りる。30 行も行間なし扱い=1。 */
    mem[0x713] = (uint8_t)((qb_lines30_enabled || !g_tty_lines20) ? 1 : 0);
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

/* 消去・スクロール空行の 1 セルを「クリア文字 (0:0719h)・クリア属性 (0:0714h)」で埋める。
 * 実 PC-98 DOS の CON は消去 (ESC[J/K・cls) とスクロール新規行を現在属性でなく専用の
 * クリアスロットで埋める (SimK PC98WORK PAGE5: 現在属性=白のまま 0114h=赤反転を直書き
 * → ESC[2K が赤反転 '*' 埋めになる。DOS 3.x 実機結果で確認)。DOS 6.x は word 版 013Eh を
 * 見る世代差があるが、我々の live 面は古典 (DOS 3.x) の byte 側で統一する。既定値
 * (20h/E1h) のままなら従来の「空白+白」と同一 = ゼロ回帰。副次効果として、SGR で色を
 * 変えたままスクロールしても新規行は白のまま — これも実機の観測面と一致する。 */
static void vram_put_clear(int row, int col) {
    uint32_t code_off = VRAM_CODE + ((row * TEXT_COLS + col) * 2);
    uint32_t attr_off = VRAM_ATTR + ((row * TEXT_COLS + col) * 2);
    mem[code_off]     = mem[0x719];
    mem[code_off + 1] = 0;
    mem[attr_off]     = mem[0x714];
    mem[attr_off + 1] = 0;
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
        vram_put_clear(TEXT_ROWS - 1, c);
    }
}

static void vram_clear_all(void) {
    /* 全 cell をクリア文字+クリア属性で埋める (CON の ESC[2J 相当。既定は space+0xE1 =
     * NP2kai bios_memclear の実機相当初期値と同じ)。 */
    for (int r = 0; r < TEXT_ROWS; r++) {
        for (int c = 0; c < TEXT_COLS; c++) {
            uint32_t code_off = VRAM_CODE + ((r * TEXT_COLS + c) * 2);
            uint32_t attr_off = VRAM_ATTR + ((r * TEXT_COLS + c) * 2);
            mem[code_off]     = mem[0x719];
            mem[code_off + 1] = 0;
            mem[attr_off]     = mem[0x714];
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

/* 行挿入 (CSI 'L' / INT DCh AH=0Ch): at_row に空行を n 行挿入し、以降を下へスクロール。
 * 下端へ押し出された行は消滅 (画面外)。NEC PC-98 CON の ESC[nL 相当。カーソルは動かさない。
 * 行ブロックは重なるので memmove を使う (memcpy では未定義動作)。 */
static void vram_insert_lines(int at_row, int n) {
    if (at_row < 0) at_row = 0;
    if (at_row >= TEXT_ROWS) return;
    if (n < 1) n = 1;
    if (n > TEXT_ROWS - at_row) n = TEXT_ROWS - at_row;
    int move_rows = TEXT_ROWS - at_row - n;          /* 下へずらす行数 */
    if (move_rows > 0) {
        size_t bytes = (size_t)move_rows * TEXT_COLS * 2;
        memmove(&mem[VRAM_CODE + ((at_row + n) * TEXT_COLS) * 2],
                &mem[VRAM_CODE + (at_row * TEXT_COLS) * 2], bytes);
        memmove(&mem[VRAM_ATTR + ((at_row + n) * TEXT_COLS) * 2],
                &mem[VRAM_ATTR + (at_row * TEXT_COLS) * 2], bytes);
    }
    for (int r = at_row; r < at_row + n; r++)        /* 空いた n 行をクリア文字/属性で埋める */
        for (int c = 0; c < TEXT_COLS; c++) vram_put_clear(r, c);
    gdcs.textdisp |= GDCSCRN_ALLDRAW2;
}

/* 行削除 (CSI 'M' / INT DCh AH=0Dh): at_row から n 行削除し、以降を上へスクロール。
 * 下端には空行が n 行できる。NEC PC-98 CON の ESC[nM 相当。カーソルは動かさない。 */
static void vram_delete_lines(int at_row, int n) {
    if (at_row < 0) at_row = 0;
    if (at_row >= TEXT_ROWS) return;
    if (n < 1) n = 1;
    if (n > TEXT_ROWS - at_row) n = TEXT_ROWS - at_row;
    int move_rows = TEXT_ROWS - at_row - n;          /* 上へずらす行数 */
    if (move_rows > 0) {
        size_t bytes = (size_t)move_rows * TEXT_COLS * 2;
        memmove(&mem[VRAM_CODE + (at_row * TEXT_COLS) * 2],
                &mem[VRAM_CODE + ((at_row + n) * TEXT_COLS) * 2], bytes);
        memmove(&mem[VRAM_ATTR + (at_row * TEXT_COLS) * 2],
                &mem[VRAM_ATTR + ((at_row + n) * TEXT_COLS) * 2], bytes);
    }
    for (int r = TEXT_ROWS - n; r < TEXT_ROWS; r++)  /* 下端に空行 n 行 (クリア文字/属性) */
        for (int c = 0; c < TEXT_COLS; c++) vram_put_clear(r, c);
    gdcs.textdisp |= GDCSCRN_ALLDRAW2;
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
    case 'L': vram_insert_lines(g_cur_row, csi_param(0, 1)); break;  /* 行挿入 (PC-98 CON 拡張) */
    case 'M': vram_delete_lines(g_cur_row, csi_param(0, 1)); break;  /* 行削除 (PC-98 CON 拡張) */
    case 'J': {
        int p = csi_param(0, 0);
        if (p == 2) { vram_clear_all(); g_cur_row = 0; g_cur_col = 0; }
        else if (p == 0) {
            /* cursor から末尾まで */
            for (int c = g_cur_col; c < TEXT_COLS; c++) vram_put_clear(g_cur_row, c);
            for (int r = g_cur_row + 1; r < TEXT_ROWS; r++)
                for (int c = 0; c < TEXT_COLS; c++) vram_put_clear(r, c);
        } else if (p == 1) {
            /* 先頭から cursor まで (cursor 位置含む — 0K/2J と同じく K/J 系は cursor 込み) */
            for (int r = 0; r < g_cur_row && r < TEXT_ROWS; r++)
                for (int c = 0; c < TEXT_COLS; c++) vram_put_clear(r, c);
            for (int c = 0; c <= g_cur_col && c < TEXT_COLS; c++) vram_put_clear(g_cur_row, c);
        }
        break;
    }
    case 'K': {
        int p = csi_param(0, 0);
        if (p == 0) {
            for (int c = g_cur_col; c < TEXT_COLS; c++) vram_put_clear(g_cur_row, c);
        } else if (p == 1) {
            for (int c = 0; c <= g_cur_col; c++) vram_put_clear(g_cur_row, c);
        } else if (p == 2) {
            for (int c = 0; c < TEXT_COLS; c++) vram_put_clear(g_cur_row, c);
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
    case 'n': {
        /* DSR (Device Status Report)。応答を入力ストリームへ注入する (実機 CON は応答を
         * キーバッファへ流し、プログラムが getchar で読む)。注入 FIFO 経由なので BIOS INT 18h
         * 直読み / DOS AH=01-08 のどれで読んでも届く ([[project_host_ime_input]] の経路を流用)。
         *   6n → カーソル位置 ESC[<row>;<col>R (1-based)、5n → 端末ステータス ESC[0n (異常なし)。
         * 私的マーカ付き (ESC[>6n 等) には応答しない。 */
        int p = csi_param(0, 0);
        if (g_csi_priv == 0 && p == 6) {
            char rep[24];
            int n = snprintf(rep, sizeof rep, "\x1b[%d;%dR", g_cur_row + 1, g_cur_col + 1);
            if (n > 0) qb_dos_inject_input((const uint8_t *)rep, n);
        } else if (g_csi_priv == 0 && p == 5) {
            static const uint8_t ok[] = { 0x1b, '[', '0', 'n' };   /* 端末異常なし */
            qb_dos_inject_input(ok, sizeof ok);
        }
        break;
    }
    case 's':   /* カーソル位置 (+ PC-98 では属性) を保存。保存先は CON ワークエリア
                 * 0:0726h/0727h (Y/X)・0:072Bh (属性) — 実 DOS 3.x は ESC[u がここを毎回
                 * そのまま読むので、直書きで飛び先を差し替えられる (SimK PC98WORK PAGE3 の
                 * DOS3 実機結果で確認)。DOS 6.x には one-shot 化+属性無視の世代差があるが、
                 * 我々は live 同期のワークエリア=真実という古典意味論で統一する。 */
        mem[0x726] = (uint8_t)g_cur_row; mem[0x727] = (uint8_t)g_cur_col;
        mem[0x72B] = g_tty_attr;
        break;
    case 'u':   /* 保存したカーソル位置・属性をワークエリアから live 読みで復元 */
        g_cur_row = mem[0x726]; g_cur_col = mem[0x727];
        g_tty_attr = mem[0x72B]; mem[0x71D] = g_tty_attr;
        csi_clamp_cursor();
        break;
    case 'r':
        /* スクロール領域 (top;bottom マージン)。全画面スクロール固定のため未対応 (良性無視)。 */
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

static void tty_putc_raw(uint8_t ch) {
    if (g_tty_echo_dbg) fputc(ch, stderr);

    switch (g_tty_state) {
    case TTY_NORMAL:
        if (ch == 0x1B) { g_tty_state = TTY_ESC; return; }
        /* Shift-JIS 第1バイト (0x81-0x9F, 0xE0-0xFC) なら次バイトと合成して全角描画。
         * ただしグラフ文字モード (ESC)3) 中は結合せず各バイトを ANK 1 文字として描く。 */
        if (!g_graph_mode && ((ch >= 0x81 && ch <= 0x9F) || (ch >= 0xE0 && ch <= 0xFC))) {
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
            /* ESC c (reset) / ESC * (PC-98 clear) — 属性もクリアスロットも既定へ戻してから消去 */
            g_tty_attr = DEF_ATTR;
            mem[0x71D] = DEF_ATTR;
            mem[0x714] = DEF_ATTR;   /* クリア属性/文字もリセット (reset の意味論) */
            mem[0x719] = 0x20;
            vram_clear_all();
            g_cur_row = 0; g_cur_col = 0;
            g_tty_state = TTY_NORMAL;
            return;
        }
        if (ch == 'D') {            /* ESC D = index: 1 行下、下端でスクロール (桁保持)。INT DCh AH=04h の生 ESC 版 */
            g_cur_row++;
            if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
            g_tty_state = TTY_NORMAL;
            return;
        }
        if (ch == 'E') {            /* ESC E = next line: 桁 0 + 1 行下、下端でスクロール */
            g_cur_col = 0;
            g_cur_row++;
            if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
            g_tty_state = TTY_NORMAL;
            return;
        }
        if (ch == 'M') {            /* ESC M = reverse index: 1 行上、上端で逆スクロール (上に空行) */
            if (g_cur_row > 0) g_cur_row--;
            else vram_insert_lines(0, 1);    /* 上端: 全体を 1 行下げ最上行を空ける */
            g_tty_state = TTY_NORMAL;
            return;
        }
        if (ch == '=') {            /* ESC = l c = VT52/PC-98 直接カーソル位置指定 (次の 2 バイトで行/列) */
            g_tty_state = TTY_ESC_EQ_ROW;
            return;
        }
        if (ch == ')' || ch == '(') { /* ESC ) n / ESC ( n = 文字集合指定。次の 1 バイト (n) で
                                       * 漢字/グラフモードを切替える (PC-98 CON)。指定バイトを必ず消費し
                                       * 文字漏れを防ぐ (旧実装は ESC) を 2 バイトで消費し n を描画していた)。 */
            g_tty_state = TTY_ESC_DESIG;
            return;
        }
        /* 未知の ESC X — X を捨てて NORMAL に戻す */
        g_tty_state = TTY_NORMAL;
        return;
    case TTY_ESC_DESIG:            /* ESC ) / ESC ( の指定バイト: '3' = グラフモード、それ以外 = 漢字モード */
        g_graph_mode = (ch == '3');
        g_tty_state = TTY_NORMAL;
        return;
    case TTY_ESC_EQ_ROW:            /* ESC = の行バイト: row = byte - 0x20 (0-based)。次は列 */
        g_esc_eq_row = ch;
        g_tty_state = TTY_ESC_EQ_COL;
        return;
    case TTY_ESC_EQ_COL:            /* ESC = の列バイト: col = byte - 0x20。カーソル確定 */
        g_cur_row = (int)g_esc_eq_row - 0x20;
        g_cur_col = (int)ch - 0x20;
        csi_clamp_cursor();
        g_tty_state = TTY_NORMAL;
        return;
    case TTY_CSI:
        if (ch == '?' || ch == '>') {
            /* 私的マーカ。標準 ANSI は '[' 直後 (ESC[?25h) に置くが、NEC PC-98 の ANSI は
             * パラメータの後にも許す: WinDy (wd113) は fkey 行制御を ESC[1>h / ESC[1>l と
             * 「数字→'>'」順で送る。旧実装は数字後の '>' を priv 扱いせず終端文字に誤認し、
             * 続く 'h'/'l' を素の文字として描画していた (メイン画面左上の謎の 'h' の正体)。
             * 位置によらず priv に記録すれば ESC[>1h と ESC[1>h を同一視できる (標準系も不変)。 */
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

/* DOS CON カーソル座標ワークエリア: 0:0710h = カーソル行 (Y, 0 起点) / 0:071Ch = カーソル列 (X, 0 起点)。
 * 実 PC-98 DOS は文字出力ルーチンが毎回ここを読み書きするので、ゲストが ESC/INT を介さず
 * この番地へ座標を直接書き込むだけでカーソルを動かせる (WORKTEST.COM の挙動・NP21W と一致)。
 * 我々はカーソルを g_cur_row/g_cur_col で保持するため、出力の前後でこの番地と双方向同期する:
 *   load = 出力直前にゲストの直書きを取り込む / store = 出力後に自前の前進を反映。
 * ワークエリアを触らないソフトでは load→store が恒等往復になり挙動不変 (ゼロ回帰)。
 * 番地は 0x711/0712/0713/071D の既存 CON ワーク (tty_sync_conarea) と重ならない。 */
static void tty_load_cursor(void) {
    g_cur_row = (uint8_t)mem[0x710];
    g_cur_col = (uint8_t)mem[0x71C];
    /* 現在属性 0:071Dh も読み戻す — ゲストの直書きが次の出力から効く (実 DOS 3.x、
     * SimK PC98WORK PAGE4 で確認。DOS 6.x は word 版 013Ch を見る世代差があるが byte 側を
     * 採る)。自前パス (SGR / INT DCh AH=02h / ESC[u) は書き込み時に 071Dh も更新して
     * いるので、直書きが無ければ恒等往復 = ゼロ回帰。 */
    g_tty_attr = mem[0x71D];
    csi_clamp_cursor();
}
static void tty_store_cursor(void) {
    mem[0x710] = (uint8_t)g_cur_row;
    mem[0x71C] = (uint8_t)g_cur_col;
    /* GDC ハードウェアカーソル (master, CSRW) も論理カーソルに追従させる。実 PC-98 DOS の
     * CON はカーソル移動のたび GDC に CSRW を発行する (BIOS INT 18h AH=13h と同経路)。
     * これが無いと GDC CSRR で「実カーソル位置」を読むソフトに常に古い位置が見える:
     * QuickBASIC ランタイムは起動時に「カーソルを 21 行目へ置き CSRR で読み戻せるか」で
     * 20/25 行を判定するため、読み戻し不一致 → 20 行と誤認 → LOCATE x,25 が一律
     * 「引数が許される範囲ではありません (ERR=5)」になっていた (maze-776/MAZE_999 で実証、
     * QB 製アプリ全般の systemic 修正)。EAD はワードアドレス = row*80 + col。
     * bios18.c AH=13h と同じく値が変わるときだけ書いて EXT 通知する。 */
    uint16_t ead = (uint16_t)((uint16_t)g_cur_row * 80u + (uint16_t)g_cur_col);
    gdc_forceready(GDCWORK_MASTER);
    if (LOADINTELWORD(gdc.m.para + GDC_CSRW) != ead) {
        STOREINTELWORD(gdc.m.para + GDC_CSRW, ead);
        gdcs.textdisp |= GDCSCRN_EXT;
    }
}

/* tty_putc の単一チョークポイント版: 1 文字出力の前後でカーソル座標ワークエリアと同期する。
 * 全 DOS コンソール出力 (AH=02/06/09/40・INT 29h・INT DCh CL=10h AH=00/01・cooked エコー) は
 * この tty_putc を通るので、ここで同期すれば全経路が WORKTEST 互換になる。INT DCh の
 * カーソル直接移動系 (CL=10h AH=03-09) は tty_putc を経由しないため、そちらは intdc 側で別途同期。 */
static void tty_putc(uint8_t ch) {
    tty_load_cursor();
    tty_putc_raw(ch);
    tty_store_cursor();
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

/* INT DCh ソフトキー発行文字列の残量 (定義は後述)。kb_available が「入力あり」に含める。 */
static int      g_softkey_len;
static int      g_softkey_pos;

/* ===== ホスト IME 注入 FIFO (2026-06-21) =====================================================
 * ブラウザ (ホスト) の IME で確定したかな漢字混じり文字列を Shift-JIS バイト列にして
 * np2kai_inject_text → qb_dos_inject_input で積み、DOS の文字入力 (dos_next_input_byte) が
 * キーバッファより優先して 1 バイトずつ取り出す。実機で FEP が確定文字列をキー入力ストリームへ
 * 流すのと等価で、ゲストには「FEP が確定した文字がタイプされた」と区別がつかない。FEP/辞書を
 * 持ち込まずホスト IME で日本語入力するための経路 (docs: FEP/IME 検討)。 */
#define QB_INJECT_CAP 1024
static uint8_t g_inject_buf[QB_INJECT_CAP];
static int     g_inject_head, g_inject_tail;
static int inject_available(void) { return g_inject_head != g_inject_tail; }
static int inject_get(void) {
    if (g_inject_head == g_inject_tail) return -1;
    int b = g_inject_buf[g_inject_head];
    g_inject_head = (g_inject_head + 1) % QB_INJECT_CAP;
    return b;
}
static void inject_pump(void);   /* 前方宣言: 実体は kb_put_word 定義後 */
void qb_dos_inject_input(const uint8_t *bytes, int len) {
    for (int i = 0; i < len; i++) {
        int next = (g_inject_tail + 1) % QB_INJECT_CAP;
        if (next == g_inject_head) break;   /* 満杯 → 残りは捨てる (次のポーリングで足りる) */
        g_inject_buf[g_inject_tail] = bytes[i];
        g_inject_tail = next;
    }
    inject_pump();   /* 即座に BIOS キーバッファ (0x502) を補充 → 短文はゼロ遅延、全読み取り口へ届く */
}

static int kb_available(void) {
    return (g_softkey_pos < g_softkey_len) || inject_available() || mem[QB_KB_COUNT] != 0;
}

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

/* 1 エントリ enqueue (tail へ)。kb_get_word の逆。満杯 (16 エントリ) なら捨てる。 */
static void kb_put_word(uint16_t word) {
    if (mem[QB_KB_COUNT] >= 16) return;
    uint16_t pos = peek16(QB_KB_TAIL);
    poke16(pos, word);
    uint16_t next = (uint16_t)(pos + 2);
    if (next >= QB_KB_BUF_WRAP) next = QB_KB_BUF;
    poke16(QB_KB_TAIL, next);
    mem[QB_KB_COUNT]++;
}

/* 注入 FIFO のバイトを実 BIOS キーバッファ (0x502) へペース供給する。BIOS INT 18h (bios18.c keyget)・
 * DOS 文字入力 (AH=01/06/07/08)・AH=0Ah 行入力はいずれも 0x502 を読むので、これで注入が**全読み取り口**
 * へ物理キーと同じ扱いで届く (FEP が確定文字列をキーバッファへ流すのと等価)。char=byte / scan=0
 * (文字コードで判定するアプリは OK・稀に scan を見るアプリは別途)。16 エントリしかないので 1 枠残して
 * 埋め、溢れは FIFO に保持し次回補充。boot 前 (バッファ未初期化) は保留して不正番地書き込みを防ぐ。 */
static void inject_pump(void) {
    uint16_t tail = peek16(QB_KB_TAIL);
    if (tail < QB_KB_BUF || tail >= QB_KB_BUF_WRAP) return;   /* キーバッファ未初期化 (boot 前) は保留 */
    while (mem[QB_KB_COUNT] < 15) {
        int b = inject_get();
        if (b < 0) break;
        kb_put_word((uint16_t)(b & 0xFF));
    }
}

/* 毎フレーム呼ぶ補充口 (np2kai_run_frame から)。BIOS INT 18h 直読みアプリ向けに 0x502 を満たし続ける。 */
void qb_dos_inject_pump(void) { inject_pump(); }

/* ===== INT DCh: PC-98 ファンクション/編集キー定義テーブル =====================================
 * フルスクリーンエディタ等は INT DCh で自前のキー定義表を BIOS に流し込み、各ソフトキー
 * (f1-f10 / カーソル・編集キー) を押すと定義された「発行文字列」が DOS 入力に流れる。bios09 は
 * ソフトキーを (char=0x00, scan=高位) として enqueue するだけ (定義文字列を出さない) ので、
 * 我々が DOS CON ドライバとして発行文字列に翻訳する。標準テーブル = [ファンクションキー 20本
 * (f1-f10 ×2: 通常/SHIFT) × 16byte][編集キー 11本 × 6byte] の KTBLSZ レイアウト。
 *
 * INT DCh setkey には 2 系統があり、どちらも同じ標準テーブルへ書き込む (実 BIOS は 1 つの
 * テーブルを両 API で読み書きする):
 *   - 全体一括 (AX=0, DS:DX=テーブル全体): VZ Editor が使う。テーブルを丸ごと流し込む。
 *   - 1 キー単位 (AX=key# 1..31, DS:DX=発行文字列): JED が使う。key# で 1 スロットだけ定義
 *     (例: ↑=key#25 に "FF 3A" → 押下で 0xFF+scan の 2 バイトを発行)。
 * 旧実装は AX=0 前提で「渡された linear をそのまま保持」していたため、JED の 1 キー単位 setkey
 * (使い捨て 2 byte バッファ) を保持してしまい softkey_fill がゴミを読んでカーソルキーが死んでいた。
 * → C 側に正準テーブル g_keytbl を持ち、両 API で populate・softkey_fill はそこを読む。 */
static uint8_t  g_keytbl[386];     /* C 側正準テーブル (KTBLSZ レイアウト) */
static int      g_keytbl_set;      /* 0 = 未 install (softkey 翻訳しない=非エディタはゼロ回帰) */
static uint8_t  g_softkey_buf[24]; /* 直近ソフトキーの発行文字列 (NUL 終端まで)。len/pos は上で宣言済 */

/* 編集/ファンクションキーのテーブル先頭オフセット。標準レイアウト (KTBLSZ) は
 * ファンクションキー 20本 (f1-f10 ×2: 通常/SHIFT) × 16byte の後ろに編集キー。 */
#define QB_FKEY_SLOT_BYTES   16
#define QB_FKEY_COUNT        20
#define QB_XKEY_BASE_OFF     (QB_FKEY_COUNT * QB_FKEY_SLOT_BYTES)   /* 編集キー群の先頭 */
#define QB_XKEY_SLOT_BYTES   6
#define QB_KTBL_STD_SIZE     (QB_XKEY_BASE_OFF + 11 * QB_XKEY_SLOT_BYTES)  /* = 386 */

/* INT DCh ソフトキー番号 (1 キー単位 setkey の AX) → 標準テーブル内の発行文字列オフセット/長。
 *   1..20  = f1-f10 / SHIFT f1-f10 : スロット (n-1)*16、発行文字列はスロット +6 (先頭6byteは表示ラベル)
 *   21..31 = 編集キー (RLUP/RLDN/INS/DEL/↑/←/→/↓/CLR/HELP/…): スロット 320 + (n-21)*6
 * softkey_fill の scan→オフセット計算と必ず一致させること (同じ物理キーが同じ番地を指す)。
 * 返り値 = 発行文字列長 (書込可能バイト数)、*off = 開始オフセット。範囲外は -1。 */
static int keynum_issue_slot(int keynum, int *off) {
    if (keynum >= 1 && keynum <= QB_FKEY_COUNT) {                  /* 1..20 fkey/shift-fkey */
        *off = (keynum - 1) * QB_FKEY_SLOT_BYTES + 6;
        return QB_FKEY_SLOT_BYTES - 6;                             /* 10 */
    }
    if (keynum >= QB_FKEY_COUNT + 1 && keynum <= QB_FKEY_COUNT + 11) {  /* 21..31 編集キー */
        *off = QB_XKEY_BASE_OFF + (keynum - (QB_FKEY_COUNT + 1)) * QB_XKEY_SLOT_BYTES;
        return QB_XKEY_SLOT_BYTES;                                 /* 6 */
    }
    return -1;
}

/* scan コードのソフトキーに対し、install されたテーブルから発行文字列を g_softkey_buf に展開。
 * 返り値 = 文字列長 (0 = ソフトキーでない or 未 install or 定義空)。
 * 編集キー scan: 0x36..0x3f を 0 起点スロットに、ファンクションキー scan: 0x62..0x6b を f1..f10 に。 */
static int softkey_fill(uint8_t scan) {
    if (!g_keytbl_set) return 0;
    int off;
    int maxbytes;                                  /* スロット内で発行文字列が占める領域 (跨ぎ読み防止) */
    if (scan >= 0x62 && scan <= 0x6b) {            /* f1-f10 (通常): 16byte スロット、発行文字列は +6 */
        off = (int)(scan - 0x62) * QB_FKEY_SLOT_BYTES + 6;
        maxbytes = QB_FKEY_SLOT_BYTES - 6;         /* スロット末尾までの 10 byte */
    } else if (scan >= 0x36 && scan <= 0x3f) {     /* 編集キー: 並び順 RLUP/RLDN/INS/DEL/↑/←/→/↓/CLR/HELP */
        /* scan 0x36(RLUP)=slot0 起点。カーソルは ↑0x3a→slot4 / ←0x3b→5 / →0x3c→6 / ↓0x3d→7。 */
        off = QB_XKEY_BASE_OFF + (int)(scan - 0x36) * QB_XKEY_SLOT_BYTES;
        maxbytes = QB_XKEY_SLOT_BYTES;             /* 編集キーは 6 byte スロット (隣スロットへ食み出さない) */
    } else {
        return 0;
    }
    int n = 0;
    for (int i = 0; i < maxbytes && n < (int)sizeof(g_softkey_buf); i++) {
        uint8_t b = g_keytbl[off + i];
        if (b == 0) break;
        g_softkey_buf[n++] = b;
    }
    g_softkey_len = n;
    g_softkey_pos = 0;
    return n;
}

/* DOS コンソール入力の 1 バイト取り出し。-1 = 入力なし。
 * 発行文字列が残っていれば優先。なければバッファから dequeue し、ソフトキー (char=0x00) は
 * install 済テーブルの発行文字列に翻訳して 1 バイト目を返す。通常キーは文字コードをそのまま。 */
static int dos_next_input_byte(void) {
    if (g_softkey_pos < g_softkey_len)
        return g_softkey_buf[g_softkey_pos++];
    inject_pump();                       /* 注入 FIFO→0x502 を補充してから読む (DOS 読みも 0x502 経由に一本化) */
    int w = kb_get_word();
    if (w < 0) return -1;
    uint8_t ch   = (uint8_t)(w & 0xFF);
    uint8_t scan = (uint8_t)((w >> 8) & 0xFF);
    if (ch == 0x00 && softkey_fill(scan))
        return g_softkey_buf[g_softkey_pos++];
    return ch;
}

/* 次に読まれる 1 文字を消費せず覗く (-1 = 無し)。優先順は dos_next_input_byte と同じ:
 * ソフトキー発行文字列の残り → BIOS キーバッファ (0x502) の先頭 word の文字バイト。
 * AH=0Bh の ^C チェック用 (実 DOS は状態問い合わせでも次の文字が 03h なら INT 23h を発火する)。 */
static int kb_peek_char(void) {
    if (g_softkey_pos < g_softkey_len) return g_softkey_buf[g_softkey_pos];
    inject_pump();
    if (!mem[QB_KB_COUNT]) return -1;
    return peek8(peek16(QB_KB_HEAD));
}

/* INT DCh CL=10h のカーソル移動/消去/行操作で使う: DX を CSI param0 にして final を dispatch。
 * DX=0 は ESC[<final> (パラメータ省略=既定 1、消去系は既定 0) と同義 (NEC PC-98 CON 準拠)。
 * has_digit を (n!=0) にすることで、n=0 のとき csi_param が各 final の既定値を返す。 */
static void intdc_csi(uint8_t final, uint16_t n) {
    g_csi_param[0]  = (int)n;
    g_csi_nparam    = 0;
    g_csi_has_digit = (n != 0);
    g_csi_priv      = 0;
    csi_dispatch(final);
}

/* INT DCh ハンドラ (0xFEEA0 トランポリン → biosfunc 経由)。
 * CL=0Dh setkey: AX=0 で全体一括、AX=key# で 1 キー単位 (どちらも g_keytbl へ書く)。
 * CL=0Ch getkey: AX=0 で全体を DS:DX へ、AX=key# で 1 キーを DS:DX へ複製。
 * CL=10h 文字・画面制御: AH 別に既存 tty へ橋渡し (00h 1文字/01h $終端文字列/02h 属性/
 *   03h カーソル位置/04-09h カーソル移動/0Ah 画面消去/0Bh 行消去/0Ch 行挿入/0Dh 行削除/
 *   0Eh 漢字-グラフモード)。AH 一覧と意味は lpproj gist (FreeDOS(98) INT DCh) に対応。
 *   その他 CL は良性 no-op + 診断ログ。レジスタ・フラグは変えない。 */
int qb_dos_intdc_hook(void) {
    uint8_t  cl  = (uint8_t)(CPU_CX & 0xFF);
    uint16_t ax  = (uint16_t)CPU_AX;
    uint32_t tbl = lin(CPU_DS, CPU_DX);
    if (cl == 0x0D) {                       /* set key table */
        if (ax == 0) {                      /* 全体一括 (VZ): テーブルを丸ごと g_keytbl へ */
            for (int i = 0; i < QB_KTBL_STD_SIZE; i++) g_keytbl[i] = mem[tbl + i];
            g_keytbl_set = 1;
        } else {                            /* 1 キー単位 (JED): key#=AX のスロットだけ定義 */
            int off, len = keynum_issue_slot((int)ax, &off);
            if (len > 0) {
                int i;
                for (i = 0; i < len; i++) {     /* 発行文字列を NUL 終端までコピー */
                    uint8_t b = mem[tbl + i];
                    g_keytbl[off + i] = b;
                    if (b == 0) { i++; break; }
                }
                for (; i < len; i++) g_keytbl[off + i] = 0;   /* スロット残りをクリア */
                g_keytbl_set = 1;
            }
        }
        g_softkey_len = g_softkey_pos = 0;  /* 切替時に古い発行文字列を破棄 */
    } else if (cl == 0x0C) {                /* get key table → DS:DX へ (未 install は 0) */
        if (ax == 0) {
            for (int i = 0; i < QB_KTBL_STD_SIZE; i++)
                mem[tbl + i] = g_keytbl_set ? g_keytbl[i] : 0;
        } else {
            int off, len = keynum_issue_slot((int)ax, &off);
            for (int i = 0; len > 0 && i < len; i++)
                mem[tbl + i] = g_keytbl_set ? g_keytbl[off + i] : 0;
        }
    } else if (cl == 0x10) {                /* 文字・画面制御 (KANI/OTENKI/SimK PC98DCH が使用)。
                                             * NEC PC-98 DOS の INT DCh コンソール BIOS。各 AH を既存
                                             * tty (ESCパーサ/カーソル/属性/消去) へ橋渡しするだけ。
                                             * 典拠 = lpproj gist + KANI/PC98DCH.COM の実トレース。 */
        uint8_t  ah = (uint8_t)((ax >> 8) & 0xFF);
        uint8_t  dl = (uint8_t)(CPU_DX & 0xFF);
        uint8_t  dh = (uint8_t)((CPU_DX >> 8) & 0xFF);
        uint16_t dx = (uint16_t)(CPU_DX & 0xFFFF);
        /* カーソル移動系 (AH=03-09) は tty_putc を経由せず g_cur_row/col を直接動かすので、
         * ブロックの前後でカーソル座標ワークエリアと同期する (AH=00/01 出力は tty_putc 内でも
         * 同期するが、ここで囲めば全 AH が一様に直書きを取り込み・前進を反映できる)。 */
        tty_load_cursor();
        switch (ah) {
        case 0x00:                          /* 1 文字表示 (DL=文字) */
            tty_putc(dl);
            break;
        case 0x01:                          /* $ 終端文字列表示 (DS:DX、tty_putc が ESC を解釈) */
            for (int i = 0; i < 8192; i++) {
                uint8_t b = mem[(tbl + i) & 0xFFFFF];
                if (b == 0x24) break;       /* '$' 終端 */
                tty_putc(b);
            }
            break;
        case 0x02:                          /* 文字属性設定 (DL=属性) */
            g_tty_attr = dl;
            mem[0x71D] = dl;                /* CON ワークエリアの現在属性も同期 (ESC[m と一貫) */
            break;
        case 0x03:                          /* カーソル位置設定 (DH=行, DL=列, 0-based) */
            g_cur_row = dh;
            g_cur_col = dl;
            csi_clamp_cursor();
            break;
        case 0x04:                          /* カーソル 1 行下移動 (ESC D 相当)。下端で LF 同様スクロール。 */
            g_cur_row++;
            if (g_cur_row >= TEXT_ROWS) { vram_scroll_one(); g_cur_row = TEXT_ROWS - 1; }
            break;
        case 0x05:                          /* カーソル 1 行上移動 (ESC E 相当)。上端ではクランプ (逆スクロール非対応)。 */
            if (g_cur_row > 0) g_cur_row--;
            break;
        case 0x06: intdc_csi('A', dx); break;   /* カーソル上 n (ESC[nA) */
        case 0x07: intdc_csi('B', dx); break;   /* カーソル下 n (ESC[nB) */
        case 0x08: intdc_csi('C', dx); break;   /* カーソル右 n (ESC[nC) */
        case 0x09: intdc_csi('D', dx); break;   /* カーソル左 n (ESC[nD) */
        case 0x0A: intdc_csi('J', dx); break;   /* 画面消去 (ESC[nJ, DX=n) */
        case 0x0B: intdc_csi('K', dx); break;   /* 行消去   (ESC[nK, DX=n) */
        case 0x0C: intdc_csi('L', dx); break;   /* 行挿入 n (ESC[nL) */
        case 0x0D: intdc_csi('M', dx); break;   /* 行削除 n (ESC[nM) */
        case 0x0E:                          /* 漢字/グラフモード切替 (ESC)0 / ESC)3 の INT DCh 版)。
                                             * DX=3 → グラフモード (各バイトを ANK 1 文字)、DX=0 等 → 漢字モード
                                             * (2 バイト結合)。np21w 実機照合で表示が変わると判明 (2026-06-29、
                                             * 旧「no-op が忠実」は誤り)。tty の g_graph_mode を直接操作。 */
            g_graph_mode = (dl == 3);
            break;
        default:                            /* 未対応 AH: 診断ログ (ブラウザ Console)。良性 no-op。 */
            fprintf(stderr, "[intdc] CL=10 unimpl AH=%02x DX=%04x\n", ah, dx);
            break;
        }
        tty_store_cursor();                 /* AH=03-09 のカーソル移動をワークエリアへ反映 */
    } else {                                /* 未対応 CL: 診断ログ (ブラウザ Console)。良性 no-op。 */
        fprintf(stderr, "[intdc] unimpl CL=%02x AX=%04x\n", cl, ax);
    }
    return 1;
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

/* AH=3Fh handle 0 (STDIN cooked 行入力) の状態。行はホスト側 g_con_line に組み立てる
 * (CX より長い行も受けるため = 実 DOS の内部行バッファ相当)。Enter で CR LF を付けて確定し、
 * CX で読み切れなかった残りは g_con_pend_pos..g_con_pend_len として持ち越し、以後の read が
 * 待たずに配布を受ける (実 DOS の行持ち越し)。組み立てはキー待ち再ポーリングを跨いで
 * g_con_building/g_con_len で継続する。 */
static uint8_t  g_con_line[258];                 /* 255 文字 + CR LF (満杯はだまって無視) */
static uint16_t g_con_len;                       /* 組み立て中の行長 / raw 時は受領済みバイト数 */
static int      g_con_building;                  /* 組み立て継続中 (再ポーリング跨ぎ) */
static uint16_t g_con_pend_len, g_con_pend_pos;  /* 確定行の持ち越し (全長 / 配布済み位置) */
/* CON の raw (binary) モードフラグ = device info bit5 (0x20)。IOCTL AX=4401h (Set Device Info)
 * で切り替え、AX=4400h が反映して返す。raw の read はエコー無し・行編集無し・CR LF 変換無しで
 * CX バイトそろうまでブロックする (takapyu 氏実機確認 + RAWMODE.COM で検証)。 */
static int      g_con_raw;

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
        /* 8.3 フィールドのパディング空白を除去する。DOS の 8.3 名に空白は入らず (空白 = FCB の
         * 埋め文字)、プログラムが FindFirst 結果を 11 byte FCB 形式で保持して "NAME    .EXT" の
         * 形で再 open することがある (MUAP98 のファイラが選択曲を開く経路)。実 DOS の open は
         * この空白を読み飛ばす。0x20 は SJIS のリード/トレイル範囲外なので DBCS を壊さない。 */
        if (c == ' ') continue;
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

/* /run 相対の正準形 rel_in ("dir/leaf") を host パスへ解決する (dos_path_to_host の後段。
 * guest ポインタ起点と、C 文字列起点 (COMSPEC /C のコマンド解決) で共用)。
 * 戻り値 (呼び出し側で DOS error code に使う):
 *   0 = 末端まで実在 (= 既存ファイル)
 *   1 = 親までは実在、末端ファイルのみ欠 → file-not-found (AX=2)
 *   2 = 途中ディレクトリが欠 → path-not-found (AX=3)
 * いずれの場合も out には「作るならここ」という確定パスを書く (create 用)。 */
static int dos_rel_to_host(const char *rel_in, char *out, size_t cap) {
    char rel[192];
    snprintf(rel, sizeof(rel), "%s", rel_in);

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

/* DOS パス (seg:off) を /run 配下の host パスに解決する。戻り値は dos_rel_to_host と同じ。 */
static int dos_path_to_host(uint16_t seg, uint16_t off, char *out, size_t cap) {
    char rel[192];
    read_dos_rel(seg, off, rel, sizeof(rel));
    return dos_rel_to_host(rel, out, cap);
}

/* ASCII 大小無視の文字列一致 (strcasecmp 相当。<strings.h> 非依存)。 */
static int ci_ascii_equal(const char *a, const char *b) {
    while (*a && *b) {
        if (tolower((unsigned char)*a++) != tolower((unsigned char)*b++)) return 0;
    }
    return *a == '\0' && *b == '\0';
}

/* C 文字列版 read_dos_rel: DOS パス表記 (drive letter・'\\'・DBCS) を /run 相対の正準形へ。
 * ゲストメモリでなくホスト側で組んだ文字列 (COMSPEC /C のコマンドトークン) の解決用。 */
static void cstr_dos_rel(const char *s, char *rel, size_t cap) {
    if (s[0] && s[1] == ':') s += 2;             /* drive letter "X:" をスキップ */
    char raw[256];
    size_t n = 0;
    while (*s && n + 2 < sizeof(raw)) {
        uint8_t c = (uint8_t)*s++;
        if (c == ' ') continue;
        if (sjis_is_lead(c) && *s) { raw[n++] = (char)c; raw[n++] = *s++; continue; }
        raw[n++] = (c == '\\') ? '/' : (char)c;
    }
    raw[n] = '\0';
    int absolute = (raw[0] == '/');
    const char *core = raw;
    while (*core == '/') core++;
    if (!absolute && g_cwd[0] != '\0') {
        if (*core) snprintf(rel, cap, "%s/%s", g_cwd, core);
        else       snprintf(rel, cap, "%s", g_cwd);
    } else {
        snprintf(rel, cap, "%s", core);
    }
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
    int32_t neg_pos;   /* AH=42h で先頭より前へ seek した論理位置 (<0 のときのみ有効)。
                        * 実 DOS は負 seek をエラーにせず後続 I/O を失敗させる。ホスト
                        * FILE* は負位置を持てないのでここに記録し read/write が error 5。 */
} qb_fh_t;
static qb_fh_t g_fh[DOS_HANDLE_MAX];

static int fh_alloc(FILE *fp, const char *path, const char *mode) {
    for (int h = DOS_HANDLE_USER_BASE; h < DOS_HANDLE_MAX; h++) {
        if (!g_fh[h].used) {
            g_fh[h].used = 1;
            g_fh[h].fp   = fp;
            g_fh[h].neg_pos = 0;
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
/* 1 フィールド (name or ext、'.' を含まない) 内の glob 照合。'*' = 0 文字以上、'?' = 1 文字、
 * その他は大小無視で一致。SJIS バイトも byte 単位で対称に tolower するので照合は安定。 */
static int glob_field(const char *pat, const char *name) {
    if (*pat == '\0') return *name == '\0';
    if (*pat == '*') {
        while (*pat == '*') pat++;
        if (*pat == '\0') return 1;  /* 末尾 * は何でも OK */
        for (; *name; name++) {
            if (glob_field(pat, name)) return 1;
        }
        return glob_field(pat, name);
    }
    if (*name == '\0') return 0;
    if (*pat != '?' &&
        tolower((unsigned char)*pat) != tolower((unsigned char)*name)) return 0;
    return glob_field(pat + 1, name + 1);
}

/* DOS の FindFirst/Next wildcard 照合。
 * pattern に '.' がある場合のみ実 DOS どおり「name.ext」のフィールドに分けて別々に照合する。
 * これで "*.*" が拡張子の無い名前 (ディレクトリ NORM 等) にも一致する (ext フィールドが空 ⇔ "*")
 * ―― 文字単位の素朴な照合では '.' が 'N' に一致せず取りこぼしていた (MUAP98 のファイラが \MUSIC の
 * サブディレクトリを見つけられない真因)。
 * pattern に '.' が無い場合は名前全体に対して従来の char glob を使う ―― 末尾 '*' は '.' を跨いで
 * 全部を飲み込む ("FOO*"→"FOO.BAR" 可) が、ワイルドカード無しの "HTJL" は "HTJL.COM" に一致しない
 * (実 DOS で pattern "HTJL" は ext=空にだけ一致 = 拡張子なしファイルのみ)。"HTJL" を "HTJL.COM" に
 * 一致させると、まず素の名前で FindFirst して無ければ .COM/.EXE を補完するソフト (GS100=gsnake の
 * 音源ドライバ起動) が誤った分岐に入り壊れる。
 * 先頭の '.' は SJIS トレイル (0x40-0xFC) に出ないので区切り判定は SJIS 安全。 */
static int dos_wildcard_match(const char *pat, const char *name) {
    const char *pdot = strchr(pat, '.');
    if (!pdot) return glob_field(pat, name);   /* '.' 無し pattern → 名前全体に char glob (従来挙動) */

    char pbase[260], pext[260], nbase[260], next[260];
    size_t n = (size_t)(pdot - pat);
    if (n >= sizeof(pbase)) n = sizeof(pbase) - 1;
    memcpy(pbase, pat, n); pbase[n] = '\0';
    snprintf(pext, sizeof(pext), "%s", pdot + 1);

    const char *ndot = strchr(name, '.');
    n = ndot ? (size_t)(ndot - name) : strlen(name);
    if (n >= sizeof(nbase)) n = sizeof(nbase) - 1;
    memcpy(nbase, name, n); nbase[n] = '\0';
    snprintf(next, sizeof(next), "%s", ndot ? ndot + 1 : "");

    return glob_field(pbase, nbase) && glob_field(pext, next);
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

/* AH=02h: AL = 最後に出力した文字を返すのが実 DOS の契約 (SimK PC98RET PAGE1 で確認)。
 * TAB (09h) はスペース展開されるので AL=20h、他は DL がそのまま返る。 */
static void int21_02_putchar(void) {
    tty_putc(CPU_DL);
    CPU_AL = (CPU_DL == 0x09) ? 0x20 : CPU_DL;
}

static void int21_06_direct_io(void) {
    /* DL = 0xFF: STDIN を非ブロッキングで読む (あれば ZF=0 AL=char、なければ ZF=1 AL=0)
     * その他  : DL を出力し AL=DL を返す (実 DOS 契約、PC98RET PAGE2 — ESC の生バイトでも
     *           DL がそのまま返る)。06h は仕様上ブロックしない (kbhit 相当)。 */
    if (CPU_DL == 0xFF) {
        int b = dos_next_input_byte();
        if (b < 0) { CPU_AL = 0; CPU_FLAG |= Z_FLAG; }
        else       { CPU_AL = (uint8_t)b; CPU_FLAG &= ~Z_FLAG; }
    } else {
        tty_putc(CPU_DL);
        CPU_AL = CPU_DL;
        CPU_FLAG &= ~Z_FLAG;
    }
}

/* ===== INT 23h (Ctrl-C ハンドラ) 発火 (2026-07-05) ==========================================
 * cooked コンソール入力 (AH=01/08/0Ah/0Bh/3Fh handle 0) が ^C (03h) を見たら INT 23h を
 * 発火するのが実 DOS の契約。AH=06/07h と raw モード (IOCTL bit5) はチェックしない (同契約)。
 * 既定ベクタは loader-start が INT 20h トランポリン (= プログラム中断) へ向けており、
 * その場合は guest を経由せず直接中断する (実 DOS の既定 Ctrl-C abort、AH=4Dh type 1)。
 *
 * ユーザーハンドラ (AX=2523h で差し替え) への発火は「INT フレームの復帰先 = INT 21h
 * トランポリンの NOP (F000:EE10) 自身」で行う。ハンドラの戻り方は実 DOS と同じ SP 規律で
 * 判別する (dispatch 入口の g_int23_pending チェック):
 *   - IRET 復帰 (SP が発火前へ完全に戻る) → NOP 踏み直しで中断された INT 21h 呼び出しが
 *     同じレジスタで再開する (実 DOS の「IRET なら DOS 呼び出し再開」契約)。^C は消費済み。
 *   - far RET 復帰 (FLAGS 1 word がスタックに残留、SP が 2 少ない) → CF=1 なら中断・
 *     CF=0 なら残留 FLAGS を捨てて再開。
 * レジスタ保存はハンドラの責務 (実 DOS 同様 — AX 等を壊すハンドラでは再開後の挙動は不定)。 */
static int      g_int23_pending;         /* ユーザーハンドラへ発火中 (復帰規律の判定待ち) */
static uint16_t g_int23_ss, g_int23_sp;  /* 発火直前の SS:SP (= IRET 完全復帰時の値) */

/* ^C 検出時に呼ぶ。呼び出し側は直後に必ず return すること (CPU 状態は書き換え済み)。
 * 検出した 03h は呼び出し側で消費済みであること (再発火ループ防止)。 */
static void int23_raise(void) {
    /* 実 DOS は break 処理時に "^C" + CRLF をエコーする */
    tty_putc('^'); tty_putc('C'); tty_putc(0x0D); tty_putc(0x0A);

    uint16_t off = peek16(0x23u * 4u);
    uint16_t seg = peek16(0x23u * 4u + 2u);

    /* 既定ベクタ (INT 20h トランポリン = プログラム中断) と、防御的に 0:0 (未初期化) は
     * guest を経由せず直接中断する。4Ch と同じく、親復帰 (戻り 1) なら dispatch tail の
     * FLAGS 書き戻しを skip (親スタックを壊さない)。 */
    if ((seg == 0xF000 && off == (uint16_t)(QB_TRAMP_INT20 & 0xFFFF)) ||
        (seg == 0 && off == 0)) {
        fprintf(stderr, "[int23h] ^C → 既定ハンドラ = プログラム中断\n");
        if (qb_dos_signal_exit2(0, 1)) g_int21_repoll = 1;
        return;
    }

    /* ユーザーハンドラへ INT フレームを積んで発火。push する FLAGS は IF=1 にする
     * (IRET 再開後の入力待ちがキーボード IRQ を受けられるように — dos_getch_block と同じ理由)。 */
    uint16_t pushed = (uint16_t)(CPU_FLAG | I_FLAG);
    CPU_SP = (uint16_t)(CPU_SP - 2); poke16(lin(CPU_SS, CPU_SP), pushed);
    CPU_SP = (uint16_t)(CPU_SP - 2); poke16(lin(CPU_SS, CPU_SP), 0xF000);
    CPU_SP = (uint16_t)(CPU_SP - 2); poke16(lin(CPU_SS, CPU_SP), (uint16_t)(QB_TRAMP_INT21 & 0xFFFF));
    g_int23_pending = 1;
    g_int23_ss = CPU_SS;
    g_int23_sp = (uint16_t)(CPU_SP + 6);              /* IRET 完全復帰時の SP */
    CPU_FLAG &= (uint16_t)~I_FLAG;                    /* 実 INT と同じくハンドラは IF=0 で開始 */
    CPU_CS = seg;
    CPU_IP = off;
    g_int21_repoll = 1;   /* dispatch tail の FLAGS 書き戻しを skip (スタック頂は INT 23h フレーム) */
    fprintf(stderr, "[int23h] ^C → ユーザーハンドラ %04X:%04X\n", (unsigned)seg, (unsigned)off);
}

/* blocking 入力の共通部。文字があれば 0-255 を返す。無ければ NP2kai 流に
 * CPU_IP を NOP に巻き戻し IRQ 処理へ譲って (bios18.c AH=00h と同手法) -1 を返す。
 * 呼び出し側は -1 のとき AL を設定せず即 return すること。 */
static int dos_getch_block(void) {
    int w = dos_next_input_byte();
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

static void int21_01_getch_echo(void) {        /* 文字入力 (echo あり)。^C は INT 23h 発火 */
    int c = dos_getch_block();
    if (c < 0) return;
    if (c == 0x03) { int23_raise(); return; }
    CPU_AL = (uint8_t)c;
    tty_putc((uint8_t)c);
}

static void int21_07_getch_raw(void) {         /* 文字入力 (echo 無し・Ctrl-C 無視 = 実 DOS 契約) */
    int c = dos_getch_block();
    if (c < 0) return;
    CPU_AL = (uint8_t)c;
}

static void int21_08_getch_noecho(void) {      /* 文字入力 (echo 無し)。^C は INT 23h 発火 (07h との差) */
    int c = dos_getch_block();
    if (c < 0) return;
    if (c == 0x03) { int23_raise(); return; }
    CPU_AL = (uint8_t)c;
}

static void int21_0b_instat(void) {            /* 入力状態 (非ブロッキング kbhit) */
    /* 実 DOS は状態問い合わせでも次の文字が ^C なら消費して INT 23h を発火する。
     * コンソール入力を 0Bh ポーリングで待つプログラムを ^C で中断できる本流の経路。 */
    if (kb_peek_char() == 0x03) { (void)dos_next_input_byte(); int23_raise(); return; }
    CPU_AL = kb_available() ? 0xFF : 0x00;
}

/* 行バッファ末尾 1 文字のバイト長 (1=ANK / 2=SJIS 全角) を行頭からのパリティ走査で確定する。
 * 末尾近傍のバイト値だけでは判定できない: SJIS トレイル (0x40-0xFC) はリード範囲 (0x81-0x9F/
 * 0xE0-0xFC) と重なるため、「トレイルがリード値になる漢字 (例: 画 = 89 E6) + ANK」の直後の
 * BS が 2 バイト消しに誤爆して孤立リードバイトが残る。走査は O(行長) だが BS 打鍵時のみ。 */
static uint16_t line_last_char_len(const uint8_t *line, uint16_t len) {
    uint16_t i = 0, last = 0;
    while (i < len) {
        last = i;
        i = (uint16_t)(i + ((sjis_is_lead(line[i]) && (uint16_t)(i + 1) < len) ? 2 : 1));
    }
    return (uint16_t)(len - last);
}

/* AH=0Ah 行バッファ入力。DS:DX → [0]=最大文字数(CR 含む) [1]=実数(出力) [2..]=本体。
 * CR (0x0D) で確定、BS (0x08) で 1 文字消去 (SJIS 全角は 2 バイトごと)。1 文字も無ければ
 * 再ポーリング。進捗は g_la_* に保持し、再ポーリング跨ぎで継続する。 */
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
        if (ch == 0x03) {                      /* ^C → INT 23h (組み立て中の行は g_la_* が保持) */
            g_la_len = len;
            int23_raise();
            return;
        }
        if (ch == 0x00) continue;              /* 拡張キー (矢印/Fn 等): NUL を行に書かない */
        if (ch == 0x0D) {                      /* 確定 */
            poke8(buf + 2 + len, 0x0D);
            poke8(buf + 1, len);
            /* 実 DOS の AH=0Ah は Enter を CR のみエコーする (カーソルは同じ行の桁 0 へ。
             * LF はプログラム側が出す規約)。CR+LF を出すと自前で LF を出すソフトが
             * 1 行余分に進む。3Fh handle 0 の cooked 行入力は別契約 (行+CR LF、np21w
             * 突合済) なのでここだけ CR 単独。docs/dos_hle_gaps.md §4-2-10。 */
            tty_putc(0x0D);
            g_la_active = 0;
            return;
        }
        if (ch == 0x08) {                      /* バックスペース (SJIS 全角は文字境界ごと 2 バイト消す) */
            if (len > 0) {
                uint16_t del = line_last_char_len(mem + buf + 2, len);
                len = (uint8_t)(len - del);
                for (uint16_t k = 0; k < del; k++) { tty_putc(0x08); tty_putc(0x20); tty_putc(0x08); }
            }
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
    CPU_AL = 0x24;   /* 実 DOS は AL='$' を返す (PC98RET PAGE3 で確認) */
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
    /* g_qb_y2k_clamp (bridge.c・既定 ON) で実行時オフ可 (qbDebug.y2k(0))。off なら本当の年を返す。 */
    extern int g_qb_y2k_clamp;
    if (g_qb_y2k_clamp && year >= 2000) year = 1999;
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

/* AH=38h Get Country Info (AL=0 現在国 / DX=FFFF は Set)。日本 (country 81) の実 DOS 値を返す。
 * QuickBASIC (日本語版) ランタイムは起動時にこれを呼び、失敗 (CF=1) するとコンソール初期化の
 * 後続 (画面サイズ変数の設定) が中断され、以後の LOCATE が全て「引数が許される範囲では
 * ありません (ERR=5)」になる (maze-776 で実証、QB 製アプリ全般に効く systemic)。
 * バッファは DOS 3.x+ の 34 バイト形式。case-map ルーチンは far RET スタブ (QB_TRAMP_FARRET)
 * を指す = 呼ばれても無変換で戻る (SJIS 環境の実用上 no-op で十分)。 */
static void int21_38_country(void) {
    if ((uint16_t)CPU_DX == 0xFFFF) {           /* Set country */
        uint16_t code = (CPU_AL == 0xFF) ? (uint16_t)CPU_BX : (uint16_t)CPU_AL;
        if (code == 0 || code == 81) { CPU_FLAG &= ~C_FLAG; return; }  /* 日本のまま = no-op 成功 */
        CPU_AX = 2;                             /* それ以外は正直に失敗 (invalid country) */
        CPU_FLAG |= C_FLAG;
        return;
    }
    uint32_t p = lin(CPU_DS, CPU_DX);
    poke16(p + 0x00, 2);                        /* 日付書式 2 = YMD (日本) */
    poke8(p + 0x02, 0x5C);                      /* 通貨記号 "\" (PC-98 では ¥) ASCIIZ 5 bytes */
    poke8(p + 0x03, 0); poke8(p + 0x04, 0); poke8(p + 0x05, 0); poke8(p + 0x06, 0);
    poke8(p + 0x07, ','); poke8(p + 0x08, 0);   /* 千区切り */
    poke8(p + 0x09, '.'); poke8(p + 0x0A, 0);   /* 小数点 */
    poke8(p + 0x0B, '-'); poke8(p + 0x0C, 0);   /* 日付区切り */
    poke8(p + 0x0D, ':'); poke8(p + 0x0E, 0);   /* 時刻区切り */
    poke8(p + 0x0F, 0);                         /* 通貨書式 = 記号が前・空白なし */
    poke8(p + 0x10, 0);                         /* 通貨小数桁 = 0 (円) */
    poke8(p + 0x11, 1);                         /* 時刻書式 bit0=1 = 24 時間制 */
    poke16(p + 0x12, (uint16_t)(QB_TRAMP_FARRET & 0xFFFF));   /* case-map far ptr (F000:EED0) */
    poke16(p + 0x14, 0xF000);
    poke8(p + 0x16, ','); poke8(p + 0x17, 0);   /* データリスト区切り */
    for (int i = 0x18; i < 0x22; i++) poke8(p + i, 0);        /* 予約 */
    CPU_BX = 81;                                /* country code 81 = 日本 */
    CPU_AX = 81;
    CPU_FLAG &= ~C_FLAG;
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
    /* ディレクトリは実 DOS 同様 open できない (error 5 = access denied)。
     * MEMFS の fopen はディレクトリでも成功してしまうので先に弾く。空のファイル名も
     * ここに落ちる (host がディレクトリ自身に解決される)。偽の成功を返すと、呼び手が
     * seek end のサイズで確保を試みる等の遠隔誤動作になる (MIMPI 引数なしの
     * "Out of memory !" が実例)。 */
    {
        struct stat sb;
        if (fs_stat(host, &sb) == 0 && S_ISDIR(sb.st_mode)) {
            fprintf(stderr, "[int21h/open] %s is a directory → error 5 (access denied)\n", host);
            return -5;
        }
    }
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

/* 確定行の持ち越し (g_con_line[g_con_pend_pos..g_con_pend_len)) から min(want, 残り) バイトを
 * dst へ配り、AX=配布数 / CF=0 を立てる。配り切ったら持ち越しを空にする。 */
static void con3f_deliver(uint32_t dst, uint16_t want) {
    uint16_t n = (uint16_t)(g_con_pend_len - g_con_pend_pos);
    if (n > want) n = want;
    for (uint16_t i = 0; i < n; i++) poke8(dst + i, g_con_line[g_con_pend_pos + i]);
    g_con_pend_pos = (uint16_t)(g_con_pend_pos + n);
    if (g_con_pend_pos >= g_con_pend_len) g_con_pend_pos = g_con_pend_len = 0;
    CPU_AX = n;
    CPU_FLAG &= ~C_FLAG;
}

/* AH=3Fh handle 0 (STDIN) = CON の cooked 行入力。実 DOS は CON を行モードで読み、
 * Enter まで待って「行 + CR LF」を返す (np21w: "Hello"+Enter → 48 65 6C 6C 6F 0D 0A、count=7)。
 * CX の大小は待つかどうかに関係しない: **CX=1 でも Enter が押されるまで戻らず** (takapyu 氏
 * 実機指摘 2026-07-02 — 旧実装は CX<2 を 0 バイト即返ししており「入力が無いのに戻る」)、
 * 行が CX より長ければ CX バイトだけ返して残りを持ち越し、次の read が待たずに続きを受け取る
 * (実 DOS の行持ち越し。getchar のような 1 バイト読みは行を 1 バイトずつ配る形になる)。
 * 行編集 (BS、SJIS 全角は 2 バイトごと) とエコーあり (AH=0Ah と同じ cooked 挙動)。
 * これが無いと fh_get(0)=NULL で AX=6 を返し、TurboC の getchar/scanf/gets (= AH=3Fh handle 0)
 * が全滅する (SimK 氏「stdin がおかしい」の真因)。IOCTL AX=4401h で bit5 を立てると raw
 * (binary) モード = エコー無し・行編集無し・CR LF 変換無しで CX バイトそろい次第返る
 * (g_con_raw、takapyu 氏 RAWMODE.COM で検証)。 */
static void int21_3f_read_stdin(uint32_t dst, uint16_t want) {
    if (want == 0) { CPU_AX = 0; CPU_FLAG &= ~C_FLAG; return; }

    /* 前の行の読み残しがあれば待たずにそこから配る (raw へ切替済みでも確定済みバイトは失わない) */
    if (g_con_pend_pos < g_con_pend_len) { con3f_deliver(dst, want); return; }

    if (g_con_raw) {
        /* raw (binary) モード: エコー無し・行編集無し・CR LF 変換無し。CX バイトそろうまで
         * ブロックする (1 バイト読みは各キーで即返る)。受領数は g_con_len で再ポーリング跨ぎ。 */
        if (!g_con_building) { g_con_building = 1; g_con_len = 0; }
        for (;;) {
            int w = kb_get_word();
            if (w < 0) {                       /* 入力待ち → 再ポーリング */
                CPU_FLAG |= I_FLAG;
                CPU_IP--; CPU_REMCLOCK = -1; g_int21_repoll = 1;
                return;
            }
            uint8_t ch = (uint8_t)(w & 0xFF);
            if (ch == 0x00) continue;          /* 拡張キー: 文字バイト無し (cooked と同じ扱い) */
            poke8(dst + g_con_len, ch);
            g_con_len++;
            if (g_con_len >= want) {
                g_con_building = 0;
                CPU_AX = g_con_len;
                g_con_len = 0;
                CPU_FLAG &= ~C_FLAG;
                return;
            }
        }
    }

    if (!g_con_building) { g_con_building = 1; g_con_len = 0; }
    for (;;) {
        int w = kb_get_word();
        if (w < 0) {                           /* 入力待ち → 再ポーリング (AH=0Ah と同手法) */
            CPU_FLAG |= I_FLAG;
            CPU_IP--; CPU_REMCLOCK = -1; g_int21_repoll = 1;
            return;
        }
        uint8_t ch = (uint8_t)(w & 0xFF);
        if (ch == 0x00) continue;              /* 拡張キー (矢印/Fn 等): cooked モードでは無視 */
        if (ch == 0x03) {                      /* ^C → INT 23h (組み立て中の行は g_con_* が保持)。
                                                * raw モードはこの経路に来ない (上で分岐済) = 実 DOS 契約 */
            int23_raise();
            return;
        }
        if (ch == 0x0D) {                      /* Enter: CR LF を付けて行確定 → 持ち越しから配る */
            g_con_line[g_con_len++] = 0x0D;
            g_con_line[g_con_len++] = 0x0A;
            tty_putc(0x0D); tty_putc(0x0A);
            g_con_building = 0;
            g_con_pend_len = g_con_len;
            g_con_pend_pos = 0;
            g_con_len = 0;
            con3f_deliver(dst, want);
            return;
        }
        if (ch == 0x08) {                      /* BS 行編集 (SJIS 全角は文字境界ごと 2 バイト消す) */
            if (g_con_len > 0) {
                uint16_t del = line_last_char_len(g_con_line, g_con_len);
                g_con_len = (uint16_t)(g_con_len - del);
                for (uint16_t k = 0; k < del; k++) { tty_putc(0x08); tty_putc(0x20); tty_putc(0x08); }
            }
            continue;
        }
        if ((uint16_t)(g_con_len + 2) < (uint16_t)sizeof(g_con_line)) {
            g_con_line[g_con_len++] = ch;      /* CR LF 分を残す (満杯は実 DOS 同様だまって無視) */
            tty_putc(ch);                      /* echo (cooked) */
        }
    }
}

static void int21_3f_read(void) {
    int h = (int)CPU_BX;
    if (h == 0) {                              /* STDIN = CON cooked 行入力 (AH=40h が h=1/2 を tty へ
                                                * 分岐するのと対称。これが無いと AX=6 で getchar 等が全滅) */
        int21_3f_read_stdin(lin(CPU_DS, CPU_DX), CPU_CX);
        return;
    }
    FILE *fp = fh_get(h);
    if (!fp) { CPU_AX = 6; CPU_FLAG |= C_FLAG; return; }
    if (g_fh[h].neg_pos < 0) { CPU_AX = 5; CPU_FLAG |= C_FLAG; return; }  /* 負位置 (AH=42h 参照) */
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
    if (g_fh[h].neg_pos < 0) { CPU_AX = 5; CPU_FLAG |= C_FLAG; return; }  /* 負位置 (AH=42h 参照) */
    /* read-only open (AH=3Dh AL=0 → "rb") への write は実 DOS 同様 error 5 (access denied)。
     * 旧実装は fwrite が 0 を返して「0 バイト書けた・成功 (CF=0)」になり、CF しか見ない
     * ソフトが書けたと誤認して進んでいた。CX=0 の truncate も書き込み操作なので同罪
     * (従来は ftruncate の EINVAL 頼み)。docs/dos_hle_gaps.md §4-1-3。 */
    if (strcmp(g_fh[h].mode, "rb") == 0) { CPU_AX = 5; CPU_FLAG |= C_FLAG; return; }
    if (want == 0) {
        /* CX=0 は「現在位置でファイルを切り詰め/延長」(実 DOS 契約)。seek→write(0byte) で
         * セーブを短く書き直す定石。未対応だと旧データの尻尾が残り固定長パースが壊れる。
         * read-only ("rb") ハンドルは ftruncate が EINVAL → 実 DOS 同様 error 5。 */
        fflush(fp);
        long pos = ftell(fp);
        if (pos < 0 || ftruncate(fileno(fp), pos) != 0) {
            CPU_AX = 5;
            CPU_FLAG |= C_FLAG;
            return;
        }
        CPU_AX = 0;
        CPU_FLAG &= ~C_FLAG;
        return;
    }
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
    int st = dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    if (st != 0 || fs_unlink(host) != 0) {
        fprintf(stderr, "[int21h/41] unlink(%s) failed (st=%d)\n", host, st);
        /* 実 DOS の出し分け (open/create 系と同じ st 基準): 途中ディレクトリ欠 = 3
         * (path not found) / 親はあるがファイル無し = 2 (file not found) / 実在する
         * のに消せない (ディレクトリ等) = 5 (access denied)。旧実装は一律 AX=2 で
         * open/create 側と不整合だった。docs/dos_hle_gaps.md §4-1-4。 */
        CPU_AX = (st == 2) ? 3 : (st == 1) ? 2 : 5;
        CPU_FLAG |= C_FLAG;
        return;
    }
    CPU_FLAG &= ~C_FLAG;
}

static void int21_42_seek(void) {
    int h = (int)CPU_BX;
    FILE *fp = fh_get(h);
    if (!fp) { CPU_AX = 6; CPU_FLAG |= C_FLAG; return; }
    /* CX:DX は符号付き 32-bit (DOS 標準) */
    int32_t off = (int32_t)(((uint32_t)CPU_CX << 16) | CPU_DX);
    int32_t target;
    switch (CPU_AL) {
    case 0:
        target = off;
        break;
    case 1: {
        long cur = (g_fh[h].neg_pos < 0) ? (long)g_fh[h].neg_pos : ftell(fp);
        target = (int32_t)(cur + off);
        break;
    }
    case 2: {
        fseek(fp, 0, SEEK_END);
        target = (int32_t)(ftell(fp) + off);
        break;
    }
    default: CPU_AX = 1; CPU_FLAG |= C_FLAG; return;
    }
    /* 実 DOS は whence=1/2 で先頭より前へ seek してもエラーにしない — 負の位置を
     * DX:AX で返し、後続の read/write が失敗する (`seek(-N, END)` で末尾フッタを
     * 後読みする定石が、小さいファイルでは seek 成功→read 失敗と流れる)。
     * ホスト FILE* は負位置を持てないので neg_pos に論理位置を記録し、実位置は
     * 先頭へ置く。非負 seek で解除。EOF 超えの SEEK_SET は実 DOS 同様成功する。 */
    if (target < 0) {
        g_fh[h].neg_pos = target;
        fseek(fp, 0, SEEK_SET);
    } else {
        g_fh[h].neg_pos = 0;
        if (fseek(fp, (long)target, SEEK_SET) != 0) { CPU_AX = 1; CPU_FLAG |= C_FLAG; return; }
    }
    CPU_AX = (uint16_t)((uint32_t)target & 0xFFFF);
    CPU_DX = (uint16_t)(((uint32_t)target >> 16) & 0xFFFF);
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
     *   0-2: CON (stdin/stdout/stderr) → 0x80D3 (bit15=char dev, bit6=non-EOF,
     *        bit4=INT29h, bit1=console out, bit0=console in。CON は双方向共有デバイス)
     *   3: stdaux (AUX)  → bit 7
     *   4: stdprn (PRN)  → bit 7
     * 同 .exe (さめがめ) はこの全 5 ハンドルを起動時に IOCTL してチェック。
     * h=3/4 を error 返しすると「実機 DOS 環境ではない」と判定されて、
     * INT 18h AH=0Ch (テキスト面 OFF) 経路を通らなくなる。 */
    int h = (int)CPU_BX;
    switch (CPU_AL) {
    case 0x00:  /* Get Device Info */
        if (h >= 0 && h <= 2) {
            /* CON (stdin/stdout/stderr) は実機 DOS が返す device info 0x80D3 を返す:
             *   bit7=char device, bit1=console output, bit0=console input,
             *   bit4=special (INT 29h 高速出力対応), bit6=非EOF (対話デバイスが生きている)。
             * 旧実装は 0x82 (char + output のみ) で bit0/bit4/bit6 を欠いていた。すると TurboC
             * ランタイムが stdout を「リダイレクト先のファイル」と判定して **full-buffer 化** し、
             * printf→getch 型のプログラム (YY「ある勇者の憂鬱」等、conio の getch=AH=07h は
             * stdio を flush しない) のオープニングが stdio バッファに滞留したまま、最初の入力まで
             * 画面に出ない不具合になっていた (バッファが BUFSIZ に達するか exit 時まで AH=40h が
             * 出ない)。**決め手は bit6 (0x40)**: これが立つと TurboC は stdout を対話コンソール用
             * (行/無バッファ) として扱い、出力が即フラッシュされて入力前にオープニングが表示される。
             * 0x80D3 は実機 CON の正規値なので faithful。検証 tools/dev_info_test.js。
             * bit5 (0x20)=raw/binary モードは AX=4401h で切り替わるので現在値を反映する。 */
            CPU_DX = (uint16_t)(0x80D3 | (g_con_raw ? 0x20 : 0));
        } else if (h == 3 || h == 4) {
            CPU_DX = 0x0080;            /* AUX/PRN: char device のみ */
        } else if (fh_get(h)) {
            CPU_DX = 0x0000;
        } else {
            CPU_AX = 6;
            CPU_FLAG |= C_FLAG;
            return;
        }
        CPU_FLAG &= ~C_FLAG;
        break;
    case 0x01:  /* Set Device Info。CON (h=0-2) は bit5 (0x20)=raw/binary モードを実際に保持し、
                 * AH=3Fh handle 0 の read が cooked (行バッファ+Enter 待ち) / raw (CX バイト
                 * そろい次第・エコー無し) を切り替える (takapyu 氏 RAWMODE.COM で実機検証)。
                 * 実 DOS 同様 DH!=0 はエラー (AX=1)。他ハンドルはモードを保持しないので
                 * no-op 成功 (AL=00 と対で呼ばれるため、失敗にすると逆に回帰する)。 */
        if ((CPU_DX & 0xFF00) != 0) {          /* 実 DOS: DH は 0 でなければならない */
            CPU_AX = 1;
            CPU_FLAG |= C_FLAG;
            return;
        }
        /* AL=00h と同じハンドル検証: 標準デバイス 0-4 と open 済みハンドル以外は
         * AX=6 (invalid handle)。旧実装は未 open/範囲外でも黙って CF=0 成功で、
         * AL=00h が AX=6 を返すのと非対称 = 「正直な失敗」ポリシー違反だった。
         * open 済みファイルハンドルはモードを保持しないので従来どおり no-op 成功
         * (AL=00 と対で呼ばれるため、失敗にすると逆に回帰する)。§4-2-15。 */
        if (h >= 0 && h <= 2) {
            g_con_raw = (int)((CPU_DX >> 5) & 1);
        } else if (!(h == 3 || h == 4 || fh_get(h))) {
            CPU_AX = 6;
            CPU_FLAG |= C_FLAG;
            return;
        }
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
/* 子/overlay イメージをファイルから読む。実 DOS のローダ同様、MZ EXE は「ヘッダ記載の
 * ロードイメージ (header+body) と reloc 表」だけを読み、ファイル末尾の付加データは読まない。
 * PC-98 ソフトは EXE 末尾に演出データを連結する慣用があり (FINALTY finmain.exe = 628KB 中
 * ロード対象は 138KB、自分のファイルを開いて後読みする)、ファイル全長でバッファ上限を
 * 判定すると起動できる EXE まで弾いてしまう。非 MZ (COM) はバッファ上限まで読む
 * (64KB 超 COM は exec_load 側の検証が正直に弾く)。
 * out_file_bytes (NULL 可) には実ファイル全長を返す — SFT の stale エントリは実 DOS 同様
 * 「ファイルの実サイズ」を持つべきで、付加データ連結 EXE では読込量と異なる (stat 失敗 = 0)。
 * 戻り値: 読めたバイト数 (>=0)。-1 = open 失敗、-2 = ロード必要量がバッファ超 (正直失敗)。 */
static long read_child_image(const char *host, uint8_t *buf, size_t bufsz,
                             uint32_t *out_file_bytes) {
    if (out_file_bytes) {
        struct stat cst;
        *out_file_bytes = (fs_stat(host, &cst) == 0 && cst.st_size > 0)
                          ? (uint32_t)cst.st_size : 0;
    }
    FILE *fp = fs_fopen(host, "rb");
    if (!fp) return -1;
    size_t got = fread(buf, 1, 0x1C, fp);
    uint16_t magic = (got >= 2) ? (uint16_t)(buf[0] | ((uint16_t)buf[1] << 8)) : 0;
    size_t want = bufsz;
    if (got >= 0x1C && (magic == 0x5A4D || magic == 0x4D5A)) {
        uint16_t e_cblp   = (uint16_t)(buf[0x02] | ((uint16_t)buf[0x03] << 8));
        uint16_t e_cp     = (uint16_t)(buf[0x04] | ((uint16_t)buf[0x05] << 8));
        uint16_t e_crlc   = (uint16_t)(buf[0x06] | ((uint16_t)buf[0x07] << 8));
        uint16_t e_lfarlc = (uint16_t)(buf[0x18] | ((uint16_t)buf[0x19] << 8));
        size_t image_file = (size_t)e_cp * 512;
        if (e_cblp != 0 && e_cp != 0) image_file -= (512 - e_cblp);
        size_t reloc_end = (size_t)e_lfarlc + (size_t)e_crlc * 4;
        want = (image_file > reloc_end) ? image_file : reloc_end;
        if (want > bufsz) { fclose(fp); return -2; }
        if (want < got) want = got;   /* 壊れヘッダ (e_cp=0 等) は最低限読んで検証側で弾く */
    }
    got += fread(buf + got, 1, want - got, fp);
    fclose(fp);
    return (long)got;
}

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
    long rd = read_child_image(host, ovbuf, sizeof(ovbuf), NULL);
    if (rd == -1) { CPU_AX = 2; CPU_FLAG |= C_FLAG; return; }
    if (rd == -2) {
        fprintf(stderr, "[int21h/4B/03] overlay load image too large (>%zu): %s\n",
                sizeof(ovbuf), host);
        CPU_AX = 8; CPU_FLAG |= C_FLAG;
        return;
    }
    size_t sz = (size_t)rd;

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

/* ---- 合成 COMMAND.COM (COMSPEC /C 専用スタブ) ----
 * 実ファイル A:\COMMAND.COM は置かない方針 (env の COMSPEC は存在チェック対策のみ) のまま、
 * 「COMSPEC /C <cmd>」で子を起動するプログラム (TurboC 系 system() / SimK EXECTEST) を通す。
 * EXEC 先が COMMAND.COM かつ tail が /C の時だけ、約 40byte の COM スタブを合成して通常の
 * exec_load へ流す。実 DOS と同じく中間プロセスが立つ (独自 PSP・親子連鎖・終了コード 0 =
 * 実 COMMAND.COM /C は子の終了コードを破棄する) ので、AH=62h の PSP 連鎖も AH=4Dh も忠実。
 * スタブ: 自己縮小 (AH=4Ah, KEEP=0x40 para) → AX=4B00h で <cmd> を EXEC → AH=4Ch code=0。
 * /C 無し (対話シェル) や <cmd> 解決失敗は従来どおり正直に失敗 (呼び出し側で CF=1 AX=2)。
 * cmdtail は int21_4b_exec が組む先頭スペース込みの C 文字列。成功でスタブ長、負=不成立。 */
static long build_comspec_stub(const char *cmdtail, uint8_t *out, size_t cap) {
    const char *p = cmdtail;
    while (*p == ' ' || *p == '\t') p++;
    if (p[0] != '/' || (p[1] != 'C' && p[1] != 'c')) return -1;
    p += 2;
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '\0') return -1;
    char prog[160];
    size_t pl = 0;
    while (*p && *p != ' ' && *p != '\t' && pl + 1 < sizeof(prog)) prog[pl++] = *p++;
    prog[pl] = '\0';
    if (*p == ' ') p++;                          /* 引数との区切り 1 個 (残りは生のまま渡す) */
    const char *args = p;

    /* <prog> を解決。拡張子無しなら実 COMMAND.COM 同様 .COM → .EXE を補完して実在を探す
     * (.BAT と内部コマンドはスタブの射程外 = 不成立で正直に失敗)。 */
    const char *leaf = strrchr(prog, '\\');
    leaf = leaf ? leaf + 1 : prog;
    int has_ext = (strchr(leaf, '.') != NULL);
    char cand[172], rel[192], host[256];
    int found = 0;
    for (int i = has_ext ? 0 : 1; i < (has_ext ? 1 : 3); i++) {
        static const char *sfx[3] = { "", ".COM", ".EXE" };
        snprintf(cand, sizeof(cand), "%s%s", prog, sfx[i]);
        cstr_dos_rel(cand, rel, sizeof(rel));
        if (dos_rel_to_host(rel, host, sizeof(host)) == 0) { found = 1; break; }
    }
    if (!found) {
        fprintf(stderr, "[int21h/4B] COMSPEC /C コマンド不在: \"%s\"\n", prog);
        return -2;
    }

    static const uint8_t code[] = {
        0xFA,                   /* cli */
        0xBC, 0xFE, 0x03,       /* mov sp,03FEh (スタックを KEEP 内へ退避) */
        0xFB,                   /* sti */
        0xB4, 0x4A,             /* mov ah,4Ah */
        0xBB, 0x40, 0x00,       /* mov bx,0040h (KEEP=1KB: PSP+コード+スタック) */
        0xCD, 0x21,             /* int 21h (COM エントリの ES=PSP で自己縮小) */
        0x8C, 0xC8,             /* mov ax,cs */
        0xA3, 0x00, 0x00,       /* mov [pb+4],ax — tail far ptr の segment (実行時充填) */
        0xB8, 0x00, 0x4B,       /* mov ax,4B00h */
        0xBA, 0x00, 0x00,       /* mov dx,path */
        0xBB, 0x00, 0x00,       /* mov bx,pb */
        0xCD, 0x21,             /* int 21h (EXEC <cmd>) */
        0xB8, 0x00, 0x4C,       /* mov ax,4C00h */
        0xCD, 0x21,             /* int 21h */
    };
    size_t pb    = sizeof(code);                 /* パラメータブロック 14B: env=0/tail ptr/FCB×2 */
    size_t path  = pb + 14;
    size_t plen  = strlen(cand);
    size_t tail  = path + plen + 1;
    size_t alen  = strlen(args);
    if (alen > 126) alen = 126;
    size_t total = tail + 1 + alen + 1;
    if (total > cap || 0x100 + total > 0x3E0) return -3;   /* KEEP 内・スタック手前に収める */
    memset(out, 0, total);
    memcpy(out, code, sizeof(code));
    uint16_t pb_off = (uint16_t)(0x100 + pb), path_off = (uint16_t)(0x100 + path);
    uint16_t tail_off = (uint16_t)(0x100 + tail);
    out[15] = (uint8_t)(pb_off + 4); out[16] = (uint8_t)((pb_off + 4) >> 8);
    out[21] = (uint8_t)path_off;     out[22] = (uint8_t)(path_off >> 8);
    out[24] = (uint8_t)pb_off;       out[25] = (uint8_t)(pb_off >> 8);
    out[pb + 2] = (uint8_t)tail_off; out[pb + 3] = (uint8_t)(tail_off >> 8);
    /* env=0 (継承→build_child_env が argv[0] を <cmd> に正規化)、FCB ptr=null (tail から parse) */
    memcpy(out + path, cand, plen);              /* ASCIZ (memset 済で終端 0) */
    out[tail] = (uint8_t)alen;
    memcpy(out + tail + 1, args, alen);
    out[tail + 1 + alen] = 0x0D;
    return (long)total;
}

static void int21_4b_exec(void) {
    if (CPU_AL == 0x03) { int21_4b_overlay(); return; }   /* Load Overlay */
    int load_only = (CPU_AL == 0x01);     /* AL=01h: load & no-exec (debugger 契約) */
    if (CPU_AL != 0x00 && !load_only) {   /* AL=02/04/05h 等は未対応 (04h は実 DOS も AX=1) */
        fprintf(stderr, "[int21h/4B] unsupported AL=%02X\n", (unsigned)CPU_AL);
        CPU_AX = 1; CPU_FLAG |= C_FLAG;
        return;
    }

    /* パラメータブロック ES:BX:
     *   +0 = env segment (0 なら親 env 継承)
     *   +2 = コマンドテイル far ptr (PSP[0x80] 形式: 長さ 1B + 文字列 + 0x0D)
     * パス解決より先に読む (COMSPEC スタブ合成が cmdtail を必要とするため)。
     * pb_lin は AL=01h の SS:SP/CS:IP 書き戻しでも使う。 */
    uint32_t pb_lin = lin(CPU_ES, CPU_BX);
    uint16_t env_seg;
    uint32_t fcb1_lin = 0, fcb2_lin = 0;
    char cmdtail[128];
    cmdtail[0] = '\0';
    {
        uint32_t pb = pb_lin;
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

    /* 子パス (DS:DX の ASCIZ) を /run 配下に解決し、イメージを読む (MZ はヘッダ記載の
     * ロードイメージ分だけ。末尾付加データは実 DOS 同様に読まない — read_child_image 参照)。
     * 不在でも EXEC 先が COMMAND.COM で tail が /C なら合成スタブに差し替える (上記コメント)。 */
    char host[256];
    int st = dos_path_to_host(CPU_DS, CPU_DX, host, sizeof(host));
    static uint8_t childbuf[256 * 1024];
    uint32_t file_bytes = 0;
    long rd;
    if (st != 0) {
        const char *hleaf = host;
        for (const char *q = host; *q; q++) if (*q == '/') hleaf = q + 1;
        long sl = -1;
        if (!load_only && ci_ascii_equal(hleaf, "COMMAND.COM"))
            sl = build_comspec_stub(cmdtail, childbuf, sizeof(childbuf));
        if (sl <= 0) {
            fprintf(stderr, "[int21h/4B] child not found (path-status %d): %s\n", st, host);
            CPU_AX = 2; CPU_FLAG |= C_FLAG;   /* file not found */
            return;
        }
        fprintf(stderr, "[int21h/4B] COMSPEC /C → 合成 COMMAND.COM スタブ %ld bytes (tail=\"%s\")\n",
                sl, cmdtail);
        rd = sl;
        file_bytes = (uint32_t)sl;
    } else {
        rd = read_child_image(host, childbuf, sizeof(childbuf), &file_bytes);
    }
    if (rd == -1) { CPU_AX = 2; CPU_FLAG |= C_FLAG; return; }
    if (rd == -2) {
        fprintf(stderr, "[int21h/4B] child load image too large (>%zu) — 正直に失敗: %s\n",
                sizeof(childbuf), host);
        CPU_AX = 8;   /* insufficient memory 相当 */
        CPU_FLAG |= C_FLAG;
        return;
    }
    size_t sz = (size_t)rd;
    if (sz < 2) { CPU_AX = 0x0B; CPU_FLAG |= C_FLAG; return; }

    const char *base = host;
    for (const char *q = host; *q; q++) if (*q == '/' || *q == '\\') base = q + 1;
    /* argv[0] 用の /run 相対パス (サブディレクトリ込み)。read_dos_rel は drive 除去・cwd 前置・
     * 先頭 '\' 除去済みの正準形を返す (例: SHELL が EXEC した "\depth\depth.exe" → "depth/depth.exe"、
     * cwd=GAME で相対 "CHILD.EXE" を EXEC → "GAME/CHILD.EXE")。basename だけだと argv[0] が
     * "A:\DEPTH.EXE" になり、argv[0] の最後の '\' でデータディレクトリを切り出すゲーム
     * (Super Depth の depth.exe) がサブディレクトリを見失う (直接起動 build_env と揃える)。
     * base は SFT note 用の basename として別途維持する (qb_dos_sft_note_load は 8.3 名を要求)。 */
    char rel[192];
    read_dos_rel(CPU_DS, CPU_DX, rel, sizeof(rel));
    fprintf(stderr, "[int21h/4B] EXEC child=%s (argv0 rel=%s) size=%zu env=%04X cmdtail=\"%s\" (stage1.5: parent resident)\n",
            base, rel, sz, (unsigned)env_seg, cmdtail);
    if (fcb1_lin)
        fprintf(stderr, "[int21h/4B] fcb1 drv=%d name=\"%.8s\" ext=\"%.3s\"\n",
                (int)peek8(fcb1_lin), (char *)&mem[fcb1_lin + 1], (char *)&mem[fcb1_lin + 9]);

    /* 親常駐のまま子を上にロード (base=basename は SFT note 用、rel=/run 相対フルパスは
     * argv[0] 用)。AL=00h は CPU を子へ切替、AL=01h は init_regs に初期値を受けるだけ。 */
    uint16_t init_regs[4];
    int r = qb_dos_exec_load(childbuf, sz, file_bytes, cmdtail, env_seg, base, rel,
                             fcb1_lin, fcb2_lin, load_only ? init_regs : NULL);
    if (r != 0) {
        fprintf(stderr, "[int21h/4B] exec_load failed r=%d\n", r);
        CPU_AX = (r == -10 || r == -11) ? 8 : 0x0B;   /* -10=メモリ不足/-11=ネスト過多(8), 他=書式不正(11) */
        CPU_FLAG |= C_FLAG;
        return;
    }

    if (load_only) {
        /* AL=01h: パラメータブロックへ子の初期レジスタを書き戻して呼び出し元へ返る
         * (RBIL: +0Eh=SP,+10h=SS,+12h=IP,+14h=CS)。current PSP は exec_load 内で子へ
         * 切替済 (呼び出し元が AH=62h で読み、AH=50h で親へ戻す debugger 契約)。 */
        poke16(pb_lin + 0x0E, init_regs[1]);   /* SP */
        poke16(pb_lin + 0x10, init_regs[0]);   /* SS */
        poke16(pb_lin + 0x12, init_regs[3]);   /* IP */
        poke16(pb_lin + 0x14, init_regs[2]);   /* CS */
        CPU_FLAG &= ~C_FLAG;
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

/* AH=50h Set PSP / AH=51h・62h Get PSP (BX)。62h は 51h の documented 版で同一機能。
 * SimK 氏 EXECTEST で顕在化: 62h 未実装だと BX=0 のまま返り、子が ES=0 (IVT) を自分の
 * PSP と誤読 → 0000:0080 の割り込みベクタ列を command tail として表示し、高ビットの
 * バイト対が SJIS 解釈されて画面が漢字化けする。50h は 4B01h load-only とペアで
 * debugger/TSR が「実行中プロセス」を差し替える契約。 */
static void int21_50_set_psp(void) { qb_dos_set_cur_psp(CPU_BX); CPU_FLAG &= ~C_FLAG; }
static void int21_51_get_psp(void) { CPU_BX = qb_dos_cur_psp(); CPU_FLAG &= ~C_FLAG; }

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

/* DOS パス文字列で論理カレント g_cwd (/run 相対) を変更する。
 * raw_dos = "\iv" / "..\foo" / "A:\bar" 等 (バックスラッシュ・ドライブ接頭可)。
 * '.'/'..' を解決し、実在ディレクトリでなければ path not found(3)。
 * 戻り値 0=成功 / 3=path not found。AH=3Bh CHDIR と .bat の cd が共用する
 * (int21_3b_chdir はこれを DS:DX 経由で呼ぶ / dos_loader.c の batch インタプリタは
 *  cd 文の生パスで呼ぶ)。 */
int qb_dos_chdir(const char *raw_dos) {
    if (!raw_dos) return 3;
    /* ドライブ接頭 "X:" を飛ばし '\' を '/' に直して raw[] へ (DBCS トレイル素通し:
     * read_dos_rel と同じく 0x5C を含む trail を区切り扱いしない)。 */
    const unsigned char *src = (const unsigned char *)raw_dos;
    uint32_t i = (src[0] && src[1] == ':') ? 2u : 0u;
    char raw[256]; size_t n = 0;
    while (src[i] && n + 1 < sizeof(raw)) {
        unsigned char c = src[i++];
        if (sjis_is_lead(c) && src[i] && n + 2 < sizeof(raw)) {
            raw[n++] = (char)c; raw[n++] = (char)src[i++]; continue;
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
    if (!d) return 3;                                     /* path not found */
    closedir(d);

    strncpy(g_cwd, cand, sizeof(g_cwd) - 1);
    g_cwd[sizeof(g_cwd) - 1] = '\0';
    return 0;
}

/* 論理カレントを /run 相対パスで直接設定する (検証なし)。g_cwd と同じ正規形を要求:
 * '/' 区切り・先頭/末尾スラッシュ無し・'' = ルート。loader-start が image のサブ
 * ディレクトリを「ユーザが cd した状態」として仕込むのに使う (dos_int21.h 参照)。 */
void qb_dos_set_cwd_rel(const char *rel) {
    if (!rel || rel[0] == '\0') { g_cwd[0] = '\0'; return; }
    strncpy(g_cwd, rel, sizeof(g_cwd) - 1);
    g_cwd[sizeof(g_cwd) - 1] = '\0';
}

/* AH=3Bh CHDIR。DS:DX = 目標パス (ASCIZ)。生バイトを読んで qb_dos_chdir に委譲する。 */
static void int21_3b_chdir(void) {
    uint32_t base = lin(CPU_DS, CPU_DX);
    char dos[256]; size_t n = 0;
    while (n + 1 < sizeof(dos)) {
        uint8_t c = peek8(base + n);   /* DBCS trail は 0x00 にならないので NUL まで素直に読む */
        if (!c) break;
        dos[n++] = (char)c;
    }
    dos[n] = '\0';
    if (qb_dos_chdir(dos) == 0) { CPU_FLAG &= ~C_FLAG; }
    else                        { CPU_AX = 3; CPU_FLAG |= C_FLAG; }
    fprintf(stderr, "[int21h/3B] chdir \"%s\" → \"%s\"\n", dos, g_cwd);
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

/* AH=0Eh: Select default drive (DL = 0=A: 1=B: …)。AL に論理ドライブ数を返す。
 * 我々は実体として A: (= /run) 単一なのでドライブ切り替えは no-op (g_cwd ベース)。
 * 多くのプログラムは戻り値を使わず「念のため A: を選ぶ」だけ呼ぶ (FMDSP 等)。
 * LASTDRIVE=5 (LoL と整合) に合わせて 5 を返す。この関数は CF を返さない。 */
static void int21_0e_select_disk(void) {
    CPU_AL = 5;   /* number of logical drives (LASTDRIVE) */
}

/* AH=34h: Get InDOS flag address → ES:BX。常駐ドライバ (TSR) が「いま DOS 内部に
 * いない」ことを確認してから常駐/動作するための旗。我々は HLE なので DOS 再入の概念が
 * 無く、常に 0 (= not in DOS) でよい。QB_LOL_SEG の未使用低位域に 0 バイトを置いて返す
 * (直前バイト = critical-error flag も 0 にしておく。InDOS-1 を覗く実装に備える)。
 * FMP/FMDSP 等が install 時に呼ぶ。 */
static void int21_34_indos(void) {
    uint32_t base = (uint32_t)QB_LOL_SEG << 4;   /* linear 0xA00 (env/PSP の手前・未使用) */
    poke8(base + 0x0F, 0);   /* critical error flag (InDOS-1) */
    poke8(base + 0x10, 0);   /* InDOS flag = 0 (not in DOS) */
    CPU_ES = QB_LOL_SEG;
    CPU_BX = 0x0010;
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

    /* INT 23h ユーザーハンドラからの復帰判定 (int23_raise のコメント参照)。SP 規律:
     *   SP == 発火前     → IRET 完全復帰 = そのまま下の通常 dispatch で呼び出し再開。
     *   SP == 発火前 - 2 → far RET 復帰 (FLAGS 残留) = CF=1 なら中断・CF=0 なら残留を捨て再開。
     *   それ以外         → ハンドラ内の入れ子 INT 21h (AH=09h 表示等) = pending 継続で通常処理。 */
    if (g_int23_pending && CPU_SS == g_int23_ss) {
        if (CPU_SP == g_int23_sp) {
            g_int23_pending = 0;               /* IRET 復帰 → 再開 */
        } else if (CPU_SP == (uint16_t)(g_int23_sp - 2)) {
            g_int23_pending = 0;
            CPU_SP = (uint16_t)(CPU_SP + 2);   /* 残留 FLAGS を捨てる */
            if (CPU_FLAG & C_FLAG) {
                fprintf(stderr, "[int23h] ハンドラ far RET CF=1 → プログラム中断\n");
                qb_dos_signal_exit2(0, 1);
                return;   /* CPU はリダイレクト済み (親復帰 or halt)。スタックには触らない */
            }
        }
    }

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
    case 0x0E: int21_0e_select_disk();  break;
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
    case 0x34: int21_34_indos();        break;
    case 0x35: int21_35_get_vec();   break;
    case 0x36: int21_36_freespace();    break;
    case 0x38: int21_38_country();      break;
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
    case 0x50: int21_50_set_psp();   break;
    case 0x51: int21_51_get_psp();   break;
    case 0x52: int21_52_list_of_lists(); break;
    case 0x58: int21_58_alloc_strategy(); break;
    case 0x62: int21_51_get_psp();   break;   /* 62h = 51h の documented 版 */
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
    tty_store_cursor();         /* DOS CON カーソル座標ワーク 0:0710h/071Ch をルート (0,0) に初期化 */
    g_tty_state = TTY_NORMAL;
    g_sjis_lead = 0;
    g_graph_mode = 0;   /* グラフ文字モードは image 起動ごとに漢字モードへ戻す */
    g_csi_nparam = 0;
    g_csi_has_digit = 0;
    g_csi_priv = 0;
    /* DOS CON ワークエリア (0:0711h/0712h/0713h/071Dh) を既定 (fkey 非表示・25 行・
     * 白属性) に。master.lib text_fillca/TEXT_HEIGHT は 0712h を、VZ の check_20 は
     * 0713h を直読みする (未初期化=0 だと全画面 fill が 1 行で切れたり 20 行と誤認)。 */
    g_tty_lines20 = 0;
    g_tty_sysline = 0;
    g_tty_attr = DEF_ATTR;
    /* GDC mode1 bit0 (DEGB = 簡易グラフィックモード) を OFF にする。np2kai POST は既定で
     * これを 1 にする (gdc.mode1=0x99) が、実 PC-98 + 実 MS-DOS はブート時にテキストモードを
     * 整え DEGB=0 になる。maketext は属性 bit 0x10 を DEGB=1 のとき「簡易グラフ (2x4 ブロック)」、
     * DEGB=0 のとき「縦線 (バーチカルライン)」と解釈する (TXTATR_BG と TXTATR_VL の二重定義)。
     * NEC CON の ESC[2m → 縦線属性 (0x10) を実機/np21w 通り縦線で出すには DEGB=0 が必要。
     * 簡易グラフを使うソフトは自分で OUT 0x68 して設定するので (実 MS-DOS 下でも DEGB=0 開始)、
     * ここで 0 へ戻すのは faithful・ゼロ回帰。bit5 (コードアクセス) は vram_put_kanji 側で別途保証。 */
    gdc.mode1 &= (uint8_t)~0x01;
    gdcs.textdisp |= GDCSCRN_ALLDRAW2;   /* 解釈変更を次フレーム全セル再描画へ反映 */
    tty_sync_conarea();
    /* CON ワークエリアの残り既定値 (SimK PC98WORK PAGE1 の実機初期値と一致させる):
     * 0714h=クリア属性 E1 / 0719h=クリア文字 20h / 071Bh=カーソル表示 1 /
     * 0726h/0727h=ESC[s 保存カーソル Y/X / 072Bh=保存属性 E1 /
     * 073Ch・073Eh=DOS 6 世代の word 版 put/clear 属性 (00E1)。live に読むのは古典 byte 側
     * (071Dh/0714h、DOS 3.x 意味論) で、word 側は初期値のみ (実機 dump 互換のため)。 */
    mem[0x714] = DEF_ATTR;
    mem[0x719] = 0x20;
    mem[0x71B] = 0x01;
    mem[0x726] = 0; mem[0x727] = 0;
    mem[0x72B] = DEF_ATTR;
    mem[0x73C] = DEF_ATTR; mem[0x73D] = 0;
    mem[0x73E] = DEF_ATTR; mem[0x73F] = 0;
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
    g_con_building = 0;  /* AH=3Fh STDIN 行入力: 組み立て途中の行を破棄 */
    g_con_len = 0;
    g_con_pend_len = g_con_pend_pos = 0;   /* 確定行の読み残し持ち越しも破棄 */
    g_con_raw = 0;       /* CON raw モードも image ごとに cooked へ戻す */
    g_0c_flushing = 0;   /* AH=0Ch flush ラッチ (再ポーリング途中での中断対策) */
    /* INT DCh キー定義テーブルも Run 毎にクリア (前 image の再定義を持ち越さない) */
    g_keytbl_set = 0;
    memset(g_keytbl, 0, sizeof(g_keytbl));
    g_softkey_len = 0;
    g_softkey_pos = 0;
    g_inject_head = g_inject_tail = 0;   /* ホスト IME 注入 FIFO も Run 毎にクリア (前 Run を持ち越さない) */
    g_int23_pending = 0;                 /* INT 23h 発火中フラグも破棄 (前 Run の復帰判定を持ち越さない) */
}

/* オリジナル PC-98 CRT/キーボード BIOS (NP2kai 合成 BIOS)。30 行モード時のパススルー先。 */
extern void bios0x18(void);

/* INT 18h フロントエンド (トランポリン 0xFEEC0)。30 行モード (qb_lines30_enabled) が ON のとき
 * だけ loader-start が IVT[0x18] をここへ向ける。30BIOS-API (識別子 BX='30'+'行'=0xC0A3 の AH=0Bh、
 * および AX=FFxx) を処理し、それ以外は全てオリジナル bios0x18 へパススルー (= フック無しと等価)。
 * 仕様は docs/30line_spec.md (30BIOS/30TECH.DOC 由来)。OFF 時は IVT を触らないのでこのフックは走らない。 */
int qb_dos_int18_hook(void) {
    uint8_t  ah = CPU_AH;
    uint16_t ax = (uint16_t)CPU_AX;
    uint16_t bx = (uint16_t)CPU_BX;

    /* --- インストールチェック / CRT モード取得 (AH=0Bh, BX=0xC0A3) --- */
    if (ah == 0x0B && bx == 0xC0A3) {
        uint8_t orig = mem[0x53C];               /* オリジナル CRT mode flag (bit3-1 用) */
        uint8_t al = (uint8_t)(0x40             /* bit6 = 30BIOS 常駐 (最重要のインストールチェック) */
                             | 0x10             /* bit4 = 拡張モード */
                             | (orig & 0x0E));  /* bit3-1 = オリジナル BIOS と同じ */
        /* bit7(VGA/Special)=0, bit5(CW/fkey)=0, bit0(行間)=0 (行間なし 30 行)。Phase 1 は Special。 */
        CPU_AL = al;
        /* ES:DI が "30BIOS_EXIST=0" を指すなら '0'→'1' に書換 (Ver0.20+ の厳密チェック) */
        {
            static const char sig[] = "30BIOS_EXIST=";   /* 13 文字 (= NUL 除く) */
            uint16_t es = (uint16_t)CPU_ES, di = (uint16_t)CPU_DI;
            int matched = 1;
            for (int i = 0; i < 13; i++) {
                if (mem[lin(es, (uint16_t)(di + i))] != (uint8_t)sig[i]) { matched = 0; break; }
            }
            if (matched && mem[lin(es, (uint16_t)(di + 13))] == '0')
                mem[lin(es, (uint16_t)(di + 13))] = '1';
        }
        return 1;
    }

    /* --- 30BIOS 独自ファンクション (AX=FFxx)。オリジナル BIOS に FFh は無く素通りするだけなので
     *     AH=0xFF 空間を 30BIOS-API に使ってよい (30TECH.DOC)。 --- */
    if (ah == 0xFF) {
        switch (ax & 0xFF) {                 /* AL = サブファンクション */
        case 0x00:                           /* バージョン取得: AH=小数部, AL=整数部 */
            CPU_AH = 40; CPU_AL = 1;         /* Ver1.40 を僭称 */
            return 1;
        case 0x01: case 0x02:                /* 画面モード PUSH/POP。30 行固定なので no-op 成功 */
            CPU_AX = 0xFFFF;
            return 1;
        case 0x03:                           /* 画面行数 取得/変更 (BL=行数, 00=取得)。Phase 1 は 30 固定 */
            CPU_AL = 29;                     /* 行間なし時の行数 - 1 */
            CPU_AH = 29;                     /* 行間あり時の行数 - 1 */
            return 1;
        case 0x04:                           /* 設定可能行数: AL=上限, AH=下限 */
            CPU_AL = 30; CPU_AH = 30;
            return 1;
        case 0x05:                           /* 行間空き時ラスタ数: AH=行間あり, AL=行間なし(=0x10) */
            CPU_AH = 0x10; CPU_AL = 0x10;
            return 1;
        default:                             /* 未対応 FFxx は no-op (オリジナルも FFh は素通り) */
            return 1;
        }
    }

    /* --- それ以外はオリジナル CRT BIOS へ (キーボード AH=0/1、モード設定等)。= フック無しと等価。 --- */
    bios0x18();
    return 1;
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
