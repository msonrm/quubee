#!/bin/bash
# asan_check.sh — AddressSanitizer 入りの別ビルドでテストを回す (use-after-free・範囲外書き込みの検出)。
#
# きっかけ (2026-09-27): statsave のロードで破棄した MIDI ハンドルが音声ストリームに登録されたまま残り、
# 解放済みメモリを読み書きしていた。普段はたまたま動き、順序によってだけヒープが壊れて malloc が止まった。
# こういう壊れ方は普通のビルドでは「たまに止まる」としか見えないので、疑わしいときはこれで回す。
#
# native/ を作業ディレクトリへ写し、リンクに -fsanitize=address (+ 関数名・大きめの初期メモリ)、
# コンパイルに -fsanitize=address を足してビルドする。tools/lib・web・指定したテスト・games を並べ、
# テストはその写しの上で走る (本物の web/ は触らない)。ASan が見つけるとプロセスが exit(1) で終わる
# (Machine の quiet 既定では報告の本文は捨てられるので、見るときはテスト側で quiet:false にする)。
#
# 使い方: bash tools/asan_check.sh <テスト名 (tools/ 以下の .js、拡張子なし)>... [ -w 作業ディレクトリ ]
#   例: bash tools/asan_check.sh statesave_test statesave_rsmidi_test
# 前提: 先に bash emscripten/build.sh 済み (NP2kai のパッチ適用と native/qb_build_id.h)。2 回目以降は差分ビルド。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=/tmp/qb_asan
TESTS=()
while [ $# -gt 0 ]; do
    case "$1" in
        -w) WORK="$2"; shift 2 ;;
        *) TESTS+=("$1"); shift ;;
    esac
done
[ ${#TESTS[@]} -gt 0 ] || { echo "使い方: bash tools/asan_check.sh <テスト名>... [-w 作業ディレクトリ]"; exit 2; }
echo "work: $WORK"
mkdir -p "$WORK"
rm -rf "$WORK/native.new" && cp -r "$ROOT/native" "$WORK/native.new"
sed -i "s#^set(NP2 .*#set(NP2 $ROOT/core/np2kai)#" "$WORK/native.new/CMakeLists.txt"
# 最初の target_link_options の -O3 の次の行に足す
sed -i '0,/^    -O3 /{/^    -O3 /a\    --profiling-funcs\n    -fsanitize=address\n    -sINITIAL_MEMORY=512MB\n    -sERROR_ON_UNDEFINED_SYMBOLS=0
}' "$WORK/native.new/CMakeLists.txt"
sed -i '/^target_compile_options(np2kai_core PRIVATE/a\    -fsanitize=address' "$WORK/native.new/CMakeLists.txt"
grep -q -- '-fsanitize=address' "$WORK/native.new/CMakeLists.txt"
# 変わったファイルだけ差し替える (make の差分ビルドを生かす)
mkdir -p "$WORK/native"
(cd "$WORK/native.new" && find . -type f) | while read -r f; do
    cmp -s "$WORK/native.new/$f" "$WORK/native/$f" || { mkdir -p "$(dirname "$WORK/native/$f")"; cp "$WORK/native.new/$f" "$WORK/native/$f"; }
done
rm -rf "$WORK/native.new"
if [ ! -f "$WORK/build/Makefile" ]; then emcmake cmake -S "$WORK/native" -B "$WORK/build" > "$WORK/cmake.log"; fi
emmake make -C "$WORK/build" -j"$(nproc)" > "$WORK/make.log" || { tail -20 "$WORK/make.log"; exit 1; }

rm -rf "$WORK/web" "$WORK/tools"
mkdir -p "$WORK/tools"
cp -r "$ROOT/tools/lib" "$WORK/tools/lib"
cp -r "$ROOT/web" "$WORK/web"
cp "$WORK/build/np2kai_core.js" "$WORK/build/np2kai_core.wasm" "$WORK/web/"
for d in "$ROOT"/tools/*/; do   # テストが読む素材 (statesave_dos/ 等)
    n=$(basename "$d"); [ "$n" = lib ] || [ "$n" = mcp ] || cp -r "$d" "$WORK/tools/$n"
done
[ -e "$ROOT/games" ] && ln -sfn "$ROOT/games" "$WORK/games"

rc=0
for t in "${TESTS[@]}"; do
    cp "$ROOT/tools/$t.js" "$WORK/tools/"
    if (cd "$WORK" && node "tools/$t.js" > "$WORK/$t.log" 2>&1); then r=0; else r=$?; rc=1; fi
    echo "$t: exit $r / ASan の報告 $(grep -c 'ERROR: AddressSanitizer' "$WORK/$t.log" || true) 件 / $(tail -1 "$WORK/$t.log")"
done
exit $rc
