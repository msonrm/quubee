#ifndef COMPILER_H
#define COMPILER_H

#include <compiler_base.h>
#include <pthread.h>
#include <time.h>

/* millisecond tick counter using CLOCK_MONOTONIC (no SDL dependency) */
static inline unsigned int _qb_gettick(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (unsigned int)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
}
#define GETTICK() _qb_gettick()

#define msgbox(title, msg)
#define __ASSERT(s)

#define RESOURCE_US
#define NP2_SIZE_VGA

#include <common/milstr.h>
#include <trace.h>

#endif  /* COMPILER_H */
