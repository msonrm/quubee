# 音声スレッド再設計 — emulator を Web Worker へ (移行プラン)

> 状態: **合意済み・Stage 0 着手 (2026-06-17)**。関連メモリ: `project_audio_thread_rearch`。

## なぜやるか (計測で確定した真因)

ユーザー報告: FM 音楽の「ほんのわずかなテンポの揺れ・フレームが詰まるような音のスキップ」が
快適な聴取を大きく損なう。

`qbDebug.audioStats()` の実機計測 (2026-06-17) で真因を切り分けた:

| | 1回目 (39s, bad run) | 2回目 (96s, good run) |
|---|---|---|
| rAF/s | 50 | 59 |
| コマ落ち/s | 5.9 | 0.7 |
| エミュ飽和/s | 0.31 | **0** |
| 遅刻CB/s | 0.03 | **0** |

- **音声の配信(delivery)はほぼ無事** — 遅刻CB ≈ 0。85ms の ScriptProcessor バッファが吸収している。
- 揺れの真因は **emulation の cadence**。emulator は rAF に律速され (`TARGET_HZ=56`, `MAX_CATCHUP=3`)、
  メインスレッドで描画・ピクセル変換と CPU を取り合う。負荷時は飽和し backlog を捨て (bad run)、
  通常時でも rAF の **サブ25msジッタ**で生成側バッファが瞬間的に枯れる。**ユーザーは「滑らかな時でも
  気になる時がある」と報告** = 過負荷成分だけでなくジッタ成分もある。
- したがって「描画間引き」等の**過負荷対策では smooth-time 成分は直らない**。両成分を一発で消すには
  **emulation を DAC 需要に合わせて一定ペースで先回り供給する = Web Worker 化**しかない。

これは元々 memory で「将来 C2」として温存していた項目。計測で前倒し実施が正当化された。

## 棚卸し (移行を安全にする前提)

- **emulator を触るのは `web/player/bridge.js` だけ** (93 接点)。`archive.js` / `diskimage.js` /
  `batscript.js` / `magimage.js` / `pmdmeta.js` は emulator 接点ゼロ = 純粋なバイト処理 → main に残す。
- **Wasm の再ビルドは不要** (純粋な JS 再編成 + ヘッダ設定):
  - `MODULARIZE=1` 済 → worker から `NP2KaiModule` factory を呼べる。Emscripten の既定 ENVIRONMENT は
    worker を含む。
  - OffscreenCanvas は JS API (ビルド不要)。worker 側の 2D context に描く。
  - 音声リングは**素の SharedArrayBuffer** (pthread/SHARED_MEMORY ビルド不要)。emulator の Wasm HEAP は
    共有しない。
- 外部オリジン資源はゼロ (index.html の GitHub リンクは `<pre>` テキスト) → COEP は安全。

## 目標アーキテクチャ (3 スレッド)

| スレッド | 責務 |
|---|---|
| **main (UI)** | DOM・ファイラ・`archive/diskimage/batscript/magimage/pmdmeta`(無改変)・入力捕捉(key/mouse/gamepad)→worker 転送・`AudioContext`+`AudioWorkletNode` 生成・`<canvas>` を `transferControlToOffscreen` で worker へ・worker への制御コマンド発行/状態受信 |
| **worker (emu)** | Wasm 本体・run ループ・Emscripten FS・全 `np2kai_*` 呼び出し・OffscreenCanvas へ描画・PCM を SAB リングへ書く |
| **AudioWorklet (音声スレッド)** | SAB リングを読んで出すだけの純 consumer |

**設計の肝**: worker の emulation を**固定 tick でなく「SAB リングの埋まり具合」で駆動**する
(半分を切ったら数フレーム先回りして補充)。これで楽音テンポが DAC ロックになり、main/worker の
ジッタから切り離される = 揺れの**両成分が消える**。

## 段階プラン (各段ブラウザで検証・Wasm 再ビルドなし)

### Stage 0 — cross-origin isolation (挙動不変の地ならし) ← 着手中
SharedArrayBuffer は cross-origin isolation を要求する。これを最初に確定して唯一の外部依存を潰す。
- `web/_headers` (Cloudflare Pages): `COOP: same-origin` + `COEP: require-corp`。`deploy.sh` の
  `cp -rL web/.` で dist に乗る。
- ローカル開発: `emrun` は COOP/COEP を出さない → `tools/devserver.js` (zero-dep Node、ヘッダ + 正しい
  MIME、特に `.wasm`=application/wasm) を用意。
- 検証: `crossOriginIsolated === true` / `typeof SharedArrayBuffer !== 'undefined'` / 全アセット
  (wasm/font.bmp/SF2/rhythm/pmd) が従来どおり読める / 既存機能 (ゲーム起動・音・MIDI) が回帰なし。
- **このステージは挙動を変えない** (ヘッダ追加のみ)。ここで回帰が出たら COEP 緩和 (`credentialless`) を検討。

