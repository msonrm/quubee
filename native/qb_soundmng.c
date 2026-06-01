#include <compiler.h>
#include <soundmng.h>
#include <sound.h>
#include <qb_soundmng.h>

/* PCM リングバッファ。
 * Producer: soundmng_sync (sound.c から呼ばれる、CPU エミュ駆動)
 * Consumer: qb_audio_drain (JS 側の AudioContext から)
 * Wasm はシングルスレッドなので両者は同じ JS イベントループ内で交互に動く。
 * 競合は起きないため atomic 不要。 */
#define RING_FRAMES 16384  /* ステレオフレーム数。48kHz で ~340ms */

static SINT16 s_ring[RING_FRAMES * 2];
static UINT   s_ring_w;   /* 書き込みインデックス (フレーム) */
static UINT   s_ring_r;   /* 読み出しインデックス (フレーム) */

static UINT   s_rate;
static UINT   s_samples;  /* sound.c が要求する 1 ブロックのフレーム数 */
static int    s_opened;
static int    s_playing;

BRESULT soundmng_initialize(void) {
	s_ring_w = s_ring_r = 0;
	s_opened = 0;
	s_playing = 0;
	return SUCCESS;
}

void soundmng_deinitialize(void) {
	s_opened = 0;
	s_playing = 0;
}

UINT soundmng_create(UINT rate, UINT ms) {
	UINT samples;
	if (s_opened) return 0;
	if (ms < 20) ms = 20;
	else if (ms > 1000) ms = 1000;
	/* SDL 実装と同じ式: rate * ms / 1000 / 2、2 の冪に丸める */
	samples = (rate * ms) / 1000 / 2;
	if (samples & (samples - 1)) {
		UINT s = 32;
		while (s < samples) s <<= 1;
		samples = s;
	}
	if (samples < 32) samples = 32;
	if (samples * 2 > RING_FRAMES) samples = RING_FRAMES / 2;
	s_rate    = rate;
	s_samples = samples;
	s_opened  = 1;
	s_ring_w  = s_ring_r = 0;
	return samples;
}

void soundmng_destroy(void) {
	s_opened = 0;
	s_playing = 0;
	s_ring_w = s_ring_r = 0;
}

void soundmng_reset(void) {
	s_ring_w = s_ring_r = 0;
}

void soundmng_play(void) { s_playing = 1; }
void soundmng_stop(void) { s_playing = 0; }

/* ソフトクリップ: ±KNEE までは線形、その外はなめらかに ±LIMIT へ漸近。
 * ハードクリップは角がストンと折れて高調波が乗り、特に低音で「ビリッ」と
 * いう歪みになる。ソフトクリップは角を丸めることでその高調波を抑える。
 *
 *   y = KNEE + RANGE * over / (over + RANGE)     (over = |x| - KNEE)
 *
 * over = 0 → 線形 (y=KNEE)、over → ∞ で y → LIMIT に漸近。
 * 線形領域 (|x| ≤ KNEE) は完全な pass-through なので、通常音量では
 * ビット完璧、ピーク時のみソフトに圧縮される。 */
static SINT16 qb_soft_clip(SINT32 x) {
	const SINT32 LIMIT = 32767;
	const SINT32 KNEE  = 24576;          /* 0.75 × LIMIT */
	const SINT32 RANGE = LIMIT - KNEE;   /* 8191 */
	SINT32 sign = 1;
	if (x < 0) { x = -x; sign = -1; }
	if (x <= KNEE) return (SINT16)(sign * x);
	SINT32 over = x - KNEE;
	/* 64-bit で計算 (over が極端な場合のオーバーフロー対策) */
	SINT32 extra = (SINT32)(((SINT64)RANGE * over) / (over + RANGE));
	SINT32 y = KNEE + extra;
	if (y > LIMIT) y = LIMIT;             /* 念のための上限 */
	return (SINT16)(sign * y);
}

void soundmng_sync(void) {
	if (!s_opened) return;
	const SINT32 *pcm = sound_pcmlock();
	if (pcm) {
		const UINT frames = s_samples;
		const UINT cap_minus_1 = RING_FRAMES - 1;
		UINT used = (s_ring_w - s_ring_r + RING_FRAMES) % RING_FRAMES;
		/* オーバーフロー時は古い側 (read 側) を捨てて新しい側を優先 */
		if (used + frames > cap_minus_1) {
			UINT drop = used + frames - cap_minus_1;
			s_ring_r = (s_ring_r + drop) % RING_FRAMES;
		}
		UINT w = s_ring_w;
		for (UINT i = 0; i < frames; i++) {
			UINT idx = (w + i) % RING_FRAMES;
			s_ring[idx*2 + 0] = qb_soft_clip(pcm[i*2 + 0]);
			s_ring[idx*2 + 1] = qb_soft_clip(pcm[i*2 + 1]);
		}
		s_ring_w = (w + frames) % RING_FRAMES;
	}
	sound_pcmunlock(pcm);
}

void soundmng_setreverse(BOOL r) { (void)r; }
BRESULT soundmng_pcmload(UINT n, const char *f) { (void)n; (void)f; return FAILURE; }
BRESULT soundmng_pcmplay(UINT n, BOOL loop)     { (void)n; (void)loop; return FAILURE; }
void soundmng_pcmstop(UINT n)                   { (void)n; }
void soundmng_pcmvolume(UINT n, int vol)        { (void)n; (void)vol; }

/* --- bridge から呼ばれる API --- */

UINT qb_audio_drain(SINT16 *dst, UINT max_frames) {
	if (!s_opened) return 0;
	UINT r = s_ring_r;
	UINT used = (s_ring_w - r + RING_FRAMES) % RING_FRAMES;
	UINT n = (used < max_frames) ? used : max_frames;
	for (UINT i = 0; i < n; i++) {
		UINT idx = (r + i) % RING_FRAMES;
		dst[i*2 + 0] = s_ring[idx*2 + 0];
		dst[i*2 + 1] = s_ring[idx*2 + 1];
	}
	s_ring_r = (r + n) % RING_FRAMES;
	return n;
}

UINT qb_audio_get_rate(void) { return s_rate; }
