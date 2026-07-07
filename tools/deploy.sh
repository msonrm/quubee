#!/bin/bash
# QuuBee 静的デプロイ用ディレクトリ dist/ を生成する。
#   - wasm/js が無ければ emscripten ビルド (bash emscripten/build.sh)
#   - web/ を dist/ へ複製。
#     MIDI 用 soundfont (web/assets/soundfont.sf2、GeneralUser GS ~32MB) は同梱する (本番でも MIDI が
#     鳴るように。遅延 on-demand なので MIDI ゲーム起動時のみ初回 DL され、非 MIDI ユーザーは取得しない)。
#     無ければ tools/setup_soundfont.sh で取得してから deploy すること。
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

# HLE FEP の Mozc-Wasm (mozc_qb.js/.wasm + 辞書 mozc.data ~19MB、gitignore)。無いまま deploy すると
# 本番 FEP がカナ変換のみに縮退する (MIDI の soundfont と同じ罠)。ビルドは ~/development/mozc-wasm-build/README.md。
# mozc.data は 25MiB 未満なので分割不要。
for f in assets/mozc_qb.js assets/mozc_qb.wasm assets/mozc.data; do
    [ -f "$DIST/$f" ] || echo "⚠ 警告: web/$f が無い — 本番 FEP のかな漢字変換が無効になります"
done

# 同梱バイナリ (font.bmp=修正BSD / soundfont.sf2 / PMD / リズム音色) の帰属・ライセンス全文を
# 公開ビルドにも届ける。BSD のバイナリ再配布条項 (著作権表示を「頒布物に付属する材料」に再現する)
# を、サイト自身が CREDITS.md + licenses/ を配ることで満たす。歓迎パネルの「CREDITS.md」リンクの実体。
cp CREDITS.md "$DIST/CREDITS.md"
cp -rL licenses "$DIST/licenses"

# Cloudflare Pages は 1 ファイル 25MiB 上限。soundfont.sf2 (GeneralUser GS ~31MB) は超えるので、
# 16MiB ごとに soundfont.sf2.00/.01… へ分割し、単一ファイルは dist から除く。
# ブラウザ側 (bridge.js ensureMidiLoaded) は単一が無ければ連番パートを 404 まで連結する。
SF2="$DIST/assets/soundfont.sf2"
if [ -f "$SF2" ] && [ "$(stat -c%s "$SF2")" -gt 26214400 ]; then
    echo "soundfont.sf2 を 16MiB 分割 (Pages 25MiB 上限対応)..."
    split -d -b 16m "$SF2" "$SF2."           # → soundfont.sf2.00, soundfont.sf2.01, ...
    rm -f "$SF2"
    # マニフェスト soundfont.json にパート名一覧を書く。重要: Pages は存在しないパスにも 200+HTML を
    # 返すため、ブラウザは「404 まで連番取得」では終端判定できず無限ループになる。マニフェストで個数を確定する。
    {
        echo -n '{"parts":['
        first=1
        for p in $(cd "$DIST/assets" && ls soundfont.sf2.* | sort); do
            [ "$first" = 1 ] && first=0 || echo -n ','
            echo -n "\"$p\""
        done
        echo ']}'
    } > "$DIST/assets/soundfont.json"
    echo "  分割: $(cd "$DIST/assets" && ls soundfont.sf2.* | tr '\n' ' ') / manifest: $(cat "$DIST/assets/soundfont.json")"
fi

echo "dist 生成: $DIST ($(du -sh "$DIST" | cut -f1))"
echo "アップロード: npx wrangler pages deploy $DIST --project-name quubee --branch main --commit-dirty=true --commit-message \"QuuBee deploy\""
echo "  (--commit-message は ASCII 必須。日本語の git コミットメッセージだと Cloudflare API が 8000111 で弾く)"
