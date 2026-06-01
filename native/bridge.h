#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void *np2kai_handle;

__attribute__((visibility("default")))
np2kai_handle np2kai_create(void);

__attribute__((visibility("default")))
void np2kai_destroy(np2kai_handle h);

__attribute__((visibility("default")))
int np2kai_set_data_dir(const char *path);

__attribute__((visibility("default")))
int np2kai_set_bios_dir(np2kai_handle h, const char *path);

__attribute__((visibility("default")))
void np2kai_run_frame(np2kai_handle h);

__attribute__((visibility("default")))
int np2kai_insert_fdd(np2kai_handle h, const char *path, int drive, int readonly);

/* SASI/IDE HDD をマウント。drive は 0-3。フォーマット (HDI/THD/NHD/HDD raw 等) は
 * 自動判定される。インストール型ゲームを動かす想定。挿入後は np2kai_reset を呼んで
 * HDD からブートし直すのが通常フロー。 */
__attribute__((visibility("default")))
int np2kai_insert_hdd(np2kai_handle h, const char *path, int drive);

__attribute__((visibility("default")))
void np2kai_eject_hdd(np2kai_handle h, int drive);

/* PC をリセット (新ディスクからのブートし直し用) */
__attribute__((visibility("default")))
void np2kai_reset(np2kai_handle h);

__attribute__((visibility("default")))
const uint8_t *np2kai_get_framebuffer(
	np2kai_handle h,
	int *out_width,
	int *out_height,
	int *out_bytes_per_pixel);

/* Debug: 現在の CPU PC を CS:EIP として返す (0xCS<<32 | EIP の 64bit) */
__attribute__((visibility("default")))
uint64_t np2kai_debug_get_pc(np2kai_handle h);

/* Debug: リアルモード換算の線形アドレス (CS<<4 + EIP & 0xffff) を 32bit で */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_linear_pc(np2kai_handle h);

/* Debug: CS のみ (16bit) */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_cs(np2kai_handle h);

/* Debug: 物理線形アドレスから 1byte 読む (CPU の cpu_vmemoryread を使用) */
__attribute__((visibility("default")))
uint32_t np2kai_debug_peek8(np2kai_handle h, uint32_t linear_addr);

/* Debug: gdc.mode1 (テキスト GDC モードレジスタ) を読む */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_gdc_mode1(np2kai_handle h);

/* Debug: gdcs.textdisp / gdcs.grphdisp を読む。bit 0x80 (GDCSCRN_ENABLE) で
 * テキスト面 / グラフィック面の表示 master enable を確認できる。
 * テキスト面が STOP コマンドで OFF になっているかの判定に使う。 */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_textdisp(np2kai_handle h);

__attribute__((visibility("default")))
uint32_t np2kai_debug_get_grphdisp(np2kai_handle h);

/* Keyboard: pc98_keycode は NP2kai の NKEY_* (0x00-0x7f) と同じ。
 * 値の意味は core/np2kai/keystat.h の enum を参照。 */
__attribute__((visibility("default")))
void np2kai_key_down(np2kai_handle h, uint8_t pc98_keycode);

__attribute__((visibility("default")))
void np2kai_key_up(np2kai_handle h, uint8_t pc98_keycode);

/* Mouse: 相対移動量を累積。PC-98 のマウス I/F は周期的に取り出して
 * カウンタをクリアする。Pointer Lock の movementX/Y をそのまま渡す想定。 */
__attribute__((visibility("default")))
void np2kai_mouse_move(np2kai_handle h, int dx, int dy);

/* button: 0=左, 1=右. down: 1=押下, 0=解放 */
__attribute__((visibility("default")))
void np2kai_mouse_button(np2kai_handle h, int button, int down);

/* Audio: np2kai_create より前に呼ぶ。AudioContext.sampleRate に合わせる想定。
 * 受け付ける値: 11025/22050/44100/48000/88200/96000/176400/192000 */
__attribute__((visibility("default")))
int np2kai_set_audio_rate(uint32_t rate);

/* リングバッファから PCM をステレオ int16 で取り出す。
 * dst には max_frames * 2 個の int16 ぶんの領域が必要。
 * 返り値は実際に書いたフレーム数 (0 ならバッファ空)。 */
__attribute__((visibility("default")))
uint32_t np2kai_audio_drain(np2kai_handle h, int16_t *dst, uint32_t max_frames);

/* 現在のサンプリングレートを返す (sound_create に渡された値) */
__attribute__((visibility("default")))
uint32_t np2kai_audio_get_rate(np2kai_handle h);

/* ---- Phase 3 ミニマル DOS ローダ ---- */
/* COM image をステージング (次回 loader-start フック発火時に展開される)。
 * 戻り値: 0 = OK、< 0 = エラー (-1: NULL/empty、-2: 64KB 超え)。
 * cmdline / name は NULL 可。cmdline max 126 byte (PSP 0x80 の最大長)。
 * name は image の表示名 (例 "HELLO.COM")。argv[0] = "A:\<basename>" の生成に使う。 */
__attribute__((visibility("default")))
int np2kai_dos_stage_com(const uint8_t *image, int size, const char *cmdline,
                         const char *name);

/* MZ / ZM EXE image をステージング。body (header strip 後) は最大 640KB
 * (PC-98 基本メモリ上限)。reloc 適用と CS/IP/SS/SP 計算はローダ側で行う。
 * 戻り値: 0 = OK、< 0 = エラー (-1: NULL/too small、-3: bad magic、-5: truncated、
 * -7: > 640KB、-8/-9: reloc 不整合、その他: ヘッダ矛盾)。
 * cmdline / name は NULL 可 (name の用途は stage_com と同じ)。 */
__attribute__((visibility("default")))
int np2kai_dos_stage_exe(const uint8_t *image, int size, const char *cmdline,
                         const char *name);

/* DOS image の exit 状態を取得。
 * 戻り値: 0 = まだ動作中、1 = 終了済み。code_out が non-NULL なら exit code を書く。 */
__attribute__((visibility("default")))
int np2kai_dos_get_exit(int *code_out);

#ifdef __cplusplus
}
#endif
