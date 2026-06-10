/* SPDX-License-Identifier: MIT OR GPL-2.0-or-later */
/*
 * Phase 3 ミニマル DOS ローダ — image ステージング + loader-start フック。
 *
 * 設計詳細は TODO.md "Phase 3 Day 1-2 設計" 節を参照。
 *
 * 対応状況:
 *  - COM (org 0x100) / MZ EXE (reloc 適用) の両ローダ
 *  - 環境セグメント (QB_DOS_ENV_SEG) を実機 DOS 互換レイアウトで構築 (build_env)
 *  - INT 21h AH=48h/49h/4Ah 用の MCB チェーン (first-fit + coalesce + 分割)
 *  - AH=4Bh EXEC (親常駐・子をアリーナにロード、子終了で親復帰)。子は MZ EXE / COM 両対応
 *  - AH=31h Keep Process (TSR) — 子を縮小して常駐させ親へ復帰 (Ray の RIN.COM 用)
 *
 * 既知の制限:
 *  - EXEC は AL=00 のみ (overlay AL=03 非対応)、ネストは g_exec_stack の深さまで
 *  - EXE body は 640KB (PC-98 基本メモリ上限) まで
 *  - EXEC 子の env: env_seg=0 (継承) のときは build_child_env で子固有 env を新規確保し
 *    argv[0] を子パスに正規化する (C1)。env_seg!=0 (明示 env) はそのまま使う (exec_load 参照)
 */

#include <compiler.h>
#include <string.h>
#include <stdio.h>

#include <i386c/cpumem.h>
#include <i386c/ia32/cpu.h>

#include "dos_loader.h"
#include "dos_int21.h"
#include "dos_xms.h"          /* XMS (HIMEM 相当) HLE */
#include "qb_guestmem.h"      /* poke8/poke16 等の共有メモリヘルパ (dos_int21.c と一本化) */
#include "dos_shell_blob.h"   /* tools/dos_loader/shell.asm の assemble 済 blob (build.sh 生成) */

/* 直接アクセスする NP2kai のゲスト RAM (linear address indexed) */
extern UINT8 mem[];

/* ステージング状態 (1 image 分のみ保持)。
 * buf は PC-98 基本メモリ上限 (640KB) に合わせる — DOS EXE 1 本が物理的に
 * 取れる最大サイズと一致。Wasm .bss なのでランタイムコストは初期化のみ。 */
static struct {
    qb_dos_image_kind kind;
    uint8_t buf[640 * 1024];
    size_t  size;
    char    cmdline[128];       /* PSP[0x80] 領域に入る最大長 = 127 + 終端 */
    char    name[16];           /* image の basename (大文字、argv[0] 生成用) */
    int     ready;

    /* EXE 専用 (kind == QB_DOS_IMG_EXE のときのみ有効)。
     * MZ ヘッダの値をそのまま保持。CS/SS は image_base_seg を足して使う。 */
    uint16_t exe_cs;
    uint16_t exe_ip;
    uint16_t exe_ss;
    uint16_t exe_sp;
    uint16_t exe_minalloc;      /* MZ e_minalloc: body 以降に最低限必要な paragraphs */
} g_stage;

/* 実行中状態 */
static struct {
    int  running;
    int  exited;
    int  exit_code;
} g_run;

/* ---- AH=4Bh EXEC 段階2: 親コンテキストスタック ----
 * 子を起動するとき親の復帰情報を push し、子の終了 (4Ch/INT20h) で pop して親を復元する。
 * これで「子終了 → 親 (ランチャ) のメニューに戻る」往復が成立する。 */
typedef struct {
    uint16_t ret_cs, ret_ip;   /* 親の戻り先 (INT 21h AH=4Bh の次命令) */
    uint16_t ret_ss, ret_sp;   /* 親スタック (IRET フレーム 6byte を pop した後の SP) */
    uint16_t flags;            /* 親 FLAGS (復元時に CF をクリア = EXEC 成功) */
    uint16_t ax, bx, cx, dx, si, di, bp, ds, es;  /* 親 GP + DS/ES */
    uint16_t psp_seg;          /* 親 PSP (g_cur_psp 復元用) */
    uint16_t dta_seg, dta_off; /* 親 DTA (子は自 PSP:0080 を既定にするので退避/復元) */
    uint32_t fh_mask;          /* EXEC 時点の open 中ユーザハンドル (子終了で差分を閉じる) */
} exec_frame_t;
static exec_frame_t g_exec_stack[8];
static int          g_exec_sp = 0;
static uint8_t      g_last_exit_code = 0;   /* AH=4Dh 用 */
static uint8_t      g_last_exit_type = 0;   /* 0 = 正常終了 */

uint16_t qb_dos_exec_last_code(void) {
    return (uint16_t)(((uint16_t)g_last_exit_type << 8) | g_last_exit_code);
}

/* ================= DOS メモリマネージャ (MCB チェーン) =================
 * 実 DOS に忠実な Memory Control Block チェーンをゲストメモリに実体として置く。
 * 各ブロックは先頭 1 段落に MCB を持ち、使用可能領域はその次の段落から:
 *   MCB +0: 'M'(0x4D)=後続あり / 'Z'(0x5A)=最終ブロック
 *       +1: 所有者 PSP (WORD, 0x0000 = 空き)
 *       +3: サイズ (段落数, WORD)
 * AH=48h は MCB+1 を返す。チェーンは先頭 MCB (g_first_mcb = env ブロックの MCB、ENV_SEG-1)
 * から 0xA000 までを連続して覆う: env ブロック (owner=最上位PSP) → プログラム本体ブロック
 * (owner=PSP、PSP 0x0100〜アリーナ起点) → 空きアリーナ。実 DOS と同じく env・プログラム本体も
 * 実 MCB として鎖に入れるので、AH=4Ah resize / AH=49h free / AH=52h 先頭 MCB が忠実に動く。
 * EXEC の子・48h ヒープ・子終了時の一括解放もこのチェーンで管理する。 */
#define QB_DOS_MEM_TOP_SEG 0xA000u
#define QB_MCB_M 0x4Du
#define QB_MCB_Z 0x5Au

static uint16_t g_first_mcb = QB_DOS_MEM_TOP_SEG;   /* チェーン先頭 MCB (= env ブロックの MCB) */

/* AH=58h メモリ確保ストラテジ (下位 2 ビットのみ使用): 0=first-fit / 1=best-fit / 2=last-fit。
 * 多くの PC-98 ゲームは「last-fit に切替→大バッファを上端確保→first-fit に戻す」慣用で、
 * 本体直上の低位メモリを空けたまま PSP ブロックをそこへ拡大する。loader-start で 0 に戻す。 */
static uint16_t g_alloc_strategy = 0;
void     qb_dos_set_alloc_strategy(uint16_t strat) { g_alloc_strategy = strat; }
uint16_t qb_dos_get_alloc_strategy(void)           { return g_alloc_strategy; }

/* 最上位プログラムが PSP ブロック (0x0100) の self-shrink を済ませたか。
 * 初回の self-shrink だけアリーナを (再) 初期化し、2 回目以降は保守的に成功扱いに
 * して既存 48h 確保ブロックを巻き込んで消さないようにする。loader-start で 0 に戻す。 */
static int g_prog_shrunk = 0;

/* 現在実行中プロセスの PSP segment。最上位プログラム = QB_DOS_LOAD_SEG (0x0100)、
 * EXEC した子プロセス = アリーナ内のブロック。48h の所有者印字に使う。 */
static uint16_t g_cur_psp = QB_DOS_LOAD_SEG;
uint16_t qb_dos_cur_psp(void) { return g_cur_psp; }

/* ---- MCB フィールドアクセス ---- */
static uint8_t  mcb_sig(uint16_t s)   { return mem[(uint32_t)s << 4]; }
static uint16_t mcb_owner(uint16_t s) { uint32_t a = (uint32_t)s << 4; return (uint16_t)(mem[a+1] | (mem[a+2] << 8)); }
static uint16_t mcb_size(uint16_t s)  { uint32_t a = (uint32_t)s << 4; return (uint16_t)(mem[a+3] | (mem[a+4] << 8)); }
static void mcb_set(uint16_t s, uint8_t sig, uint16_t owner, uint16_t size) {
    uint32_t a = (uint32_t)s << 4;
    mem[a]   = sig;
    mem[a+1] = (uint8_t)(owner & 0xFF); mem[a+2] = (uint8_t)(owner >> 8);
    mem[a+3] = (uint8_t)(size  & 0xFF); mem[a+4] = (uint8_t)(size  >> 8);
}
static int mcb_valid(uint16_t s) { uint8_t g = mcb_sig(s); return (g == QB_MCB_M || g == QB_MCB_Z); }

/* 隣接する空きブロックを結合する。 */
static void mcb_coalesce(void) {
    uint16_t s = g_first_mcb;
    while (s < QB_DOS_MEM_TOP_SEG && mcb_valid(s)) {
        if (mcb_sig(s) == QB_MCB_Z) break;
        uint16_t nxt = (uint16_t)(s + 1 + mcb_size(s));
        if (nxt >= QB_DOS_MEM_TOP_SEG || !mcb_valid(nxt)) break;
        if (mcb_owner(s) == 0 && mcb_owner(nxt) == 0) {
            /* nxt を s に取り込む。s は nxt の sig (M/Z) を継ぐ。 */
            uint16_t ns = (uint16_t)(mcb_size(s) + 1 + mcb_size(nxt));
            mcb_set(s, mcb_sig(nxt), 0x0000, ns);
            /* s のまま再ループ (さらに後続の空きと結合できる) */
        } else {
            s = nxt;
        }
    }
}

/* チェーンを「env → プログラム本体 → 空きアリーナ」の 3 ブロックで (再) 初期化する。
 * 最上位プログラムの初回 4Ah self-shrink / loader-start から呼ぶ (まだ 48h 確保が無い段階で
 * 呼ぶ前提)。env・プログラム本体も実 MCB として鎖に入れるので、以後はそれらの resize/free が
 * 通常の MCB 経路で忠実に動く。
 *   arena_base_para = 空きアリーナの起点 (= プログラム本体の末尾 = PSP + プログラムサイズ)。 */
void qb_dos_alloc_reset(uint16_t arena_base_para) {
    if (arena_base_para >= QB_DOS_MEM_TOP_SEG)  arena_base_para = (uint16_t)(QB_DOS_MEM_TOP_SEG - 1);
    if (arena_base_para <= QB_DOS_LOAD_SEG)     arena_base_para = (uint16_t)(QB_DOS_LOAD_SEG + 1);
    g_first_mcb = (uint16_t)(QB_DOS_ENV_SEG - 1);   /* チェーン先頭 = env ブロックの MCB */

    /* env ブロック: MCB@ENV_SEG-1, owner=最上位PSP, data=[ENV_SEG, LOAD_SEG-1)。
     * size = (LOAD_SEG-1) - ENV_SEG なので次の MCB がちょうど LOAD_SEG-1 (プログラム MCB) に来る。 */
    mcb_set((uint16_t)(QB_DOS_ENV_SEG - 1), QB_MCB_M, QB_DOS_LOAD_SEG,
            (uint16_t)(QB_DOS_LOAD_SEG - 1 - QB_DOS_ENV_SEG));
    /* プログラム本体ブロック: MCB@LOAD_SEG-1, owner=PSP, data=[LOAD_SEG, arena_base)。 */
    mcb_set((uint16_t)(QB_DOS_LOAD_SEG - 1), QB_MCB_M, QB_DOS_LOAD_SEG,
            (uint16_t)(arena_base_para - QB_DOS_LOAD_SEG));
    /* 空きアリーナ: 最終 Z ブロック。 */
    mcb_set(arena_base_para, QB_MCB_Z, 0x0000, (uint16_t)(QB_DOS_MEM_TOP_SEG - arena_base_para - 1));
}

