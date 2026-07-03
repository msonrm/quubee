#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void *np2kai_handle;

__attribute__((visibility("default")))
np2kai_handle np2kai_create(void);

__attribute__((visibility("default")))
void np2kai_destroy(np2kai_handle h);

__attribute__((visibility("default")))
int np2kai_set_data_dir(const char *path);

__attribute__((visibility("default")))
int np2kai_set_bios_dir(np2kai_handle h, const char *path);

__attribute__((visibility("default")))
void np2kai_run_frame(np2kai_handle h);

__attribute__((visibility("default")))
int np2kai_insert_fdd(np2kai_handle h, const char *path, int drive, int readonly);

/* SASI/IDE HDD をマウント。drive は 0-3。フォーマット (HDI/THD/NHD/HDD raw 等) は
 * 自動判定される。インストール型ゲームを動かす想定。挿入後は np2kai_reset を呼んで
 * HDD からブートし直すのが通常フロー。 */
__attribute__((visibility("default")))
int np2kai_insert_hdd(np2kai_handle h, const char *path, int drive);

__attribute__((visibility("default")))
void np2kai_eject_hdd(np2kai_handle h, int drive);

/* PC をリセット (新ディスクからのブートし直し用) */
__attribute__((visibility("default")))
void np2kai_reset(np2kai_handle h);

__attribute__((visibility("default")))
const uint8_t *np2kai_get_framebuffer(
	np2kai_handle h,
	int *out_width,
	int *out_height,
	int *out_bytes_per_pixel);

/* Debug: 現在の CPU PC を CS:EIP として返す (0xCS<<32 | EIP の 64bit) */
__attribute__((visibility("default")))
uint64_t np2kai_debug_get_pc(np2kai_handle h);

/* Debug: リアルモード換算の線形アドレス (CS<<4 + EIP & 0xffff) を 32bit で */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_linear_pc(np2kai_handle h);

/* Debug: CS のみ (16bit) */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_cs(np2kai_handle h);

/* Debug: 物理線形アドレスから 1byte 読む (CPU の cpu_vmemoryread を使用) */
__attribute__((visibility("default")))
uint32_t np2kai_debug_peek8(np2kai_handle h, uint32_t linear_addr);

/* Debug: gdc.mode1 (テキスト GDC モードレジスタ) を読む */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_gdc_mode1(np2kai_handle h);

/* Debug: gdcs.textdisp / gdcs.grphdisp を読む。bit 0x80 (GDCSCRN_ENABLE) で
 * テキスト面 / グラフィック面の表示 master enable を確認できる。
 * テキスト面が STOP コマンドで OFF になっているかの判定に使う。 */
__attribute__((visibility("default")))
uint32_t np2kai_debug_get_textdisp(np2kai_handle h);

__attribute__((visibility("default")))
uint32_t np2kai_debug_get_grphdisp(np2kai_handle h);

/* Keyboard: pc98_keycode は NP2kai の NKEY_* (0x00-0x7f) と同じ。
 * 値の意味は core/np2kai/keystat.h の enum を参照。 */
__attribute__((visibility("default")))
void np2kai_key_down(np2kai_handle h, uint8_t pc98_keycode);

__attribute__((visibility("default")))
void np2kai_key_up(np2kai_handle h, uint8_t pc98_keycode);

/* ホスト IME で確定した Shift-JIS バイト列をゲストの DOS 文字入力に注入する (FEP 不要の日本語入力)。
 * 受理したバイト数を返す。bytes は SJIS 生バイト (2 バイト文字はリード+トレイルを順に)。 */
__attribute__((visibility("default")))
int np2kai_inject_text(np2kai_handle h, const uint8_t *bytes, int len);

/* Mouse: 相対移動量を累積。PC-98 のマウス I/F は周期的に取り出して
 * カウンタをクリアする。Pointer Lock の movementX/Y をそのまま渡す想定。 */
__attribute__((visibility("default")))
void np2kai_mouse_move(np2kai_handle h, int dx, int dy);

/* button: 0=左, 1=右. down: 1=押下, 0=解放 */
__attribute__((visibility("default")))
void np2kai_mouse_button(np2kai_handle h, int button, int down);

