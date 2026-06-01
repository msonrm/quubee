#pragma once

#ifdef __cplusplus
extern "C" {
#endif

void mousemng_initialize(void);
void mousemng_reset(void);
unsigned char mousemng_getstat(short *x, short *y, int clear);
void mousemng_sync(int mpx, int mpy);
void mousemng_enable(unsigned int proc);
void mousemng_disable(unsigned int proc);
void mousemng_toggle(unsigned int proc);
void mousemng_hidecursor(void);
void mousemng_showcursor(void);

#ifdef __cplusplus
}
#endif
