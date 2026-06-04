#!/bin/bash
# boot_busy.asm を nasm でアセンブルし、PC-98 2HD d88 (busy.d88) を再生成する。
# busy.d88 は CPU 飽和ベンチ (bench_multiple.js / test_autoclock.js) の題材。
# d88 化は boot_hello の make_d88.py を再利用 (cyl0/head0/sec1 にブートセクタ)。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
nasm -f bin "$HERE/boot_busy.asm" -o "$HERE/boot_busy.bin"
python3 "$HERE/../boot_hello/make_d88.py" "$HERE/boot_busy.bin" "$HERE/busy.d88"
echo "OK → tools/bench_cpu/busy.d88"
