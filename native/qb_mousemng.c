#include <compiler.h>
#include <mousemng.h>
#include <qb_mousemng.h>

/* マウス状態。
 * - x, y: 前回 getstat 以降の累積相対移動量
 * - btn:  uPD8255 ボタンビット。1=リリース、0=押下。
 *         上位 4bit のうち LEFT=0x80, RIGHT=0x20
 *         (sdl/mousemng.h の uPD8255A_LEFTBIT / RIGHTBIT 参照)
 */
#define BTN_LEFT  0x80
#define BTN_RIGHT 0x20
#define BTN_IDLE  (BTN_LEFT | BTN_RIGHT)

static struct {
	short x;
	short y;
	unsigned char btn;
} s_mouse;

void mousemng_initialize(void) {
	s_mouse.x = 0;
	s_mouse.y = 0;
	s_mouse.btn = BTN_IDLE;
}

void mousemng_reset(void) {
	s_mouse.x = 0;
	s_mouse.y = 0;
	s_mouse.btn = BTN_IDLE;
}

unsigned char mousemng_getstat(short *x, short *y, int clear) {
	if (x) *x = s_mouse.x;
	if (y) *y = s_mouse.y;
	if (clear) {
		s_mouse.x = 0;
		s_mouse.y = 0;
	}
	return s_mouse.btn;
}

/* mouseif がデバイス起動時に呼ぶ同期。今回はノーオプ */
void mousemng_sync(int mpx, int mpy) {
	(void)mpx; (void)mpy;
}

/* キャプチャ制御。Web 側で Pointer Lock を管理するので C 側はノーオプ */
void mousemng_enable(unsigned int proc)  { (void)proc; }
void mousemng_disable(unsigned int proc) { (void)proc; }
void mousemng_toggle(unsigned int proc)  { (void)proc; }
void mousemng_hidecursor(void)           {}
void mousemng_showcursor(void)           {}

/* --- ブリッジから呼ばれる内部 API --- */

void qb_mouse_post_move(int dx, int dy) {
	/* 蓄積を short にクランプ (mouseif 側で 1 タイミングあたり ±127 に丸められる) */
	long nx = (long)s_mouse.x + dx;
	long ny = (long)s_mouse.y + dy;
	if (nx >  32767) nx =  32767;
	if (nx < -32768) nx = -32768;
	if (ny >  32767) ny =  32767;
	if (ny < -32768) ny = -32768;
	s_mouse.x = (short)nx;
	s_mouse.y = (short)ny;
}

void qb_mouse_post_button(int button, int down) {
	unsigned char bit;
	switch (button) {
	case 0: bit = BTN_LEFT;  break;  /* 左 */
	case 1: bit = BTN_RIGHT; break;  /* 右 */
	default: return;                  /* 中ボタン等は無視 */
	}
	if (down) {
		s_mouse.btn &= (unsigned char)~bit;
	} else {
		s_mouse.btn |= bit;
	}
}
