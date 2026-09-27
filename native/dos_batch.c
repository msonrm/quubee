/* dos_batch.c — .bat を実行時に 1 行ずつ解釈する (ミニ COMMAND.COM の頭脳、2026-09-27)。
 *
 * 旧方式は JS (batscript.js buildStatements) が .bat を事前に文の列へ直し、C はその列を実行する
 * だけだった。%VAR% や「IF の後ろに任意のコマンド」は実行時にしか決まらないので原理的に扱えず、
 * 内部コマンド (TYPE・DEL・PAUSE…) は黙って読み飛ばしていた。ここでは実 DOS の COMMAND.COM と
 * 同じく、シェルが「次コマンド?」を問い合わせるたびに .bat の次の行を読み、
 *   1. %0〜%9 (SHIFT 反映)・%%・%VAR% (DOS の環境変数) を展開し
 *   2. 内部コマンドならその場で実行 (ECHO・SET・CD・IF・GOTO・CALL・SHIFT・PAUSE…)
 *   3. 外部プログラムなら探して (カレント → PATH → 書庫全体を基本名で)、EXEC するパスと
 *      コマンドテイルを返す。見つからなければ「Bad command or file name」を出して次の行へ
 * を行う。errorlevel は直近の EXEC 子の終了コード (qb_dos_errorlevel)。
 *
 * 状態は固定長の構造体 1 つ (本文のプール + 入れ子の文脈) に収め、ステートセーブの "BATR" 区画に
 * 丸ごと書く (.bat の途中でセーブしても続きから再開できる)。 */
#include <compiler.h>
#include <stdio.h>
#include <string.h>
#include <ctype.h>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

#include "dos_batch.h"
#include "dos_int21.h"
#include "qb_state.h"

extern void    qb_dos_env_assign(const char *assign, size_t len);   /* dos_loader.c */
extern int     qb_dos_env_get(const char *name, char *out, size_t cap);
extern uint8_t qb_dos_errorlevel(void);

#define BAT_POOL    (64 * 1024)   /* 全文脈の .bat 本文の合計 */
#define BAT_DEPTH   8             /* CALL の入れ子 */
#define BAT_ARGS    16            /* %0 + 引数 (SHIFT で送れる分も持つ) */
#define BAT_ARGLEN  128
#define BAT_LINE    512
#define BAT_STEP_LIMIT 20000      /* EXEC を挟まずに処理する行数の上限 (:A → GOTO A の空回り対策) */

#define CTX_BAT     0             /* .bat ファイル */
#define CTX_FOR     1             /* FOR が展開した行 (GOTO するとループを抜ける) */
#define CTX_CMDLINE 2             /* COMSPEC /C で渡された 1 行 */
#define CTX_PIPE    3             /* パイプ a | b を一時ファイル経由の行に書き換えたもの */
#define RD_STATE_MAX 2400         /* dos_int21.c の差し替え状態 (ステートセーブ用の控え) */

typedef struct {
    uint32_t off, len;            /* 本文 (プール内) */
    uint32_t pc;                  /* 次に読む行の先頭 (本文内のバイト位置) */
    uint16_t owner;               /* この文脈を実行するシェルの PSP (0 = 次に問い合わせたシェルが引き取る) */
    uint16_t kind;                /* CTX_* */
    uint32_t nargs;
    char     args[BAT_ARGS][BAT_ARGLEN];   /* args[0] = %0 */
} bat_ctx;

static struct {
    int      rt;                  /* このセッションのシェルは実行時解釈を使う (旧方式の文列ではない) */
    uint16_t scratch_path, scratch_tail;   /* シェル内の作業領域 (EXEC するパス / コマンドテイル) */
    int      active;
    int      started;             /* 最初の問い合わせで .bat のディレクトリへ cd 済み */
    int      pause_nl;            /* PAUSE のキー待ちから戻ったら改行する */
    char     start_dir[192];      /* 起動 .bat のディレクトリ (DOS パス) */
    uint16_t top_psp;             /* 最上位のシェル (Run が立てたもの) の PSP。0 = 最上位は .bat ではない */
    int      rd_n;                /* EXEC のために積んだ標準入出力の差し替え */
    uint16_t rd_owner[4];         /*  それぞれを積んだシェルの PSP (そのシェルが次を問い合わせたら外す) */
    uint32_t pipe_seq;            /* パイプの一時ファイル番号 */
    uint32_t rd_state_len;
    uint8_t  rd_state[RD_STATE_MAX];   /* ステートセーブ時に dos_int21.c の差し替え状態を写す */
    int      nctx;
    bat_ctx  ctx[BAT_DEPTH];
    uint32_t pool_used;
    char     pool[BAT_POOL];
} B;

/* ---- 小道具 ---- */
static int sjis_lead(unsigned char c) { return (c >= 0x81 && c <= 0x9F) || (c >= 0xE0 && c <= 0xFC); }
/* 内部コマンドの出力先: 画面か、> で指定されたファイル (NUL は捨てる) */
static FILE *g_cmd_out;
static int   g_cmd_out_null;
static void out_bytes(const uint8_t *b, size_t n) {
    if (g_cmd_out_null) return;
    if (g_cmd_out) { fwrite(b, 1, n, g_cmd_out); return; }
    qb_dos_tty_write(b, (int)n);
}
static void out_str(const char *s) { out_bytes((const uint8_t *)s, strlen(s)); }
static void out_line(const char *s) { out_str(s); out_str("\r\n"); }
static int ci_eq(const char *a, const char *b) {
    while (*a && *b) { if (toupper((unsigned char)*a) != toupper((unsigned char)*b)) return 0; a++; b++; }
    return *a == '\0' && *b == '\0';
}
static int ci_prefix(const char *s, const char *pre) {   /* s が pre (大文字) で始まる */
    while (*pre) { if (toupper((unsigned char)*s) != (unsigned char)*pre) return 0; s++; pre++; }
    return 1;
}
static int ci_prefix8(const char *a, const char *b) {   /* 先頭 8 文字が大小無視で一致 */
    for (int i = 0; i < 8; i++) if (toupper((unsigned char)a[i]) != toupper((unsigned char)b[i])) return 0;
    return 1;
}
static const char *skip_ws(const char *p) { while (*p == ' ' || *p == '\t') p++; return p; }
static void rtrim(char *s) { size_t n = strlen(s); while (n && (s[n - 1] == ' ' || s[n - 1] == '\t')) s[--n] = '\0'; }
static int is_delim(unsigned char c) { return c == ' ' || c == '\t' || c == ',' || c == ';' || c == '='; }
/* 次の語を out へ (区切り = 空白・タブ・,;=)。戻り値 = 語の直後 */
static const char *next_word(const char *p, char *out, size_t cap) {
    size_t n = 0;
    while (*p && is_delim((unsigned char)*p)) p++;
    while (*p && !is_delim((unsigned char)*p)) {
        if (sjis_lead((unsigned char)*p) && p[1]) { if (n + 2 < cap) { out[n++] = p[0]; out[n++] = p[1]; } p += 2; continue; }
        if (n + 1 < cap) out[n++] = *p;
        p++;
    }
    out[n] = '\0';
    return p;
}
/* 引数列 (空白区切り) を args[1..] へ。args[0] は呼び出し側が入れる */
static uint32_t split_args(const char *s, char args[][BAT_ARGLEN], uint32_t first) {
    uint32_t n = first;
    char w[BAT_ARGLEN];
    for (;;) {
        s = next_word(s, w, sizeof(w));
        if (!w[0] || n >= BAT_ARGS) break;
        snprintf(args[n++], BAT_ARGLEN, "%s", w);
    }
    return n;
}

/* ---- 文脈 (.bat 1 本ぶん) ---- */
static bat_ctx *top(void) { return B.nctx ? &B.ctx[B.nctx - 1] : NULL; }
static void pop(void) { if (B.nctx) { B.pool_used = B.ctx[B.nctx - 1].off; B.nctx--; } }

/* 本文を文脈として積む。replace = 今の文脈と差し替える (CALL なしで別の .bat を呼んだとき = 実 DOS は
 * 呼び元へ戻らない)。owner は差し替え・入れ子なら呼び元と同じシェル。0 = 成功 / 負 = 満杯 */
