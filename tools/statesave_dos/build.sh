#!/bin/bash
# statesave_dos_test の COM を組み直す (nasm)。生成物 (*.COM) もコミットしておく (テストは nasm 不要)。
set -euo pipefail
cd "$(dirname "$0")"
for a in w f l x tsr child m; do nasm -f bin -o "$(echo $a | tr a-z A-Z).COM" "$a.asm"; done
ls -la *.COM
