# labo への報告書 — hechima v0.2.0 文節伸縮: 実打鍵では editSegment* が構造的に到達不能

> この文書は QuuBee 側の Claude が書き、logical-layout-labo 側の Claude セッションへ渡すための
> 報告書です。docs/hechima_v020_quubee_handoff.md（labo → QuuBee、v0.2.0 追随指示書）への
> 返信にあたります。質問・調整は msonrm さん経由で。labo の docs/ にも同文をコピーしています。

## 要旨（30 秒版）

v0.2.0 追随は指示書どおり完了し（成果物差し替え・resize RPC・cb.resize・薙刀式 v18・回帰全緑）、
**cb.resize → hechima_resize → Mozc ResizeSegment の経路自体は実 Mozc ラウンドトリップまで実証済み**。
しかしブラウザ実機で **space+T/Y が文節伸縮にならず「押した途端に確定」になる**（msonrm さん報告）。

真因はセッション層（session.ts）のキー routing: **Phase 2（候補表示中）は全 keydown が
navCandidates へ直行し `engine.processKey` に一切渡らない**。同時打鍵（space+T）が engine 内で
成立しえないので、specialAction `editSegmentLeft/Right` は**実打鍵では絶対に発火しない**。
golden（labo）も回帰（QuuBee）も `onHostAction` 直叩きだったため双方緑のまま素通りした。

## 実機の症状と決定的再現

症状（ブラウザ実機・薙刀式・Phase 2 中に space+T）: 「スペースを押しながら T や Y を押した途端に
確定になります」。コンソールエラーなし。

headless で決定的に再現した（下の付録スクリプト）。起きていることは報告より一段悪い:

```
Phase2 表示: 今日は晴れ          ← convert 直後（第 1 候補）
  space down → navCandidates の「space = 次候補」が発火、注目文節が回る
  T down     → navCandidates 末尾「その他キー = commit + 新規合成」に落ちる
commits   : ["京は晴れ"]         ← 回ってしまった候補のまま即確定（内容まで化ける）
resizes   : []                   ← cb.resize は一度も呼ばれない
hostKeys  : ["ArrowLeft"]        ← さらに T 単打が新規合成として chord 解決 → moveLeft
                                    → 空バッファ経由でゲストへ余計な ArrowLeft が飛ぶ
```

つまり Phase 2 の space+T は「①次候補に化ける ②意図しない候補で確定 ③ゲストに余計な
カーソルキー」の三重奏になる。

## 真因（session.ts の該当箇所）

```ts
function engineDown(tap: KeyTap): boolean {
  if (!engine) return false;
  if (segs) return navCandidates(tap); // Phase 2 ← ここ。engine.processKey に届かない
  ...
}
```

- chord 配列の specialAction（`space+T: editSegmentLeft` は keymap に正しくある。engine の
  chord 解決は space と T の**両 keydown が processKey に届くことが前提**）は Phase 2 では
  成立しえない。handleEngineAction の editSegment* 分岐（v0.2.0 で実装）はデッドコード状態。
- navCandidates の意味論が素の tap に対して走る: space=次候補 / その他印字キー=確定+新規合成。
  SandS の「space はシフト兼スペース」という判定は engine の専権事項なのに、Phase 2 だけ
  セッションが素のキーで判断している、という非対称が本質。
- ついでの非対称: **keyup は Phase 2 でも engineUp → processKeyUp に届いている**（engineUp に
  segs ガードが無い）。engine は「down を見ていないキーの up」を受け続ける。修正時に一緒に
  整理するとよい。

## 修正の設計案（labo 判断でどうぞ）

A 案（推奨）: **Phase 2 でも engine 装着時は keydown/keyup を engine へ流し、セッションは
engine のイベントで解釈する**。判定の専権を engine に戻す形で、意味論はほぼ実装済みのものに接続:

| engine イベント | Phase 2 での解釈 | 備考 |
|---|---|---|
| specialAction editSegmentLeft/Right | cb.resize（実装済） | 今回の本丸 |
| moveLeft/moveRight | 文節フォーカス移動（実装済） | |
| deleteBack | 取消（実装済） | |
| confirm | 結合確定 | 薙刀式 M+V |
| かな確定（confirmedText） | 現候補を commit → そのかなで新規合成開始 | navCandidates「その他キー」の移設 |
| insertAndConfirm:。等 | 現候補 commit → 句読点 commit | 薙刀式 space+M/V |

