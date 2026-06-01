#include <compiler.h>
#include <commng.h>  /* cmmidi.h を巻き込み、commng_create シグネチャを提供 */

/* vermouth_module は qb_vermouth.c で定義・初期化される。
 * cmmidi_create は extern 参照でその実体を読み、midiout_create を呼ぶ。 */

/* commng のフォールバック (no-connect)。sdl/commng.c の com_nc 相当を最小実装。 */
static UINT  nc_read(COMMNG self, UINT8 *data)            { (void)self; (void)data; return 0; }
static UINT  nc_write(COMMNG self, UINT8 data)            { (void)self; (void)data; return 0; }
static UINT  nc_writeretry(COMMNG self)                   { (void)self; return 1; }
static void  nc_beginblock(COMMNG self)                   { (void)self; }
static void  nc_endblock(COMMNG self)                     { (void)self; }
static UINT  nc_lastwritesuccess(COMMNG self)             { (void)self; return 1; }
static UINT8 nc_getstat(COMMNG self)                      { (void)self; return 0xf0; }
static INTPTR nc_msg(COMMNG self, UINT m, INTPTR p)       { (void)self; (void)m; (void)p; return 0; }
static void  nc_release(COMMNG self)                      { (void)self; }

static _COMMNG com_nc = {
    COMCONNECT_OFF, nc_read, nc_write, nc_writeretry,
    nc_beginblock, nc_endblock, nc_lastwritesuccess,
    nc_getstat, nc_msg, nc_release
};

/* MPU98II 用 COMMNG をシングルトン化。
 * 背景: mpu98ii_reset は pccore_init / pccore_reset 等で複数回呼ばれ、毎回
 * commng_destroy → commng_create を回す。一方で cmmidi_create 内の
 * sound_streamregist は cb 配列に追加するだけで unregist API が無い。
 * 都度新しい hdl で create すると、旧 hdl への dangling pointer が cb 配列に
 * 残り、midiout_get で free 済みメモリを読み書き → メモリ破壊で他音源にノイズ。
 * シングルトン化で cmmidi_create と sound_streamregist を 1 回だけに留める。 */
static COMMNG s_mpu98_singleton = NULL;

COMMNG commng_create(UINT device, BOOL onReset) {
    if (device == COMCREATE_MPU98II) {
        if (s_mpu98_singleton == NULL) {
            s_mpu98_singleton = cmmidi_create(device, cmmidi_vermouth, NULL, "GM");
        }
        if (s_mpu98_singleton) {
            /* T4.5: COMMSG_MIDIRESET は midireset() で 16 ch × sound_sync() を
             * 回すが、CPU_CLOCK 累積状況で sound_sync 内 streamprepare() が
             * 大量サンプル生成 → Wasm でブラウザ凍結する。我々の用途では
             * 実際に MIDI 出力を使わない (vermouth soundfont 未ロード) ので、
             * 2 回目以降の reset 時の MIDI 全ボイス停止は省略しても実害なし。
             * シングルトン化で dangling pointer 問題は既に解消済。 */
            (void)onReset;
            return s_mpu98_singleton;
        }
    }
    /* RS-232C, PC9861K, SMPU98, PRINTER 等は対象外 (no-connect) */
    return (COMMNG)&com_nc;
}

void commng_destroy(COMMNG cm) {
    /* シングルトンと no-connect は破棄しない。dangling pointer 問題回避のため、
     * シングルトンはプロセス終了まで生かす。 */
    if (cm == s_mpu98_singleton) return;
    if (cm == (COMMNG)&com_nc)    return;
    if (cm && cm->release) {
        cm->release(cm);
    }
}

void cmserial_initialize(void)   {}
void cmserial_deinitialize(void) {}
void cmmidi_deinitialize(void)   {}

/* 注意: 関数名は np2kai オリジナル通りのタイポ (initailize) */
void commng_initialize(void) {
    cmmidi_initailize();
}
