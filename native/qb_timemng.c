#include <compiler.h>
#include <time.h>
#include <sdl/timemng.h>

BRESULT timemng_gettime(_SYSTIME *systime) {
    struct tm *t;
    time_t now = time(NULL);
    t = localtime(&now);
    if (!t || !systime) return FAILURE;
    /* qb: Y2K 対策。これは PC-98 RTC (μPD4990A) の種になる host 時刻源。90 年代ゲームは年を
     * 2 桁前提で扱うため 20xx を渡すと固定幅セーブが壊れる (蟹味噌 KANI.SCR 等)。種の年を
     * 1999 に丸める (月日は host のまま=高得点の日付が概ね正しい)。読み出し点 date2bcd でも
     * 同じクランプをかけており、cal_vofs ドリフトで年が 20xx に飛んでも 2 桁が保たれる。
     * g_qb_y2k_clamp (bridge.c・既定 ON) で実行時オフ可 (qbDebug.y2k(0))。off なら本当の年を渡す。 */
    {
        extern int g_qb_y2k_clamp;
        int qb_y = t->tm_year + 1900;
        systime->year = (UINT16)((g_qb_y2k_clamp && qb_y >= 2000) ? 1999 : qb_y);
    }
    systime->month  = (UINT16)(t->tm_mon + 1);
    systime->week   = (UINT16)t->tm_wday;
    systime->day    = (UINT16)t->tm_mday;
    systime->hour   = (UINT16)t->tm_hour;
    systime->minute = (UINT16)t->tm_min;
    systime->second = (UINT16)t->tm_sec;
    systime->milli  = 0;
    return SUCCESS;
}
