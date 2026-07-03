/*
 * dos_mouse33.h — INT 33h マウスドライバ HLE (Phase 3)
 *
 * 「MOUSE.COM ロード済の DOS」を再現する。実 MOUSE.SYS/COM と違いコンベンショナルメモリは
 * 消費しない (実体は C + BIOS 領域トランポリン QB_TRAMP_INT33)。
 *
 * PC-98 のマウスドライバ API には NEC 仕様と MS 仕様の二流派があり、ファンクション番号の
 * 割当自体が食い違う (fn3 の戻り・fn7/8 の意味・範囲設定の番号)。両方をペルソナとして実装し
 * 既定は MS (corpus 実測: bepn/brpn は AX 温存判定で両対応・ADV98 は MS 前提。HImouse の既定も MS)。
 *
 * 正典 = 実ドライバの実測 (2026-07-03、tools/mousetest/ の MOUSETEST.COM で測定):
 *   MS 仕様: 実物 MS Mouse Driver 7.06 (games/fixture/mouse.com、再配布不可・未コミット)
 *   NEC 仕様: HImouse v0.2 -n (games/fixture/himus02.lzh、緋色樹氏 1994、NEC/MS 切替型フリードライバ)
 *   三重裏付け: DOSBox-X (nanshiki 氏) + brpn/bepn 実バイナリの二流派判定コード
 * 差異・未対応は docs/dos_hle_gaps.md を参照。
 */
#ifndef QB_DOS_MOUSE33_H
#define QB_DOS_MOUSE33_H

#include <stdint.h>

enum {
    QB_MOUSE33_OFF = 0,
    QB_MOUSE33_MS  = 1,   /* Microsoft 仕様 (既定) */
    QB_MOUSE33_NEC = 2,   /* NEC 仕様 */
};

/* Run 毎リセット (dos_loader の run_image 準備から呼ぶ)。ペルソナ/有効フラグは維持し
 * 動的状態 (位置・範囲・カウンタ・カーソル形状) を初期化する。 */
void qb_mouse33_reset_run(void);

/* INT 33h ディスパッチ (0xFEEE0 トランポリンの biosfunc フックから)。常に 1 を返す。
 * 無効時 (QB_MOUSE33_OFF) はレジスタ不変 = ドライバ不在の正直応答 (需要プローブと同値)。 */
int qb_mouse33_int33(void);

/* ホスト入力 (bridge の np2kai_mouse_move/button から、HW バスマウス経路と並走で呼ぶ)。
 * dx/dy はホストの相対移動量 (= mickey として扱う)。button: 0=左 1=右。 */
void qb_mouse33_post_move(int dx, int dy);
void qb_mouse33_post_button(int button, int down);

/* モード切替 (qbDebug.mouse33): QB_MOUSE33_OFF/MS/NEC。 */
void qb_mouse33_set_mode(int mode);

/* 統計/デバッグ: which 0=mode 1=総呼び出し数 2=x 3=y 4=buttons 5=hidden カウンタ */
uint32_t qb_mouse33_stat(int which);

/* ドライバカーソルを表示すべき状態か (有効 && リセット済 && hidden==0)。 */
int qb_mouse33_cursor_visible(void);

/* RGB16 フレームバッファへカーソルを合成する (np2kai_get_framebuffer が
 * pc98surf→dispsurf の再コピー直後に呼ぶ。表示専用でゲスト VRAM は汚さない)。 */
void qb_mouse33_overlay(uint16_t *fb, int w, int h);

#endif /* QB_DOS_MOUSE33_H */