/* INT 33h マウスドライバ HLE (dos_mouse33.c)。mode: 0=off / 1=MS 仕様 (既定) / 2=NEC 仕様。
 * stat which: 0=mode 1=呼び出し数 2=x 3=y 4=buttons 5=hidden カウンタ */
__attribute__((visibility("default")))
void np2kai_mouse33_ctl(np2kai_handle h, int mode);
__attribute__((visibility("default")))
uint32_t np2kai_mouse33_stat(np2kai_handle h, int which);

/* Audio: np2kai_create より前に呼ぶ。AudioContext.sampleRate に合わせる想定。
 * 受け付ける値: 11025/22050/44100/48000/88200/96000/176400/192000 */
__attribute__((visibility("default")))
int np2kai_set_audio_rate(uint32_t rate);

/* FM 音源エンジンの実行時 A/B 切替 (1=fmgen / 0=opngen)。次の Run (reset) から反映。
 * 戻り値: 設定後の値。FM 音質チューニング用 (qbDebug.fmgen から呼ぶ)。 */
__attribute__((visibility("default")))
int np2kai_set_fmgen(int on);

/* パート別音量バランスの実行時調整 (FM/SSG/Rhythm/ADPCM、各 0..128、負値=据え置き)。
 * np2cfg を更新し、生きている fmgen インスタンスにも opna_reset と同じ dB 換算で即反映する
 * (reset を待たず live A/B 可)。症状: リズムがメロより前に出すぎ等のミックス調整用。 */
__attribute__((visibility("default")))
void np2kai_set_vol(int fm, int ssg, int rhythm, int adpcm);

/* 現在のパート別音量 (which: 0=fm 1=ssg 2=rhythm 3=adpcm 4=master) を 0..128 で返す。 */
__attribute__((visibility("default")))
uint32_t np2kai_get_vol(int which);

/* 起動音 (PC-98 の「ピポ」= BEEP) のミュート。音楽セッションのブートでだけ消す用途
 * (pipo は BEEP・PMD 曲は FM で別音源)。mute!=0 で 0 に、mute=0 で復帰。戻り値 = 設定後の beep 音量。 */
__attribute__((visibility("default")))
int np2kai_set_beep_mute(int mute);

/* BEEP (PC-98 内蔵ブザー) の音量ブースト。gain_pct=100 が素の np2kai (peak 2048 = -24dBFS)。
 * vol_master が fmgen FM/TSF MIDI に効かず BEEP/ADPCM/PCM だけに効く性質を使い、ADPCM/PCM を相殺
 * しつつ BEEP だけ増幅する。純設定の上限 ~383% (BEEP_VOL=3 × vol_master=255)。既定 400 (→クランプ
 * 383)。戻り値 = 実際に適用した % (クランプ後)。qbDebug.beepgain(x) の実体。 */
__attribute__((visibility("default")))
int np2kai_set_beep_gain(int gain_pct);

/* 86 ボードの割り込みを INT5/IRQ12 に寄せる (on) / 既定へ戻す (off)。PMD .M 単体再生の音楽
 * セッションでだけ on。常駐ドライバ同梱ゲームは既定 (off)。reset の前に設定すること。 */
__attribute__((visibility("default")))
int np2kai_set_pmd_irq(int on);

/* 「ちびおと」= PC-9801-86 + ADPCM RAM (SOUNDID 0x14) のセッション限定有効化。on で 86+ADPCM、
 * off で素の 86 (0x04)。FMP .ovi / PMD .PPC 等 ADPCM(PCM) 声部のある曲で要る。既定 OFF
 * (0x14 は OPNA 実時間挙動を変えるので ADPCM が要るセッションだけ on)。次 Run (reset) から反映。
 * qbDebug.chibioto(0|1) の実体。 */
__attribute__((visibility("default")))
int np2kai_set_chibioto(int on);

/* ブート時 ITF (BIOS POST) ROM のトグル。on=1 で POST (メモリカウント+ピポ音) を復活、on=0 で
 * 既定どおりスキップ。次 Run (reset) から反映。qbDebug.itfpost(0|1) の実体。 */
__attribute__((visibility("default")))
int np2kai_set_itf_post(int on);

/* 仮想 30行BIOS: 30 行テキスト表示 (640×480) + 30BIOS-API のセッション限定オン/オフ。on で次の
 * Run (loader-start) から有効。既定 OFF (= ゼロ回帰)。qbDebug.lines30(0|1) の実体。詳細: docs/30line_spec.md。 */
