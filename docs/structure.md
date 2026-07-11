# QuuBee — ディレクトリ構成と設計メモ

> 本ファイルは**現状の実装ベース**で記述。コンセプト（魂）は [concept.md](concept.md)、
> 当初構想からの変遷は [CHANGELOG.md](../CHANGELOG.md) を参照。

## 実際のディレクトリ構成

```
qb/
├── README.md
├── CLAUDE.md                # 開発者向けガイド (リファレンス機種, BIOS/DOS, ブリッジ API, ビルド)
├── CHANGELOG.md             # 変更履歴
├── TODO.md                  # 進捗と次ステップ
├── CREDITS.md               # 第三者コンポーネントの帰属・ライセンス
├── LICENSE / LICENSE-MIT    # 配布物=寛容ライセンス集合体(GPLなし) / 独自コード MIT
├── licenses/                # 同梱第三者アセットのライセンス全文 (fonts/・SF2・GPL-2.0 退避)
├── .gitignore
│
├── core/
│   └── np2kai/              # AZO234/NP2kai (git submodule)。build.sh が下記 patch を当てる
│
├── native/                  # C コード (bridge 層 + フロントエンドスタブ + HLE-DOS)
│   ├── CMakeLists.txt       # Emscripten 専用ビルド設定 (i386c/NP21 構成、compile -O2 / link -O3)
│   ├── bridge.c / bridge.h  # JS↔Wasm の主要 API + デバッグ API (qbDebug.*)
│   ├── compiler.h / compiler_base.h / np2.h / scrnmng.h / mousemng.h  # NP2kai 上書きヘッダ
│   ├── qb_scrnmng.c         # フレームバッファ管理 (RGB565)
│   ├── qb_soundmng.c/.h     # 音声出力 (pull 型 — JS の DAC コールバックが直接汲む)
│   ├── qb_mousemng.c/.h     # マウス入力 (Pointer Lock 相対移動 + 左右ボタン)
│   ├── qb_commng.c          # COM ポート — RS-MIDI/MPU-PC98 を MIDI 合成器へ結線
│   ├── qb_tsf.c             # MIDI 合成 = TinySoundFont で SF2 をネイティブ再生 (+全体リバーブ)
│   ├── qb_vermouth.c        # MIDI モジュール (= ロード済 SF2) のライフサイクル薄層
│   ├── third_party/tsf.h    # TinySoundFont (MIT, 単一ヘッダ SF2 シンセ)
│   ├── qb_guestmem.h        # ゲストメモリ共有ヘルパ (VRAM 窓は正規 CPU 経路で読み書き)
│   ├── qb_joymng/sysmng/taskmng/timemng/ini/wabrly.c  # その他フロントエンドスタブ
│   ├── dos_loader.c/.h      # HLE-DOS: MZ/COM ローダ + PSP/MCB + EXEC/TSR + .bat 分岐インタプリタ
│   ├── dos_int21.c/.h       # HLE-DOS: INT 21h/29h ハンドラ群 + text VRAM 風 tty (ESC/SGR/SJIS)
│   ├── dos_xms.c/.h         # XMS 3.0 Tier-1 HLE (HIMEM 相当、EMB は実拡張メモリに確保)
│   └── dos_shell_blob.h     # ミニ COMMAND.COM (shell.asm) のバイナリ blob (build.sh 生成・コミット)
│
├── emscripten/
│   └── build.sh             # patch 適用 → emcmake → emmake のローカルビルド
│
├── web/                     # ブラウザフロントエンド (JS のみ・ここがプロダクト層)
│   ├── index.html           # ファイラ + Run バー UI、歓迎文、宣言 (About)、ビューアモーダル
│   ├── player/
│   │   ├── bridge.js        # Wasm ラッパ、入力 (キー/マウス/パッド)、表示、音声 glue、Run 経路、ビューア
│   │   ├── archive.js       # LZH (LH1/4/5/6/7 + header L0/1/2) デコーダ + ZIP (deflate) 展開
│   │   ├── diskimage.js     # ディスクイメージ→FAT12/16 ファイル取り出し (ブートせず)
│   │   ├── batscript.js     # 起動 .bat を「作者の起動レシピ」として解釈 (if/goto は C 側と分担)
│   │   ├── magimage.js      # PC-98 .MAG (MAKI02) 画像デコーダ
│   │   ├── piimage.js       # PC-98 .PI (Pi 形式) 画像デコーダ
│   │   └── pmdmeta.js       # PMD (.M) 曲データ末尾 memo (曲名/作曲/編曲/コメント) パーサ
│   ├── assets/
│   │   ├── font.bmp         # ANK 8x16 / 漢字フォント (2048×2048 1bpp、修正 BSD — CREDITS.md)
│   │   ├── loader.d88       # HLE-DOS ローダ用ブート disk (毎 Run pristine 再生成して挿入)
│   │   ├── np2kai_boot.d88  # 自己起動最小ディスク (HELLO 待機画面)
│   │   ├── pmd/             # PMD86.COM + PMP.COM (KAJA 2019 ソースから自前ビルド — CREDITS.md)
│   │   └── soundfont.sf2    # MIDI 音色 (GeneralUser GS、gitignore、setup_soundfont.sh で取得)
│   ├── np2kai_core.js       # ビルド成果物 (gitignore)
│   └── np2kai_core.wasm     # ビルド成果物 (gitignore)
│
├── tools/                   # 開発・変換・テストツール
│   ├── deploy.sh            # Cloudflare Pages デプロイ (dist/ 生成)
│   ├── img2d88.py           # PC-98 raw .img → .d88 変換
│   ├── setup_soundfont.sh   # MIDI 音色 SF2 (GeneralUser GS ~32MB) を取得
│   ├── *_test.js ほか       # headless 回帰テスト群 (Node + Wasm 実ブート)。例:
│   │                        #   batch_test (bat 分岐) / xms_test / sft_test / sgr_test /
│   │                        #   find_sjis_test / exec_env_test / diskimage_test / lzh_l1ext_test /
│   │                        #   bio100_triage (互換性ベースライン) / touhou_test
│   ├── bench_game.js        # CPU ベンチ (32bit PM = Suika3)。bench_ray.js = 16bit 実モード (Ray)。
│   │                        #   最適化 A/B は両方で測る。bench_frame.js (boot.d88) は例外連発で
│   │                        #   longjmp を測ってしまうため CPU 最適化には不適 (歴史的経緯で残置)
│   ├── boot_hello/          # 最小自己起動ディスク (HELLO 表示)
│   ├── vsync_test/          # VSYNC IRQ 配送パス確認用 boot disk
│   ├── dos_loader/          # boot.asm + shell.asm (ミニ COMMAND.COM) + make_d88.py + build.sh
│   ├── np2kai_patches/      # NP2kai 改変を patch 化 (build.sh が自動適用)。一覧と詳細は
│   │   │                    #   tools/np2kai_patches/README.md が正典。01=DOS ローダフック /
│   │   ├── ...              #   02=font reset 抑止 / 03=RTC Y2K / 04=LIO gscreen / 05=LIO gcircle /
│   │   └── 07_cpu_mem_fastpath.patch  # 06=BEEP ゲイン / 07=CPU fast path (メモリ/フェッチ/16bit 実モード)
│   ├── font_build/          # font.bmp 再生成パイプライン (makefont.cjs=irori/np2-wasm BSD-3 +
│   │                        #   東雲 BDF=PD + base.bmp=SimK 修正BSD。漢字の縦位置を正規化。ビルド時のみ)
│   ├── gen_keisen_glyphs.py # font.bmp の JIS 区8 罫線を自前生成して注入 (font_build の 2 段目・意図的拡張)
│   └── testdata/            # テスト専用素材 (FreeDOS boot.d88 等。デプロイ対象外)
│
├── games/                   # 検証用書庫のローカル置き場。**.gitkeep 以外は全て gitignore**
│   │                        # (再配布許可のない書庫はコミットしない — リポジトリポリシー)。
│   │                        # 中はカテゴリ別サブディレクトリに整理 (games/README.md に明文化):
│   ├── bio_100/             #   bio 100% ゲームコーパス (triage 用 31 本+。bio100_triage.js)
│   ├── touhou/              #   東方旧作コーパス + pmd_music/ (touhou_test/pmd_*/rhythm/vol)
│   ├── mem_test/            #   エディタ/メモリ検証群 (VZ/JED/life 等。xms_clients/jed_cursor)
│   ├── game/                #   単発ゲーム本体 (rabbit/ray/sam/zar/brpn)
│   ├── tool/                #   エディタ/ビューア/お絵描き/開発参照 (MUAP/Canvas/gbox/magd/pi24/mtlib/trkei)
│   ├── driver/              #   音源ドライバ/ビジュアライザ (mdrv/pmd48o/fmp428u/fmds/mxd)
│   ├── music/               #   曲データ (th5_12pmd/fmpdata/fmp_bundle ほか)
│   ├── image/               #   画像データ (C165_206 = MAG/PI ペア。pi_test)
│   └── fixture/             #   テスト専用入力 (dostest/mouse/frway102。mouse_chain_probe/tsr_vsync)
│
└── docs/
    ├── concept.md           # コンセプト (魂)
    ├── dos_hle_gaps.md      # HLE-DOS と実 DOS の差異・未対応の体系化
    └── structure.md         # 本ファイル
```

