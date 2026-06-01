#include <compiler.h>
#include <stdlib.h>
#include <string.h>
#include <scrnmng.h>
#include <vram/scrndraw.h>
#include <vram/palettes.h>

#ifdef __ANDROID__
#include <android/log.h>
#define LOGD(fmt, ...) __android_log_print(ANDROID_LOG_DEBUG, "NP2KAI", fmt, ##__VA_ARGS__)
#else
#define LOGD(fmt, ...)
#endif

SCRNMNG scrnmng;

static SCRNSURF scrnsurf;

void scrnmng_initialize(void) {
	memset(&scrnmng, 0, sizeof(scrnmng));
	scrnmng.width  = 640;
	scrnmng.height = 400;
	scrnmng.bpp    = 16;
}

void scrnmng_getsize(int *pw, int *ph) {
	*pw = scrnmng.width;
	*ph = scrnmng.height;
}

BRESULT scrnmng_create(UINT8 mode) {
	size_t sz = (size_t)scrnmng.width * scrnmng.height * (scrnmng.bpp / 8);
	scrnmng.pc98surf = calloc(1, sz);
	scrnmng.dispsurf = calloc(1, sz);
	if (!scrnmng.pc98surf || !scrnmng.dispsurf) {
		free(scrnmng.pc98surf);
		free(scrnmng.dispsurf);
		scrnmng.pc98surf = NULL;
		scrnmng.dispsurf = NULL;
		return FAILURE;
	}
	scrnmng.flag = SCRNFLAG_ENABLE;
	scrnmng.enable = TRUE;
	return SUCCESS;
}

void scrnmng_destroy(void) {
	free(scrnmng.pc98surf);
	free(scrnmng.dispsurf);
	scrnmng.pc98surf = NULL;
	scrnmng.dispsurf = NULL;
	scrnmng.enable   = FALSE;
}

const SCRNSURF *scrnmng_surflock(void) {
	if (!scrnmng.enable || !scrnmng.pc98surf)
		return NULL;
	scrnsurf.ptr    = (UINT8 *)scrnmng.pc98surf;
	scrnsurf.width  = scrnmng.width;
	scrnsurf.height = scrnmng.height;
	scrnsurf.bpp    = scrnmng.bpp;
	scrnsurf.xalign = scrnmng.bpp / 8;
	scrnsurf.yalign = scrnsurf.width * scrnsurf.xalign;
	scrnsurf.extend = 0;
	return &scrnsurf;
}

void scrnmng_surfunlock(const SCRNSURF *surf) {
	if (!scrnmng.pc98surf || !scrnmng.dispsurf)
		return;
	size_t sz = (size_t)scrnmng.width * scrnmng.height * (scrnmng.bpp / 8);
	memcpy(scrnmng.dispsurf, scrnmng.pc98surf, sz);
}

void scrnmng_update(void) {}

static void realloc_surfs(void) {
	size_t sz = (size_t)scrnmng.width * scrnmng.height * (scrnmng.bpp / 8);
	free(scrnmng.pc98surf);
	free(scrnmng.dispsurf);
	scrnmng.pc98surf = calloc(1, sz);
	scrnmng.dispsurf = calloc(1, sz);
	if (!scrnmng.pc98surf || !scrnmng.dispsurf) {
		free(scrnmng.pc98surf);
		free(scrnmng.dispsurf);
		scrnmng.pc98surf = NULL;
		scrnmng.dispsurf = NULL;
		scrnmng.enable   = FALSE;
	}
}

void scrnmng_setwidth(int posx, int width) {
	LOGD("scrnmng_setwidth: posx=%d width=%d (was %d)", posx, width, scrnmng.width);
	if (width > 0 && width != scrnmng.width) {
		scrnmng.width = width;
		realloc_surfs();
	}
}

void scrnmng_setheight(int posy, int height) {
	LOGD("scrnmng_setheight: posy=%d height=%d (was %d)", posy, height, scrnmng.height);
	if (height > 0 && height != scrnmng.height) {
		scrnmng.height = height;
		realloc_surfs();
	}
}

RGB16 scrnmng_makepal16(RGB32 pal32) {
	RGB16 r = (pal32.p.r >> 3) & 0x1f;
	RGB16 g = (pal32.p.g >> 2) & 0x3f;
	RGB16 b = (pal32.p.b >> 3) & 0x1f;
	return (RGB16)((r << 11) | (g << 5) | b);
}

/* stubs for menu/OSD */
BRESULT scrnmng_entermenu(SCRNMENU *smenu) { return FAILURE; }
void scrnmng_leavemenu(void) {}
void scrnmng_menudraw(const RECT_T *rct) {}
void scrnmng_updatecursor(void) {}
