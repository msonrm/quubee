# QuuBee — ディレクトリ構成と設計メモ

> 本ファイルは**現状の実装ベース**で記述。コンセプト（魂）は [concept.md](concept.md)、
> 当初構想からの変遷は [CHANGELOG.md](../CHANGELOG.md) を参照。

## 実際のディレクトリ構成

```
qb/
├── README.md
├── CLAUDE.md                # 開発者向けガイド (リファレンス機種, BIOS/DOS, ブリッジ API, Phase 3 ローダ)
├── CHANGELOG.md             # 変更履歴
├── TODO.md                  # 進捗と次ステップ
├── .gitignore
│
├── core/
│   └── np2kai/              # AZO234/NP2kai (git submodule)。build.sh が下記 patch を当てる
│
├── native/                  # C コード (bridge 層 + フロントエンドスタブ + Phase 3 DOS ローダ)
│   ├── CMakeLists.txt       # Emscripten 専用ビルド設定 (i386c/NP21 構成)
│   ├── bridge.c / bridge.h  # JS↔Wasm の主要 API + デバッグ API (qbDebug.*)
│   ├── compiler.h / compiler_base.h / np2.h / scrnmng.h / mousemng.h  # NP2kai 上書きヘッダ
│   ├── qb_scrnmng.c         # フレームバッファ管理 (RGB565)
│   ├── qb_soundmng.c/.h     # 音声出力 (リングバッファ → AudioWorklet)
│   ├── qb_mousemng.c/.h     # マウス入力 (Pointer Lock 相対移動 + 左右ボタン)
│   ├── qb_commng.c          # COM ポート / MIDI reset 周り (凍結 fix 入り)
│   ├── qb_vermouth.c        # MIDI (VERMOUTH soundfont) 配線 (既定 OFF)
│   ├── qb_joymng/sysmng/taskmng/timemng/ini/wabrly.c  # その他フロントエンドスタブ
│   ├── dos_loader.c/.h      # Phase 3: MZ/COM ローダ + PSP + MCB + EXEC/TSR + トランポリン
│   └── dos_int21.c/.h       # Phase 3: INT 21h ハンドラ群 + text VRAM 風 tty (ESC/SJIS)
│
├── emscripten/
│   └── build.sh             # patch 適用 → emcmake → emmake のローカルビルド
│
├── web/                     # ブラウザフロントエンド
│   ├── index.html           # ファイラ + Run バー UI、D&D、cmdline 入力
│   ├── player/
│   │   ├── bridge.js        # Wasm ラッパ、入力ハンドラ、表示パイプライン、Run 経路、readme/画像ビューア
│   │   ├── archive.js       # LZH (LH1/4/5/6/7 + header L0/1/2) デコーダ + ZIP (deflate) 展開
│   │   ├── diskimage.js     # ディスクイメージ→FAT12/16 取り出し (ブートせず)
│   │   ├── batscript.js     # 起動 .bat を「作者の起動レシピ」として解釈
│   │   └── magimage.js      # PC-98 .MAG (MAKI02) 画像デコーダ (NEC罫線→Unicode は bridge.js)
│   ├── assets/
│   │   ├── font.bmp         # ANK 8x16 / 漢字フォント (2048×2048 1bpp)
│   │   ├── loader.d88       # Phase 3 ローダ用ブート disk (boot.asm 8B + 残ゼロ)
│   │   ├── np2kai_boot.d88  # 自己起動最小ディスク (HELLO 待機画面)
│   │   └── freepats/        # GUS パッチ (MIDI 用、gitignore、setup_freepats.sh で展開)
│   ├── np2kai_core.js       # ビルド成果物 (gitignore)
│   └── np2kai_core.wasm     # ビルド成果物 (gitignore)
│
├── tools/                   # 開発・変換・テストツール
│   ├── img2d88.py           # PC-98 raw .img → .d88 変換
│   ├── lh5_test.js          # games/ 全 .lzh を `lha xq` と byte 比較 (lh0/lh4/lh5 × L0/L1/L2 を実書庫で網羅)
│   ├── setup_freepats.sh    # freepats (GUS パッチ ~33MB) をローカル展開
│   ├── boot_hello/          # 最小自己起動ディスク (HELLO NP2KAI 表示)
│   ├── vsync_test/          # VSYNC IRQ 配送パス確認用 boot disk
│   ├── dos_loader/          # Phase 3: boot.asm + make_d88.py + {hello,args}.com.py
│   │                        #          + hello.exe.py + sjistest.com.py + build.sh
│   ├── np2kai_patches/      # NP2kai 改変を patch 化 (build.sh が自動適用)
│   │   ├── 01_dos_loader_hooks.patch  # bios.c: トランポリン install + biosfunc case
│   │   └── 02_font_reset_fix.patch    # pccore_reset の fontrom ゼロ埋め抑止
│   └── testdata/            # テスト専用素材 (FreeDOS boot.d88 — bench_frame/diskimage_test 用。デプロイ対象外)
│
├── games/                   # テスト用アーカイブ (.lzh/.zip/.rar)。derived .fdi/.d88 は gitignore
│
└── docs/
    └── structure.md         # 本ファイル
```