## リファレンス機種

仕様書 v2 では「PC-9801VM2 をリファレンスに固定」だったが、実装は **PC-9821 系
（NP21 相当）** へ移行している（386+ 命令を要するソフトを射程に入れるため）。

| 項目 | 当時 (VM2) | QuuBee (現在の NP21 構成) |
|---|---|---|
| CPU | V30 8MHz | i386c (IA-32, 386/486 命令) |
| FPU | なし | Berkeley SoftFloat 3e (BSD、486DX 相当)。2026-06-26 にライセンス整合のため DOSBox2(GPL) から切替 |
| メインメモリ | 640KB | 640KB |
| 拡張メモリ | 数MB | 32MB (XMS 3.0 HLE で EMB として供給) |
| グラフィック | 640×400 / 16色 | 同 + PEGC 256 色対応 |
| サウンド | BEEP / 一部 FM | FM 音源 (OPNA / **fmgen** 既定) + BEEP + **ちびおと** (PC-9801-86 + ADPCM RAM = SOUND_SW 0x14、2026-06-27 に既定 ON。qbDebug.chibioto(0) で素の 86 へ) + **MIDI** (RS-MIDI / MPU-PC98 → TinySoundFont + SF2、レシピ検出時に on-demand 有効化) |
| クロック倍率 | x1 (実機) | **multiple=27 固定** (≈66MHz、2026-07-11〜)。過去 2 回 (2026-06-14/27) は 27 で音が詰まり 20 (≈486DX2-50) に戻したが、真因はホスト律速で、patch 07 の CPU fast path (Suika3 1.39x / Ray 1.43x) により解消 — Ray 実機で 38 まで持つのを確認し 27 を再採用。適応オートクロックは既定 OFF (qbDebug.autoclock(1) でオプトイン) |

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
   経由で C 側ハンドラへディスパッチする（この機構を HLE-DOS のトランポリンが流用）。
