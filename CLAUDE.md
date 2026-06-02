# QuuBee - PC-98 フリーソフト文化のブラウザプレイヤー

> 読み「きゅーびー」(PC-98 = きゅうはち → Q + Bee)。内部コードネーム/旧称は **QB**。
> コード識別子 (`qb_*` / `QB_*` / `qbDebug`) と `.qb` フォーマット拡張子は QB のまま据え置き
> (巨大リファクタ回避・継続性のため)。プロダクト表記のみ QuuBee。

**ミッション**: PC-98 のフリーソフト文化を、罪悪感なく継承・再体験できるプレイヤー。NEC BIOS も
MS-DOS も使わず（HLE-DOS + 合成 BIOS + MIT の NP2kai）、書庫ドロップで即プレイ。

## 仕様書（必読）
- コンセプト（魂・現行）: [docs/concept.md](docs/concept.md)
- HLE-DOS の実 DOS との差異・未対応: [docs/dos_hle_gaps.md](docs/dos_hle_gaps.md)
- 仕様書本体 (Notion): https://www.notion.so/msonrm/QB-v2-Wasm-PC-98-36740929a47081878a5fd6740a97ada5

## 現在のフェーズ
**Phase 1 完了 ✓** — NP2kai を Emscripten で Wasm ビルドし、FreeDOS(98) がブラウザで起動することを確認

**Phase 2 進行中** — PC-98 ゲームディスクのロードと動作確認
- ✓ CPU を i386c (NP21) へ拡張、FPU (DOSBox2) 有効化
- ✓ 標準キーボード入力（英数, 記号, 矢印, F1-F10, テンキー）
- ✓ 表示パイプラインのピクセルパーフェクト化
- ✓ 自己起動最小ディスクが画面表示まで動作 (`tools/boot_hello/`)
- ✓ ディスクの D&D / ファイル選択 UI、A:/B: 2 ドライブ対応 (B: はリセットなし)
- ✓ マウス入力 (Pointer Lock + 相対移動 + 左右ボタン)
- ✓ 実 PC-98 ゲームがプレイ可能（ロードモナーク .d88、プリンセスメーカー 2 枚組）
- ✓ サウンド対応 (FM 音源、AudioWorklet + postMessage、メインスレッドジャンク耐性あり)
- ✓ HDD スロット (C:/D:、SASI/IDE) と `np2kai_insert_hdd` ブリッジ — UI 配線 OK だが
  DOS 系 HDD イメージは BIOS ホールで起動できない (FreeDOS と同じ壁)
- 次: 追加タイトル検証、PC-98 固有キー、GitHub Actions CI

**Phase 3 進行中** — ミニマル DOS ローダ
- ✓ Day 0 (LH5/ZIP-deflate/VSYNC IRQ/Run UI) 完了 (2026-05-27)
- ✓ Day 1 T1/T2/T3 通過 (2026-05-28) — 自作 hello.com / args.com / hello.exe
- ✓ **Day 1 T4 通過 (2026-05-28)** — さめがめ (sam98210.lzh, `-k`) が **プレイ可能** まで動作。
  INT 21h を 20 fn に拡張 (file/mem/date/vector/IOCTL/find)、PC-98 ANSI/ESC パーサ、未使用 INT の
  IRET stub、正規 env segment、LZH 経路接続、Stop ボタン UI。**真因の発見**: テキスト VRAM
  残留は NP2kai の行単位 dirty-flag に通知していないことが原因。`gdcs.textdisp |= GDCSCRN_ALLDRAW2`
  でメモリ直書き直後に「次フレーム全行再描画」通知が必須
- ✓ **T5 ザルバール** / **T4.5 Super Depth LZH** プレイ可能 (2026-05-30、AH=4Bh EXEC + MCB チェーン化)
- ✓ **T6 Ray IV (2026-05-31)** — 起動・**RIN.COM 自動常駐 (EXEC COM 子 + AH=31h TSR)**・FM 音楽・
  メニュー描画まで動作。ただしオープニング手前で Ray 内部ループに入り画面は黒のまま (深い RE 課題、保留)
- ✓ **うさちゃん列車 (2026-06-01)** — **プレイ可能** (起動・デモ・キー操作・面クリア)。pure-asm で
  生 IRQ1 を自前 INT 09h で受ける経路を初実証 (従来は INT 18h BIOS 経由)。**公式 3/4 達成**
