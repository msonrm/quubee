#include <compiler.h>
#include <pccore.h>
/* vermouth.h を include しないのは、その中で MIDIMOD が opaque な fake 型
 * として typedef されているため。midiout.h の本物の _midimodule 定義を使う。 */
#include <sound/vermouth/midiout.h>

/* vermouth.h で宣言される公開 API。MIDIMOD は midiout.h の型と互換。 */
extern MIDIMOD midimod_create(UINT samprate);
extern void    midimod_destroy(MIDIMOD hdl);
extern void    midimod_loadall(MIDIMOD hdl);

/* sdl/cmmidi.c が extern 参照する VERMOUTH 用 MIDIMOD グローバル。
 * 楽器バンク (tone[]) は midimod_create + midimod_loadall で構築する。 */
MIDIMOD vermouth_module = NULL;

/* JS 側が pccore_init の前に呼ぶ。timidity.cfg と .pat 群は事前に Emscripten FS の
 * CWD (= np2kai_set_data_dir で設定したディレクトリ) に配置されている前提。
 *  - CWD/timidity.cfg
 *  - CWD/freepats/Tone_000/NNN_*.pat, CWD/freepats/Drum_000/NNN_*.pat
 * 失敗時は vermouth_module = NULL のまま (cmmidi_create が NULL を返し no-connect)。
 *
 * 注意: Phase 3 段階では VERMOUTH 経路は鳴るが、FM 音源との加算で「ビリビリ」歪み
 * が出る問題があり、bridge.js から np2kai_enable_midi(1) は現在呼ばれていない。
 * 配線は将来の再開用に残してある。 */
void qb_vermouth_init(void) {
    if (vermouth_module != NULL) return;
    vermouth_module = midimod_create(np2cfg.samplingrate);
    if (vermouth_module != NULL) {
        midimod_loadall(vermouth_module);
    }
}

void qb_vermouth_term(void) {
    if (vermouth_module) {
        midimod_destroy(vermouth_module);
        vermouth_module = NULL;
    }
}
