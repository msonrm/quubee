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
- ✓ CPU を i386c (NP21) へ拡張、FPU 有効化（2026-06-26 にライセンス整合のため DOSBox2(GPL)→SoftFloat3(BSD) へ切替）
- ✓ 標準キーボード入力（英数, 記号, 矢印, F1-F10, テンキー）
- ✓ 表示パイプラインのピクセルパーフェクト化
- ✓ 自己起動最小ディスクが画面表示まで動作 (`tools/boot_hello/`)
- ✓ ディスクの D&D / ファイル選択 UI、A:/B: 2 ドライブ対応 (B: はリセットなし)
- ✓ マウス入力 (Pointer Lock + 相対移動 + 左右ボタン)
- ✓ 実 PC-98 のゲームディスク (.d88) で CPU/FDD・CG 経路を検証（Phase 2 のブリングアップ。市販ソフトの
  動作は射程外なので、テストスイートは同人/フリーソフトに統一 — 末尾参照）
- ✓ サウンド対応 (FM 音源、AudioWorklet + postMessage、メインスレッドジャンク耐性あり)
- ✓ HDD スロット (C:/D:、SASI/IDE) と `np2kai_insert_hdd` ブリッジ — UI 配線 OK だが
  DOS 系 HDD イメージは BIOS ホールで起動できない (FreeDOS と同じ壁)
- 次: 追加タイトル検証、PC-98 固有キー、GitHub Actions CI

**Phase 3 進行中** — ミニマル DOS ローダ
（日次の詳細経緯は [CHANGELOG.md](CHANGELOG.md) / 確立した知見は memory/MEMORY.md を参照。以下は到達点サマリ）
- ✓ **DOS ローダ確立**: INT 21h 多数 (file/mem/date/vector/IOCTL/find/exec/stdin) / INT 23h Ctrl-C ハンドラ発火 (既定=中断・IRET/far RET 復帰規律・PSP+0Eh 保存復元・ブラウザ Ctrl+C 透過) / AH=4Bh EXEC / TSR (AH=31h・INT 27h) / MCB チェーン / .bat インタプリタ (errorlevel 分岐・cd・set) / XMS Tier1 (既定 ON) / INT 33h マウスドライバ (MS/NEC 二流派・既定 MS・実測正典 tools/mousetest/) / VRAM 直書きは `memp_write8` 経由 / tty (PC-98 ANSI・INT 29h・INT DCh CL=10h・SGR・グラフ文字モード・カーソル座標ワーク 0x710/0x71C 同期)
- ✓ **テキストエディタ互換クラス**: VZ / JED / MUAP (INT DCh setkey) + ホスト IME 日本語入力 (FEP 非常駐・SJIS 注入)
- ✓ **HLE FEP (日本語入力の第 2 経路、2026-07-07〜08)**: 実 FEP と同じ「キー横取り→よみ/文節をゲスト画面へインライン描画 (VRAM 直書き・セル所有権検証復元)→確定 SJIS 注入」をホスト変換ループで再現。変換 = **Mozc-Wasm** (BSD-3、wasm 2.6MB + 辞書 19MB を FEP 初回 ON で遅延 fetch、専用 Worker + watchdog 自己回復)。複数文節 (←→移動・候補選択)・句読点即確定・トグル =「あ」ボタン/Ctrl+Space/Ctrl+J (ChromeOS は Ctrl+Space 不可)・設定 FEP Style (WX/ATOK)。ビルド正典 = `~/development/mozc-wasm-build/README.md` (**ラッパーは必ず -DNDEBUG** の罠あり)。回帰 = fep_test / fep_mozc_test
- ✓ **音楽**: PMD `.M` (自前ビルド KAJA・常駐演奏) / FMP・FMDSP (ちびおと = 86+ADPCM) / MIDI (RS-MIDI・MPU-PC98 + TinySoundFont/SF2) / OPNA 内蔵リズム (クリーン代替 WAV) / BEEP ブースト
- ✓ **画像・文書ビューア**: MAG・PI デコーダ / readme (NEC 罫線→Unicode・VZ %タグリンク) / 仮想 30 行 BIOS (`qbDebug.lines30`)
- ✓ **ホスト連携 QoL**: ゲームパッド / ファイル単体 Save・＋Add / 閲覧専用形式 (画像/音楽) の非破壊オープン / サブディレクトリ起動の CWD 代行
- 動作確認: さめがめ / ザルバール / Super Depth / Ray IV / うさちゃん列車 / 東方旧作 4 作 (TH02-05 体験版・ブラウザ実機確認) / bio100 純ゲーム 31 本 (ALIVE21・CRASH0・描画到達 25・動作確認 27) / MIMPI v3.8 (MIDI プレイヤー、I/F=MPU 演奏 + LIO ミキサー画面・ブラウザ実機確認 2026-07-03)
- ターゲット: フロッピーベース・2D・〜1998 年の同人/フリーソフト (期待カバー率 80〜90%)
- 次: **新配列 (薙刀式/NICOLA/月配列) 統合 — labo と分業進行中** ([TODO.md 先頭](TODO.md) と [docs/keymap_engine_handoff.md](docs/keymap_engine_handoff.md) が正典。QuuBee 側の先行タスク = キー入力タップの正規化)。ほか残 = Ray の音楽再生まで通すか (Phase 4 候補) / TH03-05 SFX の JS 側取り込み / GETS の BIOS 調査 / bio100 群のブラウザ実プレイ確認 (ユーザー進行中)。永続化はコンセプト練り直し待ち (ユーザー判断)
- 詳細は [TODO.md「Phase 3 計画」](TODO.md) と [CHANGELOG.md](CHANGELOG.md) を参照

