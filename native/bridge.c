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
int  qb_vermouth_ready(void); /* defined in qb_vermouth.c (vermouth_module != NULL) */

typedef struct {
	int initialized;
} QB_State;

static QB_State s_state;
static char s_data_dir[MAX_PATH];
/* create 時に MPU98II ハードを attach するか (= -X0 MPU 直叩き経路用)。create 前に
 * np2kai_enable_midi() で立てる旧 API でのみ ON になる。デフォルト OFF: MPU98II は検出されず、
 * ゲームは FM 専用 (= 音源選択 UI が出る)。
 * 現行の MIDI 経路 (RS-MIDI -X1) は create 後の np2kai_enable_midi_now() を使い、この flag の
 * create 時分岐 (下記) は通らない。create 時分岐は将来の -X0 MPU 直叩き対応のための足場。 */
static int s_midi_enable = 0;

int np2kai_set_data_dir(const char *path) {
	if (!path) return -1;
	size_t len = strlen(path);
	if (len >= sizeof(s_data_dir)) return -2;
	memcpy(s_data_dir, path, len + 1);
	LOGD("np2kai_set_data_dir: %s", s_data_dir);
	return 0;
}

/* create 前に呼ぶ MPU98II 有効化 API。1=MPU98II ポート attach + VERMOUTH 構築、0=無効。
 * create 後の切り替えはできない (要 reset)。
 *
 * 現状フロントエンドはこちらを呼ばない: 実プレイ可能な MIDI ゲーム (MIDDRV 等) は RS-MIDI
 * (-X1, シリアル) 経路で、create 後の np2kai_enable_midi_now() で結線する方が筋が良いため
 * (core 再生成不要・MPU stream 二重登録による音量半減も無い)。
 * この API と create 時の mpuenable 分岐は、ゲームが MPU98II (0xC0D0) を直接叩く -X0 経路への
 * 対応を将来入れる時の足場として温存している (TODO「-X0 MPU 直叩き」参照)。 */
void np2kai_enable_midi(int enable) {
	s_midi_enable = enable ? 1 : 0;
	LOGD("np2kai_enable_midi: %d", s_midi_enable);
}

/* 遅延 MIDI 有効化 (ブラウザ on-demand)。create 後に VERMOUTH を構築する。
 * 前提: freepats (CWD/timidity.cfg と CWD/freepats/{Tone,Drum}_000/ の .pat 群) を呼び出し前に配置済み
 * (CWD は create 内の chdir(data_dir) で data dir になっている)。
 * 直後に np2kai_reset を呼ぶと iocore_reset→rs232c_reset が COMCREATE_SERIAL を VERMOUTH に
 * 繋ぎ直し、RS-MIDI (-X1, 例 MIDDRV) の MIDI バイトが合成されるようになる。
 * MPU は使わない経路なので mpuenable は触らない (VERMOUTH stream を二重登録しないため)。
 * 戻り値: VERMOUTH ロード成否 (1=成功 / 0=失敗: freepats 不在等)。冪等。 */