## リファレンス機種

仕様書 v2 では「PC-9801VM2 をリファレンスに固定」だったが、実装は **PC-9821 系
（NP21 相当）** へ移行している（386+ 命令を要するソフトを射程に入れるため）。

| 項目 | 当時 (VM2) | QuuBee (現在の NP21 構成) |
|---|---|---|
| CPU | V30 8MHz | i386c (IA-32, 386/486 命令) |
| FPU | なし | DOSBox2 エミュレータ (486DX 相当) |
| メインメモリ | 640KB | 640KB |
| 拡張メモリ | 数MB | 32MB |
| グラフィック | 640×400 / 16色 | 同 + PEGC 256 色対応 |
| サウンド | BEEP / 一部 FM | **FM 音源 (OPNA) 実装済 → AudioWorklet**。MIDI 配線済 (既定 OFF) |
| クロック倍率 | x1 (実機) | x42 近傍 (NP2kai 既定)。※ゲーム毎の meta.json チューニングは未実装 |

## CPU エミュレータ構成

`native/CMakeLists.txt` で以下のソースを Emscripten ビルドに含めている:

- `core/np2kai/i386c/*.c` — IA-32 CPU 本体
- `core/np2kai/i386c/ia32/*.c` — IA-32 状態管理、ページング、例外
- `core/np2kai/i386c/ia32/instructions/*.c` — 命令ハンドラ
- `core/np2kai/i386c/ia32/instructions/fpu/fpemul_dosbox2.c` — 実 FPU エミュ
- `core/np2kai/i386c/ia32/instructions/{mmx,sse,...}/*.c` — 未使用 SIMD 命令スタブ (実行時 UD)

主な defines: `CPUCORE_IA32`, `IA32_REBOOT_ON_PANIC`, `IA32_PAGING_EACHSIZE`,
`SUPPORT_PC9821`, `SUPPORT_PEGC`, `SUPPORT_LARGE_MEMORY`, `SUPPORT_PC9801_119`,
`SUPPORT_IDEIO`, `SUPPORT_IDEIO_48BIT`, `SUPPORT_GAMEPORT`, `SUPPORT_CRT31KHZ`,
`USE_TSC`, `USE_FPU`, `SUPPORT_FPU_DOSBOX2`

## BIOS

本物の NEC PC-98 BIOS ROM は使用しない。NP2kai 内蔵の BIOS 実装をそのまま使う:

1. **C 実装ハンドラ** (`core/np2kai/bios/*.c`): INT 18h / 1Ah / 1Bh 等の主要サービスは C 実装。
2. **`nosyscode` + フック** (`core/np2kai/bios/bios.c`): 実 ROM が無いとき、0xE8000-0xFFFFF
   領域に最小限の合成 BIOS バイト列を配置。固定番地の NOP に CPU が到達すると `biosfunc`
   経由で C 側ハンドラへディスパッチする（この機構を Phase 3 ローダのトランポリンが流用）。
3. **NEC 著作権文字列** (`neccheck`): NEC 純正機判定で読まれる領域。

注意点: `nosyscode` がカバーしない番地への BIOS コールは合成データ領域を実行して暴走する。
FreeDOS が踏んだ `E869:075B` 暴走はこのケース。

**フォント ROM**: 本物の PC-98 フォント ROM は使用せず、`web/assets/font.bmp`
（2048×2048 1bpp BMP）を NP2kai が起動時に読み込む。漢字は標準 JIS バイト位置に格納
（tty 漢字描画はこの配置で整合、詳細は CHANGELOG 2026-06-01）。

## DOS — 2 系統

仕様書 v2 では「FreeDOS(98) を内蔵」予定だったが、現状は **完走せず**、代わりに 2 系統で動かす。

### (1) 自己起動ソフト (Phase 2)
ブートセクタから直接立ち上がるゲームは DOS 非依存で動作。`.d88`/`.fdi`/`.hdi` を
A:/B:/C:/D: スロットへ投入。NP2kai 既存のディスク・BIOS・IRQ 経路をそのまま使う。

### (2) ミニ DOS ローダ (Phase 3) — `.lzh` フリーソフト
FreeDOS の完走を待たず、`bridge` 側に **最小 DOS 互換層**を実装。"DOS を再現せず、
INT 21h を C 側で応答する" 方式:

- **トランポリン機構**: NP2kai の「BIOS 領域の NOP → `ia32_bioscall` → `biosfunc(adrs)`」
  フックを流用（0xFEE00 系番地）。NP2kai 改変は `tools/np2kai_patches/01_dos_loader_hooks.patch`。
