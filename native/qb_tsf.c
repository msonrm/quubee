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

typedef struct {
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
} QBHDL;

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
	return (MIDIHDL)(void *)h;
}

void VEXPORT midiout_destroy(MIDIHDL hdl) {
	QBHDL *h = (QBHDL *)(void *)hdl;
	if (h) {
		if (h->synth) tsf_close(h->synth);
		if (h->out)   _MFREE(h->out);
		if (h->fbuf)  _MFREE(h->fbuf);
		if (h->fpool) _MFREE(h->fpool);
		_MFREE(h);
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
	}
}

const SINT32 * VEXPORT midiout_get(MIDIHDL hdl, UINT *samples) {
	QBHDL *h = (QBHDL *)(void *)hdl;
	UINT n, i, k;
	if (h == NULL || samples == NULL) return NULL;
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
