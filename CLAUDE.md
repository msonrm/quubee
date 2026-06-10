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
  メニュー描画まで動作。
- ✓ **Ray IV オープニングの黒画面を根治 (2026-06-08)** — bare `RAY`/`RAY RAY_IV.RAY` の「音は鳴るが画面黒」は
  **データ未指定でなく本質バグ**だった (2026-06-07 の「データ未指定が原因」は誤り)。真因 = オープニング画像を
  **INT 21h read で VRAM プレーンへ直接ロード**するが、我々の read が生 `poke8` (`mem[]` 直書き) で NP2kai の VRAM
  書き込み経路 (`memvga0_wr8`/PEGC、GRCG/EGC+表示dirty) をバイパス → 表示更新されず & GRCG read 不整合で自前展開が
  ゼロ読み無限スピン。修正 = `mem_put8` ヘルパーで **VRAM 窓宛だけ `memp_write8` (正規 CPU 書き込み) 経由**に
  (`native/dos_int21.c`)。**オープニング画像が 16 色表示・展開完走、曲データ回帰ゼロ**。VRAM 直ロード型全般に効く
  ([[feedback_np2kai_text_dirty_flag]] のグラフィック版)。罫線崩れは 2026-06-07 に別途根治済 (下記)
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
- ✓ **起動 .bat 対応 ①② (2026-06-03)**: ①`web/player/batscript.js` が .bat を「作者の起動レシピ」と解釈し
  主プログラム+引数を自動抽出。②**ミニ COMMAND.COM** (`tools/dos_loader/shell.asm`→`native/dos_shell_blob.h`
  + `qb_dos_stage_script` + `resolveSequence`) が **1 DOS セッション内で各コマンドを順に AH=4Bh EXEC** し、
  音源ドライバ TSR を本体に効かせる (`mdrv98`→game→`mdrv98 -r`)。**ブラウザ実機で FM 音源が鳴ることを確認**。
  既存 EXEC/TSR/MCB 再利用・既存単一起動経路は不変。.bat の中身も選択でテキスト面に表示 (起動順注記つき)
- ✓ **per-child env で argv[0] 正規化 (C1) — 2026-06-04 実装済**: AH=4Bh EXEC の継承 (env_seg=0) で子の
  argv[0] が親パス (例 A:\RAY.EXE) になっていたのを、`build_child_env` で子固有 env を確保し子パスに正規化
  (env を子本体より先に確保→所有権を子へ。`env_seg!=0` は現行維持・拡張容易)。`tools/exec_env_test.js` で
  loader 実ブート+EXEC env を headless 回帰。ザルバール/Ray/.bat 回帰なし
- ✓ **MIDI (RS-MIDI) が鳴る (2026-06-05)** — MIDDRV.DOC 精読で「MIDDRV=常駐 SMF 演奏ドライバ、`-X1`=
  RS-MIDI シリアル送出」と判明。真因は `qb_commng.c` が `COMCREATE_SERIAL` を `com_nc` で捨てていたこと
  (NP2kai 8251 は `cm_rs232c->write` までバイトを運んでいた)。`COMCREATE_SERIAL → cmmidi(VERMOUTH)` に
  結線 (cmmidi.c 無改造)。ブラウザは **遅延 on-demand** (MIDI レシピ Run 時だけ freepats を fetch→
  `np2kai_enable_midi_now`→reset で結線。非 MIDI は即プレイ維持)。**reset 跨ぎの再登録**も修正
  (毎リセット `com_serial` 再生成)。TW212 TWMIDI.BAT で実機発音確認。`tools/midi_serial_test.js` で 2 サイクル回帰
- ✓ **蟹味噌のテキスト残留を根治 (2026-06-06)** — 真因は PC-98 RTC の Y2K バグ (詳細 CHANGELOG)
- ✓ **bio 100% 互換性パス (2026-06-07)** — 代表作 NyaHaX'93 を T3 確認 (SuperDepth と合わせ代表作 2/4)。triage を
  精緻化 (`.bat` 入口解決 + 最終 PC を EXIT/WAIT/BIOS に 3 分類) し **描画到達 20/31・動作確認 22/31・真の BIOS
  クラッシュ 0** の正直なベースラインに。**INT 21h AH=52h (Get List of Lists) を実装**し master.lib 製 Super Spartan
  を EXIT→ALIVE 化 (master.lib 系全般に効く)。詳細は [TODO.md「現在の目標」](TODO.md)
