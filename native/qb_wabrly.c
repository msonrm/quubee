#include <compiler.h>

/* wabrly_initialize is called unconditionally from pccore_reset().
   wab/wab_rly.c is excluded (no SUPPORT_WAB), so provide a no-op stub. */
void wabrly_initialize(void) {}
