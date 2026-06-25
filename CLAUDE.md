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
  残留は NP2kai のセル単位 dirty-flag (`tramupdate[]`、memtram_wr8 が設定) に通知していないことが
  原因。`gdcs.textdisp |= GDCSCRN_ALLDRAW2` でメモリ直書き直後に「次フレーム全セル再描画」通知が必須
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
- ✓ **ゲームパッド対応 (2026-06-10、JS のみ・Wasm 不変)** — Gamepad API→キー変換 (`pollGamepads` を rAF 先頭で毎フレーム
  ポーリング、十字/左スティック→カーソル、ボタン 0→Z/1→X/2→Space/3→Enter/Start→ESC)。ブラウザ実機で **TH02・Super Depth
  動作確認済 (ユーザー確認)**。調査副産物: bio100 の 21/36 書庫が FM ボード経由ネイティブパッド対応を明記 (NP2kai 経路は
  `fmboard_getjoy`→`joymng_getstat` で配線済・SUPPORT_JOYSTICK 未定義で 0xff 固定なだけ) = 将来の案 B (CHANGELOG 参照)。
  **2026-06-21: L1→Ctrl / R1→Shift を追加** — 東方旧作 (ショット/ボム/低速移動=R1 Shift/スキップ=L1 Ctrl/ポーズ) と
  Super Depth がパッド単体で完結 (Super Depth は元から完結・変更なし)。R1 低速移動をブラウザ実機確認 (ユーザー)
- ✓ **DOS CON ワークエリア 0:0712h 初期化で東方の画面端ゴミを根治 (2026-06-11)** — 東方は EGC blit 用タイル
  キャッシュを VRAM 右端 64×400px (両ページ) に常駐させ**テキスト面の黒反転セルで隠す** (ReC98 正典) が、
  master.lib `text_fillca` が塗る行数を **0:0712h (テキスト行数−1) から直読み**するため、未初期化 (=0) だと
  被覆が row 0 で切れて露出していた。修正 = `qb_dos_tty_reset` で 0x711/0x712 を初期化 (25 行) + ESC パーサに
  `ESC[>1h/l` `>3h/l` (fkey 行/20·25 行) を実装 (`native/dos_int21.c`)。**TH02/TH05 ブラウザ実機確認済・
  Dynamo 起動時の上部テキスト残留も巻き添え根治 (ユーザー確認)**。当初仮説の VRAM 裏表/GDC クロックは計測で
  否定。回帰ゼロ。詳細 CHANGELOG
