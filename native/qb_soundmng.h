#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/* bridge.c から呼ばれる。dst には max_frames ぶんのステレオ PCM (L,R 交互) を
 * SINT16 で書き出す。実際に書いたフレーム数を返す。0 ならまだ準備できていない。 */
unsigned int qb_audio_drain(short *dst, unsigned int max_frames);

/* sound_create に渡されたサンプリングレート (Hz) を返す */
unsigned int qb_audio_get_rate(void);

#ifdef __cplusplus
}
#endif
