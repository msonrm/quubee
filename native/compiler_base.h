/* QB platform-specific compiler_base.h — replaces NP2kai's version (no SDL/libretro guard) */

#ifndef _COMPILER_BASE_H_
#define _COMPILER_BASE_H_

/* Standard C headers */
#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>
#include <math.h>
#include <limits.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdint.h>
#include <inttypes.h>
#include <stdbool.h>

#define C99

/* XOPEN_SOURCE */
#ifndef _XOPEN_SOURCE
#define _XOPEN_SOURCE 600
#endif

/* NP2kai integer type aliases */
typedef int           INT;
typedef INT           SINT;
typedef unsigned int  UINT;
typedef int8_t        INT8;
typedef INT8          SINT8;
typedef uint8_t       UINT8;
typedef int16_t       INT16;
typedef INT16         SINT16;
typedef uint16_t      UINT16;
typedef int32_t       INT32;
typedef INT32         SINT32;
typedef uint32_t      UINT32;
typedef int64_t       INT64;
typedef INT64         SINT64;
typedef uint64_t      UINT64;

typedef size_t        SIZET;
typedef intptr_t      INTPTR;
typedef uintptr_t     UINTPTR;
typedef intptr_t      INT_PTR;
typedef uintptr_t     UINT_PTR;
typedef intmax_t      INTMAX;
typedef uintmax_t     UINTMAX;

/* bool */
typedef bool BOOL;
#ifndef TRUE
#define TRUE  (1==1)
#endif
#ifndef FALSE
#define FALSE (1==0)
#endif

/* INLINE */
#if !defined(INLINE)
#  if defined(__GNUC__)
#    define INLINE __inline__ __attribute__((always_inline))
#  else
#    define INLINE
#  endif
#endif

/* Pi */
#ifndef M_PI
#define M_PI  3.14159265358979323846
#endif

/* OEMCHAR / path separator */
#define OEMNEWLINE  "\n"
#define OEMPATHDIV  "/"
#define OEMPATHDIVC '/'
#define OEMSLASH    "/"
#define OEMSLASHC   '/'

#define OEMSTRNLENS       strnlen
#define OEMSTRNLEN        strnlen
#define OEMSTRLEN         strlen
#define STRNLENS          OEMSTRNLENS
#define STRNLEN           OEMSTRNLEN
#define STRLEN            OEMSTRLEN

#define OEMSNPRINTF               snprintf
#define OEMSPRINTF                sprintf
#define SNPRINTF                  OEMSNPRINTF
#define SPRINTF                   OEMSPRINTF

#define OEMSTRCPY(s1, s2) OEMSPRINTF(s1, OEMTEXT("%s"), s2)
#define OEMPRINTFSTR(s)   printf(OEMTEXT("%s"), s)

#define OEMCHAR         char
#define OEMTEXT(string) string
#define STRCALL

/* Calling conventions (none on arm64/Android) */
#define CDECL
#define STDCALL
#define FASTCALL
#define SAFECALL
#define CLRCALL
#define VECTORCALL
#define WINAPI

/* Windows-compat types */
typedef uint8_t  BYTE;
typedef uint16_t WORD;
typedef uint32_t DWORD;
typedef bool     BRESULT;
typedef wchar_t  TCHAR;

typedef union {
    struct { UINT32 LowPart; SINT32 HighPart; } u;
    SINT64 QuadPart;
} LARGE_INTEGER;

#define _T(string) string
#define _tcscpy    OEMSTRCPY
#define _tcsicmp   milstr_cmp
#define _tcsnicmp  strncasecmp

#ifndef ZeroMemory
#define ZeroMemory(d, z)    memset((d), 0, (z))
#endif
#ifndef CopyMemory
#define CopyMemory(d, s, z) memcpy((d), (s), (z))
#endif
#ifndef FillMemory
#define FillMemory(d, z, c) memset((d), (c), (z))
#endif

typedef uint8_t  REG8;
typedef uint16_t REG16;

#define UNUSED(v) (void)(v)

#define CPUCALL    FASTCALL
#define MEMCALL    FASTCALL
#define DMACCALL   FASTCALL
#define IOOUTCALL  FASTCALL
#define IOINPCALL  FASTCALL
#define SOUNDCALL  FASTCALL
#define VRAMCALL   FASTCALL
#define SCRNCALL   FASTCALL
#define VERMOUTHCL FASTCALL
#define PARTSCALL  FASTCALL

#define GETRAND() rand()

#define BYTESEX_LITTLE

#define sigjmp_buf           jmp_buf
#ifndef sigsetjmp
#define sigsetjmp(env, mask) setjmp(env)
#endif
#ifndef siglongjmp
#define siglongjmp(env, val) longjmp(env, val)
#endif

#define COPY64(pd, ps) *(UINT64*)(pd) = *(UINT64*)(ps)

/* MAX_PATH */
#ifndef MAX_PATH
#define MAX_PATH 4096
#endif

#ifndef MAX
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
#endif
#ifndef MIN
#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#endif

#ifndef NELEMENTS
#define NELEMENTS(a) (sizeof(a) / sizeof(a[0]))
#endif

/* MEMORY_MAXSIZE: NP21 (IA-32) で参照される拡張メモリ最大値 (MB) */
#if defined(SUPPORT_LARGE_MEMORY)
#define MEMORY_MAXSIZE 4000
#else
#define MEMORY_MAXSIZE 230
#endif

/* SUPPORT_LARGE_HDD: Phase 1 define → 64-bit FILEPOS */
#if defined(SUPPORT_LARGE_HDD)
typedef int64_t FILEPOS;
typedef int64_t FILELEN;
#define NHD_MAXSIZE  8000
#define NHD_MAXSIZE2 ((uint32_t)0xffffffff/1024/2)
#define NHD_MAXSIZE28 130558
#else
typedef int32_t FILEPOS;
typedef int32_t FILELEN;
#define NHD_MAXSIZE  2000
#define NHD_MAXSIZE2 2000
#endif

/* arm64 memory optimization */
#if defined(__aarch64__)
#define MEMOPTIMIZE 2
#define LOW12(a)  ((((UINT32)(a)) << 20) >> 20)
#define LOW14(a)  ((((UINT32)(a)) << 18) >> 18)
#define LOW15(a)  ((((UINT32)(a)) << 17) >> 17)
#define LOW16(a)  ((UINT16)(a))
#define HIGH16(a) (((UINT32)(a)) >> 16)
#endif

/* CPU_MULTIPLE_MAX */
#ifndef CPU_MULTIPLE_MAX
#define CPU_MULTIPLE_MAX 2048
#endif

#include "common.h"
#include "common/_memory.h"
#include "common/rect.h"
#include "common/lstarray.h"

#endif  /* _COMPILER_BASE_H_ */
