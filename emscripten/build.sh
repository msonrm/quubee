#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# NP2kai サブモジュールへの qb 固有パッチを適用 (未適用の場合のみ)。
# 詳細は tools/np2kai_patches/README.md を参照。
if ! grep -q "qb_dos_install_trampolines" core/np2kai/bios/bios.c 2>/dev/null; then
    echo "Applying NP2kai patches..."
    for p in tools/np2kai_patches/*.patch; do
        [ -f "$p" ] || continue
        (cd core/np2kai && git apply "../../$p")
        echo "  applied: $p"
    done
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