- ✓ **INT 29h (DOS 高速文字出力) を実装しテキスト残留を根治 (2026-06-07)** — 「ゲーム画面にタイトル文字が
  重なって残る」(SSP のメニュー/ハイスコアに banner ゴースト) の真因 = **master.lib `text_clear()` の実体は
  `INT 29h` で `ESC[2J` を送るだけ**で、我々が INT 29h 未フック (IRET スタブ) のため消去が無効化されていた。
  INT 29h を「AL→tty (ESC パーサ込み)」フックに (トランポリン `0xFEE80`)。**SSP の banner ゴーストが完全消滅・
  回帰ゼロ**。切り分けの決め手はユーザー提供の GBOX `/TF` (テキスト非表示は元から正常) + master.lib (mtlib22j)
  逆アセンブル。詳細は CHANGELOG/[[reference_masterlib_text_clear_int29]]。なお KANI の「KANI.SCR を作成します」は
  別系統 (INT 29h 不使用・初回起動でファイル不在時のみ出る忠実な通知、スコア登録時に作成・以後消える)。
- あわせてコードレビュー修正: DUP/DUP2 が作成 (w+b) ハンドルを開き直して切り詰める不具合 + UNIMPL の AX 化。
- ✓ **テキスト面の連続根治 (2026-06-07)**: ① **Ray IV はデータ指定 (`RAY SILK_FLD.RAY`) でオープニング表示**
  (「画面黒のまま」はデータ未指定が原因だった)。その枠 (罫線) の**横2倍崩れ**を根治 — 真因は **PC-98 半角
  グラフィック (JIS 区9-11 / SJIS 0x86xx) を全角扱い**で 2 セル書いていたこと。`ku∈{9,10,11}` を 1 セル
  (`vram_put_kanji_half`) に分岐。② **tty が TAB (0x09) 未処理でグリフ化**していたのを 8 桁タブストップ前進に
  (GBOX `/?` ヘルプの行頭乱れ)。③ **AH=58h (メモリ確保ストラテジ/UMB リンク) を良性スタブ化** (GBOX `/U`)。
  回帰ゼロ (bio100 triage 同一・CRASH0)。詳細は CHANGELOG/[[reference_pc98_halfwidth_graphics]]。スクショ突合=`tools/ray_png.js`。
- ✓ **「快適に使う」QoL パス (2026-06-08、JS のみ・Wasm 不変・ブラウザ実機確認済)**: ① **CTRL キーがゲームに届かない
  死にコードを修正** (keydown が CTRL 単体押下も捨てていた→押下キー自身が Control の時だけ素通し)。② **readme/テキスト
  ビューアの罫線崩れを根治** — 真因は 2バイト NEC 罫線 (SJIS 0x86xx) を WHATWG/CP932 とも知らず U+FFFD に潰すこと。
  同形状の JIS83 罫線(区8)経由で **NEC→Unicode 罫線 (U+2500–254B) に写像** (`decodeSjisText`、表は trkei98.exe LUT を正典に
  32字抽出・test98 で検証)。③ ファイル名行右端 `⛶ 拡大` で**別窓モーダル** (content-agnostic)。④ **PC-98 標準画像 .MAG
  (MAKI02) ビューア** (`web/player/magimage.js`、自前デコーダ。Magd ソース magd25s.lzh を仕様参照・逐語移植せず。
  savefont.mag/gbox.mag で検証)。詳細は CHANGELOG。
