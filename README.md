# QuuBee

> 読み「きゅーびー」。PC-98 = **きゅうはち** → **Q + Bee**（蜂 = はち = 八）。コードネーム/略称は **QB**。

**PC-98 のフリーソフト文化を、罪悪感なく継承・再体験できるブラウザプレイヤー。**

NEC BIOS も MS-DOS も使わず（HLE-DOS + 合成 BIOS + MIT の NP2kai）、書庫ファイルをドロップすれば、
あの頃のように、すぐ遊べる。「PC-98 を忠実に再現する」のではなく、**機械ではなくソフトを継承する**。

→ コンセプト全体: [docs/concept.md](docs/concept.md)

## 現在のリファレンス機種

**PC-9821 系（NP21 相当）** をベース構成として採用:

| 項目 | 構成 |
|---|---|
| CPU | i386c (IA-32) — 386/486 相当の命令セット |
| FPU | DOSBox2 エミュレータ (i486DX 相当) |
| メインメモリ | 640KB conventional |
| 拡張メモリ | 32MB (NP2kai 上限近く) |
| グラフィック | テキスト VRAM 80×25 / 640×400 グラフィック / PEGC 対応 |
| サウンド | **FM 音源 (OPNA / opngen) を AudioWorklet で再生**。テンポ正規化・音質チューニング済み。MIDI (VERMOUTH) は配線済だが既定 OFF |

**386+ 命令を要する近代 PC-98 ソフトのカバレッジを優先**し、PC-9821 系（NP21 相当）を採用している。

## BIOS と DOS の現状

- **BIOS**: NP2kai の最小内蔵 BIOS（`nosyscode` + C 実装ハンドラ群）を使用。
  本物の NEC `bios.rom` は同梱しない（著作権クリーンを維持）。フォントは
  自前 BMP（`web/assets/font.bmp`）で代替。
- **DOS**: FreeDOS(98) は HMA 初期化までは到達するが、最小 BIOS がカバーしない
  番地（`E869:075B`）に飛び込んで完走しない。これに対し 2 つの経路でゲームを動かす:
  - **自己起動ソフト**（ブートセクタから直接立ち上がるゲーム）は DOS 非依存で動作（Phase 2）。
  - **`.lzh` フリーソフト**は、DOS を起動せず **自前のミニ DOS ローダ**で直接 `.EXE`/`.COM`
    を実行する（Phase 3、下記）。

## ミニ DOS ローダ（Phase 3 の中核）

FreeDOS の完走を待たず、`bridge` 側に最小限の DOS 互換層を実装。ブラウザで `.lzh`
をドロップすると中の `.EXE`/`.COM` を即実行できる（"DOS を再現せず INT 21h だけ C で応答"）:

- **LZH/ZIP 展開**（JS、`web/player/archive.js`）→ Emscripten FS へ配置
- **MZ/COM ローダ** + PSP 構築 + リロケーション（`native/dos_loader.c`）
- **INT 21h ハンドラ ~35 関数**（ファイル I/O / メモリ / vector / date / EXEC / TSR / tty …、`native/dos_int21.c`）
- **MCB チェーン**メモリマネージャ、**AH=4Bh EXEC**（ランチャ型ゲーム）、**AH=31h TSR**（常駐ドライバ）
- NP2kai の NOP→`biosfunc` フックを使ったトランポリン機構（NP2kai 改変は `tools/np2kai_patches/` に patch 化）

## 開発状況

- **Phase 1 完了** ✓ — Wasm ビルド、画面表示パイプライン、FDD ブート、FreeDOS 起動（途中まで）
- **Phase 2 実質完了** ✓ — 自己起動 PC-98 ディスク（ロードモナーク・プリンセスメーカー 2 枚組）、
  キーボード/マウス入力、CPU(i386c)/FPU(DOSBox2) 拡張、FM 音源、A:/B: 2 ドライブ + C:/D: HDD スロット、
  ピクセルパーフェクト表示
- **Phase 3 公式 3/4 達成** ✓ — ミニ DOS ローダで `.lzh` フリーソフトを直接実行。
  プレイ可能: **さめがめ / ザルバール / うさちゃん列車**（公式 3/4）＋ Super Depth LZH（ボーナス）。
  Ray IV は起動・常駐音源・FM 音楽・メニューまで（オープニング完全表示は保留）

詳細は [CHANGELOG.md](CHANGELOG.md) / [TODO.md](TODO.md) を参照。

## ビルド & 実行

```bash
bash emscripten/build.sh        # NP2kai patch 自動適用 → emcmake → emmake
emrun --port 8080 web/
```

Phase 3 ローダ disk + テスト COM の再生成: `bash tools/dos_loader/build.sh`

## ドキュメント

- コンセプト: [docs/concept.md](docs/concept.md) ／ 仕様書 (Notion): https://www.notion.so/msonrm/QB-v2-Wasm-PC-98-36740929a47081878a5fd6740a97ada5
- 開発者向けガイド: [CLAUDE.md](CLAUDE.md)
- 構成詳細: [docs/structure.md](docs/structure.md)
- 進捗: [CHANGELOG.md](CHANGELOG.md) / [TODO.md](TODO.md)

## ライセンス

- **配布物（`np2kai_core.wasm` を含むアプリ全体）: GNU GPL v2 or later**（[LICENSE](LICENSE)）。
  同梱する DOSBox 由来の FPU エミュレータ（`fpemul_dosbox*.c`, GPLv2-or-later）が結合物全体に GPL を及ぼすため。
- **QuuBee 独自のソース**（`native/` の `qb_*`/`bridge`/`dos_*`、`web/player/`、`tools/`、`emscripten/`、`docs/` 等、
  msonrm 著作の部分）は **`MIT OR GPL-2.0-or-later` のデュアル**（[LICENSE-MIT](LICENSE-MIT)）。FPU を除けば MIT 部分のみで再利用可。
- 第三者コンポーネントの内訳（NP2kai=MIT / i386c=BSD / DOSBox FPU=GPLv2 / font.bmp=修正BSD / FreeDOS=GPL）は [CREDITS.md](CREDITS.md)。
- 「著作権クリーン」は NEC BIOS / MS-DOS 等の proprietary を**同梱しない**意味で、GPL（オープンソース）は公開ホスティングと両立する。
