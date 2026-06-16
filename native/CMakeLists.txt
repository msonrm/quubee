cmake_minimum_required(VERSION 3.18)
project(np2kai_core C CXX)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "Build with Emscripten: emcmake cmake -S native -B build/wasm")
endif()

set(NP2 ${CMAKE_CURRENT_SOURCE_DIR}/../core/np2kai)

# ---- Core source files (from Makefile.common SOURCES_C, excluding sdl/*.c) ----

set(CORE_SOURCES
    ${NP2}/calendar.c
    ${NP2}/keystat.c
    ${NP2}/nevent.c
    ${NP2}/pccore.c
    ${NP2}/statsave.c
    ${NP2}/timing.c
    # debugsnapshot.c excluded: requires openssl/sha.h (Phase 1 not needed)
    ${NP2}/debugsub.c           # i286 version (not debugsub386.c)
    ${NP2}/np2_thread.c
    ${NP2}/np2_tickcount.c
)

file(GLOB BIOS_SOURCES      ${NP2}/bios/*.c)
file(GLOB CBUS_SOURCES      ${NP2}/cbus/*.c)
file(GLOB CODECNV_SOURCES   ${NP2}/codecnv/*.c)
file(GLOB COMMON_SOURCES    ${NP2}/common/*.c)
file(GLOB DISKIMAGE_SOURCES ${NP2}/diskimage/*.c)
file(GLOB DISKIMAGE_CD_SRC  ${NP2}/diskimage/cd/*.c)
file(GLOB DISKIMAGE_FD_SRC  ${NP2}/diskimage/fd/*.c)
file(GLOB EMBED_SOURCES     ${NP2}/embed/*.c)
file(GLOB EMBED_MENU_SRC    ${NP2}/embed/menu/*.c)
file(GLOB EMBED_MENUBASE    ${NP2}/embed/menubase/*.c)
file(GLOB FDD_SOURCES       ${NP2}/fdd/*.c)
file(GLOB FONT_SOURCES      ${NP2}/font/*.c)
set(GENERIC_SOURCES
    ${NP2}/generic/cmjasts.c
    ${NP2}/generic/cmndraw.c
    ${NP2}/generic/cmver.c
    ${NP2}/generic/dipswbmp.c
    ${NP2}/generic/hostdrv.c
    ${NP2}/generic/hostdrvs.c
    ${NP2}/generic/keydisp.c
    ${NP2}/generic/memdbg32.c
    ${NP2}/generic/np2info.c
    ${NP2}/generic/softkbd.c
    ${NP2}/generic/unasm.c
)
file(GLOB IO_SOURCES        ${NP2}/io/*.c)
file(GLOB IO_PCI_SOURCES    ${NP2}/io/pci/*.c)
file(GLOB LIO_SOURCES       ${NP2}/lio/*.c)
file(GLOB MEM_SOURCES       ${NP2}/mem/*.c)
set(SOUND_SOURCES
    ${NP2}/sound/adpcmc.c
    ${NP2}/sound/adpcmg.c
    ${NP2}/sound/beepc.c
    ${NP2}/sound/beepg.c
    ${NP2}/sound/cs4231c.c
    ${NP2}/sound/cs4231g.c
    ${NP2}/sound/ct1741c.c
    ${NP2}/sound/ct1741g.c
    ${NP2}/sound/fmboard.c
    ${NP2}/sound/opl3.c
    ${NP2}/sound/oplgenc.c
    ${NP2}/sound/oplgeng.c
    ${NP2}/sound/opngenc.c
    ${NP2}/sound/opngeng.c
    ${NP2}/sound/opna.c
    ${NP2}/sound/opntimer.c
    ${NP2}/sound/pcm86c.c
    ${NP2}/sound/pcm86g.c
    ${NP2}/sound/pcmmix.c
    ${NP2}/sound/psggenc.c
    ${NP2}/sound/psggeng.c
    ${NP2}/sound/rhythmc.c
    ${NP2}/sound/s98.c
    ${NP2}/sound/sndcsec.c
    ${NP2}/sound/sound.c
    ${NP2}/sound/soundrom.c
    ${NP2}/sound/tms3631c.c
    ${NP2}/sound/tms3631g.c
)
file(GLOB GETSND_SOURCES    ${NP2}/sound/getsnd/*.c)
file(GLOB MAME_SOURCES      ${NP2}/sound/mame/*.c)
# VERMOUTH (sound/vermouth/*.c) はビルドしない: MIDI 合成は TinySoundFont (native/qb_tsf.c) に差し替え。
# cmmidi.c が呼ぶ midimod_*/midiout_* は qb_tsf.c が提供する (VERMOUTH_LIB は cmmidi の分岐用に維持)。
set(VERMOUTH_SOURCES "")
file(GLOB TRAP_SOURCES      ${NP2}/trap/*.c)
file(GLOB VRAM_SOURCES      ${NP2}/vram/*.c)

# CPU: i386c + IA-32 (NP21 / PC-9821 系)。
# i286c では FreeDOS(98) のような 386+ 命令を使うソフトが INT 6 (invalid opcode)
# を踏むため、IA-32 エミュレータに切り替える。
set(CPU_SOURCES
    ${NP2}/i386c/cpucore.c
    ${NP2}/i386c/cpumem.c
)
file(GLOB IA32_SOURCES        ${NP2}/i386c/ia32/*.c)
file(GLOB IA32_INST_SOURCES   ${NP2}/i386c/ia32/instructions/*.c)
# FPU: DOSBox 由来の DOSBOX2 系エミュレータを使う。
# FPU 命令 (例: FADD ST(0), ST(1)) は INT 7 (#NM) を吐くだけだとハンドラがない
# OS (FreeDOS 等) でループするため、ダミーではなく本物のエミュを入れる。
# fpdummy.c も残しておく: NOFPU_* シンボルが fpu.c 内のフォールバック経路で
# 参照される可能性があるため。
set(FPU_SOURCES
    ${NP2}/i386c/ia32/instructions/fpu/fpdummy.c
    ${NP2}/i386c/ia32/instructions/fpu/fpemul_dosbox2.c
)
# SIMD: USE_SSE / USE_MMX / USE_3DNOW は定義しない (= 命令実行は UD_EXCEPTION
# に落ちる) が、inst_table.c が SSE_*/MMX_*/AMD3DNOW_* シンボルを参照する。
# 各 .c の #else 側に UD ハンドラのスタブがあるので、コンパイルだけ通せばよい。
file(GLOB SIMD_SOURCES
    ${NP2}/i386c/ia32/instructions/mmx/*.c
    ${NP2}/i386c/ia32/instructions/sse/*.c
    ${NP2}/i386c/ia32/instructions/sse2/*.c
    ${NP2}/i386c/ia32/instructions/sse3/*.c
    ${NP2}/i386c/ia32/instructions/ssse3/*.c
    ${NP2}/i386c/ia32/instructions/sse4/*.c
    ${NP2}/i386c/ia32/instructions/sse4a/*.c
)

# SDL frontend files that are POSIX-compatible (no SDL dependency)
set(SDL_COMPAT_SOURCES
    ${NP2}/sdl/dosio.c
    ${NP2}/sdl/fontmng.c
    # cmmidi.c: VERMOUTH MIDI 合成への橋渡し。POSIX/Win32 MIDI デバイス経路は
    # ファイル内の `#if !defined(EMSCRIPTEN)` ガードで除外され、VERMOUTH 分岐のみ生きる
    ${NP2}/sdl/cmmidi.c
    # taskmng.c excluded: full SDL dependency (SDL_PollEvent loop)
    # Stubs provided in qb_taskmng.c
)

# C++ sound sources
file(GLOB FMGEN_SOURCES     ${NP2}/sound/fmgen/*.cpp)
file(GLOB MAMEBSD_SOURCES   ${NP2}/sound/mamebsd/*.cpp)

# QB bridge and frontend stubs
set(QB_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/bridge.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_scrnmng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_soundmng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_joymng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_mousemng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_sysmng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_commng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_vermouth.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_tsf.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_ini.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_taskmng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_timemng.c
    ${CMAKE_CURRENT_SOURCE_DIR}/qb_wabrly.c
    # Phase 3 ミニマル DOS ローダ (boot sector → 0xFFE0 → C トランポリン)
    ${CMAKE_CURRENT_SOURCE_DIR}/dos_loader.c
    ${CMAKE_CURRENT_SOURCE_DIR}/dos_int21.c
    ${CMAKE_CURRENT_SOURCE_DIR}/dos_xms.c
)

# Exported bridge functions (prefixed with _ for Emscripten)
set(EXPORTED_FUNCTIONS
    _np2kai_set_data_dir
    _np2kai_create
    _np2kai_destroy
    _np2kai_set_bios_dir
    _np2kai_insert_fdd
    _np2kai_insert_hdd
    _np2kai_eject_hdd
    _np2kai_reset
    _np2kai_run_frame
    _np2kai_get_framebuffer
    _np2kai_key_down
    _np2kai_key_up
    _np2kai_mouse_move
    _np2kai_mouse_button
    _np2kai_set_audio_rate
    _np2kai_audio_fill
    _np2kai_audio_get_bufsize
    _np2kai_audio_get_rate
    _np2kai_enable_midi
    _np2kai_enable_midi_now
    _np2kai_debug_get_pc
    _np2kai_debug_get_cs
    _np2kai_debug_get_linear_pc
    _np2kai_debug_peek8
    _np2kai_debug_poke8
    _np2kai_debug_get_gdc_mode1
    _np2kai_debug_get_textdisp
    _np2kai_debug_get_grphdisp
    _np2kai_debug_get_gdc_para
    _np2kai_debug_rtc_bcd
    _np2kai_debug_int21_count
    _np2kai_debug_int21_reset
    _np2kai_dos_set_int21_trace
    _np2kai_debug_get_reg16
    _np2kai_debug_serial_midi_bytes
    _np2kai_debug_serial_midi_active
    _np2kai_debug_midi_fx
    _np2kai_debug_memprobe
    _np2kai_xms_enable
    _np2kai_xms_stat
    _np2kai_dos_stage_com
    _np2kai_dos_stage_exe
    _np2kai_dos_stage_script
    _np2kai_dos_stage_batch
    _np2kai_dos_stage_music
    _np2kai_dos_music_play
    _np2kai_set_fmgen
    _np2kai_set_beep_mute
    _np2kai_set_clock_multiple
    _np2kai_dos_get_exit
    _malloc
    _free
)
list(JOIN EXPORTED_FUNCTIONS "," EXPORTED_FUNCTIONS_STR)

add_executable(np2kai_core
    ${CORE_SOURCES}
    ${BIOS_SOURCES}
    ${CBUS_SOURCES}
    ${CODECNV_SOURCES}
    ${COMMON_SOURCES}
    ${DISKIMAGE_SOURCES}
    ${DISKIMAGE_CD_SRC}
    ${DISKIMAGE_FD_SRC}
    ${EMBED_SOURCES}
    ${EMBED_MENU_SRC}
    ${EMBED_MENUBASE}
    ${FDD_SOURCES}
    ${FONT_SOURCES}
    ${GENERIC_SOURCES}
    ${IO_SOURCES}
    ${IO_PCI_SOURCES}
    ${LIO_SOURCES}
    ${MEM_SOURCES}
    ${SOUND_SOURCES}
    ${GETSND_SOURCES}
    ${MAME_SOURCES}
    ${VERMOUTH_SOURCES}
    ${TRAP_SOURCES}
    ${VRAM_SOURCES}
    ${CPU_SOURCES}
    ${IA32_SOURCES}
    ${IA32_INST_SOURCES}
    ${FPU_SOURCES}
    ${SIMD_SOURCES}
    ${SDL_COMPAT_SOURCES}
    ${FMGEN_SOURCES}
    ${MAMEBSD_SOURCES}
    ${QB_SOURCES}
)

# Include paths: native/ BEFORE sdl/ to override scrnmng.h, mousemng.h, np2.h
target_include_directories(np2kai_core PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${NP2}
    ${NP2}/cbus
    ${NP2}/common
    ${NP2}/diskimage
    ${NP2}/diskimage/cd
    ${NP2}/diskimage/fd
    ${NP2}/embed
    ${NP2}/embed/menu
    ${NP2}/embed/menubase
    ${NP2}/fdd
    ${NP2}/font
    ${NP2}/generic
    ${NP2}/io
    ${NP2}/mem
    ${NP2}/sound
    ${NP2}/sound/vermouth
    ${NP2}/sound/mame
    ${NP2}/sound/fmgen
    ${NP2}/trap
    ${NP2}/vram
    ${NP2}/sdl
    ${NP2}/i386c
    ${NP2}/i386c/ia32
    ${NP2}/i386c/ia32/instructions
    ${NP2}/i386c/ia32/instructions/fpu
)

# Compile definitions (from Makefile.common NP2DEFINE, i286 mode)
target_compile_definitions(np2kai_core PRIVATE
    # NP21 (IA-32) コア有効化
    CPUCORE_IA32
    IA32_REBOOT_ON_PANIC
    IA32_PAGING_EACHSIZE
    SUPPORT_PC9821       # i386c/cpumem.c の memfnf テーブルが
                         # SUPPORT_PC9821 無効時も memvgaf_* を参照するため必須
    SUPPORT_PEGC         # PC-9821 の 256 色 VRAM。memvga.c が参照
    SUPPORT_LARGE_MEMORY # pccore.c が extsize 計算で参照
    # SUPPORT_VGA_MODEX 削除: bios.c の case 0x1a が SUPPORT_CL_GD5430 を
    # 要求するが、それを有効化すると更にビルド連鎖が増えるので外す。
    # PC-98 ネイティブモードのまま使う。
    SUPPORT_PC9801_119
    SUPPORT_IDEIO
    SUPPORT_IDEIO_48BIT
    SUPPORT_GAMEPORT
    SUPPORT_CRT31KHZ
    USE_TSC              # RDTSC 命令で CPU_MSR_TSC を無条件参照するので必須
    USE_FPU              # FPU 命令 (D8〜DF) を本物のエミュで処理
    SUPPORT_FPU_DOSBOX2  # DOSBox 2 系 FPU エミュレータを使う
    BIOS_IO_EMULATION
    OSLANG_UTF8
    OSLINEBREAK_CRLF
    SUPPORT_8BPP
    SUPPORT_16BPP
    SUPPORT_24BPP
    SUPPORT_32BPP
    SUPPORT_CRT15KHZ
    SUPPORT_FAST_MEMORYCHECK
    SUPPORT_FMGEN
    SUPPORT_GPIB
    SUPPORT_HRTIMER
    SUPPORT_KAI_IMAGES
    SUPPORT_LARGE_HDD
    SUPPORT_NORMALDISP
    SUPPORT_PC9861K
    SUPPORT_PX
    SUPPORT_RESUME
    SUPPORT_RS232C_FIFO
    SUPPORT_S98
    SUPPORT_SCSI
    SUPPORT_SMPU98
    "SUPPORT_SOFTKBD=0"
    SUPPORT_SOUND_SB16
    "SUPPORT_STATSAVE=10"
    SUPPORT_UTF8
    SUPPORT_V30EXT
    SUPPORT_V30ORIGINAL
    SUPPORT_VIDEOFILTER
    SUPPORT_VPCVHD
    USE_MAME
    USE_MAME_BSD
    VAEG_FIX
    VERMOUTH_LIB
    SUPPORT_DEBUGSS
    SUPPORT_NP2_TICKCOUNT
    "NP2KAI_GIT_TAG=\"Phase2\""
    "NP2KAI_GIT_HASH=\"unknown\""
    QB_FRONTEND
)

# Emscripten linker flags
target_link_options(np2kai_core PRIVATE
    -O3                      # リンク時最適化 (Binaryen wasm-opt)。上流 sdl/Makefile21.em のリンク段と同じ
    -sWASM=1
    -sALLOW_MEMORY_GROWTH=1
    "-sEXPORTED_FUNCTIONS=[${EXPORTED_FUNCTIONS_STR}]"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','UTF8ToString','FS']"
    -sMODULARIZE=1
    "-sEXPORT_NAME=NP2KaiModule"
    --no-entry
)

# NP2kai uses UINT8/UINT return types where IOOUT/IOINP expect UINT — suppress
# Clang 17's promoted-to-error treatment of these upstream type mismatches
# 最適化: 既定は CMAKE_BUILD_TYPE 空 = 実質 -O0 (IA-32 インタプリタが毎フレームの支配項なので
# 致命的に遅い)。上流 sdl/Makefile21.em の release と同じ -O2 をコンパイル段に入れる
# (リンク段は上の -O3)。-O2 は NP2kai が release/em で常用するテスト済みレベル。strict-aliasing は
# 上流 libretro が -fstrict-aliasing で通しているので無効化不要。C/C++ 両方に効かせる (fmgen は C++)。
target_compile_options(np2kai_core PRIVATE
    -O2
    $<$<COMPILE_LANGUAGE:C>:-Wno-incompatible-function-pointer-types>
    $<$<COMPILE_LANGUAGE:C>:-Wno-int-conversion>
)
