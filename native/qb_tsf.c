/* qb_tsf.c — VERMOUTH の代替 MIDI 合成バックエンド (TinySoundFont, 2026-06-13)
 *
 * 背景: VERMOUTH(GUS .pat)は同梱 freepats が 128 音色中 72 個しか無く、SC-88 想定曲の
 * リード/ベース/パッド等が無音になっていた。完全フリーかつ高品位な現代の音色は SF2/SFZ 形式で、
 * VERMOUTH は読めない。そこで合成エンジンを **TinySoundFont (TSF, MIT, 単一ヘッダ)** に差し替え、
 * **SF2 (GeneralUser GS) をネイティブ再生**する。NP2kai コアの VERMOUTH(sound/vermouth 配下)は
 * ビルドから外し、cmmidi.c が呼ぶ小さな API (midimod_ 群 / midiout_ 群) だけをここで TSF 上に再実装する。
 *
 * 継ぎ目: cmmidi.c が MIDI バイトを解析して midiout_shortmsg/longmsg を呼び、ストリーム callback が
 * midiout_get で PCM を引く構造はそのまま。型 MIDIMOD/MIDIHDL は vermouth.h の薄い公開型を使い、
 * 実体は本ファイルの QBMOD/QBHDL (先頭フィールドを samprate/worksize に合わせてレイアウト互換)。
 *
 * GS のパート別エフェクトは TSF が内部ミックスのため不可。代わりに **全体リバーブ (Freeverb)** を
 * 出力に一律適用する (midiout_fx_setenable で on/off)。コーラス/ディレイは一旦非対応。
 */

#include <compiler.h>
#include <pccore.h>
#include "sound/vermouth/vermouth.h"

/* TinySoundFont 本体をこの TU に展開 (MIT, native/third_party/tsf.h) */
#define TSF_IMPLEMENTATION
#include "third_party/tsf.h"

/* SF2 のパス (CWD = np2kai_set_data_dir で設定したディレクトリ。bridge が soundfont.sf2 を配置)。 */
#define QB_SF2_FILENAME		"soundfont.sf2"

/* float 出力 (±1 付近) → NP2kai ストリーム SINT32 への変換ゲイン (VERMOUTH 時代の音量に合わせて実測)。 */
#define QB_OUT_SCALE		8000.0f		/* float(±1付近)→SINT32。soft-clip の KNEE(24576) 以下に収め、
										 * 密度の高い曲(同時発音多)+FM SFX でも飽和しないよう headroom を取る。
										 * 11000→7000→8000 (リバーブ共鳴を別途抑えた分、少し戻して FM との音量差を縮小)。tunable */
#define QB_MAXBLOCK			4096		/* midiout_get 1 回で処理する最大フレーム数 */

/* ---- 全体リバーブ (Freeverb, stereo) ---- */
#define FX_NUMCOMBS		8
#define FX_NUMALLPASS	4
#define FX_STEREOSPREAD	23
#define FX_REV_WET		0.40f		/* wet 加算量。全体(ドラム/ベース含む)に一律掛かるので per-part より控えめに。tunable */
#define FX_REV_INGAIN	0.025f		/* comb 入力ゲイン */
#define FX_REV_HPF		0.05f		/* リバーブ入力の 1-pole HPF 係数 (~400Hz)。**低音をリバーブに入れない**ことで、
										 * 低域の「ぼわんぼわん」ブーミー共鳴 / 重いビビり(低域がリバーブで溜まり共鳴+飽和)を
										 * 根本的に抑える (リバーブの定番設計)。ドライの低音はそのまま。値↑で低域カットを強める */

static const int fx_combtune[FX_NUMCOMBS] =
				{ 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 };
static const int fx_allpasstune[FX_NUMALLPASS] =
				{ 556, 441, 341, 225 };

typedef struct { float *buf; int size; int idx; float store; } FXCOMB;
typedef struct { float *buf; int size; int idx; } FXALLPASS;

typedef struct {
	UINT	samprate;		/* MIDIMOD 公開ビューの先頭に一致させる */
	tsf		*sf;			/* マスター soundfont (SF2) */
} QBMOD;

