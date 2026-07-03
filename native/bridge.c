/* SPDX-License-Identifier: MIT */
#include <compiler.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>   /* chdir: POSIX cwd を NP2kai の curpath と揃える */

#include <math.h>         /* pow: パート別音量バランスの dB 換算 (opna_reset と同式) */
#include <pccore.h>
#include <dosio.h>
#include <scrnmng.h>
#include <soundmng.h>
#include <sound/beep.h>   /* beepcfg.vol — 起動音 (BEEP) ミュート用 */
#include <sound/fmboard.h>            /* g_opna[], OPNA_MAX — パート別音量の live 反映用 */
#include <sound/opna.h>              /* OPNA.fmgen */
#if defined(SUPPORT_FMGEN)
#include <sound/fmgen/fmgen_fmgwrap.h>  /* OPNA_SetVolume* (extern "C") */
#endif
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
#include "dos_mouse33.h"   /* INT 33h マウスドライバ HLE (並走供給 + カーソル合成) */

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
/* JS が要求した出力サンプルレート。np2kai_create の initload() が np2cfg を既定 (samplingrate=44100)
 * に丸ごと戻すため、create 内 (initload 直後) でこの値を再適用しないと set_audio_rate が一切効かない
 * (sound は soundmng_create の s_opened ガードで最初の 1 回しか rate を確定できず、それが create 内の
 * pccore_reset→sound_init で 44100 に固定される)。0 = 未指定 (既定のまま)。np2kai_set_audio_rate で設定。 */
static uint32_t s_req_audio_rate = 0;

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
 * 直後に np2kai_reset を呼ぶと:
 *   - iocore_reset→rs232c_reset が COMCREATE_SERIAL を VERMOUTH に繋ぎ直し、RS-MIDI (-X1, 例 MIDDRV) の
 *     MIDI バイトが合成される。
 *   - pccore_set が mpuenable を見て PCCBUS_MPU98 を立て、cbuscore_bind→mpu98ii_bind が MPU-PC98 (0xE0D0) を
 *     attach、mpu98ii_reset→commng_create(MPU98II) が VERMOUTH ストリームを (再)登録する。
 * これで「MIDI(MPU)」モードのゲーム (huma_ts2 = 東方封魔録 等、MMD ドライバが 0xE0D0 を直接叩く) も鳴る。
 *
 * MPU98II の有効化は VERMOUTH ロード成功時だけ・かつ enable_midi_now は MIDI レシピ Run 時のみ呼ばれるので、
 * MPU の attach は「MIDI を使うセッション限定」に留まる (非 MIDI ゲームは mpuenable=0 のまま = 0xE0D0 は
 * 未 attach で従来通り)。port=0xE0D0/INT2 (mpuopt=0x82) は pccore_setdefault と同値。
 * 戻り値: VERMOUTH ロード成否 (1=成功 / 0=失敗: freepats 不在等)。冪等。 */
