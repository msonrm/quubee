#!/usr/bin/env bash
# MIDI 用サウンドフォント (GeneralUser GS) を web/assets/soundfont.sf2 に取得する。
#
# QuuBee の MIDI 合成は TinySoundFont (native/qb_tsf.c) が SF2 をネイティブ再生する。
# 音色は GeneralUser GS v2 (S. Christian Collins、再配布可の寛容ライセンス。詳細は CREDITS.md)。
# ~32MB と大きいのでリポジトリには含めず (.gitignore)、このスクリプトで取得する。
# ブラウザは遅延 on-demand で fetch (MIDI ゲーム起動時のみ)、deploy.sh は dist へ同梱する。
#
# 別の SF2 を使いたい場合は、好きな soundfont を web/assets/soundfont.sf2 に置けばよい
# (TSF が読める SF2 なら何でも可。コード変更不要)。

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST="$ROOT/web/assets/soundfont.sf2"
URL="https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2"

if [ -f "$DST" ]; then
    echo "既に存在: $DST ($(du -h "$DST" | cut -f1))"
    echo "再取得するには先に削除してください。"
    exit 0
fi

echo "GeneralUser GS を取得中 → $DST ..."
mkdir -p "$(dirname "$DST")"
curl -fL --retry 2 "$URL" -o "$DST"

# 健全性チェック: SF2 は RIFF コンテナ (先頭 "RIFF")。
if [ "$(head -c 4 "$DST")" != "RIFF" ]; then
    echo "error: 取得したファイルが SF2 (RIFF) ではありません。削除します。" >&2
    rm -f "$DST"
    exit 1
fi
echo "完了: $DST ($(du -h "$DST" | cut -f1))"
