# QB 作業状況

## ✅ ia16-elf-gcc 製 EXE 起動 (MZ 負 reloc セグメント) — 根治・デプロイ済 (2026-06-21)

モダンツールチェーン (`ia16-elf-gcc` / 近年の GNU ia16 binutils) でビルドされた PC-98 homebrew が
**起動段階で stage -9 ごと失敗**していたのを根治。発端は yarufu/pc98 の ADV98.EXE (ChatGPT + Codex 製
16 色 ADV エンジン) がドロップしても真っ黒で動かないというユーザー報告。真因 = MZ reloc の「負」セグメント
(`r_seg=0xFFFE`) をフラットに `r_seg*16+r_off`=1.1MB と計算し body 範囲外と誤判定していた。実 8086 は
load_seg との加算を 16-bit でラップ → image offset 0xF2DC (= 初期 SS の正規 reloc) に解決する。
`reloc_body_off()`=`(r_seg*16+r_off)&0xFFFFF` で stage / EXEC 子 / overlay の 6 箇所を統一。正規の小さい
`r_seg` では no-op で回帰ゼロ。**ブラウザ実機で ADV98 が本編デモまで自動起動 (ユーザー確認)**。詳細は
CHANGELOG / [[reference_ia16_exe_negative_reloc]]。

## ✅ VZ Editor 対応 (テキストエディタ互換クラス) — 完成・デプロイ済 (2026-06-20)

PC-98 版 VZ Editor がブラウザで起動・編集できるように。BSD-3 公開ソース (vcraftjp/VZEditor) を読んで
推測でなく実機契約どおりに正直実装。**ブラウザ実機 T3 確認済み**。1 つの修正で VZ + みゅあっぷ98 (MUAP)
の両エディタが点灯 = 「フルスクリーンエディタは同じ互換クラス」の実証 (MUAP CAL.COM の既知カーソル課題も
無償解決)。

- **Illegal mode! 根治**: VZ の checkhard は INT DCh と INT DDh のベクタ offset が等しいと起動拒否する。
  未使用 INT を全部同一 IRET スタブに向けていたため一致 → IRET スタブを 16byte パッド化し各ベクタを
  `EE40+(vec&0x0F)` に分散 (`native/dos_loader.{c,h}`)。挙動は裸 IRET のままゼロ回帰。
- **INT DCh (ファンクション/編集キー定義 BIOS) を実装**: VZ は setkey(CL=0Dh)で自前キー定義表を流し込み、
  ソフトキーが定義文字列(`0x7F`+コード)を発行する仕組みに依存。CL=0Ch/0Dh を実装し、DOS コンソール入力が
  install 表を引いてソフトキーを翻訳 (`native/dos_int21.c` + トランポリン 0xFEEA0 + patch 01)。編集キー並び
  RLUP/RLDN/INS/DEL/↑/←/→/↓/CLR/HELP (slot = scan−0x36)。非対応ゲームは表未 install で従来どおり=ゼロ回帰。
- 恒久回帰: `tools/vz_test.js` (Illegal mode 不発) + `tools/vz_cursor_test.js` (↑↓←→ で行:桁が動く)。
  VZ.COM/DEF/README は BSD-3 で `tools/testdata` に同梱。詳細 CHANGELOG 2026-06-20。
- **JED (jed194n.lzh) のカーソルキー = 根治済 (2026-06-24)**: 真因は INT DCh setkey の **1 キー単位 API**
  (`CL=0Dh, AX=key#, DS:DX=発行文字列`) 未対応 (VZ は全体一括 AX=0)。JED は各ソフトキーに `FF <scancode>`
  を定義し 0xFF プレフィックス方式で読む。C 側正準テーブル `g_keytbl` を両 API で populate して解決。
  回帰 `tools/jed_cursor_test.js`。**残**: JED の点滅ハードウェアカーソルが左上に居座る (JED が GDC へ
  位置を一切設定しない作り = HLE から正しい位置に置けない・要実機突合)。詳細 CHANGELOG 2026-06-24。
- **残 (未着手)**: VZ のファンクションキー行 (F1-F10 ラベル) が画面に出ない (発行自体は機能・ラベル表示
  のみ未=装飾。常時 strip は EZKEY.COM が別途出す=実機でも VZ 単体では出ない、と 2026-06-24 に決着)。

## ✅ PMD (.M) FM 音楽再生 — 完成 (2026-06-16)

東方旧作 BGM 等の PC-98 同人 FM 音楽 `.M`(PMD)をブラウザで再生可能に(NEC BIOS / MS-DOS 不使用)。
Path B = 本物の KAJA PMD ドライバを HLE-DOS で常駐演奏。**ブラウザ実機確認済み**。

- 鳴らす修正: `native/bridge.c`(86 ボード IRQ12 = PMD の hook と一致)+ `tools/dos_loader/shell.asm`
  (シーケンス後を `sti` アイドルに = 常駐 ISR が IF=1 で刻み続ける)。`core/np2kai` 改変ゼロ。
- クリーン素性エンジン: KAJA 2019 自由公開ソースから `PMD86.COM` + `PMP.COM` を自前ビルド
  (`tools/pmd_build/build_pmd.sh` + README、UASM も自前ビルド)。CREDITS に KAJA 項。1997 バイナリ/PMDWin 不使用。
- 対象 = PMD `.M`(大多数)。`.M2`(PPZ8=要 EMS)/`.M26`(26K)は別ドライバ要で後回し。回帰 = `tools/pmd_test.js`。
- **✅ ② 同梱配線 + 音楽プレイヤー UI 完了**: `PMD86.COM`+`PMP.COM`(35KB)を `web/assets/pmd/` に同梱・初回再生時に
  遅延 fetch。ファイラで `.M` タップ→下部に曲名→▶Play→クリーン HTML プレイヤー(Play/Pause/Stop・経過時間)。
  PMD `.M` の埋め込み memo(曲名/作曲/編曲/コメント)を JS 解析(`web/player/pmdmeta.js`、コーパス 45 本検証 `tools/pmd_meta_test.js`)。
- **✅ 再起動レスの曲差し替え**: PMD86 常駐の音楽セッション化(shell.asm に待機 AX=2 + `qb_dos_stage_music`/`qb_dos_music_play`)で
  どの書庫の曲も reset なしで切り替え。Run でまっさら reset。回帰 `tools/pmd_session_test.js`(曲 A→B reset なし両方発音)。
- **✅ 仕上げ**: 一時停止=frame 凍結 / 停止=0 リセット / 音が出てから計時 / 起動音(ピポ=BEEP)は音楽セッションのみミュート
  (`np2kai_set_beep_mute`、FM 曲は無傷) / 音楽画面中央に "HELLO QuuBee" / ループは作者意図どおり継続(制御せず)。
- 詳細は CHANGELOG 2026-06-16 / `tools/pmd_build/README.md`。

## ✅ 音声スレッド再設計 (emulator を Web Worker へ) — 完成・既定化 (2026-06-19)

FM 音楽の「テンポの揺れ・フレームが詰まるスキップ」を根治。真因は **音声配信でなく emulation の cadence**
(emulator が rAF 律速でメインスレッド飽和)。**emulator を Web Worker へ移行**して根治。`?worker=1` で検証 →
**worker = フルアプリ**(フィラー/ビューア/音楽プレイヤー/MIDI/Save/pause/gamepad/計時)→ **既定化**まで完了。
ブラウザ実機で映像滑らか・音滑らか・揺れ根治・バックグラウンド再生を確認、従来パス(`?local`)は挙動不変。

- アーキ: `emu` ファサード(local/worker)、モード対応 closure(`async main`+`makeStubM`+`makeWorkerEmu`、bridge.js)、
  `emu.start(onFrame)`、共有 `drawFrame`、音声駆動 production + SAB リング + AudioWorklet
  (`web/player/emu-worker.js` / `emu-audio-worklet.js`)。Stage0=COOP/COEP(`web/_headers`+`tools/devserver.js`)。
- 既定化: `QB_USE_WORKER` = SAB+`crossOriginIsolated`+AudioWorklet 対応環境で ON、非対応/`?local` は自動フォールバック。
- 計測/balance: `qbDebug.audioStats()` / `qbDebug.vol()`(`tools/vol_test.js`)。
- 詳細: [docs/audio_worker_migration.md](docs/audio_worker_migration.md) / CHANGELOG 2026-06-19。
- **残(任意・保留)**: 下げ側のみの適応クロック(低スペック機でプチノイズ時に倍率↓、現状 multiple=20 固定)。
  **2026-06-19 ユーザー判断で保留**: ミドルスペック Chromebook で東方旧作の弾幕でも不快になるのは稀 =
  現状 20 固定で実用上問題なく、他環境への影響も小さい見込み。症状(音切れ/もたつき)が実際に観測されたら着手する
  守りの機能なので投機的実装は見送り。着手時は先に `set_clock_multiple` を worker へ結線する必要あり(現状ノブは
  stub M に向き worker では no-op)。上げ側(ターボ)は busy-wait タイトルが速すぎる互換性リスクで据え置き推奨。

## 📌 後回しの互換性メモ (低優先・やらないかも)

- **kai_ts1 (TH05 怪綺談): 起動時に `BGM=86 + SFX=BEEP` を選ぶと暗転** (2026-06-19、ユーザー報告)。
  ゲーム内で同設定に変更すると OK / TH04 (gen_ts1) は同設定で起動可 / **worker 無関係 (`?local` でも同症状)**。
  → FM(IRQ12)+BEEP のランタイムは正常。怪しいのは「起動時コンフィグ経路」(`zun -s`/`zun -o` が書く設定を
  op.exe が初回に読む) 限定。実機でも起こる作り側のクセ (ゲーム自体の不具合) の可能性あり。回避策あり・非デフォルト設定。

- **worker パスの audio rate に対応外フォールバックが無い** (2026-06-19、コードレビュー)。`makeWorkerEmu` は
  `audioCtx.sampleRate` をそのまま worker に渡すだけで、ローカルパスにある「`np2kai_set_audio_rate` 対応 8 種
  以外なら近い対応レートで作り直す」処理が無い。ブラウザが要求 48000 を無視して変則レートを返すと、emulator は
  既定レートで生成・AudioWorklet は実レートで再生 → ピッチ/速度ずれ + リングのドリフト (無言の劣化、クラッシュ無し)。
  → **影響は狭い**: モダンなスマホ/PC はネイティブが 44100/48000 (対応内) で要求も honor、マイク非使用なので
  BT-HFP の 8000/16000 にも落ちない。実害が出うるのは**ラズパイ等 SBC / 変則 ALSA・USB-DAC** くらい。回避=`?local`
  (従来パスはフォールバックあり)。対応するなら「rate 確定 → ワークレット配線」の順序整理 + `SUPPORTED_RATES` 共有化。

- **キーリピート (押しっぱなしの連打) が効かない** (2026-06-30、ユーザー指摘・判断保留で TODO 化)。
  原因 = `web/player/bridge.js:2091` が **OS のオートリピート (keydown 連射) を意図的に捨てている**
  (`if (pressed.has(e.code)) return; // OS のオートリピートは無視`)。NP2kai 側は機構を持っており、
  `keystat_down` は既押下キーへの再 keydown で **break+make を出して新規キーストロークを生成**する
  (`keyctrl.keyrep=0x21` で repeat 有効・修飾キーは `KBEX_NONREP` で対象外)。JS が捨てているので一切
  リピートしない。実機 PC-98 はハード auto-repeat するので、これは忠実性のギャップ。
  - **なぜ捨てていたか (推測)**: 押しっぱなしアクション (東方/Super Depth) を滑らかに保つため。リピートを
    送ると hold 中に break+make が挟まる。ただし ① break/make は連続送出でフレーム単位ではほぼ「押下」維持
    ② キー状態 sense (INT 18h AH=04h / keystat.ref) を読むゲームは ref が常時「押下」で完全に無傷。
    実害が出うるのは INT 09h を hook して自前 bitmap を作る系のみ (それも batched でほぼ問題ない見込み)。
  - **案A (JS のみ・即可逆)**: `bridge.js` keydown で OS リピートも `emu.keyDown(code)` に転送
    (`pressed.has` でも return せず再送・`pressed` 追跡は keyUp 用に維持)。修飾キーは NP2kai が NONREP で
    弾くので暴発なし。Wasm 再ビルド不要。OS のリピート間隔をそのまま使う。
  - **案B (native・より忠実)**: `np2cfg.keyrepeat_enable=1` + `keyrepeat_delay`/`keyrepeat_interval` を
    設定し NP2kai 自身にタイプマティック生成させる (`keystat_send`/`keyrepeat_proc`、実機同様「最後に押した
    キーだけ」リピート、host は keydown 1 回)。ただし `GETTICK()` ベースなので Wasm 実時間挙動の確認が要る。
    delay/interval 未設定 (=0) だと毎フレーム連射になるので値設定必須。`keyrepeat_proc` は pccore.c:1881 で
    毎リセット呼ばれる (enable gate 付き)。
  - **判断保留点**: アクションゲーム (東方/Super Depth) への回帰リスク。実装するなら案A を入れて
    ブラウザで ①テキスト/メニューのリピート ②東方・Super Depth の移動カクつき無し を実機確認 → 駄目なら
    revert か案B/キー限定へ。挙動変更なので要ユーザー判断。

- **プリンタ出力 → ブラウザ/Web API (印刷キャプチャ) — アイデア段階・面白枠** (2026-06-30、ユーザー再言及。
  元は gist の INT 機能を眺めていた流れで「11h あたりと Web API を繋いだら面白いかも＝エディタから印刷できる？」)。
  現状 DOS の印刷経路は捨てている: **INT 21h AH=05h (プリンタ 1 文字出力) 未実装**、**handle 4 (PRN) への AH=40h は
  `fh_get(4)=NULL` でエラー**、INT 17h (BIOS プリンタ) も未対応。これを捕捉してブラウザ側に出すと「VZ 等の
  エディタから印刷」が成立する。**完全クリーン (サーバ不要・全クライアント側)**。実装案: AH=05h と handle 4 の write を
  捕捉 → bridge 経由で JS へ → 『印刷ジョブ』として蓄積し、ダウンロード保存 / 別窓ビューア表示 / `window.print()` 等へ。
  テキストは `decodeSjisText` で読める (SJIS)。優先度低だが QuuBee の「周辺文化の再体験」軸とは相性良い (印刷 = 当時の
  出力体験)。stdin/stdout が整った今、stdprn/PRN を足すのは自然な続き。
  - **テキストのみではない点に注意**: PC-98 の印刷は **ESC/P** バイトストリームで、①テキスト(ANK/SJIS) ②制御コード
    (改行/改ページ/フォント) ③**ビットイメージ・グラフィック** (`ESC *` / `ESC K/L/Y/Z` 等のラスタ) が混在する。ワープロ/
    お絵描き/グラフ系は画像も印刷する。スコープは 3 段階で選べる: **①生バイト .prn 保存** (形式非依存・最小) /
    **②テキストのみ展開** (印字可能文字だけ拾い制御コード破棄・エディタ向き・易) / **③ESC/P 完全レンダ** (テキスト+
    ビットイメージを canvas に描き『印刷結果の画像』を生成・忠実・重)。周辺文化軸なら ③ が理想だが ② から入るのが現実的。