### Stage 1 — emulator を worker へ (表示 + 入力 + FS、音は仮配線)
- worker が `NP2KaiModule` をロードし、run ループ/FS/全 `np2kai_*` を所有。
- `<canvas>` を `transferControlToOffscreen` → worker が RGB565→RGBA 変換コードをそのまま移設して描画。
- 入力 (keyboard/mouse/pointer-lock/gamepad) は main で捕捉 → postMessage で worker へ。
  gamepad は Worker から触れないので `pollGamepads` は main に残し状態転送。
- ファイラはバイトを worker の FS へ送る (transferable ArrayBuffer)。`/run` ライブ反映は worker→main。
- 音だけ暫定で worker→main postMessage(使い捨て)で既存 ScriptProcessor に流す。
- **マイルストーン: ゲームが worker 上で起動・表示・操作できる** (コーパスで確認)。

### Stage 2 — 音声 SAB リング + AudioWorklet + 需要クロック (これが根治)
- 暫定音を **SAB リング + AudioWorklet** に置換。worker が PCM を書き、Worklet が読む。
- emulation の cadence を**リング埋まり feedback**に変更 (リングを ~半分に保つよう先回り)。
- **マイルストーン: 重い場面でも音 smooth・`audioStats` の underrun ≈ 0・揺れ消失** (ユーザー実機確認)。

### Stage 3 — 仕上げ
- `qbDebug` を worker への非同期往復に再配線 (`audioStats`/`vol`/`fmgen` 等)。
- pause(emuFrozen)・reset/Run ライフサイクル・リサイズ・音楽プレイヤー・旧 main 側 audio/描画コード掃除。
- コーパス通し確認 (東方旧作 / Ray / PMD .M / MUAP98 / bio100 / Super Depth)。CHANGELOG + memory 更新。

## リスク・要確認
- **OffscreenCanvas**: Chrome(開発機) OK。Safari は 16.4+ → 公開対象として注記。
- **COEP require-corp が読み込みを壊す**: アセットは全て同一オリジンなので安全なはず。きつければ
  `Cross-Origin-Embedder-Policy: credentialless` に緩める。
- **ローカル開発のヘッダ**: `emrun` 不可 → `tools/devserver.js` を使う (Stage 1 以降は必須)。
- **入力遅延**: postMessage で約1フレーム。実用上問題ないはず。必要なら入力も SAB 化。
- **テストカバレッジ**: headless `tools/*.js` は Wasm を直接叩く(worker 層を経ない)ので native/core は
  カバー継続。**worker 層はブラウザ実機検証が頼り** (各 Stage 末で確認)。

## 実装メモ (2026-06-18 着手、確定した詳細)

- **新規ファイル (既存経路に非接続・回帰ゼロ)**:
  - `web/player/emu-worker.js` — emulator 側 Worker。NP2kai 本体/run ループ/FS/全 `np2kai_*` を所有。
    Stage 1a = 表示(framebuffer を postMessage transfer)+入力+FS+ライフサイクル+ステージング。
  - `web/player/emu-audio-worklet.js` — 音声 consumer (SAB リングを読むだけ。SPSC, 2の冪+ビットマスクで
    int32 wrap も安全)。Stage 1c で接続。
- **framebuffer**: SAB でなく **postMessage + transferable** で main へ (worker が w/h/bpp/生バイトを送り、
  main が既存の RGB565→RGBA 変換+描画を流用)。OffscreenCanvas より統合が軽い。
- **アセット I/O**: フェッチは **main に残す** (既存 fetch コードを再利用) → バイトを `writeFile`/`insertFdd`
  メッセージで worker の FS へ送る。worker は I/O せず FS+emulator+ループに専念。
- **入力**: DOM ロジック(pointer lock/modal 抑制/keymap)は main 据え置き、末尾の
  `keyDown/keyUp/mouseMove/mouseButton` だけ worker メッセージ化 (全て handle 先頭は worker が前置)。
- **汎用 ccall**: `set_beep_mute`/`set_pmd_irq`/`enable_midi_now`/`set_fmgen`/`set_clock_multiple`/
  `set_vol`/`get_vol`/各 debug getter は worker の `call` で転送 (facade が ret/argTypes/prependHandle を指定)。
  stage*/getExit はバイト/出力ポインタを HEAP に置くため専用ハンドラ。
### ⚠ 音声生成モデル (sound.c 精読の結論、Stage 1c の実装指針)

`core/np2kai/sound/sound.c` を読んで確定したクロック/バッファモデル:

- **sndstream バッファ** = `(samples + reserve)` の SINT32 ステレオ。`samples` = ブロック長 (=s_samples、
  pull 1 回で返る量)。`reserve` = `rate * SOUNDRESERVE / 1000` の余白。