/* INT 21h AH=52h (Get List of Lists) 用: MCB チェーンの先頭セグメント (= env ブロックの MCB) を返す。
 * 実 DOS の「先頭 MCB」相当。master.lib 系はこれを辿って利用可能メモリを算定する。 */
uint16_t qb_dos_first_mcb_seg(void) {
    return g_first_mcb;
}

/* AH=48h: first-fit で空きブロックを確保。大きければ分割。所有者 = g_cur_psp。
 * 戻り 0 = OK (out_seg)、-1 = 不足 (out_largest_free に最大空きサイズ)。 */
int qb_dos_alloc_request(uint16_t paragraphs, uint16_t *out_seg, uint16_t *out_largest_free) {
    mcb_coalesce();
    /* ストラテジ (下位 2 ビット) に従い候補ブロックを選ぶ。
     *   0 first-fit: 最初に収まる空き / 1 best-fit: 収まる最小空き / 2 last-fit: 収まる最上位空き。
     * 上位ビット (UMB) は無視。 */
    uint16_t fit = (uint16_t)(g_alloc_strategy & 0x03);
    uint16_t largest = 0;
    uint16_t pick = 0;            /* 選んだブロックの MCB seg (0 = 未発見) */
    uint16_t picksz = 0;
    uint16_t s = g_first_mcb;
    while (s < QB_DOS_MEM_TOP_SEG && mcb_valid(s)) {
        uint8_t  sig = mcb_sig(s);
        uint16_t sz  = mcb_size(s);
        if (mcb_owner(s) == 0) {
            if (sz > largest) largest = sz;
            if (sz >= paragraphs) {
                int take;
                if (!pick)               take = 1;                 /* 最初の候補 */
                else if (fit == 1)       take = (sz < picksz);      /* best: より小さい */
                else if (fit == 2)       take = 1;                  /* last: 後勝ち (より上位) */
                else                     take = 0;                  /* first: 先勝ちで確定 */
                if (take) { pick = s; picksz = sz; }
                if (fit == 0) break;     /* first-fit は最初の収まるブロックで打ち切り */
            }
        }
        if (sig == QB_MCB_Z) break;
        s = (uint16_t)(s + 1 + sz);
    }
    if (!pick) { if (out_largest_free) *out_largest_free = largest; return -1; }

    uint8_t  sig = mcb_sig(pick);
    if (picksz == paragraphs) {
        mcb_set(pick, sig, g_cur_psp, picksz);                  /* ぴったり: 丸ごと確保 */
        if (out_seg) *out_seg = (uint16_t)(pick + 1);
    } else if (fit == 2) {
        /* last-fit: ブロックの「上端」を確保し、下側を空きとして残す (低位を空けておく)。 */
        uint16_t lower = (uint16_t)(picksz - paragraphs - 1);   /* 下側空きの size */
        uint16_t au    = (uint16_t)(pick + 1 + lower);          /* 確保ブロックの MCB seg */
        mcb_set(pick, QB_MCB_M, 0x0000, lower);                 /* 下側: 空き (後続あり → M) */
        mcb_set(au,   sig,      g_cur_psp, paragraphs);         /* 上側: 確保 (sig は元を継承) */
        if (out_seg) *out_seg = (uint16_t)(au + 1);
    } else {
        /* first/best-fit: ブロックの「下端」を確保し、残りを上側の空きに分割。 */
        uint16_t tail = (uint16_t)(pick + 1 + paragraphs);
        mcb_set(tail, sig, 0x0000, (uint16_t)(picksz - paragraphs - 1));
        mcb_set(pick, QB_MCB_M, g_cur_psp, paragraphs);
        if (out_seg) *out_seg = (uint16_t)(pick + 1);
    }
    return 0;
}

/* AH=49h: ES-1 の MCB を空きにする。 */
int qb_dos_alloc_free(uint16_t seg) {
    uint16_t mcb = (uint16_t)(seg - 1);
    if (!mcb_valid(mcb)) return -1;
    mcb_set(mcb, mcb_sig(mcb), 0x0000, mcb_size(mcb));
    mcb_coalesce();
    return 0;
}

/* AH=4Ah: ブロックの拡大/縮小。seg == 最上位 PSP の場合は「プログラム self-shrink =
 * アリーナ起点の確定」として扱う。戻り 0 = OK、-1 = 拡大不能 (out_largest に最大可能)。*/
int qb_dos_alloc_resize(uint16_t seg, uint16_t newparas, uint16_t *out_largest) {
    /* 最上位プログラムの「初回」self-shrink: ローダの推定でなくプログラム自身が宣言した
     * サイズでアリーナ起点を確定し、env→プログラム本体→空きの 3 ブロックチェーンを (再) 構築する
     * (まだ 48h 確保が無い段階で呼ばれる前提)。2 回目以降の PSP ブロック resize は下の通常経路へ
     * 落ちる: プログラム本体はここで実 MCB (LOAD_SEG-1) になったので、grow は隣接空きの吸収、
     * shrink は末尾分割で実 DOS 同様に動く (last-fit で空けた直上を grow が吸収 = GOGGLE2 が通る)。 */
    if (seg == QB_DOS_LOAD_SEG && !g_prog_shrunk) {
        qb_dos_alloc_reset((uint16_t)(seg + newparas));
        g_prog_shrunk = 1;
        return 0;
    }
    uint16_t mcb = (uint16_t)(seg - 1);
    if (!mcb_valid(mcb)) { if (out_largest) *out_largest = 0; return -2; }   /* 無効ブロック (実 DOS: AX=9) */
    uint8_t  sig = mcb_sig(mcb);
    uint16_t cur = mcb_size(mcb);
    uint16_t own = mcb_owner(mcb);
    if (newparas == cur) return 0;
    if (newparas < cur) {
        /* 縮小: 末尾を空きブロックに分割 */
        uint16_t tail = (uint16_t)(mcb + 1 + newparas);
        mcb_set(tail, sig, 0x0000, (uint16_t)(cur - newparas - 1));
        mcb_set(mcb, QB_MCB_M, own, newparas);
        mcb_coalesce();
        return 0;
    }
    /* 拡大: 次が空きブロックなら結合を試みる */
    if (sig != QB_MCB_Z) {
        uint16_t nxt = (uint16_t)(mcb + 1 + cur);
        if (mcb_valid(nxt) && mcb_owner(nxt) == 0) {
            uint8_t  nsig = mcb_sig(nxt);
            uint16_t combined = (uint16_t)(cur + 1 + mcb_size(nxt));
            if (combined >= newparas) {
                mcb_set(mcb, nsig, own, combined);          /* まず結合 */
                if (combined > newparas) {                   /* 余りを空きに戻す */
                    uint16_t tail = (uint16_t)(mcb + 1 + newparas);
                    mcb_set(tail, nsig, 0x0000, (uint16_t)(combined - newparas - 1));
                    mcb_set(mcb, QB_MCB_M, own, newparas);
                }
                return 0;
            }
            if (out_largest) *out_largest = combined;
            return -1;
        }
    }
    if (out_largest) *out_largest = cur;
    return -1;
}

/* プロセス終了時: その PSP が所有する全ブロックを解放する (DOS の free-on-terminate)。 */
void qb_dos_alloc_free_owner(uint16_t psp) {
    uint16_t s = g_first_mcb;
    while (s < QB_DOS_MEM_TOP_SEG && mcb_valid(s)) {
        uint8_t sig = mcb_sig(s);
        if (mcb_owner(s) == psp) mcb_set(s, sig, 0x0000, mcb_size(s));
        if (sig == QB_MCB_Z) break;
        s = (uint16_t)(s + 1 + mcb_size(s));
    }
    mcb_coalesce();
}

/* アリーナ内の最大空きブロックを探す。見つかれば MCB セグメントとサイズを返す。
 * EXEC の子割り当て (DOS は子に最大空きブロックを渡す) に使う。0 = 空き無し。 */
static uint16_t mcb_largest_free(uint16_t *out_size) {
    uint16_t best = 0, bestsz = 0;
    uint16_t s = g_first_mcb;
    mcb_coalesce();
    while (s < QB_DOS_MEM_TOP_SEG && mcb_valid(s)) {
        uint8_t sig = mcb_sig(s);
        if (mcb_owner(s) == 0 && mcb_size(s) > bestsz) { best = s; bestsz = mcb_size(s); }
        if (sig == QB_MCB_Z) break;
        s = (uint16_t)(s + 1 + mcb_size(s));
    }
    if (out_size) *out_size = bestsz;
    return best;
}

/* ---------------- ステージング (JS bridge から呼ばれる) ---------------- */

/* cmdline を g_stage.cmdline に正規化コピー (実 DOS の PSP tail 慣例: 空でなければ
 * 先頭スペースを prepend)。memset で 0 クリア済の前提で呼ぶ。 */
static void stage_cmdline(const char *cmdline) {
    if (!cmdline || cmdline[0] == '\0') return;
    size_t cl = strlen(cmdline);
    if (cl > 125) cl = 125;  /* 先頭スペース 1 byte 分を残す */
    g_stage.cmdline[0] = ' ';
    memcpy(&g_stage.cmdline[1], cmdline, cl);
    g_stage.cmdline[cl + 1] = '\0';
}

/* image の basename を大文字化して g_stage.name に保持 (argv[0] のフルパス生成用)。
 * memset で 0 クリア済の前提。空/NULL なら未設定のまま (build_env が既定にフォールバック)。*/
static void stage_name(const char *name) {
    if (!name || name[0] == '\0') return;
    const char *base = name;
    for (const char *q = name; *q; q++) {
        if (*q == '/' || *q == '\\') base = q + 1;
    }
    size_t i = 0;
    for (; base[i] && i + 1 < sizeof(g_stage.name); i++) {
        char c = base[i];
        g_stage.name[i] = (c >= 'a' && c <= 'z') ? (char)(c - 32) : c;
    }
    g_stage.name[i] = '\0';
}

