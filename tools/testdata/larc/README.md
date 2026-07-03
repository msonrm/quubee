# LArc テスト書庫 (tools/larc_test.js 用)

`web/player/archive.js` の LArc デコーダ (`-lz5-` / `-lzs-` / `-lz4-`) の回帰テスト用
fixture。本物の LArc / 旧世代アーカイバで作られた書庫で、`-lz5-`/`-lzs-` の
ビットストリームとリングバッファ初期化を実データで検証する。

## 出所

Simon Howard の [Lhasa](https://github.com/fragglet/lhasa) プロジェクトの
テストスイート (`test/archives/`) から抜粋。Lhasa 本体は ISC ライセンス、
これらのテスト書庫も同梱の再配布可能な素材 (中身は GPL-2 ライセンス文書等)。

| ファイル | 元 | method | 内容 |
|---|---|---|---|
| `initial.lzs` | `test/archives/larc333/initial.lzs` | -lz5- | 初期リングバッファ (fill_initial) 参照データ |
| `lz5.lzs`     | `test/archives/larc333/lz5.lzs`     | -lz5- | GPL-2 テキスト (長コピー多用) |
| `lzs.lzs`     | `test/archives/generated/lzs/lzs.lzs` | -lzs- | 同 GPL-2 を旧 -lzs- で圧縮 |
| `lz4.lzs`     | `test/archives/lengths/lz5-1.lzs`   | -lz4- | 1 byte (無圧縮 = stored) |

## オラクル

期待値 (md5) は Debian の `lhasa` (= 同 Lhasa の CLI, 独立実装) で展開した
バイト列から取得。`tools/larc_test.js` はその md5 と自前デコーダの出力を突合する。
デプロイ対象外 (テスト専用)。
