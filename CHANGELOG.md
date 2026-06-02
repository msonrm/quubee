# CHANGELOG

## [コードレビュー: LZH Level1 拡張ヘッダのバグ修正 + 防御的ハードニング] — 2026-06-03

並列コードレビュー (native/web 各層) での棚卸し。**実害バグ 1 件 + すぐ入る堅牢化**。
JS フロントが中心 (Wasm は loader の 1 箇所のみ)。

- **【バグ修正】LZH Level1 の拡張ヘッダ長を compSize から減算** (`web/player/archive.js`):
  LHA Level1 の compSize (skip size) は「圧縮データ長 **+ 全 ext header 長**」の合算値
  (lha 本家 `get_header_level1` が `packed_size -= extend_size` する仕様)。従来コードは ext 長を
  引かず、data 終端と次エントリ位置 `next` がともに ext 長ぶん行き過ぎ → **ext header を持つ
  Level1 書庫で 2 件目以降を取りこぼす / lh0 データ末尾にゴミ**。`compBytes = compSize - (ext 長)`
  を導入して修正。
  - **影響範囲**: games/ の全書庫 (Level1=359 エントリ) は ext header チェーンが空のため**実害ゼロ**
    (だから lh5_test.js がバグありでも 420/420 通っていた)。ext header 付き Level1 を踏んだ時だけ顕在化。
  - **検証**: Lhasa を独立オラクルに、CRC/checksum まで正しい Level1+dir-ext 実書庫を合成 →
    Lhasa が 59B 抽出 / 修正版 parser が byte 一致を確認。回帰テスト `tools/lzh_l1ext_test.js` を新設
    (games/ では覆えない経路を合成データで守る。lha は展開専用で Level1+ext を作れないため外部依存なし)。
  - ※ 旧メモリ `feedback-lzh-level1-header` の「packed=データのみ」は ext 無し fixture からの誤った
    一般化だった (本コミットで訂正)。Level1 の dir ext header → パス接頭辞の反映は別途未対応 (実害なし)。
- **【堅牢化】ZIP: 未対応 1 エントリで書庫全体を巻き添えにしない** (`web/player/archive.js`):
  暗号化 / 未対応 method / inflate サイズ不一致は `throw` で中断していたのを、LFH の compSize が有効な
  限り **該当エントリだけ skip** に変更 (LZH 側と同方針)。`inflateRaw` に展開後サイズ検証を追加。
  data descriptor (bit3) は next 位置を復元できないため従来どおり中断。
- **【堅牢化】FAT12/16: bad-cluster マーカ終端化 + クラスタ番号上限チェック** (`web/player/diskimage.js`):
  `eofMin` を 0xFF8/0xFFF8 → 0xFF7/0xFFF7 にして bad-cluster (0xFF7/0xFFF7) もチェーン終端扱い。
  チェーン追跡ループに `cl <= clusters+1` を追加し、壊れた FAT で範囲外/ゴミ追跡を防止。
- **【堅牢化】DOS ローダ: EXEC 子の reloc 書き込みを境界マスク** (`native/dos_loader.c`):
  子 EXE のリロケーション適用が `mem[]` を無マスク直書きしていた。`QB_GUEST_MEM_MASK` + `poke16`
  経由にして、壊れた/巨大な子 EXE で配列外を踏み Wasm トラップする経路を封じた。
- **【堅牢化】pollDosExit の再入耐性 + resumeAudio リスナ掃除** (`web/player/bridge.js`):
  poll を `{tick, codePtr}` 管理にし、再入時に前の poll を確実に停止 (タイマ/ヒープリーク防止)。
  AudioContext の resume リスナは resume 成功後に自身を外す (ページ寿命中ずっと残らない)。

検証: `lh5_test.js` 420/420・`diskimage_test.js` 27/27 回帰なし、`lzh_l1ext_test.js` 新規 PASS、
JS 3 ファイル `node --check` パス、Wasm 再ビルド (exit 0)。

## [HLE-DOS にディレクトリ操作 + 空き容量 + EXEC ハンドル掃除 / ファイラ表示の SJIS 化・MEMFS リーク修正] — 2026-06-02

コードレビューでの棚卸しに基づく修正群。**前半は JS フロント (Wasm 不変)、後半は DOS(INT 21h) 層**。

- **ファイラのファイル名表示を SJIS デコード** (`web/player/bridge.js`): 一覧/見出し/パンくず/Run 行は
  従来 latin1 バイト列を生表示していて漢字名が化けていた。`sjisName()` を追加し**表示文字列だけ**復号
  (FS キー/フォルダ移動用の原バイト名は保持)。`file.name` (ブラウザ由来=Unicode) は通さない。
- **MEMFS リーク修正** (`web/player/bridge.js`): `loadDiskFromBlob` が Run 連打のたびに `/tmp/disk_N_*` を
  量産していた (loader.d88 ~1.2MB/回)。slot 単位で旧イメージを `unlink`、挿入失敗分も即掃除。
- **`docs/dos_hle_gaps.md` 新規**: HLE-DOS の実 DOS との差異・未対応を体系化 (INT 21h 未実装 fn / 実装済み
  だが挙動差 / INT 21h の外)。当たりやすさ順の優先度付き。
- **INT 21h にディレクトリ/ディスク系を追加** (`native/dos_int21.c`):
  - **39h MKDIR / 3Ah RMDIR / 3Bh CHDIR** — host の mkdir/rmdir。CHDIR は**論理カレント `g_cwd` を持ち、
    相対パス解決 (`read_dos_rel`) に前置**して実際に効くようにした (`.`/`..` 解決込み)。47h GetCurDir も連動。
    `g_cwd==""` (CHDIR 未使用=既存ゲーム) では従来と同一経路 → **回帰なし**。
  - **36h Get Disk Free Space** — 実ディスクが無いので合成ジオメトリで「常に潤沢 (64MB 空き)」を返し、
    セーブ前の空き容量チェックを通す。
- **EXEC 子のファイルハンドル掃除** (`native/dos_int21.c` + `dos_loader.c`): 実 DOS の free-on-terminate
  相当。EXEC 時点の open 中ハンドルを bitmask で記録 (`qb_dos_fh_snapshot`)、子終了で**それ以降に開いた分
  だけ**閉じる (`qb_dos_fh_close_since`)。ランチャ往復型 (zar 等) でのハンドル枯渇を防ぐ。TSR(31h) は常駐
  させるので閉じない。
- **ファイラに /run ライブ反映** (`web/player/bridge.js`): 実行中のゲームが作った/書き換えた/消したファイルを
  一覧へ自動反映。正本 `loadedEntries` は維持しつつ、**実行中だけ** `/run` を ~1s ポーリングして「開始時から
  変化した分」だけ差分マージ (書庫由来の原 mtime は保持)。署名比較で**変化時のみ再描画** (チラつき無し)、
  スキャンは MEMFS=メモリ上なので軽量。CHDIR/MKDIR で作ったフォルダやセーブが UI で見えるようになった。
  ※ MEMFS は再読込で消えるので「保存の永続化」(IndexedDB 本棚) は別タスク。
- **`tools/dos_loader/dostest.com.py` 新規**: 39h/3Ah/3Bh/36h + CHDIR 前置を叩いて PASS/FAIL を画面表示する
  検証用 COM 生成スクリプト (ラベル/フィックスアップ機構の hand-assemble、逆アセンブルで命令列検証済み)。

検証: dostest.com で MKDIR/CHDIR/GETCWD/WRITE/RMDIR/36h 全 PASS + `/run/SAVE/TEST.DAT`="QuuBee" を確認、
ライブ反映でフォルダ即出現。ザルバール (EXEC ランチャ) でセーブの即反映も確認。

## [ディスクイメージの中身取り出し (FAT12/16・ブートせず) + ファイラに現代的フォルダ移動] — 2026-06-02

書庫 (.lzh/.zip) と同じ `/run/` 経路に、**ディスクイメージを「ブートせず・中のファイルだけ取り出す」**経路を追加。
concept の赤線 (持ち込みイメージから *ブート* させない＝商用丸ごと経路を公開 UI に置かない) を維持したまま、
Vector 等で `.d88`/`.fdi`/`.hdm` 配布されたフリーソフトを射程に入れる。**実装は JS のみ・Wasm 不変。**

- **新規 `web/player/diskimage.js`** (`qbDiskImage`): de-container → imageToVolumes (継ぎ目) → FAT リーダ。
  - **de-container** (形式別に生セクタ列=flat LBA 順へ): **D88/D77/D98** (`.d88/.d77/.d98/.88d/.98d`、trackp[164]
    +16B セクタヘッダを (C,H,R) 順に連結) / **FDI** (`.fdi`、LE32 ヘッダ+raw) / **DCP/DCU** (`.dcp/.dcu`、
    mediatype+trackmap[160]) / **raw beta** (`.xdf/.hdm/.2hd/.dup/.flp`/生)。バイト配置は NP2kai
    `diskimage/fd/*` を参照 (GPLv2、コピペなし・配置確認のみ)。
  - **FAT12/16 リーダ**: BPB 検証 → FAT チェーン → ルート/サブディレクトリ**再帰** (相対パスで返す)。
    FAT12/16 自動判別 (クラスタ数 <4085=FAT12)。FAT のディレクトリ日時は LZH/ZIP と同形式なので再利用。
  - **imageToVolumes** は今は `[全体]` を返すだけだが、**HDD 対応時にパーティション分割を差し込む継ぎ目**
    として用意 (FAT16・サブディレクトリ再帰も込みで「HDD は後付けで自然に生える」設計)。
  - **BPB 不正 (自己起動/非FAT) は明示メッセージで弾く** (赤線維持)。
  - **恒久対応外**: NFD (`.nfd`、セクタID保持=プロテクト保全用) / BKDSK (`.hdb/.dd6/.ddb`、BASIC) /
    VFDD (`.fdd`)。いずれも QuuBee のミッション (クリーン・フリーソフト限定) と逆向きなので、未実装ではなく
    **意図的な対応外**として「対応外の形式です」と表示。
- **`web/player/bridge.js`**: FS 書き出しを `writeEntriesToRun()` に共通化し、書庫経路 (`extractArchiveToFs`)
  とディスクイメージ経路で共有。`openDropped` にディスクイメージ分岐を追加 (ok→`/run/` 展開、非FAT/対応外→
  ステータス表示)。
- **SJIS ファイル名 0x5C (ダメ文字) 問題を解消**: 区切り変換を無条件 `replace(/\\/g,'/')` から **SJIS 対応の
  `dosPathToSlash`** (lead バイト直後の 0x5C は trail として素通し) に変更し、**書庫経路にだけ**適用。
  FAT 名は '/' 区切りで生成済 + 0x5C は必ず漢字 trail なので無変換。`ソ`(0x83 5C)/`表`(0x95 5C) 等を含む
  名前の誤分割が消えた (旧コードレビュー棚卸しの懸念を解消、ASCII 名は従来と同挙動で無回帰)。
- **ファイラに現代的なフォルダ移動 UI** (ノスタルジー無視・一般的): パンくず (🏠›DOC›COMMAND、クリックで任意の
  親へジャンプ) + フォルダ行クリックで降下。`currentDir` 状態、`loadedEntries` のフルパスから各階層の
  folders/files を導出。サブフォルダが無い平置き書庫ではパンくずを隠して従来どおりの見た目。投入/クリアで
  ルートへ戻す。EXE 選択・readme 自動オープンは木全体で従来どおり機能。
- **`web/index.html`**: `diskimage.js` 読込、`file-input` の accept にディスクイメージ拡張子を追加、`#crumbs`
  パンくずバー + フォルダ行 CSS、ヒント文更新。
- **検証 `tools/diskimage_test.js`** (Node): `np2tool/*.hdm` (実 FAT12 2HD・サブディレクトリ持ち) で抽出、
  `img2d88.py` で `.hdm→.d88`・FDI ヘッダ合成して **raw/d88/fdi の3経路がバイト一致** (sha1)、FreeDOS
  `boot.d88` の **4 階層再帰**、自作自己起動 `.d88` の非FAT判定、対応外拡張子の拒否を確認 → **pass=27/0**。
  フォルダ移動の振り分け/パンくずロジックも実 FAT イメージで全階層検証済み。
  - 未実測: **DCP/DCU** はサンプル書庫が無く実バイト照合が未 (仕様どおり実装済、実書庫が来れば同ハーネスで検証)。
    lh6/lh7 と同じ「構成上の正当性のみ確認」扱い。

**残 (将来)**: HDD イメージ (`.hdi/.nhd/.thd`) — de-container + PC-98 パーティション解析を足すだけで既存 FAT16/
再帰/継ぎ目に乗る設計。ただし HDD は「DOS 環境ごと/商用丸ごとインストール」率が高く赤線に触れやすいため、
**公開 UI での解禁可否はフロッピーが固まってから別途判断** (種は仕込み済、解禁は保留)。

## [FD 風ファイラ UI — 書庫の中身一覧 / readme 表示(③敬意) / 複数書庫展開 / タイムスタンプ] — 2026-06-01

公開 UI を「書庫ドロップ → Run」だけの最小から、**PC-98/DOS の filer 風の横並びドック**へ刷新。
コンセプトの逸脱 **#1(readme/③敬意)・#2(複数書庫展開)・#4(エントリ選択)** を一画面で解消。実装は JS のみ (Wasm 不変)。

