/* qb_state.c — ステートセーブの QuuBee 側区画の読み書き道具と、区画一式の保存・読み込み。
 * 形式と方針は qb_state.h を参照。 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "qb_state.h"

void qb_sw_bytes(qb_sw *w, const void *p, size_t n) {
    if (w->err) return;
    if (w->len + n > w->cap) {
        size_t cap = w->cap ? w->cap : 4096;
        while (cap < w->len + n) cap *= 2;
        uint8_t *b = (uint8_t *)realloc(w->buf, cap);
        if (!b) { w->err = 1; return; }
        w->buf = b; w->cap = cap;
    }
    memcpy(w->buf + w->len, p, n);
    w->len += n;
}

void qb_sw_u32(qb_sw *w, uint32_t v) {
    uint8_t b[4] = { (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24) };
    qb_sw_bytes(w, b, 4);
}

void qb_sw_blob(qb_sw *w, const void *p, size_t n) {
    qb_sw_u32(w, (uint32_t)n);
    qb_sw_bytes(w, p, n);
}

size_t qb_sw_begin(qb_sw *w, const char tag[4], uint32_t ver) {
    qb_sw_bytes(w, tag, 4);
    qb_sw_u32(w, ver);
    size_t mark = w->len;
    qb_sw_u32(w, 0);            /* 長さ (end で確定) */
    return mark;
}

void qb_sw_end(qb_sw *w, size_t mark) {
    if (w->err) return;
    uint32_t n = (uint32_t)(w->len - mark - 4);
    w->buf[mark]     = (uint8_t)n;
    w->buf[mark + 1] = (uint8_t)(n >> 8);
    w->buf[mark + 2] = (uint8_t)(n >> 16);
    w->buf[mark + 3] = (uint8_t)(n >> 24);
}

void qb_sr_bytes(qb_sr *r, void *p, size_t n) {
    if (r->err || r->pos + n > r->n) { r->err = 1; memset(p, 0, n); return; }
    memcpy(p, r->p + r->pos, n);
    r->pos += n;
}

uint32_t qb_sr_u32(qb_sr *r) {
    uint8_t b[4];
    qb_sr_bytes(r, b, 4);
    return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

void qb_sr_blob(qb_sr *r, void *p, size_t n) {
    uint32_t len = qb_sr_u32(r);
    if (r->err || len != n) { r->err = 1; return; }
    qb_sr_bytes(r, p, n);
}

int qb_sr_section(const uint8_t *blob, size_t n, const char tag[4], qb_sr *sec, uint32_t *ver) {
    qb_sr r = { blob, n, 0, 0 };
    char magic[4];
    qb_sr_bytes(&r, magic, 4);
    if (r.err || memcmp(magic, QB_STATE_MAGIC, 4) != 0) return 0;
    if (qb_sr_u32(&r) != QB_STATE_FORMAT) return 0;
    while (!r.err && r.pos + 12 <= n) {
        char t[4];
        qb_sr_bytes(&r, t, 4);
        uint32_t v = qb_sr_u32(&r);
        uint32_t len = qb_sr_u32(&r);
        if (r.err || r.pos + len > n) return 0;
        if (memcmp(t, tag, 4) == 0) {
            sec->p = blob + r.pos; sec->n = len; sec->pos = 0; sec->err = 0;
            if (ver) *ver = v;
            return 1;
        }
        r.pos += len;
    }
    return 0;
}

/* ---- 区画一式 (bridge.c の np2kai_state_qb_* から呼ばれる) ---- */

/* セーブを断る理由。0 = セーブ可 / 1 = FEP の変換中 (途中状態が JS と Mozc 側にある) */
int qb_state_busy(void) {
    if (qb_fep_busy()) return 1;
    return 0;
}

int qb_state_save_file(const char *path) {
    qb_sw w = { 0 };
    qb_sw_bytes(&w, QB_STATE_MAGIC, 4);
    qb_sw_u32(&w, QB_STATE_FORMAT);
    int rc = 0;
    if (!rc) rc = qb_dos_int21_state_save(&w);
    if (!rc) rc = qb_dos_loader_state_save(&w);
    if (!rc) rc = qb_xms_state_save(&w);
    if (!rc) rc = qb_mouse33_state_save(&w);
    if (!rc) rc = qb_sound_state_save(&w);
    if (!rc) rc = qb_midi_state_save(&w);
    if (!rc && w.err) rc = -2;
    if (!rc) {
        FILE *fp = fopen(path, "wb");
        if (!fp || fwrite(w.buf, 1, w.len, fp) != w.len) rc = -3;
        if (fp) fclose(fp);
    }
    free(w.buf);
    return rc;
}

int qb_state_load_file(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return -3;
    fseek(fp, 0, SEEK_END);
    long n = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (n <= 0 || n > 64L * 1024 * 1024) { fclose(fp); return -3; }
    uint8_t *b = (uint8_t *)malloc((size_t)n);
    if (!b) { fclose(fp); return -2; }
    size_t got = fread(b, 1, (size_t)n, fp);
    fclose(fp);
    int rc = (got == (size_t)n) ? 0 : -3;
    if (!rc) rc = qb_dos_int21_state_load(b, (size_t)n);
    if (!rc) rc = qb_dos_loader_state_load(b, (size_t)n);
    if (!rc) rc = qb_xms_state_load(b, (size_t)n);
    if (!rc) rc = qb_mouse33_state_load(b, (size_t)n);
    if (!rc) rc = qb_sound_state_load(b, (size_t)n);
    if (!rc) rc = qb_midi_state_load(b, (size_t)n);
    free(b);
    return rc;
}
