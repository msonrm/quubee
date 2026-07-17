# quubee-mcp — PC-98 フリーソフトの煙感知器と計測器 (MCP サーバ + CLI)

Headless smoke detector & instrumentation for PC-98 freeware, as an MCP (Model Context
Protocol) server plus a one-shot CLI. Runs a PC-98 title (HLE-DOS + NP2kai Wasm) entirely
in Node — no NEC BIOS, no MS-DOS — and reports boot/render/sound/input signals in
machine-readable JSON. **Not real DOS. Not a reference platform.** 日本語の詳細は以下。

[QuuBee](https://quubee.pages.dev) (ブラウザで PC-98 フリーソフトを再体験するプレイヤー) の
headless 実行系を、MCP サーバと CLI として切り出したもの。PC-98 homebrew / フリーソフトの
開発者やエージェントが、書庫を渡して「動く兆候・落ちる兆候」を機械可読で観察できる。

## 位置づけ (最重要)

**QuuBee の HLE-DOS は実 DOS ではない** (差異の正典は同梱 `docs/dos_hle_gaps.md`、
`quubee_gaps` ツールでも取得可)。このサーバは**参照プラットフォームではない**:

- 「QuuBee で動いた」≠ 実機/実 DOS で動く (HLE の寛容さで通ることがある)
- 「QuuBee で動かない」≠ 実機で動かない (HLE の未実装の可能性。gaps を当たる)
- 全ツール応答の JSON に `note` としてこの注意書きが入る。**剥がして転送しないこと**

用途は**煙感知器** (起動する/描画する/音が鳴る/入力に反応する、の検出) と**計測器**
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
| `quubee_boot` | 書庫 (.lzh/.lha/.lzs/.zip) かディレクトリを起動しセッションを作る (exe/bat/args/multiple/y2kClamp 指定可) |
| `quubee_run` | N フレーム進める (60 = エミュ 1 秒、上限 6000/コール) |
| `quubee_key` | キー投入 (RETURN/SPACE/ESC/A-Z/D0-D9/矢印/F1-F10 等。次の run 中 holdFrames 保持) |
| `quubee_screenshot` | 現画面の PNG (640×400) |
| `quubee_text` | テキスト VRAM 25 行 (ASCII のみ) |
| `quubee_audio` | seconds 秒の音声 RMS (発音の煙感知) |
| `quubee_classify` | tier 分類 (ALIVE/RENDER/BOOT/WAIT/EXIT/CRASH/BUSY) + INT 21h 診断 (`int21Unimplemented` = 未実装 DOS コール踏み・`int21Calls` = AH 別回数) |
| `quubee_save` | スナップショット保存 (セッションあたり 2 個・同名上書き) |
| `quubee_restore` | スナップショットへ巻き戻す — 「キーを試す → 駄目なら戻す」の分岐探索 |
| `quubee_close` | セッション解放 (上限 3 並行) |
| `quubee_gaps` | `docs/dos_hle_gaps.md` 全文 (実 DOS との差異の正典) |

典型フロー: `boot` → `run(1500)` → `screenshot`/`text` → `save` → `key(RETURN)` →
`run(300)` → `classify` → (駄目なら `restore` して別のキー) → `close`。
「動かない」ときは `classify` の `int21Unimplemented` を見る — 未実装 DOS コールを
踏んでいればそこに AH と回数が出る (`quubee_gaps` の §1 と突き合わせる)。

## CLI (ワンショット)

対話が要らなければ CLI の方が軽い (報告は stdout に JSON):

```bash
npx -p quubee-mcp quubee-run game.lzh
npx -p quubee-mcp quubee-run game.lzh --exe GAME.EXE --frames 1800 --screenshot out.png --diag
```

## ブラウザ版プレイヤーとの意図的な違い: Y2K クランプは既定 OFF (実時計)

ブラウザの QuuBee は RTC の年を 1999 に固定して 2 桁年ソフトのセーブ破壊から
プレイヤーを保護する。計測器であるこのパッケージは逆に**既定で実時計** — Y2K バグの
煙を隠さないため。プレイヤー環境の挙動を再現したいときは `quubee_boot` に
`y2kClamp: true` を渡す (CLI は `--y2k-clamp`)。応答の `y2kClamp` フィールドで
どちらで観察したか常に分かる。

## ライセンス

寛容ライセンスの集合体 (GPL なし)。QuuBee 独自コードは MIT、同梱バイナリ
`np2kai_core.wasm` は MIT / BSD-2 / BSD-3 / fmgen 独自 (フリーソフト配布・商用組込みは
cisc 氏の事前許諾が必要) の集合体。内訳と著作権表示は同梱の `CREDITS.md` / `LICENSE` /
`licenses/` を参照。ソースは https://github.com/msonrm/quubee 。

ゲーム/ソフト本体は同梱しない — ユーザーが用意するフリーソフトを実行する道具である。