- **`sound_sync()`** (CPU 実行中に逐次呼ばれる): `length` = 経過 CPU クロックをサンプル換算した数を
  `streamprepare(length)` でレンダ → **音声生成は CPU クロックにロックステップ** (タイムスタンプ式でなく
  「経過 CPU 時間ぶんの現在チップ状態」を積む)。**罠: バッファ満杯 (remain=0) で sound_sync が呼ばれると、
  未レンダ分は捨てられ lastclock がスキップ → 音が欠ける**。→ **バッファを溢れさせてはいけない** (drain が
  生成に追いつく必要がある)。
- **`sound_pcmlock()`** (= `qb_audio_fill` が引く pull): `reserve` を残して top-up
  (`streamprepare(remain - reserve)`) し、**常に満杯ブロック (`samples`) を返す** (無音にはならない) +
  `lastclock = now`。top-up 分は「現在のチップ状態」なので、**pcmlock 直前に CPU が ≥1 ブロック分進んで
  いれば top-up ≈0 で正確なテンポ**、進んでいないと top-up が増えてテンポ歪み (= 揺れ)。

**→ worker の正しい音声生成 = 音声駆動エミュレーション (audio-driven)**:
1. run_frame の実行を **リング空きフレーム数でゲート** (DAC が消費したぶんだけ生成) = production が DAC に
   ペースされ **drift しない** (これが根治の本体)。
2. pcmlock は **ブロック分のフレームを走らせた後**に呼ぶ (sound_sync がロックステップで満たした後 → top-up ≈0)。
   1 ブロック = `ceil(samples / samplesPerFrame)` フレーム、`samplesPerFrame ≈ rate / 56.42` (PC-98 VSYNC)。
3. sndstream を溢れさせない (溢れ = 音欠け)。リングと reserve が main/worker のジッタを吸収する。
- 実装の精度: samplesPerFrame は推定で可 (リングゲートが drift を自己補正)。推定が脆ければ
  **小さな C ヘルパ `pending サンプル数` を足して厳密化** (sndstream の rendered = samples+reserve-remain。
  patch 04 候補)。**まず推定で実装 → ブラウザ実機で `audioStats` の underrun と耳で確認 → 必要なら C ヘルパ**。
- Stage 1a は無音で表示/入力を先に確定し、この音声駆動を 1c で乗せる。

## 段階1 (その場ファサード化) の進捗

closure (従来パス) の emulator 接点を `emu` ファサード経由に変換中。各カテゴリ完了ごとにユーザーが
従来パス (`http://localhost:8080/` フラグ無し) で回帰チェック。全メソッド async (worker 版が非同期のため)。

- [x] **起動フロー** — loadLoaderDisk / runStaged / pollDosExit / stageAndRun{Image,Script,Batch}
- [x] **FS** — 2a:書き込み (writeRun/stage) / 2b:リセット・クリア (clearRun, resetToIdle/closeBundle を async 化) /
      2c:ライブ反映 (scanRun/readRun、polling を async 化)。`emu.{writeFile,writeRun,stage,clearRun,scanRun,readRun}`
- [x] **入力** — key/mouse (fire-and-forget、`emu.{keyDown,keyUp,mouseMove,mouseButton}`、handle 前置)
- [x] **制御** — enableMidiNow を emu 化 (run flow)。setFmgen/setVol/qbDebug cwrap は local-only のまま (dev 用・worker では stub M で no-op、実害なし)。
- [x] **描画ループ + 音声** — `emu.start(onFrame)` に分離。描画は共有 `drawFrame()` (DOM)。音声は
      モード固有 (local=ScriptProcessor は `if(!QB_USE_WORKER)` で skip / worker=SAB+AudioWorklet)。
- [x] **worker emu 実装** — `makeWorkerEmu()` が emu インターフェースを worker メッセージで実装 (SAB音声・boot 込み)。
      worker 側に writeRun/stage/scanRun/setPaused ハンドラ追加。
- [x] **切替 (モード対応 closure)** — トップを `async main()` に統一。`makeStubM()` で worker 時のローカル初期化を
      無害化、emu を `QB_USE_WORKER ? await makeWorkerEmu() : {local}` で差し替え、共有 UI は emu.* で両対応。
      旧 initWorkerMode (最小ドロップ・~248行) 撤去。pause(emu.setPaused)/gamepad(共有 rAF)/音楽プレイヤー計時
      (worker→audioActive 通知) も両モード配線。**ブラウザ実機で従来パス無変化・worker フル UI 動作を確認 (2026-06-19)**。
- [ ] **公開前** — worker を既定化 (?worker=1 を外す) + 下げ側のみの適応クロック (低スペック機でプチノイズ時に倍率↓)。

## テスト・検証
- 各 Stage 末でブラウザ実機確認 (ユーザー)。
- Stage 0 のサーバ側ヘッダ/MIME は `tools/devserver.js` への curl で headless 確認可。
- 既存回帰 (`tools/*_test.js`) は全 Stage を通して PASS を維持 (native 無改変のため不変のはず)。