- ✓ **SGR (ESC[...m) 実装 + `>5` をカーソル制御に忠実化 (2026-06-11)** — DOS コンソール出力の色/反転/点滅を
  PC-98 属性へ写像 (NEC CON 絶対指定方式・40-47=色+反転・17-23=別系色、DOSBox-X と突合)。`>5l` でテキスト面が
  消える地雷も解消。CON ワークエリア 0x71D (現在属性) も維持。回帰 = `tools/sgr_test.js` 新設・全テスト PASS。
  INT 実需サーベイで master.lib 残ギャップは ①ジョイスティック (案 B) ②BEEP 音楽 ③ESC[nL/nM (蟹味噌保持・
  未発火) の 3 点に絞られた。INT DCh は CL=0x10 (fkey 文字列) のみ実需で stub のまま実害なし。詳細 CHANGELOG
- ✓ **合成 SFT で TH03 夢時空の GAME.BAT ハングを根治 (2026-06-11)** — pmd86 の install-check は AH=52h →
  **LoL[+4] first SFT を終端チェックなしで follow** し SFT から自分の名前を探すが、我々の `FFFF:FFFF`「無し」
  マーカがゴミ走査の無限ループになっていた (`zun -4 -z` 常駐は無実・ゴミの中身を変えただけ)。修正 = 正規終端の
  合成 SFT (DOS 5 形式、`QB_SFT_SEG=0x00B0`) + **直近 EXEC の stale エントリ** (名前+実サイズ、実 DOS が
  EXEC 後に残すものの再現。pmd86 はサイズから自イメージ末尾シグネチャ照合までするため)。TH03 通し FAIL→PASS・
  pmd86 TSR 常駐成功。回帰 = `tools/sft_test.js` 新設 (pmd86 同型走査の合成 COM)・全テスト/triage 回帰ゼロ。
  チェーン先頭に「無し」は表現不能 = 嘘構造体の教訓 (詳細 CHANGELOG / docs/dos_hle_gaps.md §2-5)。
  **ブラウザ実機 T3 確認済 (2026-06-11、ユーザー) → オフィシャル入手可能な東方旧作体験版 4 作
  (TH02 封魔録 / TH03 夢時空 / TH04 幻想郷 / TH05 怪綺談) が全てブラウザ動作** = コンセプトの代表的実証
- ✓ **拡大ビューア: VZ 流 %X タグリンク + 実機風タイポ (2026-06-12、JS のみ)** — readme の手作り
  ハイパーリンク慣習 (VZ HELP キー検索前提の %A〜%O タグ) をクリックジャンプに翻訳 + line-height 1.0
  (25行=行間ゼロ、罫線/AA が繋がる)+18px。**ブラウザ確認済。FINALTY/life100/Canvas-98 もユーザー確認済
  (Canvas-98 はベジエ描画まで動作)** = 周辺文化 (readme/VZ/MAG) の再体験がコンセプトの差別化軸と確認
- ✓ **EXEC 付加データ EXE + NEC 実機判定 + COMSPEC (2026-06-11)** — ユーザー報告 3 件を根治 (3 つとも .bat
  インタプリタは無実): ① FINALTY「Space でロゴに戻る」= EXEC のファイル全長 256KB 上限が連結データ EXE
  (finmain 628KB 中イメージ 138KB) を弾く → `read_child_image` で MZ ヘッダ記載分だけ読む実 DOS 仕様に。
  ② life100「.bat だと停止」= 合成 ROM に "NEC N-88" が無く Turbo-C BGI の NEC 実機チェックが失敗 →
  E800:0DC0 に "NEC N-88BASIC(86)" (patch 01)。③ Canvas-98 (bio100% 恋塚氏) = COMSPEC 存在チェック →
  env に COMSPEC 追加 (実ファイルは置かず EXEC は正直失敗)。回帰 = batch_test サイクル 3 新設・全テスト PASS
- ✓ **「実行環境ベース完成」ユーザー判断 + プロダクト層パス 2 連 (2026-06-12)** — FINALTY が音源 3 種
  (FM/BEEP/RS-MIDI) で動作確認され「フリーソフトの実行環境としてはベース完成として良いかも」(ユーザー)。
  以後の能動投資はプロダクト層へ: ① 明るいサイドバー配色 (紙系・左黒右紙のコントラスト) + テキスト拡張子
  man/hed/his、② **ファイラ UI 全面整理** — ヘッダ状態機械 (Open/＋Add/× confirm)、`closeBundle()`/
  `resetToIdle()` で**新規ドロップ/閉じる/Stop が機械を HELLO 待機へ完全リセット** (旧: 前ゲーム/TSR が
  走り続けた)、ドロップ=常に新規、選択 2 軸化 (行背景=タップ中/緑チップ=Run 対象)、アイコン専用カラム+
  幾何学記号統一 (絵文字全廃)、ラベル/ステータス英語化 (i18n フリー、散文は日本語)。詳細 CHANGELOG
- ✓ **ファイル単体の Save / ＋Add 読み戻し (2026-06-12、JS のみ)** — タップ中ファイルのダウンロード保存
  (ビューアヘッダの Save) + ＋Add 限定の単体ファイル受け入れ。**出入りとも ASCII 8.3 名限定の対称ルール**
  (SJIS エンコーダ不要・「Save できたものは必ず戻せる」保証)。デバイス名 (CON 等) は拒否。セーブの往復
  永続化・自作 MML/データ持ち込み・グラフィックエディタ作品の回収に。**実機確認済 (ユーザー):
  Canvas-98 の絵を Save→終了→再起動→＋Add で復活 = 往復永続化成立**。あわせてヘッダボタンの空間対応を
  統一 (**左=環境の開閉 Open/× / 右端=ファイル入出力 ＋Add/Save**、View はファイル名の直後
  — 2026-06-13 に「名前の左」から移動、視線の先に置いて気づきやすく)。
  さらに同日: View ポップアップのスクロール残留修正 (display:none 中の scrollTop 代入は no-op、
  表示後にリセット) + **▦ Panel 廃止→仕切り取っ手 (▸/◂) でゲーム画面の最大化⇄復帰** (エッジタブ、
  取っ手は両状態で同位置に常駐)。
  あわせて同日: サイト側棚卸し (旧ディスクブート機構 loadDiskFromBlob/insertHdd 撤去・no-op setDriveName
  削除+エラー表示復活・db/games.json 削除・boot.d88→tools/testdata・DISK_IMAGE_RE に fdd)。詳細 CHANGELOG
- ✓ **設計思想の宣言 (About) + ドキュメント棚卸し + QoL 2 点 (2026-06-13、JS/HTML のみ・Wasm 不変)** —
  初回訪問時に宣言を日英ポップアップ (`#about-text`、紙配色 prose モード、localStorage 既読は閉じた時点、
  再表示は歓迎文末尾の「宣言を読む」リンク)。文面の決定: 第三者牽制なし・「ブート機構を持たない→原理的に
  動かない」の正直表現・固有名は NP2kai のみ+末尾にリポジトリ 1 リンク。**README 全面書き直し** (宣言整合。
  自己起動経路/Phase 進捗/ビルド手順の古いノイズ一掃)、concept.md (.qb 断念・呼び方原則等の決定反映)、
  structure.md (現状化+「games/ 書庫コミット」誤記訂正)、CREDITS (boot.d88=tools/testdata)。QoL:
  **View をファイル名の直後へ** (名前を読んだ視線の先)、**新規ドロップ時の機械リセットを「走っていたとき
  だけ」に** (`machineAtIdle`。リセットの目的は前ゲーム停止のみ — メモリ衛生は毎 Run の reset+pristine
  loader.d88 が保証)。詳細 CHANGELOG
- ✓ **MIDI 大刷新 (2026-06-13〜14)** — ① **MPU-PC98 (MPU98II 0xE0D0) 対応** で huma_ts2 (東方封魔録) の
  MIDI(MPU) モードが鳴る (真因=`mpuenable=0` で 0xE0D0 未 attach、`enable_midi_now` で MIDI レシピ時のみ限定有効化)。
  ② **合成エンジンを VERMOUTH(GUS .pat) → TinySoundFont(MIT, `native/qb_tsf.c`+`native/third_party/tsf.h`) に差し替え、
  GeneralUser GS の SF2 をネイティブ再生**。freepats が GM 72/128 しか無く音色欠落していた問題を根治、音質も向上
  (ユーザー「全く違う音」)。全体リバーブ(Freeverb)を qb_tsf.c に実装 (`qbDebug.midifx`)。VERMOUTH はビルド除外
  (`set(VERMOUTH_SOURCES "")`)・**patch 04 を revert しコア改変は 01-03 のみに縮小**。SF2 は .gitignore +
  `tools/setup_soundfont.sh`・deploy 同梱・ブラウザ遅延 fetch。③ **適応オートクロックを既定 OFF (multiple=20≈486DX2-50)**
  — SF2 のクリア音色で音楽もたつきが顕在化、倍率↑は run_frame 増→音声バッファ枯れの害が利得を上回ると実測判明
  (東方 27 で無変化・Ray 27 で悪化)。`qbDebug.autoclock(1)/multiple(N)` はオプトインに格下げ。詳細 CHANGELOG
- ✓ **みゅあっぷ98 (MUAP98, Packen Software, 修正BSD) を端から端まで動作 (2026-06-14〜15、ブラウザ実機確認済)** —
  MML エディタ/プレイヤー。「書庫が開けない→起動しない→サンプルが開けない」を順に根治: ① **ZIP の
  data descriptor (bit 3) 対応** = LFH のサイズ欄が 0 でも中央ディレクトリ経由で読む + bit 11 UTF-8 名を生 SJIS へ
  戻す (`web/player/archive.js`、`tools/zip_test.js`)。② **起動 .bat の `set` (環境変数) / `cd` (カレント移動) 対応** =
  env を EXEC 子へ継承・`g_cwd` 移動。MUAP98 は env でデータ置き場を知る (`native/dos_loader.c`,`dos_int21.c/h`,
  `batscript.js`,`bridge.js`,`tools/batch_test.js`)。副産物で env ブロック 256→240 byte 超過の潜在バグ (program MCB
  破壊) を根治。③ **FindFirst の `*.*` をディレクトリにも一致** (`.` 入り pattern だけフィールド照合・`.` 無しは
  従来の char glob 維持で `HTJL`≠`HTJL.COM` を保つ=GS100 救済) + **8.3 空白パディング名の open** (`read_dos_rel` で
  空白除去、`tools/wildcard_find_test.js`)。全テスト/bio100 triage 回帰ゼロ。残: MML エディタ (CAL.COM) の
  カーソル移動 (別系統・未着手)。詳細 CHANGELOG 2026-06-14/15
- ✓ **PMD (.M) FM 音楽をブラウザで再生 + クリーン素性エンジン自前ビルド (2026-06-16、ブラウザ実機確認済)** —
  東方旧作 BGM 等 PC-98 同人 FM 音楽の標準 `.M`(PMD)を Path B (本物の KAJA PMD ドライバを HLE-DOS で常駐演奏)
  で発音。鳴らす修正は **自前コードのみ・`core/np2kai` 改変ゼロ**: `native/bridge.c` で 86 ボードを INT5/IRQ12 に
  (`snd86opt|=0x0C`、PMD が ISR を hook する割り込みベクタと一致。既定 IRQ3 だと食い違い無音) + `shell.asm` の
  シーケンス完了後を `AH=4Ch` 終了→`sti`+hlt アイドルに (常駐演奏 ISR が IF=1 で刻み続ける。IF=0 アイドルが
  「最初の1音だけ」の真因)。**クリーン素性エンジン** = KAJA 2019 自由公開ソースから `PMD86.COM`+`PMP.COM` を
  自前ビルド (`tools/pmd_build/build_pmd.sh`、MASM 互換 UASM も自前ビルド・OPTASM→UASM 移植補正・`uasm -bin -Zm`)。
  1997 バイナリ/C60 PMDWin は不使用。CREDITS に KAJA 項。対象は PMD `.M` (大多数)・`.M2`/`.M26` は後回し。
  回帰 `tools/pmd_test.js`。詳細 CHANGELOG 2026-06-16
- ✓ **② 同梱配線 + 音楽ポップアップ UI 完了 (2026-06-16、JS/HTML/asset のみ・Wasm 不変)** — `.M` を
  「ファイラでタップ→下部に曲名/作曲/作者コメント+▶Play→クリーン HTML プレイヤー (Play/Stop) で再生」。
  自前クリーンビルドの `PMD86.COM`+`PMP.COM` (35KB) を `web/assets/pmd/` に同梱し初回再生時に遅延 fetch→
  /run へ注入→既存シーケンス経路 (`PMD86`→`PMP <曲>`) で起動 (engine は一覧から隠す)。**PMD `.M` の埋め込み
  memo (作者注釈) を JS で解析** = `web/player/pmdmeta.js`、末尾インデックス表 + 区切りバイト判定 + 自己参照
  チェーン整合トリムで slot[3]=曲名/[4]=作曲/[6..]=コメントを抽出。**東方旧作 BGM コーパス 45 本で全数検証**
  (`tools/pmd_meta_test.js`、ZUN 本人コメントまで復号)。回帰ゼロ (pmd_test 2/0・touhou 4/0・batscript 51/0 等)。
  **ブラウザ実機で発音確認済 (2026-06-16、永遠の巫女)** + フィードバック反映 (画面被覆/閉じたら停止/ボタン活殺/
  ラベル付き情報/**一時停止=frame 凍結**)。詳細 CHANGELOG 2026-06-16
- ✓ **PMD ② Part 2: 再起動レスの曲差し替え (2026-06-16、native + Wasm 再ビルド)** — 「デフォルト PMD86 常駐、
  ソフト Run でまっさら reset」(ユーザー設計) を実装。**shell.asm に待機経路 (AX=2)** を足し、フックが次曲を
  受けたら別 DOS セッションを起こさず PMP の cmdtail を書き換えて EXEC (`qb_dos_stage_music`/`qb_dos_music_play`、
  `native/dos_loader.c`)。PMD86 バナーは EXEC 後 `ESC[2J` で消す。bridge.js は `musicSessionUp` で初回だけ起動・
  以後は曲差し替え (reset なし)。**既存 AX=0/1 経路不変=通常ゲーム/.bat に影響なし**。検証 `tools/pmd_session_test.js`
  (曲 A→B を reset なしで両方発音、3/3) + 全回帰 PASS。ブラウザ実機 T3 確認待ち
- ✓ **音まわりの仕上げ 3 件 (2026-06-17)**: ① **OPNA リズム音源 (ハイハット等) の欠落を根治** — ユーザーが
  実機 YouTube と聴き比べて発見。真因 = OPNA 内蔵リズム (BD/SD/シンバル/ハイハット/タム/リム) のサンプル
  `2608_*.wav` を未同梱で fmgen/opngen が読めず無音。本物 ROM はヤマハ IP で同梱不可 → font.bmp と同じく
  **クリーン代替** (メモル氏 2608modoki、組み込み/再配布自由・ROM ダンプでない自作) を `web/assets/rhythm/`
  同梱・`bridge.js` が起動時にデータ dir へ fetch (**JS/asset のみ・Wasm 不変**)。実証 = 東方曲で peak 上昇+
  L/R パン (実機の「左から」と一致)、回帰 `tools/rhythm_test.js` 2/0。**ブラウザ実機確認済 (2026-06-17、ユーザー
  「以前と全然違う・リズム系が乗ってとてもいい」)**。② **音源ボードを 86+ADPCM (SOUND_SW=0x14)
  に既定化** (.PPC 系の将来の声部用) **— 2026-06-17 中に revert (0x04 に戻す)**。現コーパスに実需ゼロ
  (no-op) で OPNA の実時間挙動を変える副作用があり、下記ザルバール調査で一時容疑にもなったため据え置き。
  ③ **PMD のステレオ/モノ調査を決着** — uke10.m (KAJA パンサンプル) で最大 L/R 非対称 19.8% を実証し、PMD パン
  処理が end-to-end で効くことを確認 (東方の .M がモノラル気味なのは元曲がセンター定位だから=忠実)。回帰
  `tools/pmd_stereo_test.js` 2/0。詳細 CHANGELOG/[[reference_opna_rhythm_samples]]
- ✓ **ザルバールの本編 FM 音楽が無音化する回帰を根治 — 86 ボード IRQ12 を全ブート既定に (2026-06-17、JS のみ・
  Wasm 不変)** — ユーザー報告「ザルバールのオープニング (BEEP) は鳴るがタイトル/本編 (FM) が無音、東方/.M は正常」。
  真因 = `deae233` で `snd86opt|=0x0C` (IRQ12) をグローバル撤去 (東方のためと誤判断) したのが、**IRQ12 を決め打ち**
  する 86 ボード FM ドライバ **SIZ3/SIZ4P (ザルバール)** を巻き添えで無音化していたこと。PC-98 86 ボードの FM
  ドライバの多く (SIZ3/我々の PMD86) は **INT5=IRQ12** を前提に ISR を hook する de-facto 標準で、既定 IRQ だと
  FM タイマ割り込みが ISR に届かず曲送りが止まる。**KAJA PMD86 (東方同梱) は board 設定に追従**するので IRQ12 でも
  既定でも鳴る → **IRQ12 を全ブート既定にすれば 3 つ全部満たす** (実機 A/B でザル/東方/.M すべて正常を確認)。修正 =
  `bridge.js` loadLoaderDisk が毎ブート `np2kai_set_pmd_irq(1)` を既定で呼ぶ (上書き `qbDebug.snd86irq(0|1)` を残す)。
  **この回帰はブラウザ実時間でだけ顕在化 (ヘッドレスでは FM が鳴り続け再現せず)** = deae233 の IRQ12 回帰と同クラス。
  教訓: deae233 の「IRQ12 が東方を壊す」は誤帰属だった ([[feedback_hle_honest_failure]] の検証=実機 A/B で断つ)。詳細 CHANGELOG
- ✓ **VZ Editor 対応 — テキストエディタ互換クラスの実証 (2026-06-20、ブラウザ実機確認済)** — PC-98 版 VZ Editor
  (BSD-3 公開ソース vcraftjp/VZEditor) がブラウザで起動・編集可能に。MS-DOS Player を「似た思想」として発見した
  周辺調査が発端。**1 つの修正で VZ + みゅあっぷ98 (MUAP) の両エディタでカーソルが動く**=「フルスクリーンエディタは
  同じ互換クラス」の実証 (MUAP CAL.COM の既知カーソル課題も無償解決)。① **Illegal mode! 根治**: VZ の checkhard は
  INT DCh と INT DDh のベクタ offset が等しいと起動拒否 (実機は別ルーチンで offset 相違)。未使用 INT を全部同一 IRET
  スタブに向けて一致していた → IRET スタブを 16byte パッド化し各ベクタを `EE40+(vec&0x0F)` に分散 (裸 IRET のまま
  ゼロ回帰)。② **INT DCh (PC-98 ファンクション/編集キー定義 BIOS) を正直実装** (`native/dos_int21.c` + 新トランポリン
  0xFEEA0 + patch 01): VZ は setkey(CL=0Dh)で自前キー定義表を流し込み、ソフトキーが定義文字列 (`0x7F`+コード) を発行
  する仕組みに依存。INT DCh が no-op だったためカーソルキーが char=0x00 のまま誤解釈 (ステータス行に全角Ｃ/Ｐ) され
  ていた。CL=0Ch/0Dh を実装し DOS コンソール入力が install 表を引いてソフトキーを翻訳。編集キー並び
  RLUP/RLDN/INS/DEL/↑/←/→/↓/CLR/HELP (slot=scan−0x36、VZ の表を一時 dump で確定し off-by-one を修正)。非対応ゲームは
  表未 install で従来どおり=ゼロ回帰。恒久回帰 `tools/vz_test.js`+`tools/vz_cursor_test.js` (VZ.COM/DEF は BSD-3 同梱)。
  VZ の fkey 行ラベル表示 (装飾) は未対応 (常時 strip は EZKEY.COM が別途出す=実機でも VZ 単体では出ない、2026-06-24 決着)。
  詳細 [[reference_msdos_player]] [[project_text_editor_class]] / CHANGELOG
- ✓ **JED (jed194n.lzh) のカーソルキーを根治 (2026-06-24、native + Wasm)** — テキストエディタ互換クラスの「残=JED 別機構」を消化。
  真因 = INT DCh setkey の **1 キー単位 API** (`CL=0Dh, AX=key# 1..31, DS:DX=発行文字列`) 未対応 (VZ は全体一括 AX=0)。JED は
  各ソフトキーに `FF <scancode>` を定義し **0xFF プレフィックス方式** (AH=06 で 0xFF 検出→AH=07 で scan) で読むが、旧 hook は
  AX=0 前提で JED の使い捨て 2byte バッファを掴み softkey_fill がゴミを読んでいた。修正 = C 側正準テーブル `g_keytbl` を全体一括
  /1 キー単位の両 API で populate (`native/dos_int21.c`)。非エディタはゼロ回帰。回帰 `tools/jed_cursor_test.js` (再配布不可で SKIP 可)。
  **ブラウザ実機 T3 確認済 (2026-06-24、ユーザー)** = カーソルキーで位置表示・カーソル行の下線が移動。**残**: JED の点滅ハードウェア
  カーソルが左上に居座る — JED はエディタ面に自前カーソルを描かず (ユーザー指摘: JED.CFG にカーソル色定義が無い) GDC カーソル頼りだが
  位置を一切設定しない作り (CCHAR 形状のみ・CSRW/AH=13h 皆無)。バイナリに位置設定コードが無く実機でも同じはず。詳細 CHANGELOG / [[project_text_editor_class]]
- ✓ **ホスト IME 日本語入力 (2026-06-21、ブラウザ実機確認済)** — 自由に再配布できる PC-98 FEP が乏しいため、ゲストに
  FEP を常駐させず **ブラウザ/OS の IME 確定文字列を Shift-JIS にしてゲストの DOS 文字入力へ注入**する経路を新設
  (FEP/辞書のライセンス問題を回避)。native = 注入 FIFO + `np2kai_inject_text`、実 BIOS キーバッファ 0x502 へペース供給
  (`inject_pump`) し **BIOS INT 18h 直読み / DOS AH=01-08 / AH=0Ah を一律カバー**(VZ 起動時 Y/N プロンプトも可)。
  JS = `encodeSjis` (内蔵 TextDecoder の逆引き・依存ゼロ)+ `#stage` 下部の常設ツールバー (✎ トグル、Enter 送信/空欄
  Enter=改行)。回帰 `tools/ime_inject_test.js`+`tools/ime_inject_bios_test.js`。詳細 [[project_host_ime_input]] / CHANGELOG。
  あわせて **モバイル対応**: `100vh`→`100dvh` (アドレスバー追従) + `interactive-widget=resizes-content` (ソフトキー
  ボードで入力欄を残す)。**バーチャルタッチパッドは試作したが後回し** (固定中心で指追随感が出ず、画面スティックは
  弾幕で物理パッドに劣る→物理 Gamepad API/DualSense + キーボードが正解。詳細 [[project_gamepad_support]])。
  **2026-06-23 拡張 (JS のみ・実機確認済「自然すぎて気持ち悪い」)**: 入力欄が **フォーカス中・空・変換中でない**
  ときだけ矢印/BS/DEL/Enter/Home/PageUp/PageDown/Insert/Tab をゲストへ透過 (空欄ではどれも欄内編集として no-op
  なので「打って送る」を壊さず、欄を構えたままメニュー移動・エディタのカーソル操作ができる = 「空の IME バー =
  キーボードへの透明な窓」)。keyup は `pressed` ベースで透過し押しっぱなし無し。空欄 Enter は injectText(CR) から
  実スキャンコード透過に統合 (上位互換)、文字あり Enter だけ injectText+`stopPropagation`。Tab は欄にフォーカスが
  ある間は常に preventDefault でフォーカスを留める (空欄なら実 Tab 0x0f をゲストへ、文字ありは no-op)。
- ✓ **ia16-elf-gcc 製 EXE が起動できない (stage -9) を根治 (2026-06-21、ブラウザ実機確認済)** — モダンツール
  チェーンでビルドされた PC-98 homebrew (yarufu/pc98 の ADV98.EXE = ChatGPT+Codex 製 16 色 ADV エンジン) が
  ドロップ→Run で真っ黒のまま起動段階ごと失敗していた。真因 = **MZ relocation の「負」セグメント**。ADV98 は
  reloc 1 本が `r_seg=0xFFFE`/`r_off=0xF2FC`、これをフラットに `r_seg*16+r_off=0x10F2DC` (1.1MB) と計算し本体
  (82KB) 外と誤判定して `-9`。実 8086/MS-DOS は load_seg との加算を **16-bit でラップ** ((0x0110+0xFFFE)&0xFFFF
  =0x010E) → image offset 0xF2DC (格納語 0x0F65=初期 SS の正規 reloc) に解決する。`FFFE:0020` の CS:IP もこの
  ラップ前提のトリック。修正 = `reloc_body_off()`=`(r_seg*16+r_off)&0xFFFFF` で **stage/EXEC 子/overlay の
  3 経路 × 検証+適用 = 6 箇所**を統一 (`native/dos_loader.c`)。正規の小さい `r_seg` では no-op で回帰ゼロ。
  **ADV98 が本編デモまで自動起動 (ユーザー確認)**。`ia16-elf-gcc` 製 homebrew 全般に効く。詳細 CHANGELOG /
  [[reference_ia16_exe_negative_reloc]]
- ✓ **サブディレクトリ起動時の CWD 設定で Super Depth を救済 (2026-06-22、ブラウザ実機確認済)** — ゲームが書庫内の
  サブフォルダ (例 `DEPTH/depth.exe`) に在る状態で直接 Run すると起動しない、というユーザー報告を根治。真因 =
  Run のたびに `g_cwd` がルートへ戻る (`qb_dos_tty_reset`) だけで**起動 image のディレクトリへ CWD を合わせる処理が
  無く**、`depth.exe` が `depth.bos` 等を相対パスで開くとルート基準で探して見つからずデータ読み込み段で失敗していた。
  実機でも `A:\>DEPTH\DEPTH.EXE` は CWD=ルートで失敗する (当時は `cd DEPTH` してから実行) ので、欠けていたのは
  「ファイラからサブディレクトリ内を Run した時にユーザの `cd` 相当を代行する」点。修正 (案A) = staging 時にパスから
  ディレクトリを抽出 (`stage_dir`/`g_stage.dir`) し、loader-start の `qb_dos_tty_reset()` 直後に `qb_dos_set_cwd_rel`
  で起動時 CWD をそこに設定 + argv[0] も `A:\DEPTH\DEPTH.EXE` にサブディレクトリ込み (`native/dos_loader.c`,
  `dos_int21.c/h`)。JS は C の image 名引数に表示 label でなく実 /run 相対パス (`target.name`) を渡すよう配線
  (`bridge.js`/`emu-worker.js`)。`.bat` の `cd` 経路 (東方等で実証済) と挙動的に等価で、ルート直下起動は `dir` 空で
  no-op (回帰なし)。回帰 `tools/subdir_cwd_test.js` (6/0) + 既存全 PASS + bio100 triage ベースライン一致。
  **2026-06-22 追補: `stage_name`/`stage_dir` の C 側 0x5C 誤分割を DBCS-aware 化して根治** (他関数と統一、
  ASCII 名は従来同一・無 downside)。端から端の日本語名サブディレクトリ動作は JS→C のパス符号化都合で未実機確認。詳細 CHANGELOG
- ✓ **サブディレクトリ起動 .bat (cd + 本体) で子の argv[0] にサブディレクトリを含める (2026-06-23、native + Wasm)** —
  上記の直接 Run 救済の後、ユーザーがルートに `depth.bat` (`cd depth` / `depth`) を作って Run するとエラーになった報告を根治。
  真因 = `.bat` の cd+本体はミニ COMMAND.COM が `\depth\depth.exe` を `AH=4Bh` EXEC する経路で、子 env を作る
  `build_child_env` が **basename しか受けず argv[0]=`A:\DEPTH.EXE`** (サブディレクトリ欠落) になっていたこと。
  `depth.exe` は argv[0] の最後の `\` でデータ dir を切り出すので `A:\` を見て破綻。直接 Run (`build_env`) は
  `g_stage.dir` 込みで `A:\DEPTH\DEPTH.EXE` を作るので動く、の非対称。修正 = EXEC ハンドラが argv[0] 用に
  `read_dos_rel(DS:DX)` の **/run 相対フルパス**を `qb_dos_exec_load` の新引数 `child_path` で渡し、`build_child_env`
  が `A:\[SUB\DIR\]NAME` を組む (SFT note 用 basename `child_name` は別途維持)。ルート直下子は basename のままで
  ゼロ回帰。回帰 `tools/subdir_bat_argv0_test.js` (4/0) + 既存全 PASS + bio100 triage ベースライン一致 (ALIVE20/CRASH0)。
  **ブラウザ実機確認済 (2026-06-23、ユーザー)**。再発防止に argv[0] 整形を共有ヘルパ `format_argv0` に集約
  (`build_env`/`build_child_env` のドリフトが真因だった)。詳細 CHANGELOG / [[feedback_dos_env_argv0]]
- ✓ **PI (Pi 形式) 画像のプレビュー対応 (2026-06-25、JS のみ・Wasm 不変・ブラウザ実機確認済)** — MAG (MAKI02) と
  並ぶ PC-98 同人 CG の 2 大形式の片割れ。`web/player/piimage.js` = 自前 Pi デコーダ (柳沢明氏考案・電脳科学研究所/BERO
  実装、組み込みローダ pi24.lzh の `piloadc.asm` を仕様参照・逐語移植せず)。**ヘッダは BE/LE 混在** (ext_size/width/
  height=BE、palflag/aspect=LE)・**4bit パレット (R,G,B 順・上位ニブル)**、圧縮は位置予測コピー+Elias-γ 長+MTF カラー
  符号化。VRAM 変換不要なので上に番兵 2 行のフルフレーム展開に単純化。`openImage` がシグネチャで MAG/PI を自動判別。
  **検証 = 同一画像の MAG/PI ペア (C165_206.LZH、版権物で非コミット) で色番号をピクセル突合**し c165/c206 全 256000px
  が MAG と一致 (`tools/pi_test.js`、素材不在で SKIP)。ライセンスは MAG 以上にクリーン (転載/改変/営利自由・条件は
  「Pi を使う旨を一言書く」→ CREDITS)。次候補 = PIC (Pi の前身)・GIF/BMP。詳細 CHANGELOG / [[project_readme_viewer_qol]]
- 次: Phase 3 一区切り。残は Ray の音楽再生まで通すか (Phase 4 候補)、TH03-05 SFX の JS 側取り込み (QoL)、
  GETS の BIOS 調査、bio_100% 群のブラウザ実プレイ確認 (ユーザー進行中)。永続化はコンセプト練り直し待ち
  (ユーザー判断、「変更分だけ zip 書き出し」=状態のみエクスポート案は Save/＋Add の段階 2 候補)。
  FINALTY・life100・Canvas-98 はブラウザ確認済 (2026-06-11)
- ターゲット: フロッピーベース・2D・〜1998 年の同人/フリーソフト (期待カバー率 80〜90%)
- テストスイート: さめがめ ✓ / ザルバール ✓ / Super Depth LZH ✓ / Ray ✓(オープニング画像表示・罫線根治) / うさちゃん列車 ✓ /
  東方旧作体験版 4 作 ✓ — TH02 封魔録 (2026-06-10)・TH03 夢時空・TH04 幻想郷・TH05 怪綺談 (2026-06-11 全作
  ブラウザ実機確認、書庫/SFX ドロップ→GAME.BAT 分岐インタプリタ経由)
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