/* ステートセーブ用の「控え」(フェーズ 2)。合成器 (TSF) の内部は保存せず、チャンネルごとに TSF が実際に
 * 反映する設定の最後の値だけを控える: バンク (CC0/32)・音色・音量 (CC7/39)・エクスプレッション (CC11/43)・
 * パン (CC10/42)・サステイン (CC64)・RPN 0〜2 (ピッチベンド幅・微調整・粗調整) のデータ・RPN の選択・
 * ピッチベンド。ロード後に全音停止 + コントロール初期化を送ってから控えを送り直す (qb_midi_state_load)。
 * データエントリ (CC6/38) は直前の RPN 選択で意味が変わるので生の CC は再生せず、RPN ごとに控える。 */
#define QB_SH_NCC 9
static const UINT8 k_sh_cc[QB_SH_NCC] = { 0, 32, 7, 39, 11, 43, 10, 42, 64 };
typedef struct {
	UINT8	cc[QB_SH_NCC];		/* k_sh_cc の順 */
	UINT16	cc_set;				/* bit i = cc[i] を受けた */
	UINT8	prog, prog_set;
	UINT16	rpn;				/* 現在の RPN 選択 (CC101<<7 | CC100)。rpn_valid=0 なら選択なし (TSF の 0xFFFF) */
	UINT8	rpn_valid;
	UINT16	rpn_data[3];		/* RPN 0/1/2 のデータ (14bit、MSB<<7|LSB) */
	UINT8	rpn_data_set;		/* bit n = RPN n のデータを受けた */
	UINT16	bend;
	UINT8	bend_set;
} QB_MIDI_SHADOW;

typedef struct QBHDL_ {
	UINT	samprate;		/* MIDIHDL 公開ビュー (samprate, worksize) に一致 */
	UINT	worksize;
	tsf		*synth;			/* tsf_copy。ボイス状態は独立、サンプルデータは共有 */
	SINT32	*out;			/* SINT32 stereo 出力 (QB_MAXBLOCK*2) */
	float	*fbuf;			/* TSF float レンダ + リバーブ作業用 (QB_MAXBLOCK*2) */
	/* reverb */
	float		*fpool;
	FXCOMB		combL[FX_NUMCOMBS], combR[FX_NUMCOMBS];
	FXALLPASS	apL[FX_NUMALLPASS], apR[FX_NUMALLPASS];
	float		comb_fb, damp1, damp2;
	float		fx_inlp;		/* リバーブ入力 pre-LPF の 1-pole 状態 */
	QB_MIDI_SHADOW	sh[16];		/* ステートセーブ用の控え (上) */
	int				role;		/* 役割 (QB_MIDI_ROLE_*)。控えをハンドルと対応づける鍵 */
	struct QBHDL_	*zombie;	/* 破棄済みで解放待ちの連結 (下の s_zombies) */
} QBHDL;

/* ハンドルの役割。qb_commng.c が cmmidi_create の直前に qb_midi_create_role へ入れ、midiout_create が
 * 受け取る。statsave のロードは COM 区画で MPU とシリアルの通信を作り直す (= ハンドルも作り直して並び順が
 * 変わる) ので、控えは作成順ではなく役割で対応づける (東方 TH02 の MIDI で順番が入れ替わって判明)。 */
#define QB_MIDI_ROLE_UNKNOWN	0
#define QB_MIDI_ROLE_MPU		1
#define QB_MIDI_ROLE_SERIAL		2
int qb_midi_create_role = QB_MIDI_ROLE_UNKNOWN;
static void shadow_replay(QBHDL *h, int ch, const QB_MIDI_SHADOW *c);
/* ロード時にまだ無かった役割のハンドルへの控え (RS-MIDI のシリアルは最初に使われたときに作られる)。
 * その役割のハンドルができたら送り直す。リセットで捨てる (qb_midi_state_forget) */
static QB_MIDI_SHADOW s_pending[3][16];
static int s_pending_set[3];

/* 生きているハンドルを作成順に持つ (ステートセーブの控えをハンドルと対応づけるため)。 */
#define QB_MAX_HDLS 8
static QBHDL *s_hdls[QB_MAX_HDLS];
static int    s_nhdls;

