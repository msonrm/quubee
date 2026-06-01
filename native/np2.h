#pragma once

#include <compiler.h>
#include <commng.h>

typedef struct {
	UINT8  NOWAIT;
	UINT8  DRAW_SKIP;
	UINT8  KEYBOARD;
	UINT8  resume;
	UINT8  jastsnd;
	UINT8  I286SAVE;
	UINT8  xrollkey;
	UINT8  snddrv;
	char   MIDIDEV[2][MAX_PATH];
	UINT32 MIDIWAIT;
	UINT8  readonly;
} NP2OSCFG;

enum {
	FULLSCREEN_WIDTH  = 640,
	FULLSCREEN_HEIGHT = 480,
};

extern NP2OSCFG np2oscfg;
extern char draw32bit;
extern UINT8 scrnmode;
extern int mmxflag;

enum {
	MMXFLAG_DISABLE    = 1,
	MMXFLAG_NOTSUPPORT = 2
};

int havemmx(void);

typedef enum {
	IMAGETYPE_UNKNOWN = 0,
	IMAGETYPE_FDD,
	IMAGETYPE_SASI_IDE,
	IMAGETYPE_SASI_IDE_CD,
	IMAGETYPE_SCSI,
	IMAGETYPE_OTHER
} IMAGETYPE;

extern char hddfolder[MAX_PATH];
extern char fddfolder[MAX_PATH];
extern char bmpfilefolder[MAX_PATH];
extern unsigned int bmpfilenumber;
extern char modulefile[MAX_PATH];

void changescreen(UINT8 newmode);
int flagsave(const OEMCHAR *ext);
void flagdelete(const OEMCHAR *ext);
int flagload(const OEMCHAR *ext, const OEMCHAR *title, BOOL force);