int np2kai_enable_midi_now(np2kai_handle h) {
	if (!h) return 0;
	s_midi_enable = 1;
	if (!qb_vermouth_ready()) {
		qb_vermouth_init();
	}
	return qb_vermouth_ready();
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
	/* マスター音量。【重要】vol_master が実際に効くのは opngen/beep/psg(opngen)/cs4231 等の
	 * 整数合成経路だけで、既定の fmgen には届かない: fmgen の音量は opna_reset が vol_fm で直接
	 * 設定し、vol_master を畳む経路 (fmboard_updatevolume→opna_fmgen_setallvolume*_linear) は
	 * opnalist が一度も populate されない & fmboard_updatevolume が通常フローで呼ばれないため
	 * 完全な no-op。よって fmgen 既定の今、この値は無影響。
	 * 以前は opngen+ハードクリップ時代に「低音のビリビリ」回避で 65 まで絞っていたが、その歪みの
	 * 真因はクリップ段で、今は soft-clip (qb_soundmng) がピークを滑らかに捌くので絞る必要は無い。
	 * 100 に中立化 (opngen へ A/B 切替した時も soft-clip 任せで歪まない想定)。 */
	np2cfg.vol_master = 100;
	/* FM 音源は fmgen (cisc C++ ライブラリ) を既定にする。以前は「低音のビリビリ」を理由に
	 * opngen (NP2 オリジナル) へ切り替えていたが、その歪みの主因は soft-clip 導入前の
	 * ハードクリップだった。soft-clip + vol_master=65 + -O2/-O3 (CPU 余裕) を揃えた後の実機
	 * A/B で、fmgen は opngen より明確に高音質と確認 (opngen では埋もれて聞こえなかったパート
	 * が出る)。CPU は重めだが -O3 で吸収できる。実行時 A/B は np2kai_set_fmgen /
	 * qbDebug.fmgen(0|1) で可能 (次の Run で反映)。 */
	np2cfg.usefmgen = 1;
	/* オーディオレイテンシ (ms)。soundmng_create が rate*ms/(2*1000) を 2 の冪へ丸めて
	 * バッファ長にする。ini 既定 0 のままだと最小 (20ms→512frame) になり、メインスレッド
	 * の ScriptProcessor コールバックがジャンクで underrun しやすい。100 で ~170ms の
	 * 安全側に置く (48k: 2400→4096frame×2)。詰めたければ下げる。pull 型 (C1) なので
	 * このバッファはレイテンシのみに効き、ドリフトには無関係。 */
	np2cfg.delayms = 100;
	commng_initialize();      /* cmmidi_initailize で midictrlindex テーブル初期化 */
	if (s_data_dir[0]) {
		file_setcd(s_data_dir);   /* writable dir for font.tmp, saves, etc. */
		/* file_setcd は NP2kai 内部の curpath だけ更新。fopen 等の libc 関数は
		 * POSIX cwd を見るので、こちらも合わせる。これをしないと VERMOUTH の
		 * inst_create が "freepats/Tone_000/..." を / 直下に探して全失敗する。 */
		chdir(s_data_dir);
	}
	if (s_midi_enable) {
		/* -X0 MPU 直叩き経路用の足場 (将来対応)。現行 MIDI は create 後の
		 * np2kai_enable_midi_now() で RS-MIDI を繋ぐので、この分岐は通常通らない
		 * (s_midi_enable は np2kai_enable_midi でのみ create 前に立つ)。
		 * MPU98II ポート attach + VERMOUTH 合成器を起動。file_setcd 後に
		 * timidity.cfg を読みに行くので順序は守る。 */
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

/* INT 21h 全コールトレース on/off (デバッグ用)。dos_int21.c の g_int21_trace を切替える。 */
extern void qb_dos_set_int21_trace(int on);
void np2kai_dos_set_int21_trace(int on) { qb_dos_set_int21_trace(on); }

/* RS-MIDI 診断 (qbDebug.midi): シリアル(8251)へ流れた MIDI バイト数と、RS-MIDI→VERMOUTH
 * ルーティングが生きているか。MIDDRV -X1 が実際に送出しているか / 受け手が繋がったかの確認用。 */
extern UINT32 qb_serial_midi_bytes(void);   /* qb_commng.c */
extern int    qb_serial_midi_active(void);  /* qb_commng.c */
uint32_t np2kai_debug_serial_midi_bytes(np2kai_handle h)  { if (!h) return 0; return (uint32_t)qb_serial_midi_bytes(); }
int      np2kai_debug_serial_midi_active(np2kai_handle h) { if (!h) return 0; return qb_serial_midi_active(); }

/* XMS/EMS 需要プローブ (qbDebug.memprobe): 現タイトルが拡張メモリ (XMS/EMS) を要求した回数。
 * which 0=XMS(INT 2Fh AX=43xx) / 1=EMS(INT 67h) / 2=EMMXXXX0 open。いずれも未実装で「無し」と
 * 応答済みなので、>0 は「この方式の HLE 実装価値あり」のシグナル。dos_loader.c が更新。 */
extern uint32_t qb_dos_memprobe_count(int which);   /* dos_loader.c */
uint32_t np2kai_debug_memprobe(np2kai_handle h, int which) { if (!h) return 0; return qb_dos_memprobe_count(which); }

/* XMS (HIMEM 相当) HLE の制御/診断 (qbDebug.xms)。enable: 1=有効化/0=無効化、戻り値=反映後の実効状態。
 * stat which: 0=有効か / 1=確保中ハンドル数 / 2=使用バイト / 3=空きバイト。dos_xms.c が実装。 */
extern void     qb_xms_set_enabled(int on);   /* dos_xms.c */
extern int      qb_xms_enabled(void);
extern uint32_t qb_xms_stat(int which);
int      np2kai_xms_enable(np2kai_handle h, int on) { if (!h) return 0; qb_xms_set_enabled(on); return qb_xms_enabled(); }
uint32_t np2kai_xms_stat(np2kai_handle h, int which) { if (!h) return 0; return qb_xms_stat(which); }

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

/* GDC の para バイトを読む (表示幾何デバッグ用)。which=0:master(テキスト)/1:slave(グラフィック)。
 * 例: master GDC_SCROLL(=12) から テキスト表示開始アドレス(SAD)/パーティション長、PITCH(=28)。
 * SAD が非ゼロなら「表示 row0 = VRAM offset SAD」= row0 のメモリ直書きが画面外に追い出されている。 */
uint32_t np2kai_debug_get_gdc_para(np2kai_handle h, int which, int index) {
	if (!h || index < 0 || index > 255) return 0;
	return (uint32_t)(which ? gdc.s.para[index] : gdc.m.para[index]);
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

/* FM 音源エンジンの実行時 A/B 切替: 1 = fmgen (cisc C++ ライブラリ、OPNA 実機クセを精密再現、既定)、
 * 0 = opngen (NP2 オリジナル整数合成)。np2cfg.usefmgen を書くだけ。enable_fmgen は
 * pccore_reset で再読込され fmboard_bind→opna_bind が再ディスパッチするので、次の Run から
 * 反映される (Run は loader.d88 挿入 → reset を伴うため)。戻り値: 設定後の値 (0/1)。 */
int np2kai_set_fmgen(int on) {
	np2cfg.usefmgen = on ? 1 : 0;
	return np2cfg.usefmgen;
}

/* CPU クロック倍率の live 設定 (快適化 A/B / async 自動クロック / ベンチ用)。
 * realclock = baseclock × multiple が 1 表示フレームあたりの実行 CPU クロック数
 * (gdc.dispclock ∝ multiple) を決め、これが CPU-bound タイトルでの run_frame 負荷に比例する
 * (HLT-idle タイトルでは HLT fast-forward でほぼ無影響)。倍率↑ = エミュ CPU 高速化だが host
 * 負荷増。pull 型音声では DAC がマスタークロックなので、host が追いつかない倍率にすると音声
 * バッファが枯れて途切れる → real-time を割らない範囲で使う (JS の自動クロックが達成フレーム
 * 時間から逆算して [floor, ceil] 内で調整する)。
 *
 * reset 不要でその場 (live) 反映する。np2cfg.multiple も書くので次の Run (reset) でも保持。
 * 重要: 正しい live 反映は pccore.c の async-CPU 経路と同一の changeclock カスケードが必須。
 * gdc.dispclock を gdc_updateclock で再計算しないと「フレームあたり CPU 予算が古い倍率のまま」
 * になり倍率変更が一切効かない (実測で確認済みの罠)。nevent_changeclock は係属中イベントを
 * 新クロックへ再スケール、各デバイス *_changeclock は音源/BEEP/MPU/キーボード/マウスの
 * タイミング基準を追従させる。maxmultiple も合わせて非 async 既定 (=multiple) と整合させる。
 * 戻り値: クランプ後の適用倍率。 */
int np2kai_set_clock_multiple(int multiple) {
	/* pccore.c の async-CPU クロック変更と同一手順。include 増を避け extern 前方宣言。 */
	extern void pcm86_changeclock(UINT oldmultiple);
	extern void nevent_changeclock(UINT32 oldclock, UINT32 newclock);
	extern void sound_changeclock(void);
	extern void beep_changeclock(void);
	extern void mpu98ii_changeclock(void);
	extern void keyboard_changeclock(void);
	extern void mouseif_changeclock(void);
	extern void gdc_updateclock(void);
	UINT oldmultiple;

	if (multiple < 1) multiple = 1;
	else if (multiple > CPU_MULTIPLE_MAX) multiple = CPU_MULTIPLE_MAX;
	oldmultiple = pccore.multiple;
	np2cfg.multiple = (UINT)multiple;          /* 次の reset でも保持 */
	if ((UINT)multiple == oldmultiple) return multiple;   /* 変化なし: カスケード省略 */

	pccore.multiple    = (UINT)multiple;
	pccore.maxmultiple = (UINT)multiple;
	pccore.realclock   = pccore.baseclock * (UINT)multiple;
	pcm86_changeclock(oldmultiple);
	nevent_changeclock(oldmultiple, pccore.multiple);
	sound_changeclock();
	beep_changeclock();
	mpu98ii_changeclock();
	keyboard_changeclock();
	mouseif_changeclock();
	gdc_updateclock();
	return multiple;
}

/* 音声 pull 型 (C1)。JS の ScriptProcessorNode.onaudioprocess (audio DAC クロック)
 * が呼ぶ唯一の consumer。dst に frames ぶんのステレオ int16 を書く。 */
void np2kai_audio_fill(np2kai_handle h, int16_t *dst, uint32_t frames) {
	if (!h || !dst) return;
	qb_audio_fill(dst, frames);
}

/* ScriptProcessorNode のバッファ長 (= sndstream ブロック長)。JS が SPN 生成時に使う。 */
uint32_t np2kai_audio_get_bufsize(np2kai_handle h) {
	if (!h) return 0;
	return qb_audio_get_bufsize();
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

/* ② 起動 .bat の逐次実行: ミニ COMMAND.COM を stage (script は SJIS 安全のため生バイト)。 */
int np2kai_dos_stage_script(const char *script, int len, const char *name) {
	if (!script || len <= 0) return -1;
	return qb_dos_stage_script(script, (size_t)len, name);
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