## 🧹 リファクタ予定 (技術的負債・振る舞い不変)

- **起動 .bat の ② (線形列) 経路を ③ (文インタプリタ) に統合する** (2026-06-23、Exhibit B)。現在 .bat の起動は
  3 経路に分岐している:
  - ① `resolveMain` → 単発起動 (`stageAndRunImage`)
  - ② `resolveSequence` → `qb_dos_stage_script` (制御フロー無し・複数コマンドの線形列。音源 TSR ラップ等)
  - ③ `buildStatements` → `qb_dos_stage_batch` (if errorlevel/goto/cd/set 入り。C 側文インタプリタ)

  ③ は CMD 文だけの列も表現できるので **② は ③ の部分集合** (歴史的に ②=2026-06-03 が先、③=2026-06-10 が後から
  来て ② をそのまま残した)。重複している実体:
  - JS: `web/player/batscript.js` の `resolveSequence` (line ~134) と `buildStatements` (~161) / `bridge.js`
    Run ハンドラ (~1699-1722) の `hasControlFlow||hasEnvOps` 分岐 + `stageAndRunScript`
  - C: `native/dos_loader.c` の `qb_dos_stage_script` (~688) ⇔ `qb_dos_stage_batch` (~781) が両方
    `stage_shell_image` で文テーブルを組む
  - ワイヤ形式が 2 種: ② = `"PATH\tARGS\n…"` / ③ = `"C\tPATH\tARGS\n…"`

  **統合案**: 全 .bat を ③ (buildStatements → stage_batch) に通し、② 専用の `resolveSequence` /
  `qb_dos_stage_script` / `stageAndRunScript` / ② ワイヤ形式を撤去 (bridge.js の分岐も 1 本に)。振る舞いは不変
  (③ は線形列を CMD 文列として既に正しく実行する)。番をするテスト = `tools/batscript_test.js` /
  `tools/batch_test.js` / `tools/touhou_test.js`。**先に batscript_test が ② 経路 (resolveSequence) を検証して
  いるか確認**し、② を消すなら同等の ③ 検証に置換すること。規模感 = 半日。優先度低 (今すぐ困っていない・純粋な
  掃除)。同類の Exhibit A (argv[0] 整形を `format_argv0` に集約) は 2026-06-23 に対応・デプロイ済み。

## 🎯 現在の目標: bio 100% ゲーム互換性 (2026-06-05〜)

**目標 = bio 100% の純ゲーム 31 本中 20 本を T3 (操作可能・プレイ可能) にする** (floor=16/過半、stretch=24)。

bio 100% (PC-98 同人サークル) のフリーソフト集は QuuBee ミッションの中核。単一サークルなので音源ドライバ・
起動規約・エンジンを共有 → 1 本直すと芋づる式に効く高レバレッジ。

### 仕分け (36 書庫 → 純ゲーム 31)
- **非ゲーム除外 (4)**: C2ED100 (CarII コースエディタ) / C2RANK (ランキングツール) / CATLET10 (にゃん文字=
  メッセージ表示ノベルティ) / EFORTH07 (作者曰く「まだゲームでない」WIP)
- **重複統合 (1)**: FINAT100 = FINAL100 と同一「Super Depth 2 "Finalty"」(FINAT は calib.exe 追加版)

### Tier 定義
T0 起動 (POST 通過) / T1 タイトル描画 / T2 ゲーム画面描画 / **T3 操作可能・プレイ可能** ← 目標は T3。
T3 確認は入力が要るのでブラウザで人が行う (headless は T0〜T2 まで)。