static inline uint16_t read_le16(const uint8_t *p) {
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

int qb_dos_stage_com(const uint8_t *image, size_t size, const char *cmdline,
                     const char *name) {
    if (!image || size == 0) return -1;
    if (size > 0xFF00) return -2;  /* COM の理論上限 = 64K - PSP(256) */

    memset(&g_stage, 0, sizeof(g_stage));
    g_stage.kind = QB_DOS_IMG_COM;
    memcpy(g_stage.buf, image, size);
    g_stage.size = size;
    stage_cmdline(cmdline);
    stage_name(name);
    g_stage.ready = 1;

    qb_dos_reset_state();
    fprintf(stderr, "[dos_loader] staged COM: %zu bytes, cmdline=\"%s\"\n",
            size, g_stage.cmdline);
    return 0;
}

/* MZ / ZM EXE をステージング。ヘッダから image body と reloc を読み、body は
 * staging buffer に header strip 済みでコピー、reloc は image_base_segment を
 * 足して即時適用する。CS/IP/SS/SP は MZ ヘッダの相対値を保持し、loader-start
 * フックで image_base_seg と組み合わせて CPU に書く。 */
int qb_dos_stage_exe(const uint8_t *image, size_t size, const char *cmdline,
                     const char *name) {
    if (!image || size < 0x1C) return -1;  /* MZ ヘッダ 28 byte より小さい */

    uint16_t magic = read_le16(image);
    if (magic != 0x5A4D && magic != 0x4D5A) return -3;  /* MZ / ZM 以外 */

    uint16_t e_cblp     = read_le16(image + 0x02);
    uint16_t e_cp       = read_le16(image + 0x04);
    uint16_t e_crlc     = read_le16(image + 0x06);
    uint16_t e_cparhdr  = read_le16(image + 0x08);
    uint16_t e_minalloc = read_le16(image + 0x0A);
    uint16_t e_ss      = read_le16(image + 0x0E);
    uint16_t e_sp      = read_le16(image + 0x10);
    uint16_t e_ip      = read_le16(image + 0x14);
    uint16_t e_cs      = read_le16(image + 0x16);
    uint16_t e_lfarlc  = read_le16(image + 0x18);

    /* image_size_in_file = e_cp 個の 512 byte page、最後の page は e_cblp バイトで打ち切り。
     * e_cblp == 0 は「最後の page も全 512 byte」を意味する慣例 (一部ツールは異なる)。*/
    size_t image_size_file = (size_t)e_cp * 512;
    if (e_cblp != 0) {
        if (e_cp == 0) return -4;
        image_size_file -= (512 - e_cblp);
    }
    if (image_size_file > size) return -5;  /* ヘッダ宣言 > ファイルサイズ */

    size_t header_bytes = (size_t)e_cparhdr * 16;
    if (header_bytes < 0x1C || header_bytes > image_size_file) return -6;

    size_t body_bytes = image_size_file - header_bytes;
    if (body_bytes > sizeof(g_stage.buf)) return -7;  /* > 640KB */

    memset(&g_stage, 0, sizeof(g_stage));
    g_stage.kind = QB_DOS_IMG_EXE;
    memcpy(g_stage.buf, image + header_bytes, body_bytes);
    g_stage.size   = body_bytes;
    g_stage.exe_cs = e_cs;
    g_stage.exe_ip = e_ip;
    g_stage.exe_ss = e_ss;
    g_stage.exe_sp = e_sp;
    g_stage.exe_minalloc = e_minalloc;

    /* relocation 適用: 各エントリは (offset, segment) 16-bit ペアで、image 先頭からの
     * seg:off を指す。そこに格納された 16-bit segment 値に image_base_seg を加算する。 */
    if (e_crlc > 0) {
        uint32_t rel_end = (uint32_t)e_lfarlc + (uint32_t)e_crlc * 4;
        if (rel_end > size) return -8;
        for (uint16_t i = 0; i < e_crlc; i++) {
            uint32_t rec = (uint32_t)e_lfarlc + (uint32_t)i * 4;
            uint16_t r_off = read_le16(image + rec);
            uint16_t r_seg = read_le16(image + rec + 2);
            uint32_t lin   = (uint32_t)r_seg * 16 + r_off;
            if (lin + 1 >= body_bytes) return -9;
            uint16_t cur = (uint16_t)g_stage.buf[lin]
                         | ((uint16_t)g_stage.buf[lin + 1] << 8);
            cur = (uint16_t)(cur + QB_DOS_EXE_IMAGE_SEG);
            g_stage.buf[lin]     = (uint8_t)(cur & 0xFF);
            g_stage.buf[lin + 1] = (uint8_t)((cur >> 8) & 0xFF);
        }
    }

    stage_cmdline(cmdline);
    stage_name(name);
    g_stage.ready = 1;
    qb_dos_reset_state();
    fprintf(stderr,
            "[dos_loader] staged EXE: file=%zu body=%zu hdr=%zu relocs=%u "
            "CS:IP=%04x:%04x SS:SP=%04x:%04x cmdline=\"%s\"\n",
            size, body_bytes, header_bytes, (unsigned)e_crlc,
            e_cs, e_ip, e_ss, e_sp, g_stage.cmdline);
    return 0;
}

/* ================= ②/③ ミニ COMMAND.COM + .bat 文インタプリタ =================
 *
 * シェル (tools/dos_loader/shell.asm) は「C へ『次コマンド?』を far CALL (F000:EE90) で
 * 問い合わせ → 返ってきた (path_off, tail_off) を AH=4Bh EXEC」を繰り返すだけの EXEC 発行役。
 * どのコマンドを次に実行するかはホスト側の文テーブル (g_batch) を qb_dos_batch_next_hook()
 * が PC (文ポインタ) で解釈して決める:
 *   - 線形 .bat (制御フロー無し): qb_dos_stage_script が cmd 文だけの列に落とす (② 従来経路)
 *   - if errorlevel / goto 入り .bat: qb_dos_stage_batch が JS (batscript.js buildStatements)
 *     の直列化文列を受け取る (③)。errorlevel は EXEC 子の終了コード g_last_exit_code を
 *     分岐評価時に読む遅延評価 = 実 DOS の意味論 (並び順非依存・後方 goto ループも成立)。
 *
 * ゲスト側 (シェル COM image) に置くのはパス ASCIZ + DOS cmdtail の文字列プールだけ。
 * 文テーブル・echo テキストはホスト側に保持する (ゲストのメモリレイアウトは EXEC に必要な
 * 文字列以外を増やさない)。
 *
 * image レイアウト (COM なので segment 内 offset 0x100 ロード):
 *   [shell blob (固定コード, QB_DOS_SHELL_BLOB_LEN)]
 *   [文字列領域: ASCIZ パス群 + DOS cmdtail 群 ([len][bytes][0Dh])]
 * シェルは自身を KEEP=0x200 para (8KB) に self-shrink しスタックを 0x1FFE へ退避するので、
 * image は 0x100+image_bytes < ~0x1E00 (= スタック手前) に収める必要がある。 */
#define QB_SHELL_MAX_CMDS 48       /* TH02 game.bat = 約 31 cmd 文 (6 分岐 × ドライバ往復) */
#define QB_SHELL_IMG_MAX  0x1C00   /* image バイト上限 (0x100+これ=0x1D00 < スタック 0x1FFE) */

/* 文 op (batscript.js buildStatements と同じモデル) */
#define QB_BATCH_CMD   0   /* EXEC するコマンド (path_off/tail_off = シェルセグメント内) */
#define QB_BATCH_ECHO  1   /* 作者メッセージ → tty */
#define QB_BATCH_GOTO  2   /* 無条件ジャンプ (target = 文 index、nstmts = 終了) */
#define QB_BATCH_IFERR 3   /* if [not] errorlevel n goto target */

#define QB_BATCH_MAX_STMTS 96
#define QB_BATCH_ECHO_POOL 2048

typedef struct {
    uint8_t  op;
    uint8_t  n, neg;               /* IFERR: しきい値 / NOT 反転 */
    int16_t  target;               /* GOTO/IFERR: 飛び先文 index */
    uint16_t path_off, tail_off;   /* CMD: ゲスト (シェルセグメント内) オフセット */
    uint16_t echo_off, echo_len;   /* ECHO: g_batch_echo 内 */
} qb_batch_stmt_t;

static qb_batch_stmt_t g_batch_stmts[QB_BATCH_MAX_STMTS];
static int  g_batch_nstmts = 0;
static int  g_batch_pc     = 0;
static int  g_batch_active = 0;    /* シェル stage 済 (qb_dos_reset_state でクリア) */
static char g_batch_echo[QB_BATCH_ECHO_POOL];

typedef struct { const char *path; size_t plen; const char *args; size_t alen; } shell_cmd_t;

/* シェル blob + 文字列プールを COM image に組んで stage する (②/③ 共用)。
 * 成功時 path_offs/tail_offs[i] にシェルセグメント内オフセットを書いて 0 を返す。 */
static int stage_shell_image(const shell_cmd_t *cmds, int n, const char *name,
                             uint16_t *path_offs, uint16_t *tail_offs) {
    static uint8_t img[QB_SHELL_IMG_MAX];
    size_t blob = QB_DOS_SHELL_BLOB_LEN;
    size_t pos = blob;
    if (pos > sizeof(img)) return -11;
    memcpy(img, qb_dos_shell_blob, blob);

    for (int i = 0; i < n; i++) {
        /* path ASCIZ */
        if (pos + cmds[i].plen + 1 > sizeof(img)) return -11;
        path_offs[i] = (uint16_t)(0x100 + pos);
        memcpy(&img[pos], cmds[i].path, cmds[i].plen); pos += cmds[i].plen;
        img[pos++] = 0x00;
        /* DOS cmdtail: [len][bytes][0x0D] */
        size_t alen = cmds[i].alen; if (alen > 255) alen = 255;
        if (pos + alen + 2 > sizeof(img)) return -11;
        tail_offs[i] = (uint16_t)(0x100 + pos);
        img[pos++] = (uint8_t)alen;
        memcpy(&img[pos], cmds[i].args, alen); pos += alen;
        img[pos++] = 0x0D;
    }

    /* シェルを通常の COM として stage (cmdline 不要)。loader-start が 0x100:0x100 に展開する。
     * 中の qb_dos_reset_state が g_batch_active を 0 に戻すので、呼び出し側は stage 成功後に
     * 文テーブルを設定して active を立てること。 */
    return qb_dos_stage_com(img, pos, NULL, name);
}

int qb_dos_stage_script(const char *script, size_t len, const char *name) {
    if (!script) return -1;

    /* --- script を (path, args) コマンド列へ分解 (生バイト, len 境界で読む) --- */
    shell_cmd_t cmds[QB_SHELL_MAX_CMDS];
    int n = 0;
    const char *p = script, *end = script + len;
    while (p < end && n < QB_SHELL_MAX_CMDS) {
        while (p < end && (*p == '\n' || *p == '\r')) p++;   /* 空行/改行スキップ */
        if (p >= end) break;
        const char *line = p;
        while (p < end && *p != '\n' && *p != '\r') p++;     /* 行末まで */
        const char *lend = p;
        const char *tab = line;
        while (tab < lend && *tab != '\t') tab++;            /* path \t args */
        size_t plen = (size_t)(tab - line);
        const char *args = (tab < lend) ? tab + 1 : lend;
        size_t alen = (size_t)(lend - args);
        if (plen == 0) continue;                             /* path 無し行は無視 */
        cmds[n].path = line; cmds[n].plen = plen;
        cmds[n].args = args; cmds[n].alen = alen;
        n++;
    }
    if (n == 0) return -2;

    uint16_t path_offs[QB_SHELL_MAX_CMDS], tail_offs[QB_SHELL_MAX_CMDS];
    int r = stage_shell_image(cmds, n, name, path_offs, tail_offs);
    if (r != 0) return r;

    /* 線形列 = cmd 文だけの文プログラム */
    for (int i = 0; i < n; i++) {
        qb_batch_stmt_t *s = &g_batch_stmts[i];
        memset(s, 0, sizeof(*s));
        s->op = QB_BATCH_CMD;
        s->path_off = path_offs[i];
        s->tail_off = tail_offs[i];
    }
    g_batch_nstmts = n;
    g_batch_pc     = 0;
    g_batch_active = 1;
    fprintf(stderr, "[dos_loader] staged SHELL: %d cmd(s)\n", n);
    return 0;
}

/* ③ 直列化文列 ("C\tPATH\tARGS" / "E\tTEXT" / "G\tTARGET" / "I\tN\tNEG\tTARGET" の \n 区切り、
 * batscript.js serializeStatements が生成) をパースして stage する。
 * 戻り値 0=OK / -1 引数不正 / -2 cmd 文ゼロ / -11 image 超過 / -12 文数超過 /
 * -13 不正 target / -14 echo プール超過 / -15 構文不正。 */
int qb_dos_stage_batch(const char *prog, size_t len, const char *name) {
    if (!prog) return -1;

    qb_batch_stmt_t stmts[QB_BATCH_MAX_STMTS];
    shell_cmd_t cmds[QB_SHELL_MAX_CMDS];
    char echo_pool[QB_BATCH_ECHO_POOL];
    int nst = 0, ncmd = 0;
    size_t echo_used = 0;
    int cmd_of_stmt[QB_BATCH_MAX_STMTS];     /* CMD 文 → cmds[] index */

    const char *p = prog, *end = prog + len;
    while (p < end) {
        while (p < end && (*p == '\n' || *p == '\r')) p++;
        if (p >= end) break;
        const char *line = p;
        while (p < end && *p != '\n' && *p != '\r') p++;
        const char *lend = p;
        if (nst >= QB_BATCH_MAX_STMTS) return -12;

        qb_batch_stmt_t *s = &stmts[nst];
        memset(s, 0, sizeof(*s));
        cmd_of_stmt[nst] = -1;

        /* フィールド分解: op 1 文字 + '\t' 区切り (echo テキスト/引数はタブ以降を生で保持) */
        char op = line[0];
        const char *f1 = (lend - line >= 2 && line[1] == '\t') ? line + 2 : lend;

        if (op == 'C') {                       /* C \t path \t args */
            const char *tab = f1;
            while (tab < lend && *tab != '\t') tab++;
            size_t plen = (size_t)(tab - f1);
            if (plen == 0) return -15;
            if (ncmd >= QB_SHELL_MAX_CMDS) return -12;
            cmds[ncmd].path = f1;  cmds[ncmd].plen = plen;
            cmds[ncmd].args = (tab < lend) ? tab + 1 : lend;
            cmds[ncmd].alen = (size_t)(lend - cmds[ncmd].args);
            s->op = QB_BATCH_CMD;
            cmd_of_stmt[nst] = ncmd++;
        } else if (op == 'E') {                /* E \t text (生バイト、SJIS 可) */
            size_t tl = (size_t)(lend - f1);
            if (echo_used + tl > sizeof(echo_pool)) return -14;
            memcpy(echo_pool + echo_used, f1, tl);
            s->op = QB_BATCH_ECHO;
            s->echo_off = (uint16_t)echo_used;
            s->echo_len = (uint16_t)tl;
            echo_used += tl;
        } else if (op == 'G' || op == 'I') {   /* G \t target  /  I \t n \t neg \t target */
            long v[3] = {0, 0, 0};
            int nv = 0;
            const char *q = f1;
            while (q < lend && nv < 3) {
                long acc = 0; int any = 0;
                while (q < lend && *q >= '0' && *q <= '9') { acc = acc * 10 + (*q - '0'); q++; any = 1; }
                if (!any) return -15;
                v[nv++] = acc;
                if (q < lend && *q == '\t') q++;
            }
            if (op == 'G') {
                if (nv != 1) return -15;
                s->op = QB_BATCH_GOTO;
                s->target = (int16_t)v[0];
            } else {
                if (nv != 3 || v[0] > 255 || v[1] > 1) return -15;
                s->op = QB_BATCH_IFERR;
                s->n = (uint8_t)v[0];
                s->neg = (uint8_t)v[1];
                s->target = (int16_t)v[2];
            }
        } else {
            return -15;
        }
        nst++;
    }
    if (ncmd == 0) return -2;

    /* target 検証: 0..nstmts (== nstmts は「末尾へ = 終了」、buildStatements のラベル解決仕様) */
    for (int i = 0; i < nst; i++) {
        if (stmts[i].op == QB_BATCH_GOTO || stmts[i].op == QB_BATCH_IFERR) {
            if (stmts[i].target < 0 || stmts[i].target > nst) return -13;
        }
    }

    uint16_t path_offs[QB_SHELL_MAX_CMDS], tail_offs[QB_SHELL_MAX_CMDS];
    int r = stage_shell_image(cmds, ncmd, name, path_offs, tail_offs);
    if (r != 0) return r;

    for (int i = 0; i < nst; i++) {
        if (cmd_of_stmt[i] >= 0) {
            stmts[i].path_off = path_offs[cmd_of_stmt[i]];
            stmts[i].tail_off = tail_offs[cmd_of_stmt[i]];
        }
        g_batch_stmts[i] = stmts[i];
    }
    memcpy(g_batch_echo, echo_pool, echo_used);
    g_batch_nstmts = nst;
    g_batch_pc     = 0;
    g_batch_active = 1;
    fprintf(stderr, "[dos_loader] staged BATCH: %d stmt(s) (%d cmd)\n", nst, ncmd);
    return 0;
}

/* シェルの「次コマンド?」(far CALL F000:EE90 → 0xFEE90 NOP)。文テーブルを PC で解釈し、
 * 次に EXEC するコマンドがあれば AX=1 + DX=path_off + CX=tail_off、列が尽きたら AX=0
 * (シェルは 4Ch でセッション終了)。echo/goto/iferr はこの中で消化する。
 * iferr の errorlevel = 直近 EXEC 子の終了コード (g_last_exit_code、全終了経路で更新済)。 */
int qb_dos_batch_next_hook(void) {
    if (!g_batch_active) { CPU_AX = 0; return 1; }

    /* cmd に到達しない文だけの循環 (例 :A → goto A) はここで無限ループ = Wasm 凍結に
     * なるので、1 回の問い合わせで消化する文数に上限を置き、超えたら正直に終了する。
     * EXEC を挟むループ (FINALTY のデモループ等) は呼び出しごとに上限がリセットされる
     * ので制限なし (脱出はゲーム側の errorlevel か Stop ボタン)。 */
    int steps = 0, limit = g_batch_nstmts * 4 + 16;

    while (g_batch_pc >= 0 && g_batch_pc < g_batch_nstmts) {
        if (++steps > limit) {
            fprintf(stderr, "[batch] cmd の無い文ループを検出 (pc=%d) — セッションを終了します\n",
                    g_batch_pc);
            break;
        }
        qb_batch_stmt_t *s = &g_batch_stmts[g_batch_pc];
        switch (s->op) {
        case QB_BATCH_CMD:
            CPU_DX = s->path_off;
            CPU_CX = s->tail_off;
            CPU_AX = 1;
            g_batch_pc++;
            return 1;
        case QB_BATCH_ECHO:
            qb_dos_tty_write((const uint8_t *)g_batch_echo + s->echo_off, (int)s->echo_len);
            qb_dos_tty_write((const uint8_t *)"\r\n", 2);
            g_batch_pc++;
            break;
        case QB_BATCH_GOTO:
            g_batch_pc = s->target;
            break;
        case QB_BATCH_IFERR: {
            int cond = (g_last_exit_code >= s->n);
            if (s->neg) cond = !cond;
            fprintf(stderr, "[batch] if %serrorlevel %u (code=%u) -> %s\n",
                    s->neg ? "not " : "", s->n, g_last_exit_code,
                    cond ? "goto" : "fall-through");
            g_batch_pc = cond ? s->target : g_batch_pc + 1;
            break;
        }
        default:
            g_batch_pc++;
            break;
        }
    }

    CPU_AX = 0;   /* 列が尽きた → シェルが AH=4Ch でセッション終了 */
    return 1;
}

void qb_dos_reset_state(void) {
    g_run.running = 0;
    g_run.exited = 0;
    g_run.exit_code = 0;
    /* 新しい stage = 新しいセッション: 文インタプリタと errorlevel を初期化する。
     * (②/③ のシェル stage は stage_com 経由でここを通った後に active を立て直す) */
    g_batch_active = 0;
    g_batch_pc = 0;
    g_last_exit_code = 0;
    g_last_exit_type = 0;
}

int qb_dos_get_exit(int *code_out) {
    if (code_out) *code_out = g_run.exit_code;
    return g_run.exited ? 1 : 0;
}

/* 終了通知 (dos_int21.c から呼ばれる)。
 * CPU_CS:IP を BIOS 領域の HLT ループへリダイレクトして、image の続きを実行
 * させない。ia32_bioscall は呼び出し元 NOP 後にセグメントを LOAD_SEGREG で
 * 反映するので、直後に新 CS:IP から実行が再開される。 */
int qb_dos_signal_exit(int code) {
    /* EXEC した子の終了なら、親 (ランチャ) を復元して続行する (= メニューに戻る)。 */
    if (g_exec_sp > 0) {
        exec_frame_t *f = &g_exec_stack[--g_exec_sp];
        qb_dos_alloc_free_owner(g_cur_psp);         /* 子 PSP が所有する全ブロックを解放 (DOS free-on-terminate) */
        qb_dos_fh_close_since(f->fh_mask);          /* 子が開いたファイルハンドルを閉じる (同上) */
        CPU_CS = f->ret_cs; CPU_IP = f->ret_ip;     /* 親の INT 21h 直後へ */
        CPU_SS = f->ret_ss; CPU_SP = f->ret_sp;
        CPU_DS = f->ds;     CPU_ES = f->es;
        CPU_AX = f->ax; CPU_BX = f->bx; CPU_CX = f->cx; CPU_DX = f->dx;
        CPU_SI = f->si; CPU_DI = f->di; CPU_BP = f->bp;
        CPU_FLAG = (uint16_t)(f->flags & ~C_FLAG);  /* CF=0 = EXEC 成功 (IF 等は親の値に復元) */
        g_cur_psp = f->psp_seg;
        qb_dos_dta_set(f->dta_seg, f->dta_off);     /* 親 DTA を復元 */
        g_last_exit_code = (uint8_t)code;
        g_last_exit_type = 0;
        fprintf(stderr,
                "[dos_exec] child exited code=%d → 親 PSP=%04X 復帰 CS:IP=%04X:%04X SS:SP=%04X:%04X\n",
                code, g_cur_psp, CPU_CS, CPU_IP, CPU_SS, CPU_SP);
        return 1;   /* 親復帰 (呼び出し側は dispatch tail の FLAGS 書き戻しを skip) */
    }

    /* 最上位プログラムの終了 = halt して JS に通知 */
    g_run.exited = 1;
    g_run.exit_code = code;
    g_run.running = 0;
    CPU_CS = 0xF000;
    CPU_IP = (uint16_t)(QB_TRAMP_HALT_LOOP & 0xFFFF);
    fprintf(stderr, "[dos_loader] image exited with code %d → halt loop\n", code);
    return 0;
}

/* AH=31h Keep Process (TSR) — 子を常駐させたまま親へ復帰する。
 * signal_exit の「EXEC 子復帰」分岐とほぼ同じだが、決定的な違いは
 *   (1) 子の PSP ブロックを keep_paras に縮める (余りは解放) が、所有者は子 PSP のまま
 *       残す → free-on-terminate しない = メモリが常駐する。
 *   (2) 子終了コードは AL を採る。
 * Ray は起動時に RIN.COM (常駐音源ドライバ) を EXEC し、RIN は AH=31h で常駐する。
 * 戻り値 1 = 親復帰 (CPU リダイレクト済 → dispatch tail の FLAGS 書き戻しを skip)、
 *        0 = EXEC 子でない (最上位プログラムの TSR は常駐先がないので halt 扱い)。 */
int qb_dos_signal_tsr(uint16_t keep_paras, int code) {
    /* 子のブロックを縮小 (resize は所有者を保持するので owner=子 PSP のまま常駐)。
     * PSP(0x10) を下回る要求は最低 0x11 para に丸める (DX=0 渡し対策)。 */
    if (keep_paras < 0x11) keep_paras = 0x11;
    qb_dos_alloc_resize(g_cur_psp, keep_paras, NULL);

    if (g_exec_sp > 0) {
        exec_frame_t *f = &g_exec_stack[--g_exec_sp];
        /* free-on-terminate は呼ばない (常駐させるのが TSR の目的)。 */
        CPU_CS = f->ret_cs; CPU_IP = f->ret_ip;     /* 親の INT 21h 直後へ */
        CPU_SS = f->ret_ss; CPU_SP = f->ret_sp;
        CPU_DS = f->ds;     CPU_ES = f->es;
        CPU_AX = f->ax; CPU_BX = f->bx; CPU_CX = f->cx; CPU_DX = f->dx;
        CPU_SI = f->si; CPU_DI = f->di; CPU_BP = f->bp;
        CPU_FLAG = (uint16_t)(f->flags & ~C_FLAG);  /* CF=0 = EXEC 成功 */
        g_cur_psp = f->psp_seg;
        qb_dos_dta_set(f->dta_seg, f->dta_off);     /* 親 DTA を復元 */
        g_last_exit_code = (uint8_t)code;
        g_last_exit_type = 0;
        fprintf(stderr,
                "[dos_exec] TSR keep=%u para (常駐) → 親 PSP=%04X 復帰 CS:IP=%04X:%04X\n",
                (unsigned)keep_paras, g_cur_psp, CPU_CS, CPU_IP);
        return 1;
    }

    /* 最上位プログラムが TSR した (親無し) = 常駐させる相手がいないので halt 扱い。 */
    g_run.exited = 1;
    g_run.exit_code = code;
    g_run.running = 0;
    CPU_CS = 0xF000;
    CPU_IP = (uint16_t)(QB_TRAMP_HALT_LOOP & 0xFFFF);
    fprintf(stderr, "[dos_loader] top-level TSR (keep=%u) → halt loop\n", (unsigned)keep_paras);
    return 0;
}

int qb_dos_is_running(void) { return g_run.running; }

/* ---------------- メモリ書き込みヘルパ ----------------
 * poke8/poke16 (生アクセス) は共有ヘッダ qb_guestmem.h で定義 (dos_int21.c と一本化)。 */

/* IVT[vec] = seg:off に設定 */
static void set_ivt(uint8_t vec, uint16_t seg, uint16_t off) {
    uint32_t a = (uint32_t)vec * 4u;
    poke16(a,     off);
    poke16(a + 2, seg);
}

/* トランポリンを書く: linear addr に NOP (0x90) + IRET (0xCF) */
static void put_trampoline(uint32_t linear) {
    poke8(linear,     0x90);  /* NOP — ia32_bioscall を踏む */
    poke8(linear + 1, 0xCF);  /* IRET */
}

/* ---- XMS/EMS 需要プローブ (計測器, 2026-06-05) ----
 * XMS/EMS は未 HLE。だが「フロッピー 2D・〜1998 同人」群が実際に XMS/EMS を要求するか
 * が不明なので、まず検出だけの計測器を常設する。INT 2Fh AX=43xx (XMS インストールチェック)、
 * INT 67h (EMS)、および "EMMXXXX0" デバイス open (EMS 検出の MS 標準口、dos_int21 から通知) を
 * カウント + stderr ログ。応答は従来通り「無し」(レジスタ不変) を保つので互換性に影響しない。
 * 集計は qb_dos_memprobe_count() → bridge → qbDebug.memprobe()。カウンタは Run 毎にリセット
 * (loader-start) するので、現在のタイトルが拡張メモリを要求したかを直接読める。 */
static uint32_t g_probe_xms = 0;       /* INT 2Fh AX=43xx */
static uint32_t g_probe_ems = 0;       /* INT 67h */
static uint32_t g_probe_emm_open = 0;  /* open("EMMXXXX0") */

void qb_dos_memprobe_note_emm_open(void) {
    g_probe_emm_open++;
    fprintf(stderr, "[memprobe] EMS: open(\"EMMXXXX0\") attempt "
                    "(unimplemented -> open fails = no EMS, total %u)\n", g_probe_emm_open);
}

uint32_t qb_dos_memprobe_count(int which) {
    switch (which) {
        case 0:  return g_probe_xms;
        case 1:  return g_probe_ems;
        case 2:  return g_probe_emm_open;
        default: return 0;
    }
}

/* INT 2Fh フック (0xFEE50)。AX=43xx (XMS インストールチェック/entry 取得) だけ記録する。
 * 未実装なのでレジスタは変えない → 呼び出し側は AL!=0x80 で「XMS 無し」と判定 (旧 IRET スタブと同値)。
 * 43xx 以外の multiplex 2Fh はそのまま素通し (レジスタ不変で IRET)。 */
int qb_dos_int2f_hook(void) {
    uint16_t ax = (uint16_t)CPU_AX;
    if ((ax & 0xFF00) == 0x4300) {
        g_probe_xms++;
        if (qb_xms_enabled()) {
            /* HIMEM ロード済として応答する。AX=4300h→AL=80h (在)、AX=4310h→ES:BX=entry。 */
            if (ax == 0x4300) {
                CPU_AL = 0x80;
            } else if (ax == 0x4310) {
                CPU_ES = 0xF000;
                CPU_BX = (uint16_t)(QB_TRAMP_XMS_ENTRY & 0xFFFF);
            }
            fprintf(stderr, "[xms] INT 2Fh AX=%04X -> %s (total %u)\n", ax,
                    ax == 0x4300 ? "installed AL=80" : "entry F000:EE70", g_probe_xms);
        } else {
            fprintf(stderr, "[memprobe] XMS: INT 2Fh AX=%04X "
                            "(disabled -> reports absent, total %u)\n", ax, g_probe_xms);
        }
    }
    return 1;
}

/* XMS ドライバ entry (0xFEE70 の NOP) → ディスパッチャへ委譲。 */
int qb_dos_xms_entry_hook(void) {
    return qb_xms_dispatch();
}

/* INT 67h フック (0xFEE60)。EMS 呼び出し (AH=40h status / 46h version / 41h frame / 43h alloc 等)。
 * 未実装なのでレジスタを変えず IRET = 旧 IRET スタブと同じ挙動 (EMS 検出側は不在と判定)。記録のみ。 */
int qb_dos_int67_hook(void) {
    g_probe_ems++;
    fprintf(stderr, "[memprobe] EMS: INT 67h AH=%02X "
                    "(unimplemented -> reports absent, total %u)\n", (uint8_t)CPU_AH, g_probe_ems);
    return 1;
}

/* bios_initialize() から毎リセット呼ばれる。トランポリン本体を BIOS area に置く。
 * loader-start は JMP FAR で踏まれる (戻り不要) ので NOP + HLT、
 * INT 21h/INT 20h/INT 2Fh/INT 67h/INT 29h は INT で踏まれる (IRET で戻る) ので NOP + IRET、
 * XMS ドライバ entry は far CALL で踏まれるので NOP + RETF、
 * halt loop は終了後の停止用 (HLT; JMP -3)。番地は dos_loader.h の QB_TRAMP_* を参照。 */
void qb_dos_install_trampolines(void) {
    /* loader-start: NOP + HLT (フックで CS:IP が書き換わるので HLT は到達しない) */
    poke8(QB_TRAMP_LOADER_START + 0, 0x90);
    poke8(QB_TRAMP_LOADER_START + 1, 0xF4);

    /* INT 21h / INT 20h: NOP + IRET */
    put_trampoline(QB_TRAMP_INT21);
    put_trampoline(QB_TRAMP_INT20);

    /* XMS/EMS 需要プローブ: INT 2Fh / INT 67h も NOP + IRET (C フックでログだけ) */
    put_trampoline(QB_TRAMP_INT2F);
    put_trampoline(QB_TRAMP_INT67);

    /* INT 29h (DOS 高速文字出力): NOP + IRET。C フックで AL を tty へ流す。 */
    put_trampoline(QB_TRAMP_INT29);

    /* XMS ドライバ entry: far CALL で踏まれるので NOP + RETF (0xCB)。NOP が biosfunc を踏む。 */
    poke8(QB_TRAMP_XMS_ENTRY + 0, 0x90);  /* NOP */
    poke8(QB_TRAMP_XMS_ENTRY + 1, 0xCB);  /* RETF */

    /* .bat 文インタプリタ「次コマンド?」entry: シェルが far CALL するので NOP + RETF。 */
    poke8(QB_TRAMP_BATCH_NEXT + 0, 0x90);  /* NOP */
    poke8(QB_TRAMP_BATCH_NEXT + 1, 0xCB);  /* RETF */

    /* HLT ループ: F4 (HLT); EB FD (JMP -3) */
    poke8(QB_TRAMP_HALT_LOOP + 0, 0xF4);
    poke8(QB_TRAMP_HALT_LOOP + 1, 0xEB);
    poke8(QB_TRAMP_HALT_LOOP + 2, 0xFD);

    /* IRET-only スタブ: 0xCF (IRET)。未使用 software INT 0x22..0xFF を全部
     * これに向けて、未実装ドライバ呼び出しを安全に nop 化する。 */
    poke8(QB_TRAMP_IRET_STUB, 0xCF);
}

/* 環境セグメントを seg:0000 に構築する。実機 DOS 互換レイアウト:
 *   [env vars (各 NUL 終端)] [空文字列 NUL] [WORD: 後続文字列数 = 1] [argv[0] パス NUL]
 *
 * 重要 (Super Depth 等の対策): **env vars を空にしてはいけない**。
 * C ランタイムには env 終端を「二重 NUL (00 00)」で検出する実装があり、空 env
 * (先頭 00 + count + path...) だと最初の 00 00 が path の後ろ (ゼロ埋め領域) に
 * 出現してしまい、終端を誤認 → count=0 / argv[0]=空 と読む。argv[0] が空だと
 * 自分の実行パスからデータディレクトリを得るゲーム (depth.exe は argv[0] の最後の
 * '\' でディレクトリを切り出す) が破綻し、ファイル名バッファが strcat で累積する。
 * ダミー変数を 1 つ置いて末尾を必ず "var\0\0" の二重 NUL にすると、二重 NUL 検出式・
 * 空文字列検出式どちらの cstartup でも argv[0] を正しく読める。 */
static void build_env(uint16_t seg) {
    uint32_t base = (uint32_t)seg << 4;
    memset(&mem[base], 0, 256);
    uint32_t p = 0;
    const char *var = "PATH=A:\\";    /* ダミー env var 1 個 (末尾を var\0\0 にするため) */
    for (size_t i = 0; var[i]; i++) poke8(base + p++, (uint8_t)var[i]);
    poke8(base + p++, 0x00);          /* var 終端 NUL */
    poke8(base + p++, 0x00);          /* 空文字列 = env vars 末端 → ここで "00 00" 成立 */
    poke8(base + p++, 0x01);          /* WORD: 後続文字列数 = 1 (LE) */
    poke8(base + p++, 0x00);
    /* argv[0]: ステージした実 image 名から "A:\NAME.EXT" を作る (無ければ既定)。
     * '\' を含むので、argv[0] からデータディレクトリを切り出すゲームも正常化する。
     * 実名にすることで、argv[0] の basename を設定/ログ名に使うゲームも正しく動く。 */
    char path[32];
    if (g_stage.name[0]) snprintf(path, sizeof(path), "A:\\%s", g_stage.name);
    else                 snprintf(path, sizeof(path), "A:\\PROG.EXE");
    for (size_t i = 0; path[i]; i++) poke8(base + p++, (uint8_t)path[i]);
    poke8(base + p++, 0x00);          /* argv[0] 終端 (以降は memset 0) */
}

/* EXEC 子のための per-child 環境ブロックを作る (C1: argv[0] を子自身のパスに正規化)。
 * 実 DOS の EXEC は env を子所有の新ブロックにコピーし、末尾に子のフルパスを argv[0] として
 * 付け直す。継承 (env_seg=0) の子に最上位プログラムのパス (例 A:\RAY.EXE) が argv[0] として
 * 漏れる不具合を解消する。所有者は呼び元 (alloc_request が g_cur_psp=親を入れる) のままで返し、
 * 呼び元が child_psp 確定後に付け替える (env を子本体より先に確保するため child_psp 未確定)。
 *
 *   src_env_seg = コピー元 env の変数部 (build_env 互換: var\0...\0\0)。
 *   child_name  = 子の basename (大文字化して "A:\\NAME" に整形)。空なら "PROG.EXE"。
 *   戻り値      = 新 env data セグメント。0 = 確保失敗 (呼び元は親 env にフォールバック)。
 *
 * 【拡張ポイント】env_seg!=0 (明示 env) を完全 faithful 化する時は、呼び元で src_env_seg に
 * その明示セグを渡してこの関数を通すだけでよい (現状は corpus に該当タイトルが無いため継承のみ)。 */
static uint16_t build_child_env(uint16_t src_env_seg, const char *child_name) {
    /* 1) コピー元の変数部を二重NUL (空文字列終端) まで境界付きで temp に複製。src が壊れている/
     *    終端が無い場合は最小 env ("\0\0" = 変数ゼロ) にフォールバックする (caller env 防御)。 */
    uint8_t  vars[256];
    uint32_t vlen = 0;
    uint32_t sbase = (uint32_t)src_env_seg << 4;
    int prev_nul = 0, terminated = 0;
    for (uint32_t i = 0; i < sizeof(vars); i++) {
        uint8_t c = mem[(sbase + i) & QB_GUEST_MEM_MASK];
        vars[vlen++] = c;
        if (c == 0) { if (prev_nul) { terminated = 1; break; } prev_nul = 1; }
        else        { prev_nul = 0; }
    }
    if (!terminated) { vlen = 0; vars[vlen++] = 0; vars[vlen++] = 0; }

    /* 2) argv[0] パスを "A:\\NAME" (大文字) に整形 (build_env と同じ書式)。 */
    char path[32];
    uint32_t pn = 0;
    path[pn++] = 'A'; path[pn++] = ':'; path[pn++] = '\\';
    if (child_name && child_name[0]) {
        for (uint32_t i = 0; child_name[i] && pn + 1 < sizeof(path); i++) {
            char ch = child_name[i];
            path[pn++] = (ch >= 'a' && ch <= 'z') ? (char)(ch - 32) : ch;
        }
    } else {
        const char *def = "PROG.EXE";
        for (uint32_t i = 0; def[i] && pn + 1 < sizeof(path); i++) path[pn++] = def[i];
    }
    path[pn] = '\0';

    /* 3) 必要バイト = 変数部 + WORD(後続文字列数=1) + パス + NUL。アリーナから確保。 */
    uint32_t need_bytes = vlen + 2 + pn + 1;
    uint16_t need_paras = (uint16_t)((need_bytes + 15) >> 4);
    uint16_t env_seg = 0;
    if (qb_dos_alloc_request(need_paras, &env_seg, NULL) != 0) return 0;

    /* 4) 書き込み: [変数部 (二重NUL込み)][WORD=1][パス\0]。ブロック全体を 0 クリアしてから。 */
    uint32_t base = (uint32_t)env_seg << 4;
    memset(&mem[base], 0, (size_t)need_paras << 4);
    uint32_t p = 0;
    for (uint32_t i = 0; i < vlen; i++) poke8(base + p++, vars[i]);
    poke8(base + p++, 0x01); poke8(base + p++, 0x00);   /* 後続文字列数 = 1 (LE) */
    for (uint32_t i = 0; i < pn; i++) poke8(base + p++, (uint8_t)path[i]);
    poke8(base + p++, 0x00);
    return env_seg;
}

/* PSP を seg:0000 に構築する。最小限の DOS 互換版。 */
static void build_psp(uint16_t seg, const char *cmdline) {
    uint32_t base = (uint32_t)seg << 4;

    /* 全 256 byte ゼロ初期化 */
    memset(&mem[base], 0, 0x100);

    /* 0x00-0x01: INT 20h (= DOS exit ショートカット, "CD 20") */
    poke8(base + 0x00, 0xCD);
    poke8(base + 0x01, 0x20);

    /* 0x02-0x03: top-of-memory paragraphs (とりあえず 0xA000 = 640KB) */
    poke16(base + 0x02, 0xA000);

    /* 0x05: far call to DOS dispatch — 標準の CALL FAR (0x9A) + addr。
     *       簡略化: ここから飛ばずに INT 21h ショートカット (0x50 で別途) を使う */
    /* 省略 (使うソフトは少ないので) */

    /* 0x2C: 環境セグメント — 0 だと cstartup の env scan が暴走するので
     * 別 segment に最小 env を作って指す。 */
    poke16(base + 0x2C, QB_DOS_ENV_SEG);

    /* 0x50-0x52: "CD 21 CB" (INT 21h; RETF — DOS call ショートカット) */
    poke8(base + 0x50, 0xCD);
    poke8(base + 0x51, 0x21);
    poke8(base + 0x52, 0xCB);

    /* 0x80: cmdline 長 (1 byte) + 0x81..: cmdline + 末尾 0x0D */
    size_t cl = cmdline ? strlen(cmdline) : 0;
    if (cl > 126) cl = 126;
    poke8(base + 0x80, (uint8_t)cl);
    for (size_t i = 0; i < cl; i++) {
        poke8(base + 0x81 + i, (uint8_t)cmdline[i]);
    }
    poke8(base + 0x81 + cl, 0x0D);  /* DOS cmdline 終端 */
}

/* ---------------- loader-start フック (0xFEE00 から呼ばれる) ---------------- */

int qb_dos_loader_start_hook(void) {
    if (!g_stage.ready) {
        fprintf(stderr, "[dos_loader] start hook fired but no image staged\n");
        return 0;
    }

    /* トランポリンは bios_initialize から install 済 (qb_dos_install_trampolines)。
     * ここでは再保証のため、念のため再書き込み (リセット後の状態に依存させない)。*/
    qb_dos_install_trampolines();

    /* IVT を仕込む: INT 20h → F000:EE20、INT 21h → F000:EE10 */
    set_ivt(0x20, 0xF000, (uint16_t)(QB_TRAMP_INT20 & 0xFFFF));
    set_ivt(0x21, 0xF000, (uint16_t)(QB_TRAMP_INT21 & 0xFFFF));

    /* IVT[0x22..0xFF] の未初期化エントリ (= 0:0) を IRET stub に向ける。
     * NP2kai は IVT[0x00..0x1F] を biosfd80 ハンドラに初期化済 (bios_vectorset)、
     * 0x20 以降は触らないので 0 のまま。同じ初期化方針だと same.exe のような
     * 「マウスドライバ検出のため INT 33h を叩くソフト」が 0:0 にジャンプして
     * ゴミ命令を実行 → 偶然 CD 20 を踏んで我々の INT 20 で exit、という事故が
     * 起きる。空きエントリだけ stub にして他 (= 既に書かれた値) は温存する。 */
    for (uint8_t v = 0x22; v != 0; v++) {  /* 0x22..0xFF (overflow で停止) */
        uint32_t a = (uint32_t)v * 4u;
        uint32_t cur = ((uint32_t)mem[a])
                     | ((uint32_t)mem[a+1] << 8)
                     | ((uint32_t)mem[a+2] << 16)
                     | ((uint32_t)mem[a+3] << 24);
        if (cur == 0) {
            set_ivt(v, 0xF000, (uint16_t)(QB_TRAMP_IRET_STUB & 0xFFFF));
        }
    }

    /* XMS/EMS 需要プローブ: INT 2Fh / INT 67h を IRET スタブでなく専用フックへ向ける
     * (上のループで一旦スタブ化された分を上書き)。検出ログを出すだけで応答は従来同様「無し」。 */
    set_ivt(0x2F, 0xF000, (uint16_t)(QB_TRAMP_INT2F & 0xFFFF));
    set_ivt(0x67, 0xF000, (uint16_t)(QB_TRAMP_INT67 & 0xFFFF));

    /* INT 29h (DOS 高速文字出力) を専用フックへ。master.lib text_clear() が ESC[2J を
     * これで送るため、IRET スタブのままだと画面消去が効かずテキストが残る (上のループで
     * 一旦スタブ化された分を上書き)。 */
    set_ivt(0x29, 0xF000, (uint16_t)(QB_TRAMP_INT29 & 0xFFFF));
    g_probe_xms = g_probe_ems = g_probe_emm_open = 0;  /* この Run の計測をリセット */
    qb_xms_reset();   /* XMS ハンドル表を Run 毎にクリア + プールを CPU_EXTMEM から再計算 */

    /* 環境セグメント (PSP[0x2C] で指される) を先に作っておく */
    build_env(QB_DOS_ENV_SEG);

    /* PSP を 0x0100 セグメントに構築 */
    build_psp(QB_DOS_LOAD_SEG, g_stage.cmdline);
    g_cur_psp = QB_DOS_LOAD_SEG;   /* 最上位プログラム = PSP 0x0100 */
    g_exec_sp = 0;                 /* EXEC ネストをクリア (前回の残骸を持ち越さない) */
    g_prog_shrunk = 0;             /* この image の初回 self-shrink を再び有効化 */
    g_alloc_strategy = 0;          /* メモリ確保ストラテジを first-fit 既定へ (Run 毎) */
    g_batch_pc = 0;                /* .bat 文インタプリタを先頭から (reset 再起動 = 同じ stage を再走) */
    g_last_exit_code = 0;          /* errorlevel もセッション初期値 0 へ */
    g_last_exit_type = 0;

    /* 連続実行で前回の cursor 位置が残らないように tty を (0,0) に戻す */
    qb_dos_tty_reset();

    /* DOS プログラム入口のレジスタ。仕様で定義されるのは CS:IP/SS:SP/DS/ES と
     * AX (コマンドライン FCB のドライブ有効性。FCB を作らない我々は AL=AH=0 =
     * 「有効」) のみ。残りは規定外なので 0 にする (旧実装の CPU_ECX=0xFF /
     * CPU_EBP=0x091C は出所不明のマジック値だったので撤去)。
     * DS / ES は両 image 種別とも PSP セグメントを指す。 */
    CPU_EAX = 0;
    CPU_EBX = 0;
    CPU_ECX = 0;
    CPU_EDX = 0;
    CPU_EBP = 0;
    CPU_DS = QB_DOS_LOAD_SEG;
    CPU_ES = QB_DOS_LOAD_SEG;
    /* 実 DOS はプログラムを IF=1 (割り込み許可) で起動する。boot.asm が cli して
     * から loader に来ているので、ここで IF を立て直さないとイメージは割り込み禁止の
     * まま走り出す。自前で STI しない & IRQ を待つ設計のソフトはここで止まる。 */
    CPU_FLAG |= I_FLAG;

    if (g_stage.kind == QB_DOS_IMG_COM) {
        /* COM image を 0x0100:0x100 にコピー、CS=DS=ES=SS=0x100, IP=0x100, SP=0xFFFE */
        uint32_t load_lin = ((uint32_t)QB_DOS_LOAD_SEG << 4) + 0x0100;
        memcpy(&mem[load_lin], g_stage.buf, g_stage.size);
        CPU_CS = QB_DOS_LOAD_SEG;
        CPU_SS = QB_DOS_LOAD_SEG;
        CPU_IP = 0x0100;
        CPU_SP = 0xFFFE;
        CPU_ESI = 0x0100;
        CPU_EDI = 0xFFFE;
        /* AH=48h 用 alloc base: COM は 0x0100 + 0x1000 paragraphs (= 64KB ブロック直後) */
        qb_dos_alloc_reset((uint16_t)(QB_DOS_LOAD_SEG + 0x1000));
        fprintf(stderr,
                "[dos_loader] COM loaded at %04x:%04x, entry %04x:%04x, SP=%04x\n",
                QB_DOS_LOAD_SEG, 0x0100, CPU_CS, CPU_IP, CPU_SP);
    } else if (g_stage.kind == QB_DOS_IMG_EXE) {
        /* EXE body を image_base_seg:0 にコピー、CS/SS は MZ 相対値 + image_base_seg */
        uint32_t load_lin = (uint32_t)QB_DOS_EXE_IMAGE_SEG << 4;
        memcpy(&mem[load_lin], g_stage.buf, g_stage.size);
        CPU_CS = (uint16_t)(QB_DOS_EXE_IMAGE_SEG + g_stage.exe_cs);
        CPU_IP = g_stage.exe_ip;
        CPU_SS = (uint16_t)(QB_DOS_EXE_IMAGE_SEG + g_stage.exe_ss);
        CPU_SP = g_stage.exe_sp;
        CPU_ESI = g_stage.exe_ip;
        CPU_EDI = g_stage.exe_sp;
        /* AH=48h 用 alloc base = image_base から見た「プログラム占有の末尾」。
         * ヘッダ宣言の最低確保 (body + e_minalloc) と実スタック頂点 (SS:SP) の
         * 大きい方を採用 (旧実装のマジック SS+0x1000 を排除)。+16 para は余裕。 */
        uint32_t body_paras = (uint32_t)((g_stage.size + 15) >> 4);
        uint32_t heap_end   = body_paras + (uint32_t)g_stage.exe_minalloc;
        uint32_t stack_end  = (uint32_t)g_stage.exe_ss + (((uint32_t)g_stage.exe_sp + 15) >> 4);
        uint32_t end_rel    = heap_end > stack_end ? heap_end : stack_end;
        uint32_t alloc_base = (uint32_t)QB_DOS_EXE_IMAGE_SEG + end_rel + 0x10;
        qb_dos_alloc_reset(alloc_base > 0xFFFFu ? QB_DOS_MEM_TOP_SEG : (uint16_t)alloc_base);
        fprintf(stderr,
                "[dos_loader] EXE loaded at %04x:0000, entry %04x:%04x, SS:SP=%04x:%04x\n",
                QB_DOS_EXE_IMAGE_SEG, CPU_CS, CPU_IP, CPU_SS, CPU_SP);
    } else {
        fprintf(stderr, "[dos_loader] start hook: unknown kind %d\n", (int)g_stage.kind);
        return 0;
    }

    g_run.running = 1;
    g_run.exited = 0;
    g_stage.ready = 0;       /* 1 ショット */
    return 1;
}

/* ---------------- EXEC 子プロセスのロード (段階 1.5: 親常駐・復帰なし) ----------------
 * AH=4Bh AL=00 用。親 (ランチャ) をメモリに残したまま、子 (エンジン) をアリーナの
 * 最大空きブロックにロードして CPU を子へ切り替える。親の IVT フックや親内コードは
 * 生きたままなので、子や IRQ がそれらを参照しても壊れない (段階1 の「置換」で起きた暴走の解消)。
 *
 * 段階2: 子起動時に親コンテキストを g_exec_stack に退避し、子の終了 (4Ch/INT20h) で
 * qb_dos_signal_exit が親を復元する (= メニューに戻る往復が成立)。
 *
 * image[size] は MZ EXE。env_seg はパラメータブロック由来 (0 なら親 env を継承)。
 * 戻り値 0=成功、<0=失敗 (DOS error にマップするのは呼び出し側)。
 * 注: 既存ローダ (qb_dos_stage_exe/loader_start) は固定 segment 0x0110 前提でリロケート
 *     済みのため、子を別 base に置くこのパスは MZ パースを別途行う (意図的な重複)。 */
/* コマンドテイルの 1 トークンを子 PSP の FCB (drive + name[8] + ext[3]) へ parse する。
 * 実機 DOS の EXEC / COMMAND.COM は第1・第2引数をこの FCB 形式で子 PSP:5C/6C に置く。
 * 多くの PC-98 ツールは起動サブコマンド/引数をコマンドテイル (PSP:80) でなく FCB1 の
 * ファイル名フィールド (PSP:5D) から読む (例: 東方 zun.com は "zun_res" 等を FCB1 と内部表で
 * CMPSB 比較し、空だと "No COM-Soft !!!" で終了 → 常駐せず op.exe の前提環境が崩れる)。
 * fcb_base = FCB 先頭 linear (byte0=drive, +1..+8=name, +9..+11=ext)。トークン末尾の次を返す。 */
static const char *build_one_fcb(uint32_t fcb_base, const char *p) {
    poke8(fcb_base, 0);                                   /* drive = 既定 */
    for (int i = 1; i <= 11; i++) poke8(fcb_base + (uint32_t)i, ' ');  /* name[8]+ext[3]=空白 */
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '\0' || *p == '\r') return p;
    if (p[0] && p[1] == ':') {                            /* "X:" ドライブ指定 */
        char d = p[0]; if (d >= 'a' && d <= 'z') d -= 0x20;
        if (d >= 'A' && d <= 'Z') poke8(fcb_base, (uint8_t)(d - 'A' + 1));
        p += 2;
    }
    int n = 0;
    while (*p && *p != ' ' && *p != '\t' && *p != '\r' && *p != '.') {
        char c = *p++; if (c >= 'a' && c <= 'z') c -= 0x20;
        if (n < 8) poke8(fcb_base + 1 + (uint32_t)n, (uint8_t)c);
        n++;
    }
    if (*p == '.') {
        p++; int e = 0;
        while (*p && *p != ' ' && *p != '\t' && *p != '\r') {
            char c = *p++; if (c >= 'a' && c <= 'z') c -= 0x20;
            if (e < 3) poke8(fcb_base + 9 + (uint32_t)e, (uint8_t)c);
            e++;
        }
    }
    return p;
}