static int push_text(const char *text, uint32_t len, char args[][BAT_ARGLEN], uint32_t nargs, int replace,
                     uint16_t kind, const char *what) {
    uint16_t owner = B.nctx ? B.ctx[B.nctx - 1].owner : 0;
    if (replace) pop();
    if (B.nctx >= BAT_DEPTH) { fprintf(stderr, "[batch] 入れ子が深すぎる: %s\n", what); return -2; }
    if (B.pool_used + len + 1 >= BAT_POOL) { fprintf(stderr, "[batch] 本文が大きすぎる: %s\n", what); return -3; }
    uint32_t off = B.pool_used;
    memcpy(B.pool + off, text, len);
    bat_ctx *x = &B.ctx[B.nctx++];
    memset(x, 0, sizeof(*x));
    x->off = off; x->len = len; x->pc = 0; x->owner = owner; x->kind = kind;
    x->nargs = nargs > BAT_ARGS ? BAT_ARGS : nargs;
    for (uint32_t i = 0; i < x->nargs; i++) snprintf(x->args[i], BAT_ARGLEN, "%s", args[i]);
    B.pool_used = off + len;
    return 0;
}

/* .bat (DOS パス) を読んで文脈を積む。0 = 成功 / 負 = 読めない・満杯 */
static int push_bat(const char *dos, char args[][BAT_ARGLEN], uint32_t nargs, int replace) {
    char host[256];
    static char buf[BAT_POOL];
    if (qb_dos_path_to_host(dos, host, sizeof(host)) != 0) return -1;
    FILE *fp = fopen(host, "rb");
    if (!fp) return -1;
    uint32_t len = 0;
    int c;
    while ((c = fgetc(fp)) != EOF && c != 0x1A && len + 1 < sizeof(buf)) buf[len++] = (char)c;   /* ^Z = EOF マーク */
    fclose(fp);
    int r = push_text(buf, len, args, nargs, replace, CTX_BAT, dos);
    if (r == 0) fprintf(stderr, "[batch] %s %s (%u byte, 入れ子 %d)\n", replace ? "chain" : "open", dos, (unsigned)len, B.nctx);
    return r;
}

/* 次の 1 行を out へ (CR/LF を除く)。尽きたら 0 */
static int fetch_line(bat_ctx *x, char *out, size_t cap) {
    if (x->pc >= x->len) return 0;
    const char *t = B.pool + x->off;
    size_t n = 0;
    while (x->pc < x->len && t[x->pc] != '\n') {
        char ch = t[x->pc++];
        if (ch != '\r' && n + 1 < cap) out[n++] = ch;
    }
    if (x->pc < x->len) x->pc++;                             /* '\n' */
    out[n] = '\0';
    return 1;
}

/* %0〜%9・%%・%VAR% を展開する */
static void expand(const bat_ctx *x, const char *in, char *out, size_t cap) {
    size_t n = 0;
    #define PUT(ch) do { if (n + 1 < cap) out[n++] = (ch); } while (0)
    for (size_t i = 0; in[i]; ) {
        unsigned char c = (unsigned char)in[i];
        if (sjis_lead(c) && in[i + 1]) { PUT(in[i]); PUT(in[i + 1]); i += 2; continue; }
        if (c != '%') { PUT(in[i]); i++; continue; }
        char d = in[i + 1];
        if (d >= '0' && d <= '9') {
            uint32_t k = (uint32_t)(d - '0');
            if (x && k < x->nargs) for (const char *a = x->args[k]; *a; a++) PUT(*a);
            i += 2; continue;
        }
        if (d == '%') { PUT('%'); i += 2; continue; }
        size_t j = i + 1;                                     /* %NAME% */
        while (in[j] && in[j] != '%') j += (sjis_lead((unsigned char)in[j]) && in[j + 1]) ? 2 : 1;
        if (in[j] == '%' && j > i + 1) {
            char name[64], val[256];
            size_t nl = j - i - 1; if (nl >= sizeof(name)) nl = sizeof(name) - 1;
            memcpy(name, in + i + 1, nl); name[nl] = '\0';
            if (qb_dos_env_get(name, val, sizeof(val))) for (const char *v = val; *v; v++) PUT(*v);
            i = j + 1; continue;
        }
        i++;                                                   /* 対になる % が無い: % を捨てる (実 DOS と同じ) */
    }
    out[n] = '\0';
    #undef PUT
}

/* ---- プログラムを探す ----
 * name (拡張子・パス可) を実 DOS の順 (カレント → PATH の各ディレクトリ) で .COM → .EXE → .BAT と探し、
 * 見つからなければ書庫全体を基本名で探す (旧 JS 方式の互換: .bat と本体の置き場所がずれた書庫)。
 * 見つかれば 0 と、ルート起点の DOS パス (例 "\IV\MUAP98.COM") を out へ。 */