**エンジン品質パス 一区切り (2026-06-03〜04)** — コア（エミュレータ）そのものの質を底上げ:
- ✓ **ビルドが実質 -O0 だった** (CMAKE_BUILD_TYPE 空) のを発見 → 上流 em と同じ compile `-O2`/link `-O3`
  を CMakeLists に追加 = **2.02x 高速化・wasm 3.2x 縮小** (`tools/bench_frame.js` で headless 計測)
- ✓ **FM 音源を fmgen 既定化** (`usefmgen=1`)。実機 A/B で opngen より明確に高音質。CPU 増は -O3 余裕で吸収。
  実行時トグル `qbDebug.fmgen(0|1)`。**罠: `vol_master` は fmgen に届かない** (opnalist 未populate) →
  fmgen の音量レバーは `vol_fm`。vol_master は 65→100 中立化 (opngen/beep 等の整数経路専用)
- ✓ コードレビュー追随: EXEC 子 EXE の reloc 境界チェック + DUP2 自己複製 UAF 修正
- ✓ **音声を pull 型に再設計 (2026-06-04) — 劇的音質向上・途切れ皆無**。旧プッシュ型 (rAF で生成 → C リング
  → AudioWorklet) は生成 (system 時計) と消費 (audio DAC) の2クロックがドリフトし周期的にプチ/途切れていた。
  `ScriptProcessorNode.onaudioprocess` (DAC クロック) が `np2kai_audio_fill`→`sound_pcmlock` を直接 pull する
  pull 型に戻し、マスタークロックを DAC 1つに統一 (irori/np2-wasm と同型、SDL 依存は使わず自前 glue)。
  CPU 不変。実機でユーザー確認済 (「AM ラジオと CD くらい違う」)。別スレッド化 (AudioWorklet+SAB) は将来 C2
