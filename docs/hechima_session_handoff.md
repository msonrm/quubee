# logical-layout-labo への作業依頼書 — 変換セッション層を hechima パッケージへ

> この文書は QuuBee (https://github.com/msonrm/quubee) 側の Claude が書き、
> logical-layout-labo 側の Claude セッションに渡すための指示書です。
> keymap エンジン (docs/keymap_engine_handoff.md) / mozc-wasm (docs/hechima_handoff.md) に続く
> 第 3 の移管で、hechima スタックの「頭」= 変換セッション層を labo に立てるのが目的です。

## 背景 (30 秒版)

QuuBee の HLE FEP には、日本語入力の「セッション」ロジックが `web/player/fep.js` (407 行) に実装
済みです: よみ入力 → 変換 (非同期) → 複数文節の候補選択 (←→ 移動・↑↓/Space 候補・Enter 確定) →
確定、そして編集キー (薙刀式 T/Y/U のカーソル/BS) の二重経路。**これを labo の `hechima` パッケージ
として立て、QuuBee はそれを vendoring して使う消費者に戻る** のがこの依頼です。

狙いは、配列 (hechima-keymap) と変換 wasm (hechima-wasm) に続いて **入力体験そのもの (セッション)**
も labo に揃え、試打サイトや OS 非依存エディタが「配列 → かな → 変換 → 確定 → 編集」を丸ごと
再利用できるようにすること。keymap-engine と同じ分業ですが **方向が逆** (QuuBee が donor)。

## 命名・位置づけ (既決)

- パッケージ名 = **`hechima`** (スタックの頭。屋号そのもの)。hechima-keymap (配列) と
  hechima-wasm (変換 wasm) を **cb 契約で束ねる糊** がこれ。命名の経緯は docs/hechima_handoff.md。
- レイヤ依存: `hechima` は **hechima-keymap に依存** (InputEngine を setEngine で受け取る) するが、
  **hechima-wasm には直接依存しない** — 変換は `cb.convert(yomi)` で注入される (消費者が hechima-wasm
  でも他エンジンでも配線できる)。QuuBee の「convert() 1 点で差し替え可能」設計をそのまま契約化する。

## お願い 1: fep.js をほぼそのまま `hechima` にする

**朗報: fep.js は最初から「DOM も emu も知らない純状態機械・依存注入」で書かれている** (冒頭コメント
参照)。QuuBee 固有物は全部 bridge.js 側の cb 実装に外出し済みなので、**解きほぐし作業はほぼ不要**。
`createFep(cb)` をそのまま `hechima` のコンストラクタにできる。移すのは fep.js の全体:

- **ローマ字リゾルバ** (ROMAJI 表 / resolve / PREFIXES): エンジン非装着時の内蔵 Phase 1。
  n 処理 ("nn"+母音/y→ん+n○、"nn"+子音/末尾→ん) は konnichiha/minna が正しく打てる要。
  ※ hechima-keymap 側に createBuiltinRomajiJIS/US があるので二重だが、**「keymap を読まずに素の
  ローマ字で動く」ゼロ依存フォールバックとして内蔵を残す**のを推奨 (要判断)。
- **フォールバック変換** (fallbackConvert): 変換未接続/失敗時、よみを 1 文節・候補=カタカナ/ひらがな。
- **セッション機械**: segs (文節配列) / focus (注目文節) / genId (世代)。startConvert = 非同期 convert
  + **世代トークンで in-flight 破棄** (待ち中に打鍵/取消したら古い結果を捨てる)。commit / clear / backToYomi。
- **候補ナビ**: Space=次候補・↑↓=候補送り・←→=文節移動・Enter=結合確定・Esc/BS=取消。
- **エンジン橋**: pumpEngine (takeConfirmedText → 確定かなを変換前バッファへ → startConvert /
  chord 窓満了 onStateChange から汲む) / engineDown / engineUp / handleEngineAction (下記)。

### 公開 API (現状の返り値オブジェクト — これを契約として維持)

```
createFep(cb) → {
  get active, setActive(on), toggle(),
  feed(keyEvent) → bool,      // keydown 1 個消費。true=飲んだ (ゲスト/エディタへ送らない)
  feedUp(keyEvent) → bool,    // keyup (SandS の単打 convert が発火)
  setEngine(engine, keyOf),   // hechima-keymap の InputEngine を注入 (null=内蔵ローマ字)
  pumpEngine(),               // engine.onStateChange (chord 窓満了) から呼ぶ
  reset(),
}
```

## お願い 2: cb 契約を hechima の公式インターフェースとして定義

QuuBee が実証した cb は 5 点。**これが消費者ごとの実装差し替え点** (QuuBee=PC-98、エディタ=DOM、
試打サイト=表示要素)。labo は型と意味論を README/d.ts で明文化してほしい:

```
cb.show(segments)   segments = [{text, kind}]  kind: 'yomi'(未確定よみ)/'focus'(注目文節)/'other'(非注目)
cb.hide()           表示消去 (バッファが空)
cb.commit(text)     確定文字列を出力 (QuuBee=SJIS 注入 / エディタ=挿入 / 試打=追記)
cb.hostKey(name)    ゲスト/文書へ実キー 1 打 (name=KeyboardEvent.code 名。編集キーの委譲先。下記)
cb.convert(yomi)    → Promise<[{key, candidates:[...]}] | null>  (null/省略=フォールバック)
```

PC-98 固有物が契約に漏れていないのが要点 — show は文節配列、commit は文字列、hostKey は code 名で、
どれも消費者側で翻訳できる。この汎用性は QuuBee の使い方で既に証明済み。

## お願い 3: 編集キーのホスト委譲を InputEngine の正式 API にする (Task 2 の正道化)

QuuBee は薙刀式の編集キー (T=moveLeft / Y=moveRight / U=deleteBack) を **暫定で** 配線済み
(QuuBee commit 70416bb)。だが今は **`engine.chordBuffer.onSpecialAction` を外から wrap して横取り** して
おり、engine 内部プロパティへの依存 = 結合が密。真因は、InputEngine が moveLeft/moveRight を
confirmComposition に、deleteBack を自前テキスト削除に **内部で閉じてしまい、ホストへ委譲する口が
無い** こと (executeAction)。ホスト (QuuBee=PC-98 ゲスト画面、エディタ=DOM) が文書を所有する構図では、
空バッファ時の moveLeft は「ホストへ実 ArrowLeft を委譲」でなければならない。

**依頼**: InputEngine に **ホスト委譲コールバック** (例 `onHostAction(action)`) を足す。
executeAction が moveLeft/moveRight/moveUp/moveDown/editSegmentLeft/editSegmentRight と
「バッファ空の deleteBack」を内部で握りつぶす代わりに、**confirmComposition を先に済ませてから
onHostAction へ渡す**。これを `hechima` セッション層が受けて二重経路に振り分ける (下の意味論)。
そうすれば QuuBee の wrap は撤去でき、試打サイト/エディタも同じ経路で編集キーの恩恵を受ける。

**二重経路の意味論 (QuuBee が実証済み。golden 化してほしい)**:
- moveLeft/moveRight: **Phase 2 (候補中)** → 注目文節を左右へ移動 / **変換前よみ合成中** → 飲む
  (よみ内カーソルは持たない) / **空** → `cb.hostKey('ArrowLeft'|'ArrowRight')`
- deleteBack: **Phase 2** → 取消 (clear+hide) / **合成中** → engine 既定 (composingKana 末尾削除) /
  **空** → `cb.hostKey('Backspace')`
- editSegmentLeft/Right (薙刀式 space+T/space+Y = 文節伸縮): **今は据え置き**。Mozc の
  ResizeSegment が要り hechima-wasm ラッパー未公開。契約の枠だけ用意し実装は後続で可。

## お願い 4: golden テスト (QuuBee の回帰を移植)

QuuBee 側に「キーイベント列 → 期待出力」の実証済みケースがある。labo の golden 形式に移植してほしい
(QuuBee 側の統合回帰でも同じケースを流用したい):

1. **ローマ字 n 規則**: konnichiha→こんにちは / minna→みんな / nn 単独+Enter→ん / xtu→っ
2. **句読点即確定**: 空 + `. , ? !` → 全角即確定 / 文中は composition 内で全角 / 数字は透過
3. **in-flight race**: 変換待ち中に打鍵 → 古い結果を破棄 (世代トークン)
4. **複数文節**: 2 文節・注目 focus / ←→ 移動 / 注目だけ候補送り / Enter 結合確定
5. **編集キー二重経路**: moveLeft/moveRight/deleteBack を 空 / Phase2 / 合成中 の 3 状態で
   (QuuBee の tools/fep_naginata_edit_test.js 15 ケースが雛形)
6. **実変換 E2E** (hechima-wasm 接続時): kyouhaiitenkidesune → 今日はいい天気ですね

参照 = QuuBee の tools/fep_mozc_test.js (23 チェック) + tools/fep_naginata_edit_test.js (15 チェック)。

## お願い 5: 単一ファイル UMD で吐く (keymap-engine と同形)

QuuBee はバンドラ無しのプレーン `<script>` 構成。keymap-engine.js と同じく **ブラウザ script /
Worker importScripts / node require で読める UMD** で。グローバル名は `Hechima` を提案
(`Hechima.createFep` / `Hechima.version`)。生成コマンドは package.json の script + README に一行。

## 参考: QuuBee 側の追随作業 (labo の作業対象ではない)

- bridge.js の cb 実装 (VRAM show / SJIS commit / PC-98 hostKey / mozc-worker convert) は残す。
- `hechima` を web/assets へ vendoring し、fep.js のセッション核を差し替え (bridge.js の cb だけ残す)。
- 暫定の onSpecialAction wrap (setEngine 内) を、正式 onHostAction 配線へ置換して撤去。
- 回帰 fep_mozc_test / fep_naginata_edit_test が緑のままを確認。

## 完了の定義

- labo に `hechima` (単一 UMD) があり、node で `createFep` して golden (上記 1〜6) が全通過。
- InputEngine に onHostAction (ホスト委譲) が入り、編集キー二重経路が cb.hostKey 経由で成立
  (QuuBee の wrap 無しで)。
- cb 契約と公開 API が README/d.ts で明文化されている。
- タグ付き Release に `hechima.js` (+ version) が添付。

QuuBee 側からの質問・調整は、この文書を持ち歩いている人間 (msonrm さん) を経由してください。
