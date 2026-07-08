# logical-layout-labo への作業依頼書 — keymap エンジンの QuuBee 連携準備

> この文書は QuuBee (https://github.com/msonrm/quubee) 側の Claude が書き、
> logical-layout-labo 側の Claude セッションに渡すための指示書です。
> labo 側のリポジトリ構成 (web/src/engine、Tests/golden) を前提に書いています。

## 背景 (30 秒版)

QuuBee は PC-98 フリーソフトのブラウザプレイヤーで、HLE FEP (ゲスト画面内で日本語変換、
変換エンジンは Mozc-Wasm) を実装済み。次のマイルストーンとして、keymap-format v1.0 の
配列定義 (薙刀式 / NICOLA / 月配列 2-263 / AZIK / Colemak ローマ字、JIS/US 分離済み) を
FEP のかな入力前段として統合する。

**方針: QuuBee は `web/src/engine` を fork しない。** labo がビルドした単体成果物
1 ファイルを同梱アセットとして取り込む (QuuBee における mozc.data と同じ扱い)。
エンジンの正しさの正典は labo の golden テストであり、labo 側の改善は QuuBee には
「ファイル差し替え」で入る。この分業を成立させるための 3 つのお願いが本文。

## お願い 1: エンジン単体ビルドの出口を作る

`web/src/engine` の InputEngine 一式 (keymap-decoder / keymap-expander / key-router /
sequential-buffer / simultaneous-buffer / hid-key-codes / types) を **1 ファイルに
バンドルして吐くビルドスクリプト**が欲しい。

- **形式**: ブラウザの素の `<script>`、Worker の `importScripts`、node の `require` の
  3 通りで読める UMD/IIFE。グローバル名は `KeymapEngine` を提案。
  (QuuBee はバンドラ無しのプレーン script tag 構成。ESM only だと取り込めない)
- **公開 API** (最低限):
  - `decodeKeymap(json)` → ExpandedKeymap (バリデーション込み。formatVersion 不一致は明確なエラー)
  - `InputEngine` クラス (constructor(keymap) / processKey / processKeyUp / getState /
    setKeymap / reset / onStateChange)
  - `KeyboardEvent.code` → エンジン内部 keyCode の変換テーブルまたは関数
    (hid-key-codes 相当。呼び元が KeyEvent を組み立てるのに必要)
- **バージョン埋め込み**: `KeymapEngine.version` に文字列。QuuBee 側で取り込み
  バージョンを記録する
- React/DOM/Next への依存を入れないこと (現状の engine は純ロジックに見える — その維持)
- 生成コマンドは package.json の script (例 `npm run build:engine`) にして README に一行

## お願い 2: golden テストの増強 (chord まわり)

同時打鍵の「打鍵感」バグは全部ここに棲んでいるので、効く順に:

1. **simultaneousWindow の境界**: 窓内 2 打 = 同時 / 窓外 = 逐次。境界ちょうど付近の
   ケースを両側から
2. **シフト単打の判別**: shiftKeys の singleTapAction (space 単打 = convert 等) と、
   シフト + 文字の同時押しの弁別
3. **連続シフト**: シフト押しっぱなしのまま複数文字を打つ
4. **ロールオーバー**: 前のキーの指が残ったまま次のキーを押す (実タイピングで頻発)
5. **モード切替の往復**: switchToEnglish / switchToJapanese / toggleInputMode。
   composing 中の切替時の確定挙動も
6. **薙刀式の specialActions**: 編集系 (deleteBack / moveLeft / moveRight / 確定 /
   言語切替) の chord が正しいアクションとして発火する系列

golden の形式は既存 Tests/golden/cases に合わせる。理想は「キーイベント列
(down/up + タイムスタンプ) → 期待出力列 (かな / アクション)」が素データで書いてあり、
**node 単体で流せる**こと (QuuBee 側の統合回帰でも同じケースを流用したい)。

## お願い 3: 仕様の明確化 (コード変更不要、回答だけでも価値がある)

QuuBee 側アダプタの設計に必要な確認事項。README なり docs なりに追記してもらえると助かる:

1. **KeyEvent の正確な形**: keyCode の型と KeyboardEvent.code との対応、timestamp の
   単位と基準、**OS オートリピート (repeat=true の keydown) は呼び元がフィルタすべきか、
   エンジンが無視してくれるか**
2. **chord の非同期解決 (onStateChange)**: 内部タイマー駆動か? 呼び元は何 ms 後に
   どの状態変化を期待すべきか。処理系 (ブラウザ/node) のタイマー精度への依存は
3. **confirmedText の運用**: 呼び元が「確定分を読み取ってクリアする」API はあるか。
   QuuBee は確定かなを自前の変換バッファ (Mozc) へ流すので、accumulate される設計だと
   毎回差分取りが必要になる
4. **KeyAction の語彙**: keymap-format.md の KeyAction 全部がエンジンから呼び元へ
   出てくるのか、エンジン内で消費されるものはどれか (一覧が欲しい)
5. **`pass` アクションの意味論**: QuuBee は「ゲスト (DOS 側) へのキー透過」に使いたい。
   その解釈で合っているか

## 参考: QuuBee 側の分担 (labo 側の作業対象ではない)

- キー入力タップの正規化 (keydown/keyup/repeat/timestamp の一元化) — labo 作業と並行
- アダプタ: EngineState → composition 表示 (PC-98 テキスト VRAM) / Mozc 変換 / 確定 SJIS 注入
- 編集系アクションの二重経路: composing 中 = バッファ操作 / バッファ空 = PC-98 実キー注入
  (薙刀式のカーソル・BS・言語切替がここに乗る)
- 設定 UI: 配列 × JIS/US の選択、web/public/keymaps/*.json の同梱

## 完了の定義

- `npm run build:engine` で単体ファイルが生成でき、node で `require` して
  golden ケースが全部通る
- 上記「お願い 3」への回答が文書化されている

QuuBee 側からの質問・調整は、この文書を持ち歩いている人間 (msonrm さん) を経由してください。