static void host_to_dos(const char *host, char *out, size_t cap) {
    const char *p = host;
    if (strncmp(p, "/run", 4) == 0) p += 4;
    size_t n = 0;
    if (*p != '/' && n + 1 < cap) out[n++] = '\\';
    for (; *p && n + 1 < cap; p++) out[n++] = (*p == '/') ? '\\' : *p;
    out[n] = '\0';
}
static int try_candidates(const char *base_dos, int has_ext, char *out, size_t cap) {
    static const char *sfx[] = { ".COM", ".EXE", ".BAT" };
    char cand[256], host[256];
    if (has_ext) {
        if (qb_dos_path_to_host(base_dos, host, sizeof(host)) == 0) { host_to_dos(host, out, cap); return 0; }
        return -1;
    }
    for (int i = 0; i < 3; i++) {
        snprintf(cand, sizeof(cand), "%s%s", base_dos, sfx[i]);
        if (qb_dos_path_to_host(cand, host, sizeof(host)) == 0) { host_to_dos(host, out, cap); return 0; }
    }
    return -1;
}
static int walk_find(const char *hostdir, const char *leaf, int has_ext, char *out, size_t cap, int depth) {
    DIR *d = opendir(hostdir);
    if (!d) return -1;
    struct dirent *e;
    char sub[256];
    int found = -1;
    /* 先にこの階層のファイル、次にサブディレクトリ (浅いものを優先) */
    while (found != 0 && (e = readdir(d)) != NULL) {
        if (e->d_name[0] == '.') continue;
        char want[160];
        static const char *sfx[] = { "", ".COM", ".EXE", ".BAT" };
        for (int i = has_ext ? 0 : 1; i < (has_ext ? 1 : 4) && found != 0; i++) {
            snprintf(want, sizeof(want), "%s%s", leaf, sfx[i]);
            if (ci_eq(e->d_name, want)) {
                snprintf(sub, sizeof(sub), "%s/%s", hostdir, e->d_name);
                host_to_dos(sub, out, cap);
                found = 0;
            }
        }
    }
    if (found != 0 && depth < 6) {
        rewinddir(d);
        while (found != 0 && (e = readdir(d)) != NULL) {
            if (e->d_name[0] == '.') continue;
            snprintf(sub, sizeof(sub), "%s/%s", hostdir, e->d_name);
            struct stat st;
            if (stat(sub, &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            found = walk_find(sub, leaf, has_ext, out, cap, depth + 1);
        }
    }
    closedir(d);
    return found;
}
static int resolve_program(const char *name, char *out, size_t cap) {
    const char *leaf = name;
    for (const char *p = name; *p; p++) {
        if (sjis_lead((unsigned char)*p) && p[1]) { p++; continue; }
        if (*p == '\\' || *p == ':') leaf = p + 1;
    }
    int has_ext = strchr(leaf, '.') != NULL;
    if (leaf != name) return try_candidates(name, has_ext, out, cap);   /* パス付き = その場所だけ */
    if (try_candidates(name, has_ext, out, cap) == 0) return 0;          /* カレント */
    char path[256];
    if (qb_dos_env_get("PATH", path, sizeof(path))) {
        for (char *s = path; *s; ) {
            char *e = strchr(s, ';');
            if (e) *e = '\0';
            if (*s) {
                char dir[200], cand[256];
                snprintf(dir, sizeof(dir), "%s", s);
                size_t dl = strlen(dir);
                snprintf(cand, sizeof(cand), "%s%s%s", dir, (dl && dir[dl - 1] == '\\') ? "" : "\\", name);
                if (try_candidates(cand, has_ext, out, cap) == 0) return 0;
            }
            if (!e) break;
            s = e + 1;
        }
    }
    if (walk_find("/run", name, has_ext, out, cap, 0) == 0) {
        fprintf(stderr, "[batch] %s: カレントと PATH に無いので書庫全体から %s を使う\n", name, out);
        return 0;
    }
    return -1;
}
static int is_bat_path(const char *dos) {
    size_t n = strlen(dos);
    return n >= 4 && ci_eq(dos + n - 4, ".BAT");
}

/* ---- ファイル操作 (内部コマンド) ----
 * すべて /run (書庫を展開した MEMFS) の上で行う。名前の照合は FindFirst と同じ規則 (大小無視)。
 * 新しく作るファイル名は実 DOS と同じく大文字。ブラウザのファイル一覧は /run の同期で追随する。 */
extern const char *qb_dos_env_block(size_t *len);   /* dos_loader.c */

static int has_wild(const char *s) { return strchr(s, '*') || strchr(s, '?'); }
static void upcase(char *s) { for (; *s; s++) { if (sjis_lead((unsigned char)*s) && s[1]) { s++; continue; } *s = (char)toupper((unsigned char)*s); } }
static int host_is_dir(const char *host) { struct stat st; return stat(host, &st) == 0 && S_ISDIR(st.st_mode); }
static int host_is_file(const char *host) { struct stat st; return stat(host, &st) == 0 && S_ISREG(st.st_mode); }

/* DOS パスを「ディレクトリ (host)」と「末尾の名前/パターン」に分ける。ディレクトリが無ければ -1 */
static int split_dos(const char *dos, char *hdir, size_t hcap, char *leaf, size_t lcap) {
    const char *l = dos;
    for (const char *p = dos; *p; p++) {
        if (sjis_lead((unsigned char)*p) && p[1]) { p++; continue; }
        if (*p == '\\' || *p == '/' || *p == ':') l = p + 1;
    }
    char probe[300], host[300];
    snprintf(probe, sizeof(probe), "%.*sQB$PROBE", (int)(l - dos), dos);
    if (qb_dos_path_to_host(probe, host, sizeof(host)) == 2) return -1;
    char *sl = strrchr(host, '/');
    if (sl) *sl = '\0';
    snprintf(hdir, hcap, "%s", host);
    snprintf(leaf, lcap, "%s", l);
    return 0;
}

/* dir の中で pat に一致するファイル名を集める (ディレクトリは dirs_too のときだけ)。一致した数 */
#define MATCH_MAX 256
static int list_match_n(const char *hdir, const char *pat, char names[][64], int dirs_too, int max);
#define list_match(d, p, names, dirs) list_match_n((d), (p), (names), (dirs), (int)(sizeof(names) / sizeof((names)[0])))
static int list_match_n(const char *hdir, const char *pat, char names[][64], int dirs_too, int max) {
    DIR *d = opendir(hdir);
    if (!d) return 0;
    int n = 0;
    struct dirent *e;
    while ((e = readdir(d)) != NULL && n < max) {
        if (e->d_name[0] == '.') continue;
        char h[320];
        snprintf(h, sizeof(h), "%s/%s", hdir, e->d_name);
        if (!(host_is_file(h) || (dirs_too && host_is_dir(h)))) continue;
        if (!qb_dos_wildcard_match(pat, e->d_name)) continue;
        snprintf(names[n++], 64, "%s", e->d_name);
    }
    closedir(d);
    return n;
}

/* ワイルドカード入りの行き先名を元の名前から作る (COPY *.TXT *.BAK / REN A*.DAT B*.DAT) */
static void apply_pattern(const char *src, const char *pat, char *out, size_t cap) {
    char sb[64], se[64], pb[64], pe[64], ob[64], oe[64];
    const char *d;
    d = strrchr(src, '.'); snprintf(sb, sizeof(sb), "%.*s", d ? (int)(d - src) : (int)strlen(src), src); snprintf(se, sizeof(se), "%s", d ? d + 1 : "");
    d = strrchr(pat, '.'); snprintf(pb, sizeof(pb), "%.*s", d ? (int)(d - pat) : (int)strlen(pat), pat); snprintf(pe, sizeof(pe), "%s", d ? d + 1 : "");
    int pat_has_dot = strchr(pat, '.') != NULL;
    const char *fs[2] = { sb, se }, *fp[2] = { pb, pe };
    char *fo[2] = { ob, oe };
    for (int k = 0; k < 2; k++) {
        size_t n = 0, i = 0;
        for (const char *q = fp[k]; *q && n + 1 < 64; q++) {
            if (*q == '*') { while (fs[k][i] && n + 1 < 64) fo[k][n++] = fs[k][i++]; break; }
            if (*q == '?') { if (fs[k][i]) fo[k][n++] = fs[k][i]; i++; continue; }
            fo[k][n++] = *q; if (fs[k][i]) i++;
        }
        fo[k][n] = '\0';
    }
    if (!pat_has_dot) snprintf(oe, sizeof(oe), "%s", "");
    snprintf(out, cap, oe[0] ? "%s.%s" : "%s", ob, oe);
    upcase(out);
}

static int copy_host(const char *from, const char *to, int append) {
    FILE *in = fopen(from, "rb");
    if (!in) return -1;
    FILE *o = fopen(to, append ? "ab" : "wb");
    if (!o) { fclose(in); return -1; }
    char buf[4096];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), in)) > 0) fwrite(buf, 1, n, o);
    fclose(in); fclose(o);
    return 0;
}

/* 引数列から /X スイッチを除いた語を集める。'+' の前後の空白は詰める (COPY A + B C = A+B C) */
static int collect_words(const char *arg, char w[][BAT_LINE], int max, char *switches, size_t scap) {
    char tmp[BAT_LINE];
    size_t n = 0;
    for (const char *p = arg; *p && n + 1 < sizeof(tmp); p++) {
        if (*p == ' ' && (p[1] == '+' || (n && tmp[n - 1] == '+'))) continue;
        if (*p == '+' && n && tmp[n - 1] == ' ') n--;
        tmp[n++] = *p;
    }
    tmp[n] = '\0';
    int k = 0;
    if (switches) switches[0] = '\0';
    const char *p = tmp;
    for (;;) {
        char one[BAT_LINE];
        p = next_word(p, one, sizeof(one));
        if (!one[0]) break;
        if (one[0] == '/') { if (switches && strlen(switches) + 2 < scap) { size_t l = strlen(switches); switches[l] = (char)toupper((unsigned char)one[1]); switches[l + 1] = '\0'; } continue; }
        if (k < max) snprintf(w[k++], BAT_LINE, "%s", one);
    }
    return k;
}

static void cmd_type(const char *arg) {
    char w[4][BAT_LINE];
    int nw = collect_words(arg, w, 4, NULL, 0);
    if (!nw) { out_line("Required parameter missing"); return; }
    char hdir[300], leaf[128], names[MATCH_MAX][64];
    if (split_dos(w[0], hdir, sizeof(hdir), leaf, sizeof(leaf)) != 0) { out_line("File not found"); return; }
    int n = list_match(hdir, leaf, names, 0);
    if (!n) { out_line("File not found"); return; }
    for (int i = 0; i < n; i++) {
        char h[400];
        snprintf(h, sizeof(h), "%s/%s", hdir, names[i]);
        FILE *fp = fopen(h, "rb");
        if (!fp) continue;
        uint8_t buf[1024];
        size_t r;
        int eof = 0;
        while (!eof && (r = fread(buf, 1, sizeof(buf), fp)) > 0) {
            for (size_t k = 0; k < r; k++) if (buf[k] == 0x1A) { r = k; eof = 1; break; }   /* ^Z で止める */
            out_bytes(buf, r);
        }
        fclose(fp);
    }
}