3. **合成 ROM 文字列**: NEC 純正機判定で読まれる領域（`neccheck` / "NEC N-88BASIC(86)" —
   Turbo-C BGI 等の実機チェック対策、patch 01）。

注意点: `nosyscode` がカバーしない番地への BIOS コールは合成データ領域を実行して暴走する
（FreeDOS(98) がブート完走しないのはこのケース。QuuBee は DOS ブート自体を必要としない設計）。

**フォント ROM**: 本物の PC-98 フォント ROM は使用せず、`web/assets/font.bmp`
（2048×2048 1bpp BMP、フリーフォント合成・修正 BSD）を NP2kai が起動時に読み込む。

## DOS — HLE-DOS（ミニ DOS ローダ）

実 DOS（MS-DOS / FreeDOS）は使用もブートもしない。`bridge` 側に **DOS 互換層**を実装し、
"DOS を再現せず、INT 21h を C 側で応答する" 方式で `.EXE`/`.COM` を直接実行する:

- **トランポリン機構**: NP2kai の「BIOS 領域の NOP → `ia32_bioscall` → `biosfunc(adrs)`」
  フックを流用（0xFEE00 系番地）。NP2kai 改変は `tools/np2kai_patches/` に patch 化。
- **ローダ** (`native/dos_loader.c`): `loader.d88`（固定内容・毎 Run pristine 再生成）でブート →
  loader-start フック → image staging → PSP 構築 → CS:IP/SS:SP 書換。MZ(EXE) / COM 両対応、
  リロケーション、per-child env、EXE 付加データ（MZ ヘッダ記載分のみロード）。
- **INT 21h ほか** (`native/dos_int21.c`): ファイル I/O（SJIS 名対応）/ メモリ / vector / 日付 /
  FindFirst/Next / IOCTL / DBCS 表 / List of Lists + 合成 SFT / CHDIR 系 / INT 29h 高速文字出力。
  tty は text VRAM へ直書き（ESC/SGR パーサ + SJIS 全角・半角グラフィック描画、dirty-flag 通知）。