__attribute__((visibility("default")))
int np2kai_set_lines30(int on);

/* CPU クロック倍率の live 設定 (快適化 A/B / async 自動クロック / ベンチ用)。倍率↑ = エミュ CPU
 * 高速化だが host 負荷も比例増 (CPU-bound 時。HLT-idle 時は HLT fast-forward でほぼ無影響)。
 * pull 型音声では host が追いつかない倍率にすると音声が枯れて途切れるので real-time を割らない
 * 範囲で使う。reset 不要でその場反映 (engine と同一の changeclock + gdc_updateclock カスケード)、
 * np2cfg.multiple も書くので次の Run でも保持。戻り値: クランプ後の適用倍率。 */
__attribute__((visibility("default")))
int np2kai_set_clock_multiple(int multiple);

/* 音声 pull 型 (C1)。JS の ScriptProcessorNode.onaudioprocess から呼ばれ、
 * dst に frames ぶんのステレオ int16 (L,R 交互) を書き出す。 */
__attribute__((visibility("default")))
void np2kai_audio_fill(np2kai_handle h, int16_t *dst, uint32_t frames);

/* ScriptProcessorNode に使うバッファ長 (ステレオフレーム数) を返す */
__attribute__((visibility("default")))
uint32_t np2kai_audio_get_bufsize(np2kai_handle h);

/* 現在のサンプリングレートを返す (sound_create に渡された値) */
__attribute__((visibility("default")))
uint32_t np2kai_audio_get_rate(np2kai_handle h);

/* ---- Phase 3 ミニマル DOS ローダ ---- */
/* COM image をステージング (次回 loader-start フック発火時に展開される)。
 * 戻り値: 0 = OK、< 0 = エラー (-1: NULL/empty、-2: 64KB 超え)。
 * cmdline / name は NULL 可。cmdline max 126 byte (PSP 0x80 の最大長)。
 * name は image の表示名 (例 "HELLO.COM")。argv[0] = "A:\<basename>" の生成に使う。 */
__attribute__((visibility("default")))
int np2kai_dos_stage_com(const uint8_t *image, int size, const char *cmdline,
                         const char *name);

/* MZ / ZM EXE image をステージング。body (header strip 後) は最大 640KB
 * (PC-98 基本メモリ上限)。reloc 適用と CS/IP/SS/SP 計算はローダ側で行う。
 * 戻り値: 0 = OK、< 0 = エラー (-1: NULL/too small、-3: bad magic、-5: truncated、
 * -7: > 640KB、-8/-9: reloc 不整合、その他: ヘッダ矛盾)。
 * cmdline / name は NULL 可 (name の用途は stage_com と同じ)。 */
__attribute__((visibility("default")))
int np2kai_dos_stage_exe(const uint8_t *image, int size, const char *cmdline,
                         const char *name);

/* ② 起動 .bat を 1 DOS セッション内で順に EXEC するミニ COMMAND.COM を stage。
 * script は "PATH\tARGS\nPATH\tARGS\n…" の生バイト (SJIS パス名対策で NUL 終端でなく len 指定)。
 * 子バイトは渡さない (展開済 /run から AH=4Bh が読む)。name は表示/argv[0] 用。
 * 戻り値: 0 = OK、< 0 = エラー (dos_loader.h 参照)。 */
__attribute__((visibility("default")))
int np2kai_dos_stage_script(const char *script, int len, const char *name);

/* DOS image の exit 状態を取得。
 * 戻り値: 0 = まだ動作中、1 = 終了済み。code_out が non-NULL なら exit code を書く。 */
__attribute__((visibility("default")))
int np2kai_dos_get_exit(int *code_out);

/* 音楽セッション (PMD .M を再起動なしで次々演奏)。stage_music で PMD86 常駐セッションを stage し、
 * loader.d88 で 1 度起動 → 以後 music_play(song) で曲だけ差し替える (別 DOS セッション=reset 不要)。
 * song は /run 相対の DOS パス。戻り値 0=OK / <0=エラー。 */
__attribute__((visibility("default")))
int np2kai_dos_stage_music(void);
__attribute__((visibility("default")))
int np2kai_dos_music_play(const char *song);

#ifdef __cplusplus
}
#endif
