#include <compiler.h>
#include <pccore.h>
/* 合成バックエンドは TinySoundFont (native/qb_tsf.c) に差し替え済み。
 * ここは「MIDI モジュール (= ロード済み SF2) のライフサイクル」だけを持つ薄い層。
 * 型は vermouth.h の薄い公開型を使う (実体は qb_tsf.c の QBMOD)。 */
#include "sound/vermouth/vermouth.h"

/* cmmidi.c が extern 参照する MIDI モジュールのグローバル。midimod_create (qb_tsf.c) が SF2 をロード。 */
MIDIMOD vermouth_module = NULL;

/* MIDI 合成器を構築する。SF2 は事前に CWD (= np2kai_set_data_dir で設定したディレクトリ) に
 * soundfont.sf2 として配置されている前提 (bridge.js が遅延 on-demand で fetch して置く)。
 * midimod_create が失敗 (SF2 不在等) すると vermouth_module = NULL のまま
 * (cmmidi_create が NULL を返し no-connect)。 */
void qb_vermouth_init(void) {
    if (vermouth_module != NULL) return;
    vermouth_module = midimod_create(np2cfg.samplingrate);
    if (vermouth_module != NULL) {
        midimod_loadall(vermouth_module);   /* TSF では no-op (create で全ロード済) */
    }
}

void qb_vermouth_term(void) {
    if (vermouth_module) {
        midimod_destroy(vermouth_module);
        vermouth_module = NULL;
    }
}

/* MIDI 合成器が利用可能か (= SF2 ロード成功)。qb_commng.c が RS-MIDI/MPU を VERMOUTH(=TSF) に
 * 繋ぐかの gate に使う。 */
int qb_vermouth_ready(void) {
    return vermouth_module != NULL;
}
