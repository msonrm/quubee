#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
        echo "  WARN: cannot apply (conflict?): $(basename "$p")"
    fi
done

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
