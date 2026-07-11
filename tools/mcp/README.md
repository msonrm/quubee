# QuuBee MCP サーバ — 煙感知器と計測器

QuuBee の headless 実行 (`tools/lib/machine.js`) を MCP (Model Context Protocol) で外に出す。
PC-98 homebrew / フリーソフトの開発者やエージェントが、書庫をドロップして「動く兆候・落ちる兆候」を
機械可読で観察できる。

## ⚠ 位置づけ (最重要)

**QuuBee の HLE-DOS は実 DOS ではない** (差異の正典 = [docs/dos_hle_gaps.md](../../docs/dos_hle_gaps.md)、
`quubee_gaps` ツールでも取得可)。このサーバは**参照プラットフォームではない**:

- 「QuuBee で動いた」≠ 実機/実 DOS で動く (HLE の寛容さで通ることがある)
- 「QuuBee で動かない」≠ 実機で動かない (HLE の未実装の可能性。gaps を当たる)
- 全ツール応答の JSON に `note` としてこの注意書きが入る。**剥がして転送しないこと**

用途は**煙感知器** (起動する/描画する/音が鳴る/入力に反応する、の検出) と**計測器**
(スクリーンショット・テキスト VRAM・音声 RMS・PC 状態分類) まで。

## セットアップ

```bash
cd tools/mcp && npm install          # @modelcontextprotocol/sdk + zod
```

登録 (Claude Code の例):

```bash
claude mcp add quubee -- node /絶対パス/qb/tools/mcp/server.js
```

## ツール (9)

| ツール | 何をする |
|---|---|
| `quubee_boot` | 書庫 (.lzh/.lha/.lzs/.zip) かディレクトリを起動しセッションを作る (exe/bat/args/multiple 指定可) |
| `quubee_run` | N フレーム進める (60 = エミュ 1 秒、上限 6000/コール)。state (WAIT/EXIT/BIOS/USER) を返す |
| `quubee_key` | キー投入 (RETURN/SPACE/ESC/A-Z/D0-D9/矢印/F1-F10 等。次の run 中 holdFrames 保持) |
| `quubee_screenshot` | 現画面の PNG |
| `quubee_text` | テキスト VRAM 25 行 (ASCII のみ) |
| `quubee_audio` | seconds 秒の音声 RMS (発音の煙感知) |
| `quubee_classify` | 蓄積サンプルから tier 分類 (ALIVE/RENDER/BOOT/WAIT/EXIT/CRASH/BUSY)。CRASH は偽陰性ありうる |
| `quubee_close` | セッション解放 (上限 3 並行) |
| `quubee_gaps` | docs/dos_hle_gaps.md 全文 (実 DOS との差異の正典) |

典型フロー: `boot` → `run(1500)` → `screenshot`/`text` → `key(RETURN)` → `run(300)` → `classify` → `close`。

## プレイヤーとの意図的な違い: Y2K クランプは既定 OFF (実時計)

ブラウザの QuuBee は RTC の年を 1999 に固定して 2 桁年ソフトのセーブ破壊から**プレイヤーを保護**する。
計測器であるこのサーバ (と CLI) は逆に**既定で実時計 (2026 年の実機相当)** — Y2K バグの煙を
隠さないため。プレイヤー環境の挙動を再現したいときは `quubee_boot` に `y2kClamp: true` を渡す
(CLI は `--y2k-clamp`)。boot 応答の `y2kClamp` フィールドでどちらで観察したか常に分かる。

## 実装メモ

- セッション = サーバ内に生きた `Machine` を保持 (対話型)。ワンショットで良ければ
  CLI `node tools/quubee_run.js game.lzh --json` の方が軽い。
- 起動解決・書庫展開は CLI と同じ共有部品 (`tools/lib/stage.js`)。展開は本番と同じ archive.js。
- 分類は `tools/lib/tier.js` (bio100_triage と同じメトリクス)。
- 回帰 = `node tools/mcp_server_test.js` (SDK 未インストール / 素材不在なら SKIP)。
