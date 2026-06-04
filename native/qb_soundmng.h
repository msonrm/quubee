#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/* JS の ScriptProcessorNode.onaudioprocess (audio DAC クロック) から呼ばれる
 * 唯一の consumer。dst に frames ぶんのステレオ SINT16 (L,R 交互) を書き出す (C1)。
 * (旧 qb_audio_drain は pull 型移行で廃止) */
void qb_audio_fill(short *dst, unsigned int frames);

/* sound_create に渡されたサンプリングレート (Hz) を返す */
unsigned int qb_audio_get_rate(void);

/* ScriptProcessorNode に使うバッファ長 (= sndstream ブロック長, ステレオフレーム数) */
unsigned int qb_audio_get_bufsize(void);

#ifdef __cplusplus
}
#endif
