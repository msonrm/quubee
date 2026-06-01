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
| `01_dos_loader_hooks.patch` | Phase 3 ミニマル DOS ローダ用のフック。`bios_initialize` 末尾で `qb_dos_install_trampolines()` 呼び出し + `biosfunc()` switch に 3 case 追加 (0xFEE00 ローダ起動 / 0xFEE10 INT 21h / 0xFEE20 INT 20h) |
| `02_font_reset_fix.patch` | `pccore_reset()` の `ZeroMemory(mem + FONT_ADRS, 0x08000)` を抑止。リセット毎に fontrom 先頭 0x8000 (= JIS 点 0..7 の漢字ブロック) が消去され、Wasm には再生成する hook_fontrom バックエンドが無いため、点1..7 の漢字 (あ/い/う 等) が永久に欠けるのを防ぐ |

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