- ✓ **XMS (HIMEM 相当) Tier 1 HLE (2026-06-05)** — 640KB の壁の外へ。「HIMEM ロード済の DOS」を素直に再現
  (`native/dos_xms.{c,h}`、既定 ON)。INT 2Fh AX=4300→在/4310→entry → far CALL で AH=関数。**EMB は実拡張メモリ
  `CPU_EXTMEM`(32MB) に first-fit 確保**、Move/Lock(実 linear)/Realloc 等を XMS 3.0 契約で実装。`qbDebug.xms()`。
  検証=`tools/xms_test.js` + **AMEL `/X` が実機で 338KB 確保**。需要は games/mem_test で実在確認 (VZ/AMEL/JED 等)
- 次の候補: XMS Tier 2 (lock 実利用クライアント / A20 実ゲート) / **EMS HLE** (INT 67h、ページフレーム copy で重い) /
  快適化 / 互換性の長尾。~~BEEP 超絶技巧~~ → **実測で既に動作と確認 (2026-06-11、TWBEEP の楽曲 PCM を headless キャプチャ)**

## リファレンス機種（重要）

仕様書 v2 では「VM2 をリファレンスに固定」だったが、Phase 2 での実装は
**PC-9821 系（NP21 相当）** に移行している:

| 項目 | 構成 |
|---|---|
| CPU | i386c (IA-32) / 386・486 相当命令セット |
| FPU | Berkeley SoftFloat 3e（USE_FPU + SUPPORT_FPU_SOFTFLOAT3、BSD）。2026-06-26 にライセンス整合のため DOSBox2(GPL) から切替 |
| EXTMEM | 32MB |
| クロック | multiple=20（≈486DX2-50、≈49MHz）。2026-06-26 に 27（≈66MHz）へ上げたが、ちびおと(ADPCM)既定 ON 後の FMDSP 等で音が詰まる実害をユーザーが実機確認し 2026-06-27 に 20 へ差し戻し。bridge.js が起動時に emu.setClockMultiple(20) で適用し np2cfg.multiple に保持。autoclock は既定 OFF |
| グラフィック | テキスト VRAM + 640×400 + PEGC |
| MMX | 実装（USE_MMX。SoftFloat FPU が FPU/MMX 共有状態を要求するため有効化） |
| SSE/3DNow | スタブのみ（UD_EXCEPTION） |

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
- ローカル確認: `node tools/devserver.js 8080` → http://localhost:8080/（COOP/COEP 付き。worker モード /
  SharedArrayBuffer に必須なので `emrun` では不可）。headless 回帰は `node tools/*_test.js`
- **デプロイ（公開反映）**: build → commit → push → `bash tools/deploy.sh` → `npx wrangler pages deploy dist
  --project-name quubee --branch main --commit-dirty=true --commit-message "ASCII only"`。**手順・注意点
  （remote=origin は msonrm/quubee / push では Pages は自動デプロイされない / soundfont.sf2 を入れ忘れると本番
  MIDI が消える / wrangler の commit-message は ASCII 必須 / push・deploy は要ネットワーク）は
  [docs/deploy.md](docs/deploy.md) が正典**

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
│   ├── player/bridge.js   # JS↔Wasm ブリッジ + filer + readme/画像ビューア (NEC罫線→Unicode)
│   ├── player/archive.js  # LZH/ZIP デコーダ
│   ├── player/diskimage.js # ディスクイメージ→FAT12/16 取り出し (ブートせず)
│   ├── player/magimage.js # PC-98 .MAG (MAKI02) 画像デコーダ
│   ├── player/piimage.js  # PC-98 .PI (Pi 形式) 画像デコーダ
│   ├── assets/
│   │   ├── np2kai_boot.d88 # 自己起動最小ディスク (HELLO 待機画面)
│   │   ├── loader.d88     # Phase 3 DOS ローダディスク
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
│   ├── np2kai_patches/    # NP2kai 改変を patch 化 (build.sh が自動適用)
│   └── testdata/          # テスト専用素材 (FreeDOS boot.d88 — bench_frame/diskimage_test 用。デプロイ対象外)
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