int qb_dos_exec_load(const uint8_t *image, size_t size,
                     const char *cmdtail, uint16_t env_seg,
                     const char *child_name,
                     uint32_t fcb1_lin, uint32_t fcb2_lin) {
    if (!image || size < 2) return -1;
    uint16_t magic = read_le16(image);
    int is_exe = (magic == 0x5A4D || magic == 0x4D5A);   /* MZ/ZM=EXE、それ以外=COM */

    /* ---- フォーマット別に body サイズ・エントリ・reloc を確定 ----
     * EXE: MZ ヘッダを解析。COM: ファイル全体が body で PSP:0x100 にロード、全 segreg=PSP。
     * (zar は MZ エンジン siz*.exe を EXEC、Ray は COM の常駐音源ドライバ RIN.COM を EXEC する) */
    size_t   header_bytes = 0, body_bytes = 0;
    uint16_t e_crlc = 0, e_lfarlc = 0;
    uint16_t e_cs = 0, e_ip = 0, e_ss = 0, e_sp = 0, e_minalloc = 0;

    if (is_exe) {
        if (size < 0x1C) return -1;
        uint16_t e_cblp    = read_le16(image + 0x02);
        uint16_t e_cp      = read_le16(image + 0x04);
        e_crlc             = read_le16(image + 0x06);
        uint16_t e_cparhdr = read_le16(image + 0x08);
        e_minalloc         = read_le16(image + 0x0A);
        e_ss               = read_le16(image + 0x0E);
        e_sp               = read_le16(image + 0x10);
        e_ip               = read_le16(image + 0x14);
        e_cs               = read_le16(image + 0x16);
        e_lfarlc           = read_le16(image + 0x18);

        size_t image_size_file = (size_t)e_cp * 512;
        if (e_cblp != 0) { if (e_cp == 0) return -4; image_size_file -= (512 - e_cblp); }
        if (image_size_file > size) return -5;
        header_bytes = (size_t)e_cparhdr * 16;
        if (header_bytes < 0x1C || header_bytes > image_size_file) return -6;
        body_bytes = image_size_file - header_bytes;
        /* reloc テーブルがファイル外を指していないか確保前に検証する (確保後に弾くと
         * 割り当て済み MCB ブロックがリークするため。qb_dos_stage_exe と同じ前段チェック)。 */
        if (e_crlc > 0 && (uint32_t)e_lfarlc + (uint32_t)e_crlc * 4 > size) return -8;
        /* 各 reloc ターゲットが body 内を指すかも確保前に検証する (qb_dos_stage_exe:return -9
         * と同じ。これが無いと壊れた/巨大 reloc を持つ子 EXE が、適用ループの 2MB 配列マスク
         * を通って他プログラム/PSP/IVT を書き換えてしまう)。rec+4<=size は上の行で保証済み。 */
        for (uint16_t i = 0; i < e_crlc; i++) {
            uint32_t rec = (uint32_t)e_lfarlc + (uint32_t)i * 4;
            uint32_t tgt = (uint32_t)read_le16(image + rec + 2) * 16 + read_le16(image + rec);
            if (tgt + 1 >= body_bytes) return -9;
        }
    } else {
        if (size > 0xFF00) return -2;   /* 64KB - PSP(256) を超える COM は不正 */
        body_bytes = size;              /* COM は header 無し: 全体が body */
    }

    /* per-child env (C1): 継承 (env_seg=0) の子に固有 env を新規確保し argv[0] を子パスに正規化。
     * 子本体は「最大空きブロック丸ごと」を取るので、env は子本体より先に確保する (= 子の
     * ロード位置が env 分だけ上にずれるが reloc EXE / PSP 相対 COM とも透過)。所有者は確保時点で
     * 親、child_psp 確定後に子へ付け替える。確保失敗時は 0 のまま親 env にフォールバック。 */
    uint16_t child_env_seg = 0;
    if (env_seg == 0) {
        uint32_t ppsp = (uint32_t)g_cur_psp << 4;
        uint16_t parent_env = (uint16_t)(mem[ppsp + 0x2C] | (mem[ppsp + 0x2D] << 8));
        child_env_seg = build_child_env(parent_env ? parent_env : QB_DOS_ENV_SEG, child_name);
    }

    /* DOS の EXEC は子に「最大空きブロック」を渡す。子はその中に PSP+イメージを置き、
     * 起動直後に 4Ah (EXE 自己縮小) または 31h TSR (COM ドライバ常駐) で自身を縮める。 */
    uint16_t free_sz = 0;
    uint16_t free_mcb = mcb_largest_free(&free_sz);
    uint32_t body_paras = (uint32_t)((body_bytes + 15) >> 4);
    /* PSP(16) + body + (EXE: minalloc / COM: stack ヘッドルーム少々) */
    uint32_t need = 0x10 + body_paras + (uint32_t)e_minalloc + (is_exe ? 0u : 0x10u);
    if (free_mcb == 0 || (uint32_t)free_sz < need) {
        if (child_env_seg) qb_dos_alloc_free(child_env_seg);  /* 子が入らない → 先取り env を巻き戻す */
        return -10;  /* メモリ不足 */
    }
    uint16_t child_psp = (uint16_t)(free_mcb + 1);
    uint16_t child_img = (uint16_t)(child_psp + 0x10);
    mcb_set(free_mcb, mcb_sig(free_mcb), child_psp, free_sz);   /* 子に丸ごと割り当て */
    /* env ブロックの所有者を子 PSP へ付け替え (子終了で free-on-terminate、TSR では resize 任せで残留)。 */
    if (child_env_seg) {
        uint16_t emcb = (uint16_t)(child_env_seg - 1);
        mcb_set(emcb, mcb_sig(emcb), child_psp, mcb_size(emcb));
    }

    /* body をゲストメモリへコピー (EXE は header strip 後、COM は丸ごと)。
     * EXE/COM とも load 先は child_img:0 = child_psp:0x0100 (COM の PSP:0x100 慣例)。 */
    uint32_t load_lin = (uint32_t)child_img << 4;
    memcpy(&mem[load_lin], image + header_bytes, body_bytes);

    /* relocation (EXE のみ; COM は e_crlc=0 でループ無し): 16-bit segment に child_img を加算 */
    for (uint16_t i = 0; i < e_crlc; i++) {
        uint32_t rec = (uint32_t)e_lfarlc + (uint32_t)i * 4;
        if (rec + 4 > size) return -8;
        uint16_t r_off = read_le16(image + rec);
        uint16_t r_seg = read_le16(image + rec + 2);
        uint32_t a = load_lin + ((uint32_t)r_seg * 16 + r_off);
        /* 壊れた/巨大な子 EXE の reloc で mem[] 配列外を踏まないよう必ずマスクする
         * (staging 経路や poke* と同じ流儀。poke16 が両バイトをマスクして書く)。 */
        uint16_t cur = (uint16_t)mem[a & QB_GUEST_MEM_MASK]
                     | ((uint16_t)mem[(a + 1) & QB_GUEST_MEM_MASK] << 8);
        poke16(a, (uint16_t)(cur + child_img));
    }

    /* 子 PSP を構築 (親 PSP を 0x16 に保存、env/cmdtail をセット) */
    uint16_t parent_psp = g_cur_psp;
    uint32_t pbase = (uint32_t)child_psp << 4;
    memset(&mem[pbase], 0, 0x100);
    poke8(pbase + 0x00, 0xCD); poke8(pbase + 0x01, 0x20);   /* INT 20h */
    poke16(pbase + 0x02, QB_DOS_MEM_TOP_SEG);               /* top of memory */
    poke16(pbase + 0x16, parent_psp);                       /* 親 PSP */
    /* env: ① パラメータブロック明示 (env_seg!=0) → そのまま指す (完全 faithful は拡張ポイント、
     *      build_child_env のコメント参照。corpus に該当タイトル無し)。② 継承 (env_seg=0) →
     *      build_child_env で確保した子固有 env (argv[0]=子パス、C1 解消)。③ ②の確保失敗時のみ
     *      従来どおり親 env を共有 (argv[0] は親パスになるがフォールバックとして許容)。 */
    poke16(pbase + 0x2C, env_seg ? env_seg
                                 : (child_env_seg ? child_env_seg : QB_DOS_ENV_SEG));
    poke8(pbase + 0x50, 0xCD); poke8(pbase + 0x51, 0x21); poke8(pbase + 0x52, 0xCB);
    {
        size_t cl = cmdtail ? strlen(cmdtail) : 0;
        if (cl > 126) cl = 126;
        poke8(pbase + 0x80, (uint8_t)cl);
        for (size_t i = 0; i < cl; i++) poke8(pbase + 0x81 + i, (uint8_t)cmdtail[i]);
        poke8(pbase + 0x81 + cl, 0x0D);
    }
    /* 子 PSP:005C/006C の FCB1/FCB2 を用意 (実機 DOS faithful)。
     * ① caller が明示 (fcb*_lin!=0): 親が AH=29h で組んだ FCB をそのまま複写
     *    (kanipic.exe の KANI.SCR 生成経路)。
     * ② caller 未指定 (.bat shell 経由など、fcb1_lin==0): 実機 COMMAND.COM 同様、コマンドテイルの
     *    第1/第2トークンを FCB1/FCB2 へ parse して置く。FCB1 のファイル名から起動引数を読むツール
     *    (東方 zun.com 等) はこれが無いと「未知コマンド」と判断して常駐に失敗する。 */
    if (fcb1_lin) {
        for (int i = 0; i < 16; i++)
            poke8(pbase + 0x5C + i, mem[(fcb1_lin + i) & QB_GUEST_MEM_MASK]);
        if (fcb2_lin) for (int i = 0; i < 16; i++)
            poke8(pbase + 0x6C + i, mem[(fcb2_lin + i) & QB_GUEST_MEM_MASK]);
    } else {
        const char *p = cmdtail ? cmdtail : "";
        p = build_one_fcb(pbase + 0x5C, p);   /* 第1トークン → FCB1 */
        build_one_fcb(pbase + 0x6C, p);       /* 第2トークン → FCB2 */
    }

    /* ---- 段階2: 親コンテキストを退避 (子終了でここへ戻る) ----
     * この時点で CPU_SS:SP はまだ親スタックを指し、その先頭に親の INT 21h AH=4Bh が
     * 積んだ IRET フレーム (IP/CS/FLAGS) がある。g_cur_psp もまだ親の値。 */
    if (g_exec_sp < (int)(sizeof(g_exec_stack) / sizeof(g_exec_stack[0]))) {
        exec_frame_t *f = &g_exec_stack[g_exec_sp++];
        uint32_t splin = ((uint32_t)CPU_SS << 4) + CPU_SP;
        f->ret_ip = (uint16_t)(mem[splin]     | (mem[splin + 1] << 8));
        f->ret_cs = (uint16_t)(mem[splin + 2] | (mem[splin + 3] << 8));
        f->flags  = (uint16_t)(mem[splin + 4] | (mem[splin + 5] << 8));
        f->ret_ss = CPU_SS;
        f->ret_sp = (uint16_t)(CPU_SP + 6);    /* IRET フレーム 6byte を pop した後 */
        f->ds = CPU_DS; f->es = CPU_ES;
        f->ax = CPU_AX; f->bx = CPU_BX; f->cx = CPU_CX; f->dx = CPU_DX;
        f->si = CPU_SI; f->di = CPU_DI; f->bp = CPU_BP;
        f->psp_seg = g_cur_psp;
        uint32_t dta = qb_dos_dta_get_packed();   /* 親 DTA を退避 (子終了で復元) */
        f->dta_seg = (uint16_t)(dta >> 16);
        f->dta_off = (uint16_t)(dta & 0xFFFF);
        f->fh_mask = qb_dos_fh_snapshot();        /* 親が開いていたハンドル (子終了で差分を閉じる) */
    } else {
        fprintf(stderr, "[dos_exec] WARN: EXEC ネスト過多 → この子は親復帰なし\n");
    }

    /* 現プロセス PSP を子に切替 (子の 48h 確保はこの PSP を所有者にする) */
    g_cur_psp = child_psp;
    /* 子の既定 DTA = 子 PSP:0080 (実機 DOS と同じ)。これがないと子が AH=1Ah 無しで
     * FindFirst したとき親 PSP の cmdline 領域に結果を書いてしまう。 */
    qb_dos_dta_set(child_psp, 0x0080);

    /* ---- CPU を子エントリへ ---- */
    CPU_EAX = 0; CPU_EBX = 0; CPU_ECX = 0; CPU_EDX = 0; CPU_EBP = 0;
    /* 子も IF=1 で起動する (INT 21h AH=4Bh が IF をクリアしているため立て直す)。
     * RIN.COM のような常駐ドライバが IRQ 待ちで止まらないように。 */
    CPU_FLAG |= I_FLAG;
    if (is_exe) {
        CPU_CS = (uint16_t)(child_img + e_cs);
        CPU_IP = e_ip;
        CPU_SS = (uint16_t)(child_img + e_ss);
        CPU_SP = e_sp;
        CPU_DS = child_psp;
        CPU_ES = child_psp;
        CPU_ESI = e_ip; CPU_EDI = e_sp;
    } else {
        /* COM: 全 segreg = PSP、IP=0x100。SP はブロック末尾 (64KB 以上なら 0xFFFE)。
         * SS:SP に 0x0000 を 1 word push (near RET → PSP:0000 = INT 20h 終了)。 */
        uint16_t com_sp = (free_sz >= 0x1000)
                            ? 0xFFFE
                            : (uint16_t)(((uint32_t)free_sz << 4) - 2);
        CPU_CS = child_psp; CPU_IP = 0x0100;
        CPU_SS = child_psp; CPU_SP = com_sp;
        CPU_DS = child_psp; CPU_ES = child_psp;
        uint32_t splin = ((uint32_t)child_psp << 4) + com_sp;
        mem[splin] = 0; mem[splin + 1] = 0;
        CPU_ESI = 0x0100; CPU_EDI = 0;
    }

    fprintf(stderr,
            "[dos_exec] child @ PSP=%04X img=%04X entry=%04X:%04X SS:SP=%04X:%04X "
            "kind=%s (parent PSP=%04X 常駐, block=%u para)\n",
            child_psp, child_img, CPU_CS, CPU_IP, CPU_SS, CPU_SP,
            is_exe ? "EXE" : "COM", (unsigned)parent_psp, (unsigned)free_sz);
    return 0;
}

