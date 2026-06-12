#!/bin/bash
# QuuBee 静的デプロイ用ディレクトリ dist/ を生成する。
#   - wasm/js が無ければ emscripten ビルド (bash emscripten/build.sh)
#   - web/ を dist/ へ複製。
#     MIDI 用 freepats (~33MB) は同梱する (本番でも MIDI が鳴るように。遅延 on-demand なので
#     MIDI ゲーム起動時のみ初回 DL され、非 MIDI ユーザーは取得しない)。
#     *.map は除外。テスト専用素材 (FreeDOS boot.d88) は tools/testdata/ にあり web/ に入れない。
#
# 生成後のアップロード (Cloudflare Pages、ドメイン不要 → quubee.pages.dev):
#   npx wrangler login                                              # 初回のみ (ブラウザ認証)
#   npx wrangler pages deploy dist --project-name quubee --branch main
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DIST="${1:-dist}"

if [ ! -f web/np2kai_core.wasm ] || [ ! -f web/np2kai_core.js ]; then
    echo "wasm が無いのでビルドします (emscripten)..."
    bash emscripten/build.sh
fi

rm -rf "$DIST"
mkdir -p "$DIST"
cp -rL web/. "$DIST/"                                    # -L: symlink は実体化 (現状 web/ に無し)
find "$DIST" -name '*.map' -delete

echo "dist 生成: $DIST ($(du -sh "$DIST" | cut -f1))"
echo "アップロード: npx wrangler pages deploy $DIST --project-name quubee --branch main --commit-dirty=true --commit-message \"QuuBee deploy\""
echo "  (--commit-message は ASCII 必須。日本語の git コミットメッセージだと Cloudflare API が 8000111 で弾く)"
