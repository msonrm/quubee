#include <compiler.h>
#include <sdl/taskmng.h>

BOOL task_avail = TRUE;

void taskmng_initialize(void) {}
void taskmng_exit(void) { task_avail = FALSE; }
void taskmng_rol(void) {}
void taskmng_minimize(void) {}

BOOL taskmng_sleep(UINT32 tick) {
    return task_avail;
}