/* ---------------- AH=4Bh AL=03h Load Overlay ----------------
 * AL=00 (EXEC) と違い、呼び出し元が確保済みのメモリ (load_seg:0000) に子イメージを置くだけ。
 * PSP は作らず・MCB も触らず・CPU も切り替えない (呼び出し元へ CF=0 で戻り、呼び出し元が overlay
 * の入口へ自分で far call する)。EXE の relocation は reloc_factor を各セグメントワードに加算する
 * (実 DOS の overlay と同契約: 多くの呼び出し元は load_seg と同値を渡す)。COM は relocation 無しで
 * load_seg:0000 から丸ごと展開する。境界・reloc 検証は exec_load と同流儀で行う。 */
int qb_dos_overlay_load(const uint8_t *image, size_t size,
                        uint16_t load_seg, uint16_t reloc_factor) {
    if (!image || size < 2) return -1;
    uint16_t magic = read_le16(image);
    int is_exe = (magic == 0x5A4D || magic == 0x4D5A);

    size_t   header_bytes = 0, body_bytes = 0;
    uint16_t e_crlc = 0, e_lfarlc = 0;
    if (is_exe) {
        if (size < 0x1C) return -1;
        uint16_t e_cblp    = read_le16(image + 0x02);
        uint16_t e_cp      = read_le16(image + 0x04);
        e_crlc             = read_le16(image + 0x06);
        uint16_t e_cparhdr = read_le16(image + 0x08);
        e_lfarlc           = read_le16(image + 0x18);
        size_t image_size_file = (size_t)e_cp * 512;
        if (e_cblp != 0) { if (e_cp == 0) return -4; image_size_file -= (512 - e_cblp); }
        if (image_size_file > size) return -5;
        header_bytes = (size_t)e_cparhdr * 16;
        if (header_bytes < 0x1C || header_bytes > image_size_file) return -6;
        body_bytes = image_size_file - header_bytes;
        /* reloc テーブルがファイル外 / body 外を指さないか確保前に検証 (exec_load と同じ前段)。 */
        if (e_crlc > 0 && (uint32_t)e_lfarlc + (uint32_t)e_crlc * 4 > size) return -8;
        for (uint16_t i = 0; i < e_crlc; i++) {
            uint32_t rec = (uint32_t)e_lfarlc + (uint32_t)i * 4;
            uint32_t tgt = (uint32_t)read_le16(image + rec + 2) * 16 + read_le16(image + rec);
            if (tgt + 1 >= body_bytes) return -9;
        }
    } else {
        if (size > 0xFF00) return -2;   /* COM 上限 */
        body_bytes = size;
    }

    /* load_seg:0000 へ body をコピー。ゲスト RAM 配列外への書き込みは弾く。 */
    uint32_t load_lin = (uint32_t)load_seg << 4;
    if ((uint64_t)load_lin + body_bytes > (uint64_t)QB_GUEST_MEM_MASK + 1) return -10;
    memcpy(&mem[load_lin], image + header_bytes, body_bytes);

    /* relocation (EXE のみ): 各ターゲットの 16-bit segment に reloc_factor を加算。 */
    for (uint16_t i = 0; i < e_crlc; i++) {
        uint32_t rec = (uint32_t)e_lfarlc + (uint32_t)i * 4;
        uint16_t r_off = read_le16(image + rec);
        uint16_t r_seg = read_le16(image + rec + 2);
        uint32_t a = load_lin + ((uint32_t)r_seg * 16 + r_off);
        uint16_t cur = (uint16_t)mem[a & QB_GUEST_MEM_MASK]
                     | ((uint16_t)mem[(a + 1) & QB_GUEST_MEM_MASK] << 8);
        poke16(a, (uint16_t)(cur + reloc_factor));
    }

    fprintf(stderr,
            "[dos_exec] overlay loaded at %04X:0000 (%s, body=%zu, relocs=%u, factor=%04X)\n",
            load_seg, is_exe ? "EXE" : "COM", body_bytes, (unsigned)e_crlc, (unsigned)reloc_factor);
    return 0;
}