### 進捗 (2026-06-07)
- **代表作 4 本 (SuperDepth/Dynamo/NyaHaX'93/TURB) のうち SuperDepth + NyaHaX'93 が T3 確定**
  (NX93 はブラウザ実プレイ確認、`nx93.exe` 単体・改修ゼロ)。
- **triage を改修** (`tools/bio100_triage.js`): ①ランチャ型は `.bat` を batscript.js で解釈し
  `stage_script` 経路 (ドライバ常駐込み) でステージ ②最終 PC を **EXIT(0xFEE30 正常終了)/
  WAIT(0xFEE10 入力待ち=生存)/BIOS(neccheck 暴走)** の 3 状態に分類。`node tools/bio100_triage.js [filter]`。
- **triage を並列化** (2026-06-27): 旧版は 31 本を 1 プロセス逐次で回し 15〜20 分かかって毎回タイムアウト
  していた (各本 3000 フレームが実 40〜86 秒)。**1 ゲーム = 1 子プロセス + 既定 8 並列 + 個別タイムアウト
  150 秒 + 再開キャッシュ + ALIVE 早期確定**で**コールド 約 2〜3 分・再実行 0.2 秒** (キャッシュヒット) に。
  `--jobs N` `--timeout S` `--fresh` 対応。ベースライン完全一致 (詳細 CHANGELOG 2026-06-27)。
- **INT 21h AH=52h (Get List of Lists) を実装** → master.lib 製 **Super Spartan (SSP101) が EXIT→ALIVE**
  (本体 sspartan.d98 が未実装の AH=52h で諦め code 1 終了していた)。master.lib 系全般に効く土台。
- **INT 29h (DOS 高速文字出力) を実装 → テキスト残留を根治** → SSP のメニュー/ハイスコアに「Super Spartan
  version 1.0 / Copyright…」が重なって残る症状を根治。真因 = **master.lib `text_clear()` の実体が `INT 29h` で
  `ESC[2J` 送出**で、INT 29h 未フック (IRET スタブ) のため消去が無効だった。`0xFEE80` トランポリン→tty。
  master.lib 系全般に効く。SSP の banner ゴースト消滅・回帰ゼロ (CHANGELOG 詳細)。**KANI の「KANI.SCR を作成します」は
  別系統** — INT 29h 不使用、初回起動 (kani.scr 不在) でのみ出る忠実な通知。スコア登録時にファイル作成・以後消える。

### ベースライン (改修版 triage、2026-06-09 夜 更新)
**描画到達 (ALIVE+RENDER) = 24/31、動作確認 (+WAIT 入力待ち生存) = 26/31、EXIT = 0、真の BIOS クラッシュ = 0。**
既知動作の DEPTH/KANI/TW212/NX93/SSP が全 ALIVE = 判定の信頼性 OK。**GS100 の偽陰性を解消し EXIT=0 達成**
(下記)。先行: last-fit (AH=58h) で GGL2/OZ100/CZ102 を昇格 + Ray VRAM 修正で SEENA2/POLA を昇格。

| 状態 | 数 | ゲーム |
|---|---|---|
| ● ALIVE (多色+アニメ) | 20 | CRAY CX92 **DEPTH✓** FINAL(SD2) FLIXX **GS↑** **KANI✓** METYS MKD MOG **NX93✓** OZ PECKER POLA POY ROLL SC SEENA2(232色) **SSP✓** **TW212✓** |
| ◐ RENDER (多色静止) | 4 | BIOHJA C2GP CZ TWINS(入力待ち) |
| ▫ BOOT (graphics乏) | 5 | DYNAMO(.bat稼働) F1GP GETS **GGL2(実はタイトル到達・色少で誤判定)** STB |
| ⌨ WAIT (DOS入力待ち=生存) | 2 | DADA YY (テキストアドベンチャー) |
| ⏏ EXIT (早期終了・回復余地) | 0 | — |
| ✗ CRASH (BIOS 暴走) | 0 | — |

→ **EXIT=0 かつ CRASH=0 = 早期終了も BIOS 暴走も皆無。stretch 目標 20 ALIVE 到達。** 残る非描画は分類癖
(GGL2 はタイトル到達済・DYNAMO/F1GP/STB は anim+USER で生存) か入力待ち。**本物の BIOS 領域到達は GETS のみ。**

注: GGL2 は headless 色数 6 で triage 上 BOOT だが、実体は「GOGGLE-Ⅱ / PUSH TRIGGER TO START」タイトル画面に
到達済 (タイトルが黒地少色のため色メトリクスが過小評価)。実質プレイ可能 = ブラウザ T3 確認待ち。

### 次の作業
- [x] ~~DEAD クラスタを .bat (stage_script) 経路で再トリアージ~~ → 改修 triage に統合済 (MKD→ALIVE/TWINS→RENDER/Dynamo→稼働)
- [x] ~~テキストゲーム (DADA/YY) を再判定~~ → PC 状態分類で WAIT (入力待ち=生存) と確定
- [x] ~~SSP101 の起動~~ → AH=52h 実装で ALIVE 化
- [x] ~~SSP の banner テキスト残留~~ → INT 29h 実装で根治 (master.lib text_clear=ESC[2J)
- [x] ~~残 EXIT の GGL2/CZ/OZ~~ → **last-fit (AH=58h) 実装で GGL2 タイトル到達・OZ ALIVE・CZ RENDER に昇格 (2026-06-09)**
- [x] ~~残 EXIT 1 本 (GS100)~~ → **gsnake.doc の必須引数 `0 0 0` を triage に渡し偽陰性解消・ALIVE 化 (2026-06-09)。EXIT=0 達成**
- [ ] SSP101 / GGL2 / OZ100 / CZ102 / GS100 をブラウザで T3 確認 (再デプロイ要)
- [ ] ALIVE 群をブラウザで T3 確認 (実プレイ・入力テスト)
- [ ] EMS+XMS の 25 本が XMS フォールバックで健全に動くか実プレイで確認 (`qbDebug.memprobe()` の ems 監視)
- [ ] GETS の BIOS 領域到達 (neccheck) 調査 (残る唯一の本物 BIOS リード)

### 東方旧作 (TH02 封魔録ほか) — 封魔録が headless でステージ1プレイ描画まで到達 (2026-06-09)
games/touhou に東方旧作 4 作 (TH02 封魔録=通常 LZH / TH03 夢時空・TH04 幻想郷・TH05 怪綺談=自己展開 EXE)。
headless smoke (game.bat ong1 経路を忠実線形化) + PNG 出力 (調査スクリプトは `games/touhou/debug/` に退避済み) で
**4 つの壁を突破し、封魔録 (TH02) がステージ1フィールド・スコア加算・敵/弾幕/アイテムまで実走**:
- [x] **壁1: AH=63h (DBCS リードバイト表) 未実装** → 実装 (DS:SI で SJIS 範囲表を返す)
- [x] **壁2: zun.com が常駐失敗 (FCB1 から引数を読むのに我々の EXEC が FCB を組んでいなかった)** → EXEC で
      cmdtail→FCB1/FCB2 を parse する修正。op.exe が脱線せず正常終了 (pc=0xfee30)
- [x] **壁3: SJIS 名ファイルが永遠に open 不能** (MEMFS ノード名=latin1、C 側 readdir d_name=UTF-8 で
      0x80-FF が膨張 → 生 SJIS 要求と byte 不一致でデータアーカイブ「東方封魔.録」を開けず色 6 止まり) →
      `ci_lookup` の比較で d_name を UTF-8 デコードし下位 8bit に畳む (`ci_equal_fsname`)。**色 6→17、
      オープニング 16 色描画。SJIS 名直 open する PC-98 ソフト全般に効く**
- [x] **壁4: AH=4Bh AL=03 (Load Overlay) 未実装** → op.exe が main.exe を overlay 読み込みして本編へ遷移する
      経路を実装 (`qb_dos_overlay_load`/`int21_4b_overlay`)。**main.exe (reloc 920) がロードされ本編稼働
      (exited=0, animated=true)。** 汎用 DOS 機能
- [x] **封魔録のブラウザ実機 T3 確認 (2026-06-10)** — 公式体験版書庫をブラウザに直接ドロップ → game.bat 選択 →
      Run で動作をユーザー確認。errorlevel 分岐インタプリタ経由の自動起動 (下セクション) がブラウザでも成立
- [x] **TH05 怪綺談もブラウザ実機でステージ 1 プレイ到達 (2026-06-10、ユーザー確認)** — SFX (.exe) をドロップ →
      **エミュレータ内で実行して自己展開** (ファイル名正準形の修正で SJIS 名も無化け) → game.bat (22 cmd 分岐) →
      Run → イン・ゲーム。= SFX 取り込みは「ゲスト自身に展開させる」経路で実用成立
- [x] **画面端ゴミ (タイルキャッシュ露出) を根治 (2026-06-11、TH02/TH05 ブラウザ実機確認)** — 真因 = DOS CON
      ワークエリア 0:0712h (テキスト行数−1) 未初期化で master.lib `text_fillca` の全画面黒被覆が row 0 で切れて
      いた。0x711/0x712 初期化 + `ESC[>1h/>3h` 実装 (`native/dos_int21.c`)。**Dynamo 起動時の上部テキスト残留も
      巻き添え根治**。詳細 CHANGELOG 2026-06-11
- [x] **恒久回帰テスト `tools/touhou_test.js` 新設 (2026-06-11)** — 4 作の e2e (TH02=LZH 展開 (archive.js) /
      TH03-05=SFX ゲスト内自己展開+生成名の SJIS 正準形検証 → 実 GAME.BAT を errorlevel 分岐インタプリタで
      起動 → 描画到達)。**4/4 PASS**。/tmp に散っていた調査スクリプト 17 本は `games/touhou/debug/` へ退避
      (README 付き、git 外・ローカル保全)
- [ ] (任意) **SFX の JS 側展開** = .exe 内の埋め込み LZH (offset ~1702 の `-lh5-`) を archive.js で検出・展開。
      上の「ゲスト内自己展開」で実用は足りているため、ワンステップ UX 化したい時に
- 注: 封魔録の op→main は op.exe 内 overlay だが、**起動 game.bat 自体が `if errorlevel goto` の音源判別ラダー**を
      持つため、ブラウザのドロップ→Run で自動起動するには下の「.bat errorlevel インタプリタ」が必要 (headless 成功は
      手動線形化したもの)。← 旧記述「if/goto 対応は不要」は撤回
- 詳細・調査ログは [[project_touhou_probe]] / CHANGELOG 2026-06-09 参照

---

## みゅあっぷ98 (MUAP98) を端から端まで動作 (2026-06-14〜15 完了・ブラウザ実機確認済)

MML エディタ/プレイヤー (Packen Software, 修正BSD フリーソフト)。ユーザー報告駆動で「書庫が開けない→
起動しない→サンプルが開けない」を順に根治。汎用 HLE 修正なので将来の他ソフトにも効く。

- **ZIP の data descriptor (bit 3) / UTF-8 名対応** — LFH のサイズ欄が 0 でも中央ディレクトリ経由で読む。
  bit 11 (UTF-8 名) は生 SJIS バイトへ戻す (TextDecoder を反転した自前エンコーダ)。`web/player/archive.js`、
  回帰 `tools/zip_test.js`。
- **起動 .bat の `set` (環境変数) / `cd` (カレント移動)** — env を EXEC 子へ継承・`g_cwd` 移動。MUAP98 は env で
  データ置き場を知る。シェルの EXEC パスは root-absolute にし cd を本体探索でなくデータアクセスにだけ効かせる。
  副産物で env ブロック 256→240 byte 超過の潜在バグ (program MCB 破壊→EXEC が空きメモリ無しで失敗) を根治。
  `native/dos_loader.c`,`dos_int21.c/h`,`batscript.js`,`bridge.js`、回帰 `tools/batch_test.js` サイクル 4。
- **FindFirst `*.*` をディレクトリにも一致 + 8.3 空白パディング open** — `.` 入り pattern だけフィールド照合
  (`.` 無しは従来 char glob 維持で `HTJL`≠`HTJL.COM`=GS100 救済)。`read_dos_rel` で 8.3 空白除去。
  `native/dos_int21.c`、回帰 `tools/wildcard_find_test.js`。
- 検証: 全テスト PASS・bio100 triage 回帰ゼロ (描画到達 24/動作確認 26/CRASH 0/EXIT 0)。
- 残: MML エディタ (CAL.COM) のカーソル移動 (別系統・未着手)。詳細 CHANGELOG 2026-06-14/15 / [[project_bat_launcher_corpus]]

---

## ファイル名の正準形 (2026-06-10 完了) — ゲスト生成 SJIS 名の化け/衝突を根治

**症状**: 東方 TH03-05 の自己展開書庫 (SFX .exe) をエミュレータ内で実行すると生成ファイルの日本語名が化け、
game.bat が止まる (ユーザー報告)。**真因**: C 側 (INT 21h create 等) が生 SJIS パスを fopen に直渡し →
Emscripten の UTF-8 復号で U+FFFD 化 (「東」93 60 と「残」8E 60 が衝突=相互上書きの危険)。
JS 展開経路 (latin1 で書く) は最初から正しく、未設計だったのは C が作る側の境界。

- [x] 不変条件を明文化: **MEMFS 名 = SJIS 生バイトの latin1 写像** ([docs/dos_hle_gaps.md §2-13](docs/dos_hle_gaps.md))
- [x] `fs_path_utf8` シム + `fs_fopen/...` ラッパ群で全 libc 呼び出しを置換 (`native/dos_int21.c`)、
      `ci_lookup` found の SJIS 畳み、`read_dos_rel`/CHDIR の DBCS-aware パース (トレイル 0x5C)
- [x] 回帰テスト新設 `tools/create_sjis_test.js` (東/残 衝突ペアの round-trip) + 既存全テスト/triage 回帰ゼロ
- [x] **TH03 headless 実証**: SFX 完走 (SJIS 名 5 本正準形) + GAME.BAT 分岐起動 + op.exe が夢時空1.DAT open・
      描画到達 16色 (pmd 枝)。TH02 通し PASS (回帰なし)
- [x] **TH03 :ong4 枝の pmd86.com ハングを根治 (2026-06-11)** — 音源ドライバ相互作用ではなく**我々の
      AH=52h の嘘構造体**が真因: LoL[+4] first SFT の `FFFF:FFFF`「無し」マーカを、pmd86 の install-check
      (SFT チェーンから自分の名前 "PMD86   COM" を探す) が終端チェックなしで follow しゴミ走査に陥っていた
      (zun -4 -z はゴミの中身を変えただけ)。修正 = 正規終端の合成 SFT (`QB_SFT_SEG=0x00B0`) + 直近 EXEC の
      stale エントリ (名前+実サイズ、pmd86 のシグネチャ照合まで実 DOS 同等)。TH03 通し FAIL→PASS、
      回帰 = `tools/sft_test.js` 新設・全テスト/triage 回帰ゼロ。詳細 CHANGELOG 2026-06-11。
      **ブラウザ実機 T3 確認済 (2026-06-11、ユーザー)** — これで**オフィシャル入手可能な東方旧作体験版
      4 作 (TH02/03/04/05) が全てブラウザ動作**
- [ ] (保留) JS 側 `dosPathToSlash` の 0x5C トレイル非対応 (corpus 未遭遇)

---

## .bat errorlevel 分岐インタプリタ (2026-06-10 完了・ブラウザ T3 確認待ち) — 封魔録ほかをドロップ→Run で自動起動

**動機**: PC-98 フリーソフトの起動 .bat 38本中 8本 (≒3-4タイトル: TH02 封魔録 / FINAL=Super Depth2 / life100) が
`if errorlevel N goto / :label / goto` 入りで、現 `resolveSequence` は丸ごと諦め単発起動にフォールバック → ドライバ TSR が
常駐せず脱線。コーパス全数調査で必要構文は **`:label`/`goto`/`if errorlevel→goto`/`if "%N"==→goto` の閉じた小集合**
(`for`/`call`/`choice`/`shift`=0)。分岐の意味は全部「音源ボード自動判別」か「ユーザ引数選択」で、実行時状態で結果が
本質的に変わる分岐は無い。

**設計 (確定)**: static な「errorlevel は素通り」ヒューリスティックはラダー並び順依存で運頼み → 採らず、**実インタプリタ**
(返り値を読み分岐評価し goto = 並び順非依存で correct by construction、多段/ループ分岐も成立)。所在は **C 側必須**
(errorlevel は DOS セッション実行中のみ存在、JS は列投入後 戻らない)。asm シェルは EXEC 発行役のまま、各コマンド後に
**C へ「次コマンド?」を問い合わせる**。**`g_last_exit_code` は全終了経路で既設・AH=4Dh も実装済**=捕捉コスト 0。
ループ上限なし (脱出=Stop/リロード)。**echo も同梱** (作者メッセージを既存 `tty_putc` に流す、SJIS 対応済)。コンベンショナル
メモリ圧迫なし (シェル 8KB 常駐は既存コスト・実 DOS の COMMAND.COM+カーネルより軽い)。見積 **~2 日**。

**進捗**:
- [x] **Step 1: JS 文モデル `buildStatements`** (`web/player/batscript.js`、純 JS・テスト済・**未配線でアプリ挙動不変**) —
      レシピ→`cmd/echo/goto/iferr` の文列 (ラベル=直後の文 index に解決、`if "%N"==` は引数で静的畳み込み、`iferr` は
      n/neg/target 保持)。未対応は null で ① へ honest fallback。`parseLine` の `echo.`/`echo` 落ち小バグも修正。
      `tools/batscript_test.js` +5 ケース (**44/44**: 降順ラダーの index 解決が並び順非依存・後方 goto ループ・文字列畳み込み・
      echo 保持・null フォールバック)。
- [x] **Step 2: C インタプリタ + ステージ拡張** (`native/dos_loader.c`) — `g_batch_stmts` 文テーブル (96 文/48 cmd) +
      `qb_dos_stage_batch` (直列化文列パース) + `qb_dos_batch_next_hook` (PC 解釈、`iferr`=`(g_last_exit_code>=n) XOR neg`
      の遅延評価)。cmd 無し文循環は問い合わせ毎ステップ上限 (4×文数+16) で Wasm 凍結を防ぎ正直終了 (EXEC 入りループは
      上限なしのまま)。線形 ② の `qb_dos_stage_script` も同じ文テーブル (cmd 文のみ) + `stage_shell_image` 共用に統合。
- [x] **Step 3: asm シェル改 + 新トランポリン 0xFEE90 + bios.c パッチ + blob 再生成** — シェルは「far CALL F000:EE90 で
      C へ『次コマンド?』→ AX=1: DX=path/CX=tail で EXEC / AX=0: 4Ch」。NOP+RETF (XMS entry 同パターン)。patch 01 再生成。
- [x] **Step 4: bridge 配線** — `np2kai_dos_stage_batch` export、`batscript.js serializeStatements`、Run フローで
      hasControlFlow → buildStatements → stageAndRunBatch (null は ① へ honest fallback)。batRecipeSummary も分岐対応。
- [x] **Step 5: echo 出力** — インタプリタが echo 文を `qb_dos_tty_write` (tty_putc 一括、SJIS/ESC 対応) +CRLF で表示。
- [x] **Step 6: end-to-end headless テスト** — `tools/batch_test.js` **8/8 PASS** (逆順ラダーで正解枝のみ実行 + 後方 goto
      ループ 2 周脱出 (FLIP.COM の自己書換) + echo の text VRAM 表示、loader 実ブート 2 サイクル)。回帰: batscript 45/45・
      exec_env・xms・find_sjis PASS、bio100 triage ベースライン完全一致 (ALIVE20/RENDER4/BOOT5/WAIT2/EXIT0/CRASH0)。
- [x] **実 TH02 game.bat の headless e2e** — 無改変の game.bat で `zun ongchk` の errorlevel 3 をラダーが実行時評価し
      実枝 :ong4 (pmd86) を選択 → op.exe 起動・描画到達 (colors=17)。→ 恒久回帰 `tools/touhou_test.js` に統合済 (2026-06-11)。
- [x] **封魔録ブラウザ実機 T3 確認 (2026-06-10、ユーザー確認)** — 公式体験版書庫ドロップ → game.bat → Run で動作。
- [x] **FINALTY / life100 の .bat 経由不具合を根治 (2026-06-11)** — どちらも**インタプリタは無実**で別真因:
      FINALTY = EXEC の「ファイル全長 256KB 上限」が付加データ連結 EXE (finmain.exe 628KB 中イメージ 138KB) を
      弾いていた → `read_child_image` で MZ ヘッダ記載分だけ読む実 DOS 仕様に。life100 = 合成 ROM に
      "NEC N-88" が無く Turbo-C BGI の NEC 実機判定で grNotDetected → E800:0DC0 に "NEC N-88BASIC(86)" 配置。
      あわせて Canvas-98 の COMSPEC 存在チェックも env 追加で根治。詳細 CHANGELOG 2026-06-11。ブラウザ確認待ち
- 設計の根拠・コーパス調査・多段分岐の正当性は [[project_bat_launcher_corpus]] / CHANGELOG 2026-06-10 参照。

---

## 「快適に使う」QoL パス — 完了 (2026-06-08、JS のみ・Wasm 不変・ブラウザ実機確認済)

bio 100% (互換性の長尾) とは別軸のフロント強化。詳細は CHANGELOG。
- [x] **CTRL キー死にコード修正** — keydown が CTRL 単体押下も捨てていた → 押下キー自身が Control の時だけ素通しし 0x74 を送る
- [x] **readme/テキストビューアの罫線崩れ根治** — NEC 罫線 (SJIS 0x86xx) は WHATWG/CP932 とも U+FFFD に潰す → 同形の
      Unicode 罫線 (U+2500–254B) に写像 (`decodeSjisText`、表は trkei98.exe LUT を正典に 32 字抽出・test98 で検証)
- [x] **別窓ビューア** — ファイル名行右端 `⛶ 拡大` → モーダル (content-agnostic、画像も相乗り)
- [x] **.MAG (MAKI02) 画像ビューア** — `web/player/magimage.js` 自前デコーダ (Magd ソース magd25s.lzh を仕様参照・
      逐語移植せず。savefont.mag/gbox.mag で検証)。`🖼` プレビュー + `⛶ 拡大`
- [x] **.PI (Pi 形式) 画像ビューア (2026-06-25)** — `web/player/piimage.js` 自前デコーダ (pi24.lzh の piloadc.asm を
      仕様参照・逐語移植せず)。MAG と並ぶ 2 大形式。`openImage` がシグネチャで MAG/PI を自動判別。検証 = 同一画像の
      MAG/PI ペア突合 (`tools/pi_test.js`、c165/c206 全 256000px が MAG と色番号一致)。ライセンス clean。ブラウザ実機確認済
- [x] **画像/音楽 (.MAG/.PI/.M) の単体オープン (2026-06-25)** — 閲覧専用形式は D&D/Open/＋Add のどれでも単体で開け、
      実行されないので束を壊さず重ねる (非破壊・誤ドロップで前のゲームが消えない)。encodeSjis で SJIS 名化して /run
      配置 (日本語名 CG も可)・開いたら自動プレビュー。Open accept に .mag/.pi/.m 追加。実機確認はユーザー委任
- [x] **ゲームパッド対応 (2026-06-10)** — Gamepad API→キー変換 (`pollGamepads`、十字/左スティック→カーソル、
      ボタン 0→Z/1→X/2→Space/3→Enter/Start→ESC)。ブラウザ実機で TH02・Super Depth 動作確認済。
      ネイティブ PC-98 パッド (案 B: joymng_getstat 実装、bio100 21/36 書庫が対応明記) は将来課題 (CHANGELOG 参照)
- [x] **拡大ビューアの VZ 流 %X タグリンク + 実機風タイポグラフィ (2026-06-12)** — 当時の readme の
      手作りハイパーリンク慣習 (VZ の HELP キー検索前提、canvas.doc が典型) をマウスクリックに翻訳。
      line-height 1.0 (25行モード=行間ゼロで罫線/AA が繋がる)+18px。**ユーザー確認済・「コンセプトに
      ぴったり」= 周辺文化 (readme/VZ/MAG) の再体験が差別化軸と確認**。詳細 CHANGELOG 2026-06-12
- 残バックログ (難易度×価値の見立て): COMSPEC/PATH (小・要求が出てから) / ネイティブ PC-98 パッド (案 B・小〜中) /
  **full .bat の if/goto = errorlevel インタプリタ (上の専用セクションで着手済・~2日見積。旧「大変な20%・ROI低」は撤回:
  errorlevel 捕捉が既設のため軽く、封魔録の自動起動に直結)** / **.MKI 画像 (別系統デコード・未対応)**

---

## Phase 1 完了 ✓ — Wasmビルドとブラウザ動作確認

- [x] NP2kai core を Emscripten (apt版 3.1.69) でWasmビルド
- [x] bridge.c / bridge.h: JS↔C ブリッジAPI実装
- [x] Emscripten FS 経由でディスクイメージをロード
- [x] `fdd_set()` 直接呼び出しでFDDマウント（`fdc.equip`ガードをバイパス）
- [x] RGB16フレームバッファ → Canvas描画パイプライン確認
- [x] **FreeDOS(98) がブラウザ上で起動・テキスト表示を確認** ✓

---

## Phase 2 進行中 — ゲームディスクのロードと動作

### 達成済み (2026-05-25)

- [x] **表示パイプラインのピクセルパーフェクト化** (非整数 dpr 対応、PAR 補正の整理)
- [x] **標準キーボード入力**転送 (英数, 記号, 矢印, F1-F10, テンキー等)
- [x] **CPU エミュレータを i386c (NP21) に切替** — 386+ 命令対応、FPU 装備、32MB EXTMEM
- [x] **FPU エミュレータ (DOSBox2)** を有効化
- [x] **自己起動最小ディスク** が画面表示まで動作確認 (`tools/boot_hello/`)
- [x] **デバッグ API** (`qbDebug.*`) 実装 — ハング地点や CPU 状態を JS から覗ける
- [x] **ディスク D&D / ファイル選択 UI** — 任意の .d88 をブラウザにドロップ or クリックでロード
- [x] **A:/B: 2 ドライブ対応** — スロットごとに独立した D&D/click、B: は挿入時リセットなし
- [x] **マウス入力** — Pointer Lock + 相対移動 + 左右ボタン、ESC で解除
- [x] **実 PC-98 のゲームディスクが動作** — 自己起動 .d88 がディスプレイ選択→タイトル→本体まで動作、実機相当の速度（CPU/FDD 経路のブリングアップ検証。市販ソフトは射程外）
- [x] **2 枚組ディスクが動作** — .d88 ×2 構成がディスプレイ選択→名前入力→オープニングまで進行、CG 表示も綺麗（FDD 入替・CG 経路の検証）
- [x] **サウンド対応 (基本)** — qb_soundmng リングバッファ + AudioContext + ScriptProcessorNode、実 .d88 で FM 音源確認、テンポはほぼ正しい
- [x] **サウンド品質向上 (AudioWorklet 移行)** — `web/player/audio-worklet.js` 新規。postMessage で Int16Array 転送、Worklet 内部リング ~680ms。実機聴感で微ノイズ・途切れが大幅減
- [x] **テンポ・音質チューニング (2026-05-27)** — wall-clock 56Hz catch-up 駆動でテンポ正規化、RGB565→RGBA32 LUT 化で主スレッド負荷削減、ソフトクリップ + vol_master=65 + `usefmgen=0` (opngen 採用) で低音ビリビリ歪みを実用レベルまで低減
- [x] **MIDI (VERMOUTH + freepats) — 鳴る (2026-06-05)** — RS-MIDI (`-X1`, MIDDRV) を `qb_commng.c` で VERMOUTH に結線し、TW212 TWMIDI.BAT で実機ブラウザ発音をユーザー確認。boot は MIDI OFF (即プレイ)、MIDI レシピ Run 時だけ freepats を遅延ロードして有効化 (`enable_midi_now`)。reset 跨ぎ再登録も修正済。MPU98II 直叩き経路は別途 (未対応)。詳細は下記「✅ MIDI 鳴った」を参照
- [~] **HDD スロット (C:/D:) と `np2kai_insert_hdd` ブリッジ (2026-05-27)** — SASI/IDE 4 ドライブのうち先頭 2 つを UI 露出。`.hdi/.thd/.nhd/.hdd` を `file-input` の accept に追加、ドロップ → `sxsi_devopen` → `pccore_reset` の流れで配線。`np2kai_eject_hdd` も追加。ただし **DOS 起動の HDD イメージは未確認** (BIOS ホールで FreeDOS と同じ壁にぶつかる可能性大、将来課題参照)

### 次のステップ（優先順）

1. **追加タイトルの動作確認**
   - もう数本の自己起動 D88 で動作試験
   - 失敗箇所が出たら `qbDebug.*` でハング箇所を特定 → 個別対処

2. **PC-98 固有キーのマップ追加 (未対応)**
   - `XFER` (変換) `0x35`
   - `NFER` (無変換) `0x51`
   - `KANA` `0x72`
   - `GRPH` `0x73`
   - `HELP` `0x3f`
   - `COPY` `0x61`
   - `STOP` `0x60`
   - `VF1` 〜 `VF5` `0x52`〜`0x56`
   - 物理キーが存在しない (US/JIS 標準配列) ものは、画面上のソフトキーまたは
     キーバインド設定 UI を別途用意する必要あり

3. **GitHub Actions CI**
   - Emscripten 向けのビルドワークフロー作成
   - ビルド成果物（.js/.wasm）をアーティファクトまたは GitHub Pages にデプロイ

### 将来課題（優先度低）

- **HDD からの DOS ブート (持ち越し)** — `np2kai_insert_hdd` で C:/D: にイメージは挿せて
  リセットまで走るが、MS-DOS (PC-98) / FreeDOS をインストールした HDD は起動しない
  と予想 (FreeDOS FDD と同じく `E869:075B` 付近の BIOS ROM `neccheck` 領域に飛び込んで
  暴走するため)。**未検証**: 実 HDD イメージ + `qbDebug.sample(10, 300)` で PC をサンプ
  リングし、FreeDOS と同じ番地で止まっているかを確認するのが再開時の第一歩。
  解決路線:
  1. **実機 NEC `bios.rom` 持ち込み対応** — UI に BIOS ファイル指定スロット追加、
     `np2cfg.usebios=1`。`np2kai_set_bios_dir` は既に存在。一番工数小さい (1〜2時間) が
     ユーザに ROM を用意してもらう必要あり (著作権)
  2. **`nosyscode` 拡張で BIOS フック追加** — 呼ばれる番地ごとにハンドラを実装。
     工数大 (数日〜) だが著作権クリーン
  3. **自己起動 HDD ゲームに賭ける** — 元々少数派なので恩恵小

- [x] **MIDI 音質改善 → 合成エンジンを TinySoundFont + SF2 に刷新 (2026-06-14)** — 上記選択肢の
  「より良い音色セットへ差し替え」を、形式の壁 (VERMOUTH は GUS .pat のみ・完全フリー音源は SF2/SFZ) を越えて
  **エンジンごと TinySoundFont (MIT) に差し替え、GeneralUser GS (SF2、全 128 音色) をネイティブ再生**する形で実現。
  freepats が GM 72/128 しか無くパートが欠落していた問題 (ユーザー報告「ドラムだけ・音数不足」) を根治。SF2 は
  フィルタ/エンベロープ付きで音質の天井も上がった。全体リバーブ (Freeverb) は `native/qb_tsf.c` に実装
  (`qbDebug.midifx`)。VERMOUTH はビルド除外・patch 04 revert でコア改変は 01-03 のみに縮小。**ユーザー実機確認済**
  (「全く違う音、音楽を聞く気になった」)。残: SC-88 と完全一致はしない (近似)・コーラス/ディレイ未対応 (任意)。

- [x] **MPU-PC98 (MPU98II) MIDI 対応 (2026-06-13)** — 「ゲーム側 MIDI 検出ロジック」の懸案を解消。MIDI(MPU) モードの
  ゲーム (huma_ts2=東方封魔録 等、MMD ドライバが 0xE0D0 直叩き) が無音だった真因 = `mpuenable=0` で 0xE0D0 未 attach
  だったこと。`np2kai_enable_midi_now` が MIDI レシピ Run 時に MPU98II を限定有効化 (port 0xE0D0/INT2) し、
  `qb_commng.c` で VERMOUTH→(現 TSF) に結線。**ブラウザ実機で発音確認済 (ユーザー)**。
  ※「音源選択メニューが出ない=MIDI 無し判定」型のタイトルは別途 (検出経路がメニュー UI 側) で、MPU 直叩き型とは別。

- [x] **✅ MIDI 鳴った (2026-06-05、TW212 = bio_100% TWMIDI.BAT)** — RS-MIDI (`-X1`) を VERMOUTH へ
  結線し、実機ブラウザで FM とは別の MIDI 音色が鳴ることをユーザー確認。**遅延 on-demand 配線 + reset 跨ぎ
  修正 + 本番 deploy 同梱**まで完了。経緯と実装は以下 (調査足場・計測は revert 済、結論だけ残す):
  - **MIDDRV.DOC 精読で構造判明**: MIDDRV.EXE は常駐型 標準 MIDI ファイル(SMF Format 0) 演奏ドライバ。
    game は INT 47h で「曲 N を鳴らせ」と依頼、MIDDRV が同梱 .mid をシーケンス→デバイスへ送出。
    `-X` = デバイス (0:MPU / 1:RS-MIDI / 2:RS-MIDI ST1)、`-t` = タイマ (1:INT08h / 2:FM-B / 3:マウス割込)。
  - **穴 = `qb_commng.c` が `COMCREATE_SERIAL` を `com_nc` で捨てていた**。NP2kai `io/serial.c` は 8251 を
    完全エミュし `cm_rs232c->write()` までバイトを運んでいたのに受け手未接続だった。
  - **実装 (A)**: `qb_commng.c` で `COMCREATE_SERIAL && qb_vermouth_ready()` 時に cmmidi の VERMOUTH シンク
    (`com_serial` ラッパ) を返す。cmmidi.c は無改造 (Emscripten では OS MIDI デバイス open が `#if` で除外
    され device 非依存で VERMOUTH 分岐、`midiwrite` が生 MIDI バイトをパース)。診断 `qbDebug.midi()`。
  - **判明したこと (旧調査)**: 我々の MIDI エンジン (VERMOUTH 合成器+接続) は動いていた。無音は soft-clip でも
    freepats 品質でも CPU でもなく、上記の「シリアル受け手未接続」だった。
  - **我々の MIDI エンジンは動く**: VERMOUTH 合成器ロード (`qb_vermouth_init` で module≠NULL)、
  - **ブラウザ遅延 on-demand 配線**: `enable_midi` は create 前必須だがゲーム選択は起動後、という
    lifecycle 制約は「reset で繋ぎ直す」で回避 (`pccore_reset→iocore_reset→rs232c_reset` が毎リセットで
    `commng_create(SERIAL)` を呼ぶ)。`bridge.c:np2kai_enable_midi_now()` + `batscript.js:usesMidi()` +
    `bridge.js:ensureMidiLoaded()` (MIDI レシピ Run 時だけ freepats を `index.json` から fetch→`/tmp`→
    `enable_midi_now`→runStaged の reset で結線)。非 MIDI ゲームは freepats を一切 DL しない=即プレイ維持。
  - **reset 跨ぎバグ修正**: `sound_reset` の `streamreset` が `sound_streamregist` 登録を全消去するのに
    cmmidi を singleton 保持していたため、別 .bat を挟んで再起動すると無音 (active=true・bytes 増えるのに音だけ
    出ない) になった。`commng_destroy(com_serial)` で inner を release+NULL 化し、毎リセット作り直す=毎回再登録
    (stock MPU と同型)。`tools/midi_serial_test.js` を 2 サイクル実行に拡張して恒久ガード。
  - **deploy + 進捗表示**: freepats (33MB) を本番 (Cloudflare Pages) に同梱 (`tools/deploy.sh` の除外解除)。
    遅延 on-demand なので MIDI ゲーム起動時のみ初回 DL。**本番で MIDI 発音をユーザー確認済 (2026-06-05)**。
    初回 DL の進捗を `ensureMidiLoaded` で件数+%+MB ライブ表示 (固定文字で止まって見えた不満を解消)。
  - **残**: ①実機で音量/音色のさらなる詰め (headless peak ~27800/32767=健全) ②`-X0` MPU 直叩きゲームは
    別経路 (現状未対応・mpuenable 再 init が要る) ③MIDI+FM 同時 (twmidifm.bat) の音量バランス
    ④freepats を IndexedDB/Cache Storage に保存して再訪時も DL スキップ (現状はブラウザ HTTP キャッシュ任せ) /
    進捗をプログレスバー化。

- **FreeDOS(98) の完走** — 現状は HMA buffer 確保まで進むが、BIOS 拡張ハンドラ不足で
  `E869:075B` 付近に飛び込んで暴走。実機 `bios.rom` 利用 (著作権問題) か、
  `nosyscode` ベースの BIOS フック拡張で解決可能。優先度は低い（ゲームは
  自己起動のため DOS 不要のことが多い）

- **セーブステート / 設定永続化** — np2kai のステート保存 API + IndexedDB

---

## Phase 3 計画 — ミニマル DOS ローダ

### 目的

DOS を介さず、`.lzh` などのアーカイブから直接 PC-98 ソフトを起動できるようにする。
FreeDOS の完走を待たず、`bridge` 側に最小限の DOS 互換層 (ローダ + INT 21h ハンドラ)
を実装し、ブラウザで .lzh をドロップしたら中の .EXE/.COM を即実行できる体験を作る。

### ターゲットスコープ

**フロッピーベース・2D・〜1998 年の PC-98 同人/フリーソフト** に絞る。

- Vector の MS-DOS / 汎用 (PC-98) カテゴリ、コミケ同人ソフトの大半が射程
- 期待カバー率:
  - **フロッピー 2D 〜98 freeware に限定: 80〜90%**
  - PC-98 freeware 全体: 55〜65%
  - PC-98 商用ソフト全体: 30〜50% (HDD/extender が多いため低め)

### 含むもの

- LZH / ZIP 展開 (JS 側)  ※当初は `libarchive.wasm` 想定 → 実装は自前デコーダ採用 (下記「主な技術選択」)
- MZ ヘッダ解釈・リロケーション・PSP 構築 (.EXE ローダ)
- COM ローダ (org 0x100)
- INT 21h ハンドラ (最小セット、下表)
- MCB チェーンによるメモリマネージャ
- ファイル I/O は Emscripten FS をバックエンドにラップ
- PC-98 固有 BIOS パススルー (INT 18h 等は既存 NP2kai 経路を活用)
- 既存マウス入力 (Pointer Lock) との接続 (INT 33h スタブ + 直接 I/O はそのまま)
- PSP `80h` への CLI 引数文字列セット (ローダ UI 側で入力可能に。`zar FILE` /
  `same [-options] [datfile]` 等で必須)

### 含まないもの (将来課題 / Phase 4+)

- **DOS Extender** (DOS/4GW, PMODE/W, GO32) — DPMI host 実装が必要 (+2〜4 週)
- **CD-ROM ドライバ** (MSCDEX, ISO9660) — +1 週
- **3D ポリゴン処理** — スコープ外 (商用寄り、同人少数派)
- **N88-BASIC ROM 依存ソフト** — 著作権の壁
- **MIDI ドライバ (RMDRV 等 TSR)** — 既存 MIDI 課題と統合 (Phase 4 以降)
- **HDD インストール前提のソフト** — フロッピーで完結するもの限定
- **ファイル管理/常駐系ツール全般** — 代表 1 本 (Ray) のみ対象
- **RAR / 多重圧縮アーカイブ** — テストスイートのターゲット差し替えで不要化済
  (Super Depth 2 Finalty .rar は対象外、オリジナル Super Depth .zip→.fdi を採用)

### 必要な INT 21h 関数 (初期実装)

| AH | 機能 | 用途 |
|---|---|---|
| 02h | Print Character | テキスト出力 (起動メッセージ等) |
| 09h | Print String | 同上 |
| 25h | Set Interrupt Vector | ゲームの割り込みフック |
| 2Ah / 2Ch | Get Date / Time | 乱数シード等 |
| 30h | Get DOS Version | バージョン分岐回避 |
| 35h | Get Interrupt Vector | フック前の値保存用 |
| 3Ch | Create File | セーブ書き出し |
| 3Dh | Open File | データロード |
| 3Eh | Close File | 〃 |
| 3Fh | Read File | 〃 |
| 40h | Write File | セーブ |
| 42h | Seek File | ランダムアクセス |
| 43h | Get/Set File Attributes | ファイル属性確認/設定 (Super Depth が使用) |
| 44h | IOCTL (Get Device Info) | FH がファイル or デバイス判定 (Super Depth が使用) |
| 48h | Allocate Memory | ローダ自身 + 一部ゲーム |
| 49h | Free Memory | 〃 |
| 4Ah | Resize Memory | EXE 起動時の自己縮小 |
| 4Ch | Terminate with Code | 終了処理 |
| 31h | Keep Process (TSR) | Ray の `rin.com` 常駐音源ドライバ。+α 扱い (`rin.com` 無しでも BEEP フォールバックで起動可) |

互換性検証で不足が判明したら都度追加。

### INT 21h 実装拡張 (2026-06-03)

初期表に加え、コードレビュー棚卸しで以下を追加実装 (`native/dos_int21.c` / `dos_loader.c`):

- **39h MKDIR / 3Ah RMDIR / 3Bh CHDIR** — host の mkdir/rmdir。CHDIR は **論理カレント `g_cwd`** を持ち、
  相対パス解決 (`read_dos_rel`) に前置して実際に効く (`.`/`..` 解決込み)。47h GetCurDir も連動。
- **36h Get Disk Free Space** — 実ディスク無しなので合成ジオメトリで「常に潤沢 (64MB 空き)」。
- **EXEC 子のファイルハンドル掃除** — free-on-terminate 相当 (`qb_dos_fh_snapshot`/`close_since`)。

フロント (`web/player/bridge.js`): ファイラ名の **SJIS 表示**、MEMFS リーク修正、**`/run` ライブ反映**
(実行中 ~1s ポーリング + 差分描画でセーブ/生成物が一覧に出る)。検証は `tools/dos_loader/dostest.com.py`。

実 DOS との差異・未対応の全体像は **[docs/dos_hle_gaps.md](docs/dos_hle_gaps.md)** に体系化。
次の候補: 56h rename / 57h ファイル日時 / 63h DBCS テーブル。スコープ外: FCB I/O・EMS/XMS・INT 25h/26h・overlay。

### 工数見積もり

合計 **約 2 週間 (実働 10〜12 日)**

| Day | 内容 | 工数 |
|---|---|---|
| 0 | LZH/ZIP 展開 (JS、自前デコーダ) + Emscripten FS 配置 + IRQ 配送 (VSYNC) パス事前確認 | 0.5 日 |
| 1〜2 | MZ/COM ローダ (ヘッダ・リロケーション・PSP・CS:IP・cmdline) | 1.5 日 |
| 3〜4 | INT 21h 最小セット (上表 15 個程度) | 2 日 |
| 5 | メモリマネージャ (MCB チェーン、Z/M ブロック) | 1 日 |
| 5 | ファイル I/O ラッパ (Emscripten FS 経由) | 0.5 日 |
| 6〜7 | PC-98 固有 (INT 18h パススルー、A20、INT DCh 主要 fn) | 1〜2 日 |
| 8〜12 | 互換性デバッグ (テストスイート — Phase 3 ローダ 4 本) | 3〜5 日 |

進捗は非線形 — Day 7 までに 1 本目が動き、そこから「不足 INT を見つけて埋める」サイクル。
**70 点までは早く到達、90 点までは長い** という典型パターンを想定。

### テストスイート (5 本)

複雑度の昇順にバグ切り分けが綺麗になる順序で選定。
**1 本 (Super Depth) は .fdi 配布なので Phase 2 FDD 経路で動作確認、4 本が Phase 3 ローダ対象**:

| # | タイトル | アーカイブ | 形式 | 経路 | プロファイル | 主な検証ポイント |
|---|---|---|---|---|---|---|
| 1 | **さめがめ** | `sam98210.lzh` 32KB | LZH → MZ .exe | **Phase 3** | 静的パズル / マウス (任意) / 超小型 | ローダ + INT 33h スタブ / `-k` フォールバック + ファイル read + PSP cmdline |
| 2 | **ザルバールの蒸留塔** | `zarfw.lzh` 188KB | LZH → MZ .exe | **Phase 3** | 動的物理パズル / マウス必須 (PC-98 native I/O) | INT 18×31 / INT DC×3 + マウス I/O 直叩き + セーブ (`ZARF.SCR`) |
| 3 | **GO!GO! うさちゃん列車** | `rabbit31.lzh` 22KB | LZH → .com | **Phase 3** | 半リアルタイム / BEEP / レール+タイル | KEY/VSYNC IRQ 占有 + 裏 VRAM + ハイスコア (`RABBIT.HSC`) |
| 4 | **Super Depth (.fdi)** | `Super Depth (Bio 100%).zip` 165KB | ZIP → **.fdi** (1.21MB) | **Phase 2 FDD** | 横スクロール STG / FM / キー | 既存パイプライン上で自己起動。Phase 3 ローダ不要 (B1 で確認済) |
| 4.5 | **Super Depth (LZH)** | `DEPTH100.LZH` 75KB | LZH → MZ .exe + データ 10 本 | **Phase 3** | 同上 (DOS 版) / VSYNC+Timer IRQ / FM | **INT 21h ほぼ全部** (43h/44h 含む) + IRQ 配送 + FM port 直叩き + 大量データ read |
| 5 | **Ray IV** | `ray_iv2a.lzh` 185KB | LZH → MZ .exe + `rin.com` (TSR) + .ray データ | **Phase 3** | AV ツール / FM+タイマ IRQ / 編集 | INT 1Ch hook + BEEP フォールバック起動 + (+α) TSR install で FM 演奏 |

#### 各タイトル補足

- **さめがめ** (kyoto & W.Yossy, 1993): MS-DOS 付属 `mouse.sys` / Microsoft 互換ドライバ経由で
  マウス操作。Phase 3 で INT 33h スタブが間に合わない場合は `-k` オプションでキーボード操作に
  フォールバック可。`same [-options] [datfile.kdt]` 形式で PSP cmdline 必須。
- **ザルバールの蒸留塔** (onion software / T.Anazawa, 1995): 引力で流れ落ちる 2 液体を、マウスで
  壁を破壊/構築して片方だけ抽出する蒸留パズル。面ごとに量・純度・時間制限と液体性質が変化。
  **マウスドライバ不要** — PC-98 ネイティブ I/O port (`0x7FD9/DD/DF`) を直叩きするので、
  NP2kai 既存マウス I/O 経路がそのまま機能する (INT 33h 実装不要)。
  Turbo C++ + NASM + ANNEX ランタイム製。320KB 程度のフリーエリア要。
- **GO!GO! うさちゃん列車** (KEN Takahashi, 1993): パネルにレールが描かれており、パネルを動かして
  レールをつなげ、列車を目的地へ導く。通過したレールは消え、全部通過で面クリア。
  **KEY 割り込み + VSYNC 割り込みを占有** (doc 明記)、裏 VRAM 使用、BEEP 音源のみ。
  Day 0 で VSYNC IRQ 配送パスを確認しておかないとローダのバグか IRQ パスのバグか切り分け困難。
- **Super Depth (.fdi)** (Bio 100%): .fdi 形式のフロッピーイメージとして配布されている自己起動ソフト。
  **Phase 3 ローダの対象外** — `.fdi` を accept リストに追加済 (B1)、A: にドロップで動作試験する。
  Phase 2 路線の動作確認サンプルとして残す。
- **Super Depth (LZH 配布版, `DEPTH100.LZH` 75KB, 1991)**: 上記と同じゲームの **DOS 版バイナリ** 配布。
  `depth.exe` (MZ, 70KB, 7 reloc, entry CS:IP=0000:E64A, SS:SP=11EC:1000, min_alloc 7KB) +
  データ 10 本 (`.bgm/.efs/.scr` テキスト、`.bos/.cXX/.fnt` は BFNT 形式) で構成。
  **doc 明記の前提**: MS-DOS 3.30+、PC-9801VM (286 10MHz)+、16 色、FM 音源、**VSYNC + Timer 割り込み使用**。
  **INT 21h 実測結果** (MOV AH;INT 21 パターン 49 件): 25h/2Ah/2Ch/30h/35h/3Ch/3Dh/3Eh/3Fh/40h/42h/
  **43h/44h** /48h/49h/4Ah/4Ch — **ほぼ計画通り** だが **43h (Get/Set Attr) と 44h (IOCTL Get Device Info)
  を追加実装** する必要あり (上の INT 21h 初期実装表に反映済)。
  INT 18h × 7、INT 1Ah × 1、INT DCh × 2 は既存 NP2kai 経路でカバー。
  起動オプション `-X` `-G` (PSP cmdline 経由)。データファイル群は独自フォーマットだがゲーム側
  が自前で `fopen` 経由読み込むだけなので、Emscripten FS へ `/run/` 展開すれば足りる。
- **Ray IV** (ともゆき / Tomoyuki.U, 1988-95): FM 音源演奏 + 16 色グラフィック + ESC キャラアニメの
  AV 統合ソフト。Ray データの再生・編集の両モードあり。LSI-C-86 v3.30 + 電波新聞社「FM音源音色
  ライブラリ Vol.2」製。
  **`rin.com` は常駐音源ドライバ (TSR)** — INT 21h AH=31h で先にインストールしてから `ray.exe` を
  起動するのが本来のフロー。**`rin.com` 無しでも BEEP 擬似 3 重和音でフォールバック起動**できると
  doc にあるので、まず BEEP モードでデモ動作のみ確認し、TSR 連携は +α 扱いとする。

#### 実行順 (推奨)

1. **Super Depth (.fdi)** (B1 確認時 / Phase 3 着手前) — 既存 Phase 2 で動くこと自体の確認
2. **さめがめ** (Day 8) — 静的、最小負荷、ローダ妥当性確認
3. **Super Depth (LZH)** (Day 8〜9) — INT 21h ほぼ全部 + IRQ + FM の中量級チェック。`.fdi` 版で
   ゲーム動作自体は確認済なので、純粋にローダ/INT 21h/IRQ 配送の総合テストになる
4. **ザルバールの蒸留塔** (Day 9〜10) — 動的物理 + マウス native I/O、固定画面
5. **GO!GO! うさちゃん列車** (Day 10) — IRQ 占有 + 裏 VRAM
6. **Ray IV (BEEP モード)** (Day 11) — ローダ単体での起動確認
7. **(+α) Ray IV (rin.com TSR 連携)** (Day 12) — INT 21h AH=31h 経路の動作確認

### 主な技術選択

- **LZH/ZIP 展開は JS 側**: 当初は `libarchive.wasm` を想定したが、**自前の軽量デコーダを採用**
  (`web/player/archive.js`)。LZH=LH4/5/6/7 + ヘッダ L0/1/2、ZIP=`DecompressionStream('deflate-raw')`。
  数百 KB の Wasm 依存を増やさず、`tools/lh5_test.js` で `lha` とバイト比較検証できる利点を優先。
  bridge 側では展開しない。RAR は本フェーズ対象外
- **ファイル I/O は Emscripten FS**: bridge の INT 21h ハンドラから libc 経由で読む
- **メモリレイアウト**: MCB を 0x0500 開始、PSP を 0x1000 付近、EXE をそのあと
- **PSP は簡易版**: 0:DOS exit、80h: command line tail、env segment は空。
  ローダ UI 側に「起動引数」入力欄を用意し、PSP `80h` (長さ 1B + 文字列 + 0x0D) にセット
- **マウス**: INT 33h スタブ (same.exe 用) + PC-98 native I/O port (zar 用) の二系統。
  どちらも NP2kai 既存マウス I/O 経路の上に配線

### リスクと緩和

| リスク | 影響 | 緩和 |
|---|---|---|
| DOS Extender 使用ソフトが多い | テスト本数中 N 本動かず | **テスト 5 本は事前調査で全本 extender 不使用と確認済** (2026-05-27) |
| PC-98 固有 INT が想定より多い | 個別調査必要 | `qbDebug.sample()` でハング時の INT を特定 |
| MZ 以外の形式 (NE/LE/LX) | 読み込み失敗 | スコープ外と判定、対象除外。**テスト 5 本は全本 MZ/COM** 確認済 |
| マウスが DOS 経由か直接 I/O か未調査 | テスト時無反応 | **調査済** — same=INT 33h (`-k` で keyboard fallback)、zar=PC-98 native I/O |
| rabbit の VSYNC IRQ 配送パス未確認 | 起動時にハング、原因切り分け困難 | Day 0 で IRQ 配送 (CRT IRQ ＝ NP2kai 既存経路) を bridge 経由で確認 |
| Ray の `rin.com` TSR 連携 | INT 21h AH=31h 未実装で動かず | `rin.com` 無しで BEEP フォールバック起動を Phase 3 合格条件に、TSR 連携は +α |
| 互換性の長尾が想定より長い | Day 12 で完了せず | 「Phase 3 ローダ 4 本中 3 本」で Phase 完了と定義、残りは Phase 4 へ |

### Phase 3 完了の定義

- **Phase 3 ローダ対象 4 本** (さめがめ / ザルバール / うさちゃん列車 / Ray) **のうち
  3 本以上が「タイトル/メイン画面以降の操作が可能な状態」で動く** こと
- **Super Depth (.fdi)** が Phase 2 経路で起動・操作可能であること (B1 で先行確認)
- 1 本が技術的にスコープ外と判明した場合 (例: Ray の TSR 経路が想定外に複雑) は
  除外して 3 本中 2 本で可。Ray の +α (TSR 連携) は合格条件外

### 進捗チェックリスト

**B1 (Phase 3 着手前の事前整備):** [完了]
- [x] テストスイート 5 本のアーカイブ中身調査 (2026-05-27) — 全本 MZ/COM、extender 不使用
- [x] `web/index.html` の accept リストに `.fdi` 追加 (Super Depth 用)
- [x] Super Depth (`.fdi`) を Phase 2 FDD 経路で起動・操作確認 (2026-05-27)

**Day 0 — scaffolding + 前提確認:** [完了 2026-05-27]
- [x] **Day 0a:** LZH/LH5 デコーダ実装 (`web/player/archive.js`) — `tools/lh5_test.js` で
  4 アーカイブ全 39 ファイル `lha xq` と byte-by-byte 一致
- [x] **Day 0b:** ZIP-deflate 解凍 (`parseZip` + DecompressionStream) — Super Depth zip
  → .fdi が byte-perfect
- [x] **Day 0c:** VSYNC IRQ 配送パス確認 (`tools/vsync_test/`) — 56Hz で text VRAM
  カウンタが回ることをユーザ目視確認
- [x] Run スロット UI + cmdline 入力 (`web/index.html`/`bridge.js`) + `db/games.json` 配信
- [x] LZH 展開 → Emscripten FS `/run/` 配置、ZIP-FDI → A: 挿入の 2 経路を Run ボタンに配線
- [x] `qbDebug.{ls,read,readSize,fs}` を追加して FS を DevTools から確認可能に

**Phase 3 ローダ実装 (Day 1-2 = 本実装、Day 3- = 互換性):**
- [x] **T1 (2026-05-28)**: 自作 hello.com (INT 21h AH=09h → AH=4Ch) — トランポリン + COM ロード
  - 動作確認: `HELLO PHASE3` 表示 + exit code 0
  - 実装: `native/dos_loader.c/h` (image staging + 0xFEE00 ハンドラ + PSP 構築 + CPU 状態書換) +
    `native/dos_int21.c/h` (02h/09h/4Ch + tty 風 VRAM 出力) + `tools/dos_loader/boot.asm` (8B 自己起動) +
    NP2kai bios.c に 3 case 追加 + `qb_dos_install_trampolines()` を `bios_initialize` 末尾から呼ぶ
  - NP2kai 改変は `tools/np2kai_patches/01_dos_loader_hooks.patch` に保存、`emscripten/build.sh` が自動適用
- [x] **T2 (2026-05-28)**: 自作 args.com (PSP 0x80 を読んで表示) — cmdline
  - 動作確認: cmdline 入力 `-k` → 画面 `ARGS:[ -k]` (先頭スペース込み) + exit 0
  - 実装: `dos_loader.c` の `stage_cmdline` で先頭スペースを prepend (実 DOS の PSP tail 慣例)、
    `tools/dos_loader/args.com.py` (52 byte) で PSP[0x81+len] を '$' 上書きしてから AH=09h 印字
- [x] **T3 (2026-05-28)**: 自作 hello.exe (MZ + reloc) — MZ パース + リロケーション
  - 動作確認: 画面 `HELLO EXE` (改行) + exit 0、reloc 1 件適用
  - 実装: `qb_dos_stage_exe` (MZ/ZM 両 magic 許容、ヘッダ整合検査 -3〜-9 のエラーコード、
    image_base_seg=0x0110 を reloc 即時加算)、`loader_start_hook` を COM/EXE で kind 分岐、
    staging buf を **640KB (PC-98 基本メモリ上限)** に拡張、`tools/dos_loader/hello.exe.py` (76 byte)
  - 副次修正: `dos_int21.c` の `g_cur_row/col` が reset を跨いで残り連続実行で 1 行ズレるバグ →
    `qb_dos_tty_reset()` を loader_start_hook から呼ぶ
- [x] **T4 (2026-05-28)**: さめがめ (sam98210.lzh, `-k` keyboard モード) — **プレイ可能まで通過**
  - 動作確認: LZH → ローダ → メニュー → Start Game → カーソルキー + スペースで領域選択 + 領域消去まで動く
  - INT 21h を 3 → **20 fn** に拡張: 02h/06h/09h/1Ah/25h/2Ah/2Ch/30h/35h/3Ch-3Fh/40h-44h/4Ah/4Eh/4Fh
  - PC-98 ANSI/ESC パーサ (ESC c, [J, [K, [H, [>5h/l 等)、未使用 INT の IRET stub
    (IVT[0x22..0xFF] が 0:0 のままだと事故、特に INT 33h)、正規 env segment (`A:\PROG.EXE` 入り)
  - LZH 経路を stage&run に接続、ファイル名 lowercase 化 (FS case-sensitive 対応)
  - UI: Stop ボタン (polling 強制停止)、Run 連打防止 (focus 外し)
  - **真因の発見**: テキスト VRAM 残留は NP2kai の **セル単位 dirty-flag (`tramupdate[]`)** に通知していないことが原因
    (メモリ直書きでは dirty が立たない → 前フレームのキャッシュが残る)。
    `vram_clear_all` と `vram_put_char` で `gdcs.textdisp |= GDCSCRN_ALLDRAW2` を立てて解消
  - debug 用: `qbDebug.textdisp() / grphdisp() / watchTextdisp() / textVram()` を追加
- [~] **T4.5**: Super Depth (DEPTH100.LZH) — **全リソース読込まで到達**、音楽ドライバで hang (既知課題)
  - [x] INT 21h **48h/49h** メモリ確保/解放 (bump allocator、`dos_loader.c`) — 2026-05-29
  - [x] **MIDI reset → ブラウザ凍結 fix** (`qb_commng.c`、2 回目以降の `COMMSG_MIDIRESET` 省略) — 2026-05-29
  - [x] **INT 21h の CF/ZF 復帰 fix** (`dos_int21.c`、`[SS:SP+4]` へ書き戻し。`_open` の JNC 判定等が機能) — 2026-05-29
  - [x] **env/argv[0] fix** (`dos_loader.c::build_env`、空 env → argv[0] 空読み → パス累積を解消) — 2026-05-29
  - [x] **close/ioctl の std ハンドル整合** (`dos_int21.c`、h=0..4 を close も no-op 成功) — 2026-05-29
  - [ ] **(既知課題)** 起動ロゴ後、Bio_100% 独自 **MML 音楽ドライバ**で hang。音楽イベント走査ループ
        (`0xFFFE` 終端の可変長レコード) が未コンパイルの生 MML バッファを舐めて無限ループ。
        INT 21h ローダではなく音楽ドライバ依存で深い RE が必要。**Super Depth LZH はオマケ扱い**
        (.fdi 版は Phase 2 で確認済) のため後回し。`qbDebug.regs()` でレジスタ確認可
- [x] **コードベース堅牢化 (2026-05-30)**: コードレビューで洗い出した「場当たり実装」を解消。
      全項目で さめがめ / Super Depth の回帰確認済。詳細は CHANGELOG。
  - [x] **`dos_path_to_host` を case-insensitive リゾルバ化** — DOS(大小無視)↔MEMFS(大小区別)
        のギャップを C 側で吸収 (旧: 両側で強制小文字化)。サブディレクトリ保持、MS-DOS 準拠
        エラーコード (途中 dir 欠=path-not-found 3 / file 欠=file-not-found 2)
  - [x] **AH=44h IOCTL の嘘成功是正** — 未対応 sub-fn は `CF=1`+ログ (旧: 全 sub-fn 無条件成功)
  - [x] **FindFirst 属性マスク尊重 + DTA に実日付/時刻** (旧: 属性無視・日時 0 固定)
  - [x] **ローダ入口の原理化** — argv[0] を実 image 名から生成 / EXE alloc ベースを `e_minalloc`
        由来に (マジック `SS+0x1000` 排除) / 入口レジスタのマジック定数 (`CX=0xFF`/`BP=0x091C`) 撤去
  - [x] **コメント陳腐化修正** (トランポリン番地 0xFFE0系→0xFEE00系、ローダ冒頭、bridge.js)
- [x] **T5 (2026-05-30)**: ザルバール — **完全プレイ可能** (盤面・マウスで壁生成/破壊、クリアで
      次面、quit でタイトル復帰)。zar.exe はランチャで `AH=4Bh EXEC` により実体エンジン
      siz3/siz4p.exe を起動する構成。**EXEC を「親常駐・子をアリーナにロード・子終了で親復帰」で実装**。
      副次修正多数: 4Ah self-shrink、47h/2Fh/19h/33h/入力系、ブロッキング入力の IF デッドロック解消、
      **DOS メモリマネージャを MCB チェーン化** (リーク解消)。詳細 [[feedback-dos-exec-launcher]]
- [x] **T4.5 Super Depth LZH (2026-05-30)**: **プレイ可能になった**。「MML 音楽ドライバ hang」既知課題は
      真因がメモリ破壊で、MCB チェーン化により根治 (音楽ドライバの RE は不要だった)。
- [x] **DOS メモリマネージャ MCB チェーン化 (2026-05-30、ギャップ④解消)**: bump allocator (free=no-op) を
      実 DOS 忠実な MCB チェーンに置換。48h first-fit+coalesce+分割 / 49h 実解放 / 4Ah 縮小分割・拡大結合 /
      EXEC 子に最大空き割当 / 子終了で所有ブロック全解放 (free-on-terminate)。
- [~] **T6 Ray IV (2026-05-31)**: **起動・RIN 常駐・FM 音楽・メニュー描画まで動作**。doc/strings 解析の結果、
      Ray は (BEEP フォールバックではなく) **起動時に常駐音源ドライバ `RIN.COM` を自前で `AH=4Bh EXEC`
      して常駐させる**構成と判明。実装: **EXEC の COM 子対応** + **AH=31h Keep Process (TSR)** +
      **AH=45h/46h DUP/DUP2**。これで RIN.COM を COM ロード → OPNA 検出 → 常駐 → FM 音楽 →
      RAYR.ENV/RAY_IV.RAY 読込 → メインメニュー描画まで通る。
  - **未解決 (保留、2026-06-01 に原因を局所化)**: オープニング手前で hang する黒画面の正体は、
    **Ray 自前の RLE グラフィック展開ルーチン** (`CS:IP=0110:0x9ca0-0x9f6c` = linear 0xada0-0xb06c,
    DS=ES=0xB000=赤プレーン) が **全ゼロのソース + 全 0 のエスケープマーカ (regs BX=0000/DX=ff00 →
    BL/BH/DL=0)** を舐めて空回りしているもの (SI は進むが DI ほぼ不動)。ループ中 INT 21h ゼロ /
    IVT[21h・1Ch] 乗っ取りなし / grphdisp ENABLE off / VRAM 空 を確認 → ベクタ・ファイル I/O・IF・
    表示 dirty の**いずれでもない**。真因は「**オープニング画像データが解凍バッファ (VRAM) に届いていない**」
    上流のデータフローで深い RE 要 (Phase 4 候補)。試した **IF=1 起動 (A) は無効**。Phase 3 合格条件
    (起動・デモ確認) は満たすため保留。詳細は CHANGELOG 2026-06-01。
- [x] **うさちゃん列車 (2026-06-01)**: **プレイ可能** (起動・デモ・キー操作・面クリア)。**公式 3/4 達成**。
      pure-asm で **生 IRQ1 を自前 INT 09h で受ける経路を初実証** (従来スイートは INT 18h BIOS 経由)。INT 21h は
      既存実装 (02/09/0C/25/2A/35/3C-3F/40/4C) で充足。タイトルの全角化けは下記「日本語表示」の根治で解消。
- [ ] (+α) Ray のオープニング/演奏完全表示 — 内部ループ hang の RE (Phase 4 候補)
- [x] **Bio 100%「蟹味噌」テキスト残留 — 根治 (2026-06-06)**。真因は **PC-98 RTC (μPD4990A) の Y2K バグ**:
      ゲームは日付を DOS でなく RTC から読み、我々の現在年 2026 が `2026-1900=126` の 3 桁年になって KANI.SCR
      の固定幅レコードを壊し、ゲームが自分の出力を「形式が違います」と弾いてそのメッセージが残留していた。
      **YouTube 実機映像で「左上に文字が一切出ない」を確認**して循環論法を断ち「我々のバグ」と確定 →
      `calendar.c:date2bcd` で年を 1999 にクランプ (patch 03) して根治。描画/属性/色/モード/LZEXE は全てシロ。
      詳細 CHANGELOG 2026-06-06。汎用 Y2K シムなので他の 90 年代ゲームのセーブにも効く。
- [ ] (低) パス解決の `.`/`..` 非畳み込み (`read_dos_rel`/`resolve_dir`、CHDIR とは非対称)。
      コードレビュー Finding 3。実害は揮発・完全仮想 MEMFS 限定 (実機 FS 不可達・流出なし) で発生確率も低いため
      **対策保留** (2026-06-03 判断)。直すなら `.` 破棄 + `..` で1段上がる正規化を入れ `/run` に clamp。
      詳細: [docs/dos_hle_gaps.md](docs/dos_hle_gaps.md) §2-11

### エンジン品質パス — 一区切り (2026-06-03〜04)

コア（エミュレータ）そのものの質を底上げ。詳細は CHANGELOG 2026-06-03 の 2 エントリ。

- [x] **ビルド最適化** — 実質 -O0 だったのを compile `-O2`/link `-O3` 化 = **2.02x 高速化・wasm 3.2x 縮小**
      (`tools/bench_frame.js` headless 計測、commit 3750bed)
- [x] **FM を fmgen 既定化** — 実機 A/B で opngen より明確に高音質。`qbDebug.fmgen(0|1)` トグル (1276c37)
- [x] **vol_master 掃除** — fmgen に無影響と判明 (opnalist 未populate)、65→100 中立化 (044ea4f)
- [x] **コードレビュー追随** — EXEC reloc 境界チェック + DUP2 UAF 修正 (3e4013b)
- [x] **音声を pull 型に再設計 (2026-06-04) — 劇的音質向上・途切れ皆無 (実機ユーザー確認)**。比較対象
      irori/np2-wasm より明確に劣る (数秒ごとのプチ/途切れ) 真因は、旧プッシュ型 (rAF で生成 → C リング →
      AudioWorklet) で生成 (system 時計) と消費 (audio DAC) の2クロックがドリフトし、リングが周期的に溢れ
      (プチ)/枯れ (途切れ) ていたこと。`ScriptProcessorNode.onaudioprocess` (DAC クロック) が
      `np2kai_audio_fill`→`sound_pcmlock` を直接 pull する pull 型に戻しマスタークロックを DAC 1つに統一
      (irori/SDL と同型、ただし `-sUSE_SDL=2` は cache 権限/ネット取得で環境不適合 → SDL 依存を捨て自前 glue)。
      `soundmng_sync` は no-op 化 (二重消費回避)、`qb_audio_drain`→`qb_audio_fill`+`get_bufsize`、`delayms=100`。
      CPU 不変 (bench 77.6fps)。`audio-worklet.js` 削除。別スレッド化 (AudioWorklet+SAB) は将来 C2。詳細 CHANGELOG
- [x] **快適化: async 自動クロック (2026-06-04 完了・既定 ON)** — 計測で前提が反転。`fps(M)≈3300/M` で
      **42 は headless 78.6fps>56.4 で安全**、当初「42→underrun 再発」は誤外挿。**大半のゲームは HLT→倍率
      ほぼ無料** (HLT fast-forward)、効くのは稀な CPU 飽和のみ=**静的バンプは低価値**。よって静的値ではなく
      **run_frame 実時間から multiple を毎フレーム逆算する適応コントローラ** (`web/player/bridge.js` autoClock、
      [floor=20,ceil=42] ヒステリシス) を実装。engine の `SUPPORT_ASYNC_CPU` は `lastTimingValue` 未結線で
      機能しないため、調整カスケード (`np2kai_set_clock_multiple` = engine 同手順の changeclock+gdc_updateclock)
      だけ借りた。罠: live 倍率変更は `gdc_updateclock` 必須 (`dispclock∝multiple`)。ベンチ資産 `tools/bench_cpu/`。
      `qbDebug.autoclock(0|1[,ceil])`。詳細 CHANGELOG / [[project_clock_multiple_autoclock]]。**残候補**: ceil の
      実ゲーム最適値の追い込み (現状差は体感薄)、AudioWorklet+SAB 別スレッド化 (C2) で更に余裕
- [x] **メモリ: XMS HLE (Tier 1, 2026-06-05)** — 640KB の壁の外へ。「HIMEM ロード済 DOS」を素直に再現
      (`native/dos_xms.{c,h}`、既定 ON)。EMB は実拡張メモリ `CPU_EXTMEM`(32MB) に first-fit 確保。INT 2Fh AX=4300→在/
      4310→entry F000:EE70 → far CALL で AH=関数 (00/08/09/0A/0B Move/0C-0D Lock(実 linear)/0E/0F/03-07 A20)。XMS 3.0 契約、
      HMA/UMB/88-89 は素直に「無い」。`qbDebug.xms(0|1)`。検証 `tools/xms_test.js`、実証 AMEL `/X`=実機で 338KB 確保。
      残: **Tier 2** (lock 実利用クライアント / A20 実ゲート / 88h-89h)、**EMS** (INT 67h、ページフレーム copy で重い)
- [ ] **メモリ: 需要プローブ (2026-06-05)** — INT 2Fh AX=43xx / INT 67h / EMMXXXX0 open を検出ログ+カウント
      (`qbDebug.memprobe`)。XMS 無効時 or EMS は「無し」応答のまま。games/mem_test で XMS=VZ/AMEL、EMS=JED/mm46/5ds 等を確認。
      EMS のパッシブ署名検出 (IVT[0x67] memcmp) は能動カウント不可=盲点 (binary "EMMXXXX0" が確実シグナル)
- [ ] **Bio 100% の BEEP 超絶技巧** — `oneshot` 経路 (mode==0)。まず実機で現状を聴いて当てる
      (BEEP は完全結線済・`beepg.c`。rategenerator の snap-to-zero は vol≤3 で非発火＝cosmetic)

### 日本語 (漢字) 表示の課題 — 解決済み (2026-06-01)

**真因:** `native/dos_int21.c::vram_put_kanji` が漢字セル高位バイトを `(jis_lo-0x20)|0x80` と索引化していた
(低位=区索引は正しい)。PC-98 テキスト VRAM の漢字セルは **非対称符号化**で、**高位 = 生 JIS第2バイト | 0x80**
が正解。font.bmp も `fontpc98.c`(pc98knjcpy) も `maketext.c` も `cgrom.c`(CG窓) も全てこの配置で内部整合
しており、**font.bmp は最初から正しかった**。高位を `jis_lo|0x80` に直して根治 (実機回帰確認済:
rabbit タイトル正常・sjistest 全角正常・さめがめ無回帰)。さめがめは CG 窓経由なので無関係 (回帰ゼロ)。
- **前回 (2026-05-31) の「標準JIS不一致で保留」は誤診**: font.bmp を区/点「索引」で覗いて空白を見たため
  (実際は jis_lo「バイト」位置に正しく格納)。詳細は CHANGELOG 2026-06-01 と [[feedback-pc98-kanji-font]]。
- 副産物の **リセット時 fontrom ゼロ埋め抑止** (`02_font_reset_fix.patch`) は引き続き有効 (generic 改善)。
- 誤診ベースの `make_kanji_font.py` は **削除**。SJIS-tty 描画コードは **現役** (rabbit タイトル/sjistest で稼働)。

### INT 21h ギャップ一覧 (2026-05-30 棚卸し)

現状 INT 21h は **24 fn 実装** (`02 06 09 1A 25 2A 2C 30 35 3C 3D 3E 3F 40 41 42 43
44 48 49 4A 4C 4E 4F`、44h は sub `00/01` のみ)。残りを「テストスイートへの効きやすさ順」で。
**ground truth**: `dos_int21.c` の default が `[int21h] UNIMPL AH=XX` をログするので、
T5 を一度回せば zar が実際に叩く未実装 AH が即わかる。下記は先回り候補のカタログ。
DEPTH は実測済みで AH 不足ゼロ (hang は MML ドライバ side)。

**重要な前提 (2026-05-30 判明)**: PC-98 ゲームはキー入力を **INT 18h** (PC-98 キーボード
BIOS、`bios18.c` が実装済) 経由で読む。**さめがめが DOS 入力ゼロのまま動いた**のが証拠。
→ 下記①の DOS 入力系は「保険」で、テストスイートでは未行使の可能性が高い。

- **① コンソール入力系** [一部実装 2026-05-30: `01 07 08 0A 0B 0C`、`19`/`33` も追加]
  blocking は NP2kai 流の `CPU_IP--; CPU_REMCLOCK=-1` で再ポーリング (`bios18.c` AH=00h と同手法)。
  BIOS キーバッファ (0x502, count 0x528) から読む。`05h` プリンタ出力は未実装 (不要)。
- **② C ランタイム起動時の system 系** [`19h`/`33h` 実装済 2026-05-30]
  残: `36h` 空きディスク容量、`47h` カレントディレクトリ、`3Bh` CHDIR、`0Eh` ドライブ選択、
  `38h` 国別情報。← T5 の UNIMPL ログで要否を確定してから追加。
- **③ ハンドル/日付の取りこぼし**: `57h` ファイル日時 get/set、`45h`/`46h` DUP/DUP2、
  `5Bh` 排他 create、`59h` 拡張エラー、`2Bh`/`2Dh` 日付/時刻 set。
- **④ 構造的な穴 (個別 fn でなく仕組み)**:
  - **本物の MCB チェーンが無い** — `48/49/4A` は bump allocator で free は no-op (巻き戻さない)。
    alloc/free を繰り返す or `4Ah` 伸縮するゲームはリーク/破綻。参照: DOSBox-X `dos_memory.cpp`。
    工数 中 (〜半日, 100〜150 行)。**テストスイートは小型 FD ゲームで起動時 1〜2 回 alloc 想定 →
    当面 bump で足り、必要になった時に実装する** 方針。
  - **PSP フィールド欠落** — `build_psp` は 00/02/2C/50/80 のみ。`18h–2Bh` JFT、`0Ah–15h` 保存
    ベクタ、`5Ch`/`6Ch` 解析済 FCB 2 個が空。cmdline 引数を tail でなく FCB から読むソフトは引数欠落。
  - **FCB 系ファイル I/O 一族** (`0F 10 11 12 13 14 15 16 17 21–24 27 28 29`) 丸ごと未対応。
    古いソフト (Ray IV 1988-95 等) が使う可能性。ハンドル系実装済なので C ランタイム製なら不要。
  - `4Bh` EXEC (子プロセス/オーバーレイ起動) 未対応。`31h` TSR は Ray rin.com 用で +α 既知。
- **⑤ INT 21h 以外で注意 (PC-98)**:
  - **INT DCh** — zar/DEPTH が叩くが `dos_loader.c` の「IVT[0x22..0xFF] が 0:0 なら IRET-stub」
    ループの射程内。**NP2kai が IVT[0xDC] を実ハンドラで埋めているか要確認** — 埋めてなければ
    我々が no-op IRET に潰している可能性 (静かに誤動作)。T5 で挙動が変なら最初に疑う場所。
  - `INT 18h`(zar×31)・`INT 1Ah`(zar×1) は 0x00–0x1F 帯で NP2kai 既存経路 → OK 想定。
  - `INT 2Fh` (multiplex) は専用フック化済 (2026-06-05)。**XMS インストールチェック (AX=4300/4310) には
    「在り」と応答** (HIMEM 相当 HLE、`dos_xms.c`)。他 AX (MSCDEX 等) は未対応で「未インストール」のまま。

**ESC シーケンスについて**: PC-98 ANSI/ESC パーサは T4 (さめがめ) で実装済 (`ESC c/[J/[K/[H/[m
/[A-D/[>5h/l`)。残テストスイート (zar/rabbit/ray) は固定画面 or 自前描画なので **既存セットで足りる
見込み**。未知シーケンスで表示が乱れたら個別追加する reactive 対応で十分。漢字の 2 バイト出力は
別件 (後回し中の文字コード問題 = [[reference-dosbox-x-pc98-hle]] / int_dosv.cpp 参照)。

### T1 実装で得た学び (Day 1-2 設計の補正)

**トランポリン番地の選定** — 0xFFE0/FFD0 等を当初想定したが衝突あり:
- `0xFFFE8/0xFFFEC` = bootstrap entry (NOP+RETF、`bios_initialize` で設置済)
- `0xFFFF0` = reset vector (`JMP FAR FD80:0000`)
- `0xFD800-0xFEC37` = `biosfd80.res` の中身 (約 5KB の BIOS ROM 模擬)
- → 空き領域は **0xFEC38 以降**。実際の採用番地は `0xFEE00/EE10/EE20/EE30`

**`biosfunc` の case ラベルは linear address** — `BIOS_BASE + BIOSOFST_*` (= segment FD80 のオフセット式) と
混在しているが、0xfffe8/0xfffec/0xFEE00 等は直接 linear address で書く。F000:EE00 → `case 0xFEE00`。

**ニワトリ卵問題** — NOP は guest が踏まないとフックが発火しない。よってフック内で NOP を書く設計はダメ。
**`bios_initialize` (= 毎リセットで実行) で NOP を pre-install する** のが正解。`qb_dos_install_trampolines()`
は `bios_initialize` 末尾から呼ばれ、毎リセットでトランポリンを再書き込みする。

**CPU レジスタアクセス** — `CPU_AH` / `CPU_AL` / `CPU_AX` 等の byte/word/dword 別マクロが揃っている
(`core/np2kai/i386c/ia32/cpu.h`)。`CPU_CS/DS/ES/SS` 書き換え後は `ia32_bioscall` が `LOAD_SEGREG` で
自動 reload するので明示呼び出し不要。CF は `CPU_FLAG |= C_FLAG` (= 1<<0)。

**終了処理** — INT 21h AH=4Ch で `CPU_CS:IP` を BIOS 領域の `F4 EB FD` (HLT; JMP -3) に飛ばすと、
image の続きを実行させずに CPU を停止できる。JS 側は 100ms polling で exit を検知。

### Phase 3 Day 1-2 設計 (確定済、未実装)

#### トランポリン機構
NP2kai は **任意の NOP (0x90) を BIOS 領域 (0xF8000-0xFFFFF) で実行 → `ia32_bioscall` →
`biosfunc(adrs)` C 関数呼び出し** という既存フック機構を持つ (詳細は memory
[[feedback-np2kai-nop-hook]])。USE_CUSTOM_HOOKINST 等のコンパイルフラグ追加不要。

レイアウト (空き BIOS 領域 0xFE000〜):
```
0xFE00:0000  90 CF   NOP; IRET   — INT 21h dispatcher
0xFE00:0010  90 CF   NOP; IRET   — INT 33h (mouse)
0xFE00:0020  90 CF   NOP; IRET   — INT 18h overlay (必要時、PC-98 BIOS 拡張)
0xFE00:0080  90      NOP         — ローダ起動エントリ (CS:IP/PSP セット用フック)
```

`core/np2kai/bios/bios.c:biosfunc()` の switch に case を追加するだけ (forward decl 経由で
`native/dos_*.c` 側関数を呼ぶ)。NP2kai 触る唯一の箇所。

#### ブートストラップ (`tools/dos_loader/boot.asm`, 1024 byte)
1. テキストモード設定 (既存パターン、boot_hello 流儀)
2. IVT[0x21] = 0xFE00:0x0000、IVT[0x33] = 0xFE00:0x0010 を書く
3. `jmp far 0xFE00:0x0080` で「ローダ起動フック」へ
4. bridge 側: ia32_bioscall → biosfunc(0xFE080) → JS から渡された image を guest メモリ
   へ展開、PSP 構築、CS:IP/SS:SP を image エントリへ書き換え → return
5. CPU が新 CS:IP から image を実行開始

#### メモリレイアウト
```
0x00000-0x003FF  IVT (256 entries × 4 byte)
0x00400-0x005FF  BIOS data area (NP2kai 既存)
0x01000          PSP (segment 0x0100, 256 byte)
0x01100          .EXE/.COM ロード位置 (segment 0x0110) + Z block 空きヒープ
0xA0000-0xBFFFF  text/graphics VRAM (既存)
0xFE000-0xFE0FF  我々のトランポリン
```

#### PSP (DOS 互換、最低限)
- 0x00: `CD 20` (INT 20h = DOS exit ショートカット)
- 0x02: top-of-memory paragraphs
- 0x2C: env segment (0 = 空環境)
- 0x50: `CD 21 CB` (INT 21h; RETF = DOS call ショートカット)
- 0x80: cmdline 長 (1 byte) + 0x81..: cmdline + 末尾 0x0D

#### ローダ本体 (`native/dos_loader.c`)
JS 側 bridge.js: `qbDos.load(file: File, name: string, cmdline: string)` で:
1. parseLzh から `/run/{name}` を読む
2. bridge 関数 `np2kai_dos_load(name_ptr, cmdline_ptr)` に渡す

C 側 (`native/dos_loader.c`):
- COM (拡張子 `.com` / 先頭が `MZ` でない): segment 0x0110 へ生コピー、CS:IP = 0x0110:0x0100、
  SS:SP = 0x0110:0xFFFE
- EXE (先頭 `MZ`): header 解析、image を 0x0110 以降に展開、relocation 適用、CS:IP/SS:SP =
  header 指定 + 0x0110
- 共通: PSP を 0x0100 セグメントに作る、cmdline を 0x80 に書く

#### INT 21h 初期セット (`native/dos_int21.c`)
- **Day 1**: `4Ch` (exit), `09h` (print string), `02h` (print char)
- **Day 2**: ファイル系 (`3Dh open`, `3Eh close`, `3Fh read`, `40h write`, `42h seek`),
  PSP/メモリ系 (`30h get version`, `48h alloc`, `49h free`, `4Ah resize`),
  その他 (`25h set vec`, `35h get vec`, `2Ah/2Ch date/time`)
- **+α**: `31h Keep Process` (Ray の rin.com TSR、Phase 4 候補)

`4Ch` (exit) は CPU を halt させる代わりに「終了画面に戻る」フラグを立てて、
`np2kai_run_frame` ループから抜ける形にする。

#### モジュール分割 (新規)
- `native/dos_loader.c/h` — MZ/COM ローダ + PSP 構築 + メモリレイアウト
- `native/dos_int21.c/h` — INT 21h ハンドラ群
- `native/dos_int33.c/h` — INT 33h (マウス) スタブ
- `core/np2kai/bios/bios.c` に biosfunc dispatch case 追加 (forward decl 経由)
- `tools/dos_loader/boot.asm` — 1024 byte ブートストラップ
- `web/player/bridge.js` Run ボタン: lzh 経路を新ローダへ繋ぐ (現状は `/run/` 展開止まり)

#### 検証順 (T1〜T5)
| # | テスト | 目的 |
|---|---|---|
| T1 | 自作 hello.com (AH=09h → "hello" → AH=4Ch) | トランポリン + COM ロード + 2 関数 |
| T2 | 自作 args.com (PSP 0x80 を読んで表示) | PSP cmdline |
| T3 | 自作 hello.exe (MZ 形式、reloc あり) | MZ パース + リロケーション |
| T4 | sam98210.lzh / same.exe `-k` | ファイル read + メモリ系 |
| T4.5 | DEPTH100.LZH / depth.exe | INT 21h ほぼ全部 (43h/44h 追加) + VSYNC/Timer IRQ + FM + 大量データ read |
| T5 | zarfw.lzh / zar.exe / マウス | INT 33h + PC-98 native I/O 連携 |

---

## メモ

### d88ディスクイメージ仕様（PC-98 2HD）
- 77 cylinders × 2 heads × 8 sectors × 1024 bytes = 1,261,568 bytes（raw）
- `tools/img2d88.py` で raw .img → .d88 変換可能

### ビルド手順
```bash
bash emscripten/build.sh
emrun --port 8080 web/
```

### フレームバッファ
- `bpp=2`: RGB16 (5-6-5) → JS側でRGBA32変換
- 解像度: 640×400（PC-98標準）

---

## コードレビュー棚卸し (2026-06-01)

ざっとレビューで挙がった残課題。重大な 2 件 (Run ボタン disabled / `setDriveName` 引数ずれ)
は同日修正済み。以下は確信度 中〜低のエッジケース・保守性メモで、未対応。

### ローダ (native) — 確信度 中〜低・エッジ
- **大物 EXE で alloc アリーナが無音で size 0 に縮退** (`dos_loader.c:690-691, 138`)。
  640KB 近い EXE で `image_base + end_rel + 0x10 > 0xFFFF` になると、エラーにせず
  `QB_DOS_MEM_TOP_SEG`(0xA000) にクランプ → 空き 0 段のアリーナになり AH=48h が全失敗。
  ログも出ないので「なぜか動かない」になりがち。最低でも warn ログ、可能なら明示エラーを。
- **read/write が 64KB セグメントラップでなく 2MB linear で伸びる** (`dos_int21.c` の 3Fh/40h、
  `poke8` の `& 0x1FFFFF` 任せ)。DS:DX がセグメント終端付近 + 大きな CX だと、本来ラップ
  すべき書き込みが隣を踏む。実害は稀だがリアルモード的には不正。
- **EXEC 親コンテキスト退避が `mem[splin]` を生インデックス** (`dos_loader.c:816-821, 862`)。
  今は 2MB 配列内で安全だが、他が全て `poke8/peek8` でマスクしているのと非対称。
- **常時 stderr デバッグログ多数** (open/seek 等の頻出パスにも、gate 無し)。本番では
  verbosity フラグ化が望ましい。
- **get 系ハンドラの一部が CF を明示クリアしない** (`int21_19/2a/2c/30/35` 等)。tail で
  「触らなければ現状の FLAGS をそのまま書き戻す」設計なので、直前状態次第で CF が
  残りうる。多くの呼び出しが CF を見ないため実害は出にくいが、厳密には clear すべき。

### フロントエンド (JS) — 確信度 中〜低
- ~~**SJIS ファイル名の 0x5C 問題** (`bridge.js` の `replace(/\\/g,'/')`)。「ソ」「表」等 第2バイトに
  `0x5C` を含む漢字名でパスを誤分割しうる~~ → **解決済 (2026-06-02)**: SJIS 対応の `dosPathToSlash`
  (lead バイト直後の 0x5C は trail 素通し) を書庫経路に適用、FAT 名は無変換。下記
  「ディスクイメージのコンテナ展開」参照。`archive.js::decodeName` は依然 latin1 のまま (FS キーは
  原バイト保持が正しい。表示の SJIS デコードは別件・任意)。
- **`archive.js` の堅牢性**: `inflateRaw` の `expectedSize` 引数が未使用 (展開後サイズ検証なし)、
  `readPtLen`/`readCLen` が破損入力で `nsize` 超過の範囲外書き込みになりうる (JS なので
  クラッシュはせず誤デコード)。正常データでは問題なし、堅牢化の余地。
- **`pollDosExit._stop` の単一スロット** が自然終了後も前回参照を保持 (`currentPoll` ガードで
  誤発火は防げているが設計が脆い)。

---

## ディスクイメージのコンテナ展開 (2026-06-02、Phase 4 プロダクト層)

`.d88`/`.fdi`/`.hdm` 等のフロッピーイメージを **ブートせず・中の FAT ファイルだけ取り出す**経路を追加
(`web/player/diskimage.js`)。書庫 (.lzh/.zip) と同じ `/run/` に合流。**JS のみ・Wasm 不変。**

- **対応 (フロッピー)**: D88/D77/D98 (`.d88/.d77/.d98/.88d/.98d`) / FDI (`.fdi`) / DCP/DCU (`.dcp/.dcu`) /
  raw beta (`.xdf/.hdm/.2hd/.dup/.flp`/生)。FAT12/16 自動判別・サブディレクトリ再帰。
  バイト配置は NP2kai `diskimage/fd/*` 参照。
- **恒久対応外** (意図的・明示メッセージ): NFD (セクタID保持=プロテクト保全) / BKDSK (BASIC) / VFDD。
  QuuBee のミッション (クリーン・フリーソフト限定) と逆向きのため。
- **赤線維持**: 自己起動/非FAT イメージは「中身取り出し不可」で弾く (ブートさせない)。
- **SJIS ファイル名 0x5C (ダメ文字) 問題を解消**: FS 書き出しの区切り変換を **SJIS 対応の `dosPathToSlash`**
  (lead バイト直後の 0x5C は trail として素通し) に変更し、書庫経路にだけ適用。FAT 名は '/' 区切り生成 +
  0x5C は必ず漢字 trail なので無変換。`ソ`(0x83 5C)/`表`(0x95 5C) 等を含む名前の誤分割が消えた
  (旧コードレビュー棚卸しの懸念を解消)。
- **現代的フォルダ移動 UI**: パンくず + フォルダ降下 (ノスタルジー無視)。
- **検証**: `tools/diskimage_test.js` (Node) で raw/d88/fdi の3経路バイト一致・4階層再帰・非FAT判定・
  **SJIS 8.3 名の生バイト保持** = pass 30/0。DCP/DCU はサンプル未入手で実バイト照合のみ未 (実装済)。
- **残**: HDD イメージ (`.hdi/.nhd/.thd`) は de-container + PC-98 パーティション解析を足すだけで既存
  FAT16/再帰/`imageToVolumes` 継ぎ目に乗る設計。**公開解禁の可否は別途判断** (商用丸ごと率が高く赤線に触れやすい)。
- **✓ ブラウザ実機での目視確認済み (2026-06-03)**: ①FAT12 取り出し+サブディレクトリ再帰+パンくず移動 /
  ②自己起動・非FAT を赤線で弾く / ③恒久対応外 (NFD/BKDSK/VFDD) の形式別メッセージ / ④漢字ファイル名の
  SJIS 表示、すべて OK。④ は **corpus の書庫/イメージが全て ASCII 8.3 名で踏めない**ため、日本語 8.3 名を
  1 本持つ合成 FAT12 `.hdm` を作って確認 → `diskimage_test.js` に恒久テスト化 (上記 pass 30/0 の SJIS 分)。

## 起動 .bat のレシピ解釈 (2026-06-03、Phase 4 プロダクト層 / エントリ自動検出)

起動 .bat を「作者が書いた機械可読の起動レシピ」として解釈し、主プログラム + 引数を自動導出する経路を追加
(`web/player/batscript.js`)。**JS のみ・Wasm 不変。**`db/games.json` への手書き (entry/cmdline) が実質不要に。

- **調査根拠**: `games/` の 40 書庫中 14 本 (35%) が .bat 同梱。パターン = ①引数パススルー (`ZAR %1`)
  ②音源ドライバ TSR で包む (`mdrv98`→game→`mdrv98 -r`、最多) ③複数 .bat = 起動方法の選択肢
  (音源モード beep/fm/midi 等が多いが音源限定ではない) ④制御フロー (`:LOOP`/`IF ERRORLEVEL`、コーパス唯一の finalty)。
- **① 実装済 (JS 起動レシピ抽出)**: パーサ + `resolveMain` (`.COM`>`.EXE`・ドライブレター/パス剥がし・大小無視) +
  `buildCmdline` (`%N` 置換・リテラルフラグ保持)。`bridge.js` は .bat 最優先自動選択 / 複数 .bat は一覧選択 /
  レシピ起動。検証: `tools/batscript_test.js` 26/0 + 実書庫 26 .bat 全解決 + 回帰なし。
- **② 実装済 (2026-06-03、ミニ COMMAND.COM)**: 音源ドライバ TSR の常駐を「シェルが 1 DOS セッション内で
  各コマンドを順に AH=4Bh EXEC」する形で成立させた。`tools/dos_loader/shell.asm` (COM、self-shrink→表を
  順に EXEC→4Ch) + `qb_dos_stage_script` (C) + `resolveSequence` (JS)。EXEC/TSR(31h)/MCB は既存再利用、
  既存単一起動・EXEC 経路は不変 (回帰隔離)。検証 `batscript_test 33/0` + ビルドクリーン。
  **実ゲーム (mdrv98 系) のブラウザ動作確認が次の実フロンティア** — 「MDRV98/middrv 等が HLE で実際に
  FM を鳴らせるか」。残課題: 旧式 `INT 27h` TSR、制御フロー .bat の完全逐次 (finalty の demo→main ループ)。
  **per-child env で argv[0] 正規化 (C1) は 2026-06-04 実装済** — 継承 EXEC で `build_child_env` が子固有 env を
  確保し argv[0] を子パスに正規化 (env を子本体より先に確保→所有権を子へ、`env_seg!=0` は現行維持・拡張容易)。
  `tools/exec_env_test.js` で headless 回帰 (継承 env=0 / 親復帰 / 子 argv[0])。
  - 現状の暫定動作: ドライバは読み飛ばし、主プログラムだけ起動 → ゲームが FM ポート直叩きなら鳴る /
    ドライバ依存音源なら無音 or BEEP のグレースフル (起動・プレイ自体はブロックしない)。

## LZH 対応状況と残ギャップ (2026-06-01)

`web/player/archive.js` の対応: **メソッド** lh0 / **lh1** / lh4 / lh5 / lh6 / lh7、**ヘッダ** Level 0 / 1 / 2。
`games/` 全 .lzh (Bio 100% 等) を `lha xq` と byte 比較する `tools/lh5_test.js` で **420 エントリ一致**
(lh0/lh1/lh4/lh5 × L0/L1/L2 を実書庫で網羅検証)。

**解決済 (2026-06-01):**
- ✓ **`-lh1-` 対応** — LHarc 1.x の適応 Huffman + 4KB 窓を実装 (`lh1Decode`)。LHa for UNIX
  dhuf.c/shuf.c/slide.c を参照しクリーン実装 (定数: THRESHOLD=3, maxmatch=60, N_CHAR=314, np=64,
  位置は静的テーブル)。`GETS/GS100/MOG003.LZH` の 16 エントリが byte 一致。
- ✓ **未対応メソッドで中断しない** — `parseEntry` は未対応メソッドを throw せず `data=null` で返し、
  `parseLzh` は `next` で次へ進む。混在書庫でも対応エントリは取りこぼさない (bridge は skip + warn)。

**残ギャップ:**
- **lh6/lh7 実バイナリ未検証**: アルゴリズムは lh5 と同一で構成上は正当 (パラメータ表が LHa 標準と一致)
  だが、本 corpus に lh6/lh7 が無く、手元の Lhasa は展開専用で作成もできず実データ照合が未。
  実書庫が得られれば `games/` に置くだけで `lh5_test.js` が自動検証する。
- **Level 2 ディレクトリ拡張ヘッダ (type 0x02) 未踏**: 実 L2 書庫が全てルート配置のため、サブディレクトリ
  結合 (0xFF 区切り → '/') の経路は実書庫で踏まれていない (構成上の正当性のみ確認)。
- **`-lh2-/-lh3-`, LArc (`-lz4/5/s-`), PMarc 等**: 未対応 (本スコープでは稀)。当たれば skip される。