- **ローダ** (`native/dos_loader.c`): boot disk → loader-start フック → image staging →
  PSP 構築 → CS:IP/SS:SP 書換。MZ(EXE) / COM 両対応、リロケーション、env/argv[0]。
- **INT 21h** (`native/dos_int21.c`): ~35 関数（02/06/09/0C/1A/25/2A/2C/30/35/3C-3F/40-44/
  45/46/47/48/49/4A/4B/4C/4D/4E/4F/2F/19/33 …）。ファイル I/O は Emscripten FS をバックエンドに
  ラップ。tty は text VRAM へ直書き（ANSI/ESC パーサ + SJIS 全角描画、dirty-flag 通知）。
- **メモリ管理**: 実 DOS 忠実な **MCB チェーン**（first-fit + coalesce + 分割、free-on-terminate）。
- **EXEC / TSR**: AH=4Bh EXEC（ランチャ型ゲーム: 親常駐・子を上にロード・子終了で親復帰）、
  AH=31h Keep Process（常駐音源ドライバ）。
- **アーカイブ展開は JS 側**（`web/player/archive.js`、LZH=自前 LH1/4/5/6/7 + ヘッダ L0/1/2、
  ZIP=DecompressionStream）。`libarchive.wasm` は採用せず軽量な自前デコーダで両対応（経緯は CHANGELOG）。
  未対応メソッドは throw せず該当エントリだけ skip（混在書庫でも対応分は展開）。

## 入力・サウンド・表示

- **入力**: 標準キーボード（NKEY_* へマップ）、マウス（Pointer Lock 相対移動 + 左右ボタン）。
  PC-98 固有キー（XFER/NFER/KANA/GRPH 等）とゲームパッドは未対応。
- **サウンド**: NP2kai が生成した PCM を `qb_soundmng` のリングバッファ → `postMessage` →
  `audio-worklet.js` で再生。56Hz catch-up でテンポ正規化、ソフトクリップ + vol 調整。
  FM は OPNA(opngen)。MIDI(VERMOUTH+freepats) は配線済だが音質課題で既定 OFF。
- **表示**: フレームバッファは RGB565、JS 側で RGBA32 へ変換して canvas へ。640×400。

## .gitignore（要点）

- ビルド成果物: `web/np2kai_core.{js,wasm}`, `/build/`, `core/np2kai/build/`
- derived ディスクイメージ: `games/*.{fdi,d88,hdi,nhd}`（元 zip/lzh/rar はコミット）
- Phase 3 派生物: `tools/dos_loader/{boot.bin,loader.d88,hello.com,args.com,hello.exe,sjistest.com}`
  （`web/assets/loader.d88` はブラウザが fetch するためコミット）
- `web/assets/freepats/`（~33MB、`setup_freepats.sh` で展開）
- `__pycache__/`, IDE, OS ファイル, 作業用スクショ

## 開発フェーズ

- **Phase 1 完了** ✓ — Wasm ビルド、画面表示パイプライン、FDD ブート、FreeDOS 起動（途中まで）
- **Phase 2 実質完了** ✓ — 自己起動ディスク（ロードモナーク・プリメ2）、キーボード/マウス入力、
  CPU(i386c)/FPU(DOSBox2) 拡張、ピクセルパーフェクト表示、FM 音源、A:/B: 2 ドライブ + C:/D: HDD スロット
- **Phase 3 公式 3/4 達成** ✓ — ミニ DOS ローダで `.lzh` フリーソフトを直接実行。プレイ可能:
  さめがめ / ザルバール / うさちゃん列車（+ Super Depth LZH ボーナス）。Ray IV は起動・常駐音源・
  メニューまで（オープニング完全表示は保留）。ターゲットはフロッピー 2D 〜1998 年の同人/フリーソフト
- **Phase 4 以降 (将来)** — Ray 完全表示 / 蟹味噌のテキスト面残留などの個別課題、DOS Extender、
  CD-ROM ドライバ、MIDI 音質改善、セーブ永続化、デプロイ(CI + Pages)、PWA 化、
  および **プロダクト層**（テキストビューア / 本棚 / `.qb` / Tier-1 等。詳細は [concept.md](concept.md)）

## Claude Code への引き継ぎメモ

- 開発環境: Crostini (Linux on ChromeOS, aarch64)
- Emscripten: `apt install emscripten`（バージョン 3.1.69）
- ビルドはローカル完結（CI 未設定、`bash emscripten/build.sh`）
- BIOS は自前実装（本物の NEC BIOS は使用しない）
- DOS は FreeDOS(98) 同梱だが完走しない → 自己起動ソフト + ミニ DOS ローダの 2 系統
- コンセプト: [concept.md](concept.md) ／ 仕様書 (Notion): https://www.notion.so/msonrm/QB-v2-Wasm-PC-98-36740929a47081878a5fd6740a97ada5
- 詳細は [CLAUDE.md](../CLAUDE.md) / [TODO.md](../TODO.md) / [CHANGELOG.md](../CHANGELOG.md) を参照