- ✓ **日本語 (漢字) tty 表示を根治 (2026-06-01)**: 化けの真因は `vram_put_kanji` の高位バイト符号化
  (`(jis_lo-0x20)|0x80` → 正: `jis_lo|0x80`、PC-98 漢字セルは低位=区索引/高位=生JIS第2バイトの非対称符号化)。
  **font.bmp は最初から正しく**、前回「標準JIS不一致で保留」は font.bmp を索引で覗いた誤診だった。
  さめがめ等 (CG 窓経由) は無関係で回帰なし。詳細は CHANGELOG/TODO の「日本語 (漢字) 表示の課題」
- ✓ **HLE-DOS 拡張 (2026-06-03)**: INT 21h に **39h/3Ah/3Bh** (MKDIR/RMDIR/CHDIR、CHDIR は論理カレント
  `g_cwd` を持ち相対パス解決に前置) + **36h** (空き容量、合成値) を追加、**EXEC 子のファイルハンドル掃除**
  (free-on-terminate 相当)。フロントは **ファイラ名の SJIS 表示** / MEMFS リーク修正 / **`/run` ライブ反映**
  (実行中ポーリング+差分描画でセーブ/生成物が UI に出る)。実 DOS との差異は [docs/dos_hle_gaps.md](docs/dos_hle_gaps.md) に体系化
- 次: Phase 3 一区切り。残は Ray 完全表示 / 蟹味噌のテキスト面残留 (いずれも Phase 4 候補)
- ターゲット: フロッピーベース・2D・〜1998 年の同人/フリーソフト (期待カバー率 80〜90%)
- テストスイート: さめがめ ✓ / ザルバール ✓ / Super Depth LZH ✓ / Ray ✓(起動) / うさちゃん列車 ✓
- 詳細は [TODO.md「Phase 3 計画」](TODO.md) と [CHANGELOG.md](CHANGELOG.md) を参照

## リファレンス機種（重要）

仕様書 v2 では「VM2 をリファレンスに固定」だったが、Phase 2 での実装は
**PC-9821 系（NP21 相当）** に移行している:

| 項目 | 構成 |
|---|---|
| CPU | i386c (IA-32) / 386・486 相当命令セット |
| FPU | DOSBox2 エミュレータ（USE_FPU + SUPPORT_FPU_DOSBOX2） |
| EXTMEM | 32MB |
| グラフィック | テキスト VRAM + 640×400 + PEGC |
| MMX/SSE/3DNow | スタブのみ（UD_EXCEPTION） |

理由: 386+ 命令が必須のソフト（FreeDOS, 90 年代後半以降の多くのゲーム）を
射程に入れるため。仕様書の「快適化」哲学（CPU クロック倍率 x42 等）はそのまま
継承し、CPU クラスだけ上方修正した形。

## BIOS と DOS

**BIOS**: NP2kai 内蔵の最小 BIOS (`nosyscode` + `bios/*.c` の C 実装ハンドラ) を使用。
- 本物の NEC `bios.rom` は同梱しない（著作権クリーン）
- `bios.rom` ファイルがあれば `np2cfg.usebios=1` で読み込み可能だが現状未使用
- `nosyscode` がカバーしない番地への BIOS コールは、合成された ROM 領域
  （NEC 著作権文字列 `neccheck` 含む）を実行して暴走するリスクあり
- フォントは `web/assets/font.bmp` で代替

**DOS**: FreeDOS(98) は現状ロードしてもブート完走しない。
- HMA への disk buffer 確保まで到達（"Kernel: allocated diskbuffers" まで）
- その後 `E869:075B` (BIOS ROM の `neccheck` 領域) に飛び込んでハング
- 原因: NP21 系で必要な BIOS 拡張ハンドラが我々の `nosyscode` 範囲外
- 対策候補:
  1. 実機 `bios.rom` 利用 (著作権)
  2. `nosyscode` 拡張で BIOS フックを足す (実装工数)
  3. 自己起動ゲームを優先 (現在の路線)
- Phase 2 では 3 を採用。1/2 は将来課題

## 環境
- 開発機: Chromebook (aarch64) + Crostini (Debian Trixie)
- Emscripten: `apt install emscripten`（バージョン 3.1.69、ローカルでビルド可能）
- ビルド: `bash emscripten/build.sh`（NP2kai patch 自動適用 + emcmake cmake + emmake make）
- Phase 3 ローダ disk + hello.com 再生成: `bash tools/dos_loader/build.sh`
- テスト: `emrun --port 8080 web/` → ブラウザで確認

## 作業前のルール
- 大きな変更前には実装方針を提示して判断を仰ぐ
- 構造的に複数解釈ある指示は、選択肢を提示してから処理を進める
- ビルドはローカル（Crostini）で実行する（GitHub Actions は未設定）