static void cmd_del(const char *arg) {
    char w[8][BAT_LINE];
    int nw = collect_words(arg, w, 8, NULL, 0);
    if (!nw) { out_line("Required parameter missing"); return; }
    for (int k = 0; k < nw; k++) {
        char hdir[300], leaf[128], names[MATCH_MAX][64];
        char h[400];
        /* ディレクトリを指したら中のファイル全部 (実 DOS と同じ) */
        if (qb_dos_path_to_host(w[k], h, sizeof(h)) == 0 && host_is_dir(h)) {
            snprintf(hdir, sizeof(hdir), "%s", h); snprintf(leaf, sizeof(leaf), "*.*");
        } else if (split_dos(w[k], hdir, sizeof(hdir), leaf, sizeof(leaf)) != 0) { out_line("File not found"); continue; }
        int n = list_match(hdir, leaf, names, 0);
        if (!n) { out_line("File not found"); continue; }
        for (int i = 0; i < n; i++) {
            snprintf(h, sizeof(h), "%s/%s", hdir, names[i]);
            if (remove(h) == 0) fprintf(stderr, "[batch] del %s\n", h);
        }
    }
}

static void cmd_ren(const char *arg) {
    char w[4][BAT_LINE];
    if (collect_words(arg, w, 4, NULL, 0) < 2) { out_line("Required parameter missing"); return; }
    char hdir[300], leaf[128], names[MATCH_MAX][64];
    if (split_dos(w[0], hdir, sizeof(hdir), leaf, sizeof(leaf)) != 0) { out_line("Duplicate file name or file not found"); return; }
    int n = list_match(hdir, leaf, names, 0);
    int done = 0;
    for (int i = 0; i < n; i++) {
        char nn[64], from[400], to[400], same[4][64];
        apply_pattern(names[i], w[1], nn, sizeof(nn));
        snprintf(from, sizeof(from), "%s/%s", hdir, names[i]);
        snprintf(to, sizeof(to), "%s/%s", hdir, nn);
        /* 同名 (大小違い含む) が既にあれば失敗 (自分自身の大小だけ変える REN は通す) */
        int k = list_match(hdir, nn, same, 1);
        if (k > 1 || (k == 1 && strcmp(same[0], names[i]) != 0)) continue;
        if (rename(from, to) == 0) { done++; fprintf(stderr, "[batch] ren %s -> %s\n", from, to); }
    }
    if (!done) out_line("Duplicate file name or file not found");
}

static void cmd_md(const char *arg, int remove_dir) {
    char w[4][BAT_LINE];
    if (!collect_words(arg, w, 4, NULL, 0)) { out_line("Required parameter missing"); return; }
    char h[400];
    int st = qb_dos_path_to_host(w[0], h, sizeof(h));
    if (!remove_dir) {
        char up[400]; snprintf(up, sizeof(up), "%s", h);
        char *sl = strrchr(up, '/'); if (sl) upcase(sl + 1);   /* 新しいディレクトリ名は大文字 */
        if (st != 1 || mkdir(up, 0777) != 0) out_line("Unable to create directory");
    } else {
        if (st != 0 || !host_is_dir(h) || rmdir(h) != 0) out_line("Invalid path, not directory,\r\nor directory not empty");
    }
}

/* COPY: src[+src...] [dst]。ワイルドカード・連結・行き先がディレクトリ/ワイルドカード/ファイルの場合 */
static void cmd_copy(const char *arg) {
    char w[4][BAT_LINE];
    int nw = collect_words(arg, w, 4, NULL, 0);
    if (!nw) { out_line("Required parameter missing"); return; }
    /* 元の一覧 (連結 + ワイルドカード展開) */
    static char srcs[MATCH_MAX][400];
    static char srcnames[MATCH_MAX][64];
    int ns = 0, concat = strchr(w[0], '+') != NULL;
    for (char *part = w[0]; part && *part; ) {
        char *plus = strchr(part, '+');
        if (plus) *plus = '\0';
        char hdir[300], leaf[128], names[MATCH_MAX][64];
        if (split_dos(part, hdir, sizeof(hdir), leaf, sizeof(leaf)) == 0) {
            char h[400];
            if (qb_dos_path_to_host(part, h, sizeof(h)) == 0 && host_is_dir(h)) { snprintf(hdir, sizeof(hdir), "%s", h); snprintf(leaf, sizeof(leaf), "*.*"); }
            int n = list_match(hdir, leaf, names, 0);
            for (int i = 0; i < n && ns < MATCH_MAX; i++) {
                snprintf(srcs[ns], 400, "%s/%s", hdir, names[i]);
                snprintf(srcnames[ns], 64, "%s", names[i]);
                ns++;
            }
        }
        part = plus ? plus + 1 : NULL;
    }
    if (!ns) { out_line("File not found"); out_line("        0 file(s) copied"); return; }
    /* 行き先 */
    char dst[BAT_LINE];
    snprintf(dst, sizeof(dst), "%s", nw >= 2 ? w[1] : "");
    char dh[400];
    int dst_is_dir = 0;
    if (!dst[0]) { snprintf(dst, sizeof(dst), "."); }
    int st = qb_dos_path_to_host(dst, dh, sizeof(dh));
    if (st == 0 && host_is_dir(dh)) dst_is_dir = 1;
    else if (!strcmp(dst, ".") || dst[strlen(dst) - 1] == '\\' || dst[strlen(dst) - 1] == ':') {
        char hd[300], lf[128];
        if (split_dos(dst[0] == '.' && !dst[1] ? "x" : dst, hd, sizeof(hd), lf, sizeof(lf)) == 0) { snprintf(dh, sizeof(dh), "%s", hd); dst_is_dir = 1; }
    }
    int copied = 0;
    if (concat || (!dst_is_dir && !has_wild(dst) && ns > 1)) {   /* 連結 = 1 本のファイルへ */
        char to[400];
        if (nw < 2) snprintf(to, sizeof(to), "%s", srcs[0]);   /* 行き先なしの連結 = 先頭のファイルへ足す */
        else if (dst_is_dir) { char nm[64]; snprintf(nm, sizeof(nm), "%s", srcnames[0]); upcase(nm); snprintf(to, sizeof(to), "%s/%s", dh, nm); }
        else { char hd[300], lf[128]; if (split_dos(dst, hd, sizeof(hd), lf, sizeof(lf)) != 0) { out_line("Invalid directory"); return; }
               if (qb_dos_path_to_host(dst, to, sizeof(to)) != 0) { upcase(lf); snprintf(to, sizeof(to), "%s/%s", hd, lf); } }
        int first = strcmp(to, srcs[0]) == 0;
        for (int i = 0; i < ns; i++) {
            if (i == 0 && first) continue;
            if (copy_host(srcs[i], to, i > 0 || first) == 0) copied = 1;
        }
    } else {
        for (int i = 0; i < ns; i++) {
            char to[400], nm[64];
            if (dst_is_dir) { snprintf(nm, sizeof(nm), "%s", srcnames[i]); upcase(nm); snprintf(to, sizeof(to), "%s/%s", dh, nm); }
            else {
                char hd[300], lf[128];
                if (split_dos(dst, hd, sizeof(hd), lf, sizeof(lf)) != 0) { out_line("Invalid directory"); return; }
                if (has_wild(lf)) apply_pattern(srcnames[i], lf, nm, sizeof(nm)); else { snprintf(nm, sizeof(nm), "%s", lf); upcase(nm); }
                char exist[64][64];
                if (list_match(hd, nm, exist, 0) > 0) snprintf(nm, sizeof(nm), "%s", exist[0]);   /* 既存は大小そのまま上書き */
                snprintf(to, sizeof(to), "%s/%s", hd, nm);
            }
            if (strcmp(to, srcs[i]) == 0) { out_line("File cannot be copied onto itself"); continue; }
            if (copy_host(srcs[i], to, 0) == 0) { copied++; fprintf(stderr, "[batch] copy %s -> %s\n", srcs[i], to); }
        }
    }
    char msg[64]; snprintf(msg, sizeof(msg), "%9d file(s) copied", copied);
    out_line(msg);
}