/* 破棄済みで解放を待つハンドル。cmmidi は作るときに音声ストリーム (sound.c の cbreg) へ
 * vermouth_getpcm(hdl) を登録するが、登録を外す API は無く、全消去 (streamreset) まで残る。statsave の
 * ロードは sound_reset の後で「mpu98ii_reset が作る → COM 区画が破棄して作り直す」を行うので、破棄した
 * ハンドルが次の sound_reset まで登録されたまま = 解放すると use-after-free (ASan で確認。ヒープを壊し、
 * MIDI を後から有効にしたセッションへのロードで malloc が止まった)。そこで破棄では synth 等だけ捨てて
 * 本体を残し、midiout_get は NULL を返す。本体は streamreset の直前に呼ばれる soundmng_reset で解放する
 * (qb_midi_reap)。 */
static QBHDL *s_zombies;

static int s_fx_enable = 1;		/* 全 hdl 共通リバーブ on/off (midiout_fx_setenable) */

static int fx_scale(int n, UINT sr) { return((int)(((SINT64)n * (SINT64)sr) / 44100)); }

static float fx_comb_run(FXCOMB *c, float in, float fb, float d1, float d2) {
	float out = c->buf[c->idx];
	c->store = out * d2 + c->store * d1;
	c->buf[c->idx] = in + c->store * fb;
	if (++c->idx >= c->size) c->idx = 0;
	return out;
}
static float fx_allpass_run(FXALLPASS *a, float in) {
	float bufout = a->buf[a->idx];
	float out = bufout - in;
	a->buf[a->idx] = in + bufout * 0.5f;
	if (++a->idx >= a->size) a->idx = 0;
	return out;
}

/* QBHDL のリバーブバッファ確保 + 係数設定。失敗時 fpool=NULL (リバーブ無効でドライ動作)。 */
static void fx_alloc(QBHDL *h) {
	int i, total = 0;
	int sc[FX_NUMCOMBS], scr[FX_NUMCOMBS], sa[FX_NUMALLPASS], sar[FX_NUMALLPASS];
	float *fp;
	float room = 0.70f, damp = 0.30f;	/* 入力 HPF で低域ブームを断つ前提で、残響の豪華さは戻す (長め・やや明るめ) */

	for (i = 0; i < FX_NUMCOMBS; i++) {
		sc[i]  = fx_scale(fx_combtune[i], h->samprate);
		scr[i] = fx_scale(fx_combtune[i] + FX_STEREOSPREAD, h->samprate);
		total += sc[i] + scr[i];
	}
	for (i = 0; i < FX_NUMALLPASS; i++) {
		sa[i]  = fx_scale(fx_allpasstune[i], h->samprate);
		sar[i] = fx_scale(fx_allpasstune[i] + FX_STEREOSPREAD, h->samprate);
		total += sa[i] + sar[i];
	}
	h->fpool = (float *)_MALLOC(sizeof(float) * total, "tsfreverb");
	if (h->fpool == NULL) return;
	ZeroMemory(h->fpool, sizeof(float) * total);
	fp = h->fpool;
	for (i = 0; i < FX_NUMCOMBS; i++) {
		h->combL[i].buf = fp; h->combL[i].size = sc[i];  fp += sc[i];
		h->combR[i].buf = fp; h->combR[i].size = scr[i]; fp += scr[i];
	}
	for (i = 0; i < FX_NUMALLPASS; i++) {
		h->apL[i].buf = fp; h->apL[i].size = sa[i];  fp += sa[i];
		h->apR[i].buf = fp; h->apR[i].size = sar[i]; fp += sar[i];
	}
	h->comb_fb = room * 0.28f + 0.7f;
	h->damp1 = damp * 0.4f;
	h->damp2 = 1.0f - h->damp1;
}

