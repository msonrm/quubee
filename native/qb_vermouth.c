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

/* VERMOUTH 合成器 (soundfont = freepats) を構築する。timidity.cfg と .pat 群は事前に
 * Emscripten FS の CWD (= np2kai_set_data_dir で設定したディレクトリ) に配置されている前提。
 *  - CWD/timidity.cfg
 *  - CWD/freepats/Tone_000/NNN_*.pat, CWD/freepats/Drum_000/NNN_*.pat
 * midimod_create 失敗時は vermouth_module = NULL のまま (cmmidi_create が NULL を返し no-connect)。
 *
 * 現状 (2026-06-05): MIDI は遅延 on-demand で有効化される。MIDI レシピ Run 時に bridge.js が
 * freepats を配置 → np2kai_enable_midi_now() がここを呼び → 次の reset で RS-MIDI (-X1) が
 * VERMOUTH に結線され鳴る (実機確認済)。create 前 enable の旧経路 (np2kai_enable_midi + MPU98II)
 * は -X0 MPU 直叩きゲーム用の足場として温存 (bridge.c 参照)。
 * かつての「FM との加算でビリビリ」は opngen + ハードクリップ時代の問題で、soft-clip 化 +
 * RS-MIDI 単独ストリーム化で解消済み。 */
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

/* VERMOUTH 合成器が利用可能か (= midimod_create 成功)。qb_commng.c が RS-MIDI(シリアル) を
 * VERMOUTH に繋ぐかの gate に使う。
 * 注意: ここでの「利用可能」は midimod_create でモジュールが確保できたこと止まり。楽器ロード
 * (midimod_loadall) は upstream が void 返しで、欠損/壊れた .pat を黙って飛ばす (inst_bankloadex は
 * SUCCESS のまま) ため、個々の音色ロード成否はここでは判定できない。.pat の健全性は取得段
 * (bridge.js ensureMidiLoaded の res.ok 検査) で担保する。 */
int qb_vermouth_ready(void) {
    return vermouth_module != NULL;
}