/* XCOPY src [dst] [/S /E]: ディレクトリごと写す (/S で下の階層も) */
static int xcopy_dir(const char *from, const char *pat, const char *to, int sub) {
    int n = 0;
    DIR *d = opendir(from);
    if (!d) return 0;
    struct dirent *e;
    mkdir(to, 0777);
    while ((e = readdir(d)) != NULL) {
        if (e->d_name[0] == '.') continue;
        char f[400], t[400], nm[64];
        snprintf(f, sizeof(f), "%s/%s", from, e->d_name);
        snprintf(nm, sizeof(nm), "%s", e->d_name); upcase(nm);
        snprintf(t, sizeof(t), "%s/%s", to, nm);
        if (host_is_dir(f)) { if (sub) n += xcopy_dir(f, pat, t, sub); continue; }
        if (!qb_dos_wildcard_match(pat, e->d_name)) continue;
        if (copy_host(f, t, 0) == 0) n++;
    }
    closedir(d);
    return n;
}
static void cmd_xcopy(const char *arg) {
    char w[4][BAT_LINE], sw[16];
    int nw = collect_words(arg, w, 4, sw, sizeof(sw));
    if (!nw) { out_line("Required parameter missing"); return; }
    char from[400], pat[128], to[400];
    if (qb_dos_path_to_host(w[0], from, sizeof(from)) == 0 && host_is_dir(from)) snprintf(pat, sizeof(pat), "*.*");
    else if (split_dos(w[0], from, sizeof(from), pat, sizeof(pat)) != 0) { out_line("File not found"); return; }
    if (nw >= 2) {
        int st = qb_dos_path_to_host(w[1], to, sizeof(to));
        if (st == 2) { out_line("Invalid path"); return; }
        if (st == 1) { char *sl = strrchr(to, '/'); if (sl) upcase(sl + 1); }
    } else {
        char hd[300], lf[128];
        split_dos("x", hd, sizeof(hd), lf, sizeof(lf));
        snprintf(to, sizeof(to), "%s", hd);
    }
    int n = xcopy_dir(from, pat, to, strchr(sw, 'S') || strchr(sw, 'E'));
    char msg[64]; snprintf(msg, sizeof(msg), "%d File(s) copied", n);
    out_line(msg);
}

static void cmd_dir(const char *arg) {
    char w[4][BAT_LINE];
    int nw = collect_words(arg, w, 4, NULL, 0);
    char hdir[300], leaf[128], names[MATCH_MAX][64], h[400];
    const char *spec = nw ? w[0] : "*.*";
    if (qb_dos_path_to_host(spec, h, sizeof(h)) == 0 && host_is_dir(h)) { snprintf(hdir, sizeof(hdir), "%s", h); snprintf(leaf, sizeof(leaf), "*.*"); }
    else if (split_dos(spec, hdir, sizeof(hdir), leaf, sizeof(leaf)) != 0) { out_line("File not found"); return; }
    if (!strchr(leaf, '.') && !has_wild(leaf)) { char t[140]; snprintf(t, sizeof(t), "%s.*", leaf); snprintf(leaf, sizeof(leaf), "%s", t); }
    int n = list_match(hdir, leaf, names, 1);
    char line[128];
    const char *rel = strncmp(hdir, "/run", 4) == 0 ? hdir + 4 : hdir;
    snprintf(line, sizeof(line), " Directory of A:%s", *rel ? rel : "\\");
    for (char *p = line; *p; p++) if (*p == '/') *p = '\\';
    out_line(line); out_line("");
    long total = 0;
    int files = 0;
    for (int i = 0; i < n; i++) {
        char f[400], nm[64], ext[64];
        snprintf(f, sizeof(f), "%s/%s", hdir, names[i]);
        struct stat st; stat(f, &st);
        const char *dot = strrchr(names[i], '.');
        snprintf(nm, sizeof(nm), "%.*s", dot ? (int)(dot - names[i]) : (int)strlen(names[i]), names[i]); upcase(nm);
        snprintf(ext, sizeof(ext), "%s", dot ? dot + 1 : ""); upcase(ext);
        if (S_ISDIR(st.st_mode)) snprintf(line, sizeof(line), "%-8s %-3s   <DIR>", nm, ext);
        else { snprintf(line, sizeof(line), "%-8s %-3s %9ld", nm, ext, (long)st.st_size); total += st.st_size; files++; }
        out_line(line);
    }
    snprintf(line, sizeof(line), "%9d file(s) %12ld bytes", files, total);
    out_line(line);
}

/* FOR %V IN (集合) DO コマンド: 展開した行を「FOR の文脈」として積む (呼び元の引数を引き継ぐ) */
static void cmd_for(const char *arg) {
    const char *p = skip_ws(arg);
    if (p[0] != '%' || !p[1]) { out_line("Syntax error"); return; }
    char var[4] = { '%', p[1], 0, 0 };
    p = skip_ws(p + 2);
    if (!ci_prefix(p, "IN")) { out_line("Syntax error"); return; }
    p = skip_ws(p + 2);
    if (*p != '(') { out_line("Syntax error"); return; }
    const char *rp = strchr(p, ')');
    if (!rp) { out_line("Syntax error"); return; }
    char set[BAT_LINE];
    snprintf(set, sizeof(set), "%.*s", (int)(rp - p - 1), p + 1);
    const char *dq = skip_ws(rp + 1);
    if (!ci_prefix(dq, "DO")) { out_line("Syntax error"); return; }
    const char *body = skip_ws(dq + 2);
    /* 集合を展開 (ワイルドカードは一致したファイル名に、元のディレクトリ部を付けて) */
    static char text[BAT_POOL / 4];
    size_t tn = 0;
    const char *sp = set;
    for (;;) {
        char item[BAT_LINE];
        sp = next_word(sp, item, sizeof(item));
        if (!item[0]) break;
        static char names[MATCH_MAX][64];
        int n = 1;
        char prefix[BAT_LINE] = "";
        if (has_wild(item)) {
            char hdir[300], leaf[128];
            n = 0;
            if (split_dos(item, hdir, sizeof(hdir), leaf, sizeof(leaf)) == 0) n = list_match(hdir, leaf, names, 0);
            snprintf(prefix, sizeof(prefix), "%.*s", (int)(strlen(item) - strlen(leaf)), item);
        } else snprintf(names[0], 64, "%s", item);
        for (int i = 0; i < n; i++) {
            char v[BAT_LINE];
            snprintf(v, sizeof(v), "%s%s", prefix, names[i]);
            if (has_wild(item)) upcase(v + strlen(prefix));
            /* 本体の %V を置き換え、残りの % は二重にする (文脈として読むときもう一度展開されるため) */
            for (const char *b = body; *b && tn + 4 < sizeof(text); ) {
                if (b[0] == var[0] && b[1] && toupper((unsigned char)b[1]) == toupper((unsigned char)var[1])) {
                    for (const char *q = v; *q && tn + 3 < sizeof(text); q++) { if (*q == '%') text[tn++] = '%'; text[tn++] = *q; }
                    b += 2; continue;
                }
                if (*b == '%') text[tn++] = '%';
                text[tn++] = *b++;
            }
            text[tn++] = '\r'; text[tn++] = '\n';
        }
    }
    if (!tn) return;
    bat_ctx *x = top();
    char args[BAT_ARGS][BAT_ARGLEN];
    uint32_t na = x ? x->nargs : 0;
    for (uint32_t i = 0; i < na; i++) memcpy(args[i], x->args[i], BAT_ARGLEN);
    push_text(text, (uint32_t)tn, args, na, 0, CTX_FOR, "FOR");
}

static void cmd_set_show(void) {
    size_t len;
    const char *e = qb_dos_env_block(&len);
    for (size_t i = 0; i < len; ) { size_t l = strlen(e + i); if (l) out_line(e + i); i += l + 1; }
}

/* ---- リダイレクトとパイプ ----
 * 行から < file・> file・>> file を取り出す (引用符の中と SJIS の 2 バイト目は見ない)。実 DOS と同じく
 * 最後に書いたものが効く。取り出した後の行を out へ。 */