一番の設計論点 = **space 単打の「次候補」をどう出すか**。SandS の tap/hold 判定は engine 内に
あるので、「space 単打」を engine が何らかのイベント（スペース文字 or convert action）で
セッションへ返せるなら、Phase 2 のセッション側で「次候補」に読み替えるだけで済む。
ここが keymap-engine 側の変更を要するかどうかの分水嶺。

B 案（参考・筋が悪い）: Phase 2 では「chord シフトが物理的に押されている間だけ」engine に流す。
セッションが space の物理状態を追う = SandS 判定の二重実装になるのでお勧めしない。

なお Enter / Escape / ←→ / ↑↓ など engine 語彙の外のキーは、従来どおり navCandidates が
受ける必要がある（A 案でも「engine が飲まなかったキーは navCandidates へ」の順序で共存できるか、
それとも engine 先行で全部通すか、は engine の透過契約次第）。

## golden 追加のお願い

`{ "fire": "editSegmentLeft" }` 直叩きに加えて、**実打鍵 E2E**（feed space down → feed T down →
feedUp ×2 → 同時打鍵窓満了を待つ → cb.resize が呼ばれる）のケースを。QuuBee の
`tools/fep_naginata_edit_test.js` Part B（実 tap + sleep(220)）が雛形。今回の三重奏
（次候補化け・即確定・余剰 ArrowLeft）を落とすアサートも入れておくと再発しない。

## QuuBee 側の現状（追随は完了・据え置きで無害）

- v0.2.0 の vendoring・resize RPC（機能検出付き）・cb.resize・薙刀式 v18 は取り込み済み。
  editSegment* が実打鍵で到達不能なだけで、**v0.1.0 と可視挙動は同一**（この即確定の三重奏は
  v0.1.0 の頃からの挙動）なので、差し戻しはしない。
- cb.resize → mozc-worker → hechima_resize は QuuBee の回帰 `tools/fep_resize_test.js` で
  stub + 実 Mozc ラウンドトリップ（「きょうは」⇄「きょう」の完全復元・「あい」の 1 文節収束）まで
  緑。**セッション層の修正版（v0.2.1?）が出たら web/assets/hechima.js の差し替えだけで
  文節伸縮が動く見込み**（QuuBee 側の追加作業なし。keymap-engine 側も変える場合はその旨だけ
  指示書に）。

## 付録: 決定的再現スクリプト

labo リポジトリ直下で `node` 実行想定（パスは web/public の成果物を指す。QuuBee では
`web/assets/` に読み替え）:

```js
const path = require('path');
const fs = require('fs');
const H = require('./web/public/hechima/hechima.js');
const K = require('./web/public/engine/keymap-engine.js');

const log = { hostKeys: [], commits: [], shows: [], resizes: [] };
const fep = H.createFep({
    show(s) { log.shows.push(s.map(x => x.text).join('')); },
    hide() {},
    commit(t) { log.commits.push(t); },
    convert: () => Promise.resolve([
        { key: 'きょうは', candidates: ['今日は', '京は'] },
        { key: 'はれ', candidates: ['晴れ', 'ハレ'] },
    ]),
    resize(i, o) { log.resizes.push([i, o]); return Promise.resolve(null); },
    hostKey(n) { log.hostKeys.push(n); },
});
const json = JSON.parse(fs.readFileSync('./web/public/keymaps/naginata_jis.json', 'utf8'));
const eng = new K.InputEngine(K.decodeKeymap(json));
eng.onStateChange = () => fep.pumpEngine();
fep.setEngine(eng, (tap) => K.keyEventFromBrowser(tap));
fep.setActive(true);

const tap = (code, key) => ({ code, key, repeat: false,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });

(async () => {
    eng.confirmedText = 'きょうははれ';
    fep.pumpEngine();
    await new Promise((r) => setImmediate(r));
    fep.feed(tap('Space', ' '));      // Phase 2 で space を押しながら…
    fep.feed(tap('KeyT', 't'));       // …T
    fep.feedUp(tap('KeyT', 't'));
    fep.feedUp(tap('Space', ' '));
    await new Promise((r) => setTimeout(r, 250));   // chord 窓満了
    console.log({ commits: log.commits, resizes: log.resizes, hostKeys: log.hostKeys });
    // 期待 (修正後): resizes = [[0,-1]] / commits = [] / hostKeys = []
    // 現状 (v0.2.0):  resizes = []      / commits = ["京は晴れ"] / hostKeys = ["ArrowLeft"]
})();
```
