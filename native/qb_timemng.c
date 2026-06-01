#include <compiler.h>
#include <time.h>
#include <sdl/timemng.h>

BRESULT timemng_gettime(_SYSTIME *systime) {
    struct tm *t;
    time_t now = time(NULL);
    t = localtime(&now);
    if (!t || !systime) return FAILURE;
    systime->year   = (UINT16)(t->tm_year + 1900);
    systime->month  = (UINT16)(t->tm_mon + 1);
    systime->week   = (UINT16)t->tm_wday;
    systime->day    = (UINT16)t->tm_mday;
    systime->hour   = (UINT16)t->tm_hour;
    systime->minute = (UINT16)t->tm_min;
    systime->second = (UINT16)t->tm_sec;
    systime->milli  = 0;
    return SUCCESS;
}
