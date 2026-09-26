#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Emscripten は 3.1.69 を前提にしている (apt 版)。手順書 (2026-09 の調査) によれば 6.0 系では
# NP2kai 5939e0c6 の cbus/boardlol.c が incompatible-pointer でエラーになる。違う版でも止めはしない。
EMCC_WANT="3.1.69"
EMCC_HAVE="$(emcc --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [ "$EMCC_HAVE" != "$EMCC_WANT" ]; then
    echo "WARNING: emcc ${EMCC_HAVE:-not found} (想定は $EMCC_WANT)。ビルドや挙動が変わる可能性があります。" >&2
fi

# NP2kai サブモジュールへの qb 固有パッチを per-patch 冪等で適用。
# 詳細は tools/np2kai_patches/README.md を参照。
echo "Applying NP2kai patches..."
for p in tools/np2kai_patches/*.patch; do
    [ -f "$p" ] || continue
    if (cd core/np2kai && git apply --reverse --check "../../$p") 2>/dev/null; then
        echo "  skip (already applied): $(basename "$p")"
    elif (cd core/np2kai && git apply --check "../../$p") 2>/dev/null; then
        (cd core/np2kai && git apply "../../$p")
        echo "  applied: $(basename "$p")"
    else
        # build.sh は正典の再現経路。パッチが当たらないまま続行すると、その修正を欠いた
        # バイナリが黙って出来てしまう (例: RTC Y2K クランプ漏れ)。必ず hard fail させる。
        echo "  ERROR: cannot apply (conflict?): $(basename "$p")" >&2
        echo "  → core/np2kai が想定 base からズレています。サブモジュールを確認してください。" >&2
        exit 1
    fi
done

# ステートセーブの互換識別子 (フェーズ 2)。NP2kai の statsave は構造体をそのまま書くので、NP2kai の
# コミットかパッチ一式が変われば古いセーブは読めない (読めても誤読しうる)。その組を識別子にして
# セーブのヘッダに書き、合わないセーブは読み込み前に断る。QB_BUILD_REV は表示・調査用の QuuBee の版。
# 中身が変わったときだけ書き換える (毎回書くと bridge.c が毎回再コンパイルされる)。
NP2_COMMIT="$(git -C core/np2kai rev-parse HEAD 2>/dev/null || echo unknown)"
PATCH_HASH="$(cat tools/np2kai_patches/*.patch | sha256sum | cut -c1-16)"
QB_REV="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)$(git diff --quiet HEAD -- native web tools/np2kai_patches 2>/dev/null || echo -dirty)"
BUILD_ID_NEW="$(printf '/* 生成物 (emscripten/build.sh)。コミットしない */\n#define QB_NP2KAI_COMPAT_ID \"np2kai-%s+p%s\"\n#define QB_BUILD_REV \"%s\"\n' "${NP2_COMMIT:0:12}" "$PATCH_HASH" "$QB_REV")"
if [ "$(cat native/qb_build_id.h 2>/dev/null)" != "$BUILD_ID_NEW" ]; then
    printf '%s\n' "$BUILD_ID_NEW" > native/qb_build_id.h
fi

# --clean で再configure
if [[ "${1:-}" == "--clean" ]]; then
    rm -rf build/wasm
fi

# Makefileがなければconfigureから実行
if [ ! -f build/wasm/Makefile ]; then
    emcmake cmake -S native -B build/wasm
fi

emmake make -C build/wasm -j"$(nproc)"

mkdir -p web
cp build/wasm/np2kai_core.js   web/
cp build/wasm/np2kai_core.wasm web/

echo "Build OK → web/np2kai_core.{js,wasm}"
echo "Run: emrun --no_browser --port 8080 web/index.html"
