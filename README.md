# QuuBee

> 読み「きゅーびー」。PC-98 = **きゅうはち** → **Q + Bee**（蜂 = はち = 八）。コードネーム/略称は **QB**。

**PC-98 のフリーソフト・同人ソフト文化を継承するための、ブラウザで動くプレイヤー。**

NEC の BIOS も MS-DOS も使わない。DOS の振る舞いはブラウザ内で再実装し（HLE-DOS）、BIOS は
実物の動作を模倣する合成実装、画面のフォントはフリーフォント由来の代替ビットマップ、
ハードウェアの再現はオープンソースのエンジン NP2kai（Wasm）が担う。
**つまり、このプレイヤーはフリーなライセンスに基づくものだけで構成されている。**
そこで動くのは、あなたの手元にあるソフト、それだけ。

QuuBee はエミュレータではない。PC-98 文化を継承し、再発見するためのツールである。

→ 思想の全体: [docs/concept.md](docs/concept.md)

## できること

- フリーソフトの書庫（`.lzh` / `.zip`）をドロップ → readme を読みながら `.EXE`/`.COM` を選んで即実行
- 作者の起動 `.bat`（音源ドライバ常駐、errorlevel 分岐入りも）を「起動レシピ」として解釈して自動起動
- 複数書庫の重ね展開（HD インストール風・パッチ当て）、セーブ等の単体ファイル Save / 読み戻し
- FM 音源・BEEP・RS-MIDI、マウス、ゲームパッド
- `.M`（PMD）の FM 音楽をタップして再生（KAJA の PMD ドライバを HLE-DOS で常駐演奏。再起動なしの曲切り替え・一時停止・経過時間）
- readme/テキストビューア（SJIS・NEC 罫線・VZ 流 %X タグリンク対応）、`.MAG` 画像ビューア
- ディスクイメージ（`.d88`/`.fdi`/`.hdm` 等）は**ブートせず**、中の FAT ファイルだけを取り出す

対象は**フロッピーベース・2D・〜1998 年ごろの PC-98 同人/フリーソフト**。

## 意図的にやらないこと

- **市販ソフトの動作は目的ではない。** ディスクイメージからブートする機構を持たないため、
  ブートを前提とする市販ソフトは原理的に動かない
- NEC BIOS / MS-DOS / NEC フォント ROM の同梱・読み込み
- ゲームの同梱・配布（動かすソフトはユーザーが持ち込む）

## しくみ

| 層 | 実装 |
|---|---|
| DOS | 実 DOS 不使用。INT 21h ほかを C 側で HLE 実装（`native/dos_loader.c` / `dos_int21.c` / `dos_xms.c` — EXEC/TSR/MCB/XMS/合成 SFT/.bat 分岐インタプリタ等） |
| BIOS | 実 ROM 不使用。NP2kai の合成 BIOS（`nosyscode` + C ハンドラ）を使用 |
| フォント | NEC フォント ROM 不使用。フリーフォント合成の `font.bmp`（修正 BSD、[CREDITS.md](CREDITS.md)） |
| ハードウェア | NP2kai（MIT）を Wasm ビルド。PC-9821 系構成（i386c CPU + FPU + PEGC）、FM 音源（fmgen）、MIDI（RS-MIDI / MPU-PC98 → TinySoundFont + SF2） |
| フロントエンド | JS のみ（`web/player/`）。LZH/ZIP 展開・ディスクイメージからの FAT 取り出し・各ビューアも自前実装 |

HLE-DOS と実 DOS との差異・未対応は [docs/dos_hle_gaps.md](docs/dos_hle_gaps.md) に体系化している。

## 開発者向け: quubee-mcp（スモークテストと計測）

QuuBee の headless 実行系は npm パッケージ
[`quubee-mcp`](https://www.npmjs.com/package/quubee-mcp) として公開している。
PC-98 homebrew / フリーソフトの開発者やエージェントが、書庫・ディスクイメージ・ディレクトリを
渡して「動く兆候・落ちる兆候」（画面・音・INT 21h 診断・状態分類）を機械可読で観察できる
MCP サーバ + ワンショット CLI:

```bash
claude mcp add quubee -- npx -y quubee-mcp
```

**QuuBee の HLE-DOS は実 DOS ではない** — 結果はスモークテストであり実機互換の証明ではない
（全応答の JSON に注意書きを同梱）。詳細は [tools/mcp/README.md](tools/mcp/README.md)。

## ドキュメント

- コンセプト（魂）: [docs/concept.md](docs/concept.md)
- 構成詳細: [docs/structure.md](docs/structure.md)
- HLE-DOS の実 DOS との差異: [docs/dos_hle_gaps.md](docs/dos_hle_gaps.md)
- 開発履歴: [CHANGELOG.md](CHANGELOG.md)
- 第三者コンポーネントの帰属: [CREDITS.md](CREDITS.md)

## ライセンス

- **配布物（`np2kai_core.wasm` を含むアプリ全体）: 寛容ライセンスの集合体（GPL なし）**（[LICENSE](LICENSE)）。
  FPU は GPL の DOSBox 由来ではなく BSD の Berkeley SoftFloat 3e を使い、コピーレフト部品をビルドに含めない。
- **QuuBee 独自のソース**（`native/` の `qb_*`/`bridge`/`dos_*`、`web/player/`、`tools/`、`emscripten/`、`docs/` 等、
  msonrm 著作の部分）は **MIT**（[LICENSE-MIT](LICENSE-MIT)）。
- 第三者コンポーネントの内訳（NP2kai=MIT / i386c=BSD / SoftFloat3 FPU=BSD-3 / fmgen=cisc 独自(フリーソフト配布) /
  font.bmp=修正BSD）は [CREDITS.md](CREDITS.md)。
- 「著作権クリーン」は NEC BIOS / MS-DOS 等の proprietary を**同梱しない**こと、加えて配布バイナリ内の各部品
  ライセンスが相互に整合していること（2026-06-26 に GPL 部品を除去して整合化。経緯は CREDITS.md）。
