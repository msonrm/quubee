#include <compiler.h>
#include <pccore.h>
#include <np2.h>

NP2OSCFG np2oscfg;
char     draw32bit  = 0;
UINT8    scrnmode   = 0;
int      mmxflag    = MMXFLAG_NOTSUPPORT;
char     hddfolder[MAX_PATH]    = "";
char     fddfolder[MAX_PATH]    = "";
char     bmpfilefolder[MAX_PATH]= "";
unsigned int bmpfilenumber      = 0;
char     modulefile[MAX_PATH]   = "";

int havemmx(void) { return 0; }

void initload(void)  { pccore_setdefault(); }
void initsave(void)  {}

void changescreen(UINT8 newmode) { scrnmode = newmode; }
int flagsave(const OEMCHAR *ext)                          { return 0; }
void flagdelete(const OEMCHAR *ext)                       {}
int flagload(const OEMCHAR *ext, const OEMCHAR *title, BOOL force) { return 0; }