- ✓ **DOS メモリ確保ストラテジ (last-fit) を実装し GOGGLE-II を救済 (2026-06-09)** — bio 100% 残 EXIT の **GGL2** が
  「.bg0〜9 生成 → exit 3」だった真因 = **`AH=58h` メモリ確保ストラテジ (last-fit) を無視していたこと**。GOGGLE は各
  `AH=48h` 前に last-fit を設定して確保を上端から取らせ本体直上を空けて PSP ブロックをそこへ `AH=4Ah` 拡大する慣用を
  使うが、我々は常に first-fit で下端確保し直上を埋め → PSP 拡大要求に旧コードが**嘘の成功**を返し**プログラムが MCB
  ヘッダを破壊** (44KB しか確保していないのに `largest=0`)。修正 = ① `AH=58h` を実際に効かせ `qb_dos_alloc_request` が
  first/best/last-fit を honor (`native/dos_loader.c`、last-fit はブロック上端確保・低位を空けて残す)、② PSP ブロックの
  2 回目以降の `AH=4Ah` を正直化 (直上空きを吸収して拡大成功 / 確保済みなら実 DOS 同様に失敗を返す)。**GOGGLE-II が
  タイトル画面 (PUSH TRIGGER TO START) まで到達**。**同 last-fit を使う OZ100 (EXIT→ALIVE)・CZ102 (EXIT→RENDER)
  も巻き添え救済** = systemic。triage **ALIVE19/RENDER4/BOOT5/WAIT2/EXIT1/CRASH0・描画到達 23/動作確認 25**
  (EXIT 4→1、残 GS100 のみ)。あわせて readme `decodeSjisText` のトレイル `0x86` 誤判定も修正 (詳細 CHANGELOG)。
- ✓ **.bat errorlevel 分岐インタプリタ完了 (2026-06-10)** — if errorlevel/goto 入り起動 .bat (38本中8本: 封魔録/
  Super Depth2/life100) を**実インタプリタ**で自動起動。シェル (shell.asm) は「far CALL F000:EE90 で C へ『次コマンド?』
  → EXEC」の発行役に、C 側文テーブル (`qb_dos_stage_batch`/`qb_dos_batch_next_hook`、`native/dos_loader.c`) が
  errorlevel (`g_last_exit_code`) を**遅延評価**して分岐 = 並び順非依存・後方 goto ループ成立・echo も tty 表示。
  線形 ② 経路も同シェルに統合 (外部契約不変)。**無改変の TH02 game.bat が headless で `zun ongchk` の errorlevel 3
  から実枝 :ong4 (pmd86) を選び op.exe 描画到達**。`tools/batch_test.js` 8/8、batscript 45/45、triage 回帰ゼロ。
  **ブラウザ実機 T3 確認済 (2026-06-10)**: 公式体験版書庫を直接ドロップ → game.bat → Run で封魔録が動作 (ユーザー確認)。
  「公式配布書庫そのまま・MS-DOS / NEC BIOS 不使用」でのブラウザ動作 = QuuBee のコンセプト (著作権クリーン×お手軽) の実証
- 次: Phase 3 一区切り。残は Ray の音楽再生まで通すか (Phase 4 候補)、GETS の BIOS 調査 / FINALTY・life100 のブラウザ確認 (任意)
- ターゲット: フロッピーベース・2D・〜1998 年の同人/フリーソフト (期待カバー率 80〜90%)
- テストスイート: さめがめ ✓ / ザルバール ✓ / Super Depth LZH ✓ / Ray ✓(オープニング画像表示・罫線根治) / うさちゃん列車 ✓ /
  東方封魔録 TH02 ✓(2026-06-10 ブラウザ実機、書庫ドロップ→game.bat 分岐インタプリタ経由)
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
  快適化 / Bio 100% の BEEP 超絶技巧 (oneshot 経路) / 互換性の長尾

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
│   ├── player/bridge.js   # JS↔Wasm ブリッジ + filer + readme/画像ビューア (NEC罫線→Unicode)
│   ├── player/archive.js  # LZH/ZIP デコーダ
│   ├── player/diskimage.js # ディスクイメージ→FAT12/16 取り出し (ブートせず)
│   ├── player/magimage.js # PC-98 .MAG (MAKI02) 画像デコーダ
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
