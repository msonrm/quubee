/* dos_fep.h — HLE FEP: 未確定文字列 (composition) のゲスト画面インライン表示。
 *
 * 実 PC-98 の FEP (ATOK/VJE/WX/NECAI...) はアプリより上流でキーを飲み、変換中の
 * よみ・文節を自分でテキスト VRAM に描き、確定した SJIS を入力ストリームへ流す
 * 常駐ソフトだった (アプリは確定文字列が届くまで何も知らない)。QuuBee では
 * キー横取り・ローマ字→かな・かな漢字変換をホスト (JS) が担い、このモジュールは
 * 「ゲスト画面内への描画と復元」だけを受け持つ。確定文字列の注入は既存の
 * qb_dos_inject_input (np2kai_inject_text) をそのまま使う。
 *
 * 描画規律: 毎回 restore-all → save → redraw。必ず「元の画面に戻してから」次の
 * 状態を描くので、アプリの描画内容は表示中も破壊されない (取り合いは復元漏れ
 * ではなく上書きタイミングの問題に限定される)。 */
#ifndef QB_DOS_FEP_H
#define QB_DOS_FEP_H

#include <stdint.h>

/* 未確定文字列を現在のカーソル位置 (GDC HW カーソル、画面外なら DOS CON ワーク
 * 0:0710h/071Ch フォールバック) からインライン描画する。既表示なら先に復元して
 * から描き直す。sjis=SJIS バイト列、attrs=バイトごとの PC-98 属性 (全角は先行
 * バイトの属性を 2 セルに適用。NULL なら白下線 0xE9)。行末は次行へ折り返し
 * (全角が行末 1 桁に残る場合は空白パディング)、画面末尾を越える長さは末尾優先。
 * 戻り値 = 実際に描いたセル数 (パディング込み)。len<=0 は qb_fep_hide 相当。 */
int  qb_fep_show(const uint8_t *sjis, const uint8_t *attrs, int len);

/* 退避したセルを復元して表示を消す。未表示なら no-op。 */
void qb_fep_hide(void);

/* リセット時の状態破棄 (復元はしない — VRAM はリセットで消えており、退避内容を
 * 書き戻すと初期画面にゴミが出る)。pccore_reset 直後に bridge.c が呼ぶ。 */
void qb_fep_reset(void);

#endif /* QB_DOS_FEP_H */