/* fbuf (interleaved stereo float, n フレーム) に全体リバーブを wet 加算する。 */
static void fx_apply(QBHDL *h, float *fbuf, UINT n) {
	UINT i, j;
	if (!h->fpool) return;
	for (i = 0; i < n; i++) {
		float in = (fbuf[i*2] + fbuf[i*2+1]) * FX_REV_INGAIN;
		float oL = 0.0f, oR = 0.0f;
		/* 入力 pre-HPF: 低音を comb に入れない (低域ブーミー共鳴 =「ぼわんぼわん」/重いビビり対策)。
		 * fx_inlp は低域を追従する LPF 状態、in - fx_inlp で高域通過にする。 */
		h->fx_inlp += FX_REV_HPF * (in - h->fx_inlp);
		in = in - h->fx_inlp;
		for (j = 0; j < FX_NUMCOMBS; j++) {
			oL += fx_comb_run(&h->combL[j], in, h->comb_fb, h->damp1, h->damp2);
			oR += fx_comb_run(&h->combR[j], in, h->comb_fb, h->damp1, h->damp2);
		}
		for (j = 0; j < FX_NUMALLPASS; j++) {
			oL = fx_allpass_run(&h->apL[j], oL);
			oR = fx_allpass_run(&h->apR[j], oR);
		}
		fbuf[i*2]   += oL * FX_REV_WET;
		fbuf[i*2+1] += oR * FX_REV_WET;
	}
}

/* ---- VERMOUTH 互換 API (cmmidi.c / qb_vermouth.c が呼ぶ最小サーフェス) ---- */

MIDIMOD VEXPORT midimod_create(UINT samprate) {
	QBMOD *m = (QBMOD *)_MALLOC(sizeof(QBMOD), "qbmod");
	if (m == NULL) return NULL;
	m->samprate = samprate ? samprate : 44100;
	m->sf = tsf_load_filename(QB_SF2_FILENAME);	/* CWD = data dir */
	if (m->sf == NULL) { _MFREE(m); return NULL; }
	return (MIDIMOD)(void *)m;
}

void VEXPORT midimod_destroy(MIDIMOD mod) {
	QBMOD *m = (QBMOD *)(void *)mod;
	if (m) {
		if (m->sf) tsf_close(m->sf);
		_MFREE(m);
	}
}

void VEXPORT midimod_loadall(MIDIMOD mod) { (void)mod; }	/* TSF は create で全ロード済 */

MIDIHDL VEXPORT midiout_create(MIDIMOD mod, UINT worksize) {
	QBMOD *m = (QBMOD *)(void *)mod;
	QBHDL *h;
	(void)worksize;
	if (m == NULL || m->sf == NULL) return NULL;
	h = (QBHDL *)_MALLOC(sizeof(QBHDL), "qbhdl");
	if (h == NULL) return NULL;
	ZeroMemory(h, sizeof(QBHDL));
	h->samprate = m->samprate;
	h->worksize = QB_MAXBLOCK;
	h->synth = tsf_copy(m->sf);		/* 独立ボイス状態・サンプル共有 */
	if (h->synth == NULL) { _MFREE(h); return NULL; }
	tsf_set_output(h->synth, TSF_STEREO_INTERLEAVED, (int)m->samprate, 0.0f);
	tsf_channel_set_presetnumber(h->synth, 9, 0, 1);	/* ch10 = ドラム (GM percussion bank) */
	h->out  = (SINT32 *)_MALLOC(sizeof(SINT32) * QB_MAXBLOCK * 2, "qbhdlout");
	h->fbuf = (float  *)_MALLOC(sizeof(float)  * QB_MAXBLOCK * 2, "qbhdlf");
	if (h->out == NULL || h->fbuf == NULL) {
		if (h->out) _MFREE(h->out);
		if (h->fbuf) _MFREE(h->fbuf);
		tsf_close(h->synth); _MFREE(h);
		return NULL;
	}
	fx_alloc(h);
	h->role = qb_midi_create_role;
	qb_midi_create_role = QB_MIDI_ROLE_UNKNOWN;
	if (s_nhdls < QB_MAX_HDLS) s_hdls[s_nhdls++] = h;
	if (h->role > 0 && h->role < 3 && s_pending_set[h->role]) {	/* ロード時に無かった役割 → 今送り直す */
		int ch;
		for (ch = 0; ch < 16; ch++) shadow_replay(h, ch, &s_pending[h->role][ch]);
		s_pending_set[h->role] = 0;
	}
	return (MIDIHDL)(void *)h;
}

