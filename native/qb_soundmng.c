/*
 * qb_soundmng.c — pull 型サウンド出力 (C1, 2026-06-04)
 *
 * 以前は「sound.c が CPU エミュ駆動で呼ぶ soundmng_sync が自前リングに push →
 * JS が rAF で drain → AudioWorklet が再生」というプッシュ型だった。これは
 * 生成レート (performance.now/rAF) と消費レート (audio DAC) が別クロックで必ず
 * ドリフトし、Worklet リングが周期的に溢れ (古サンプル破棄=プチ) / 枯れ (無音=途切れ)
 * していた。比較対象 irori/np2-wasm が綺麗なのは SDL のオーディオコールバックが
 * audio DAC クロックで sound_pcmlock を「引く」pull 型だから (マスタークロック1つ)。
 *
 * 本実装は同じ pull 型を、SDL に依存せず自前 glue で実現する:
 *   - JS の ScriptProcessorNode.onaudioprocess (audio DAC クロックで発火) が
 *     qb_audio_fill() を呼ぶ。これが sound_pcmlock()→soft-clip→sound_pcmunlock() を
 *     引く唯一の consumer。マスタークロックが audio DAC 1 つになりドリフトが消える。
 *   - sound.c (NP2kai) が CPU 駆動で呼ぶ soundmng_sync() は no-op 化する。
 *     sndstream の rendering は streamprepare が remain で上限管理し、remain は
 *     pcmunlock でのみ補充されるので、consumer が fill コールバックだけでも溢れない。
 *   - SDL_OpenAudio を使わない理由: -sUSE_SDL=2 が SDL2 ポートのネットワーク取得と
 *     書き込み可能 emscripten cache を要求し環境依存が増えるため。アーキは irori と同型。
 *
 * クリップは現行の soft-clip (qb_soft_clip) を据え置く。今回の変更を「デリバリ方式」
 * だけに限定し音色は変えないため (hard saturation との A/B は別途)。
 */
#include <compiler.h>
#include <soundmng.h>
#include <sound.h>
#include <qb_soundmng.h>
#include <string.h>

static UINT s_rate;
static UINT s_samples;   /* sndstream ブロック長 = ScriptProcessorNode バッファ長 */
static int  s_opened;

/* ソフトクリップ: ±KNEE までは線形、その外はなめらかに ±LIMIT へ漸近。
 * ハードクリップは角がストンと折れて高調波が乗り、特に低音で「ビリッ」と
 * いう歪みになる。ソフトクリップは角を丸めることでその高調波を抑える。 */
static SINT16 qb_soft_clip(SINT32 x) {
	const SINT32 LIMIT = 32767;
	const SINT32 KNEE  = 24576;          /* 0.75 × LIMIT */
	const SINT32 RANGE = LIMIT - KNEE;   /* 8191 */
	SINT32 sign = 1;
	if (x < 0) { x = -x; sign = -1; }
	if (x <= KNEE) return (SINT16)(sign * x);
	SINT32 over = x - KNEE;
	SINT32 extra = (SINT32)(((SINT64)RANGE * over) / (over + RANGE));
	SINT32 y = KNEE + extra;
	if (y > LIMIT) y = LIMIT;
	return (SINT16)(sign * y);
}

BRESULT soundmng_initialize(void) {
	s_opened  = 0;
	s_rate    = 0;
	s_samples = 0;
	return SUCCESS;
}

void soundmng_deinitialize(void) {
	s_opened = 0;
}

UINT soundmng_create(UINT rate, UINT ms) {
	UINT s, samples;
	if (s_opened) return 0;
	if (ms < 20) ms = 20;
	else if (ms > 1000) ms = 1000;

	/* ScriptProcessorNode のバッファ長 (= sndstream ブロック長)。SPN は 2 の冪・
	 * 256..16384 の制約があるのでその範囲に丸める。NSNDBUF=2 相当で rate*ms/2000。 */
	s = rate * ms / 1000 / 2;
	samples = 256;
	while (samples < s) samples <<= 1;
	if (samples > 16384) samples = 16384;

	s_rate    = rate;
	s_samples = samples;
	s_opened  = 1;
	return samples;
}

void soundmng_destroy(void) {
	s_opened = 0;
}

void soundmng_reset(void) {
	/* pull 型では sndstream 側が状態を持つので、ここで触ることは無い */
}

void soundmng_play(void) { }
void soundmng_stop(void) { }

/* sound.c が CPU エミュ駆動で呼ぶフック。pull 型では JS の fill コールバックが
 * 唯一の consumer なので、ここでは何もしない (二重 pcmlock = 二重消費を避ける)。
 * 生成 (streamprepare) は sound_sync が remain 上限内で逐次行い、fill 内の
 * sound_pcmlock が残りを top-up + lastclock リセットする。 */
void soundmng_sync(void) {
}

void soundmng_setreverse(BOOL r) { (void)r; }
BRESULT soundmng_pcmload(UINT n, const char *f) { (void)n; (void)f; return FAILURE; }
BRESULT soundmng_pcmplay(UINT n, BOOL loop)     { (void)n; (void)loop; return FAILURE; }
void soundmng_pcmstop(UINT n)                   { (void)n; }
void soundmng_pcmvolume(UINT n, int vol)        { (void)n; (void)vol; }

/* --- bridge から呼ばれる API --- */

/* JS の ScriptProcessorNode.onaudioprocess (audio DAC クロック) から呼ばれる唯一の
 * consumer。dst に frames ぶんのステレオ SINT16 (L,R 交互) を書く。 */
void qb_audio_fill(SINT16 *dst, UINT frames) {
	const SINT32 *src;
	if (!s_opened) {
		memset(dst, 0, (size_t)frames * 2 * sizeof(SINT16));
		return;
	}
	src = sound_pcmlock();
	if (src) {
		UINT n = (frames < s_samples) ? frames : s_samples;
		UINT i;
		for (i = 0; i < n * 2; i++) {
			dst[i] = qb_soft_clip(src[i]);
		}
		/* 念のため: frames > ブロック長 のときは残りを無音で埋める (通常 n==frames) */
		for (i = n * 2; i < frames * 2; i++) {
			dst[i] = 0;
		}
		sound_pcmunlock(src);
	} else {
		memset(dst, 0, (size_t)frames * 2 * sizeof(SINT16));
	}
}

UINT qb_audio_get_rate(void)    { return s_rate; }
UINT qb_audio_get_bufsize(void) { return s_samples; }
