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

typedef struct {
    uint32_t off, len;            /* 本文 (プール内) */
    uint32_t pc;                  /* 次に読む行の先頭 (本文内のバイト位置) */
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
    int      nctx;
    bat_ctx  ctx[BAT_DEPTH];
    uint32_t pool_used;
    char     pool[BAT_POOL];
} B;

/* ---- 小道具 ---- */
static int sjis_lead(unsigned char c) { return (c >= 0x81 && c <= 0x9F) || (c >= 0xE0 && c <= 0xFC); }
static void out_str(const char *s) { qb_dos_tty_write((const uint8_t *)s, (int)strlen(s)); }
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

/* .bat (DOS パス) を読んで文脈を積む。replace = 今の文脈と差し替える (CALL なしで別の .bat を
 * 呼んだとき = 実 DOS は呼び元へ戻らない)。0 = 成功 / 負 = 読めない・満杯 */
static int push_bat(const char *dos, char args[][BAT_ARGLEN], uint32_t nargs, int replace) {
    char host[256];
    if (qb_dos_path_to_host(dos, host, sizeof(host)) != 0) return -1;
    FILE *fp = fopen(host, "rb");
    if (!fp) return -1;
    if (replace) pop();
    if (B.nctx >= BAT_DEPTH) { fclose(fp); fprintf(stderr, "[batch] CALL の入れ子が深すぎる: %s\n", dos); return -2; }
    uint32_t off = B.pool_used, len = 0;
    int c;
    while ((c = fgetc(fp)) != EOF && c != 0x1A) {           /* ^Z (EOF マーク) で打ち切り */
        if (off + len + 1 >= BAT_POOL) { fclose(fp); fprintf(stderr, "[batch] .bat が大きすぎる: %s\n", dos); return -3; }
        B.pool[off + len++] = (char)c;
    }
    fclose(fp);
    bat_ctx *x = &B.ctx[B.nctx++];
    memset(x, 0, sizeof(*x));
    x->off = off; x->len = len; x->pc = 0;
    x->nargs = nargs > BAT_ARGS ? BAT_ARGS : nargs;
    for (uint32_t i = 0; i < x->nargs; i++) snprintf(x->args[i], BAT_ARGLEN, "%s", args[i]);
    B.pool_used = off + len;
    fprintf(stderr, "[batch] %s %s (%u byte, 入れ子 %d)\n", replace ? "chain" : "open", dos, (unsigned)len, B.nctx);
    return 0;
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

/* ---- 1 行を実行する ----
 * 戻り値 0 = 次の行へ / 1 = EXEC (path_out・tail_out を設定済み) / 3 = PAUSE / -1 = バッチ終了 (EXIT) */
static char *g_path_out, *g_tail_out;
static size_t g_pcap, g_tcap;

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
        cond = f[0] && qb_dos_path_to_host(f, host, sizeof(host)) == 0;
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
        return 0;
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
    if (ci_eq(word, "EXIT")) { B.nctx = 0; B.pool_used = 0; return -1; }
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
void qb_batch_reset(void) { B.rt = 0; B.active = 0; B.nctx = 0; B.pool_used = 0; B.started = 0; B.pause_nl = 0; }
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

int qb_batch_next(char *path_out, size_t pcap, char *tail_out, size_t tcap) {
    g_path_out = path_out; g_pcap = pcap; g_tail_out = tail_out; g_tcap = tcap;
    if (!B.active) return 0;
    if (!B.started) {                                         /* .bat を置いたディレクトリで始める (手で cd して実行するのと同じ) */
        B.started = 1;
        if (B.start_dir[0] && strcmp(B.start_dir, "\\") != 0) qb_dos_chdir(B.start_dir);
    }
    if (B.pause_nl) { out_str("\r\n"); B.pause_nl = 0; }
    for (int steps = 0; B.nctx > 0; steps++) {
        if (steps > BAT_STEP_LIMIT) {
            fprintf(stderr, "[batch] EXEC の無い行が続きすぎる (空回りのループ) — 終了します\n");
            break;
        }
        bat_ctx *x = top();
        char raw[BAT_LINE], line[BAT_LINE];
        if (!fetch_line(x, raw, sizeof(raw))) { pop(); continue; }
        expand(x, raw, line, sizeof(line));
        int r = exec_line(line);
        if (r == 1 || r == 3) return r;
        if (r < 0) break;
    }
    B.active = 0;
    return 0;
}

/* ---- ステートセーブ ("BATR" 区画) ---- */
#define BATR_VER 1u
int qb_batch_state_save(qb_sw *w) {
    size_t mark = qb_sw_begin(w, "BATR", BATR_VER);
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
    return r.err ? -72 : 0;
}
