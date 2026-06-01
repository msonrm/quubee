/* SPDX-License-Identifier: MIT OR GPL-2.0-or-later */
#include <compiler.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>   /* chdir: POSIX cwd を NP2kai の curpath と揃える */

#include <pccore.h>
#include <dosio.h>
#include <scrnmng.h>
#include <soundmng.h>
#include <mousemng.h>
#include <keystat.h>
#include <ia32/cpu.h>
#include <i386c/cpumem.h>
#include <io/iocore.h>
#include <fdd/diskdrv.h>
#include <fdd/sxsi.h>
#include <diskimage/fddfile.h>
#include <commng.h>
#include <bridge.h>
#include <qb_mousemng.h>
#include <qb_soundmng.h>
#include "dos_loader.h"

#ifdef __ANDROID__
#include <android/log.h>
#define LOGD(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "NP2KAI", fmt, ##__VA_ARGS__)
#else
#define LOGD(fmt, ...)
#endif

void initload(void);          /* defined in qb_ini.c */
void qb_vermouth_init(void);  /* defined in qb_vermouth.c */
void qb_vermouth_term(void);  /* defined in qb_vermouth.c */

typedef struct {
	int initialized;
} QB_State;

static QB_State s_state;
static char s_data_dir[MAX_PATH];
/* MIDI を有効化するかどうか。create 前に np2kai_enable_midi() で立てる。
 * デフォルト OFF: MPU98II ハードは検出されず、ゲームは FM 専用 (= 音源選択 UI が出る)。
 * ON にすると pccore_init 内で MPU98II ポートが attach され、VERMOUTH が PCM 合成。 */
static int s_midi_enable = 0;

int np2kai_set_data_dir(const char *path) {
	if (!path) return -1;
	size_t len = strlen(path);
	if (len >= sizeof(s_data_dir)) return -2;
	memcpy(s_data_dir, path, len + 1);
	LOGD("np2kai_set_data_dir: %s", s_data_dir);
	return 0;
}

/* JS から np2kai_create の前に呼ぶ。1=MIDI 有効化 (MPU98II + VERMOUTH)、0=無効。
 * 呼ばないと既定の 0 のまま (= MIDI OFF)。create 後の切り替えはできない (要 reset)。
 *
 * 注意: Phase 3 段階では VERMOUTH 経路は鳴るが、FM 音源との合算で「ビリビリ」歪み
 * が出る品質課題があり、bridge.js からは現状呼ばれない (= 常に OFF)。
 * 配線一式 (qb_commng.c / qb_vermouth.c / sdl/cmmidi.c) と freepats のセット
 * アップスクリプトは将来の再開用に残してある。 */
void np2kai_enable_midi(int enable) {
	s_midi_enable = enable ? 1 : 0;
	LOGD("np2kai_enable_midi: %d", s_midi_enable);
}

np2kai_handle np2kai_create(void) {
	if (s_state.initialized)
		return NULL;

	dosio_init();
	scrnmng_initialize();
	if (scrnmng_create(0) != SUCCESS)
		return NULL;

	soundmng_initialize();
	mousemng_initialize();

	initload();           /* sets default np2cfg via pccore_setdefault() */
	np2cfg.fddequip = 0x03; /* equip drives A and B so diskdrv_* functions accept them */
	/* マスター音量を 65% に下げてヘッドルームを確保。
	 * デフォルト 100 だと FM+SSG+リズムの合算ピークが SINT16 範囲を超え、
	 * qb_soundmng の出力段でハードクリップ → 低音で「ビリビリ」歪みが出る。
	 * 80 では低音歪みが完全に取りきれず、65 まで下げると線形領域 (ソフト
	 * クリップの KNEE = 24576) にほぼ全ピークが収まる計算。 */
	np2cfg.vol_master = 65;
	/* FM 音源を fmgen (cisc.cs C++ ライブラリ、デフォルト) から opngen
	 * (NP2 オリジナル) に切り替え。fmgen は OPNA の実機クセを精密に再現する分、
	 * オーバーサンプリングの量子化や低レート LFO の干渉で「ビリビリ」が
	 * 乗りやすい。opngen はよりシンプル/理想化された合成で、低音の歪みが
	 * 出にくい場合がある。 */
	np2cfg.usefmgen = 0;
	commng_initialize();      /* cmmidi_initailize で midictrlindex テーブル初期化 */
	if (s_data_dir[0]) {
		file_setcd(s_data_dir);   /* writable dir for font.tmp, saves, etc. */
		/* file_setcd は NP2kai 内部の curpath だけ更新。fopen 等の libc 関数は
		 * POSIX cwd を見るので、こちらも合わせる。これをしないと VERMOUTH の
		 * inst_create が "freepats/Tone_000/..." を / 直下に探して全失敗する。 */
		chdir(s_data_dir);
	}
	if (s_midi_enable) {
		/* MIDI 有効化: MPU98II ポート attach + VERMOUTH 合成器を起動。
		 * file_setcd 後に timidity.cfg を読みに行くので順序は守る。 */
		np2cfg.mpuenable = 1;
		np2cfg.mpuopt = 0;        /* port 0xc0d0, IRQ 3 (NP2kai 既定) */
		qb_vermouth_init();
	}
	pccore_init();
	pccore_reset();

	s_state.initialized = 1;
	LOGD("np2kai_create: OK scrnmng=%dx%dx%d dispsurf=%p",
	     scrnmng.width, scrnmng.height, scrnmng.bpp, scrnmng.dispsurf);
	return (np2kai_handle)&s_state;
}

