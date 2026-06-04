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

/* ---- RS-MIDI (シリアル) → VERMOUTH 結線 (A, 2026-06-05) ----
 * MIDDRV -X1 等の RS-MIDI ドライバは MIDI バイトを 8251 シリアル(I/O 0x30 data) へ流す。
 * NP2kai io/serial.c はそれを commng_create(COMCREATE_SERIAL) で得た commng の write() に渡す。
 * 従来そこは com_nc で全バイト破棄していた (= TW212 TWMIDI.BAT 無音の真因)。
 * MIDI 有効時 (vermouth_module ロード済) はここを cmmidi の VERMOUTH シンクに繋ぎ、MPU98II と
 * 同じ midiwrite→midiout_vermouth 経路で合成する。
 *
 * 設計: 送信が成立することは実証済みの com_nc 挙動 (getstat/lastwritesuccess 等) をそのまま流用し、
 * write だけを「カウント + 内側 cmmidi へ転送」に差し替える薄いラッパにする。これにより、
 *   - 8251 の TxRDY/lastwritesuccess ロジックが com_nc 時と同一 (FIFO drain が止まらない)
 *   - msg は nc_msg (no-op) のままなので COMMSG_MIDIRESET も無害 (midireset の 16ch sound_sync を踏まない)
 * の 2 点が保証される。 */
extern int qb_vermouth_ready(void);   /* qb_vermouth.c: vermouth_module != NULL */

static COMMNG s_serial_inner = NULL;       /* cmmidi の VERMOUTH シンク (実体) */
static UINT32 s_serial_midi_bytes = 0;     /* シリアルへ流れた MIDI バイト数 (診断用) */

static UINT sm_write(COMMNG self, UINT8 data) {
    (void)self;
    s_serial_midi_bytes++;
    if (s_serial_inner) s_serial_inner->write(s_serial_inner, data);
    return 1;
}

static _COMMNG com_serial = {
    COMCONNECT_OFF, nc_read, sm_write, nc_writeretry,
    nc_beginblock, nc_endblock, nc_lastwritesuccess,
    nc_getstat, nc_msg, nc_release
};

/* 診断: シリアルへ流れた MIDI バイト数 / RS-MIDI ルーティングが生きているか。bridge 経由で qbDebug へ。 */
UINT32 qb_serial_midi_bytes(void)    { return s_serial_midi_bytes; }
int      qb_serial_midi_active(void) { return s_serial_inner != NULL; }

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
    /* RS-MIDI: MIDI 有効時のみ、シリアルを VERMOUTH シンクに繋ぐ (TW212 TWMIDI.BAT 等 -X1)。
     * 内側 cmmidi は「無ければ作る」遅延生成。重要: cmmidi_create が呼ぶ sound_streamregist は
     * sound_reset (= 毎 pccore_reset) の streamreset で cbreg がリセットされ全消去されるので、
     * リセットを跨いで鳴らすには毎サイクル再登録が要る。そこで commng_destroy(com_serial) で inner を
     * release+NULL 化し (下記)、rs232c_reset の destroy→create で毎回作り直す = 毎回再登録。
     * rs232c_open は cm_rs232c==NULL ガード付きなので生成はサイクル毎に 1 回だけ (重複/dangling 無し)。
     * これは stock MPU98II の「reset で NULL → 遅延再生成」と同じパターン。MIDI 無効時は従来通り com_nc。 */
    if (device == COMCREATE_SERIAL && qb_vermouth_ready()) {
        if (s_serial_inner == NULL) {
            s_serial_inner = cmmidi_create(device, cmmidi_vermouth, NULL, "GM");
        }
        if (s_serial_inner) return (COMMNG)&com_serial;
        /* cmmidi 失敗 (VERMOUTH 未ロード等) は com_nc にフォールバック */
    }
    /* PC9861K, SMPU98, PRINTER, および MIDI 無効時のシリアルは対象外 (no-connect) */
    return (COMMNG)&com_nc;
}

void commng_destroy(COMMNG cm) {
    /* シングルトンと no-connect は破棄しない。dangling pointer 問題回避のため、
     * シングルトンはプロセス終了まで生かす。 */
    if (cm == s_mpu98_singleton)  return;
    if (cm == (COMMNG)&com_nc)     return;
    if (cm == (COMMNG)&com_serial) {
        /* com_serial 自体は静的なので free しない。中身の cmmidi (VERMOUTH sink) を release して
         * s_serial_inner を NULL に戻す → 次の commng_create(SERIAL) で作り直され、sound_reset で
         * 消えた sound_streamregist 登録が復活する (別 .bat を挟んでも MIDI が鳴り続ける)。
         * release(midirelease) は VERMOUTH では midiout_destroy+free のみで軽い (16ch sync 無し)。 */
        if (s_serial_inner && s_serial_inner->release) s_serial_inner->release(s_serial_inner);
        s_serial_inner = NULL;
        return;
    }
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