## リポジトリ構造
```
qb/
├── core/
│   └── np2kai/            # AZO234/NP2kai を git submodule
├── native/                # C コード（bridge層）
│   ├── CMakeLists.txt     # Emscripten専用 (i386c/NP21 構成)
│   ├── bridge.c / bridge.h
│   ├── compiler_base.h    # NP2kai 上書きヘッダ
│   ├── qb_scrnmng.c       # フレームバッファ管理
│   ├── qb_soundmng.c      # 音声スタブ
│   ├── qb_*.c             # その他フロントエンドスタブ
│   ├── dos_loader.c/h     # Phase 3: image staging + loader-start フック + PSP 構築
│   └── dos_int21.c/h      # Phase 3: INT 21h ハンドラ + text VRAM 風 tty
├── web/                   # ブラウザフロントエンド
│   ├── index.html
│   ├── player/bridge.js   # JS↔Wasm ブリッジ + filer (フォルダ移動/展開)
│   ├── player/archive.js  # LZH/ZIP デコーダ
│   ├── player/diskimage.js # ディスクイメージ→FAT12/16 取り出し (ブートせず)
│   ├── assets/
│   │   ├── boot.d88       # FreeDOS(98) 2HD (起動完走しない、TODO)
│   │   ├── np2kai_boot.d88 # 自己起動最小ディスク (動作確認用)
│   │   └── font.bmp       # フォント
│   ├── np2kai_core.js     # ビルド成果物（gitignore）
│   └── np2kai_core.wasm   # ビルド成果物（gitignore）
├── emscripten/
│   └── build.sh           # ビルドスクリプト
├── tools/
│   ├── img2d88.py         # PC-98 raw .img → .d88 変換
│   ├── boot_hello/        # 最小自己起動ディスク (HELLO NP2KAI 表示)
│   ├── vsync_test/        # Day 0c VSYNC IRQ 配送確認用 boot disk
│   ├── dos_loader/        # Phase 3: boot.asm + make_d88.py + hello.com.py + build.sh
│   └── np2kai_patches/    # NP2kai 改変を patch 化 (build.sh が自動適用)
├── docs/
│   └── structure.md       # 構成詳細
├── CLAUDE.md
├── README.md
├── TODO.md
└── CHANGELOG.md
```

## 主要ブリッジ API（bridge.h）
```c
/* ライフサイクル */
np2kai_handle np2kai_create(void);
void          np2kai_destroy(np2kai_handle h);

/* セットアップ */
int           np2kai_set_data_dir(const char *path);
int           np2kai_set_bios_dir(np2kai_handle h, const char *path);

/* FDD */
int           np2kai_insert_fdd(np2kai_handle h, const char *path,
                                int drive, int readonly);

/* 実行 */
void          np2kai_run_frame(np2kai_handle h);
const uint8_t *np2kai_get_framebuffer(np2kai_handle h, int *w, int *h, int *bpp);

/* キーボード (PC-98 NKEY_* コード, 0x00-0x7f) */
void          np2kai_key_down(np2kai_handle h, uint8_t pc98_keycode);
void          np2kai_key_up  (np2kai_handle h, uint8_t pc98_keycode);

/* デバッグ */
uint64_t      np2kai_debug_get_pc(np2kai_handle h);          /* CS<<32 | EIP */
uint32_t      np2kai_debug_get_cs(np2kai_handle h);
uint32_t      np2kai_debug_get_linear_pc(np2kai_handle h);   /* CS<<4 + EIP */
uint32_t      np2kai_debug_peek8(np2kai_handle h, uint32_t linear_addr);
uint32_t      np2kai_debug_get_gdc_mode1(np2kai_handle h);
```

JS 側ヘルパー: `window.qbDebug.{cs, linear, pc, sample, dump, dumpHere, gdcMode1}` で
DevTools コンソールから呼べる。ハング箇所の特定に有効。

## 既知のポイント
- `fdd_set()` を直接呼ぶ（`diskdrv_setfdd` は `fdc.equip` ガードと 20 フレーム遅延があるため）
- フレームバッファは RGB16 (5-6-5)、JS 側で RGBA32 に変換して canvas に描画
- Emscripten FS に `FS.writeFile()` でディスクイメージを書き込んでから挿入
- 自己起動ディスクを書く時は **DS レジスタを必ず初期化する**（ブート直後は不定、
  IVT 領域を読んでしまう罠あり）
- PC-98 BIOS POST 後でも `gdc.mode1` の 8x16 ANK モードビットは自動で立たない
  ことがあるので、ブート初期に `INT 18h, AH=0Ah` を呼ぶと確実