typedef struct { char in[160], out[160]; int append, has_in, has_out; } redir_t;
static void parse_redir(const char *line, char *out, size_t cap, redir_t *r) {
    memset(r, 0, sizeof(*r));
    size_t n = 0;
    int q = 0;
    for (const char *p = line; *p; ) {
        unsigned char c = (unsigned char)*p;
        if (sjis_lead(c) && p[1]) { if (n + 2 < cap) { out[n++] = p[0]; out[n++] = p[1]; } p += 2; continue; }
        if (c == '"') q = !q;
        if (!q && (c == '<' || c == '>')) {
            int app = 0;
            p++;
            if (c == '>' && *p == '>') { app = 1; p++; }
            while (*p == ' ' || *p == '\t') p++;
            char f[160]; size_t fn = 0;
            while (*p && *p != ' ' && *p != '\t' && *p != '<' && *p != '>' && *p != '|') {
                if (sjis_lead((unsigned char)*p) && p[1]) { if (fn + 2 < sizeof(f)) { f[fn++] = p[0]; f[fn++] = p[1]; } p += 2; continue; }
                if (fn + 1 < sizeof(f)) f[fn++] = *p;
                p++;
            }
            f[fn] = '\0';
            if (c == '<') { snprintf(r->in, sizeof(r->in), "%s", f); r->has_in = 1; }
            else { snprintf(r->out, sizeof(r->out), "%s", f); r->has_out = 1; r->append = app; }
            continue;
        }
        if (n + 1 < cap) out[n++] = (char)c;
        p++;
    }
    out[n] = '\0';
}
/* 引用符の外の最初の | の位置 (無ければ NULL) */
static const char *find_pipe(const char *line) {
    int q = 0;
    for (const char *p = line; *p; p++) {
        if (sjis_lead((unsigned char)*p) && p[1]) { p++; continue; }
        if (*p == '"') q = !q;
        if (!q && *p == '|') return p;
    }
    return NULL;
}
/* a | b | c を「a >\QBPIPE1.$$$」「b <\QBPIPE1.$$$ >\QBPIPE2.$$$」「c <\QBPIPE2.$$$」と後始末の行に
 * 書き換え、パイプの文脈として積む (実 DOS も一時ファイルで順に実行する)。行は展開済みなので % は二重に */
static void push_pipeline(const char *line) {
    static char text[BAT_LINE * 8];
    size_t tn = 0;
    const char *seg = line;
    int k = 0;
    uint32_t base = ++B.pipe_seq * 10;
    #define TPUT(ch) do { if (tn + 1 < sizeof(text)) text[tn++] = (ch); } while (0)
    for (;;) {
        const char *bar = find_pipe(seg);
        size_t len = bar ? (size_t)(bar - seg) : strlen(seg);
        for (size_t i = 0; i < len; i++) { if (seg[i] == '%') TPUT('%'); TPUT(seg[i]); }
        char tmp[64];
        if (k > 0) { snprintf(tmp, sizeof(tmp), " <\\QBPIPE%u.$$$", (unsigned)(base + k - 1)); for (char *c = tmp; *c; c++) TPUT(*c); }
        if (bar)   { snprintf(tmp, sizeof(tmp), " >\\QBPIPE%u.$$$", (unsigned)(base + k));     for (char *c = tmp; *c; c++) TPUT(*c); }
        TPUT('\r'); TPUT('\n');
        if (!bar) break;
        seg = bar + 1; k++;
    }
    char tail[64];
    snprintf(tail, sizeof(tail), "QB$PIPEDEL %u %d\r\n", (unsigned)base, k);
    for (char *c = tail; *c; c++) TPUT(*c);
    #undef TPUT
    bat_ctx *x = top();
    char args[BAT_ARGS][BAT_ARGLEN];
    uint32_t na = x ? x->nargs : 0;
    for (uint32_t i = 0; i < na; i++) memcpy(args[i], x->args[i], BAT_ARGLEN);
    push_text(text, (uint32_t)tn, args, na, 0, CTX_PIPE, "pipe");
}

/* ---- 1 行を実行する ----
 * 戻り値 0 = 次の行へ / 1 = EXEC (path_out・tail_out を設定済み) / 3 = PAUSE / -1 = バッチ終了 (EXIT) */
static char *g_path_out, *g_tail_out;
static size_t g_pcap, g_tcap;
static const redir_t *g_cur_redir;   /* いま実行中の行のリダイレクト */
static uint16_t g_cur_psp;           /* いま問い合わせてきたシェル */

static int exec_line(const char *line);

static int run_external(const char *word, const char *tail) {
    char dos[200];
    if (resolve_program(word, dos, sizeof(dos)) != 0) {
        fprintf(stderr, "[batch] 見つからない: %s\n", word);
        out_line("Bad command or file name");
        return 0;
    }
    if (is_bat_path(dos)) {                                   /* CALL なしの .bat = 制御を渡して戻らない */
        char args[BAT_ARGS][BAT_ARGLEN];
        snprintf(args[0], BAT_ARGLEN, "%s", word);
        uint32_t n = split_args(tail, args, 1);
        if (push_bat(dos, args, n, 1) != 0) out_line("Bad command or file name");
        return 0;
    }
    if (g_cur_redir && (g_cur_redir->has_in || g_cur_redir->has_out)) {   /* 子の標準入出力を差し替える */
        int rr = qb_dos_redirect_push(g_cur_redir->has_in ? g_cur_redir->in : NULL,
                                      g_cur_redir->has_out ? g_cur_redir->out : NULL, g_cur_redir->append);
        if (rr == -1) { out_line("File not found"); return 0; }
        if (rr != 0) { out_line("File creation error"); return 0; }
        if (B.rd_n < 4) B.rd_owner[B.rd_n++] = g_cur_psp;
    }
    snprintf(g_path_out, g_pcap, "%s", dos);
    size_t tl = strlen(tail); if (tl > 126) tl = 126;
    memcpy(g_tail_out, tail, tl < g_tcap ? tl : g_tcap - 1);
    g_tail_out[tl < g_tcap ? tl : g_tcap - 1] = '\0';
    fprintf(stderr, "[batch] exec %s \"%s\"\n", dos, g_tail_out);
    return 1;
}

static int do_if(const char *p) {
    int neg = 0;
    char w[BAT_LINE];
    p = skip_ws(p);
    const char *q = next_word(p, w, sizeof(w));
    if (ci_eq(w, "NOT")) { neg = 1; p = skip_ws(q); }
    int cond;
    const char *rest;
    if (ci_prefix(p, "ERRORLEVEL") && (is_delim((unsigned char)p[10]) || p[10] == '\0')) {
        const char *s = p + 10;
        while (*s == ' ' || *s == '\t' || *s == '=') s++;   /* IF ERRORLEVEL==5 の揺れも */
        int n = 0;
        while (*s >= '0' && *s <= '9') n = n * 10 + (*s++ - '0');
        cond = qb_dos_errorlevel() >= n;
        rest = s;
    } else if (ci_prefix(p, "EXIST") && (is_delim((unsigned char)p[5]) || p[5] == '\0')) {
        const char *s = p + 5;
        while (*s == ' ' || *s == '\t' || *s == '=') s++;
        char f[BAT_LINE], host[256];
        rest = next_word(s, f, sizeof(f));
        size_t fl = strlen(f);
        if (fl >= 4 && ci_eq(f + fl - 4, "\\NUL")) {            /* IF EXIST DIR\NUL = ディレクトリがあるか */
            f[fl - 4] = '\0';
            cond = qb_dos_path_to_host(f[0] ? f : "\\", host, sizeof(host)) == 0 && host_is_dir(host);
        } else if (has_wild(f)) {
            char hdir[300], leaf[128], names[4][64];
            cond = split_dos(f, hdir, sizeof(hdir), leaf, sizeof(leaf)) == 0 && list_match(hdir, leaf, names, 0) > 0;
        } else {
            cond = f[0] && qb_dos_path_to_host(f, host, sizeof(host)) == 0 && host_is_file(host);
        }
    } else {                                                  /* 文字列 == 文字列 */
        const char *eq = NULL;
        for (const char *s = p; *s; s++) {
            if (sjis_lead((unsigned char)*s) && s[1]) { s++; continue; }
            if (s[0] == '=' && s[1] == '=') { eq = s; break; }
        }
        if (!eq) { out_line("Syntax error"); return 0; }
        char left[BAT_LINE], right[BAT_LINE];
        size_t ll = (size_t)(eq - p); if (ll >= sizeof(left)) ll = sizeof(left) - 1;
        memcpy(left, p, ll); left[ll] = '\0'; rtrim(left);
        const char *s = skip_ws(eq + 2);
        size_t rn = 0;
        while (*s && *s != ' ' && *s != '\t') {
            if (sjis_lead((unsigned char)*s) && s[1]) { if (rn + 2 < sizeof(right)) { right[rn++] = s[0]; right[rn++] = s[1]; } s += 2; continue; }
            if (rn + 1 < sizeof(right)) right[rn++] = *s;
            s++;
        }
        right[rn] = '\0';
        cond = strcmp(left, right) == 0;                     /* 大小を区別する (実 DOS と同じ) */
        rest = s;
    }
    if (neg) cond = !cond;
    fprintf(stderr, "[batch] if %s -> %s\n", p, cond ? "true" : "false");
    return cond ? exec_line(rest) : 0;
}

