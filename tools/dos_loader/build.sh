#!/usr/bin/env bash
# Phase 3 ローダ用ブート disk + テスト COM 一式をビルド
set -euo pipefail
cd "$(dirname "$0")"

nasm -f bin boot.asm -o boot.bin
python3 make_d88.py boot.bin loader.d88
python3 hello.com.py hello.com
python3 args.com.py args.com
python3 hello.exe.py hello.exe
python3 sjistest.com.py sjistest.com   # SJIS 漢字描画の単離検証 (ANK/半角カナ/全角)

# web/assets/ に loader.d88 を配置 (bridge.js が fetch する)
cp loader.d88 ../../web/assets/loader.d88

echo "OK: tools/dos_loader/{boot.bin,loader.d88,hello.com,args.com,hello.exe,sjistest.com} + web/assets/loader.d88"