void np2kai_destroy(np2kai_handle h) {
	if (!h) return;
	pccore_term();
	qb_vermouth_term();
	scrnmng_destroy();
	soundmng_deinitialize();
	dosio_term();
	s_state.initialized = 0;
}

int np2kai_set_bios_dir(np2kai_handle h, const char *path) {
	if (!h || !path) return -1;
	size_t len = strlen(path);
	if (len >= sizeof(np2cfg.biospath)) return -2;
	memcpy(np2cfg.biospath, path, len + 1);
	file_setcd(np2cfg.biospath);
	return 0;
}

int np2kai_insert_fdd(np2kai_handle h, const char *path, int drive, int readonly) {
	if (!h || !path) return -1;
	if (drive < 0 || drive > 3) return -2;
	/* Use fdd_set directly: bypasses fdc.equip guard and 20-frame mount delay.
	 * diskdrv_setfdd requires fdc.equip to be set AND adds a delay, causing the
	 * disk to be unavailable when the BIOS attempts FDD boot in the first frames. */
	BRESULT r = fdd_set((REG8)drive, path, FTYPE_NONE, readonly ? 1 : 0);
	LOGD("np2kai_insert_fdd: drive=%d path=%s result=%d", drive, path, r);
	return (r == SUCCESS) ? 0 : -3;
}

/* SASI/IDE HDD のマウント。drive 0-3 が SASIHDD_MAX の有効レンジ。
 * 受け入れフォーマットは sxsihdd.c の自動判定に任せる (HDI/THD/NHD/HDD raw 等)。
 *
 * 「リセット前に呼べば pccore_init で自動 bind、リセット後に呼べばその場で open」
 * の二段構えにする:
 *   - np2cfg.sasihdd[drive] / np2cfg.idetype[drive] に書く → 次回 pccore_init
 *     (= diskdrv_hddbind) が走るとき自動でマウントされる
 *   - 同時に sxsi_setdevtype + sxsi_devopen も直接呼ぶ → 現セッションで即使える
 * 通常 JS 側は挿入後に np2kai_reset を呼んで HDD からブートし直す想定。 */
int np2kai_insert_hdd(np2kai_handle h, const char *path, int drive) {
	if (!h || !path) return -1;
	if (drive < 0 || drive >= SASIHDD_MAX) return -2;

	file_cpyname(np2cfg.sasihdd[drive], path, NELEMENTS(np2cfg.sasihdd[drive]));
	np2cfg.idetype[drive] = SXSIDEV_HDD;

	sxsi_setdevtype((REG8)drive, SXSIDEV_HDD);
	BRESULT r = sxsi_devopen((REG8)drive, path);
	LOGD("np2kai_insert_hdd: drive=%d path=%s result=%d", drive, path, r);
	return (r == SUCCESS) ? 0 : -3;
}

void np2kai_eject_hdd(np2kai_handle h, int drive) {
	if (!h) return;
	if (drive < 0 || drive >= SASIHDD_MAX) return;
	sxsi_devclose((REG8)drive);
	np2cfg.sasihdd[drive][0] = '\0';
	np2cfg.idetype[drive] = SXSIDEV_NC;
	LOGD("np2kai_eject_hdd: drive=%d", drive);
}

void np2kai_run_frame(np2kai_handle h) {
	if (!h) return;
	pccore_exec(TRUE);
}

void np2kai_reset(np2kai_handle h) {
	if (!h) return;
	pccore_reset();
	LOGD("np2kai_reset");
}

/* INT 21h AH 別呼び出し回数 (qbDebug.int21Stats 用)。dos_int21.c が更新する。 */
extern int  qb_dos_dbg_ah_count(int ah);
extern void qb_dos_dbg_ah_reset(void);
int  np2kai_debug_int21_count(int ah) { return qb_dos_dbg_ah_count(ah); }
void np2kai_debug_int21_reset(void)   { qb_dos_dbg_ah_reset(); }

uint64_t np2kai_debug_get_pc(np2kai_handle h) {
	if (!h) return 0;
	uint64_t cs  = (uint16_t)CPU_REGS_SREG(CPU_CS_INDEX);
	uint64_t eip = (uint32_t)CPU_EIP;
	return (cs << 32) | eip;
}

uint32_t np2kai_debug_get_cs(np2kai_handle h) {
	if (!h) return 0;
	return (uint16_t)CPU_REGS_SREG(CPU_CS_INDEX);
}