void VEXPORT midiout_destroy(MIDIHDL hdl) {
	QBHDL *h = (QBHDL *)(void *)hdl;
	if (h) {
		int i, j;
		for (i = 0; i < s_nhdls; i++) {
			if (s_hdls[i] != h) continue;
			for (j = i + 1; j < s_nhdls; j++) s_hdls[j - 1] = s_hdls[j];
			s_nhdls--;
			break;
		}
		if (h->synth) tsf_close(h->synth);
		if (h->out)   _MFREE(h->out);
		if (h->fbuf)  _MFREE(h->fbuf);
		if (h->fpool) _MFREE(h->fpool);
		h->synth = NULL; h->out = NULL; h->fbuf = NULL; h->fpool = NULL;
		h->zombie = s_zombies;			/* 本体は音声ストリームの登録が消えるまで残す (上) */
		s_zombies = h;
	}
}

/* 解放待ちのハンドルを解放する。soundmng_reset (直後に sound.c が登録を全消去する) から呼ぶ */
void qb_midi_reap(void) {
	while (s_zombies) {
		QBHDL *h = s_zombies;
		s_zombies = h->zombie;
		_MFREE(h);
	}
}

static void shadow_note(QB_MIDI_SHADOW *c, UINT8 kind, UINT8 d1, UINT8 d2) {
	int i;
	if (kind == 0xc0) { c->prog = d1; c->prog_set = 1; return; }
	if (kind == 0xe0) { c->bend = (UINT16)(d1 | (d2 << 7)); c->bend_set = 1; return; }
	if (kind != 0xb0) return;
	for (i = 0; i < QB_SH_NCC; i++) {
		if (k_sh_cc[i] == d1) { c->cc[i] = d2; c->cc_set |= (UINT16)(1u << i); return; }
	}
	switch (d1) {
		/* RPN の選択は TSF と同じ意味論 (片方ずつ書き換え、NRPN と CC121 で選択なし) */
		case 101: c->rpn = (UINT16)(((c->rpn_valid ? c->rpn : 0) & 0x7f) | (d2 << 7)); c->rpn_valid = 1; break;
		case 100: c->rpn = (UINT16)(((c->rpn_valid ? c->rpn : 0) & 0x3f80) | d2);      c->rpn_valid = 1; break;
		case 98: case 99: c->rpn_valid = 0; break;
		case 6: case 38: {
			int rpn = c->rpn_valid ? (int)c->rpn : -1;
			if (rpn >= 0 && rpn <= 2) {
				c->rpn_data[rpn] = (d1 == 6) ? (UINT16)((c->rpn_data[rpn] & 0x7f) | (d2 << 7))
				                             : (UINT16)((c->rpn_data[rpn] & 0x3f80) | d2);
				c->rpn_data_set |= (UINT8)(1u << rpn);
			}
			break;
		}
		case 121: {		/* reset all controllers: TSF と同じく音量等・RPN を初期値へ (音色とバンクは TSF もそのまま) */
			UINT8 prog = c->prog, prog_set = c->prog_set;
			ZeroMemory(c, sizeof(*c));
			c->prog = prog; c->prog_set = prog_set;
			break;
		}
	}
}

void VEXPORT midiout_shortmsg(MIDIHDL hdl, UINT32 msg) {
	QBHDL *h = (QBHDL *)(void *)hdl;
	UINT8 status, d1, d2;
	int ch;
	if (h == NULL) return;
	status = (UINT8)(msg & 0xff);
	d1 = (UINT8)((msg >> 8) & 0x7f);
	d2 = (UINT8)((msg >> 16) & 0x7f);
	ch = status & 0x0f;
	shadow_note(&h->sh[ch], status & 0xf0, d1, d2);
	switch (status & 0xf0) {
		case 0x80:	/* note off */
			tsf_channel_note_off(h->synth, ch, d1);
			break;
		case 0x90:	/* note on (vel 0 = off) */
			if (d2) tsf_channel_note_on(h->synth, ch, d1, (float)d2 / 127.0f);
			else    tsf_channel_note_off(h->synth, ch, d1);
			break;
		case 0xb0:	/* control change (bank select/volume/pan/expression/sustain 等は TSF 内で処理) */
			tsf_channel_midi_control(h->synth, ch, d1, d2);
			break;
		case 0xc0:	/* program change (ch9 はドラム) */
			tsf_channel_set_presetnumber(h->synth, ch, d1, (ch == 9));
			break;
		case 0xe0:	/* pitch bend (14bit) */
			tsf_channel_set_pitchwheel(h->synth, ch, d1 | (d2 << 7));
			break;
		default:	/* 0xa0 poly AT / 0xd0 ch AT は非対応 (実害小) */
			break;
	}
}

