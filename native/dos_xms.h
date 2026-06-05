/*
 * dos_xms.h — XMS (HIMEM.SYS 相当) HLE / Tier 1 MVP (2026-06-05)
 *
 * 「HIMEM.SYS がロードされた DOS」を素直に再現する。EMB (拡張メモリブロック) は
 * 実拡張メモリ CPU_EXTMEM (i386core.e.ext, 32MB) のサブ領域に確保し、Move は実バイトの
 * memcpy、API は XMS 3.0 のレジスタ契約・エラーコードを正直に返す。
 *
 * 経路: ゲームは INT 2Fh AX=4300h で存在検出 (→AL=80h) → AX=4310h で entry 取得
 *       (→ES:BX = F000:EE70) → その far アドレスを CALL FAR して AH=関数番号で各機能を呼ぶ。
 *       entry は dos_loader.c のトランポリン (NOP+RETF, QB_TRAMP_XMS_ENTRY) で、NOP が
 *       biosfunc→qb_dos_xms_entry_hook→qb_xms_dispatch を踏む。
 */
#ifndef QB_DOS_XMS_H
#define QB_DOS_XMS_H

#include <stdint.h>

/* 有効/無効 (既定 ON = 実機で HIMEM が常駐している想定)。無効化すると INT 2Fh AX=4300h は
 * 「XMS 無し」と応答する (= 需要プローブのみの従来挙動)。戻り値 = 反映後の有効状態。 */
void qb_xms_set_enabled(int on);
/* 実効的に有効か (有効フラグ かつ CPU_EXTMEM が確保済みでプールが非空)。 */
int  qb_xms_enabled(void);

/* Run 毎 (loader-start) に呼ぶ。ハンドル表クリア + プールを CPU_EXTMEM から再計算。 */
void qb_xms_reset(void);

/* XMS ドライバ entry のディスパッチャ (0xFEE70 の NOP で biosfunc 経由で踏まれる)。
 * CPU_AH=関数番号を読み、結果を AX/BX/DX/BL 等に書く。常に 1 を返す (caller は RETF で戻る)。 */
int  qb_xms_dispatch(void);

/* 診断 (qbDebug.xms)。which: 0=有効か / 1=確保中ハンドル数 / 2=使用バイト / 3=空きバイト。 */
uint32_t qb_xms_stat(int which);

#endif /* QB_DOS_XMS_H */
