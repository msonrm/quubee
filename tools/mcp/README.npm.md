# quubee-mcp — PC-98 フリーソフトのスモークテストと計測 (MCP サーバ + CLI)

Headless smoke-testing & instrumentation for PC-98 freeware, as an MCP (Model Context
Protocol) server plus a one-shot CLI. Runs a PC-98 title (HLE-DOS + NP2kai Wasm) entirely
in Node — no NEC BIOS, no MS-DOS — and reports boot/render/sound/input signals in
machine-readable JSON. **Not real DOS. Not a reference platform.** 日本語の詳細は以下。

[QuuBee](https://quubee.pages.dev) (ブラウザで PC-98 フリーソフトを再体験するプレイヤー) の
headless 実行系を、MCP サーバと CLI として切り出したもの。PC-98 homebrew / フリーソフトの
開発者やエージェントが、書庫やディスクイメージを渡して「動く兆候・落ちる兆候」を
機械可読で観察できる。

## 位置づけ (最重要)

**QuuBee の HLE-DOS は実 DOS ではない** (差異の正典は同梱 `docs/dos_hle_gaps.md`、
`quubee_gaps` ツールでも取得可)。このサーバは**参照プラットフォームではない**:

- 「QuuBee で動いた」≠ 実機/実 DOS で動く (HLE の寛容さで通ることがある)
- 「QuuBee で動かない」≠ 実機で動かない (HLE の未実装の可能性。gaps を当たる)
- 全ツール応答の JSON に `note` としてこの注意書きが入る。**剥がして転送しないこと**

用途は**スモークテスト** (起動する/描画する/音が鳴る/入力に反応する、の検出) と**計測**
(スクリーンショット・テキスト VRAM・音声 RMS・INT 21h 診断・状態分類) まで。

## セットアップ

MCP クライアントへの登録だけで使える (Node 18+)。Claude Code の例:

```bash
claude mcp add quubee -- npx -y quubee-mcp
```

汎用の MCP クライアント設定 (stdio):

```json
{ "command": "npx", "args": ["-y", "quubee-mcp"] }
```

## ツール (11)

| ツール | 何をする |
|---|---|
| `quubee_boot` | 書庫 (.lzh/.lha/.lzs/.zip)・ディスクイメージ (.d88/.hdm/.fdi 等 — ブートせず FAT12/16 の中身を取り出す)・ディレクトリを起動しセッションを作る (exe/bat/args/multiple/y2kClamp 指定可) |
| `quubee_run` | N フレーム進める (60 = エミュ 1 秒、上限 6000/コール) |
| `quubee_key` | キー投入 (RETURN/SPACE/ESC/A-Z/D0-D9/矢印/F1-F10 等。次の run 中 holdFrames 保持) |
| `quubee_screenshot` | 現画面の PNG (640×400) |
| `quubee_text` | テキスト VRAM 25 行 (ASCII のみ) |
| `quubee_audio` | seconds 秒の音声 RMS (発音のスモークテスト) |
| `quubee_classify` | tier 分類 (ALIVE/RENDER/BOOT/WAIT/EXIT/CRASH/BUSY) + INT 21h 診断 (`int21Unimplemented` = 未実装 DOS コール踏み・`int21Calls` = AH 別回数) + XMS 使用量 (`xms`) |
| `quubee_save` | スナップショット保存 (セッションあたり 2 個・同名上書き) |
| `quubee_restore` | スナップショットへ巻き戻す — 「キーを試す → 駄目なら戻す」の分岐探索 |
| `quubee_close` | セッション解放 (上限 3 並行) |
| `quubee_gaps` | `docs/dos_hle_gaps.md` 全文 (実 DOS との差異の正典) |

## 利用例

CLI と MCP の JSON は同じ概念に同じフィールド名を使う (`frame` = 到達フレーム位置 /
`maxColors` / `animated` / `int21Unimplemented`・`int21Calls` / `xms` / `audioSeconds`)。
`tier`/`animated` は観察の蓄積が要るため MCP では `quubee_classify` が返す (CLI は常時)。

### MCP: 対話セッションの典型フロー

エージェントからの典型的な呼び出し列 (「起動 → 観察 → キーを試す → 駄目なら巻き戻す」):

```
quubee_boot   { path: "/abs/path/game.lzh" }        → { session: "s1", launch: "bat:GAME.BAT→GAME.EXE", ... }
quubee_run    { session: "s1", frames: 1500 }       → { state: "USER", colorsNow: 14, ... }
quubee_screenshot { session: "s1" }                 → PNG (タイトル画面が出たか目で確認)
quubee_save   { session: "s1" }                     → ここを分岐点に
quubee_key    { session: "s1", key: "RETURN" }
quubee_run    { session: "s1", frames: 300 }
quubee_classify { session: "s1" }                   → tier / animated / int21Unimplemented
quubee_restore { session: "s1" }                    → 駄目なら分岐点へ戻して別のキー
quubee_close  { session: "s1" }
```

「動かない」ときは `quubee_classify` の `int21Unimplemented` を見る — 未実装 DOS コールを
踏んでいればそこに AH と回数が出るので、`quubee_gaps` の §1 と突き合わせる。実例:
あるファイラの「ドライブの指定が違います」停止は、この診断で INT 21h の未実装 4 箇所
(IOCTL ほか) と特定され根治につながった。

### CLI: ワンショット観察 (報告は stdout に JSON)

```bash
npx -p quubee-mcp quubee-run game.lzh --exe GAME.EXE --frames 600 --quiet
```

実出力 (LIO グラフィックのテストプログラムを実行した例):

```json
{"input":"games/liotest.zip","launch":"exe:T1.EXE (合成 .bat)","frame":600,
 "tier":"WAIT","state":"WAIT","pc":"0xFEE10","maxColors":2,"animated":false,
 "exited":false,"batchDone":false,"xms":{"handles":0,"usedMB":0,"largestMB":17},
 "wasm":"0f0c8ed52c256469","multiple":20,"y2kClamp":false,
 "note":"QuuBee HLE-DOS is not real DOS (see docs/dos_hle_gaps.md). Treat results as smoke-test signals + instrumentation, not real-machine compatibility proof.",
 "int21Unimplemented":{},
 "int21Calls":{"25":30,"30":2,"35":14,"44":5,"3F":2113,"4A":2,"4B":1}}
```

主なオプション: `--exe/--bat/--args` (起動明示)・`--frames N`・`--screenshot out.png`・
`--text` (テキスト VRAM 同梱)・`--audio SEC` (RMS)・`--keys "RETURN@500"`・`--y2k-clamp`。
INT 21h 診断 (`int21Unimplemented`/`int21Calls`) は常時載る。

### ディスクイメージ入力

フロッピーイメージはブートせず FAT12/16 の中身を取り出して起動する (ブラウザ版と同じ経路)。
自己起動ディスク (非 FAT) は理由つきで正直に失敗する:

```bash
npx -p quubee-mcp quubee-run vzdisk.hdm --frames 600 --quiet
```

```json
{"input":"vzdisk.hdm","launch":"exe:VZ.COM (合成 .bat)","frame":600,
 "tier":"WAIT","state":"WAIT", ... }
```

対応拡張子: .d88/.d77/.d98/.88d/.98d/.fdi/.hdm/.xdf/.2hd/.dup/.flp/.dcp/.dcu
(恒久対応外の .nfd/.hdb 等は明示メッセージで拒否)。

## ブラウザ版プレイヤーとの意図的な違い: Y2K クランプは既定 OFF (実時計)

ブラウザの QuuBee は RTC の年を 1999 に固定して 2 桁年ソフトのセーブ破壊から
プレイヤーを保護する。計測器であるこのパッケージは逆に**既定で実時計** — Y2K バグの
兆候を隠さないため。プレイヤー環境の挙動を再現したいときは `quubee_boot` に
`y2kClamp: true` を渡す (CLI は `--y2k-clamp`)。応答の `y2kClamp` フィールドで
どちらで観察したか常に分かる。

## ライセンス

寛容ライセンスの集合体 (GPL なし)。QuuBee 独自コードは MIT、同梱バイナリ
`np2kai_core.wasm` は MIT / BSD-2 / BSD-3 / fmgen 独自 (フリーソフト配布・商用組込みは
cisc 氏の事前許諾が必要) の集合体。内訳と著作権表示は同梱の `CREDITS.md` / `LICENSE` /
`licenses/` を参照。ソースは https://github.com/msonrm/quubee 。

ゲーム/ソフト本体は同梱しない — ユーザーが用意するフリーソフトを実行する道具である。