void VEXPORT midiout_longmsg(MIDIHDL hdl, const void *msg, UINT size) {
	QBHDL *h = (QBHDL *)(void *)hdl;
	const UINT8 *p = (const UINT8 *)msg;
	if (h == NULL || p == NULL || size < 4) return;
	/* GM System On (F0 7E .. 09 01) / GS Reset (F0 41 .. 42 12 40 00 7F 00) を検出してリセット。 */
	if ((p[1] == 0x7e && size >= 5 && p[3] == 0x09) ||
	    (p[1] == 0x41 && size >= 10 && p[4] == 0x12 && p[5] == 0x40 && p[6] == 0x00 && p[7] == 0x7f)) {
		tsf_reset(h->synth);
		tsf_channel_set_presetnumber(h->synth, 9, 0, 1);	/* ドラム ch を再設定 */
		ZeroMemory(h->sh, sizeof(h->sh));					/* 控えも初期状態へ */
	}
}

const SINT32 * VEXPORT midiout_get(MIDIHDL hdl, UINT *samples) {
	QBHDL *h = (QBHDL *)(void *)hdl;
	UINT n, i, k;
	if (h == NULL || samples == NULL || h->synth == NULL) return NULL;	/* 破棄済み (解放待ち) */
	n = *samples;
	if (n == 0) return NULL;
	if (n > QB_MAXBLOCK) n = QB_MAXBLOCK;
	tsf_render_float(h->synth, h->fbuf, (int)n, 0);		/* overwrite */
	if (s_fx_enable) fx_apply(h, h->fbuf, n);
	k = n * 2;
	for (i = 0; i < k; i++) {
		float v = h->fbuf[i] * QB_OUT_SCALE;
		if (v > 8388607.0f) v = 8388607.0f;			/* SINT24 程度でクランプ (上位で soft-clip) */
		else if (v < -8388608.0f) v = -8388608.0f;
		h->out[i] = (SINT32)v;
	}
	*samples = n;
	return h->out;
}

/* GS effects (= 全体リバーブ) の on/off。bridge の np2kai_debug_midi_fx → qbDebug.midifx。 */
void VEXPORT midiout_fx_setenable(int enable) { s_fx_enable = enable ? 1 : 0; }

/* ---- ステートセーブ (フェーズ 2): 区画 "MIDI" -----------------------------------------------
 * 生きているハンドルごとの役割と控え (QB_MIDI_SHADOW x 16)。ロードでは**同じ役割の**ハンドルへ、全音停止
 * (CC120) + コントロール初期化 (CC121) の後に控えを送り直す。役割が分からないハンドルは同じ順番のものへ。
 * statsave のロードで通信まわりが作り直されて合成器が新品になるので、NP2kai 区画より後に読むこと。 */
#include "qb_state.h"
#define MIDI_STATE_VER 2u

int qb_midi_state_save(qb_sw *w) {
	int i;
	size_t mark = qb_sw_begin(w, "MIDI", MIDI_STATE_VER);
	qb_sw_u32(w, (uint32_t)s_nhdls);
	for (i = 0; i < s_nhdls; i++) {
		qb_sw_u32(w, (uint32_t)s_hdls[i]->role);
		qb_sw_var(w, s_hdls[i]->sh);
	}
	qb_sw_end(w, mark);
	return 0;
}

static QBHDL *find_hdl(uint32_t role, uint32_t index) {
	int i;
	if (role != QB_MIDI_ROLE_UNKNOWN) {
		for (i = 0; i < s_nhdls; i++) if ((uint32_t)s_hdls[i]->role == role) return s_hdls[i];
		return NULL;
	}
	return ((int)index < s_nhdls) ? s_hdls[index] : NULL;
}

