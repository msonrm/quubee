# NP2kai サブモジュール改変パッチ

`core/np2kai` (NP2kai 本家、git submodule) に対する qb 固有の改変を patch 形式で保存している。

## なぜパッチなのか

- `core/np2kai` は submodule で、qb repo はコミット pointer しか追跡しない
- submodule 内のローカル変更は `git submodule update` で消える
- フォークしてもよいが、追跡コストが高い
- → パッチを qb repo にコミットしておき、build 前 (または初回 checkout 後) に適用する

## パッチ一覧

| ファイル | 目的 |
|---|---|
| `01_dos_loader_hooks.patch` | Phase 3 ミニマル DOS ローダ用のフック。`bios_initialize` 末尾で `qb_dos_install_trampolines()` 呼び出し + `biosfunc()` switch に 12 case 追加 (0xFEE00 ローダ起動 / 0xFEE10 INT 21h / 0xFEE20 INT 20h / 0xFEE50 INT 2Fh=XMS 検出・応答 / 0xFEE60 INT 67h=EMS 需要プローブ / 0xFEE70 XMS ドライバ entry / 0xFEE80 INT 29h=DOS 高速文字出力 / 0xFEE90 .bat 文インタプリタ「次コマンド?」 / 0xFEEA0 INT DCh=編集キー定義 BIOS / 0xFEEB0 INT 27h=旧式 TSR / 0xFEEC0 INT 18h=仮想 30行BIOS フロントエンド / 0xFEEE0 INT 33h=マウスドライバ需要プローブ)。加えて `bios_initialize` で E800:0DC0 に `"NEC N-88BASIC(86)"` を配置 (Turbo-C BGI 等の NEC 実機判定対策、life100 -egc 根治)。実際のハンドラ本体は `native/dos_*.c` 側 (このパッチはコア側の入口=トランポリン dispatch のみ) |
| `02_font_reset_fix.patch` | `pccore_reset()` の `ZeroMemory(mem + FONT_ADRS, 0x08000)` を抑止。リセット毎に fontrom 先頭 0x8000 (= JIS 点 0..7 の漢字ブロック) が消去され、Wasm には再生成する hook_fontrom バックエンドが無いため、点1..7 の漢字 (あ/い/う 等) が永久に欠けるのを防ぐ |
| `03_rtc_y2k_clamp.patch` | `calendar.c:date2bcd` で年 >=2000 を 1999 にクランプ。90 年代ゲームが PC-98 RTC (μPD4990A) から直読みする年が 2026→126 の 3 桁になり固定幅セーブを壊す Y2K バグを汎用シムで回避 (蟹味噌のテキスト残留の真因) |
| `04_lio_gscreen_disp_page.patch` | `lio/gscreen.c:lio_gscreen` の表示ページバグ修正。GSCREEN の disp パラメータ省略 (0xFF) 時にローカル変数 0xFF がそのまま `mode |= disp << 4` に流れ、bit4=1 で表示ページが勝手に 1 へ切り替わる (page0 に描いた絵が表示されず真っ黒)。`lio->work.disp` (正規化済み保持値) を使うよう修正。LIO (N88-BASIC グラフィック BIOS、INT A0h〜) で描画する MIMPI 等の背景消失の真因 |

> 注: かつての `04_vermouth_gs_effects.patch` (VERMOUTH に GS リバーブ等を追加) は **revert 済み**
> (現在の 04 は別内容の LIO 修正)。MIDI 合成は VERMOUTH から TinySoundFont (`native/qb_tsf.c` +
> `native/third_party/tsf.h`、SF2 再生) に差し替えたため、VERMOUTH (`sound/vermouth/*.c`) は
> ビルドから外されている。

## 適用方法

```bash
# 初回 (submodule init 直後 or 上記パッチが当たっていない時)
cd core/np2kai
git apply ../../tools/np2kai_patches/*.patch
cd ../..
```

または build スクリプトで自動化したい場合は `emscripten/build.sh` の冒頭に:

```bash
# bios.c が未パッチなら適用
if ! grep -q "qb_dos_install_trampolines" core/np2kai/bios/bios.c; then
    (cd core/np2kai && git apply ../../tools/np2kai_patches/*.patch)
fi
```

## パッチを更新したい時

`core/np2kai/bios/bios.c` を手で編集 → 動作確認 → 以下で再生成:

```bash
git -C core/np2kai diff bios/bios.c > tools/np2kai_patches/01_dos_loader_hooks.patch
```
