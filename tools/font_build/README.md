# font_build — `web/assets/font.bmp` の再生成パイプライン

QuuBee が同梱する `web/assets/font.bmp` を、素材から再生成するための一式。**ビルド時のみ**使い、
ここの中身（`node_modules/` 除く）は配布物 (`dist/`) には入らない。

## なぜ再生成するのか

素材の **SimK 版 font.bmp**（さざなみ + 東雲 + 美咲 + M+ + Ayu + Oradano + Kappa + NP2 内蔵の合成、
修正 BSD）は、漢字に **最大 1px のランダムな縦ズレ**がある（複数フォントの寄せ集めでベースラインが不揃い）。
これを **東雲フォント (Shinonome, Public Domain) で全二バイトグリフを上書きして縦位置を揃える**のが
irori 氏の np2-wasm `adjust-fontbmp` の手法。さらに QuuBee は **JIS 区8 罫線**を付加する（下記）。

## 2 段階パイプライン

```
base/base.bmp (SimK 版)  ──┐
shnmk16.bdf (東雲 漢字)   ──┤  ① makefont.cjs    → font.bmp (縦位置補正版 = irori 版と同一)
                            │     (二バイト JIS を東雲で上書き・縦位置正規化)
                            ▼
                      web/assets/font.bmp へコピー
                            │
                            ▼  ② tools/gen_keisen_glyphs.py  → 区8 点1-32 を注入 (in-place)
                      web/assets/font.bmp (最終)
```

### 実行手順

```bash
cd tools/font_build
npm install                       # bdf パーサ (github:erkkah/BDF.js, MPL2.0, build-time only)
node makefont.cjs                 # → tools/font_build/font.bmp を生成
cp font.bmp ../../web/assets/font.bmp
cd ../..
python3 tools/gen_keisen_glyphs.py   # → web/assets/font.bmp の区8ストリップに罫線を注入
```

`makefont.cjs` の出力は irori の `adjust-fontbmp` ブランチの `font/font.bmp` と **md5 一致** (再現確認済み)。

## JIS 区8 罫線について（重要）

区8（全角罫線、罫線素片）は **JIS X 0208-1983 で追加**されたもので、**JIS78 ベースの NEC PC-98 実機
ROM には無い**（実機の箱描画は区9-11 の NEC 半角グラフィック側を使う）。SimK 版も irori 版も区8 は空
(0/32) で、これは**実機 faithful**（バグではない）。

QuuBee は JIS83 区8 を前提に書く一部ソフト（VZ Editor の `GAME` 等）を動かすため、区8 を
`gen_keisen_glyphs.py` で**幾何形状から自前生成して付加する**＝「厳密な実機再現」ではなく、
「フリーソフトを再体験するプレイヤー」という QuuBee の立場での**意図的な拡張**。

> **上流追従の注意**: `base/base.bmp` を新しい SimK 版に差し替えたら、① makefont.cjs → ② gen_keisen の
> 順で再生成すること（区8 は in-place 注入なので makefont の出力には含まれず、毎回②が必要）。

## 素材とライセンス

| ファイル | 中身 | ライセンス | 配布物に入るか |
|---|---|---|---|
| `base/base.bmp` | SimK 版 font.bmp（合成済み） | 修正 BSD (SimK, Nekosan dev team) | （加工後の `font.bmp` として入る） |
| `base/README2.TXT` | SimK 版の README + ライセンス全文 | 修正 BSD | いいえ |
| `shnmk16.bdf` | 東雲 16dot 漢字 (JIS X 0208) | **Public Domain** (古川泰之 / efont) | いいえ |
| `shnm8x16a.bdf` `shnm8x16r.bdf` | 東雲 8x16 ANK（makefont では未使用・参考同梱） | Public Domain | いいえ |
| `makefont.cjs` | 縦位置補正の生成スクリプト | **BSD-3-Clause** (irori / np2-wasm, NP2 developer team) | いいえ |
| `package.json` → `bdf` | BDF パーサ `erkkah/BDF.js` | MPL 2.0（build-time のみ） | いいえ |

帰属表示は `CREDITS.md`「フォント」節 + `licenses/fonts/`（東雲ほか各フォントの原文）に集約。

## 出典

- irori / np2-wasm `adjust-fontbmp`: https://github.com/irori/np2-wasm/tree/adjust-fontbmp/font
- 東雲フォント: http://openlab.ring.gr.jp/efont/shinonome/
- SimK 版 font.bmp: Neko Project 21/W 同梱（`base/README2.TXT` 参照）
