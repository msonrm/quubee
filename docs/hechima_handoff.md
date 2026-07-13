# logical-layout-labo への作業依頼書 — mozc-wasm 移管と hechima スタック化

> この文書は QuuBee (https://github.com/msonrm/quubee) 側の Claude が書き、
> logical-layout-labo 側の Claude セッションに渡すための指示書です。
> keymap エンジン連携 (docs/keymap_engine_handoff.md) の続きにあたり、
> labo が「Web 向け日本語入力スタックの本家」になるための移管を依頼します。

## 背景 (30 秒版)

QuuBee の HLE FEP はかな漢字変換に **Mozc を Emscripten でビルドした wasm** を使っている。
そのビルド環境は現在 QuuBee 開発機のローカル (`~/development/mozc-wasm-build/`、gitignore 外の
作業ディレクトリ) にしかなく、成果物だけを QuuBee に手でコピーしている。属人的で、版管理も無い。

これを labo に移管する。labo には既に GitHub Actions の CI が整っており (build.yml / web-test.yml
等)、配列エンジン (KeymapEngine) と配列定義 JSON も揃っている。**変換エンジンをここに置けば、
配列 × Web × クライアント完結変換の入力スタックが一つの屋根に揃う。** これを **hechima** と名付ける。

- QuuBee はこれまで通り「ビルド済み成果物を pin して同梱」する消費者。mozc.data / keymap-engine.js と
  同じ扱い。labo 側の改善は QuuBee には「ファイル差し替え」で入る。
- 消費者は QuuBee だけでない: 新配列の試打サイト (打鍵が外に一切出ない変換)、OS 非依存の
  オンラインエディタ、が同じスタックに乗る。fcitx5-js (フル IME を載せる) とも azooKey (Swift 製・
  wasm 版なし) とも被らない空きポジション。

## 命名の確定事項 (2026-07-13 に msonrm と決定)

- **ブランド/リポジトリ名 = `hechima`** (単体)。
  由来 = へちまの語源 (糸瓜→とうり→「と」がいろは順で「へ」と「ち」の間だから「へち間」)。
  かな順の言葉遊びが名前そのもの = labo の主題と一致。加えて **IM (input method) が
  `h-e-c-h-[im]-a` に隠れている** ので、野暮な `-ime` は付けない。
- **パッケージは用途で分ける** (React/Vite 型。屋号は短く一意、パッケージは用途別):
  | パッケージ | 中身 |
  |---|---|
  | `hechima` | 変換エンジン本体 + 変換セッション層 (将来) |
  | `hechima-keymap` | 配列エンジン (現 KeymapEngine。将来この名で切り出す想定) |
  | `hechima-wasm` | **この依頼の対象。mozc を wasm 化したビルド** |
- **帰属表記は「powered by Mozc」**。mozc 本体 = BSD-3 (Google)、fcitx5-mozc = BSD-3
  (fcitx-contrib)。hechima は寛容ライセンスのまま。
- 被り実測 (2026-07-13): npm は `hechima` 本体も派生も `@hechima` scope も全部空き。
  GitHub リポジトリ名も空き。**ただし GitHub ユーザー名 `hechima` は 2013 作成の休眠アカウント
  (公開リポジトリ 0) が取得済 → 組織アカウント `@hechima` は作れない。** npm scope は確保可能。
- 変換エンジンは **差し替え可能な内部部品** としてレイヤを切ること。API 境界 = 「かな→文節/候補 JSON」。
  将来 mozc を別エンジン (azooKey Zenzai 等) に差し替えても上物が無傷で済むようにする。
  今の wrapper はもともとこの形。

## お願い 1: リポジトリに何を置くか (移管する実体)

`~/development/mozc-wasm-build/` は 620MB あるが、大半はビルド作業領域 (wasm-asan 407MB、
protoc-native 77MB 等)。**リポジトリに入れる正味はこれだけ**:

| 現ファイル | 役割 | hechima での名前 (提案) |
|---|---|---|
| `mozc_qb.cc` | 変換ラッパー (かな→JSON、3.6KB) | `hechima_wasm.cc` |
| `link_qb.sh` | リンクスクリプト (**-DNDEBUG 含む**) | `link.sh` (パス変数化。下記) |
| `mozc_qb_test.js` | ヘッドレス変換テスト | `hechima_wasm_test.js` |
| `README.md` | ビルドレシピ正典 (全手順・NDEBUG の罠) | `README.md` に統合 |

**コミットしないもの**: fcitx5-mozc 本体 (~326MB) と辞書 `mozc.data` (18.9MB) は CI 内で
clone / Release 取得する (下記)。ビルド成果物 (`.js`/`.wasm`/`.data`) も GitHub Releases で配る
(リポジトリには入れない)。変種 link スクリプト (`link_qb_{dbg,fix,sh,stk}.sh`) と asan ビルドは
NDEBUG バグ狩り (2026-07-08) の残骸なので移管不要。ただし README の「NDEBUG の罠」節に、
再発時は asan ビルドで特定した経緯があると一行残すと後任が助かる。

### 命名リネーム表 (今やると安い。他プロジェクトに広がった後の改名は高い)

| 現 | hechima |
|---|---|
| ファイル `mozc_qb.js` / `mozc_qb.wasm` | `hechima-wasm.js` / `hechima-wasm.wasm` |
| JS グローバル `EXPORT_NAME=MozcQbModule` | `HechimaModule` |
| C シンボル `mozc_qb_init` / `mozc_qb_convert` | `hechima_init` / `hechima_convert` |
| 辞書 `mozc.data` | **`mozc.data` のまま** (Mozc の辞書。名前と帰属を保つ) |

C シンボルのリネームは link スクリプトの `EXPORTED_FUNCTIONS` と QuuBee 側 `ccall` の
文字列を数個変えるだけ。JS グローバルとファイル名のリネームが本丸 (公開 API の顔なので今直す)。

### 自前パッチ (CI で必ず再適用。これが無いと 48MB の .inc を wasm に焼いて破綻する)

fcitx5-mozc の `cmake/data_manager.cmake` から `oss/oss_data_manager.cc` を除外する自前改変。
埋め込み .inc (48MB) を wasm に焼かず、実行時 `DataManager::CreateFromFile` でロードする方式にする。
**この diff をパッチファイル化してリポジトリに入れ、CI で `git apply` すること**:

```diff
--- a/cmake/data_manager.cmake
+++ b/cmake/data_manager.cmake
@@ -1,7 +1,7 @@
 set(MOZC_DATA_MANAGER_SRCS
     data_manager.cc
     dataset_reader.cc
-    oss/oss_data_manager.cc
+    # oss/oss_data_manager.cc  # hechima: 埋め込み .inc (48MB) を焼かず CreateFromFile でランタイムロード
     serialized_dictionary.cc
 )
 list(TRANSFORM MOZC_DATA_MANAGER_SRCS PREPEND "${MOZC_SRC_DIR}/data_manager/")
```

もう一つの `protobuf.patch` (C#/Java/Rust 生成器を protoc から除去) は **fcitx5-mozc 本体に
同梱** されている (`patches/protobuf.patch`)。clone すれば付いてくるので新規に持ち込む必要はない。
README 手順どおり `git apply --directory=protobuf patches/protobuf.patch` を CI で叩くだけ。

### link スクリプトのパス変数化

現 `link_qb.sh` は `B=/home/msonrm/development/mozc-wasm-build` と
`SRC=/home/msonrm/development/fcitx5-mozc` をハードコードしている。CI で回すため、この 2 つを
環境変数 or 引数にする。中身のフラグ (`-DNDEBUG -std=gnu++20 -funsigned-char -pthread -O2`、
`-sMODULARIZE -sEXPORT_NAME=... -sALLOW_MEMORY_GROWTH -sPTHREAD_POOL_SIZE=8`、
`-sENVIRONMENT=web,worker,node`) は挙動を決める重要素なので **変えないこと**。

## お願い 2: CI 構成 (GitHub Actions で再現ビルド)

README のビルドレシピ (全手順・再現可能) をそのまま CI 化する。要点だけ:

- **重い**: fcitx5-mozc は `--depth 1 --recurse-submodules --shallow-submodules` で clone しても
  ~326MB + submodule。ネイティブ protoc のビルド、Emscripten の wasm ビルドと二段。
  RAM 律速なので `ninja -jN` の N は runner のメモリと相談 (開発機 6.5GB では -j4)。
  ubuntu-latest runner はメモリに余裕があるので上げてよいが、OOM が出たら下げる。
- **Emscripten**: 開発機は apt の emscripten 3.1.69。CI は `mymindstorm/setup-emsdk` 等で
  バージョンを固定 (再現性のため素の latest にしない)。
- **-pthread 必須**: mozc の `base/thread.h` が `__wasm__ && !__EMSCRIPTEN_PTHREADS__` を
  `#error` で弾く。README 参照。
- **辞書**: `gh release download latest --repo fcitx-contrib/fcitx5-mozc --pattern mozc.data`
  で CI 内取得 (Bazel が要るのはこのデータ生成だけなので上流の CI 成果物を使う)。
- **`python`→python3 の symlink** を PATH に (gen スクリプトが `python` を直呼び)。
- トリガは手動 (`workflow_dispatch`) + fcitx5-mozc の版更新時が現実的。毎 push では回さない (重い)。

CI が緑になったら、`hechima-wasm.js` / `hechima-wasm.wasm` / `mozc.data` を **GitHub Releases に
版付きで publish** する (お願い 3)。

## お願い 3: 成果物を版付きで公開する

QuuBee は成果物を **pin して vendoring** する (Release から都度 fetch はしない。理由: QuuBee の
Cloudflare Pages デプロイは自己完結が原則で、外部取得を挟むと soundfont 入れ忘れと同類の事故が
増える)。そのため labo 側で:

- タグ付き GitHub Release に `hechima-wasm.js` / `hechima-wasm.wasm` / `mozc.data` を添付。
- Release ノートに **どの fcitx5-mozc コミット / どの emsdk バージョンで焼いたか** を記載。
  QuuBee はこの版を README に控えてコピーする。
- (任意) npm `hechima-wasm` として publish するなら wasm/data の同梱方針は別途相談。まずは
  Release 添付で十分。

## 最重要の罠: ラッパーは必ず -DNDEBUG でコンパイルする

移管で最も落としやすく、最も痛い。`converter::Candidate` は **NDEBUG 無しだと `std::string log`
メンバが増えて sizeof が変わる** (`candidate.h` の `#ifndef NDEBUG → MOZC_CANDIDATE_DEBUG`)。
ライブラリ (Release = -DNDEBUG) とラッパー TU で食い違うと、ラッパー側にインライン展開される
Segments/Arena のデストラクタが存在しないメンバを読み書きして **ヒープを黙って破壊** する。
症状は数回目の変換での OOB クラッシュ / ハング / free() abort と多彩で、原因箇所から遠い。
`link.sh` に `-DNDEBUG` を残し、README のこの節も必ず移すこと。ヘッダのコンパイル条件は
ライブラリのビルドタイプと常に一致させる。

## ホスティング制約: COOP/COEP (試打サイト・エディタを載せるとき)

`hechima-wasm.wasm` は pthreads 前提 = SharedArrayBuffer 必須 = **COOP/COEP ヘッダが要る**。

- QuuBee の devserver / Cloudflare Pages は配信済み。
- labo が試打サイトやエディタを **どこに載せるか** で要注意: Cloudflare Pages なら `_headers` で
  設定可。**素の GitHub Pages はカスタムヘッダ不可** なので `coi-serviceworker` 等の細工が要る。
  ここは載せる前に確認しておくこと。

## 参考: QuuBee 側の追随作業 (labo の作業対象ではない)

リネーム後、QuuBee 側で直す箇所は小さく、`web/player/mozc-worker.js` にほぼ集中している:

- `importScripts('../assets/mozc_qb.js')` → 新ファイル名
- `mainScriptUrlOrBlob: new URL('../assets/mozc_qb.js', ...)` → 新ファイル名
- `self.MozcQbModule(mod)` → `self.HechimaModule(mod)`
- `M.ccall('mozc_qb_init', ...)` / `M.ccall('mozc_qb_convert', ...)` → `hechima_init` / `hechima_convert`
- `fetch('../assets/mozc.data')` は **変更なし** (辞書名据え置き)

QuuBee はこれを新成果物のコピーと同じコミットで行い、回帰 fep_mozc_test を緑にして確認する。
将来: 変換セッション層 (複数文節の移動・候補選択・確定ループ。今は QuuBee の fep.js が持つ) を
`hechima` パッケージへ切り出せば、試打サイト/エディタが変換 UI を再利用できる (第 2 段。今回は対象外)。

## 完了の定義

- labo リポジトリに `hechima_wasm.cc` / `link.sh` / `hechima_wasm_test.js` / data_manager パッチ /
  README (レシピ + NDEBUG の罠) が入っている。
- GitHub Actions が fcitx5-mozc を clone → パッチ適用 → ビルド → `hechima_wasm_test.js` が
  PASS (「PASS — 変換成立」) するところまで緑。
- タグ付き Release に `hechima-wasm.js` / `hechima-wasm.wasm` / `mozc.data` が版情報つきで添付。

QuuBee 側からの質問・調整は、この文書を持ち歩いている人間 (msonrm さん) を経由してください。