static int do_goto(const char *arg) {
    while (top() && (top()->kind == CTX_FOR || top()->kind == CTX_PIPE)) pop();   /* FOR の中の GOTO はループを抜ける */
    bat_ctx *x = top();
    if (!x) return 0;
    char lbl[BAT_LINE];
    arg = skip_ws(arg);
    if (*arg == ':') arg++;
    next_word(arg, lbl, sizeof(lbl));
    const char *t = B.pool + x->off;
    uint32_t pos = 0;
    while (pos < x->len) {
        uint32_t ls = pos;
        while (pos < x->len && t[pos] != '\n') pos++;
        if (pos < x->len) pos++;
        char line[BAT_LINE];
        size_t n = 0;
        for (uint32_t k = ls; k < pos && t[k] != '\n'; k++) if (t[k] != '\r' && n + 1 < sizeof(line)) line[n++] = t[k];
        line[n] = '\0';
        const char *l = skip_ws(line);
        if (*l != ':') continue;
        char name[BAT_LINE];
        next_word(l + 1, name, sizeof(name));
        /* 実 DOS はラベルの先頭 8 文字で照合する */
        if (ci_eq(name, lbl) || (strlen(name) >= 8 && strlen(lbl) >= 8 && ci_prefix8(name, lbl))) {
            x->pc = pos;
            return 0;
        }
    }
    fprintf(stderr, "[batch] ラベルが無い: %s\n", lbl);
    out_line("Label not found");
    pop();                                                    /* 実 DOS はその .bat を終える */
    return 0;
}

static int exec_line(const char *line) {
    const char *p = skip_ws(line);
    while (*p == '@') p = skip_ws(p + 1);
    if (!*p || *p == ':') return 0;                           /* 空行・ラベル */

    /* コマンド語。CD\X・CD..・ECHO. のように区切り無しで続く内部コマンドも切り出す */
    char word[BAT_LINE];
    size_t wn = 0;
    const char *q = p;
    while (*q && !is_delim((unsigned char)*q) && *q != '/' && *q != '+') {
        if (sjis_lead((unsigned char)*q) && q[1]) { if (wn + 2 < sizeof(word)) { word[wn++] = q[0]; word[wn++] = q[1]; } q += 2; continue; }
        if (wn + 1 < sizeof(word)) word[wn++] = *q;
        q++;
    }
    word[wn] = '\0';
    if (ci_prefix(word, "ECHO") && word[4] == '.') { out_line(p + 5); return 0; }   /* ECHO. = 空行 / ECHO.X = X */
    if ((ci_prefix(word, "CD") && (word[2] == '\\' || word[2] == '.')) ||
        (ci_prefix(word, "CHDIR") && (word[5] == '\\' || word[5] == '.'))) {
        size_t k = ci_prefix(word, "CHDIR") ? 5 : 2;
        q = p + k; word[k] = '\0';
    }
    const char *rest = q;                                     /* コマンド語の直後 (区切り文字込み) */
    const char *arg = skip_ws(rest);

    if (ci_eq(word, "REM") || ci_eq(word, "BREAK") || ci_eq(word, "VERIFY") || ci_eq(word, "PROMPT") ||
        ci_eq(word, "TITLE") || ci_eq(word, "VER") || ci_eq(word, "VOL") || ci_eq(word, "CTTY") || word[0] == ':')
        return 0;
    if (wn == 2 && word[1] == ':') return 0;                  /* ドライブ変更 (ドライブは 1 つ) */
    if (ci_eq(word, "ECHO")) {
        char a[BAT_LINE]; snprintf(a, sizeof(a), "%s", arg); rtrim(a);
        if (!a[0] || ci_eq(a, "ON") || ci_eq(a, "OFF")) return 0;
        out_line(*rest ? rest + 1 : "");                     /* ECHO の直後の区切り 1 文字だけ捨てる */
        return 0;
    }
    if (ci_eq(word, "CLS")) { out_str("\x1b[2J"); return 0; }
    if (ci_eq(word, "PAUSE")) { out_str("Press any key to continue . . ."); B.pause_nl = 1; return 3; }
    if (ci_eq(word, "SET")) {
        if (strchr(arg, '=')) qb_dos_env_assign(arg, strlen(arg));
        else if (!*arg) cmd_set_show();
        return 0;
    }
    if (ci_eq(word, "QB$PIPEDEL")) {                          /* パイプの一時ファイルの後始末 (内部専用) */
        unsigned base = 0; int k = 0;
        sscanf(arg, "%u %d", &base, &k);
        for (int i = 0; i <= k; i++) {
            char dos[64], host[256];
            snprintf(dos, sizeof(dos), "\\QBPIPE%u.$$$", base + (unsigned)i);
            if (qb_dos_path_to_host(dos, host, sizeof(host)) == 0) remove(host);
        }
        return 0;
    }
    if (ci_eq(word, "TYPE")) { cmd_type(arg); return 0; }
    if (ci_eq(word, "DEL") || ci_eq(word, "ERASE")) { cmd_del(arg); return 0; }
    if (ci_eq(word, "REN") || ci_eq(word, "RENAME")) { cmd_ren(arg); return 0; }
    if (ci_eq(word, "MD") || ci_eq(word, "MKDIR")) { cmd_md(arg, 0); return 0; }
    if (ci_eq(word, "RD") || ci_eq(word, "RMDIR")) { cmd_md(arg, 1); return 0; }
    if (ci_eq(word, "COPY")) { cmd_copy(arg); return 0; }
    if (ci_eq(word, "XCOPY")) { cmd_xcopy(arg); return 0; }
    if (ci_eq(word, "DIR")) { cmd_dir(arg); return 0; }
    if (ci_eq(word, "FOR")) { cmd_for(arg); return 0; }
    if (ci_eq(word, "COMMAND")) {                             /* COMMAND /C 行 = その行を実行して戻る */
        const char *c = arg;
        while (*c && !(c[0] == '/' && (c[1] == 'C' || c[1] == 'c'))) c++;
        if (!*c) return 0;                                    /* 対話シェルの起動は何もしない */
        c = skip_ws(c + 2);
        char tgt[BAT_LINE], dos[200];
        const char *targs = next_word(c, tgt, sizeof(tgt));
        if (tgt[0] && resolve_program(tgt, dos, sizeof(dos)) == 0 && is_bat_path(dos)) {   /* .bat なら戻ってくる */
            char args[BAT_ARGS][BAT_ARGLEN];
            snprintf(args[0], BAT_ARGLEN, "%s", tgt);
            uint32_t n = split_args(targs, args, 1);
            if (push_bat(dos, args, n, 0) != 0) out_line("Bad command or file name");
            return 0;
        }
        return exec_line(c);
    }
    if (ci_eq(word, "PATH")) {
        const char *v = *rest == '=' ? rest + 1 : arg;
        char a[BAT_LINE]; snprintf(a, sizeof(a), "PATH=%s", *v == ';' ? "" : v);
        qb_dos_env_assign(a, strlen(a));
        return 0;
    }
    if (ci_eq(word, "CD") || ci_eq(word, "CHDIR")) {
        char a[BAT_LINE]; snprintf(a, sizeof(a), "%s", arg); rtrim(a);
        if (!a[0]) return 0;
        if (qb_dos_chdir(a) != 0) out_line("Invalid directory");
        fprintf(stderr, "[batch] cd \"%s\" -> %s\n", a, qb_dos_cwd());
        return 0;
    }
    if (ci_eq(word, "GOTO")) return do_goto(arg);
    if (ci_eq(word, "IF")) return do_if(rest);
    if (ci_eq(word, "SHIFT")) {
        bat_ctx *x = top();
        if (x && x->nargs) { memmove(x->args[0], x->args[1], (x->nargs - 1) * BAT_ARGLEN); x->nargs--; }
        return 0;
    }
    if (ci_eq(word, "EXIT")) {                                /* このシェルの文脈を全部終える */
        uint16_t o = top() ? top()->owner : 0;
        while (top() && top()->owner == o) pop();
        return 0;
    }
    if (ci_eq(word, "LH") || ci_eq(word, "LOADHIGH") || ci_eq(word, "LOADFIX")) return exec_line(arg);
    if (ci_eq(word, "CALL")) {
        char tgt[BAT_LINE], dos[200];
        const char *targs = next_word(arg, tgt, sizeof(tgt));
        if (!tgt[0]) return 0;
        if (resolve_program(tgt, dos, sizeof(dos)) == 0 && is_bat_path(dos)) {
            char args[BAT_ARGS][BAT_ARGLEN];
            snprintf(args[0], BAT_ARGLEN, "%s", tgt);
            uint32_t n = split_args(targs, args, 1);
            if (push_bat(dos, args, n, 0) != 0) out_line("Bad command or file name");
            return 0;
        }
        return exec_line(arg);                                /* .com/.exe の CALL は普通の実行 */
    }
    return run_external(word, rest);
}