int np2kai_enable_midi_now(np2kai_handle h) {
	if (!h) return 0;
	s_midi_enable = 1;
	if (!qb_vermouth_ready()) {
		qb_vermouth_init();
	}
	if (qb_vermouth_ready()) {
		/* MPU-PC98 (MPU98II) を限定有効化。次の reset で 0xE0D0/INT2 が attach され、
		 * commng_create(COMCREATE_MPU98II) が VERMOUTH に結線される (qb_commng.c)。 */
		np2cfg.mpuenable = 1;
		np2cfg.mpuopt    = 0x82;   /* 0xE0D0, INT2 (= MPU-PC98 標準) */
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
	/* set_audio_rate (create より前に JS が呼ぶ) を再適用する。initload が np2cfg を既定構造体に
	 * 戻し samplingrate=44100 にするため、ここで戻さないと create 内の最初の sound 作成 (pccore_reset
	 * →sound_init→soundmng_create、s_opened ガードで一度きり) が常に 44100 で固定され、AudioContext が
	 * 48000 の端末で全音源が ~1.5 半音高く再生される (Beep/MIDI/FM 一様に高い真因)。 */
	if (s_req_audio_rate) np2cfg.samplingrate = s_req_audio_rate;
	np2cfg.fddequip = 0x03; /* equip drives A and B so diskdrv_* functions accept them */
	/* ブート時の ITF (BIOS POST) ROM 実行を抑止。POST が出すメモリカウント (例:
	 * "Memory xxxxx KB" のカウントアップ) と起動ピポ音を丸ごとスキップする。bios_itfcall は
	 * ITF_WORK の値に関係なく必須の初期化 (memclear/vectorset/bios0x09_init/reinitbyswitch/
	 * bios0x18_0c) を先に走らせ、ITF_WORK=0 のときは ITF ROM への far call を踏まずに MSW 既定を
	 * 入れて返すだけ (bios/bios.c:702)。我々は自己起動ディスク (loader.d88) でブートし NEC BIOS の
	 * ブートストラップに依存しないので、POST 本体は不要。音楽 Run のたびの reset で目に付く
	 * メモリカウントが消える (ゲーム Run も同様に速くなる)。実機 POST を見たい層向けに
	 * np2kai_set_itf_post(1) (= qbDebug.itfpost(1)) で復活できる (既定はこの 0 のまま)。 */
	np2cfg.ITF_WORK = 0;
	/* BEEP 音量ブースト (既定 4x)。【重要】vol_master が実際に効くのは opngen/beep/psg(opngen)/
	 * cs4231/ADPCM/PCM 等の整数合成経路だけで、既定の fmgen FM にも TSF MIDI にも届かない: fmgen の
	 * 音量は opna_reset が vol_fm で直接設定し vol_master を畳む経路 (fmboard_updatevolume→
	 * opna_fmgen_setallvolume*_linear) は opnalist 未 populate で完全 no-op、MIDI は qb_tsf の
	 * QB_OUT_SCALE 経路で vol_master を通らない。この性質を使い、vol_master を上げて BEEP を持ち上げ、
	 * ADPCM/PCM 側を相殺して不変に保つ = FM/MIDI/ADPCM を一切変えず BEEP だけを増幅する。
	 * 動機: np2kai 標準の BEEP は beepcfg.vol が 0..3 の 4 段階しか持たず矩形波が peak 2048 (-24dBFS)
	 * で頭打ちのため、FM/MIDI 楽曲の下で SE が ~18-23dB 埋もれて聴こえない (amel133 作者報告・実測確認)。
	 * np2kai_set_beep_gain(400) で BEEP_VOL=3 + vol_master=255 (UINT8 上限) → 実 ~383% (+11.7dB)、
	 * BEEP peak ≈ 7834 (-12dBFS、MIDI と同等)。実行時に qbDebug.beepgain(x) で A/B 可。 */
	np2kai_set_beep_gain(400);
	/* FM 音源は fmgen (cisc C++ ライブラリ) を既定にする。以前は「低音のビリビリ」を理由に
	 * opngen (NP2 オリジナル) へ切り替えていたが、その歪みの主因は soft-clip 導入前の
	 * ハードクリップだった。soft-clip + -O2/-O3 (CPU 余裕) を揃えた後の実機
	 * A/B で、fmgen は opngen より明確に高音質と確認 (opngen では埋もれて聞こえなかったパート
	 * が出る)。CPU は重めだが -O3 で吸収できる。実行時 A/B は np2kai_set_fmgen /
	 * qbDebug.fmgen(0|1) で可能 (次の Run で反映)。 */
	np2cfg.usefmgen = 1;
	/* 音源ボードは素の PC-9801-86 (SOUNDID 0x04 = pccore_setdefault の既定) のまま使う。
	 * 【2026-06-17 revert】一時 86+ADPCM (0x14) を既定化したが (.PPC 等 ADPCM PCM 声部の将来対応の
	 * 前倒し)、現コーパスに実需が無い (no-op) ため戻した。0x14 は board86_reset で OPNA_HAS_ADPCM を
	 * 立て、opna_readExtendedStatus が ADPCM ステータスビットを混ぜる等 OPNA の実時間挙動を変える
	 * 副作用があり、利得ゼロでこれを抱える理由が無い (ADPCM が要る曲データが実在したら、その再生
	 * セッションでだけ限定有効化する = 下の IRQ12 と同型)。※ザルバール無音回帰の真因は ADPCM でなく
	 * 86 ボードの割り込み線だった (下記)。 */
	/* 86 ボードの割り込みレベルは np2kai_create では設定せず、JS の loadLoaderDisk が毎ブートで
	 * np2kai_set_pmd_irq により決める (既定 = INT5/IRQ12)。PC-98 86 ボードの FM ドライバの多くは
	 * INT5=IRQ12 を前提に ISR を hook する de-facto 標準で、ザルバールの SIZ3/SIZ4P は IRQ12 決め打ち
	 * (既定 IRQ だと曲送りが止まり本編 FM が無音)、我々の PMD .M プレイヤも IRQ12 前提、KAJA PMD86
	 * (東方旧作同梱) は board 設定に追従するのでどちらでも鳴る → IRQ12 を既定にすれば全部満たす。
	 * (履歴: a0fe8a4 で .M 用に snd86opt|=0x0C をグローバル適用 → deae233 が「東方を壊す」として
	 *  音楽セッション限定に縮めたが、その診断は誤りで IRQ12 必須の SIZ3/SIZ4P を巻き添えに無音化して
	 *  いた。東方は IRQ12 でも正常と実機確認済 = 2026-06-17。) */
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

extern void qb_dos_inject_pump(void);   /* dos_int21.c: ホスト IME 注入 FIFO→BIOS キーバッファ補充 */
void np2kai_run_frame(np2kai_handle h) {
	if (!h) return;
	qb_dos_inject_pump();   /* BIOS INT 18h 直読みアプリにも注入が届くよう 0x502 を毎フレーム補充 */
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

/* GS システムエフェクト (reverb/chorus/delay) の on/off (qbDebug.midifx)。VERMOUTH 全 hdl 共通。
 * 主にドライ/ウェットの A/B 確認用。既定は ON。 */
extern void midiout_fx_setenable(int enable);   /* core/np2kai/sound/vermouth/midiout.c */
void np2kai_debug_midi_fx(int enable) { midiout_fx_setenable(enable); }

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

/* デバッグ用書込プリミティブ (peek8 の対)。テキスト VRAM へマーカーを仕込んで
 * 「ゲームが属性を書くか／既定値を継ぐか」を切り分ける等の調査に使う。 */
void np2kai_debug_poke8(np2kai_handle h, uint32_t linear_addr, uint32_t val) {
	if (!h) return;
	memp_write8(linear_addr, (REG8)(val & 0xff));
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

/* GDC パレット状態を読む (真っ黒画面の切り分け用)。
 * kind 0: gdc.analog (bit0=16色アナログモード) / 1: degpal[idx] (デジタル 8 色, idx 0-3)
 * 2: anapal[idx] を 00RRGGBB で (idx 0-15) / 3: palnum */
uint32_t np2kai_debug_get_palette(np2kai_handle h, int kind, int idx) {
	if (!h) return 0;
	switch (kind) {
	case 0: return (uint32_t)gdc.analog;
	case 1: return (idx >= 0 && idx < 4) ? (uint32_t)gdc.degpal[idx] : 0;
	case 2: if (idx < 0 || idx > 15) return 0;
	        return ((uint32_t)gdc.anapal[idx].p.r << 16) |
	               ((uint32_t)gdc.anapal[idx].p.g << 8) |
	               (uint32_t)gdc.anapal[idx].p.b;
	case 3: return (uint32_t)gdc.palnum;
	case 4: return (uint32_t)gdcs.disp;      /* 表示ページ (0/1) */
	case 5: return (uint32_t)gdc.mode2;      /* port 0x6A モードFF2 */
	case 6: return (uint32_t)gdcs.access;    /* 描画 (CPU アクセス) ページ */
	}
	return 0;
}

/* PC-98 RTC (μPD4990A) が「いま返す」日付 BCD を読む (Y2K クランプ検証用)。
 * idx 0=年(BCD 下2桁) 1=(月<<4|曜) 2=日 3=時 4=分 5=秒。年が 0x99 等 (<0xA0) なら 2 桁で健全。 */
extern void calendar_getvir(UINT8 *bcd);
uint32_t np2kai_debug_rtc_bcd(np2kai_handle h, int idx) {
	UINT8 bcd[6];
	if (!h || idx < 0 || idx > 5) return 0;
	calendar_getvir(bcd);
	return (uint32_t)bcd[idx];
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

/* ホスト (ブラウザ) の IME で確定したかな漢字混じり文字列を Shift-JIS バイト列で受け取り、
 * ゲストの DOS 文字入力に注入する。FEP を持ち込まず、ユーザー自身の OS/ブラウザ IME で
 * 日本語入力するための経路 (2026-06-21、ホスト側変換プロトタイプ)。受理したバイト数を返す。 */
extern void qb_dos_inject_input(const uint8_t *bytes, int len);  /* dos_int21.c */
int np2kai_inject_text(np2kai_handle h, const uint8_t *bytes, int len) {
	if (!h || !bytes || len <= 0) return 0;
	qb_dos_inject_input(bytes, len);
	return len;
}

void np2kai_mouse_move(np2kai_handle h, int dx, int dy) {
	if (!h) return;
	qb_mouse_post_move(dx, dy);
	qb_mouse33_post_move(dx, dy);   /* INT 33h HLE へも並走供給 (HW バスマウスと独立) */
}

void np2kai_mouse_button(np2kai_handle h, int button, int down) {
	if (!h) return;
	qb_mouse_post_button(button, down ? 1 : 0);
	qb_mouse33_post_button(button, down ? 1 : 0);
}

/* INT 33h HLE の制御 (qbDebug.mouse33): mode 0=off / 1=MS 仕様 / 2=NEC 仕様 */
void np2kai_mouse33_ctl(np2kai_handle h, int mode) {
	if (!h) return;
	qb_mouse33_set_mode(mode);
}
uint32_t np2kai_mouse33_stat(np2kai_handle h, int which) {
	if (!h) return 0;
	return qb_mouse33_stat(which);
}

int np2kai_set_audio_rate(uint32_t rate) {
	switch (rate) {
	case 11025: case 22050: case 44100: case 48000:
	case 88200: case 96000: case 176400: case 192000:
		break;
	default:
		return -1;
	}
	s_req_audio_rate     = rate;   /* create の initload を生き残らせるため退避 */
	np2cfg.samplingrate  = rate;   /* create 後に呼ばれた場合用 (即時反映先) */
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

/* --- パート別音量バランスの実行時調整 (症状②: リズムがメロより前に出すぎ) ---
 * fmgen の各パート音量は opna_reset が np2cfg.vol_* から直接 dB 設定する (fmboard_updatevolume
 * 経由ではない: opnalist 未 populate で opna_fmgen_setallvolume*_linear が no-op のため)。よって
 * np2cfg を書き換えるだけでは「次の reset」まで効かない。ここでは np2cfg を更新した上で、生きている
 * g_opna[].fmgen インスタンスにも opna_reset と同じ dB 換算で即反映する (reset を待たず live A/B 可)。
 * 引数は 0..128 (np2 既定スケール)。負値はそのパート据え置き (= 部分更新)。fmgen 側 ADPCM の音量は
 * opna_reset:128 と同じく np2cfg.vol_pcm 経由。 */
static int qb_vol_to_db(int v) {
	if (v < 0) v = 0; else if (v > 128) v = 128;
	return (int)(pow((double)v / 128, 0.12) * (20 + 192) - 192);  /* = opna_reset:126-129 と同式 */
}

void np2kai_set_vol(int fm, int ssg, int rhythm, int adpcm) {
	if (fm     >= 0) np2cfg.vol_fm     = (UINT8)(fm     > 128 ? 128 : fm);
	if (ssg    >= 0) np2cfg.vol_ssg    = (UINT8)(ssg    > 128 ? 128 : ssg);
	if (rhythm >= 0) np2cfg.vol_rhythm = (UINT8)(rhythm > 128 ? 128 : rhythm);
	if (adpcm  >= 0) np2cfg.vol_pcm    = (UINT8)(adpcm  > 128 ? 128 : adpcm);
#if defined(SUPPORT_FMGEN)
	{
		int i;
		for (i = 0; i < OPNA_MAX; i++) {
			void *fg = g_opna[i].fmgen;
			if (!fg) continue;
			if (fm     >= 0) OPNA_SetVolumeFM(fg,          qb_vol_to_db(np2cfg.vol_fm));
			if (ssg    >= 0) OPNA_SetVolumePSG(fg,         qb_vol_to_db(np2cfg.vol_ssg));
			if (rhythm >= 0) OPNA_SetVolumeRhythmTotal(fg, qb_vol_to_db(np2cfg.vol_rhythm));
			if (adpcm  >= 0) OPNA_SetVolumeADPCM(fg,       qb_vol_to_db(np2cfg.vol_pcm));
		}
	}
#endif
}

/* which: 0=fm 1=ssg 2=rhythm 3=adpcm(=vol_pcm) 4=master。現在の np2cfg 値 (0..128) を返す。 */
uint32_t np2kai_get_vol(int which) {
	switch (which) {
		case 0:  return np2cfg.vol_fm;
		case 1:  return np2cfg.vol_ssg;
		case 2:  return np2cfg.vol_rhythm;
		case 3:  return np2cfg.vol_pcm;
		case 4:  return np2cfg.vol_master;
		default: return 0;
	}
}

/* 起動音 (PC-98 の「ピポ」) のミュート。pipo は BEEP (スピーカ)、PMD 音楽は FM (OPNA) と別音源
 * なので、BEEP の音量 (beepcfg.vol) を 0 にすれば pipo だけ消えて曲は無傷。音楽セッションの
 * ブートでだけミュートし、ゲーム起動 (まっさら環境) では当時どおり鳴らす用途。
 * mute!=0 で現在音量を退避して 0、mute=0 で復帰。戻り値 = 設定後の beep 音量。 */
extern BEEPCFG beepcfg;
extern void beep_setvol(UINT vol);
static int  s_beep_muted = 0;       /* 現在ミュート中か */
static UINT s_beep_vol_saved = 0;   /* ミュート直前の beep 音量 (復元用) */
int np2kai_set_beep_mute(int mute) {
	if (mute) {
		if (!s_beep_muted) { s_beep_vol_saved = beepcfg.vol; s_beep_muted = 1; }
		beepcfg.vol = 0;
	} else if (s_beep_muted) {       /* 未ミュート時は実既定を壊さない (no-op) */
		beepcfg.vol = s_beep_vol_saved;
		s_beep_muted = 0;
	}
	return (int)beepcfg.vol;
}

/* BEEP (PC-98 内蔵ブザー) の音量ブースト。gain_pct=100 が素の np2kai (矩形波 peak 2048 = -24dBFS)。
 * vol_master は fmgen FM/TSF MIDI に効かず BEEP と ADPCM/PCM だけに効くので、vol_master を上げて BEEP を
 * 持ち上げ、ADPCM/PCM の音量を相殺して不変に保つ (= FM/MIDI/ADPCM を変えず BEEP だけ増幅)。BEEP_VOL は
 * 0..3 の 4 段階なので ×1.5 までしか稼げず、残りは vol_master(UINT8、上限 255) で。よって純設定での上限は
 * BEEP_VOL=3 × vol_master=255 ≈ 383% (+11.7dB)。それ以上は要コア改変 (beepg.c のゲイン項)。
 * 既定は np2kai_create が 400 (→クランプ 383) で呼ぶ。実行時は qbDebug.beepgain(x) で A/B (beep は live、
 * ADPCM/PCM 相殺は次 reset で反映)。戻り値 = 実際に適用した % (クランプ後)。 */
int np2kai_set_beep_gain(int gain_pct) {
	int bv, vm, comp;
	if (gain_pct < 50)  gain_pct = 50;
	if (gain_pct > 383) gain_pct = 383;
	if (gain_pct >= 150) { bv = 3; vm = gain_pct * 100 / 150; }  /* BEEP_VOL=3 が ×1.5、残りを vol_master で */
	else                 { bv = 2; vm = gain_pct; }              /* 等倍以下は BEEP_VOL=2 (×1.0) */
	if (vm < 1)   vm = 1;
	if (vm > 255) vm = 255;
	comp = 6400 / vm;                  /* vol_adpcm*vol_master/100 を ~64 一定に (= 64*100/vm) */
	if (comp < 1)   comp = 1;
	if (comp > 128) comp = 128;
	np2cfg.BEEP_VOL   = (UINT8)bv;
	np2cfg.vol_master = (UINT8)vm;
	np2cfg.vol_adpcm  = (UINT8)comp;   /* ADPCM/PCM は次 reset の setvol で相殺反映 */
	np2cfg.vol_pcm    = (UINT8)comp;
	if (s_beep_muted) s_beep_vol_saved = (UINT)bv;  /* ミュート中は復元値だけ更新 (起動音ミュートを壊さない) */
	else              beep_setvol((UINT)bv);        /* live 反映 (beepg が vol_master を実時間で読む) */
	return gain_pct;
}

/* 86 ボードの割り込みレベルを INT5/IRQ12 に寄せる (on) / 既定へ戻す (off)。INT5/IRQ12 は PC-98
 * 86 ボード FM ドライバの de-facto 標準で、JS の loadLoaderDisk が毎ブート on を既定に呼ぶ
 * (ザルバール SIZ3/SIZ4P=IRQ12 決め打ち、我々の PMD .M=IRQ12 前提、KAJA PMD86=どちらでも可)。
 * off は将来 IRQ12 非対応ドライバが出たときの逃げ道 (qbDebug.snd86irq(0))。
 * snd86opt は board bind (pccore_reset) 時に読まれるので、reset の前に設定すること。 */
int np2kai_set_pmd_irq(int on) {
	if (on) np2cfg.snd86opt |= 0x0C;       /* bit2,3 = IRQ セレクト → s_irqtable[3]=0x0c=IRQ12 */
	else    np2cfg.snd86opt &= ~0x0C;      /* 既定 (IRQ3 相当) に戻す */
	return np2cfg.snd86opt;
}

/* 「ちびおと」= PC-9801-86 + ADPCM RAM (SOUNDID 0x14) のセッション限定有効化。
 * on で 86+ADPCM (256KB ADPCM RAM 有効)、off で素の 86 (0x04) に戻す。FMP の .ovi /
 * PMD の .PPC 等、ADPCM(PCM) 声部を持つ曲データを鳴らすのに要る。
 * 既定 OFF。理由: 0x14 は board86_reset で OPNA_HAS_ADPCM を立て、opna_readExtendedStatus が
 * ADPCM ステータスビットを混ぜる等 OPNA の実時間挙動を変える副作用があり、ADPCM 不要な
 * タイトルに恒常的に課す利得がない (素の 86 = 0x04 が安全既定)。よって「ADPCM が要る曲を
 * 鳴らすセッションだけ on」にする (np2kai_set_pmd_irq / enable_midi_now と同型のオプトイン)。
 * SOUND_SW は pccore_reset → pccore_set で pccore.sound に読まれ fmboard_reset がボードを
 * 再 bind するので、設定後の次 reset (Run) から反映する。qbDebug.chibioto(0|1) の実体。 */
int np2kai_set_chibioto(int on) {
	np2cfg.SOUND_SW = on ? SOUNDID_PC_9801_86_ADPCM : SOUNDID_PC_9801_86;
	return np2cfg.SOUND_SW;
}

/* ブート時の ITF (BIOS POST) ROM 実行のトグル。on=1 で POST を復活 (メモリカウント+起動ピポ音を
 * 出す、実機ノスタルジー用)、on=0 で既定どおりスキップ。既定 = 0 (create 時に np2cfg.ITF_WORK=0)。
 * np2cfg.ITF_WORK は reset 毎の bios_initialize → bios_itfcall で読まれるので、設定後の次 Run (reset)
 * から反映。qbDebug.itfpost(0|1) の実体。詳細は上の np2cfg.ITF_WORK 設定箇所のコメント。 */
int np2kai_set_itf_post(int on) {
	np2cfg.ITF_WORK = on ? 1 : 0;
	return np2cfg.ITF_WORK;
}

/* 仮想 30行BIOS: 30 行テキスト表示 (640×480) + 30BIOS-API のセッション限定オン/オフ。
 * フラグ (dos_int21.c の qb_lines30_enabled) を立てるだけで、実際の切替えは次の Run の
 * loader-start (dos_loader.c) が行う (IVT[0x18] 横取り + GDC 480 ライン化 + tty 30 行)。
 * 既定 OFF = ゼロ回帰。qbDebug.lines30(0|1) の実体。詳細: docs/30line_spec.md。 */
int np2kai_set_lines30(int on) {
	extern int qb_lines30_enabled;   /* dos_int21.c */
	qb_lines30_enabled = on ? 1 : 0;
	return qb_lines30_enabled;
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

/* ③ if errorlevel / goto 入り .bat: 直列化文列 (batscript.js serializeStatements) を stage。
 * errorlevel 分岐は C 側文インタプリタが実行時に評価する (prog は SJIS 安全のため生バイト)。 */
int np2kai_dos_stage_batch(const char *prog, int len, const char *name) {
	if (!prog || len <= 0) return -1;
	return qb_dos_stage_batch(prog, (size_t)len, name);
}

int np2kai_dos_get_exit(int *code_out) {
	return qb_dos_get_exit(code_out);
}

/* 音楽セッション (PMD .M を再起動なしで次々演奏): stage_music で PMD86 常駐セッションを仕込み、
 * loader.d88 で 1 度起動 → 以後 music_play(song) で曲だけ差し替える。 */
int np2kai_dos_stage_music(void) {
	return qb_dos_stage_music();
}
int np2kai_dos_music_play(const char *song) {
	return qb_dos_music_play(song);
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
	/* INT 33h HLE のドライバカーソル: 表示中だけ pc98surf (完全な現画面) から dispsurf を
	 * 引き直してオーバーレイ合成する。dispsurf にしか描かないのでゲスト VRAM は不変、
	 * 前フレームのカーソル残像も毎回消える (save-under 不要)。 */
	if (qb_mouse33_cursor_visible() && scrnmng.pc98surf && scrnmng.bpp == 16) {
		size_t sz = (size_t)scrnmng.width * scrnmng.height * (scrnmng.bpp / 8);
		memcpy(scrnmng.dispsurf, scrnmng.pc98surf, sz);
		qb_mouse33_overlay((uint16_t *)scrnmng.dispsurf, scrnmng.width, scrnmng.height);
	}
	return (const uint8_t *)scrnmng.dispsurf;
}
