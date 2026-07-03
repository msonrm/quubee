# mousetest — INT 33h マウスドライバの挙動測定ハーネス

INT 33h の各ファンクションを呼び、戻りレジスタ (AX/BX/CX/DX) をメモリにダンプする
測定プログラム。NEC 仕様 / MS 仕様の二流派問題 (fn3 の戻り・fn7/8 の意味・範囲設定の番号)
を実ドライバの実測で決着させるために作った (2026-07-03)。

## ファイル
- `mousetest.asm` — 測定プログラム本体 (nasm)。`nasm -f bin -o MOUSETEST.COM mousetest.asm`
- `MOUSETEST.COM` — assemble 済みバイナリ (コミット済。asm を変えたら要再生成 +
  `../mouse33_test.js` 内の DUMPBUF offset を listing で確認)
- `measure_real.js` — 実ドライバ (TSR) を常駐させてから MOUSETEST を流す測定ランナー。
  `node tools/mousetest/measure_real.js <driver.com> [driverArgs] [pair A|B|C]`

## 測定済みの正典 (真理値表は native/dos_mouse33.c 冒頭の表を参照)
- MS 仕様: 実物 MS Mouse Driver 7.06 (`games/fixture/mouse.com`、再配布不可・未コミット)
- NEC 仕様: HImouse v0.2 `-n` (`games/himus02.lzh`、緋色樹氏 1994。NEC/MS 切替型フリー
  ドライバで、MS モードが実物 7.06 と全項目一致することを確認済み = 測定台として信頼可)

pair A/B/C はコマンドライン引数で「どのファンクション対を範囲設定として試すか」
(A=fn0A/0B, B=fn10/11, C=fn07/08)。狭い範囲 (0..100h, 0..80h) を設定 → ホストが大移動を
注入 → fn3 のクランプ先で判別する。結果: MS=fn07/08、NEC=fn10/11 が範囲設定。

## HLE の回帰テスト
`node tools/mouse33_test.js` — 同じ MOUSETEST.COM を我々の INT 33h HLE (dos_mouse33.c) に
対して流し、実測済み真理値表と全項目突合する。

## 実機での追試 (協力者向け)
MOUSETEST.COM は実 PC-98 でも動く。NEC 純正 MOUSE.SYS 環境で走らせ、終了後に
DEBUG 等で PSP+0x230 付近 (完走センチネル 0x55 + 13 ダンプ × 8 byte) を読めば、
本物の NEC 仕様との突合ができる。