/* ---- 公開 ---- */
int qb_batch_active(void) { return B.active; }
void qb_batch_reset(void) {
    B.rt = 0; B.active = 0; B.nctx = 0; B.pool_used = 0; B.started = 0; B.pause_nl = 0; B.top_psp = 0;
    B.rd_n = 0; B.pipe_seq = 0;
    qb_dos_redirect_reset();
}
int  qb_batch_rt(void) { return B.rt; }
void qb_batch_set_scratch(uint16_t path_off, uint16_t tail_off) { B.rt = 1; B.scratch_path = path_off; B.scratch_tail = tail_off; }
uint16_t qb_batch_scratch_path(void) { return B.scratch_path; }
uint16_t qb_batch_scratch_tail(void) { return B.scratch_tail; }

int qb_batch_begin(const char *bat_dos, const char *args) {
    qb_batch_reset();
    /* rel = 先頭の区切りを除き '/' を '\\' にした /run 相対パス */
    char rel[192];
    size_t rn = 0;
    const char *s0 = bat_dos;
    while (*s0 == '\\' || *s0 == '/') s0++;
    for (const char *p = s0; *p && rn + 2 < sizeof(rel); p++) {
        if (sjis_lead((unsigned char)*p) && p[1]) { rel[rn++] = p[0]; rel[rn++] = p[1]; p++; continue; }
        rel[rn++] = (*p == '/') ? '\\' : *p;
    }
    rel[rn] = '\0';
    size_t leaf = 0;                                          /* 最後の区切りの直後 */
    for (size_t i = 0; i < rn; i++) {
        if (sjis_lead((unsigned char)rel[i]) && rel[i + 1]) { i++; continue; }
        if (rel[i] == '\\') leaf = i + 1;
    }
    char a[BAT_ARGS][BAT_ARGLEN];
    snprintf(a[0], BAT_ARGLEN, "%.*s", (int)strcspn(rel + leaf, "."), rel + leaf);   /* %0 = 拡張子なしの名前 */
    uint32_t n = split_args(args ? args : "", a, 1);
    char dos[200];
    snprintf(dos, sizeof(dos), "\\%s", rel);
    if (push_bat(dos, a, n, 0) != 0) return -1;
    /* 起動ディレクトリ = .bat の置き場所 (ルートなら空) */
    snprintf(B.start_dir, sizeof(B.start_dir), "\\%.*s", (int)(leaf ? leaf - 1 : 0), rel);
    B.active = 1;
    return 0;
}

int qb_batch_next(uint16_t psp, char *path_out, size_t pcap, char *tail_out, size_t tcap) {
    g_path_out = path_out; g_pcap = pcap; g_tail_out = tail_out; g_tcap = tcap;
    if (!B.started && B.active) {                             /* 最上位のシェルの最初の問い合わせ */
        B.started = 1;
        B.top_psp = psp;
        /* .bat を置いたディレクトリで始める (手で cd して実行するのと同じ) */
        if (B.start_dir[0] && strcmp(B.start_dir, "\\") != 0) qb_dos_chdir(B.start_dir);
    }
    if (B.nctx && B.ctx[B.nctx - 1].owner == 0) {             /* 積まれたばかりの文脈を引き取る */
        for (int i = B.nctx - 1; i >= 0 && B.ctx[i].owner == 0; i--) B.ctx[i].owner = psp;
    }
    g_cur_psp = psp;
    while (B.rd_n && B.rd_owner[B.rd_n - 1] == psp) { qb_dos_redirect_pop(); B.rd_n--; }   /* 子が終わった */
    if (B.pause_nl) { qb_dos_tty_write((const uint8_t *)"\r\n", 2); B.pause_nl = 0; }
    for (int steps = 0; B.nctx > 0 && B.ctx[B.nctx - 1].owner == psp; steps++) {
        if (steps > BAT_STEP_LIMIT) {
            fprintf(stderr, "[batch] EXEC の無い行が続きすぎる (空回りのループ) — 終了します\n");
            while (top() && top()->owner == psp) pop();
            break;
        }
        bat_ctx *x = top();
        char raw[BAT_LINE], line[BAT_LINE];
        if (!fetch_line(x, raw, sizeof(raw))) { pop(); continue; }
        expand(x, raw, line, sizeof(line));
        if (find_pipe(line)) { push_pipeline(line); continue; }
        char cmd[BAT_LINE];
        redir_t rd;
        parse_redir(line, cmd, sizeof(cmd), &rd);
        /* 内部コマンドの出力先 (外部プログラムは run_external が差し替えを積む) */
        if (rd.has_out) {
            char host[256];
            const char *l = rd.out;
            for (const char *q = rd.out; *q; q++) if (*q == '\\' || *q == ':') l = q + 1;
            if (ci_eq(l, "NUL")) g_cmd_out_null = 1;
            else {
                int st = qb_dos_path_to_host(rd.out, host, sizeof(host));
                if (st == 1) { char *sl = strrchr(host, '/'); if (sl) upcase(sl + 1); }
                if (st != 2) g_cmd_out = fopen(host, rd.append ? "ab" : "wb");
            }
        }
        g_cur_redir = &rd;
        int r = exec_line(cmd);
        g_cur_redir = NULL;
        if (g_cmd_out) { fclose(g_cmd_out); g_cmd_out = NULL; }
        g_cmd_out_null = 0;
        if (r == 1 || r == 3) return r;
    }
    if (psp != B.top_psp) return 4;                          /* 入れ子のシェル (COMSPEC /C) は終わって親へ */
    B.active = 0;
    return 0;
}

int qb_batch_push_cmdline(const char *line) {
    /* プログラムが COMSPEC /C で渡した 1 行。% は文字どおりに (コマンドラインでは展開しない) */
    char text[BAT_LINE * 2];
    size_t n = 0;
    for (const char *p = line; *p && n + 4 < sizeof(text); p++) { if (*p == '%') text[n++] = '%'; text[n++] = *p; }
    text[n++] = '\r'; text[n++] = '\n';
    char args[1][BAT_ARGLEN];
    snprintf(args[0], BAT_ARGLEN, "COMMAND");
    int r = push_text(text, (uint32_t)n, args, 1, 0, CTX_CMDLINE, "COMSPEC /C");
    if (r == 0) B.ctx[B.nctx - 1].owner = 0;                  /* 起動される入れ子のシェルが引き取る */
    return r;
}

/* ---- ステートセーブ ("BATR" 区画) ---- */
#define BATR_VER 1u
int qb_batch_state_save(qb_sw *w) {
    size_t mark = qb_sw_begin(w, "BATR", BATR_VER);
    B.rd_state_len = (uint32_t)qb_dos_redirect_state(B.rd_state, sizeof(B.rd_state));
    qb_sw_var(w, B);
    qb_sw_end(w, mark);
    return w->err ? -1 : 0;
}
int qb_batch_state_load(const uint8_t *blob, size_t n) {
    qb_sr r; uint32_t ver;
    /* 区画が無い = 実行時解釈より前のセーブ。旧方式の文列 (DLDR 区画) で続きを実行する */
    if (!qb_sr_section(blob, n, "BATR", &r, &ver)) { qb_batch_reset(); return 0; }
    if (ver != BATR_VER) return -71;
    qb_sr_var(&r, B);
    if (r.err) return -72;
    qb_dos_redirect_restore(B.rd_state, B.rd_state_len);
    return 0;
}