- **メモリ管理**: 実 DOS 忠実な **MCB チェーン**（first/best/last-fit ストラテジ honor、coalesce、
  free-on-terminate）。**XMS 3.0 Tier-1**（`native/dos_xms.c`、EMB は実拡張メモリ 32MB に確保）。
- **EXEC / TSR / オーバーレイ**: AH=4Bh AL=00 EXEC（ランチャ型・常駐ドライバ連携）、AL=03 Load
  Overlay、AH=31h Keep Process。
- **起動 .bat**: JS 側 `batscript.js` がレシピ解釈、C 側の文テーブル + ミニ COMMAND.COM
  （`tools/dos_loader/shell.asm` → `dos_shell_blob.h`）が 1 DOS セッション内で逐次 EXEC。
  **if errorlevel / goto の実インタプリタ**（遅延評価・後方 goto 可）。
- **アーカイブ展開は JS 側**（`web/player/archive.js`、LZH=自前 LH1/4/5/6/7 + ヘッダ L0/1/2、
  ZIP=DecompressionStream）。ディスクイメージは `diskimage.js` が**ブートせず** FAT12/16 の
  ファイルだけ取り出す。

実 DOS との差異・未対応の一覧は [dos_hle_gaps.md](dos_hle_gaps.md)。

## 入力・サウンド・表示

- **入力**: 標準キーボード（NKEY_* へマップ、CTRL 単体押下も配送）、マウス（Pointer Lock
  相対移動 + 左右ボタン）、**ゲームパッド**（Gamepad API → キー変換: 十字/左スティック=カーソル、
  ボタン=Z/X/Space/Enter/ESC）。PC-98 固有キー（XFER/NFER/KANA/GRPH 等）は未対応。
- **サウンド**: **pull 型** — ブラウザの DAC コールバック（`ScriptProcessorNode.onaudioprocess`）が
  `np2kai_audio_fill` → `sound_pcmlock` を直接汲む（マスタークロック = DAC に統一、ドリフト皆無）。
  FM は **fmgen** 既定（音量レバーは `vol_fm`）。MIDI は RS-MIDI(8251 シリアル) と MPU-PC98(MPU98II)
  の両入力を **TinySoundFont + SF2**（`native/qb_tsf.c`、全体リバーブ込み）で合成。SF2 は MIDI レシピ
  検出時だけ on-demand 取得し有効化（非 MIDI タイトルの即プレイを保つ）。
- **表示**: フレームバッファは RGB565、JS 側で RGBA32 へ変換して canvas へ。640×400
  ピクセルパーフェクト。

## .gitignore（要点）

- ビルド成果物: `web/np2kai_core.{js,wasm}`, `/build/`, `/dist/`, `core/np2kai/build/`
- **`/games/*`（.gitkeep 以外すべて）— ゲーム書庫は再配布許可が無いため絶対にコミットしない**
  （ローカル検証専用。リポジトリポリシー）
- `web/assets/soundfont.sf2`（~32MB、`setup_soundfont.sh` で取得）
- `tools/dos_loader/` の派生物（boot.bin / loader.d88 / shell.bin / テスト COM 群。
  `web/assets/loader.d88` と `native/dos_shell_blob.h` はコミット）
- `__pycache__/`, IDE, OS ファイル, 作業用スクショ

## 開発状況（2026-06 時点）

- **コア（著作権クリーン Wasm）は完成・安定** — 「フリーソフトの実行環境としてはベース完成」
  （2026-06-12）。互換性改善は不具合駆動の受け身に移行。
- **公開デプロイ済み**（Cloudflare Pages、`tools/deploy.sh`）。
- headless 回帰テスト群（`tools/*_test.js` + `bio100_triage.js`）で互換性ベースラインを維持。
- 残りはプロダクト層（[concept.md](concept.md) の「プロダクト層」参照）。

## Claude Code への引き継ぎメモ

- 開発環境: Crostini (Linux on ChromeOS, aarch64)
- Emscripten: `apt install emscripten`（バージョン 3.1.69）
- ビルドはローカル完結（CI 未設定、`bash emscripten/build.sh`）
- BIOS は合成（本物の NEC BIOS は使用しない）、DOS は HLE（実 DOS を使用もブートもしない）
- コンセプト: [concept.md](concept.md)
- 詳細は [CLAUDE.md](../CLAUDE.md) / [TODO.md](../TODO.md) / [CHANGELOG.md](../CHANGELOG.md) を参照