static void shadow_replay(QBHDL *h, int ch, const QB_MIDI_SHADOW *c) {
	int i, n;
	tsf *f = h->synth;
	tsf_channel_midi_control(f, ch, 120, 0);		/* all sound off (即時) */
	tsf_channel_midi_control(f, ch, 121, 0);		/* reset all controllers */
	for (i = 0; i < QB_SH_NCC; i++) {
		if (c->cc_set & (1u << i)) tsf_channel_midi_control(f, ch, k_sh_cc[i], c->cc[i]);
	}
	if (c->prog_set) tsf_channel_set_presetnumber(f, ch, c->prog, (ch == 9));
	else if (ch == 9) tsf_channel_set_presetnumber(f, 9, 0, 1);
	for (n = 0; n < 3; n++) {
		if (!(c->rpn_data_set & (1u << n))) continue;
		tsf_channel_midi_control(f, ch, 101, 0);
		tsf_channel_midi_control(f, ch, 100, n);
		tsf_channel_midi_control(f, ch, 6, (c->rpn_data[n] >> 7) & 0x7f);
		tsf_channel_midi_control(f, ch, 38, c->rpn_data[n] & 0x7f);
	}
	if (c->rpn_valid) {								/* RPN の選択をセーブ時点へ */
		tsf_channel_midi_control(f, ch, 101, (c->rpn >> 7) & 0x7f);
		tsf_channel_midi_control(f, ch, 100, c->rpn & 0x7f);
	} else {
		tsf_channel_midi_control(f, ch, 99, 0);		/* 選択なし (TSF は NRPN で 0xFFFF) */
	}
	if (c->bend_set) tsf_channel_set_pitchwheel(f, ch, c->bend);
	h->sh[ch] = *c;
}

void qb_midi_state_forget(void) { s_pending_set[1] = s_pending_set[2] = 0; }

int qb_midi_state_load(const uint8_t *blob, size_t n) {
	qb_sr r; uint32_t ver, nh, i;
	int ch;
	qb_midi_state_forget();
	if (!qb_sr_section(blob, n, "MIDI", &r, &ver)) return -60;
	if (ver != MIDI_STATE_VER) return -61;
	nh = qb_sr_u32(&r);
	for (i = 0; i < nh && !r.err; i++) {
		QB_MIDI_SHADOW sh[16];
		QBHDL *h;
		uint32_t role = qb_sr_u32(&r);
		qb_sr_var(&r, sh);
		if (r.err) break;
		h = find_hdl(role, i);
		if (h == NULL) {							/* まだ無い: 役割が分かればできたときに送り直す */
			if (role > 0 && role < 3) { memcpy(s_pending[role], sh, sizeof(sh)); s_pending_set[role] = 1; }
			continue;
		}
		for (ch = 0; ch < 16; ch++) shadow_replay(h, ch, &sh[ch]);
	}
	return r.err ? -62 : 0;
}

/* テスト用の読み出し口 (bridge.c の np2kai_debug_midi_ch)。hdl 番目のハンドルの ch の TSF 上の値。
 * what: 0=音色番号 1=バンク 2=音量x1000 3=パンx1000 4=ベンド幅x100 5=ピッチベンド / -1=ハンドル数 / -2=役割 */
int qb_midi_debug_ch(int hdl, int ch, int what) {
	tsf *f;
	if (what == -1) return s_nhdls;
	if (what == -2) return (hdl >= 0 && hdl < s_nhdls) ? s_hdls[hdl]->role : -1;
	if (hdl < 0 || hdl >= s_nhdls || ch < 0 || ch > 15) return -1;
	f = s_hdls[hdl]->synth;
	switch (what) {
		case 0: return tsf_channel_get_preset_number(f, ch);
		case 1: return tsf_channel_get_preset_bank(f, ch);
		case 2: return (int)(tsf_channel_get_volume(f, ch) * 1000.0f + 0.5f);
		case 3: {	/* tsf_channel_get_pan は確保済みのチャンネルで panOffset - 0.5 を返す (正しくは + 0.5。
					 * 未確保なら 0.5) ので、確保の有無で値が食い違わないようここで求める */
			float pan = (f->channels && ch < f->channels->channelNum) ? f->channels->channels[ch].panOffset + 0.5f : 0.5f;
			return (int)(pan * 1000.0f + 0.5f);
		}
		case 4: return (int)(tsf_channel_get_pitchrange(f, ch) * 100.0f + 0.5f);
		case 5: return tsf_channel_get_pitchwheel(f, ch);
	}
	return -1;
}