- **横並びドック**: 左=ゲーム画面、右=パネル(ファイル一覧 → Run バー → テキストビュー)。仕切りドラッグで幅調整。
  入力はゲーム(window keydown)、テキストはホイール/スクロール＝**ドキュメントを読みながらプレイ**できる。
- **ファイル一覧**: 展開後の `/run/` を 名前・サイズ・**更新日時**で表示。**タイムスタンプは書庫ヘッダから取得**
  (`archive.js`: LZH L0/L1=DOS時刻 / L2=Unix time / ZIP=DOS時刻)。readme→EXE→他 の順に整列。
- **readme/テキスト表示 (③敬意)**: 選択で SJIS デコードして等幅表示 (AA を崩さない CJK フォントスタック)。
  投入時に readme を自動オープン＝作者の声をまず提示。**DOS EOF (0x1A) は生バイトで切る**
  (`TextDecoder('shift_jis')` のデコード後 0x1A の符号位置が環境依存のため、バイトで判定)。
- **エントリ選択 (#4)**: 一覧から EXE/COM をクリックで Run 対象に (自動検出はデフォルト、ユーザー上書き可)。
- **複数書庫の展開 (#2)**: 「＋追加」やドロップで同じ `/run/` に **last-wins で重ねて展開** (= デジタル HD
  インストール / パッチ上書き)。「クリア」で全消去。
- **パネル表示/非表示トグル**: canvas 全幅に広げて没入。Run バーは 2 行固定 (1行目 Entry/Args可変幅/Stop・Run右端、
  2行目メッセージ専用)。Args 入力欄フォーカス中はゲームにキーを送らないガード。`fitCanvas` は canvas 領域基準に変更。
- **games.json の実行時依存を撤去** (エントリ検出は filer 自前。逸脱 #3 も解消方向)。

**未対応 (将来)**: NEC PC-98 固有外字 (例 ZAR.DOC の `0x86A2`=JIS区12) は CP932 にも無く標準 Unicode グリフが
無いため □ 表示。完全対応は readme を `font.bmp` で canvas 描画する案 (C 側 tty 描画の流用、③敬意とも好相性)。
ディスクイメージのコンテナ展開 (FAT12 リーダ) も将来 (同じ filer に乗せられる)。

## [MVP 公開準備 — ディスクイメージ・ブート UI を撤去 (コンセプト準拠) + .zip を書庫展開化 + HELLO QuuBee] — 2026-06-01

コンセプト（ユーザーのディスクイメージから *ブート* させない／窓口は書庫一本）に沿って公開 UI を調整:
- **A/B/C/D ドライブスロットを UI から撤去**（`web/index.html`）。残すのは「書庫」(Run) スロットのみ。
  内部のローダ用 `loader.d88` ブートは保持（concept「内部利用は OK・窓口だけ絞る、コアはそのまま」）。
- **`.zip` を「中の .fdi を A: にブート」→「書庫として `/run/` へ展開 → 中の EXE/COM を実行」へ変更**。
  `extractLzhToFs` を `extractArchiveToFs` に汎用化（`.zip` は `parseZip` 経由）。**ディスクイメージのブート経路を
  公開 UI から完全排除**。ディスクイメージの「コンテナ展開」（FAT12 リーダ）は未実装＝当面 `.lzh`/`.zip` のみ受付
  （concept「任意・将来」。ドロップされたディスクイメージは「未対応」表示）。
- `file-input` の accept を `.lzh,.zip,.com,.exe` に限定。
- 起動スプラッシュ表示を **「HELLO NP2KAI」→「HELLO QuuBee」**（`boot.asm`、同字数で中央位置不変、nasm 再アセンブル →
  `np2kai_boot.d88` 再生成）。ディスクラベルも `QUUBEE BOOT`。`index.html` の `<title>`/hint も QuuBee・書庫案内に更新。

## [プロジェクト改称 QB → QuuBee + 公開は新リポジトリで (書庫ローカル限定の継続)] — 2026-06-01

**改称:** プロダクト正式名称を **QuuBee**（読み「きゅーびー」）に確定。由来は **QB = Q + Bee（蜂 = はち）
= PC-98 のきゅうはち**。略称「QB」は 2 文字で QBasic/QuickBooks 等と衝突し検索性が弱いため、日本語圏向けに
一意な造語へ寄せた（英語話者には "kwoo-bee" と読まれがちだが、主読者は JP なので許容）。
- **コード識別子 (`qb_*` / `QB_*` / `qbDebug`) と `.qb` フォーマット拡張子は QB のまま据え置き**
  （巨大かつ高リスクなリファクタを避け、継続性も保つ）。改称はプロダクト表記＝docs のみ。
- README / CLAUDE.md / docs/concept.md / docs/structure.md のタイトル・本文を QuuBee に更新（由来も明記）。

**公開リポジトリ方針 (決定、実行は別途):** ゲーム書庫を履歴に一切含めない最も確実な方法として、**履歴書き換え+
force-push は採らず**、現状をクリーン初期化した**新リポジトリ `msonrm/quubee` を公開**する。既存プライベート
repo `msonrm/qb`（full history・**非公開のまま温存**＝過去コミットに書庫が残るが露出ゼロ）はリネームして退避。
書庫 (.lzh 等) は**ローカル限定**の方針を継続（`.gitignore` 済・追跡解除済）。

## [LZH lh1 (適応 Huffman) 対応 + 未対応メソッド skip 継続 + ゲーム書庫をローカル限定 (著作権配慮)] — 2026-06-01

**背景:** `games/bio_100/` に Bio 100% フリーソフトの実 .lzh 群が揃い、棚卸しで `-lh1-` を使う実ゲーム 3 本
(`GETS/GS100/MOG003.LZH`) が判明 (前エントリで Tier C として記録)。これを実装し、あわせて未対応メソッドの
扱いを堅牢化、さらに検証用ゲーム書庫の公開リスクに対処した。

**1. `-lh1-` (LHarc 1.x) デコーダ実装 (`web/player/archive.js::lh1Decode`):**
lh1 は lh4-7 (静的 Huffman) とは別アルゴリズムで、**文字/長さは適応(動的) Huffman 木** (シンボル復号毎に頻度
更新、root freq が 0x8000 で全体再構成)、**位置は静的テーブル**を使う。LHa for UNIX (`dhuf.c`/`shuf.c`/`slide.c`)
を参照しクリーン実装 (逐語コピーなし)。確定した定数: `DICBIT=12` (4KB 窓)、`THRESHOLD=3`、**`maxmatch=60`**
(lh5 の 256 と異なる)、`N_CHAR=314`、位置シンボル `np=64`、リングバッファは空白(0x20)初期化・MSB-first。
**検証**: `tools/lh5_test.js` (実書庫を `lha xq` と全エントリ byte 比較) で 3 本 16 エントリが byte 一致、
**合計 pass 420 / fail 0 / skip 0**。

**2. 未対応メソッドで書庫全体を中断しない:**
`parseEntry` は未対応メソッドを **throw せず `data=null`** で返す (ヘッダは読めているので `next` で次へ進む)。
`parseLzh` はこれを伝播し、混在書庫でも対応エントリを取りこぼさない。`web/player/bridge.js` の
`extractLzhToFs` は `data=null` を skip しつつ `console.warn` で件数を通知 (展開済みエントリのみ返すので
.exe 自動検出も破綻しない)。`tools/lh5_test.js` は `data=null` をエントリ単位 SKIP として計上。

**3. ゲーム書庫をローカル限定に (著作権配慮):**
`games/` 配下の .lzh/.zip/.rar は**著作権者から再配布許可を得ていない**ため、公開リポジトリ (github.com) に
含めない方針へ変更。`.gitignore` を `/games/*` + `!/games/.gitkeep` に更新し、既に追跡されていた 7 書庫
(rabbit31/ray_iv2a/sam98210/zarfw + Super Depth 系) を `git rm --cached` で**追跡解除** (ローカル実体は保持、
検証は引き続き動作)。
> ⚠️ **既に push 済みの履歴には残る**: 追跡解除は今後の混入を止めるのみ。過去コミット (および origin) からの
> 除去には履歴書き換え + force-push が必要 (破壊的なので別途判断)。リポジトリ可視性 (public/private) の確認も推奨。

## [コードレビュー修正 (Run ボタン / エラー表示) + LZH デコーダ拡張 (lh4/6/7 + ヘッダ Level 2)] — 2026-06-01

**背景:** ざっとレビューで挙がった残課題のうち、実害のある 2 件を修正し、LZH 対応をフリーソフト
書庫の実態に合わせて拡張した。

**コードレビュー修正 (`web/player/bridge.js`):**
- **Run ボタンが特定経路で永久に disabled になるバグ**を修正。click 冒頭で `disabled=true` にするが、
  戻すのは polling の `onExit` だけだったため、polling を開始しない経路 (`zip-fdi` / `unknown` /
  stage 前の throw) でボタンが固まっていた。click ハンドラ末尾に `finally` を追加し、
  `currentPoll === null` (= polling 未開始) の経路でのみ Run/Stop を戻す (polling 中は従来どおり
  `onExit` が戻すので二重制御なし)。
- **初期化失敗時に UI へエラーが出ないバグ**を修正。`setDriveName(0, …)` が
  `setDriveName(kind, drive, name)` と引数ずれで無言 no-op だった → `setDriveName('fdd', 0, …)`。

**LZH デコーダ拡張 (`web/player/archive.js`):** 対象スコープ (FD・2D・〜1998 同人/フリー) では `-lh5-` +
ヘッダ Level 1 が支配的だが、後期・大物・UNIX 再梱包の書庫で lh6/lh7 や Level 2 に当たるため拡張。
当初プランの `libarchive.wasm` は採用せず (lh1 等は libarchive も非対応で利得薄・依存重)、軽量な自前
デコーダを拡張する方針を継続。
- **`-lh4-/-lh6-/-lh7-` 対応**: lh4/5/6/7 はアルゴリズム完全同一で、違うのは窓径 (DICBIT=12/13/15/16) と
  連動する NP (=DICBIT+1) / PBIT (lh4/5=4, lh6/7=5) だけ。`lh5Decode` を `lhDecode(src, outSize, dicbit)` に
  パラメータ化し、PBIT は `(1<<PBIT) > NP` を満たす最小として算出。NC/CBIT/NT/TBIT/THRESHOLD は共通のまま。
  `lh5Decode` は dicbit=13 固定の後方互換エイリアスとして残置。
- **ヘッダ Level 2 対応**: L0/L1 と構造が異なる (先頭 2 byte=全ヘッダ長、チェックサム無し、ファイル名は
  ext header type 0x01、ディレクトリは type 0x02 の 0xFF 区切り、データは `base+ヘッダ長` から、ext chain は
  L1 と逆で各ヘッダ先頭にサイズ)。Level 3 は引き続き throw。

**検証 (実書庫):** `games/bio_100/` に Bio 100% フリーソフトの実 .lzh 群が追加されたのを機に、
`tools/lh5_test.js` を **games/ 全 .lzh を `lha xq` (Lhasa) と全エントリ byte 比較する実書庫網羅テスト**に
格上げ。**404 エントリ全て byte 一致 / fail 0**。内訳で新対応分を実データ実証:
- **lh4 (L1)**: `C2RANK.LZH` 5/5 一致。
- **Level 2**: `POLA100.LZH` 33/33・`ROLL100.LZH` 12/12 一致 (lh5 L2 + lh0 L2 を含む)。
これにより当初の合成テスト (`tools/lzh_level2_test.js`、実圧縮データを L2 ヘッダで包み直す手法) は
実書庫に役目を譲り**削除**。
- **未対応で判明したギャップ — `-lh1-` (L0)**: `GETS.LZH` / `GS100.LZH` / `MOG003.LZH` の 3 本が
  全エントリ lh1 (適応 Huffman + 4KB 窓、lh4-7 とは別アルゴリズム) で `parseLzh` が throw → SKIP。
  本スコープ (〜1998 FD フリー) でも実在するため Tier C として `TODO.md` に対応検討を記録。
- **未検証で残るもの**: lh6/lh7 (本 corpus に無く、手元の Lhasa は展開専用で作成不可)、および Level 2 の
  ディレクトリ拡張ヘッダ type 0x02 (実 L2 書庫が全てルート配置で踏まれず) — いずれも構成上の正当性のみ確認。

**その他:** レビューで挙がった確信度 中〜低のエッジ課題 (ローダ側 5 件・JS 側 3 件) を `TODO.md`
「コードレビュー棚卸し (2026-06-01)」に記録。docs (structure.md / TODO.md) の LZH 記述を現状同期
(`libarchive.wasm` 想定 → 自前デコーダ採用)。

## [コンセプト再定義 (v3) — 「PC-98 フリーソフト文化のプレイヤー」へ + CREDITS 整備 + docs 同期] — 2026-06-01

**背景:** Notion v2 仕様（VM2 固定 / FreeDOS 内蔵 / 商業リファレンス 5 本 / フィンガープリント DB 中核 /
持ち込み非永続）は Phase 2〜3 の実装で大きく転換した。本エントリでコンセプトを正式に再定義し、軸を
「PC-98 エミュレータ」から **「PC-98 フリーソフト文化を、罪悪感なく継承・再体験できるプレイヤー」** へ
研ぎ直す。現行コンセプトは [docs/concept.md](docs/concept.md)（Notion にも反映）。
**方針: 各ドキュメントは "現状こそ正" を present-state で記述し、当初構想からの変遷は本 CHANGELOG が保持する。**

**当初構想 (Notion v2) からの主な転換:**
- **軸**: 忠実再現エミュレータ → フリーソフト文化のプレイヤー。2 本柱 ＝ ①著作権クリーン（NEC BIOS も
  MS-DOS も使わない＝公開ホスト可能・**実装済**）②お手軽（書庫ドロップ→即プレイ＝当時の流儀）。＋③敬意。
- **リファレンス機種**: VM2 固定 → **PC-9821/NP21 固定**。
- **DOS**: FreeDOS(98) 内蔵 → **ミニ DOS ローダ（INT 21h HLE）**。
- **フォント**: Takao/IPA/Noto → **font.bmp（修正 BSD, Neko Project 用代替フォント）**。
- **リファレンスゲーム**: 商業 5 本 → **フリーソフト主体**（さめがめ/ザルバール/Super Depth/うさちゃん列車）。
- **入口**: ディスクイメージ前提 → **書庫（.lzh/.zip）一本**。複数書庫の同時展開＝デジタル HD インストール、
  パッチ（上書き型＋パッチャ EXE 型）対応。ディスクイメージは「ユーザーのディスクイメージからのブート」だけを
  公開 UI から外す（コアは保持＝`loader.d88` が依存）。
- **フィンガープリント DB**: 中核インフラ → **廃止**（`.qb` が自己記述的なので不要。エントリ自動検出 +
  readme ビューア + `.qb` 共有で代替）。`db/games.json` は dev fixture として残すのみ。
- **永続化**: 「持ち込みは保存しない」→ **本棚（IndexedDB / File System Access API）として永続化**
  （ユーザー自身の手元ファイルなので著作権問題なし）。セーブステートは作らない方針は維持（ゲーム本来のセーブを永続化）。
- **`.qb` 形式**: **オリジナル書庫 + 展開物 + 設定 + セーブ + サムネ + クレジット**を束ねる完成形
  （原書庫同梱で出所の保全・再展開・検証が可能）。
- **快適化の再定義**: CPU クロックだけでなく「ディスク入れ替え不要・即起動」へ拡張（コンテンツアクセスの快適化）。
- **3D ポリゴン**: 「対象外」から除外（PC-98 に 3D HW は無く全てソフト描画 → CPU+FPU で動く）。

**CREDITS 整備:** `CREDITS.md` を新規作成。`web/assets/font.bmp`（修正 BSD, SimK / Nekosan development team）の
著作権表示・ライセンス全文を収録して帰属義務を満たし、NP2kai（MIT）も明記。「著作権クリーン」を掲げる以上の
当然の整備（参照用 `sazanami-fontbmp.zip` は .gitignore）。

**docs 同期:** `docs/concept.md` を新規作成（present-state のコンセプト）。README / CLAUDE.md / docs/structure.md
から「Notion と乖離」警告・乖離セクションを除去し、現状記述 + concept.md へのポインタに整理。

## [Phase 3 — うさちゃん列車 プレイ可能 (公式 3/4) + 日本語(漢字) tty 表示を根治 (font.bmp は無実だった)] — 2026-06-01

**背景:** Phase 3 公式 4 本目「GO!GO! うさちゃん列車」(`rabbit31.lzh`, .com, KEN Takahashi 1993) を検証。
起動・デモ・キー操作 (生 IRQ1 を自前 INT 09h で受ける経路)・グラフィック・面クリアまで動作し **公式 3/4 達成**。
唯一の不具合「画面上部のタイトル『うさちゃん列車 Ver.3.1 …』が『　　ぁっぴ…』に化ける」を追って、
長く保留していた「日本語(漢字) tty 表示の課題」の真因を特定・根治した。

**真因 (前回の誤診を訂正):** 化けは font.bmp ではなく **`native/dos_int21.c::vram_put_kanji` の 1 行**。
PC-98 テキスト VRAM の漢字セルは **非対称符号化**で、低位 = JIS第1バイト−0x20 (区索引)、
**高位 = JIS第2バイト「そのまま」| 0x80** (索引化して −0x20 してはいけない)。font.bmp も
`fontpc98.c`(pc98knjcpy) も `maketext.c:280` (`(kc&0x7f7f)<<4`) も全てこの配置で内部整合している。
我々は高位も −0x20 していたため ten が 0x20 ずれ、`う`(JIS ku4) 等が fontrom で 0x20 低いスロットを
引き「　　ぁっぴ」になっていた。

**検証 (実データ):** font.bmp を pc98knjcpy のアドレッシングで直接ダンプし、`う`(JIS 0x2426) が
slot(区4, j=0x26=生 jis_lo) に、`列`(JIS 0x4e73) が slot(区46, j=0x73) に **正しく実在**することを確認。
さめがめが使う CG 窓 (`cgrom.c`, port 0xA1/A3 + `(code&0x7f7f)<<4`) と tty レンダラ (`maketext.c`) が
**完全同一式** → font.bmp もレンダラも standard、ずれは我々の符号化のみだった。

**修正:** 高位バイトを `(jis_lo-0x20)|0x80` → **`jis_lo|0x80`** (低位=区索引は不変)。**font.bmp も CG 窓
経路も触らないため さめがめ等への回帰リスクはゼロ** (実機回帰確認済: rabbit タイトル正常・sjistest 全角正常・
さめがめ無回帰)。(保留中の) Ray メニュー日本語も同時に正常化する generic 修正。

**前回の誤診の教訓:** 2026-05-31 に「font.bmp の漢字配置が標準 JIS と不一致 → tty 化け、さめがめと
両立不可で保留」としたのは、**font.bmp を区/点『索引』で覗いたための誤読** (実際は jis_lo『バイト』位置に
正しく格納)。jiskan16 注入で「tty 直る/さめがめ壊れる」と見えたのも正しい font を誤位置で上書きしたため。
真因は最初から `vram_put_kanji` の 1 行で、font.bmp は無実だった。

**ツール整理:** 誤診ベースの `tools/dos_loader/make_kanji_font.py` (jiskan16 注入) を削除。
`sjistest.com.py` は SJIS 全角描画の有効な単離テストとして残置 (build.sh が生成、`.gitignore` に追加)。

**既知の課題 (スコープ外・将来):** Bio 100%「蟹味噌」で、起動時に左上へ出る「KANI.SCRを作成します」の
テキストが、オープニング〜ゲーム本編を通して消えずに残る (テキスト面が graphics の上に残留する系)。
別課題として Phase 4 候補。

## [Phase 3 — Ray 黒画面の原因究明 + イメージ起動 IF=1 + poke/peek メモリマスク統一] — 2026-06-01

**背景:** T6 Ray IV の「RIN 常駐で音は鳴るがオープニング手前で黒画面」を深掘りして原因を局所化。
あわせてコードレビューで挙げた潜在不整合 (poke/peek マスク) と陳腐化コメントを整理した。
さめがめ / ザルバール でブラウザ回帰確認済 (IF=1・マスク統一とも無回帰)。

**1. Ray 黒画面の原因を局所化 (結論は「Ray 内部の上流データ未到達」= Phase 4 候補):**
`qbDebug.{regs,sample,int21Stats,grphdisp,dump}` と ndisasm で hang ループを逆アセンブルした結果、
ループは **Ray 自前の RLE/エスケープ式グラフィック展開ルーチン** (`CS:IP=0110:0x9ca0-0x9f6c`,
linear 0xada0-0xb06c, DS=ES=0xB000=赤プレーン) と判明。決定的な観測:
- **解凍ソースが全ゼロ + エスケープマーカ BL/BH/DL も全 0** (regs: BX=0000, DX=ff00)。データ 0x00 が
  エスケープ 0x00 に一致し続け、ラン長 0 の展開パスを空回り (SI は速く進むが DI はほぼ不動で終端に当たらない)。
- **ループ中 INT 21h ゼロ** (`int21Reset`→3s→`int21Stats`={__total__:0}) = ファイル I/O 駆動ではない。
- **IVT[21h]=F000:EE10 (自ハンドラ)・IVT[1Ch]=FD80:00AC (BIOS) のまま** = RIN はベクタを乗っ取っていない。
- **`grphdisp` ENABLE=off・VRAM 赤プレーン空** = まだ表示前の解凍段階で詰まっている。
→ ベクタ乗っ取り / ファイル I/O ループ / IF / 表示 dirty の**いずれでもない**。真因は「**Ray の
オープニング画像データが解凍バッファ (VRAM) に届いていない (全ゼロ)**」という上流のデータフロー問題で
深い RE が要る。RIN が常駐し音が鳴るようになったことで、以前 RIN EXEC 失敗時には来なかったこの解凍段階に
**到達するようになった**ための回帰的症状。Phase 3 合格条件 (起動・デモ確認) は満たすため保留。

**2. イメージ/EXEC 子の起動時に IF=1 (実 DOS 準拠):** `boot.asm` が `cli` してから loader に来るため、
従来はイメージが**割り込み禁止のまま**走り出していた (`qb_dos_loader_start_hook`)。EXEC 子も INT 21h が
IF をクリアしたまま子へ飛んでいた。実 DOS はプログラムを IF=1 で起動するので、両入口で
`CPU_FLAG |= I_FLAG` を立てるよう修正 (`dos_loader.c`)。Ray には効かなかったが、より正しい挙動なので残置
(ブロッキング入力時に IF を立てる既存処置 = zar quit パスの、起動時版にあたる)。

**3. poke/peek のゲストメモリマスクを 2MB に統一 (`QB_GUEST_MEM_MASK`):** `dos_int21.c` の poke8/peek8 が
`& 0xFFFFF` (1MB) でマスクしており、`dos_loader.c` (マスク無し) と不整合だった。1MB マスクはリアルモード
上限 0x10FFEF (1MB+64KB) の HMA 近傍アクセスを低位メモリへ折り返す潜在バグ (例: `peek16(0xFFFFF)` が
mem[0xFFFFF]+mem[0]=IVT 先頭 を読む)。`mem[0x200000]` (2MB) の実境界に合わせた共有マクロ
`QB_GUEST_MEM_MASK = 0x1FFFFF` を `dos_loader.h` に定義し両ファイルで使用 — 誤ラップを解消しつつ配列外
アクセス (Wasm では即トラップ) の安全ネットも維持。現テストはアドレス全て 1MB 未満なので挙動不変。

**4. コメント整備:** `dos_loader.c` 冒頭の「TSR (AH=31h) 非対応」(実装済みと矛盾) を更新し対応状況に
TSR・COM 子 EXEC を追記。EXEC 子の env/argv[0] が env_seg=0 で親 env を継承する**限界を `qb_dos_exec_load`
にコメント明文化** (現スコープで子の argv[0] を読むものは無いので未対応のまま)。

## [Phase 3 — Ray IV 起動 (RIN.COM 自動常駐) + SJIS 全角 tty 描画 + フォント関連の堅牢化] — 2026-05-31

**背景:** T6 として Ray IV (`ray_iv2a.lzh`) に着手。doc/strings 解析で「Ray は起動時に常駐音源ドライバ
`RIN.COM` を自前で EXEC して常駐させる」構成と判明。EXEC・TSR・DUP を実装して **RIN 常駐 → FM 音楽
再生 → ENV/データ読込 → メインメニュー描画まで動作**。その過程で「日本語が化ける」既知課題を深掘りし、
原因を fontrom 周りに特定した。

**1. AH=4Bh EXEC の COM 子対応** (`dos_loader.c::qb_dos_exec_load`)。従来は MZ 専用で非 MZ を `-3` 弾き。
Ray が EXEC する `RIN.COM` は .COM なので即失敗していた。MZ/ZM マジック判定で EXE/COM を分岐し、COM は
全体を body として `子PSP:0x100` にロード、全 segreg=PSP、IP=0x100、SP=0xFFFE (64KB 以上の塊なら)、
スタックに 0x0000 を 1 word push (near RET → PSP:0000 = INT 20h)。EXE 経路は従来どおり。

**2. AH=31h Keep Process (TSR)** (`dos_loader.c::qb_dos_signal_tsr` + `dos_int21.c`)。子を DX パラグラフに
縮小し**所有者を子 PSP のまま残す (free-on-terminate しない=常駐)**、親 (Ray) へ復帰。`AH=4Dh` で読める
終了コードに AL をセット。RIN.COM が自身を常駐させる本線経路。

**3. AH=45h/46h DUP/DUP2** (`dos_int21.c`)。FILE* ベースなので同 path/mode で開き直し + 元位置へ seek した
独立ハンドルを返す。ファイルハンドル表に `mode` フィールドを追加。Ray が `RAY_IV.RAY` を dup する経路用。

**4. SJIS → 全角 (漢字) tty 描画** (`dos_int21.c`)。tty に Shift-JIS 第1バイト (0x81-9F/E0-FC) 検出 →
次バイトと合成 → SJIS→JIS 変換 → PC-98 テキスト VRAM の漢字セル (低=ku, 高=ten|0x80) を隣接 2 セルに書く
(`sjis_to_jis`/`vram_put_kanji`/`tty_kanji_putc`/`TTY_SJIS2`)。NP2kai `pc98knjcpy`↔`maketext` のレイアウト
`(ten<<12)|(ku<<4)` と整合。**符号化は正しいが、現 `font.bmp` は標準 JIS 配置の漢字を持たない** (下記) ため
現状は休眠。半角カナ (0xA1-0xDF) は単バイト ANK のまま。tty の生バイト stderr エコーは既定 OFF に
(`g_tty_echo_dbg`、ブラウザで巨大スタックトレースが量産されコンソールが埋まるため)。

**5. フォント: リセット時の fontrom ゼロ埋め抑止** (`tools/np2kai_patches/02_font_reset_fix.patch`)。
`pccore_reset()` が `ZeroMemory(mem + FONT_ADRS, 0x08000)` で fontrom 先頭 0x8000 (= JIS 点 0..7 の漢字
ブロック) を**毎リセット消去**していた。本家は消去後 `hook_fontrom` が OS フォントから再生成するが、
Wasm にそのバックエンドが無く、`font_load` も `pccore_init` で一度きりのため、**点1..7 の漢字 (あ/い/う 等)
が永久に欠ける**。この抑止で全漢字が生き残る (generic 改善)。

**フォント配置に関する重要な発見 (未解決の保留課題):**
- font.bmp に対し `pc98knjcpy`/`pc98ankcpy` の読み取りをローカル再現して検証 → **ANK は正しいが、現
  font.bmp の漢字は我々の tty(maketext) が使う標準 JIS の (ku,ten) 配置と一致しない** (tty で「日本語漢字」
  →「頓房弧粥孜」と別字、ひらがなは空白)。一方 **さめがめ等の実ゲームはこの配置に合わせて漢字を読む**
  ので正しく出る。
- 検証用に X11 `jiskan16.pcf` (16x16 JIS 漢字) を標準 JIS 配置で font.bmp に注入すると **tty は直るが
  さめがめが壊れる** (位→一)。両者は同じ fontrom 領域を別レイアウトで奪い合うため両立しない。
- → **font.bmp は元のまま維持** (実ゲーム動作 + 既存書体を優先)。tty(maketext) 日本語表示は別課題として
  保留 (実プレイ対象は自前/グラフィック描画なので実害なし)。生成ツール `make_kanji_font.py` と SJIS-tty
  コードは将来の標準 JIS フォント採用時に備えて残す (現在は未使用)。

**Ray IV の現状:** 起動 → RIN.COM を COM として EXEC → OPNA 検出 → RIN 常駐 (TSR) → FM 音楽再生 →
RAYR.ENV/RAY_IV.RAY 読込 (DUP 含む) → **メインメニュー (テキスト) 描画**まで動作。ただし**オープニング
表示の手前で Ray 内部の描画/イベント待ちループ (`CS:IP≈0110:0xada0-0xb0be`, DS=グラフィック VRAM) に
入ったまま進まず画面は黒** (音楽は鳴る)。フォントでも bitac でもキーIRQでもない (IVT[09]=BIOS のまま確認)
Ray エンジン内部の課題で、深い RE が必要。Phase 3 合格条件 (起動・デモ確認) は満たすが完全表示は保留。

**新規ツール:** `tools/dos_loader/sjistest.com.py` (SJIS 漢字描画の単離検証 COM)、
`tools/dos_loader/make_kanji_font.py` (jiskan16 を標準 JIS 配置で font.bmp 注入、現在未使用)。

## [Phase 3 — コードレビュー指摘の修正 (0Ch 入力バグ + 潜在エッジ + コメント陳腐化)] — 2026-05-30

**背景:** ローダ/INT 21h のコードレビューで洗い出した不具合を修正。すべてコンパイル確認済
(警告ゼロ)。現テストスイートが実行する経路は さめがめ / ザルバール / Super Depth LZH の
**ブラウザ回帰確認が未実施** なので、次セッションで実機確認すること (特に MCB self-shrink 周り)。

**1. 🔴 バグ修正 — AH=0Ch (flush 後入力) が再ポーリングのたびに入力を捨てる** (`dos_int21.c`)。
- `int21_0c_flush_input` は内側がブロッキング系 (01/07/08/0A) のとき、入力待ちで `CPU_IP` を
  巻き戻して同じ INT 21h を踏み直す。このときゲストの AX は不変で **AH=0Ch のまま再入** するため、
  毎回 `kb_flush()` が走り、待機中に届いたキーを捨てて**永久に入力が完了しない**無限ループだった。
- `g_0c_flushing` ラッチを追加し、**flush は 0Ch の初回 1 回だけ**に限定 (内側 fn が完了したら解除、
  `qb_dos_tty_reset` でもクリア)。現スイートは PC-98 キーを INT 18h で読むため未行使パスだが、
  「将来の種」として根治。

**2. 🟡 潜在エッジの堅牢化:**
- **MCB self-shrink の二度掛けでアリーナ全消去** (`dos_loader.c`)。最上位 PSP (0x0100) への 4Ah を
  毎回「アリーナ起点確定=チェーン再初期化」と解釈していたため、起動後にもう一度 self-shrink すると
  その間の 48h 確保ブロックを巻き込んで消す危険があった。`g_prog_shrunk` で**初回のみ初期化**し、
  2 回目以降は保守的に成功扱い (チェーン不変) に。loader-start で 0 に戻す。
- **EXEC エラーパスの子ブロックリーク** (`dos_loader.c::qb_dos_exec_load`)。reloc テーブルの
  範囲外チェックを MCB 割り当ての**後**で行っていたため、不正な子 EXE で抜けると所有者なき
  ブロックがリークしていた。**確保前に前段チェック**へ移動 (`qb_dos_stage_exe` と同様)。
- **EXEC 子の DTA 既定が親 PSP を指す** (`dos_loader.c` + `dos_int21.c`)。DTA を 1 本しか持たない
  ため、子が AH=1Ah 無しで FindFirst すると親 PSP:0080 (cmdline 領域) に結果を書いていた。
  exec frame に親 DTA を退避 → 子の既定を子 PSP:0080 に設定 → 子終了で親 DTA を復元 (per-process
  DTA 相当)。アクセサ `qb_dos_dta_get_packed`/`qb_dos_dta_set` を `dos_int21.h` に追加。
- **AH=4Bh EXEC の子イメージ 256KB サイレント切り捨て** (`dos_int21.c`)。`childbuf` 超のファイルを
  黙って truncate して壊れた EXE を実行していた。事前 `stat` で大きすぎれば**明示的に失敗** (AX=8)。
- **AH=2Ch (Get Time) の DL (1/100秒) が常に 0** (`dos_int21.c`)。`gettimeofday` で秒未満を実値返し、
  time-seed 系ゲームの乱数エントロピーを確保 (同一秒内のシード衝突を回避)。

**3. 🟢 コメント陳腐化修正 (MCB チェーン化の取りこぼし):**
- `dos_int21.c` ヘッダ / `int21_49_free` / `dos_loader.c` ヘッダ / `dos_loader.h` の「bump allocator /
  no-op success / 常に成功扱い=全メモリ保持」記述を、実装どおり **MCB チェーン (first-fit+coalesce+
  分割) + EXEC** に更新。`dos_int21.c`/`dos_int21.h` の「20 fn / T4 範囲」も現状 (~35 fn / T1-T5) に。
- `qb_dos_alloc_reset` のプロト引数名を `image_end_paragraph` → `arena_base_para` (定義と一致)。

## [Phase 3 — DOS メモリマネージャを MCB チェーン化] — 2026-05-30

bump allocator (free=no-op、推定 alloc ベース) を、実 DOS に忠実な **Memory Control Block
チェーン**に置換 (TODO ギャップ④解消)。MCB をゲストメモリに実体として置き
(`'M'`/`'Z'` + 所有者 PSP + サイズ)、アリーナ (プログラム末尾〜0xA000) を管理:
- **48h**: coalesce → first-fit → 大きければ分割。所有者 = 現プロセス PSP。失敗時は largest free。
- **49h**: ES-1 の MCB を空きに + coalesce。
- **4Ah**: 縮小 (末尾を空きに分割) / 拡大 (次が空きなら結合、不足なら largest+CF)。
  最上位 PSP の self-shrink はアリーナ起点を確定。
- **EXEC**: 子に最大空きブロックを割り当て (DOS の EXEC と同じ)、子は 4Ah で自身を縮める。
- **子終了**: その PSP が所有する全ブロックを解放 (DOS の free-on-terminate)。

**成果:**
- **ザルバールの面ごと ~64KB リーク解消** — 子 PSP が一定 (20DE 固定)。以前は +64KB/面で
  〜8 面で枯渇していた。
- **Super Depth (DEPTH100.LZH) がプレイ可能に** — T4.5 の「MML 音楽ドライバ hang」(既知課題) が
  解消。**真因は音楽ドライバではなく、bump allocator が壊れた/重複したバッファを返していた
  メモリ破壊**だった。depth がコンパイル済 MML を置くバッファが壊れ、ドライバが生 MML を舐めて
  無限ループしていた。忠実なメモリ管理で根治 (深い RE は不要だった)。
- さめがめ / ザルバール 回帰なし。

## [Phase 3 T5 — ザルバール プレイ可能 (AH=4Bh EXEC 実装)] — 2026-05-30

**成果:** `zarfw.lzh`「ザルバールの蒸留塔」が **DOS なし** で起動 → タイトル → マウスでメニュー →
ゲーム盤面表示 → **マウスで壁の生成/破壊が可能** = **プレイ可能**。Phase 3 ローダ対象 **2/4**
(さめがめ + ザルバール)。

**構造の発見:** `zar.exe` は**ランチャ**で、`siz3.exe`/`siz4p.exe`(実体エンジン) を **INT 21h
AH=4Bh EXEC** で起動する (cmdline 例 `"SIZ01 ZBG2"` = 面 + 図柄)。面 MAP/CND・図柄 CHL は
エンジン EXE に埋め込み (siz が自分自身を open+seek+read)。EXEC 未対応では「即ゲームオーバー」
に見えていた。

**1. リグレッション修正 — AH=4Ah で alloc ベースを正直化:**
- 堅牢化コミット (c92ff53) が EXE alloc 推定式を旧 `SS+0x1000` から変えた結果、起動時に自前で
  スタックを移動する zar で確保領域がスタックを破壊して暴走していた (zar 未検証だった)。
- `int21_4a_resize` で **`ES == 現プロセス PSP` の self-shrink 時に alloc ベースを `ES+BX` に更新**。
  ローダ推定でなく**ゲームが宣言した保持領域の上**に確保するので推定式に依存せず堅牢。
  現プロセス PSP は `qb_dos_cur_psp()` で追跡 (EXEC した子は PSP が 0x0100 でないため)。

**2. INT 21h 拡張 (zar が実際に叩くギャップを証拠ベースで実装):**
- `47h` Get Current Dir → 空文字列(ルート)+CF=0、`2Fh` Get DTA、`19h` Get Drive、`33h` Ctrl-Break。
- コンソール入力系 `01/06/07/08/0A/0B/0C` (blocking は `bios18.c` AH=00h と同じ `CPU_IP--`/
  `REMCLOCK=-1` 再ポーリング)。※現スイートでは未行使 (PC-98 は INT 18h でキーを読む) の保険。

**3. AH=4Bh EXEC (段階1.5 = 親常駐・子を上にロード):**
- 最初「子で親を置換」したら siz が自データへ暴走 (`PC=08e2:0ee3` のデータ停止)。**親(zar)は
  IVT フックを仕込み常駐前提で子を起動するため、置換すると破壊される**のが真因。
- `qb_dos_exec_load()` で**親を残したまま子をロード** (MZ パース + `child_img` ベースで reloc +
  子 PSP 構築〔親 PSP を 0x16 に保存〕+ env/cmdtail セット + CPU を子エントリへ)。
  親メモリ/IVT は無傷なので IRQ もコールバックも壊れない。**これでプレイ可能**。
- **段階2 (親復帰)**: 子起動時に親コンテキスト (戻り CS:IP/SS:SP/regs/PSP) を `g_exec_stack` に退避、
  子の 4Ch/INT20h 終了で親を復元 (CF=0=成功)、`AH=4Dh` も追加。→ クリアで次面・quit でタイトルの
  往復が成立。**ブロッキング入力の IF デッドロック修正** (quit の `AH=07h` 待ちが黒画面で固着 →
  待ち中だけ `CPU_FLAG |= I_FLAG`) も入れて quit→タイトル復帰が成立。

## [Phase 3 — コードベース堅牢化 (場当たり実装の解消)] — 2026-05-30

**背景:** 次タイトル (T5 ザルバール) 着手前にコードレビューを実施し、「今は偶然動くが将来の
種になる場当たり実装」を棚卸しして解消した。4 コミットに分割し、各段階で さめがめ (ローダ
全経路) / Super Depth (file I/O・alloc・MML 到達) の回帰確認を実施。挙動は現スイートで等価かつ
より正しい。

**1. パス解決の正規化 (`dos_path_to_host` を case-insensitive リゾルバ化):**
- DOS は大小を区別しない / Emscripten FS (MEMFS) は区別する、というギャップを「JS・C 両側で
  強制小文字化」という場当たりで埋めていた。これを廃止し、**C 側で `/run` からコンポーネント
  単位に実在名へ case-insensitive 解決するリゾルバ**に置換 (`ci_equal`/`ci_lookup`/`read_dos_rel`/
  `resolve_dir`)。**サブディレクトリも保持**。実証: 実体 `SAME.KDT` ↔ ゲーム要求 `same.kdt` を解決。
- 解決状態を返し **MS-DOS 準拠のエラーコード**を付与 (途中ディレクトリ欠→AX=3 path-not-found /
  ファイルのみ欠→AX=2 file-not-found)。MS-DOS は中間ディレクトリを自動生成しない挙動に合わせた。
- JS 側 `extractLzhToFs` は原ケース維持 + サブディレクトリ再現、`clearRunDir` を再帰削除に。

**2. INT 21h AH=44h IOCTL の「嘘成功」是正 + FindFirst 強化:**
- 旧実装は AL≠0 の全 sub-fn を「何もせず CF=0 成功」にしており、レジスタ未設定のまま嘘の成功を
  返す沈黙の誤動作の温床だった。**AL=00/01 のみ正規処理し、それ以外は CF=1/AX=1 (invalid
  function) + ログ**に変更 (失敗の方が切り分けが容易)。
- FindFirst (4Eh/4Fh): **属性マスクを尊重** (通常ファイルは常に返す、ディレクトリは attr&0x10 の
  時のみ)、**DTA に `st_mtime` を FAT date/time 変換して格納** (旧: 0 固定)。

**3. ローダ入口の原理化:**
- **argv[0] を実 image 名から生成** (`A:\<実名>`)。stage 関数に `name` 引数を追加し `g_stage.name`
  に保持。旧 `A:\PROG.EXE` 固定は argv[0] の basename を使うゲームで誤名になる場当たりだった
  (Super Depth のパス導出は切れ目位置が同じため不変)。
- **EXE alloc ベースをヘッダ由来に**: `e_minalloc` を保持し `max(body+e_minalloc, 実スタック頂点)`
  で算出。旧マジック `SS+0x1000` を排除、uint32 計算で overflow も安全に。
- **入口レジスタの正直化**: 出所不明のマジック `CPU_ECX=0xFF` / `CPU_EBP=0x091C` を撤去し、
  規定外レジスタは 0。AX=0 (FCB ドライブ有効) の根拠もコメント明記。

**4. コメント陳腐化修正:**
- トランポリン番地コメントを旧 `0xFFE0/FFD0/FFD8` → 実番地 `0xFEE00/EE10/EE20` に訂正。
- `dos_loader.c` 冒頭の「COM 専用 / env 空」(T1 段階) 記述を現状に更新。
- `bridge.js`: `_malloc(4)` の "1B" コメント訂正、`textVram` 用コメントの誤配置を修正。
- 不要な検証用スクショ (sd_*.png、untracked) を削除。

## [Phase 3 — T4.5: INT 21h ローダの一般修正 3 件 (CF/ZF 復帰・env/argv[0]・close整合)] — 2026-05-29

**背景:** コードレビュー中に発見した潜在バグを修正し、Super Depth (DEPTH100.LZH) で検証。
3 件とも特定タイトル依存ではなく **INT 21h ローダの一般的な正しさ** の修正で、全タイトルに効く。
さめがめ / ロードモナーク / プリンセスメーカー 2 で回帰なしを確認済。

**バグ fix:**

1. **INT 21h の CF/ZF が呼び出し元に返っていなかった** (`native/dos_int21.c`)。
   トランポリンが `F000:EE10 = NOP; IRET` で、IRET が `[SS:SP+4]` から FLAGS を pop して復帰
   するため、ハンドラが `CPU_FLAG` に立てた CF/ZF は破棄されていた (汎用レジスタ返値は無事)。
   NP2kai 純正 BIOS (`bios/bios1f.c:98-100`) と同様、`qb_dos_int21_dispatch` 末尾で **スタック上の
   FLAGS イメージ `[SS:SP+4]` に CF/ZF を書き戻す**よう修正。これがないと `INT 21h; JC error` 形の
   エラー判定や `4Fh` FindNext ループ、`_open` の `JNC` 判定 (Super Depth が依存) が機能しない。
   T1-T4 が正常系のみで CF を踏まなかったため未顕在だった潜在バグ。

2. **env ブロックの空 env で argv[0] が空読みされる** (`native/dos_loader.c::build_env`)。
   空 env (`00 | count | path...`) だと「二重 NUL (00 00) で env 終端を検出」式の C ランタイム
   (Super Depth 等) が最初の `00 00` を path 後ろのゼロ埋め領域に見つけて終端を誤認 →
   count=0 / argv[0]=空 と読む。argv[0] が空だと**自分の実行パスからデータディレクトリを得る
   ゲーム**が破綻 (depth.exe は argv[0] の最後の `\` でディレクトリを切り出し、無いとパス名
   バッファが strcat で累積)。**ダミー変数 1 個 + 二重 NUL 終端 + count + argv[0]** の実機 DOS 風
   レイアウトに修正し、二重NUL検出式・空文字列検出式どちらの cstartup でも argv[0] を読めるように。

3. **close と ioctl の標準ハンドル不整合** (`native/dos_int21.c::int21_3e_close`)。
   `44h IOCTL` は h=0..4 (CON/AUX/PRN) を「常に open の char device」扱いするのに、`3Eh Close`
   は同じ 0..4 を invalid handle と返していた。CF が実際に効くようになった (上記 1) ことで顕在化
   しうるため、close も 0..4 は no-op 成功にして整合を取った。

**Super Depth (DEPTH100.LZH) の到達点:** 上記修正で **全リソース (depth.bgm/scr/fnt/c32/...) の
読込まで到達** (以前はファイル名累積で即死)。ただし起動ロゴ後、**Bio_100% 独自の MML 音楽ドライバ**
内で hang する: 音楽イベント走査ループ (`0xFFFE` 終端の可変長レコードを舐める) が、未コンパイルの
MML バッファ (生 MML には 0xFFFE 無し) を走査して無限ループ。これは INT 21h ローダではなく音楽
ドライバ側の挙動依存で、深い RE が必要なため **既知の追加検証課題** とする (Super Depth LZH は
計画上オマケ扱い、.fdi 版は Phase 2 で動作確認済)。

**デバッグ補助 (恒久):**
- `qbDebug.regs()` (`native/bridge.c::np2kai_debug_get_reg16` + `web/player/bridge.js`) —
  16-bit CPU レジスタ (AX..IP) を一覧。ハング時のレジスタ/セグメント状態の確認に。`int21Stats()`
  と同様の on-demand 調査ヘルパー。

**撤去 (今回の調査用一時計装):** open 呼び出し元/BP チェーン/コードダンプ、read・48h alloc の
逐次ログはすべて除去済。

## [Phase 3 — T4.5 進行中 (INT 21h AH=48h/49h メモリ確保 + MIDI reset 凍結 fix)] — 2026-05-29

**状態:** Super Depth (DEPTH100.LZH) 対応の途中まで。**プレイ可否は未検証**（次セッションで
ロード→動作確認が必要）。今回はメモリ確保 API と、調査中に判明したブラウザ凍結バグの fix までを
コミット可能な状態に整理した。

**追加した INT 21h:**
- **48h Allocate Memory** / **49h Free Memory** — `native/dos_loader.c` の最小 bump allocator。
  loader-start で `qb_dos_alloc_reset()` が image 末尾以降の paragraph を base に設定、上限
  0xA000 (640KB)。49h は no-op 成功 (bump なので巻き戻さない)。Phase 3 の小規模テストでは十分。

**バグ fix (調査中に発見):**
- **MIDI reset → ブラウザ凍結** (`native/qb_commng.c`): リセット時の `COMMSG_MIDIRESET` は
  `midireset()` 内で 16ch × `sound_sync()` を回し、`CPU_CLOCK` 累積状況によって
  `streamprepare()` が大量サンプルを生成 → Wasm でメインスレッドが固まる。我々は実際に MIDI
  出力を使わない (vermouth soundfont 未ロード) ため、2 回目以降の reset での全ボイス停止は
  省略。シングルトン化で dangling pointer は既に解消済なので実害なし。

**デバッグ補助 (恒久):**
- `qbDebug.int21Stats()` / `int21Reset()` — INT 21h の AH 別呼び出し回数を on-demand で集計。
  既存 qbDebug 群と同じくスパムにならない調査ヘルパー。

**撤去 (今回の調査用の一時計装):** `pccore_reset` の段階ログ、`run_frame` のハングプローブ、
INT 21h read の rate-limited ログ、JS の `[BREADCRUMB-*]` 等はすべて除去済。

## [Phase 3 Day 1 — T4 通過 (さめがめプレイ可能、INT 21h 20 fn + dirty-flag 真因解明)] — 2026-05-28

**何が動いたか:** `sam98210.lzh` (さめがめ v2.10 by kyoto & W.Yossy) が **DOS なしで**
LZH → ローダ経由で起動、メニュー → Start Game → カーソルキー移動 + スペースで領域選択 +
領域消去まで**プレイ可能**。Phase 3 ローダの **実ゲーム初通過**。さらに、ゲーム遷移時の
テキスト残留 (ハイスコア表が VRAM に残って透ける) も解決。

**最大の発見 (1日丸ごとハマった真因):**

NP2kai のテキスト面描画は **行単位の dirty-flag 最適化** を持っており、メモリ直書き
(`mem[0xA0000+] = ...`) では dirty が立たず**前フレームのキャッシュが残る**。VRAM の
実状態は空でも画面に「消えるはずのテキスト」が表示され続け、attribute 仕様 (TXTATR_ST,
secret bit) の解釈や ESC[2J 経路を何度も検証してハマった。

→ 解決: `vram_clear_all` と `vram_put_char` で **メモリ直書き直後に
`gdcs.textdisp |= GDCSCRN_ALLDRAW2`** を立てて NP2kai に「次フレーム全行再描画」を通知。
これだけでメモリ実状態と画面表示が一致。

**追加した INT 21h (20 fn):**
- システム: 02h/06h Direct console I/O / 09h / 1Ah Set DTA / 25h/35h Set/Get Vec /
  2Ah/2Ch Get Date/Time / 30h DOS Ver (5.00 を名乗る)
- ファイル: 3Ch Create / 3Dh Open (mode 0/1/2) / 3Eh Close / 3Fh Read / 40h Write /
  41h Delete / 42h Seek (whence 0/1/2)
- 属性/IOCTL: 43h Get/Set Attr / 44h Get Device Info — **h=0..4 (CON/AUX/PRN) 全てを
  char device 扱い** (実機 DOS 互換、最初 h=3/4 で error 返していた)
- メモリ: 4Ah Resize (常に成功扱い、我々は全メモリ保持)
- 終了: 4Ch Terminate
- ディレクトリ: 4Eh Find First / 4Fh Find Next (DTA に書き込み、`/run/` を opendir スキャン)

**追加した実機相当の細部 (どれもさめがめハマりの試行錯誤で発見された):**

- **PC-98 ANSI/ESC パーサ** (`dos_int21.c::tty_putc`): ESC c / ESC * (reset+clear)、
  CSI [n;mH (cursor pos)、[nA-D (cursor move)、[nJ (erase display)、[nK (erase line)、
  [nm (SGR、無視)、`[>nh,l` mode set。**`[>5h/l` は GDCSCRN_ENABLE bit を操作** (PC-98
  console driver 拡張、テキスト面の master ON/OFF)。BIOS の `INT 18h, AH=0Ch/0Dh` と等価
- **未使用 software INT の IRET stub** (`dos_loader.c::qb_dos_loader_start_hook`):
  IVT[0x22..0xFF] のうち 0 のままのエントリを `0xFEE40` の IRET-only stub に向ける。
  これがないと、`INT 33h` (マウスドライバ) を叩いた瞬間に 0:0 にジャンプ → ゴミ命令
  を実行 → 偶然 `CD 20` バイト並びを踏んで INT 20h で exit、という事故が起きる
- **正規 env segment** (`QB_DOS_ENV_SEG = 0x00F0`): cstartup の env scan が暴走しない
  よう `\0\0` + count=1 + `A:\PROG.EXE\0` で最小 env を作って PSP[0x2C] に設定
- **AH=44h IOCTL の char device 判定**: h=0..4 (CON/AUX/PRN) 全てを bit7 set で返す。
  実機 DOS と整合 (一部のゲームの環境検出に使われる)
- **LZH ファイル名 lowercase 化** (`bridge.js::extractLzhToFs`): Emscripten FS は
  case-sensitive、LZH 内ファイル名が大文字でも DOS path 変換 (`dos_path_to_host`) は
  小文字化するので、書き出し側も小文字化して合わせる

**UI 改善:**
- **`■ Stop` ボタン** (`index.html` + `bridge.js`): 実行中 (polling 中) に出現、polling
  を強制停止 + Run ボタン再有効化。長時間ゲームが exit しないと Run 不可能だった問題を解消
- **連打防止 + focus 外し**: Run click 直後に `runButton.blur()` + `disabled = true`。
  これがないと Start Game の Enter キーが Run ボタンの再 click を引き起こして同じ
  EXE が再 stage されてしまう罠

**debug 用 export 追加:**
- `np2kai_debug_get_textdisp/grphdisp` (bridge.c): `gdcs.textdisp/grphdisp` を読む。
  bit 0x80 (GDCSCRN_ENABLE) でテキスト面/グラフィック面の master ON/OFF を確認
- `qbDebug.watchTextdisp(durationSec)` (bridge.js): textdisp 値の時系列変化を観測
- `qbDebug.textVram(nrows)` (bridge.js): テキスト VRAM の中身を ASCII で一覧

**設計判断:**
- **dirty-flag 通知は GDCSCRN_ALLDRAW2 一択**: 行単位 dirty の内部詳細が不明なので
  「全行を次フレーム再描画」フラグで対応。毎 putc で立つので最適化余地はあるが、無害
- **default attribute は 0xE1**: NP2kai の `bios_memclear` も `bios0x18_16(0x20, 0xe1)`
  を呼んでおり実機 BIOS 初期値と同じ。途中 0x00 (secret) で埋める実験もしたが、真因が
  dirty-flag だったので戻した
- **同 .num は削除しない**: 作者本人の sample スコア (kyoto, W.Yossy 等) はゲーム作者の
  意図的な「初回起動を賑やかに見せる」演出なので、これがハイスコア表に出るのは仕様

**残課題 (Phase 3 合格条件外、後回し可):**
- グラフィック VRAM 直書きをする場面が来たら同じ dirty-flag 対応が必要 (`gdcs.grphdisp`)
- INT 21h ログは UNIMPL / open / delete 系のみで静音化済だが、verbose flag 化の余地

**次:** T4.5 (Super Depth LZH = `DEPTH100.LZH`)。VSYNC/Timer IRQ + FM 音源 + 大量データ
read。INT 21h は揃ったので、IRQ 配送と FM port 直叩きが本番。

---

## [Phase 3 Day 1 — T2/T3 通過 (PSP cmdline + MZ EXE ローダ)] — 2026-05-28

**何が動いたか:** 同日中に T2 (PSP cmdline) と T3 (MZ EXE + reloc) を通過。
`args.com` が cmdline 入力 `-k` を画面に `ARGS:[ -k]` (先頭スペース込み) として再現し、
`hello.exe` が 1 件の reloc 適用を経て multi-segment 起動 → `HELLO EXE` 表示 → exit 0。
これで Phase 3 ローダは COM / EXE 両 image 形式に対応、PSP 経由の引数渡しも実装済み。

**T2 (PSP cmdline) で入った変更:**
- **`native/dos_loader.c`** — `stage_cmdline()` ヘルパに切り出し、cmdline が空でなければ
  先頭にスペースを 1 byte prepend (実 DOS の PSP tail 慣例。JS は raw 文字列を渡す前提で
  C 側が正規化)。`build_psp` の PSP[0x80] = 長、PSP[0x81..] = 本体、PSP[0x81+len] = 0x0D
  終端はそのまま
- **`tools/dos_loader/args.com.py`** (52 byte) — `MOV CL,[80h]` → `ADD BX,CX` で
  PSP[0x81+len] (= 0x0D) を `MOV BYTE [BX],'$'` で '$' 上書き → 3 回の AH=09h
  (`ARGS:[` + PSP cmdline + `]\r\n`) → AH=4Ch exit
- **`tools/dos_loader/build.sh`** — args.com もビルド

**T3 (MZ EXE) で入った変更:**
- **`native/dos_loader.h`** — `QB_DOS_EXE_IMAGE_SEG = 0x0110` (= PSP 直後の paragraph)、
  `qb_dos_stage_exe` プロト
- **`native/dos_loader.c`** —
  - `g_stage.buf` を **64KB → 640KB** に拡張 (PC-98 基本メモリ上限と一致、DOS EXE 1 本が
    物理的に取れる最大サイズ)。Wasm .bss なのでランタイムコストは初期化のみ
  - `g_stage` に EXE 用フィールド (`exe_cs/ip/ss/sp`) 追加
  - `qb_dos_stage_exe(image, size, cmdline)` — MZ/ZM 両 magic 許容、ヘッダ整合検査
    (e_cp/e_cblp/e_cparhdr/e_crlc/e_lfarlc の値域確認、エラーコード -3〜-9)、body は
    header strip して staging buf にコピー、reloc は (seg×16+off) の word に
    `QB_DOS_EXE_IMAGE_SEG` を即時加算
  - `qb_dos_loader_start_hook` を kind で COM/EXE 分岐。COM は従来通り 0x0100:0x0100、
    EXE は `image_base_seg:0` に body コピー + `CS = image_base + e_cs`, `IP = e_ip`,
    `SS = image_base + e_ss`, `SP = e_sp`、DS/ES は両者とも PSP セグメント
- **`native/bridge.c/h` + `native/CMakeLists.txt`** — `np2kai_dos_stage_exe` を export
- **`web/player/bridge.js`** — `dosStageExe` cwrap、`stageAndRunCom` → `stageAndRunImage(isExe)`
  に統一、`handleRunDrop` の拡張子マップに `.exe` 追加
- **`tools/dos_loader/hello.exe.py`** (76 byte) — 32B MZ ヘッダ + 44B body (18B コード +
  14B NOP padding + 12B "HELLO EXE\r\n$")。reloc 1 件 (body off=1, seg=0) で
  `MOV AX, 0002h` の immediate を image_base 加算 → DS=0x112 で MSG 参照

**副次バグ修正 (T3 検証時に発見):**
- **`native/dos_int21.c/h`** — `g_cur_row/col` が `static` で `pccore_reset` を跨いで残り、
  連続実行のたびに画面が 1 行ずつ下にズレるバグ。`qb_dos_tty_reset()` を export し、
  `loader_start_hook` の PSP 構築直後で毎起動ごとに (0,0) へリセット
  (BIOS POST は VRAM 自体は clear するが、我々の C 側 cursor は独立なので明示リセットが必要)

**設計判断 (この回で確定):**
- **staging buffer = 640KB**: PC-98 基本メモリの物理上限 (0x00600-0x9FFFF) と一致。これ以上
  大きな EXE は DOS でも素直にロード不能なので、原理的な上限値。Wasm 線形メモリ余裕あり
- **EXE image base segment = 0x0110**: PSP セグメント (0x0100) の 256 byte 直後 = 16 paragraphs
  先。実 DOS の慣例通り
- **cmdline 先頭スペースは C 側で付与**: JS は raw 文字列を渡し、C 側 `stage_cmdline` が
  prepend。args.com / 実タイトル両方で一貫した PSP tail を保証 ([[feedback-dos-loader-trampoline]])

**次:** T4 (さめがめ `-k` keyboard モード、sam98210.lzh)。INT 21h でファイル read 系
(3Ch/3Dh/3Eh/3Fh/40h/42h)、メモリ系 (48h/49h/4Ah)、システム系 (25h/2Ah/2Ch/30h/35h)、
属性/IOCTL (43h/44h) の実装が控える。Super Depth (T4.5) で 43h/44h は確実に必要。

---

## [Phase 3 Day 1 — T1 通過 (最小 COM ローダのフルチェーン)] — 2026-05-28

**何が動いたか:** PC-98 用の最小 COM 実行ファイル (`hello.com` 28 byte) が **DOS なしで**
ブラウザで起動・実行・終了。画面に `HELLO PHASE3`、ステータスに `exit code=0`。
これは Phase 3 ローダ機構の **最小チェーン全工程が初めて通った** マイルストーン。

**仕組みの肝 — DOS の再現ではなく "DOS のフリ":**
- guest 内には DOS のコードは **1 行もない** (8 byte の boot sector のみ)
- INT 21h ハンドラは **エミュレータ側 C 言語で実装** (NP2kai の NOP→biosfunc フック機構を流用)
- COM ファイルは「DOS で動いているつもり」だが、実体は C 関数が応答

**追加:**
- **`native/dos_loader.c/h` + `native/dos_int21.c/h`** (合計 ~310 行) — 主要 API:
  - `qb_dos_stage_com(image, size, cmdline)` — JS から呼ぶ image ステージング
  - `qb_dos_loader_start_hook()` — 0xFEE00 で発火、PSP 構築 + image コピー + CPU 状態書換
  - `qb_dos_int21_dispatch()` — 02h/09h/4Ch を実装 (text VRAM 風 tty 出力付き)
  - `qb_dos_install_trampolines()` — `bios_initialize` から呼ばれて BIOS area に NOP プリインストール
  - `qb_dos_get_exit(code_out)` — JS の polling 用
- **`tools/dos_loader/`** — `boot.asm` (8 byte 自己起動、F000:EE00 へ far jmp) +
  `make_d88.py` + `hello.com.py` (T1 テスト用 COM 合成) + `build.sh`
- **`tools/np2kai_patches/01_dos_loader_hooks.patch`** — NP2kai サブモジュール改変
  (bios.c: extern decl + `qb_dos_install_trampolines` 呼び出し + biosfunc switch case 3 個)。
  `emscripten/build.sh` が未適用なら自動 apply
- **`web/assets/loader.d88`** — 1.3MB の 2HD ブートディスク (boot sector に 8B、残りゼロ)
- **`web/index.html`** — `.com`, `.exe` を accept リストに追加
- **`web/player/bridge.js`** に COM 直接実行経路 (`stageAndRunCom`) — ヒープに転送 → stage →
  loader.d88 を A: に挿入 → reset → 100ms polling で exit 検知 → ステータス更新
- **`native/bridge.c/h`** に export 2 つ: `np2kai_dos_stage_com`, `np2kai_dos_get_exit`

**実行フロー (動作確認した):**
1. boot sector (1FC0:0) → `CLI; JMP FAR F000:EE00`
2. 0xFEE00 の NOP → `ia32_bioscall` → `biosfunc(0xFEE00)` → `qb_dos_loader_start_hook`
3. IVT[0x20/0x21] 設置 + PSP 構築 + image コピー + CS:IP/SS:SP 書換
4. CPU が 0x0100:0x0100 から hello.com 実行
5. `INT 21h` → IVT[0x21] → F000:EE10 → NOP → `biosfunc(0xFEE10)` → `qb_dos_int21_dispatch`
6. AH=09h → DS:DX を '$' まで text VRAM へ + stderr
7. AH=4Ch → `qb_dos_signal_exit(code)` → CS:IP を F000:EE30 (HLT;JMP -3) に飛ばして停止

**設計の罠と対処:**
- **トランポリン番地の linear address 計算** — F000:EE00 = `(0xF000<<4)+0xEE00` = **0xFEE00**
  (segment×16+offset)。最初 case `0xFFE0` (= offset のみ) としていて hit せず詰まった
- **既存 BIOS RAM の予約区域** — `0xFD800-0xFEC37` (biosfd80.res)、`0xFFFE8/0xFFFEC`
  (bootstrap NOP+RETF)、`0xFFFF0` (reset vector) — 全て避けて `0xFEE00-0xFEE32` に配置
- **ニワトリ卵問題** — 「NOP が踏まれたら biosfunc が発火」のフックなので、最初の NOP は
  guest が踏む前に存在していなければならない。フック内で NOP を書く設計だと永遠に発火しない。
  → `bios_initialize` (毎リセット呼ばれる) で `qb_dos_install_trampolines()` を呼んで pre-install
- **終了処理** — INT 21h AH=4Ch では「DOS なら program に戻らず」だが、エミュ側で CS:IP を
  HLT ループに書き換えるだけで停止できる。`LOAD_SEGREG` が `ia32_bioscall` 末尾で自動実行されるので
  `CPU_CS`/`CPU_IP` への代入だけで CPU が次サイクルから新番地へ飛ぶ

**規模:** guest 側 asm = 8 byte、C 側 ~310 行、NP2kai 改変 = 6 行 (patch 化)、JS 配線 ~50 行。
FreeDOS をブート完走させる路線と比べ「BIOS ホール `E869:075B` のような未実装 BIOS 番地に
飛び込んでハング」のリスクが構造的にゼロ (我々は INT 21h と loader-start しか踏まない)。

**次:** T2 (PSP cmdline 検証) → T3 (MZ + reloc) → T4 (さめがめ) → T4.5 (Super Depth LZH) → T5 (ザルバール)。
INT 21h の追加実装が必要なのは {25h/2Ah/2Ch/30h/35h/3Ch/3Dh/3Eh/3Fh/40h/42h/**43h**/**44h**/48h/49h/4Ah}。

---

## [Phase 3 Day 0 完了 — LH5 / ZIP-deflate / VSYNC IRQ / Run UI] — 2026-05-27

### 追加 (Day 0c — VSYNC IRQ 配送パス確認)
- **`tools/vsync_test/boot.asm` + `vsync_test.d88`** — 1024 byte 自己起動。
  IVT[0x0A] (IRQ 2 / CRT VSYNC) に独自 ISR を仕込み、master IMR の bit2 解除、
  port 0x64 OUT で `gdc.vsyncint=1` を arm、ISR 内で text VRAM にカウンタを 8 桁
  16 進で表示しつつ port 0x64 を再叩きして次の VSYNC を arm。56Hz でカウンタが
  回ることをユーザが目視確認 → **NP2kai の VSYNC IRQ 配送経路は健全**、Phase 3
  ローダで rabbit (KEY/VSYNC 占有) を狙う前提が成立
- NP2kai 側コード調査の memo: VSYNC IRQ は `pccore.c:1646 pic_setirq(2)` で `screenvsync`
  内発火、有効化は port 0x64 への OUT で `gdc.vsyncint=1`、PC-98 master 8259 EOI は
  port 0x00 へ OCW2=0x20

### 追加 (Day 0a — LH5 デコーダ)
- **`web/player/archive.js`** — LZH アーカイブパーサ + LH5/-lh0- デコーダ (~250 行)。
  Okumura/Yoshizaki リファレンスを参考に PT-len / C-len / NP の Huffman 木を再帰
  オブジェクトで構築、8KB sliding window + LZ77 一致コピーで復元。Level 0/1 ヘッダ
  対応、`-lh5-` (LZSS+動的 Huffman) と `-lh0-` (stored) のみカバー。libarchive.wasm を
  引かない決定 (テスト 5 本の LZH が全て -lh5-/-lh0- のみと判明したため)
- **`tools/lh5_test.js`** — node 上で `parseLzh` を実行、`lha xq` 出力と
  byte-by-byte 比較する検証スクリプト。**4 アーカイブ全 39 ファイルで完全一致**
  (rabbit31 ×2, sam98210 ×12, zarfw ×5, ray_iv2a ×20)
- **LZH Level 1 ヘッダの ext chain 罠を解明** — basic header の末尾 2 byte が
  「最初の ext header のサイズ」(LE)、各 ext header の末尾 2 byte が次の ext size。
  最初これを誤って「basic 直後に独立した ext-size フィールド」として読み、データ
  領域を ext header と解釈してエントリ 1 個目しか取れなかった (修正済)

### 追加 (Day 0b — ZIP-deflate)
- **`parseZip(bytes)` async** (`web/player/archive.js`) — Local File Header チェーン
  パーサ + `DecompressionStream('deflate-raw')` で展開。method 0 (stored) と
  method 8 (deflate) 対応、ZIP64 / encrypted / data descriptor (bit 3) は throw
- **ブラウザ本体 API (DecompressionStream) を採用** — 追加バンドル 0KB、Chrome/Firefox/
  Safari 全て対応 (Chromebook 想定で問題なし)。fflate vendoring せず、INFLATE 自前
  実装もせず。LH5 を自前で書いた方針との非対称性は意図的 (deflate は LH5 と違って
  複雑な codec で、ブラウザ本体が用意してくれているなら使うのが筋)
- **Super Depth zip → .fdi 復元検証** — `parseZip` を node 上でも実行 (Node 20 は
  DecompressionStream を global で持つ)。1,265,664 byte の .fdi が byte-perfect 一致

### 追加 (Run スロット UI)
- **`web/index.html`** — A:/B:/C:/D: の横にオレンジ系の Run スロット (.lzh/.zip 投入用)。
  下に「Title / Entry / Args / ▶ Run / status」の run-config 行 (デフォルト hidden、
  ドロップ時に表示)。`accept` リストに `.lzh,.zip` 追加
- **`web/player/bridge.js`** Run 処理 — Run スロットへの D&D・クリック・ファイル選択を
  既存ドライブ経路と分離。`db/games.json` を fetch して file.name でルックアップ、entry/
  cmdline を pre-fill。Run ボタン:
  - kind=`lzh`: `parseLzh` → `/run/{filename}` に Emscripten FS で書き出し
  - kind=`zip-fdi`: `parseZip` → `.fdi` を抜いて `new File(...)` でラップ → 既存の
    `loadDiskFromBlob(file, 'fdd', 0)` 経路に流す (Phase 2 動作確認流儀)
- **`qbDebug` 拡張** — `ls('/run')`, `read(path)`, `readSize(path)`, `fs` (raw M.FS) を
  追加。DevTools コンソールから展開ファイルを確認できる

### 追加 (data / scaffolding)
- **`db/games.json`** — テスト 5 本 + Super Depth の `{title, kind, entry, cmdline, notes}`
  を populate。kind は `lzh` (Phase 3 ローダ経路) / `zip-fdi` (Phase 2 FDD 経路)
- **`web/db`** → `../db` シンボリックリンク — emrun が `web/` を serve するので
  `db/games.json` をフロントから fetch できるようにする。canonical な場所は root の `db/`

### Phase 3 Day 1-2 設計策定 (TODO.md に取り込み)
- **トランポリン機構**: NP2kai 既存の「NOP @ BIOS 領域 → `ia32_bioscall` → `biosfunc(adrs)`」
  を再利用 (USE_CUSTOM_HOOKINST 不要)。`bios.c:biosfunc()` の switch に case 追加するだけ
- **空き BIOS 領域 0xFE000〜** に NOP+IRET のペアを配置:
  `0xFE00:0000` = INT 21h dispatcher、`0xFE00:0010` = INT 33h、`0xFE00:0080` = ローダ起動
  フック (CS:IP/PSP セット用)
- **モジュール分割**: `native/dos_loader.c/h` (MZ/COM + PSP), `native/dos_int21.c/h`,
  `native/dos_int33.c/h`, `tools/dos_loader/boot.asm` (ブートストラップ)
- **検証順 T1〜T5**: 自作 hello.com → args.com → hello.exe → same.exe `-k` → zar.exe マウス

---

## [Phase 3 計画精緻化 — 中身調査と Super Depth 確定] — 2026-05-27

### 追加
- **`.fdi` を `web/index.html` の `accept` リストに追加** — Super Depth (Bio 100%) の
  `.zip` 内に入っていた 1.21MB の標準 PC-98 2HD FDI ディスクイメージを、既存 Phase 2
  FDD 経路で読めるようにした。NP2kai は `np2_isfdimage()` で `.fdi` を検出済、
  `fdd_set(FTYPE_NONE)` の自動判定でそのまま通る。Wasm 変更なし、リロードのみで反映
- **テストスイート 5 本のアーカイブ中身調査** — `lhasa` + `unar` + `unzip` で全本展開、
  以下を確定:
  - 全本 **MZ/COM 形式**、**DOS Extender 不使用** (DOS/4G, PMODE, GO32, DPMI 全て陰性)
  - **Super Depth (.zip → .fdi)** は Phase 3 ローダ不要、既存 Phase 2 経路で動作確認済
  - **さめがめ** (sam98210.lzh): `mouse.sys` 互換ドライバ経由 (INT 33h)、`-k` で
    keyboard fallback、PSP cmdline 必須
  - **ザルバール** (zarfw.lzh): マウスドライバ不要 (PC-98 native I/O `0x7FD9` 直叩き)、
    Turbo C++ + NASM + ANNEX runtime 製、INT 18×31 / INT DC×3 と PC-98 BIOS 使用多
  - **うさちゃん列車** (rabbit31.lzh): **KEY/VSYNC 割り込み占有 + 裏 VRAM** (doc 明記)、
    BEEP 音源のみ、`rabbit.com` 単体実行
  - **Ray IV** (ray_iv2a.lzh): `rin.com` は **常駐音源ドライバ (TSR)** → INT 21h AH=31h
    Keep Process 要、ただし `rin.com` 無しでも BEEP フォールバック起動可と doc に明記
- **`games/` ディレクトリ** に 6 つのアーカイブを集約 — 元はリポジトリ root に散乱
  していた `*.lzh` / `*.zip` / `*.rar` を `games/` 配下に `git mv`
- **`.gitignore`** に `/games/*.fdi` 等の derived エントリ追加 — 元アーカイブ
  (`.zip` / `.lzh`) はコミット済なので、展開後のディスクイメージはローカル成果物扱い

### 変更 (TODO.md Phase 3 計画)
- **テストスイート表に「経路」列追加** — Super Depth は **Phase 2 FDD 経路**、
  残り 4 本 (さめがめ / ザルバール / うさちゃん列車 / Ray) が Phase 3 ローダ対象、
  と明文化。Phase 3 ローダの実装スコープが実質 4 本に縮小
- **INT 21h 最小セットに `31h Keep Process` 追記** — Ray の `rin.com` TSR install 用、
  ただし +α 扱い (BEEP フォールバック起動を Phase 3 合格条件に)
- **`含むもの` に LZH/ZIP 両対応を明記** — `libarchive.wasm` 1 ライブラリで両対応
  (元計画は LZH のみ、ZIP は Super Depth から判明、RAR は Super Depth 2 除外で不要化)
- **`主な技術選択` に PSP `80h` cmdline UI 入力を追加** — `same [-options] [datfile]` /
  `zar [FILE]` で必須なので、ローダ UI 側に起動引数欄を用意する方針
- **Day 0 に「IRQ 配送 (VSYNC) パス事前確認」追記** — rabbit が動かないと「ローダの
  バグか IRQ パスのバグか」切り分けが面倒なため、bridge 経由で NP2kai 既存 IRQ 経路に
  ベクタ書き込みが届くかを Phase 3 着手前に確認
- **リスク表を調査済マークで更新** — DOS Extender / MZ 以外形式 / マウス方式の各リスクが、
  事前調査で全てクリアまたは方針確定したので「**調査済**」と注記
- **Phase 3 完了の定義を「ローダ 4 本中 3 本 + Super Depth 動作確認」に修正** — Super
  Depth は B1 で先行確認済なので合格条件としてはオマケ、ローダ 4 本のうち 3 本動けば
  Phase 完了とする (元定義は「5 本中 4 本」)

### 除外 (Phase 3 ターゲット)
- **Super Depth 2 Finalty (.rar)** — Bio 100% 製の続編。オリジナル Super Depth (.zip
  → .fdi) で代替できるため Phase 3 のテストスイートから除外。RAR 展開ライブラリも
  Phase 3 スコープから外せる副次効果あり。`.rar` 自体は `games/` に保持

---

## [HDD スロット配線] — 2026-05-27

### 追加
- **`np2kai_insert_hdd(handle, path, drive)`** (`native/bridge.c/h`) — SASI/IDE HDD を
  ランタイムでマウント。`np2cfg.sasihdd[]` / `np2cfg.idetype[]` に書き込んだ上で
  `sxsi_setdevtype` + `sxsi_devopen` を直接呼ぶ二段構え (config に残せば次回 reset
  時の `diskdrv_hddbind` で自動再 bind、その場で開けば現セッションでも有効)。
  `np2kai_eject_hdd` も対で追加
- **C: / D: ドライブ UI** (`web/index.html`, `web/player/bridge.js`) — `.drive` 要素に
  `data-kind="hdd"` を導入し、`setDriveName(kind, drive, name)` でスロットを識別。
  `loadDiskFromBlob` が kind 引数で FDD/HDD を分岐。HDD は挿入後に常に reset
  (BIOS が POST 時に HDD を読むため後付け不可)
- **対応フォーマット** — sxsihdd.c の自動判定 (HDI/THD/NHD/HDD raw) に丸投げ。
  `file-input` の accept にも追加

### 既知の問題 (持ち越し)
- **DOS 系 HDD イメージは未起動の見込み** — MS-DOS (PC-98) / FreeDOS をインストール
  した HDD は、FDD の FreeDOS と同じく `E869:075B` 付近の BIOS ROM `neccheck` 領域に
  飛び込んで暴走する可能性が高い (NP21 系の BIOS 拡張ハンドラ不足)。実イメージでの
  検証と `qbDebug.sample()` での PC サンプリングが再開時の第一歩。回避策は実機
  `bios.rom` 持ち込み or `nosyscode` 拡張。TODO の将来課題参照

---

## [音質・テンポチューニング] — 2026-05-27

### 変更
- **エミュレータ駆動を wall-clock 56Hz catch-up に** (`web/player/bridge.js`) —
  従来は rAF 1 回 = `pccore_exec` 1 回だったため、120Hz ディスプレイで倍速、
  低速機で rAF 遅延 → tempo スロー、という二重の症状があった。新方式は経過時間
  分の emu step を最大 3 step/rAF までキャッチアップし、描画は rAF rate のまま。
  PC-98 24kHz mode の vsync = 56.42Hz に合わせて TARGET_HZ=56 採用
- **RGB565→RGBA32 を LUT 化** (`web/player/bridge.js`) — 65536 エントリの
  Uint32 LUT で per-pixel ビット演算を 1 回テーブル引きに置換。256K iter/frame
  の主スレッド負荷を 5-15ms → 1-2ms に短縮、`pumpAudio` の間隔安定化に寄与
- **ソフトクリップ導入** (`native/qb_soundmng.c`) — `qb_soft_clip()` 関数で
  |x| ≤ 24576 は線形 pass-through、超えた分は ±32767 へ漸近。ハードクリップの
  角がストン特有の高調波歪みを抑制
- **マスター音量 100→65 + FM エンジン opngen 切替** (`native/bridge.c`) —
  低音域で残っていた「ビリビリ」歪み対策。fmgen (デフォルト、cisc.cs C++ ライブラリ)
  は実機 OPNA を精密再現する分、低音 FM チャネルの位相干渉やオーバーサンプリング
  量子化で歪みが乗りやすい。`np2cfg.usefmgen=0` で opngen (NP2 オリジナル、
  理想化合成) に切替し、角の取れた音色を採用。実機至上主義者には別途 runtime
  トグルを将来提供する想定

---

## [Phase 3 着手 → 配線止まり] — 2026-05-26

### 追加
- **MIDI (VERMOUTH + freepats) 配線一式** — MPU98II → cmmidi → VERMOUTH →
  `sound_streamregist` の経路を構築。`np2kai_enable_midi(1)` で有効化可能だが、
  JS 側 UI は出していないため既定では OFF (従来挙動と同一)
- **`tools/setup_freepats.sh`** — `/usr/share/midi/freepats` (Debian/Ubuntu の
  `freepats` パッケージ) から `web/assets/freepats/` に展開、`index.json` を生成
- **`native/qb_vermouth.c`** — `midimod_create` + `midimod_loadall` のラッパ。
  `MIDIMOD vermouth_module` を sdl/cmmidi.c に提供
- **`commng` シングルトン化** (`native/qb_commng.c`) — `mpu98ii_reset` が
  pccore_init / pccore_reset 等で複数回呼ばれるたびに cmmidi_create +
  sound_streamregist が走る。NP2kai には sound_streamregist の解除 API が無く、
  旧 hdl への dangling pointer が cb 配列に残り `midiout_get` で free 済み
  メモリにアクセス → 他音源 (FM 等) にメモリ破壊で「ビリビリ」歪み。MPU98II 用
  COMMNG をシングルトンにして cmmidi_create を 1 回だけに留めることで解消
- **POSIX `chdir(s_data_dir)`** (`native/bridge.c`) — `file_setcd` は NP2kai
  内部の curpath だけ更新するが、`fopen` 等の libc 関数は OS の cwd を見るので
  整合せず、VERMOUTH の `inst_create` が `freepats/Tone_000/...` を `/` 直下に
  探して全失敗していた問題を修正

### 既知の問題 (Phase 3 持ち越し)
- **音質「ビリビリ」歪み** — VERMOUTH の出力は単体テストで妥当 (`peak ~5000`、
  ピアノ的エンベロープ)、楽器ロードも freepats 128/128 成功。だが FM 音源との
  合算で歪みが出る。Pixel 10 でも同症状のため ChromeOS の Audio (CRAS) は無罪。
  原因候補は (a) freepats のサンプル品質、(b) 加算時のクリップ歪み、
  (c) `midiout_get` 内部の preparepcm の副作用 (no-op で症状消失)。
  再開時の選択肢: VERMOUTH 出力減衰調整 / eawpats 差し替え / JS SoundFont 切替
- **プリメ 2 で MIDI 検出されず** — `mpuopt=0` (IRQ 3) も `mpuopt=2` (IRQ 6 =
  PC-98 「INT2」表記) も MPU port write 0 件で、ゲームから MIDI 無しと判定。
  マニュアルに「FM のみなら音源選択メニュー無し」とある通り、メニュー非表示
  自体がそのサイン。検出経路は MPU port のステータスだけでなく、BIOS の
  音源 ID 領域や別の I/O port にあると推測。再開時は全 port read のログから
  特定する想定

### 調査メモ (再開時の参考)
- `sdl/cmmidi.c` 内 `vermouth_getpcm` の `pcm[i] += ptr[i] >> 1` (出力半減)
  では「ビリビリ」改善せず → 単純なクリップ抑制では不十分
- `vermouth_getpcm` 全体を no-op (`return;`) にすると FM のノイズが大幅減
  → `midiout_get` 経由で何か副作用がある (具体的には未特定)
- `file_attr` (sdl/dosio.c POSIX 経路) は stat 失敗時も `attr=0` を返す
  バグがあり、`midimod_getfile` が誤って「ファイルあり」と判定 → `_file_open`
  で本当に開けず楽器ロード全滅、という症状の調査で気付いた
- `cmmidi_create` を 1 回に絞ったあとも、それでも残るのが現在の歪み。次の
  原因切り分けは「`midiout_get` が voice all free 時にも何か内部状態を持つ」
  仮説の検証から

---

## [Phase 2 進行中] — 2026-05-25

### 達成
- **サウンド品質向上 (AudioWorklet 移行)** — ScriptProcessorNode から AudioWorklet + postMessage 方式へ移行。別スレッド再生によりメインスレッドジャンクの影響を受けず、微ノイズ・途切れを大幅削減 (実機聴感で確認)
- **FM 音源が鳴る** — プリンセスメーカー 2 で BGM/効果音を確認、テンポはほぼ正しい
- **2 枚組ゲームが動作** — プリンセスメーカー (.d88 ×2) / プリンセスメーカー 2 でディスプレイ選択 → 名前入力 → オープニング進行確認、CG も綺麗に表示
- **A:/B: 2 ドライブ対応 UI** — スロットごとに D&D / クリックでロード、B: は挿入時リセットなし (ゲーム中のディスク差し替え対応)
- **実 PC-98 ゲームがプレイ可能に**🎉 — ロードモナーク (.d88) がディスプレイ選択 → タイトル → ゲーム本体まで完走、実機相当の速度でキャラクター動作確認
- **マウス入力対応** — Pointer Lock API + 相対移動、ブラウザのクリック判定をそのまま PC-98 マウス I/F に流す
- **ディスクの D&D / ファイル選択 UI** — 任意の .d88 をブラウザにドロップ or クリックでロード
- **PC-98 自己起動ディスクが正しく動作** — `tools/boot_hello/np2kai_boot.d88` をブートし、テキスト VRAM に "HELLO NP2KAI" を 8x16 ネイティブグリフで表示
- **i386 + FPU まで CPU エミュレーション拡張** — i286c → i386c (NP21) へ移行
- **標準キーボード入力**を実装 (英数, 記号, 矢印, F1-F10, テンキー)
- **ピクセルパーフェクト表示**を実現 (非整数 dpr 環境でも 1 ソース px = N 物理 px)

### サウンド対応 (`native/qb_soundmng.c`, `native/qb_soundmng.h`, `native/bridge.c/h`, `web/player/bridge.js`, `web/player/audio-worklet.js`)
- `qb_soundmng.c` のスタブを実装に置き換え、内部リングバッファ (16384 ステレオフレーム) で PCM を蓄積
- `soundmng_create` で NP2kai の sound.c に samples/block を返す、`soundmng_sync` で sound_pcmlock の SINT32 を saturation → SINT16 に変換してリングへ
- ブリッジ: `np2kai_set_audio_rate(rate)`, `np2kai_audio_drain(dst, max_frames)`, `np2kai_audio_get_rate()`
- Web 側は AudioContext を `sampleRate: 48000` でリクエスト、得られた rate を np2kai に伝えて整合
- **AudioWorklet (`audio-worklet.js`) で別スレッド再生**: Worklet 内部に Float32 ステレオリング (~680ms) を持ち、メインスレッドから 1 rAF ごとに Wasm リングを drain → `postMessage(Int16Array, [transferable])` で送る。SharedArrayBuffer 不使用なので COOP/COEP 不要
- 旧 ScriptProcessorNode 構成からの移行で micro-underrun に起因する微ノイズ・途切れが大幅改善 (実機聴感で確認)
- キャプチャ / ファースト操作で AudioContext を resume (オートプレイ規制対応)

### マウス入力 (`native/qb_mousemng.c`, `native/qb_mousemng.h`, `native/bridge.c/h`, `web/player/bridge.js`)
- `qb_mousemng.c` のスタブを実装に置き換え、`mouseif_sync` から呼ばれる `mousemng_getstat()` に応答
- ボタン状態は uPD8255 ビット (`LEFT=0x80`, `RIGHT=0x20`、0=押下)
- ブリッジ: `np2kai_mouse_move(dx, dy)` / `np2kai_mouse_button(button, down)`
- Web 側は canvas クリックで Pointer Lock 取得、`movementX/Y` を CSS px → source px に再スケールして転送
- ESC 解除時はボタン状態を強制リセット (スタックボタン防止)
- これによりロードモナーク (.d88) がマウス認識を経てディスプレイ選択画面→タイトル→ゲーム本体まで完走

### ディスク差し替え UI (`web/index.html`, `web/player/bridge.js`, `native/bridge.c/h`)
- `np2kai_reset()` ブリッジ追加 — `pccore_reset()` で新ディスクからブートし直し
- A:/B: 各スロットを独立した drop zone / ファイル選択ボタンに分離
- ドライブごとのドラッグオーバー時に枠ハイライト (`.dragover` クラス)
- A: 挿入時のみリセット (新規ブート想定)、B: は挿入のみ (ゲーム中差し替え想定)
- ロードファイルは衝突回避で `/tmp/disk_<seq>_<name>` に書き、`np2kai_insert_fdd` → (A: なら `np2kai_reset`) の順
- スロット外へのドロップはブラウザ既定 (ファイル open) を抑止

### 表示パイプライン改善 (`web/index.html`, `web/player/bridge.js`)
- PAR (5:6) 補正を撤去 → 4:2.5 表示で完全な整数倍スケーリングへ
- `box-sizing: border-box + 1px border` による subpixel 縮約バグ修正 (border → outline)
- 非整数 dpr (Chromebook の 1.25 等) を物理画素グリッドに合わせ込む `fitCanvas()` 実装
  - bitmap = source × N, css = bitmap / dpr, physical = css × dpr = bitmap
  - 1 ソース px = N 物理 px の完全整数倍に着地

### キーボード入力 (`native/bridge.c/h`, `web/player/bridge.js`)
- `np2kai_key_down(handle, pc98_keycode)` / `np2kai_key_up(...)` の C ブリッジ追加
- `KeyboardEvent.code` → PC-98 NKEY_* 位置ベースマップ (~100 キー)
- オートリピート抑止、フォーカス喪失時の全キー解放
- PC-98 固有キー (XFER, NFER, KANA, GRPH, HELP, COPY, STOP, VF1-5) は未対応、TODO に記録

### CPU エミュレータ切替 i286c → i386c (NP21) (`native/CMakeLists.txt`, `native/compiler_base.h`, `native/qb_sysmng.c`)
- 動機: 386+ 命令を使う近代 PC-98 ソフト (FreeDOS, 多くのゲーム) で `i286c` が INT 6 (invalid opcode) を発火する問題を解消
- `i386c/*.c` + `i386c/ia32/*.c` + `ia32/instructions/*.c` + FPU + SIMD スタブをビルドに追加
- インクルードパスを `i386c/` 系へ拡張
- 必要 defines: `CPUCORE_IA32`, `IA32_REBOOT_ON_PANIC`, `IA32_PAGING_EACHSIZE`, `SUPPORT_PC9821`, `SUPPORT_PEGC`, `SUPPORT_LARGE_MEMORY`, `SUPPORT_PC9801_119`, `SUPPORT_IDEIO`, `SUPPORT_IDEIO_48BIT`, `SUPPORT_GAMEPORT`, `SUPPORT_CRT31KHZ`, `USE_TSC`
- `compiler_base.h` に `MEMORY_MAXSIZE` 定義を追加
- `qb_sysmng.c` に `sysmng_updatecaption` スタブを追加 (fdd/sxsi.c から参照)
- SIMD (MMX/SSE/3DNow) は `USE_*` を立てずにコンパイルのみ → 実行時は UD_EXCEPTION

### FPU エミュレータ有効化 (`native/CMakeLists.txt`)
- 動機: 386 切替後、FreeDOS が `FADD ST(0), ST(1)` (`D8 C1`) に遭遇して NM_EXCEPTION (#NM) を吐き、ハンドラ未登録の FreeDOS が IRET で同じ命令へ戻る永久ループに
- `fpemul_dosbox2.c` (DOSBox2 系 FPU エミュレータ) を追加
- defines: `USE_FPU`, `SUPPORT_FPU_DOSBOX2`

### 自己起動デモディスク (`tools/boot_hello/boot.asm`)
- **DS レジスタ初期化を追加** ← 「文字化けに見えた症状」の真因。ブート直後の DS は不定 (通常 0) で、IVT を msg バッファとして読んでいた
- INT 18h, AH=0Ah (テキストモード 80x25 ANK 8x16) と AH=0Ch (表示有効化) 呼び出しを追加
- これで PC-98 BIOS POST 直後の状態でも text VRAM に正しく書き込めるようになった

### デバッグ API (`native/bridge.c/h`, `web/player/bridge.js`)
- `np2kai_debug_get_pc/get_cs/get_linear_pc/peek8/get_gdc_mode1` の C 側関数群
- JS から `window.qbDebug.cs() / linear() / pc() / sample(n, ms) / dump(addr, n) / dumpHere() / gdcMode1()` で呼び出し可能
- ハング地点の特定（FPU 永久ループ、DS バグ）に決定的な役割を果たしたので、ランタイム残置

### 既知の問題
- **FreeDOS(98) は完走しない**: NP21 系の BIOS 拡張ハンドラが我々の `nosyscode` ベース最小 BIOS に揃っておらず、`E869:075B` (BIOS ROM の NEC 著作権文字列領域) に飛び込んで暴走。実機 `bios.rom` 供給か、`nosyscode` 拡張で解決可能だが当面は据え置き。Phase 2 のゴールは自己起動ゲームディスク優先

---

## [Phase 1 Wasm] — 2026-05-24

### 達成
- **FreeDOS(98) がブラウザ上で起動** — NP2kai Wasm版の動作を確認

### 主な変更
- プロジェクトをAndroid/Flutter/NDK構成からWebAssembly/Emscripten構成へ全面移行
- `core/np2kai/` にサブモジュールを移動（旧: `native/np2kai/`）
- `native/CMakeLists.txt` をEmscripten専用に書き直し
  - `add_executable`（Wasm出力）、MODULARIZE=1、EXPORTED_FUNCTIONS設定
- `native/bridge.c` — JS↔C ブリッジAPI実装
  - `np2kai_create/destroy/run_frame/get_framebuffer/insert_fdd`
  - `fdd_set()` 直接呼び出しで `fdc.equip` ガードと20フレーム遅延をバイパス
- `web/index.html` + `web/player/bridge.js` — ブラウザフロントエンド
  - Emscripten FS経由でディスクイメージをロード
  - RGB16 (5-6-5) → RGBA32変換してCanvasに描画
- `emscripten/build.sh` — ローカルビルドスクリプト
- `tools/img2d88.py` — PC-98 2HD raw .img → .d88 変換ツール
- `web/assets/boot.d88` — FreeDOS(98) 2HDディスクイメージ

### 環境
- Emscripten 3.1.69（`apt install emscripten`、aarch64 Crostini上でネイティブ動作）

---

## [Phase 1 Android] — （破棄）

Android/NDK/Flutter構成で進めていたが、WebAssemblyへ方針転換。
Flutter関連ファイル（android/, lib/, pubspec.yaml等）を削除。
