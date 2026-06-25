# licenses/ — 第三者アセットのライセンス全文 (NOTICE)

QuuBee が **バイナリで同梱・配布する** 第三者アセットの、配布元ライセンス／帰属文の原本。
全体の要約と素性の説明は [`../CREDITS.md`](../CREDITS.md)。ここはその一次資料（改変せず温存）。

デプロイ（`tools/deploy.sh`）はこのディレクトリと `CREDITS.md` を公開ビルド `dist/` に複製するので、
**公開サイト自身が同梱アセットの帰属表示を伴う**（修正 BSD の「バイナリ再配布時に著作権表示を頒布物に
付属する材料に再現する」条項を満たすため）。

## fonts/ — `web/assets/font.bmp` の構成フォント

`font.bmp` は「さざなみフォント＋東雲／美咲／M+／Ayu／Oradano／Kappa＋Neko Project II 内蔵グリフ」を
組んだ代替ビットマップ（配布元 Nekosan 開発チームの宣言で全体は修正 BSD）。各構成フォントの個別
ライセンス／README を温存する（出典: `sazanami-fontbmp.zip` の `doc/`、原本の文字コードのまま）:

| ファイル | 対象 |
|---|---|
| `nekosan-fontbmp-README2.txt` | `font.bmp` 本体（SimK / Nekosan dev team）の説明・修正 BSD |
| `sazanami-fontbmp-README.txt` | さざなみ由来 fontbmp の README |
| `ayu-README.txt` | Ayu フォント |
| `kappa-README.txt` | Kappa フォント |
| `misaki-misakib8.txt` | 美咲フォント |
| `mplus-LICENSE_J.txt` | M+ FONTS |
| `oradano-README.txt` | Oradano 明朝 |
| `shinonome-LICENSE.txt` | 東雲フォント |

いずれも自由に再配布可能なライセンス。

## soundfont-GeneralUser-GS-LICENSE.txt

`web/assets/soundfont.sf2`（GeneralUser GS v2, S. Christian Collins）のライセンス全文（License v2.0）。
SF2 本体は ~32MB のためリポジトリには非同梱（`tools/setup_soundfont.sh` で取得）だが、ライセンス全文は
ここに温存し、デプロイにも同梱して SF2 本体と一緒に公開ビルドへ届ける。