uint32_t np2kai_debug_get_linear_pc(np2kai_handle h) {
	if (!h) return 0;
	uint32_t cs  = (uint16_t)CPU_REGS_SREG(CPU_CS_INDEX);
	uint32_t eip = (uint32_t)CPU_EIP & 0xffff;
	return (cs << 4) + eip;
}

uint32_t np2kai_debug_peek8(np2kai_handle h, uint32_t linear_addr) {
	if (!h) return 0;
	return memp_read8(linear_addr);
}

uint32_t np2kai_debug_get_gdc_mode1(np2kai_handle h) {
	if (!h) return 0;
	return gdc.mode1;
}

uint32_t np2kai_debug_get_textdisp(np2kai_handle h) {
	if (!h) return 0;
	return (uint32_t)gdcs.textdisp;
}

uint32_t np2kai_debug_get_grphdisp(np2kai_handle h) {
	if (!h) return 0;
	return (uint32_t)gdcs.grphdisp;
}

/* デバッグ: 16-bit CPU レジスタを idx で読む (ハング時のレジスタ確認用)。
 * 0:AX 1:BX 2:CX 3:DX 4:SI 5:DI 6:BP 7:SP 8:DS 9:ES 10:SS 11:CS 12:IP */
uint32_t np2kai_debug_get_reg16(np2kai_handle h, int idx) {
	if (!h) return 0;
	switch (idx) {
	case 0:  return (uint16_t)CPU_AX;
	case 1:  return (uint16_t)CPU_BX;
	case 2:  return (uint16_t)CPU_CX;
	case 3:  return (uint16_t)CPU_DX;
	case 4:  return (uint16_t)CPU_SI;
	case 5:  return (uint16_t)CPU_DI;
	case 6:  return (uint16_t)CPU_BP;
	case 7:  return (uint16_t)CPU_SP;
	case 8:  return (uint16_t)CPU_REGS_SREG(CPU_DS_INDEX);
	case 9:  return (uint16_t)CPU_REGS_SREG(CPU_ES_INDEX);
	case 10: return (uint16_t)CPU_REGS_SREG(CPU_SS_INDEX);
	case 11: return (uint16_t)CPU_REGS_SREG(CPU_CS_INDEX);
	case 12: return (uint16_t)(CPU_EIP & 0xffff);
	default: return 0;
	}
}

void np2kai_key_down(np2kai_handle h, uint8_t pc98_keycode) {
	if (!h) return;
	keystat_keydown((REG8)(pc98_keycode & 0x7f));
}

void np2kai_key_up(np2kai_handle h, uint8_t pc98_keycode) {
	if (!h) return;
	keystat_keyup((REG8)(pc98_keycode & 0x7f));
}

void np2kai_mouse_move(np2kai_handle h, int dx, int dy) {
	if (!h) return;
	qb_mouse_post_move(dx, dy);
}

void np2kai_mouse_button(np2kai_handle h, int button, int down) {
	if (!h) return;
	qb_mouse_post_button(button, down ? 1 : 0);
}

int np2kai_set_audio_rate(uint32_t rate) {
	switch (rate) {
	case 11025: case 22050: case 44100: case 48000:
	case 88200: case 96000: case 176400: case 192000:
		break;
	default:
		return -1;
	}
	np2cfg.samplingrate = rate;
	return 0;
}

uint32_t np2kai_audio_drain(np2kai_handle h, int16_t *dst, uint32_t max_frames) {
	if (!h || !dst) return 0;
	return qb_audio_drain(dst, max_frames);
}

uint32_t np2kai_audio_get_rate(np2kai_handle h) {
	if (!h) return 0;
	return qb_audio_get_rate();
}

/* ---- Phase 3 ミニマル DOS ローダ ---- */

int np2kai_dos_stage_com(const uint8_t *image, int size, const char *cmdline,
                         const char *name) {
	if (size <= 0) return -1;
	return qb_dos_stage_com(image, (size_t)size, cmdline, name);
}

int np2kai_dos_stage_exe(const uint8_t *image, int size, const char *cmdline,
                         const char *name) {
	if (size <= 0) return -1;
	return qb_dos_stage_exe(image, (size_t)size, cmdline, name);
}

int np2kai_dos_get_exit(int *code_out) {
	return qb_dos_get_exit(code_out);
}

const uint8_t *np2kai_get_framebuffer(
	np2kai_handle h,
	int *out_width,
	int *out_height,
	int *out_bytes_per_pixel)
{
	if (!h || !scrnmng.dispsurf) {
		if (out_width)          *out_width          = 0;
		if (out_height)         *out_height         = 0;
		if (out_bytes_per_pixel)*out_bytes_per_pixel = 0;
		return NULL;
	}
	if (out_width)          *out_width          = scrnmng.width;
	if (out_height)         *out_height         = scrnmng.height;
	if (out_bytes_per_pixel)*out_bytes_per_pixel = scrnmng.bpp / 8;
	return (const uint8_t *)scrnmng.dispsurf;
}
