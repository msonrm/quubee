#!/usr/bin/env bash
# freepats (GUS パッチセット) を web/assets/freepats/ に展開する。
# 前提: Debian/Ubuntu 系で `sudo apt install freepats` 済み
#       → /usr/share/midi/freepats/ と /etc/timidity/freepats.cfg が存在

set -euo pipefail

SRC_DIR=/usr/share/midi/freepats
SRC_CFG=/etc/timidity/freepats.cfg
DST_DIR="$(cd "$(dirname "$0")/.." && pwd)/web/assets/freepats"

if [ ! -d "$SRC_DIR" ]; then
    echo "error: $SRC_DIR が無い。apt install freepats を実行してください" >&2
    exit 1
fi
if [ ! -f "$SRC_CFG" ]; then
    echo "error: $SRC_CFG が無い" >&2
    exit 1
fi

echo "freepats を $DST_DIR に展開..."
rm -rf "$DST_DIR"
mkdir -p "$DST_DIR"

# .pat ファイル群を Tone_000/ Drum_000/ サブディレクトリごとコピー
cp -r "$SRC_DIR"/Tone_000 "$DST_DIR/"
cp -r "$SRC_DIR"/Drum_000 "$DST_DIR/"

# timidity.cfg を配置 (VERMOUTH が探すファイル名は timidity.cfg)。
# Emscripten FS では cfg を CWD (= data_dir) に、.pat を CWD/freepats/ に置く想定。
# 元 cfg の "dir /usr/share/midi/freepats" を "dir freepats" に書き換える。
sed 's|dir /usr/share/midi/freepats|dir freepats|' "$SRC_CFG" > "$DST_DIR/timidity.cfg"

# JS が並列 fetch できるようファイル一覧 (cfg + 全 .pat) を生成
cd "$DST_DIR"
{
    echo "{"
    echo "  \"cfg\": \"timidity.cfg\","
    echo "  \"pats\": ["
    find Tone_000 Drum_000 -name "*.pat" | sort | awk 'BEGIN{first=1} {if(first){first=0}else{print ","}; printf "    \"%s\"", $0} END{print ""}'
    echo "  ]"
    echo "}"
} > index.json

PAT_COUNT=$(find . -name "*.pat" | wc -l)
TOTAL_SIZE=$(du -sh . | cut -f1)
echo "完了: $PAT_COUNT 個の .pat ($TOTAL_SIZE) を $DST_DIR に配置"
echo "index.json も生成 (JS 側はこれを fetch してファイル一覧を取得)"
