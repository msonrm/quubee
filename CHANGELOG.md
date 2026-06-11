# CHANGELOG

## [合成 SFT 実装 — TH03 夢時空の GAME.BAT ハング (pmd86 install-check) を根治] — 2026-06-11

**症状**: TH03 夢時空 (`yume_ts2.exe`) を SFX 展開 → GAME.BAT 起動すると、errorlevel 分岐で選ばれる
:ong4 枝の `pmd86.com /M8 /V0 /E2 /K` が `zun -4 -z` (2281 para) 常駐後に**無限ループで止まる**
(前セッションからの TH03 ブラウザ T3 ブロッカー)。

**真因 (zun は無実、我々の AH=52h の嘘構造体)**: pmd86 の install-check を実走レジスタ+逆アセンブルで
解明 — `AH=52h` (List of Lists) → **`les bx,[es:bx+4]` で first SFT ポインタを終端チェックなしで
follow** し (offset==FFFF の終端判定は 2 ブロック目以降のみ。RBIL 慣例どおりの実装)、各 SFT ブロックの
エントリ (DOS 5 形式: 0x3B 刻み・FCB 名 +0x20) から**自分の名前 "PMD86   COM" を探す**。我々は
LoL[+4] を `FFFF:FFFF`「無し」マーカにしていたため、FFFF セグメント先の**ゴミ count/next を辿る無限
走査**になっていた (ES=0xE60B 等、ROM 領域を彷徨うのを実測)。zun -4 -z の有無で挙動が変わったのは
ゴミの中身が変わるだけ (TH02 で「動いていた」のは偶然)。**チェーン先頭に「無し」は表現不能** —
[[feedback_hle_honest_failure]] の新例 (終端マーカの形をした嘘)。
さらに pmd86 は名前発見後、**エントリ +0x11 のファイルサイズから自イメージ末尾 16B のシグネチャ
"M.Kajihara(KAJA)" を照合**する (PMD86.COM = 0x706F バイト、末尾 16B がまさにこの文字列と実測一致)。

**修正** (`native/dos_loader.c` `qb_dos_sft_note_load` + `dos_loader.h` `QB_SFT_SEG=0x00B0` +
`dos_int21.c` int21_52):
- **正規終端された合成 SFT ブロック** (ヘッダ 6B: next=FFFF:FFFF / count=8、エントリ 8 × 0x3B) を
  linear 0xB00 (LoL/DBCS scratch の上・env の下の未使用域) に常設し、LoL[+4] がこれを指す。
- エントリには実 DOS 同様「**直近 EXEC/ロードしたファイルの stale エントリ**」(close 済 ref=0 だが
  名前・実ファイルサイズが残る — 実 DOS が EXEC の open→close 後に残すもの) を 1 本書く。
  loader-start (最上位 image、`g_stage.file_bytes` 新設) と AH=4Bh EXEC (子) で更新。FCB 名整形は
  DBCS-aware (SJIS トレイル 0x5C を '\' と誤認しない・ペアを大文字化しない)。
- pmd86 は自分の stale エントリを発見 → サイズ照合一致 → **実 DOS と同じ「正規インストール」経路で
  TSR 常駐成功** (keep=1884 para を実測)。

**検証**: TH03 通し (`games/touhou/th03_game_test.js`、ローカル) が **FAIL (colors=2 で永久ハング) →
PASS (16 色描画到達・生存)**。トレースで `zun -2`/`zun -4 -z`/`pmd86`/`zun -3` 全 TSR 常駐 → op.exe
到達を確認。回帰テスト新設 = **`tools/sft_test.js`** (nasm 合成 COM が pmd86 と同型の SFT 走査 →
終端・自己発見・サイズ一致を検証。旧実装ではハング=タイムアウト FAIL で判別力あり)。

**ブラウザ実機 T3 確認済 (2026-06-11、ユーザー)** — TH03 夢時空が書庫ドロップ→展開→GAME.BAT→Run で
プレイ可能。これにより **現在オフィシャルで入手可能な東方旧作体験版 4 作 (TH02 封魔録 / TH03 夢時空 /
TH04 幻想郷 / TH05 怪綺談) が全てブラウザで動作** (ユーザー確認)。「公式配布書庫そのまま・MS-DOS /
NEC BIOS 不使用」での達成 = QuuBee のコンセプト (著作権クリーン × お手軽) の代表的実証。
回帰ゼロ: batch 8/8・batscript 51/51・xms/exec_env/find_sjis/create_sjis/sgr PASS・TH02 通し PASS・
Ray 罫線/SGR 無傷 (PNG 目視)・bio100 triage ベースライン一致 (ALIVE20/RENDER4/BOOT4/WAIT2/EXIT0/
CRASH0/BUSY1、BUSY=DYNAMO16 は 0712h 修正時に容認済みの「むしろ改善」)。
あわせて `docs/dos_hle_gaps.md` 更新 (SFT の差異: open/create は SFT エントリを作らない) +
「セル単位 dirty-flag (`tramupdate[]`)」への用語修正 (本ファイル過去エントリ・CLAUDE.md・TODO.md・
コードコメント。2026-06-11 の機構確認で「行単位・詳細不明」が正確化された)。

## [SGR (ESC[...m) 実装 + ESC[>5 をカーソル制御に忠実化 — DOS コンソール出力の色を再現] — 2026-06-11

**動機**: corpus 走査 (全書庫のバイナリから ESC シーケンスを抽出) で、SGR が 30+ 本・`ESC[>5h/l` が
40+ 本で使われていると判明。SGR 無視 = DOS 経由のテキストが全部白 + **`ESC[7m` (反転) の「不透明セル」
が透明のまま** (黒被覆と同族の問題)。旧 `>5` の「テキスト面表示 ON/OFF」解釈は、ほぼ全ソフトが終了時に
送る `>5l` (カーソル復元) でテキスト面を消す地雷だった。

**実装** (`native/dos_int21.c`、NEC CON のセマンティクスは DOSBox-X dev_con.h の PC-98 実装と突合):
- **SGR**: tty に現在属性 `g_tty_attr` を導入し全 vram_put が書く。NEC CON は**毎シーケンス先頭で属性
  リセット (絶対指定方式)**。30-37=文字色 (ANSI RGB 順 → PC-98 GRB ビットへ写像)、**40-47=色+反転**
  (PC-98 に背景色は無い)、**17-23=NEC 別系色コード** (corpus の謎だった `ESC[21m` = 黄)、2=bit4、
  4=下線、5=点滅、7=反転、8/16=シークレット。空 param ("5;46;" の末尾) は 0=リセット (ANSI/DOSBox-X
  準拠 — Ray IV の曲タイトルが実際にこの形を送り、結果は白 = 従来の見た目が正)。
- **`ESC[>5h/l` = カーソル非表示/表示** (master.lib TEXT_CURSOR_HIDE/SHOW) に忠実化。DOS カーソルは
  描画していないので no-op。
- **0:071Dh (CON 現在属性) を維持** (0x711/0x712 に続く 3 バイト目のワークエリア)。
- 消去系 (ESC[2J/K、スクロール) は現在属性で埋める (CON 同等)。ESC c/ESC * は属性も既定へ戻す。

**検証**: 新設 `tools/sgr_test.js` (合成 COM が SGR 9 種を出力 → 属性プレーン直接検証 + `>5l` 後も
テキスト面が無傷なこと + CON ワークエリア 3 バイト)。回帰 = batch 8/8・batscript 51/51・xms/exec_env/
find_sjis/create_sjis PASS・bio100 triage 同等・TH02 黒被覆無傷。**Ray IV の作者名「紫水 ともゆき」が
データ通りマゼンタ表示になる** (ESC[35m) 等、色再現が corpus 全域に効く。

**ついでの調査 (INT 実需サーベイ)**: corpus 全実行ファイルの INT xx を集計。未対応で実需があったのは
**INT DCh CL=0x10 (ファンクションキー文字列の設定/取得) の 18 本のみ**で、fkey 行を描画しない我々の
設計では no-op で実害なし (0x711 で「非表示」を正直に報告済み)。INT 33h (マウス API) の実需ゼロ、
INT 60h/F2h 等は音源ドライバ TSR が自前で立てるベクタで対応不要。master.lib 主要モジュールの残ギャップは
①ジョイスティック (joymng 0xff 固定、案 B で対応可) ②BEEP 音楽 (bgm_* oneshot) ③`ESC[nL/nM` 行挿入/
削除 (蟹味噌 kani.exe が保持、未発火) の 3 点に絞られた。**うち ② BEEP 音楽は実測で既に動作と判明**:
TW212 の BEEP 版 (TWBEEP.BAT = twins2 単体、音源 TSR なし) を headless で流し `np2kai_audio_fill` から
PCM をキャプチャ → 約 17 秒の連続楽曲 (周波数変調矩形波 + 高速交互切替の多声テクニック) を波形で確認。
NP2kai のイベントベース BEEP モデル (sysport 0x37 → beep_oneventset、256 イベント/クロックタイムスタンプ)
が pull 型音声経路でそのまま機能している。残ギャップは実質ジョイスティック (案 B) のみ。


## [DOS CON ワークエリア (0:0712h) 初期化 — 東方の画面端ゴミ & Dynamo のテキスト残留を根治] — 2026-06-11

**症状 (ユーザー報告)**: TH02 封魔録・TH05 怪綺談のブラウザ実機プレイで、画面右端 (64px 幅・全高) に
ステージタイルのゴミ列、プレイフィールド左右にスプライト断片が常時表示される。実機動画 (YouTube) では
同領域は完全な黒 → バグと断定。

**切り分け (仮説の棄却、計測ベース)**:
- 「VRAM (グラフィック面) の裏表を区別していない」仮説 → **否定**。表示ページ (A4h→`gdcs.disp`→scrndraw の
  `np2_vram[0/1]` 選択) も描画ページ (A6h→`vramop` 再マップ) も正常。両ページの直接ダンプ (mem[] の HEAP 上
  ベースを IVT 256 バイトのシグネチャ探索で特定し HEAPU8 直読み = 再ビルド不要の調査手法) で、ゴミは
  **ゲーム自身が両ページに書いた静的データ**と判明 (書き込み途中フレームで両ページのバイト数が不一致 =
  バンキングは正しく分離)。GDC パーティション (SAD/LEN スクロール) も makegrph が正しく追従。
- GDC クロック 2.5/5MHz (エミュ界の定番設定) 仮説 → **否定**。NP2kai では dipsw は BIOS フラグ mem[0x54D]
  にしか影響せず、ポークしても変化なし。

**真因** (ReC98 = 東方旧作の完全逆コンパイルが正典):
- 東方は EGC blit 用の**タイルキャッシュを VRAM 右端 64×400px・両ページに常駐**させ
  (th02/main/tile/tile.hpp に明記)、**テキスト面の黒反転セル (attr 0x05 = TX_BLACK|TX_REVERSE) で全画面を
  覆って隠す** (`text_wipe()` = text_clear + `text_fillca(' ', 0x05)`。プレイフィールドだけ透明セルで穴開け)。
- master.lib `text_fillca` は塗る行数を **DOS CON ワークエリア `0000:0712h` (テキスト行数−1) から直読み**する
  (text_fillca.asm / txesc.asm `TEXT_HEIGHT`)。我々の HLE はこれを**未初期化 (=0)** → 塗りが `(0+1)×80 = 80
  セル = row 0` で切れて rows 1-24 の被覆が不在 → タイルキャッシュ/スプライト余白が露出。実測でも
  「f=716 に row 0 の 80 セルだけ attr 0x05 になる」現象と完全一致。

**修正** (`native/dos_int21.c` のみ):
- `qb_dos_tty_reset` で 0x711 (fkey 行表示状態)=0 / **0x712=24 (25 行)** に初期化。我々の tty はファンクション
  キー行を描画しないので「非表示・25 行」が正直な状態。
- ESC パーサに DOS CON 私用シーケンス **`ESC[>1h/l` (fkey 行 非表示/表示)・`ESC[>3h/l` (20/25 行)** を実装し、
  `tty_sync_conarea()` で 0x711/0x712 を追従更新 (master.lib `text_systemline_hide()` 等は INT 29h で
  これを送るだけ)。

**検証**:
- TH02 フルフロー (game.bat→op.exe) headless: text_wipe の被覆 80 → **2000 セル全面** (診断ハーネスで実測)。
- TH02 ゲームプレイ PNG: 右端ゴミ・HUD 左の縞・左端余白が全て黒に。HUD/プレイフィールド/GAMEOVER 無傷。
- **ブラウザ実機確認済 (2026-06-11、ユーザー)**: TH02・TH05 とも画面端が実機同様の黒に。**巻き添え救済 =
  Bio 100% Dynamo の起動時にしつこく残留していた上部テキスト (ドライバ常駐時の DOS 出力) も消滅** —
  dd_opn の text_wipe が全面で効くようになったため。master.lib 系全般に効く systemic 修正。
- 回帰: batch 8/8・batscript 51/51・xms/exec_env/find_sjis/create_sjis PASS・Ray 罫線無傷・bio100 triage 同等。
  DYNAMO16 が triage 上 BOOT→BUSY 化したのは「黒被覆が効いて初期化中の画面が正しく黒くなった」副作用で、
  ヘッドレス PNG で STAGE 1-1 プレイ到達 (2人分割画面+HUD) を確認 = むしろ改善。

**残課題 (別件)**: 我々の ESC パーサは `>5h/l` を「テキスト面表示 ON/OFF」と解釈しているが、master.lib では
**`>5h`=カーソル非表示 / `>5l`=表示** (TEXT_CURSOR_HIDE/SHOW)。`text_cursor_show()` を呼ぶゲームでテキスト面が
消える地雷の可能性 (TH02 は hide のみで無害)。要再調査。

## [ゲームパッド対応 — Gamepad API → キー変換 (JS のみ・Wasm 不変)] — 2026-06-10

**動機**: 東方旧作が動くようになったのでパッドで遊びたい (ユーザー要望)。

**事前調査 (方式選定)**:
- PC-98 の標準パッドは FM 音源ボード経由 (OPN レジスタ 0x0E)。NP2kai 内の経路は
  `board86.c opna_i18a` → `fmboard_getjoy()` → `joymng_getstat()` と現状でも全部つながっており、
  我々のビルドは SUPPORT_JOYSTICK 未定義のため `joymng_getstat()` がマクロで常に 0xff
  (無入力) を返しているだけ = **ネイティブ対応 (案 B) は qb_joymng.c に状態 1 バイト +
  bridge export を足すだけで可能** (将来課題として温存)。
- corpus 実測: **bio 100% は 21/36 書庫がパッド対応を明記** (「FM音源ボードのジョイスティックにも
  対応」) = 案 B の価値は実在。一方 **東方旧作 (TH02) はキーボード専用** (doc にパッド言及ゼロ、
  カーソル/テンキー + Z/X + ESC) → 東方に効くのはパッド→キー変換 (案 A) のみ。
- 採用 = **案 A 先行** (全ゲームに効く・JS のみ・デプロイだけで済む)。

**実装** (`web/player/bridge.js` のみ):
- `pollGamepads()` を rAF ループ先頭 (エミュレータ step 実行前) で毎フレーム呼ぶ
  (Gamepad API はイベントでなくポーリング型)。エッジ検出して既存 `np2kai_key_down/up` に
  NKEY を注入。複数パッドは OR 合成。パッド由来の押下はキーボードと独立の Set で管理。
- 割当 (standard mapping 前提): 十字キー (buttons 12-15) / 左スティック (axes 0,1、デッドゾーン
  0.5) → カーソル、ボタン 0→Z / 1→X / 2→Space / 3→Enter / 9(Start)→ESC。
- ビューア (モーダル) 表示中はキーボード同様ゲームへ送らない (全キー解放扱い)。
- 接続時にコンソールへ `[QuuBee] gamepad connected` ログ (Chrome はボタンを一度押すまで
  パッドを列挙しない仕様のため、無反応切り分け用)。

**検証**: ブラウザ実機で **TH02 (封魔録) と Super Depth が完璧に動作** (ユーザー確認 2026-06-10)。
headless 経路 (tools/*) は bridge.js を使わないため回帰対象外、構文チェックのみ。

**将来 (案 B、未着手)**: ネイティブ PC-98 パッド = SUPPORT_JOYSTICK 定義 + `qb_joymng.c` に
`joymng_getstat()` 実装 + `np2kai_joy_set(uint8)` export (アクティブ low: 上下左右/連射1/2/
ボタン1/2、連射合成や BTN_MODE 入替は `fmboard_getjoy` が処理済)。パッド・キーボード両対応
ゲームでの二重入力を避けるため、導入時は「既定 = B、A はトグル」構成にする。

## [ファイル名の正準形を確立 — ゲスト生成 SJIS 名の化け/衝突を根治 (fs_path_utf8 シム)] — 2026-06-10

**症状 (ユーザー報告)**: 東方旧作の自己展開書庫 (TH03-05、SFX .exe) を実行すると生成ファイルの日本語名が
文字化けし、game.bat が途中で止まる。

**真因**: ゲストが INT 21h (AH=3Ch create 等) で渡す生 SJIS パスを **C の fopen にそのまま渡していた**ため、
Emscripten がパスを UTF-8 として復号し不正バイトを壊していた。パス >16B では TextDecoder (非 fatal) が
不正バイトを **U+FFFD に潰す = 不可逆**で、「東」(93 60) と「残」(8E 60) が**同名 "�`" に衝突** —
w+b の create が別ファイルを切り詰め上書きし得る。≤16B では Emscripten の手書きデコーダが後続バイトを
巻き込んで別形に破壊。さらに U+FFFD 化した名前は FindFirst の fold (生 SJIS 比較) と永遠に不一致。
JS 展開経路 (archive.js = latin1 で書く) は最初から正しく、**未設計だったのは「C 側がファイルを作る」境界**。

**不変条件を明文化して統一**: MEMFS ノード名 = 「SJIS 生バイトを 1 文字 1 バイトで U+0000-00FF に写した
JS 文字列 (latin1)」。C 内部のパス表現は生 SJIS に統一し、変換は 2 箇所だけ:
- 読み (d_name→内部): 既存の `utf8_next_lowbyte`/`ci_equal_fsname`/`fold_fsname_to_sjis` (逆向きは実装済だった)
- 書き (内部→libc): **新設 `fs_path_utf8`** (0x80-FF → C2/C3 xx、`utf8_next_lowbyte` の逆写像で全バイト可逆) +
  **`fs_fopen/fs_opendir/fs_stat/fs_unlink/fs_mkdir/fs_rmdir` ラッパ群** (`native/dos_int21.c`)。
  open/create/DUP 再 open/delete/attr/EXEC/overlay/mkdir/rmdir/chdir/find の全 libc 呼び出しを置換。
- あわせて `ci_lookup` の found を生 SJIS に畳み (host パスを純粋 SJIS に)、`read_dos_rel`/CHDIR のパースを
  **DBCS-aware** に (トレイル 0x5C =「表」等を `\` 区切りと誤解しない、実 DOS 同等)。

**検証**:
- 新設 `tools/create_sjis_test.js`: ゲストが「東.DAT」「残.DAT」を AH=3Ch で作成 → 正準 latin1 名で別々に
  保存・内容無破壊・再 open round-trip。修正前は衝突/U+FFFD で FAIL する判別力あり。
- **TH03 (夢時空) SFX が headless で完走**: [Y/N] プロンプト応答 → 17 ファイル抽出、SJIS 名 5 本
  (お試し版.TXT/夢の人々.TXT/夢時空.TXT/夢時空1.DAT/夢時空2.DAT) すべて正準形・衝突なし。
- **TH03 GAME.BAT が分岐インタプリタで自動起動し、op.exe が SJIS 名データ「夢時空1.DAT」を open 成功・
  描画到達 (16色)** (pmd 枝の線形化で確認。TH02 GAME.BAT 通しも現ビルドで PASS = 回帰なし)。
- 回帰: find_sjis/batch 8/8/batscript 51/exec_env/xms/diskimage 30/lzh_l1ext 全 PASS、bio100 triage
  ベースライン完全一致 (ALIVE20/RENDER4/BOOT5/WAIT2/EXIT0/CRASH0)。

**残課題 (別系統)**: TH03 の自動選択枝 :ong4 の **pmd86.com が `zun -4 -z` 常駐と組むと install-check の
メモリ走査ループでハング** (同一バイナリ・同引数が TH02 では成功 = 名前と無関係の音源ドライバ相互作用)。
TH02 は影響なし。要別調査。JS 側 `dosPathToSlash` の 0x5C トレイル非対応も保留 (docs/dos_hle_gaps.md 参照)。

## [コードレビュー修正 5 件 — .bat パーサの正直化 + find の '?' 大小不一致] — 2026-06-10

直近の分岐インタプリタ + SJIS find 対称化のセルフレビュー (7 finder + 検証) で確定した 8 件のうち 5 件を修正:
1. **`%VAR%` 入り if 比較を null に** (`batscript.js parseIf`) — `set` 未対応のまま literal 比較で静的畳み込みすると
   無言の誤分岐 (実証: 両枝逐次実行) になっていた → substArg 後に `%` が残れば null = ① へ honest fallback。
2. **クォート無し空白入り比較の trim** (同) — `if %1 == FM goto fm` の正規表現キャプチャが `"%1 "` (末尾空白) になり
   条件が常偽 → trim して評価。
3. **stage_batch 失敗時の ① フォールバック** (`bridge.js`) — C 側上限 (96文/48cmd/echo 2KB/errorlevel≤255) 超過で
   throw して Run が完全失敗していた → false 返却で既存 ① 単一起動へフォールスルー (変更前の挙動を回復)。
4. **`dos_wildcard_match` の `?` が大文字に絶対マッチしない** (`dos_int21.c`、既存バグ) — `?` 分岐が生バイト vs
   小文字化バイトを比較していた ('A'≠'a' で false)。`SAVE?.DAT`/`????????.???` 型 FindFirst が全滅する状態だった
   (既存タイトルは `*`/完全名のみ使用のため未顕在)。比較スキップに修正。
5. **goto の語境界** (`batscript.js` 2 箇所) — `gotoxy 0 0` のような goto* 名コマンドが goto 文に誤分類されていた →
   `/^goto(\s|$)/`。
テスト: `batscript_test.js` に 6 ケース追加 (51/51)。報告のみ (未修正・低優先): 重複ラベル last-wins、
find 返却名の 8.3 超過切り詰め (ステージング時 8.3 正規化が本筋)、diskimage readChain の実読了長 subarray。

## [起動 .bat の errorlevel 分岐インタプリタ — Step 2-6 完了: 封魔録 GAME.BAT がそのまま自動起動 (headless)] — 2026-06-10

Step 1 (JS 文モデル) に続き残り全段を実装・配線し、**if errorlevel/goto 入り .bat の実インタプリタが全経路で動作**。
**実 TH02 封魔録 `game.bat` を一切手を入れずに parse→buildStatements→stage_batch で流すと、`zun ongchk` の返した
errorlevel 3 をラダー (`if errorlevel 5/4/3...`) が実行時評価して実枝 :ong4 を選び、`pmd86` 常駐 → `zun zunsoft.com` →
`op.exe` 起動・描画到達 (colors=17)** — 静的素通りでは原理的に不可能だった「検出結果で 6 分岐から 1 枝を選ぶ」が
correct by construction で成立。残るはブラウザ実機 T3 確認のみ。

**アーキテクチャ (設計どおり + 統合を 1 歩進めた)**:
- **Step 2 (C インタプリタ、`native/dos_loader.c`)**: ホスト側に文テーブル `g_batch_stmts` (cmd/echo/goto/iferr、
  最大 96 文・48 cmd) と PC を持ち、`qb_dos_batch_next_hook()` が解釈。`iferr` は **`(g_last_exit_code >= n) XOR neg`
  の遅延評価** (= 実 DOS の errorlevel 意味論、全終了経路で既設のためコスト 0)。`qb_dos_stage_batch()` が JS の直列化
  文列 (`C\tPATH\tARGS` / `E\tTEXT` / `G\tTARGET` / `I\tN\tNEG\tTARGET`、SJIS は生バイトで \t\n と衝突しない) をパース。
  ゲスト (シェル image) に置くのは**パス ASCIZ + cmdtail の文字列プールだけ**で、文テーブル・echo テキストはホスト側。
- **Step 3 (シェル改、`tools/dos_loader/shell.asm` + 新トランポリン 0xFEE90)**: 静的コマンド表ループを撤去し、
  「**far CALL F000:EE90 (QB_TRAMP_BATCH_NEXT、NOP+RETF = XMS entry と同パターン) で C へ『次コマンド?』を問い合わせ →
  AX=1 なら DX=path/CX=cmdtail で AH=4Bh EXEC → 繰り返し、AX=0 で 4Ch**」に。レジスタは毎周取り直すので EXEC 子の
  挙動に依存しない。blob 62 byte。`bios/bios.c` に case 0xFEE90 追加 (patch 01 再生成、reverse-check で冪等確認済)。
- **線形 ② 経路も同シェルに統合**: `qb_dos_stage_script` は内部で「cmd 文だけの文プログラム」に落ちる
  (`stage_shell_image` 共用)。外部契約・ログは不変で、ゲスト内の旧 count+offset 表が消えた分むしろ単純化。
- **Step 4 (配線)**: `np2kai_dos_stage_batch` export (bridge.c/CMakeLists)、`batscript.js serializeStatements`、
  bridge.js Run フローで **hasControlFlow → buildStatements → stageAndRunBatch** (null は従来どおり ① へ honest
  fallback / 制御フロー無しは従来 resolveSequence 経路のまま = 択一)。`batRecipeSummary` も分岐レシピは
  「if/goto 分岐 — errorlevel を実行時評価」+関与コマンド一覧表示に。
- **Step 5 (echo)**: インタプリタが echo 文で `qb_dos_tty_write` (新設、既存 `tty_putc` = ANSI/ESC/SJIS 対応) +CRLF。
  作者メッセージ (封魔録の「GAME [ﾘﾀｰﾝ] で、…」等) がセッションの流れの中で表示される。
- **設計に 1 点補強**: cmd を含まない文だけの循環 (`:A`→`goto A`) はフック内で無限ループ = **Wasm 凍結**になるため、
  問い合わせ 1 回あたりのステップ上限 (4×文数+16) を入れ、超過は正直にログ+セッション終了。**EXEC を挟むループ
  (FINALTY のデモループ等) は呼び出しごとに上限リセット = 制限なし**のまま (脱出は Stop)。
- セッション開始時の errorlevel を明示 0 化 (`qb_dos_reset_state`/loader-start で `g_last_exit_code` リセット。
  従来は前セッションの値が残り得た)。reset 再起動 (同 stage 再走) でも文 PC を先頭へ。

**検証**: 新設 `tools/batch_test.js` (**8/8 PASS**、loader 実ブートの end-to-end 2 サイクル) — ①逆順ラダー:
RET3.COM (exit 3) を `if errorlevel 4 / if not errorlevel 2` で判定し正解枝 WIN.COM のみ実行・誤答枝 LOSE.COM
不実行・echo が text VRAM に表示、②後方 goto ループ (FINALTY 型): 自ファイルの flag byte を書き換えて 1 回目
exit 0 / 2 回目 exit 1 を返す FLIP.COM (open/seek/write/close も踏む) で `:loop` が 2 周して脱出・WIN 到達。
回帰: batscript_test **45/45** (serializeStatements ケース追加)、exec_env_test (線形 ② が新シェル経由で PASS)、
xms_test、find_sjis_test、**bio100 triage ベースライン完全一致 (ALIVE20/RENDER4/BOOT5/WAIT2/EXIT0/CRASH0、
描画到達 24・動作確認 26/31)**。TH02 e2e は `/tmp/th02_bat_e2e.js` (未コミット)。

## [起動 .bat の errorlevel 分岐インタプリタ — Step 1: JS 文モデル `buildStatements` (基盤・未配線)] — 2026-06-10

封魔録など制御フロー入り .bat を**ドロップ→Run で自動起動**できるようにする作業の着手 (設計確定 + JS 側基盤)。
背景: 封魔録の `game.bat` は `if errorlevel N goto ongM` の**音源ボード判別ラダー**を持ち、現 `resolveSequence` は
制御フロー入りを丸ごと諦めて単発起動にフォールバックする → ドライバ TSR が常駐せず脱線する (headless 成功は
`/tmp/th02_smoke.js` で手動線形化したもので、ブラウザの自動経路では再現しない)。

**方針 (設計確定)**: static な「errorlevel 分岐は素通り」ヒューリスティックは**ラダーの並び順に依存して当たる運頼み**
なので採らず、**実インタプリタ**(返り値を読んで分岐評価し goto = correct by construction、多段/ループ分岐も成立)を作る。
所在は**C 側必須** (errorlevel は DOS セッション実行中にしか存在せず JS は列を投げたら最後まで戻らない)。
シェル(asm)は EXEC 発行役のまま残し、各コマンド後に **C へ「次は?」と問い合わせる**形。**`g_last_exit_code` は全終了
経路 (4Ch/INT20h/31h) で既にセット済み・AH=4Dh も実装済み**なので errorlevel 捕捉は追加コストゼロ。ループ上限は
**入れない** (脱出は Stop/リロード)。echo も同梱 (作者メッセージを既存 `tty_putc` に流すだけ、SJIS 対応済み)。
コンベンショナルメモリ圧迫なし (シェル常駐 8KB は既存コストで、実 DOS の COMMAND.COM+カーネルより軽い)。

**Step 1 (本コミット、`web/player/batscript.js`、純 JS・テスト済・未配線でアプリ挙動不変)**: `buildStatements()` を実装 —
レシピを `cmd/echo/goto/iferr` の**文ステートメント列**へ解決 (ラベルは「直後の文 index」に解決、`if "%N"==` はユーザ
引数で静的畳み込み、`iferr` は実行時評価用に n/neg/target を保持)。未対応 (`if errorlevel N <command>`・`if exist`・
`for`/`call`・未知ラベル goto・本体なし) は **null で ① 単一起動へ honest fallback**。共有パーサ `parseLine` の小バグ
(`echo.`/`echo` 単体が echo と認識されずコマンド落ち) も修正。`tools/batscript_test.js` に 5 ケース追加 (**44/44 PASS**):
降順ラダーの label→index 解決が**並び順非依存**・後方 goto ループ・文字列分岐の静的畳み込み・echo 保持・null フォールバック。

**残 (Step 2-6、詳細は [TODO.md] / [[project_bat_launcher_corpus]])**: ②C インタプリタ+ステージ拡張 ③asm シェル改+
新トランポリン+bios.c パッチ+blob 再生成 ④bridge.js 配線 ⑤echo 出力 (tty_putc) ⑥逆順ラダー含む end-to-end
headless テスト → その後ブラウザ実機 T3 確認。見積もり ~2 日 (errorlevel 捕捉が既存のため軽い)。


## [コードレビュー追随: SJIS 名 find 経路を open 経路と対称化 + diskimage サイズ無検証アロケーション堅牢化 + stale コメント修正] — 2026-06-10

ここまでのコードのレビューで見つかった 3 件を修正。回帰ゼロ (core 回帰 find_sjis/diskimage 30-0/exec_env/
batscript 33-0/xms/xms_clients/midi_serial PASS、bio100 triage 影響なし)。

**① SJIS ファイル名の find (AH=4Eh/4Fh) 経路を open 経路と対称化 (`native/dos_int21.c`)** — 2026-06-09 の
SJIS 名 open 修正 (`ci_lookup`/`ci_equal_fsname` が MEMFS の `d_name` (UTF-8) を生 SJIS バイトに畳んで比較) は
**open 経路だけ**で、**FindFirst/FindNext 経路が同じ修正を受けていなかった**。`dta_write_find` は `de->d_name`
(UTF-8) をそのまま DTA の 13 byte (8.3+NUL) 枠へ書いていたため、SJIS 名は (a) C2/C3 膨張で UTF-8 のまま入り、
(b) 8.3 枠でマルチバイト境界の途中で切れる。結果、ゲームが **FindFirst で得た名前を再 open すると open 側は生
SJIS を期待して不一致** (4 漢字名 = SJIS 12 byte ぴったりの名前は UTF-8 で 20 byte に膨れ、12 byte で切れて
**再 open が実際に失敗**)。`dos_wildcard_match` も非対称だった。**修正 = `fold_fsname_to_sjis` (既存
`utf8_next_lowbyte` 流用) で d_name を生 SJIS に畳んでから wildcard 照合・DTA 書き込みを行う** (`find_scan`)。
あわせて `dta_write_find` を **DBCS 対応** に (SJIS リードバイトの次 trail は 0x40-0x7E に `a-z` を含むので
大文字化しない / 12 byte 境界で 2 バイト文字を割らない)。host の `stat` だけは実ノード名 (UTF-8 d_name) で行う。
ASCII 名は恒等で従来と等価 (回帰なし)。**列挙→再 open する SJIS 名タイトル全般に効く** (現動作タイトルは固定
SJIS 名直 open のため未踏だった潜在バグ)。回帰防止に **`tools/find_sjis_test.js` を新設** — SJIS 名
`漢字漢字.DAT` を FindFirst→返却名で再 open する round-trip を検証 (修正前: result=0x01・DTA 名 UTF-8 切断で
FAIL / 修正後: result=0xAA・DTA 名 生 SJIS 無切断で PASS = 判別力実証)。これは [docs/dos_hle_gaps.md] の
「SJIS 名 open 修正」の find 版。

**② diskimage の readChain サイズ無検証アロケーション堅牢化 (`web/player/diskimage.js`)** — `readChain` が
ディレクトリエントリの**生 32bit サイズ**で `new Uint8Array(size)` を確保していた。ユーザがドロップした壊れた/
細工された画像だと巨大値 (最大 4GiB) で `RangeError` (汎用エラー化) か、確保可能だが巨大な値で MEMFS が膨張する。
**修正 = 確保前に `size` をデータ領域の物理上限 `clusters*spc*bps` (BPB 検証済で `vol.length` 以下) でクランプ**。
正規ファイルはデータ領域を超えないので truncation は起きない。信頼できない入力を直接食う層の防御。

**③ stale コメント修正 (`bios.c` = patch 01)** — INT 2Fh フックのコメント「XMS/EMS 需要プローブ (検出ログのみ、
応答は未実装=無しを維持)」は XMS Tier1 実装後 (2026-06-05) は実態とズレ (INT 2Fh AX=4300/4310 は有効時に
応答する)。XMS=Tier1 実装 (有効時は応答) / EMS=需要プローブのみ (不在を返す)、と正確に。submodule の live と
patch (`tools/np2kai_patches/01_dos_loader_hooks.patch` を live diff から再生成) を同期。動作不変・文言のみ。

## [東方封魔録(TH02)がステージ1プレイ描画まで到達 — SJIS 名 open の UTF-8↔latin1 不整合を根治 + AH=4Bh AL=03(Load Overlay)実装] — 2026-06-09

同日先行の「op.exe 脱線根治」の先で、**実オープニング描画と本編 main.exe の起動**を阻んでいた本質バグ 2 件を根治。
**東方封魔録が headless でステージ1フィールド (石畳+霊夢自機+HUD「霊撃○○○/残機/霊力/NORMAL」)・スコア 0→1580
加算・敵スプライト/弾幕/アイテム (P/S/B) 落下まで実走**することを PNG 目視で確認 (`animated=true`, exited=0)。
回帰ゼロ (コア回帰 exec_env/xms/batscript 33-0/diskimage 30-0 PASS、bio100 triage 完全同一
ALIVE20/RENDER4/BOOT5/WAIT2/EXIT0/CRASH0・描画到達 24/動作確認 26/31)。

**① SJIS ファイル名が永遠に open できなかった真因を根治 (`native/dos_int21.c ci_lookup`)** — Emscripten の
パス層と生 SJIS バイトの不整合が真因。MEMFS のノード名は frontend (`archive.js decodeName`) が **latin1 文字列**
(各 SJIS バイト→コードポイント) で書くが、C 側 `readdir` の `d_name` はそれを **UTF-8 エンコード**したもので、
0x80-0xFF のバイトは 2 バイト (C2/C3 xx) に膨らむ (例: "東方封魔.録" 先頭 0x93 → C2 93)。一方 DOS 側 (op.exe) が
INT 21h に渡すパスは生 SJIS バイト列なので、`ci_equal` の素朴 byte 比較が不一致 → op.exe がデータアーカイブ
「東方封魔.録」(457KB) を **19 回開けず画像ゼロ=色 6 止まり** (オープニング黒画面の真因)。
**修正 = 比較時に d_name (UTF-8) を 1 コードポイントずつデコードし下位 8bit (= 元の SJIS バイト) に畳んでから
DOS 名と突き合わせる** (`ci_equal_fsname` / `utf8_next_lowbyte`)。一致時に `found` へ書く実在名は d_name (UTF-8) の
ままなので、後段の fopen は Emscripten の `UTF8ToString` で元ノード名に戻り正しく開ける (round-trip)。**結果: 色 6→17、
INT 21h AH=3F read 26→311、オープニング 16 色描画。** SJIS 名データを直 open する PC-98 ソフト全般に効く汎用修正。
ASCII 名は従来の素朴比較と等価 (回帰なし、bio100 全 ASCII corpus が同一)。残: CREATE での新規 SJIS 名はまだ lossy
round-trip (読み経路=本ブロッカーは解決)、`read_dos_rel` の '\'→'/' は SJIS ダメ文字を誤分割し得る (latent、現 corpus 不該当)。

**② AH=4Bh AL=03 (Load Overlay) を実装 (`native/dos_loader.c qb_dos_overlay_load` + `dos_int21.c int21_4b_overlay`)** —
op.exe はオープニング後 **main.exe を overlay 読み込み**して本編へ遷移する (game.bat は `op` だけ呼び、op→main は
op.exe 内の AH=4Bh AL=03 で繋ぐ。従来 UNIMPL で AL=03 を弾いていたため op.exe が exit code 2 で諦めていた)。
AL=00 (EXEC) と違い PSP も MCB も作らず CPU も切り替えない: パラメータブロック ES:BX の +0=load_seg / +2=reloc_factor
を読み、子イメージを load_seg:0000 へロード、EXE の各 relocation セグメントに reloc_factor を加算、CF=0 で呼び出し元へ
戻る (呼び出し元が overlay 入口へ自分で far call)。境界・reloc 検証は exec_load と同流儀。**結果: main.exe (101KB,
reloc 920) が 095B:0000 にロードされ本編稼働 (exited=0, animated=true)。** overlay は汎用 DOS 機能で他ゲームにも効く。

**③ コードレビュー追随: `int21_3f_read` のコメント修正** — 「mem は 1MB 連続」→「2MB 連続」(`QB_GUEST_MEM_MASK`=
0x1FFFFF)。動作は `qb_mem_write` が正しくマスクするため不変、文言のみ。

**東方の現状: 封魔録 (TH02) は headless でステージ1プレイ描画まで到達。** 残: ブラウザ実機での T3 確認、
TH03/04/05 (自己展開 EXE) の SFX 取り込み (埋め込み LZH 展開)。

## [東方旧作(封魔録)の op.exe 脱線を根治 — EXEC で FCB1/FCB2 を構築 + INT 21h AH=63h(DBCS) 実装。あわせて DUP2 正直化・GS100 偽陰性解消] — 2026-06-09

コードレビュー由来の小修正 2 件 + 東方旧作を射程に入れる HLE 拡張 2 件。回帰ゼロ
(exec_env/batscript 33-0/xms PASS、bio100 triage 完全同一 ALIVE20/RENDER4/BOOT5/WAIT2/EXIT0/CRASH0)。

**① AH=46h DUP2 の標準ハンドル redirect を正直な失敗へ (`native/dos_int21.c`)** — dst が標準ハンドル
(0..4) への redirect 時、開いた FILE を捨てて成功 (CF=0) を偽装していた。我々は stdout/stderr=tty・
stdin=キーボード直結でハンドル番号による入出力先差し替え層が無いため、成功偽装するとゲストは「handle 1 を
ファイルへ向けた」と信じて書くが実際は tty へ流れ、狙ったファイルは空のまま → 遠隔破壊。CF=1/AX=6 (DUP2 の
文書化済エラー) で正直に失敗するよう修正。

**② GS100 (GINGER SNAKE) の triage 偽陰性を解消 (`tools/bio100_triage.js`)** — 残 EXIT 1 本の GS100 は
非互換でなく **triage が裸起動 (空 cmdline) していた偽陰性**だった。gsnake は `gsnake <1P> <2P> <wait>`
(gsnake.doc) の引数が必須で、無いと usage 表示して即終了する。`.bat` レシピ解決と同じ「作者文書化の起動方法で
起動する」原則で、GAMES エントリにオプションの第3要素 (必須 cmdline) を追加し単一 exe ステージで配線。
GS100=`'0 0 0'` で **EXIT→ALIVE (色13 anim)**。**新ベースライン EXIT=0・CRASH=0 (早期終了も BIOS 暴走も皆無)、
描画到達 24・動作確認 26/31、stretch 目標 20 ALIVE 到達**。

**③ 東方旧作(封魔録 体験版2)を射程に — op.exe の初期化脱線を根治。** ユーザーが games/touhou に東方旧作 4 作
(TH02 封魔録=通常 LZH、TH03/04/05=自己展開 EXE) を追加。headless smoke (game.bat の ong1 経路を忠実に線形化)
で調査した結果、2 つの壁を順に突破:
- **壁1: INT 21h AH=63h (DBCS リードバイトテーブル) が UNIMPL** で op.exe が「日本語環境でない」と判断し
  code=1 終了 → **実装** (`native/dos_int21.c int21_63_dbcs`)。PC-98=Shift-JIS 固定なので SJIS リードバイト
  範囲表 (0x81-0x9F, 0xE0-0xFC, 00 00 終端) を低位スクラッチに構築し AL=00 で DS:SI へ返す (RBIL の DS:SI 規約。
  op.exe の逆アセンブルで規約一致を確認)。日本語 DOS ソフト全般に効く汎用追加。
- **壁2 (真因): 起動ドライバ `zun.com` が常駐に失敗していた。** zun はサブコマンド名 (zuninit/zun_res/ongchk)
  を**コマンドテイルでなく FCB1 のファイル名フィールド (PSP:5D)** から読み内部表と CMPSB 比較するが、我々の
  ミニ COMMAND.COM 経由 EXEC は **FCB1/FCB2 を組んでいなかった** (PSP:5D が空) → zun が「未知コマンド」と判断し
  "No COM-Soft !!!" を出して終了 → op.exe が前提とする ZUN 常駐環境が立たず脱線 (CALL FAR で BIOS 領域へ)。
  **修正 (実機 COMMAND.COM faithful):** EXEC が caller 未指定時にコマンドテイルの第1/第2トークンを FCB1/FCB2 へ
  parse して子 PSP:5C/6C に置く (`native/dos_loader.c build_one_fcb`)。**結果: zun zuninit→TSR 常駐・zun_res→
  code=0・op.exe が脱線せず正常終了 (pc=0xfee30)。** FCB1 から引数を読む PC-98 ツール全般に効く汎用修正。
  ユーザーの「常駐ドライバがメモリ上にあることが前提条件では?」という読みが正鵠だった。

**東方の現状: 「reachable」から「op.exe が脱線せず走る」へ前進。** ただし headless では描画 6 色止まり (表示
タイミング/キー入力を伴わないため) で、**実際のオープニング描画・本編 (GAME) は次セッションの課題** (ブラウザ
実機での目視 + 残る壁の調査)。3 つの自己展開 EXE は SFX 取り込み (埋め込み LZH の展開) が別途必要。

## [MCB チェーンを実 DOS 同様に env→プログラム本体→空きの単一鎖へ — env ブロックを実 MCB 化、嘘の成功を排除] — 2026-06-09

「嘘の成功」の棚卸し (ユーザー指摘) で見つかった残存を、実 DOS に忠実な方向で根治。

**真因 (同セッションの GGL2 修正と同クラス):** `qb_dos_alloc_resize` は管理外ブロック (env ブロック等、
我々が MCB を持たない領域) のリサイズに `return 0` で**嘘の成功**を返していた (`AH=49h` free も同様に常に成功)。
env ブロックは PSP[0x2C] が指す実体で、TSR や通常プログラムが `AH=49h` で解放することが多い。嘘の成功は
ゲストに「解放/拡大できた」と誤認させる。

**修正 (実 DOS 忠実化):** これまで env・プログラム本体はチェーン外 (アリーナ起点より下) だったのを、
**実 DOS と同じく env ブロック (MCB@ENV_SEG-1) → プログラム本体ブロック (MCB@LOAD_SEG-1) → 空きアリーナ
の単一連続チェーン**に統合した (`native/dos_loader.c`)。
- `qb_dos_alloc_reset` が 3 ブロック (env owner=PSP / program owner=PSP / 空き Z) を構築し、チェーン先頭
  `g_first_mcb` = env の MCB (ENV_SEG-1) に。全 walk (coalesce / 確保 / free-owner / largest-free) と
  `AH=52h` 先頭 MCB をここ起点に。
- **GGL2 用に入れた PSP 拡大特例と `g_arena_base` を撤去** — プログラム本体が実 MCB になったので、self-shrink/
  grow は通常の MCB resize 経路 (末尾分割・隣接空き吸収) で実 DOS 同様に動く (last-fit で空けた直上を grow が
  吸収 = GGL2 が通る理屈は不変)。コードはむしろ簡潔化 (net 行数減)。
- **無効ブロックの resize/free は嘘の成功でなく `AX=9` (invalid memory block address) / CF=1 で正直に失敗**
  (`int21_4a_resize` は resize の戻り -2 を AX=9 に、`int21_49_free` は free 失敗を AX=9 に伝播)。

**結果:** 実行時の MCB チェーンが `0xEF(env,M,owner=PSP) → 0xFF(program,M,owner=PSP) → 0x1100(free,Z)` と
0xEF..0xA000 を連続被覆する faithful な形に (chain walk で確認)。env の解放/リサイズが正しく動き、先頭 MCB も
実 DOS 同等。**回帰ゼロ** — bio100 triage は **ALIVE19/RENDER4/BOOT5/WAIT2/EXIT1/CRASH0、描画到達 23・動作
確認 25/31 で前項と完全同一**、GGL2 タイトル到達・OZ/CZ 救済も維持、`AH=52h` を辿る SSP/SEENA2 も ALIVE 維持。
unit (exec_env/batscript 33-0/xms/xms_clients) PASS。ユーザーが想定した一時的な完動減は発生せず (忠実化が
純粋に上位互換だった)。教訓は [[feedback_hle_honest_failure]] に集約。

## [DOS メモリ確保ストラテジ (last-fit) を実装し GOGGLE-II を救済 + readme の SJIS 復号バグ修正] — 2026-06-09

bio 100% の残 EXIT のうち **GGL2 (GOGGLE-II)** を根治。あわせて 2026-06-08 の readme ビューアに入った
SJIS 復号の退行を修正。

**① GOGGLE-II が「.bg0〜9 を生成して exit code 3」だった真因 = DOS のメモリ確保ストラテジ (AH=58h) を無視していたこと。**
- 切り分け (headless INT 21h トレース + MCB チェーン walk、足場は `tools/` の使い捨て harness):
  - `.bg0〜9` (回転キャラ事前計算キャッシュ、計 570KB) の生成・読み戻しは健全。落ちるのは最後の `AH=48h` 確保 →
    例外ベクタ設定 → `AH=4Ch AL=3` の error-abort。
  - `AH=48h` の確保成功は **46 件で計 44KB しかないのに次の確保が `largest=0`** で失敗。exit 時に MCB チェーン
    先頭 (arena_base=0x1B33) を walk すると **sig=0x16 で破断** = チェーンが破壊されていた。
  - 真因: GOGGLE は各 `AH=48h` の前に **`AH=58h AL=01 BX=0002` (last-fit)** を設定し、確保をメモリ**上端**から
    取らせて本体直上 (0x1B33) を空けたまま **PSP ブロックを `AH=4Ah` でそこへ拡大**する慣用を使う。ところが我々の
    アロケータは **strategy を無視して常に first-fit (下端) 確保**するため、本体直上を埋めてしまい:
    - PSP ブロックの拡大要求 (本来 DOS なら隣が確保済みで失敗) に旧コードが**嘘の「成功」を返す** →
      プログラムが重なり領域へ書き込み **MCB ヘッダを破壊** → `largest=0` → exit 3。
- 修正 (`native/dos_loader.c` / `dos_int21.c` / `dos_loader.h`):
  - **`AH=58h` を実際に効かせる**: strategy を `g_alloc_strategy` に保持し (`qb_dos_set/get_alloc_strategy`、Run 毎に
    first-fit へリセット)、`qb_dos_alloc_request` が 0=first / 1=best / 2=last-fit を honor。**last-fit はブロック
    上端を確保し下側を空きに残す** (低位メモリを空けておく実 DOS 同等挙動)。
  - **PSP ブロック (seg 0x100) の 2 回目以降の `AH=4Ah` を正直化**: 直上のアリーナ先頭ブロックが空きで足りる時だけ
    吸収して拡大成功、確保済みなら実 DOS 同様に失敗 (AX=8/CF=1) を返す。嘘の成功で MCB を壊さない。
- 結果: **GOGGLE-II がタイトル画面 (「GOGGLE-Ⅱ / THE PTOLEMAIC GAME / PUSH TRIGGER TO START」) まで到達**
  (exit 3 クラッシュ → プレイ可能)。**副次効果で同じ last-fit を使う OZ100 (EXIT→ALIVE)・CZ102 (EXIT→RENDER)
  も救済** = systemic な修正。bio100 triage は **ALIVE19/RENDER4/BOOT5/WAIT2/EXIT1/CRASH0、描画到達 23・
  動作確認 25/31** (前回 ALIVE18/EXIT4・到達21/確認23 から EXIT 4→1)。回帰ゼロ (exec_env / batscript 33-0 /
  xms / xms_clients PASS、CRASH=0 で従来 ALIVE 群不変)。残 EXIT は GS100 の 1 本のみ。

**② readme/テキストビューア `decodeSjisText` (`web/player/bridge.js`) の SJIS リード/トレイル状態消失を修正。**
- 2026-06-08 の NEC 罫線→Unicode 変換でバイト単位走査に書き換えた際、`0x86` を常に「罫線リードバイト」と決め打って
  いた。だが `0x86` は SJIS の**トレイルバイト**にもなり得る (トレイル範囲 0x40-0x7E / 0x80-0xFC) ため、トレイルが
  `0x86` で終わる漢字の直後に罫線トレイル集合 (`a2 a3 a4 a5` = 半角カナ `｢｣､･` 等、readme 頻出) が来ると、前の漢字の
  リードが孤立して化け、誤った罫線を出していた。
- 修正: 通常の SJIS 2 バイト文字 (リード 0x81-0x9F / 0xE0-0xFC) はトレイルごと一緒に消費し、トレイル `0x86` を
  リードとして再走査させない。Node で衝突ケース (`82 86 a2` = "ｆ｢") が素の WHATWG デコードと一致することを確認。

## [Ray IV オープニング (RAY_IV.RAY) の黒画面を根治 — DOS read→VRAM 直ロードを正規 CPU 書き込みに] — 2026-06-08

**Ray を単体起動 (`RAY` / `RAY RAY_IV.RAY`) すると「音は鳴るが画面が真っ黒」**だった症状を根治。従来 CLAUDE.md/
CHANGELOG は「データ未指定が原因」としていたが、これは**誤り**で本質バグだった (ユーザー指摘)。

**切り分け (headless A/B、`tools/ray_png.js` / 調査用 `qb_ray_ab.js`):**
- **曲データ** (`SILK_FLD.RAY` 3KB) → Ray ロゴ・ピアノ鍵盤の展開グラフィック込みで**フル表示** (非ゼロ 234k/256k・9色)。
- **オープニング** (`RAY_IV.RAY` 49KB) → **完全な黒** (非ゼロ 0)。データを明示指定しても黒なので「引数忘れ」ではない。
- bare `RAY` は `RAY_IV.RAY` を自動ロードして同じ展開スピンループ (`0x110:0xb0xx`、2026-06-01 に局所化した箇所) で固着。

**INT 21h トレースで真因確定:** Ray のオープニングは画像ファイルを **INT 21h AH=3Fh read で PC-98 グラフィック VRAM
プレーンへ直接ロード**する (青 0xA8000 / 緑 0xB8000 / 輝度 0xE0000、トレースで dst=0xAF3B1/0xBEDCD/0xE79BA を確認)。
曲データは通常メモリ (seg 0x2B75〜) へ読んで CPU で描くため健全だった。**我々の read は VRAM 宛でも生 `poke8`
(`mem[]` 直書き) を使い、NP2kai の VRAM アクセス関数テーブル (`memvga0_wr8` / PEGC `vacc->wr8`、`address>>15` で
ディスパッチ) をバイパス**していた。結果:
- **(a) 表示 dirty が立たず**グラフィック面が再描画されない (テキスト面 dirty 問題のグラフィック版)。
- **(b) GRCG read 経路と不整合** — Ray 自前の「VRAM 上で展開」ルーチンが CPU read で**ゼロを読み無限スピン**
  (2026-06-01 の「展開ソース全ゼロ」の正体)。

**修正 (`native/dos_int21.c`):** バルク転送用ヘルパー `mem_put8` を追加し、**VRAM 窓 (テキスト/属性/CG 窓 0xA0000-
0xA7FFF・グラフィック 0xA8000-0xBFFFF・輝度 0xE0000-0xE7FFF) 宛だけ `memp_write8` (正規 CPU 書き込み) 経由**に、
それ以外は従来どおり高速な生 `poke8`。`int21_3f_read` をこのヘルパー経由に変更。実 DOS では VRAM バッファへの read は
VRAM ハードウェア (GRCG 等) を通るので、これが faithful な挙動 (生 mem[] 直書きが近道で壊れていた)。VRAM へ画像を
直 read してそこで展開する**全タイトルに効く汎用修正**。

**結果:** `RAY_IV.RAY` が**オープニング画像 (女性+「Ray」ロゴ+夕景の東京タワー) を 16 色で表示**、最終 PC が展開スピン
(`0xb0xx`) → 通常待ちループ (`0x8a76`、曲データと同領域) へ移行 (= 展開が完走)。**曲データは回帰ゼロ** (`SILK_FLD`
234k/9色で不変)。headless 回帰 = xms PASS / batscript 33-0 / diskimage 30-0。スクショ突合 `tools/ray_png.js`。

**副次効果 — bio 100% triage が改善 (回帰ゼロ・昇格のみ):** 同じ VRAM 直ロードを使う他タイトルにも効き、
`tools/bio100_triage.js` が **ALIVE 16→18・描画到達 20→21・動作確認 22→23** (CRASH 0 維持・降格ゼロ)。具体的には
**SEENA2** が RENDER(57色)→**ALIVE(232色)**、**POLA100** が BOOT(4色)→**ALIVE(9色)** に昇格。汎用修正の裏付け。

**共有ヘルパー化 + XMS Move への横展開 + 読み側対称化 (同日):** 同クラスの兄弟バグ (生 mem[] 直アクセスが
VRAM 経路をバイパス) を構造的に防ぐため、ゲストメモリアクセスを**共有ヘッダ `native/qb_guestmem.h`** に集約:
- **(A) 生アクセス `poke8/poke16/poke32/peek8/peek16` を一本化** — `dos_int21.c` と `dos_loader.c` が**各自に同一
  定義を持っていた重複を解消** (両 .c から削除しヘッダ参照に。PSP/IVT/env 等の構造化書き込み用、VRAM は通らない前提)。
- **(B) VRAM 窓判定** `qb_addr_is_vram` / `qb_range_hits_vram`。
- **(C) VRAM 対応バルク転送** — 書き `qb_mem_put8`/`qb_mem_write` (VRAM 宛は `memp_write8`)、**読み `qb_mem_get8`/
  `qb_mem_read` (VRAM 元は `memp_read8` で GRCG read モードを反映)**。
- 適用: `int21_3f_read` (DOS read) → `qb_mem_write`、**`int21_40_write` (DOS write、画面を file 保存する系) →
  `qb_mem_read`**、**XMS Move (`dos_xms.c` AH=0Bh) → src/dst のどちらが conventional VRAM でも正しく**
  (VRAM 非関与は高速 memmove のまま、掛かる時だけバイト単位で正規経路)。conventional 宛を生 memmove で書いていた
  XMS Move の潜在バグ (XMS に画像を貯めて VRAM へ block-copy する型) を予防。
- 回帰: Ray 220k/16色で不変・xms_test PASS・exec_env_test PASS (`dos_loader.c` の poke8 共有後も loader/EXEC 健全)・
  batscript 33-0。XMS↔VRAM 経路は corpus に実例が無く、Ray と同一 helper の再利用で by-construction 検証。

## [QoL — CTRL キー修正 + readme ビューア (NEC罫線→Unicode) + .MAG 画像ビューア] — 2026-06-08

互換性の長尾 (bio 100%) とは別軸の「快適に使う」フロント強化。**すべて JS/HTML のみ・Wasm 不変**、ブラウザ実機で確認済。

**① CTRL キーがゲームに届かない死にコードを修正 (`web/player/bridge.js`)**
keydown ハンドラ冒頭の `if (e.ctrlKey || e.metaKey || e.altKey) return;` が **CTRL 単体押下**でも発火し (押した瞬間
`e.ctrlKey=true`)、`PC98_KEYMAP` の `ControlLeft/Right → 0x74` に到達できず CTRL が永久に無効だった。**押下キー自身が
Control のときだけ素通し**させて 0x74 を送る分岐に変更 (`Ctrl+R` 等のブラウザショートカットは従来どおりブラウザへ委譲)。
keyup 側は元から修飾ガード無しなので対称に解放・スタックキー無し。

**② readme/テキストビューアの罫線崩れを根治 + 別窓ポップアップ**
- **真因 = 2バイト NEC 罫線 (SJIS 0x86xx = JIS 区9-12 の PC-98 固有 gaiji) を `TextDecoder('shift_jis')` も
  Microsoft CP932 も知らず U+FFFD に潰すこと** (両者 node/iconv で実測)。同形状が JIS83 罫線 (区8) にあり、区8 は WHATWG が
  U+2500 ブロックに正しく復号できる → **NEC 0x86xx → 同形の Unicode 罫線 (U+2500–U+254B) へ写像**する `decodeSjisText` を
  追加し `openText` に結線 (0x86xx だけ表で差し替え、それ以外は標準デコーダに委譲)。**写像表 (罫線ちょうど 32 字)** は
  NEC罫線→JIS83 変換ツール `trkei98.exe` の変換 LUT を正典に抽出 (オフセット 0x2c64↔trail 0xa2、A系=太線/B系=細線)、
  同梱サンプル `test98` の箱の幾何で全数検証 (細線/太線/混在分岐 ┯┠┝ まで一致)。1バイト罫線は SJIS 衝突で対象外。
- **別窓ビューア**: ファイル名行 (`#text-head`) 右端に `⛶ 拡大` ボタン → 大きめモーダル (`Esc`/外側クリック/✕ で閉じ、
  表示中はゲーム入力を抑止)。content-agnostic に作り画像も相乗りさせる設計。

**③ PC-98 標準画像 .MAG (MAKI02) ビューア (`web/player/magimage.js` 新規)**
自前デコーダ `QBMag.decode`。Magd v1.25 のソース (`magd25s.lzh`) を**仕様リファレンスに参照 (逐語移植せず・フォーマット
事実のみ。DOSBox-X 参照と同方針)**。アルゴリズム = コピー表 `pixeloffset[16]` (0=リテラル / 上位ニブル→左 word・下位→右 word、
コピー元 = 現在位置 − (dy·byteWidth + dx·2))、Flag A=MSB 先頭の連続ビット列、Flag B=列ごと行跨ぎ XOR 累積、
`units=(x1>>shift)−(x0>>shift)+1` (shift: 16色=3 / 256色=2)、パレット G,R,B 順 (R=p1,G=p0,B=p2)。16/256 色対応・堅牢化
(範囲外読みは 0 / 寸法上限 2048 / デコード失敗はテキストへフォールバック)。**`.MKI` は別系統デコードで未対応**。
- **検証**: 実サンプル `savefont.mag` (272×8、pixel 消費 230 がヘッダ値と一致) + `gbox.mag` (640×400・16色の実写
  「ESEQUISSE」) をクリーンに展開し、ブラウザ実機でも罫線・画像とも正常表示を確認。
- **UI**: `.mag` を `🖼` 表示、クリックで `#text-image` canvas にプレビュー (テキスト面と排他)、`⛶ 拡大` で同モーダルに
  大きく (アスペクト保持 `object-fit:contain`・ピクセル等倍・200 ラインは縦 2 倍)。副産物の独立 MAG デコーダは画面出力
  ground-truth テストにも転用可。

## [テキスト面の連続根治 — Ray IV の罫線 2倍幅 (PC-98 半角グラフィック 区9-11) + tty の TAB 未処理 + AH=58h] — 2026-06-07

**Ray IV** はデータファイル指定 (例 `RAY SILK_FLD.RAY`) でオープニングが表示されると判明 (従来 CLAUDE.md の
「画面黒のまま」はデータ未指定が原因だった)。その表示で**「Silk Field」のタイトル枠 (罫線) が横2倍幅に崩れて
折り返す**バグを根治した。

**真因 = PC-98 半角グラフィック (JIS 区9-11) を全角扱いしていた。** Ray は枠を NEC の半角罫線文字
(JIS X 0208 の空き領域 区9-11 / SJIS 0x86xx: `8652`=┌ `8644`=─ `8656`=┐ `8646`=│ `865a`=└ `865e`=┘) で描く。
これらは PC-98 では**半角=1セル幅** (全角の区8罫線とは別物) で、NP2kai `maketext.c` もテキスト VRAM セルの
低位 (=ku) ∈{9,10,11} を半角描画する。ところが我々の tty `tty_kanji_putc` は SJIS を一律 `vram_put_kanji`
(**2セル書き+カーソル2進め**) で処理していたため、半角罫線が「1文字=半角グリフ2個」に化けて横2倍になっていた。

- **修正①:** `sjis_to_jis` 後に **ku∈{9,10,11} なら `vram_put_kanji_half` で1セルだけ書きカーソルを1進める**分岐を追加。
  全角漢字(ku≥16)/半角ANK/区8全角罫線は不変。区9-11 を使う半角罫線ソフト一般に効く systemic な修正。
- **切り分け:** 崩れたセルが `vram_put_kanji` 出力形 (低位=ku, 高位=JIS2|0x80) の**同一隣接ペア** → 我々が2セル
  書いた証拠。tty バイトを一時 hex ログして Ray の生バイト (`86 44`…) を確定。framebuffer を PNG 化 (新ツール
  `tools/ray_png.js`) し実機スクショと突合。

**ついでに GBOX.COM (画面ユーティリティ) で同種のテキスト面 gap を2件発見・修正:**
- **修正②: tty が TAB (0x09) を未処理でグリフ化していた。** GBOX のヘルプ (`/?`) は各行頭に 0x09(HT) を置くが、
  我々の `tty_normal_putc` は CR/LF/BS しか処理せず TAB を文字として描いていた (行頭に謎グリフ+インデント無し)。
  実機 PC-98 の CON 準拠で **0x09→次の8桁タブストップへ前進** (文字は書かない) を追加。`0x07`(BEL) もグリフ化抑止。
  → GBOX ヘルプの行頭乱れが消え左カラムが正しくインデント。
- **修正③: INT 21h AH=58h (メモリ確保ストラテジ / UMB リンク) が UNIMPL だった。** GBOX の United モード (`/U`) が
  AX=5803h (set UMB link state) を呼ぶ。我々は UMB 無し・first-fit 固定なので、get には良性既定値・set は no-op 成功を返す
  ハンドラを追加 (invalid function を返すとプログラムが誤判定しうるため)。

**別件のコードレビュー修正も同梱:**
- `dos_xms.c`: `cmem16`/`cmem32` の上位バイト read を `& QB_GUEST_MEM_MASK` で囲い境界での1バイト配列外 read を封じる。
  `xms_free_query` にプール無効ガードを追加 (uint32 アンダーフロー誤報防止)。
- コメント整理: `bridge.c` の古い vol_master=65 記述を削除、トランポリン番地説明 (0xFEE50/60/70/80) を追記。

**検証:** Ray 枠が単線の正しい矩形に / GBOX ヘルプ整列 / 全角漢字 (紫水・ともゆき) 正常 / うさちゃん列車の
全角タイトル正常 / bio100 triage 完全同一 (ALIVE16/RENDER4/BOOT5/WAIT2/EXIT4/**CRASH0**、回帰ゼロ)。

## [INT 29h (DOS 高速文字出力) を実装 — master.lib の text_clear() を根治しテキスト残留を解消] — 2026-06-07

**Super Spartan (SSP101) 等で「ゲーム画面にタイトル文字が重なって残り続ける」症状を根治した。**
真因 = **`INT 29h` 未実装**。SSP のメニュー/ハイスコア画面の左上に「Super Spartan version 1.0 / Copyright(C)1995 …」
がゴーストする現象を headless で追い込んだ。

**追跡 (まず徹底的に切り分け):** ① テキスト消去/非表示の全経路 (INT 18h AH=0Dh / GDC `OUT 0x62,0x0C` STOP /
直書き `rep stosw` / ESC・CSI) が**正しく動作**することを単独テストで実証 (ユーザー提供の **GBOX.COM `/TF` で
画面が完全に消える**のが決め手)。② にもかかわらず SSP は banner を書いた後、char/属性/GDC SAD/textdisp ENABLE/
INT 18h/GDC コマンドの**どれにもテキスト消去の痕跡がゼロ**。③ ユーザー提供の **master.lib (mtlib22j) を逆アセンブル**
して核心判明 — **`text_clear()` (TXCLEAR.ASM) の実体は `INT 29h` で "ESC[2J" を 4 バイト送るだけ** (`mov al,1Bh/5Bh/32h/4Ah; int 29h ×4`)。
我々のローダは INT 20h/21h/2Fh/67h しかフックせず、**INT 29h は未使用ベクタ → IRET スタブ (no-op)** に落ちていたため、
master.lib の `text_clear()` が**完全に無効化**され、書いた文字が永久に残っていた。master.lib 製ゲーム全般に効く systemic バグ。

**修正:** INT 29h を「AL の 1 文字を CON (= 我々のテキスト VRAM tty) へ流す」フックとして実装。トランポリン
`QB_TRAMP_INT29 = 0xFEE80` (NOP+IRET) を追加 (`dos_loader.{c,h}`)、IVT[0x29] をそこへ向け、`bios.c:biosfunc` に
`case 0xFEE80 → qb_dos_int29_hook()` (`dos_int21.c`、`tty_putc(AL)`) を結線。"ESC[2J" は既存の CSI J (p=2) →
`vram_clear_all` 経路に乗る。INT 29h は DOS 標準の高速文字出力なので、これを使う他プログラムの画面出力一般にも効く。

**検証:** SSP のメニュー/ハイスコアの banner ゴーストが**完全消滅** (headless で row0/row1 が空白化、PNG 目視でも
クリーン)。回帰 = `exec_env`/`batscript 33-0`/`xms` PASS、bio100 triage は ALIVE16/RENDER4/…/CRASH0 で**従来同一**。
patch 01 (`01_dos_loader_hooks.patch`) を INT 29h ケース込みで再生成 (冪等チェック OK)。

**注 (KANI123):** 蟹味噌のハイスコア画面左上「KANI.SCR を作成」は別系統で、**KANI は INT 29h を一切使わない** (直書き)。
これは KANI.SCR が無い**初回起動限定**の作成メッセージ (本来の残留=セーブ拒否は 2026-06-06 の RTC Y2K 修正で解決済)。

## [INT 21h AH=52h (Get List of Lists) で master.lib 系を救済 + bio 100% triage 精緻化] — 2026-06-07

**Super Spartan (SSP101) が起動するようになった。** ブラウザで「banner 表示後にゲーム開始前で終了」する
症状を headless で追い込み、**真因 = `INT 21h AH=52h (Get List of Lists / SysVars)` 未実装**と特定した。

**追跡:** sspartan.exe (master.lib 製ランチャ) は banner を出し、グラフィック `sspartan.g00-.g19` を自己展開
(ファイル I/O は正常動作) した後、**ゲーム本体 `a:\sspartan.d98` (拡張子を偽装した EXE) を AH=4Bh EXEC** する。
その子が初期化中に **AH=52h を呼び、未実装 (`default`→CF=1) のため有効ポインタを得られず exit code 1** で諦め、
親もそれを見て終了していた。MIDI 無し直起動でも同一挙動 = MIDI とは無関係と確認。AH=52h は master.lib 系が
DOS 内部 (先頭 MCB を辿って利用可能メモリ算定) を覗くのに使う関数で、**実装すれば他の master.lib タイトルにも効く。**

**修正:** `dos_int21.c` に `int21_52_list_of_lists` を追加 (dispatch に `case 0x52`)。最小の合成 List of Lists を
低位 RAM (segment `0x00A0` = env `0x00F0` / PSP `0x0100` の手前の未使用域) に構築して ES:BX で返す。`[BX-2]` =
先頭 MCB は新アクセサ `dos_loader.c:qb_dos_first_mcb_seg()` (= `g_arena_base`)、DPB/デバイス系は `0xFFFF`「無し」、
NUL デバイスヘッダ・LASTDRIVE=5・max 512B/block を充填。負オフセット域確保のため BX=0x26。**一発で通り、SSP は
EXIT→ALIVE (headless で colors=16・anim・走行継続) に。回帰ゼロ。** dos_hle_gaps.md の実装済み AH に 52 を追記。

**bio 100% triage を精緻化** (`tools/bio100_triage.js`):
- **① .bat 入口解決:** ランチャ型 (音源ドライバ TSR + 本体) は従来「主 exe を裸ステージ」でドライバ未常駐の
  早期終了 → 偽 DEAD だった。`.bat` があれば `batscript.js` でレシピを解釈し、ブラウザと同じ `stage_script`
  経路 (ミニ COMMAND.COM が 1 セッション内で順次 EXEC) でステージ。→ MKD106(Markadia) DEAD→ALIVE、
  TWINS110 DEAD→RENDER、DYNAMO16(Dynamo 代表作) DEAD→稼働。
- **② PC 状態 3 分類:** 従来 `pc∈[0xE8000,0xFFFFF]` を一律「BIOS クラッシュ」扱いしていたが、この範囲は
  dos_loader.h のトランポリンを含み別状態が混在 (GBOX.COM スモークで判明) → **EXIT (0xFEE30=HALT_LOOP 正常終了)
  / WAIT (0xFEE10=INT21 内ブロック=入力待ち生存) / BIOS (neccheck 暴走)** に分離。DADA/YY は WAIT (生存) と確定。
- **新ベースライン: 描画到達 (ALIVE+RENDER) = 20/31、動作確認 (+WAIT) = 22/31、真の BIOS クラッシュ = 0。**
  → 31 本に本物のクラッシュは皆無 = HLE/BIOS は健全。`node tools/bio100_triage.js [filter]` で絞り込み可。

**`emscripten/build.sh` を堅牢化:** NP2kai パッチ適用が当たらない場合に WARN で続行していた (= 修正を欠いた
バイナリが黙って生成される) のを **hard fail (`exit 1`) に変更**。正典の再現経路として安全側に倒した。

**代表作の進捗:** NyaHaX'93 (NX93) をブラウザ実プレイで T3 確認 (`nx93.exe` 単体・改修ゼロ)。Bio_100% 代表作
4 本 (SuperDepth/Dynamo/NyaHaX'93/TURB) のうち SuperDepth + NyaHaX'93 が T3 確定。

## [蟹味噌テキスト残留を根治 — 真因は PC-98 RTC の Y2K バグ + 汎用 Y2K シム] — 2026-06-06

**蟹味噌 (KANI123) の「KANI.SCRを作成します / 形式が違います」テキスト残留を完全に根治した。**
同日の前エントリ「我々のバグではない・Phase 4 保留」は **誤りだったと判明し撤回** — 真因は我々が現在年
2026 を渡すことで踏ませる **PC-98 RTC の Y2K バグ**で、修正可能だった。

**追跡の決め手 = 外部リファレンスで循環論法を断った:** 描画/属性/色/モード/ST ビット/dirty-flag/SAD 幾何/
LZEXE を全否定し (色は 'A' を実描画して bit0=表示・bits5-7=GRB と実測。**拡張アトリビュートモードは grep で
存在せず・色デコードは無条件 8 色**)、行き詰まった所で **ユーザーが YouTube の実機プレイ映像を確認 →「左上に
最初から最後まで一切文字が出ない」**。これで「実機では出ない＝我々のバグ」と確定し、描画系の循環疑いが消えた。

**真因 (確定):** ゲームは日付を **DOS の INT 21h AH=2Ah でなく PC-98 ハードウェア RTC (μPD4990A →
`calendar.c`) から読む**。我々の RTC は host 時刻 (2026) で種付けされ、`date2bcd` が `year%100`、ゲームの
世紀判定が「BCD 下 2 桁 < 80 → 2000 年代」と解釈 → `2026-1900 = 126` の **3 桁年**。蟹味噌の KANI.SCR は
固定幅レコード ("YY/MM/DD") なので 3 桁年がフィールドを溢れさせ区切りを食い潰す → **再読込でゲームが自分の
出力を「形式が違います」と弾く → そのメッセージがテキスト面に残留**。(`162/07/13` の暴走は `cal_vofs` 仮想
カレンダオフセットの汚染由来。)

**修正 (汎用 Y2K シム):** RTC を読む唯一の出口 `calendar.c:date2bcd` で **年 >= 2000 → 1999 にクランプ**
(`tools/np2kai_patches/03_rtc_y2k_clamp.patch`)。BCD 下 2 桁が 99 ⇒ ゲームの世紀判定が必ず 19xx 側になり
2 桁を保証 (種/ドリフト/cal_vofs 汚染に関わらず常に効く)。種 `native/qb_timemng.c` と DOS `AH=2Ah` も同じ
1999 クランプ (月日・時刻は host のまま)。結果 KANI.SCR は `99/06/06 09:24:57` と正しい固定幅になり受理 →
**残留消滅・ブラウザ実機で確認済**。検証=`np2kai_debug_rtc_bcd` で RTC 年 BCD=0x99 を headless 確認。
**90 年代ゲームの日付依存セーブ全般に効く汎用対策** (年だけ 90 年代に固定される妥協はゲーム側の Y2K 制約)。

**ビルド系:** `emscripten/build.sh` のパッチ適用を **per-patch 冪等** に改善 (reverse-check で適用済み判定)。
パッチが 3 本に増え、bios.c マーカー 1 つで一括判定していた旧ガードでは新パッチが fresh build で漏れるため。

**デバッグ補助 (恒久):** `np2kai_debug_poke8` (peek8 の対) / `np2kai_debug_rtc_bcd` (RTC 日付 BCD 読取) /
`np2kai_debug_get_gdc_para` (GDC 表示幾何) / `qbDebug.watchTextRow` (row 内容変化の時系列記録)。本件の
属性・幾何・日付調査で実装し、今後の HLE/描画デバッグに有用。

## [蟹味噌テキスト残留の根因解明 (= 我々のバグではない) + HLE 副産物 (AH=29h / EXEC FCB→PSP) + LZEXE 動作確認] — 2026-06-06

**蟹味噌 (KANI123) の「KANI.SCRを作成します」テキスト残留を徹底調査し、原因を完全に切り分けた。**
結論: **QuuBee 側 (描画/HLE/ローダ) のバグではなく、kani.exe が HUD 描画前にテキスト面を再クリアしない
ゲーム固有の挙動**。ユーザー当初の「基本的なことができていない証拠」仮説は今回は外れ — エンジン・ローダ・
HLE・描画・LZEXE すべて正しく動作している。

**消去法で否定した容疑 (全てハードデータ + framebuffer 画像で確認):**
- **描画 ↔ NP2kai 食い違い**: 合成は 100% NP2kai `scrndraw`。`qb_scrnmng.c` は単なるサーフェス buffer。
- **dirty-flag / さめがめ型の明示クリア未通知**: 蟹味噌は HLE tty を一切通らず (AH=09h 皆無)、ゲームが
  text VRAM へ直接 CPU 書込。起動時の直接書込クリア (frame 242 で boot テキスト→空白) は機能している。
- **テキスト面 OFF 無視**: `np2kai_debug_get_textdisp` で全期間 `0x8a` (GDCSCRN_ENABLE=1)。ゲームは
  GDC STOP も INT 18h AH=0Dh も発行しない。NP2kai は両者を正しく honor する (gdc.c:308 / bios18)。
- **secret(非表示)属性**: row0 の attr=0xE1 (通常可視)。
- **SAD/表示幾何**: `np2kai_debug_get_gdc_para` で master GDC partition (gdc.m.para[12..19]) を観測 → 全期間
  SAD=0。ゲームはテキストをスクロール/ずらしていない。表示 row0 = VRAM offset 0。
- **first-run 限定 / KANI.SCR 作成失敗**: AH=3Ch で正常に生成 (429B、保存して再投入も検証)。有効 SCR を
  置いてもメッセージは残る。
- **kanipic.exe (タイトル表示) の不全 / LZEXE**: **kanipic.exe は LZEXE v0.91 圧縮 EXE** (`LZ91` @0x1C、
  reloc 0、e_minalloc 0x16b5)。framebuffer 画像でタイトル ("KANIMISO Ver1.23" + 球 + HIT ANY KEY) が
  **完璧に描画** = 我々のローダは **LZEXE 自己展開 EXE を正しく実行できている** (bio100 目標に追い風)。

**真の仕組み (確定):** ゲームは起動時にテキスト面を一度クリア → row0 に "KANI.SCR…" 直接書込 → 以降
二度とクリアせず、本編では HUD (`SCORE / <<KANIMISO>> / LEFT`) を**位置指定でフィールドだけ重ね書き**
(隙間は空白前提)。隙間に起動メッセージの漢字が残り、本編 HUD の score に被って化ける (画像で確認)。
PC-98 はテキスト面を常にグラフィック面の上に合成 (グラフィック優先命令は無い) ため可視化される。
残る不確実性 = 実機では「タイトル→本編」遷移でクリアが入るか初回限定で実機も被るか。断定には kani.exe の
逆アセンブルかブラウザでの遷移時 `qbDebug.textVram()` 観測が必要 (headless は本ゲームの入力が不安定で遷移を
踏めず)。**Phase 4 の既知美観課題として保留。**

**HLE 副産物 (調査の過程で実装、最初の仮説は外したが実 DOS 忠実化として独立に有用・回帰なし):**
- **INT 21h AH=29h (Parse Filename) 実装** (`native/dos_int21.c`): DS:SI の文字列を drive/8.3 に解析して
  ES:DI の FCB へ (AL フラグ準拠、`*`→`?` 展開、ワイルドカード有無で AL、SI 前進)。従来 UNIMPL の純加算。
- **EXEC が param block の FCB1/FCB2 を子 PSP(0x5C/0x6C) へ複写** (`dos_loader.c`): 親が AH=29h で組んだ
  FCB を子へ渡す実 DOS 経路。null ポインタの caller (.bat shell 等) は従来どおり複写せず (`if(fcb_lin)` ガード)。
- 回帰: `tools/exec_env_test.js` PASS / `tools/batscript_test.js` 33/0。

**デバッグ補助 (恒久):**
- `np2kai_dos_set_int21_trace(on)` (bridge.c): INT 21h 全コールトレース on/off (既定 OFF)。今後の HLE 調査用。
- `np2kai_debug_get_gdc_para(which,index)` (bridge.c): GDC para バイト読取 (which=0:master/1:slave)。
  テキスト/グラフィック表示幾何 (SAD/partition/pitch) のデバッグ用。

## [bio 100% 互換性目標を設定 + XMS 実クライアント検証 + EMS 据え置き判断] — 2026-06-05

**新目標「bio 100% 純ゲーム 31 本中 20 本を T3(プレイ可能)」を設定** (詳細・スコアボードは TODO.md)。
bio 100% は単一同人サークルのフリーソフト集 = ミッション中核。音源ドライバ・起動規約・エンジンを共有する
ため高レバレッジ。36 書庫を doc 精読で仕分け → 純ゲーム 31 (非ゲーム 4: コースエディタ/ランキングツール/
にゃん文字/WIP、重複 1: FINAT=FINAL=Super Depth 2)。

**ベースライン計測 `tools/bio100_triage.js`:** 全 31 本を headless でブートし framebuffer の色数+フレーム間
差分で到達 Tier を自動推定。**描画到達 (RENDER+ALIVE) = 20/31、アニメ動作中 15。** 既知動作の DEPTH/KANI/TW212
が全て ALIVE = 判定信頼。DEAD 8 本の大半は harness 都合 (音源ドライバ未常駐の早期終了 5 本 + テキストゲーム
DADA/YY の色メトリクス盲点) で真の非互換ではない → 真の射程 24〜28、20 は余裕。

**XMS の実クライアント検証 `tools/xms_clients_test.js`:** 実 DOS エディタ (AMEL/JED/5ds/MM46) を headless で
ステージして XMS とのやり取りを観測。**AMEL `/X` が Tier1 XMS 経由で 338KB を実確保・未実装 fn ゼロ・EMS 落下
ゼロ**を確認 (他 3 本は条件付き XMS で headless では初期化前に終了/待機)。

**EMS 据え置きを確定:** 全 54 書庫 (bio_100 + mem_test + 単発) を静的スキャン → **EMS-only (EMMXXXX0 あり・
XMS プローブ無し) はゼロ**。EMS を叩く 25 本は例外なく XMS も叩く = 我々の XMS にフォールバックして EMS 無しで
動く公算。EMS HLE (ページフレーム copy で重い) は現 corpus への効果が薄いため**据え置き**、需要プローブを
常設のまま様子見 (再評価トリガ = 実プレイ中の `memprobe.ems>0` or XMS 非対応の EMS 専用タイトル発見)。
根拠を `docs/dos_hle_gaps.md` に記録。

**XMS Move のハードニング (`native/dos_xms.c`):** `xms_resolve()` の conventional (handle=0) 経路に `start+len`
の境界チェックを追加。実 mem[] (2MB) 配列外への memmove (病的 length) を offset-invalid で弾き、Wasm 配列外
トラップ (エミュ即死) を防ぐ。EMB 側と対称化。回帰 = xms_test の conv↔EMB Move 往復で確認。

## [XMS (HIMEM 相当) Tier 1 HLE — 640KB の壁の外へ] — 2026-06-05

「実 DOS で HIMEM.SYS がロードされている」状態を素直に再現する XMS ドライバを HLE で実装。
**ブラウザ実機で AMEL `/X` が 338KB の拡張メモリを確保**することをユーザー確認済 (「オーバーレイにプロテクト
メモリを使用します」表示 + `qbDebug.xms()`)。`native/dos_xms.{c,h}`、既定 ON。

**動機 (需要サーベイ):** `games/mem_test` の 14 本を doc/binary スキャン → 拡張メモリ需要は実在 (XMS=VZ Editor/AMEL、
EMS=JED/mm46/5ds/FD)。多くは optional だが、AMEL `/X` は XMS が無いと `amel_NN.dat` オーバーレイをディスクから
何度も読み直す (XMS で消えるアクセス)。

**設計 (faithful HIMEM):**
- 経路 = ゲームが `INT 2Fh AX=4300h` で検出 (→`AL=80h`) → `AX=4310h` で driver entry 取得 (→`ES:BX=F000:EE70`)
  → その far アドレスを CALL FAR して `AH`=関数番号で各機能。entry は `dos_loader.c` のトランポリン (NOP+RETF,
  `QB_TRAMP_XMS_ENTRY`)。`biosfunc()` に case 0xFEE70 追加 (patch01 再生成)。
- **EMB は実拡張メモリ `CPU_EXTMEM`(32MB、`extbase = ext - 0x100000`) のサブ領域に first-fit 確保** (先頭 64KB は
  HMA 用に予約)。Move (AH=0Bh) は物理 memmove (handle=0 は conventional の seg:off)、Lock (AH=0Ch) は実 linear
  `0x100000+offset` を返す (ゲストが A20 を上げて memp_* でアクセスすれば同じバイトに届く)。
- 実装関数: `00`Version / `08`Query free / `09`Alloc / `0A`Free / `0B`**Move** / `0C`/`0D`Lock/Unlock / `0E`Info /
  `0F`Realloc / `03`-`07`A20。戻り値は XMS 3.0 契約 (成功 AX=1 / 失敗 AX=0+BL=err)。HMA (`01/02`)・UMB (`10/11`)・
  32-bit版 (`88/89`) は**素直に「無い」と応答** (BL=0x90/0xB1/0x80)。
- 既定 ON (= HIMEM 常駐想定)。`qbDebug.xms(0|1)` で A/B 切替 → `{enabled, handles, usedKB, freeKB}`。
  bridge `np2kai_xms_enable / np2kai_xms_stat`。

**検証:** `tools/xms_test.js` (nasm 合成 COM で 検出→entry→alloc→conv↔EMB の Move 往復のバイト一致を自己検証、
結果 0xAA@DS:0080) PASS。実証 = AMEL `/X` が実機で 338KB EMB を確保。回帰 = exec_env / batscript / lh5 / lzh /
diskimage / memprobe 全 PASS、ザルバール等も無傷。VZ は起動時クラッシュだが XMS 無関係の既存課題 (未 HLE の DOS 機能)。

## [XMS/EMS 需要プローブ — 拡張メモリ要求を可視化] — 2026-06-05

XMS/EMS が未実装の段階で「ターゲット群が実際に要求してくるか」を測るため、検出だけの計測器を常設。
INT 2Fh `AX=43xx` (XMS インストールチェック) / INT 67h (EMS) / `EMMXXXX0` デバイス open (EMS の MS 標準検出口) を
「無言の IRET スタブ」から「検出ログ + 件数カウント」に格上げ。**応答は従来同様「無し」(レジスタ不変) なので互換性は
不変・回帰ゼロ**。集計は `qbDebug.memprobe()` → `{xms, ems, emmOpen}` (Run 毎リセット)。実装 = `dos_loader.c`
(trampoline 0xFEE50/0xFEE60 + 専用フック) + `dos_int21.c` (AH=3Dh で `EMMXXXX0` 検出)。検証 = `tools/memprobe_test.js`
(合成 COM で 3 経路すべて {1,1,1} + 正常終了)。

**発見:** エディタ系 (JED/mm46/VZ 等) の EMS 検出は IVT[0x67] のドライバヘッダ署名をメモリ読みで memcmp する
パッシブ方式で、INT 67h も open も通らず能動カウント不可 (盲点)。バイナリ内 `EMMXXXX0` の有無がより確実な EMS 需要
シグナル。一方 XMS 検出 (INT 2Fh AX=4300) は能動的なので確実に捕捉。

## [コードレビュー追随 — MIDI コメント陳腐化 + freepats res.ok] — 2026-06-05

- **陳腐化コメント修正:** `qb_vermouth.c` / `bridge.c` の「MIDI は OFF / FM 加算でビリビリ歪みのため呼ばれていない」
  という記述が、MIDI on-demand 実装後の現状と矛盾していたのを修正。create 時 MPU 経路は削除せず「将来の `-X0`
  MPU 直叩き用の足場」と明示 (TODO/CHANGELOG に `-X0` 候補が残るため)。
- **freepats 取得の堅牢化:** `ensureMidiLoaded` の index.json / cfg / 各 .pat fetch に `res.ok` 検査を追加。
  fetch は 404 で reject しないため、未配備/欠損を見逃すと HTML を `.pat` として書き込んでしまう (VERMOUTH は
  欠損 .pat を黙って飛ばす = `inst_bankloadex` が SUCCESS のまま) のを未然に防ぐ。

## [MIDI が鳴る — RS-MIDI を VERMOUTH に結線 (遅延 on-demand + reset 跨ぎ修正)] — 2026-06-05

TW212 (bio_100%) の TWMIDI.BAT で、FM とは別の **MIDI 音色がブラウザ実機で鳴る**ようになった。

**真因の特定 (MIDDRV.DOC 精読 + コード突き合わせ):**
- `MIDDRV.EXE` は常駐型 **標準 MIDI ファイル (SMF Format 0) 演奏ドライバ**。game (`twins2`) は INT 47h で
  「曲 N を鳴らせ」と依頼し、MIDDRV が同梱 .mid をシーケンス→デバイスへ送出する。`-X1` = **RS-MIDI**
  (シリアル MIDI)、`-t3` = マウスタイマでシーケンス。
- NP2kai `io/serial.c` は 8251 を完全エミュし、データ書き込みを `cm_rs232c->write()` まで運んでいた。
  ところが **`native/qb_commng.c` が `COMCREATE_SERIAL` を `com_nc` (no-connect) に落とし全バイト破棄**
  していた = 無音の真因。本物の MIDDRV が本物の .mid を正しくワイヤまで出していたのに受け手が未接続だった。

**実装 (A) — `qb_commng.c` で RS-MIDI を VERMOUTH に結線 (cmmidi.c は無改造):**
- `device==COMCREATE_SERIAL && qb_vermouth_ready()` の時、内側 cmmidi (VERMOUTH シンク) を作り薄いラッパ
  `com_serial` を返す。設計の肝 = 「送信が成立する `com_nc` の挙動 (getstat/lastwritesuccess/msg) を流用し、
  `write` だけカウント+VERMOUTH へ転送」。8251 の TxRDY/FIFO drain が不変・`msg` が no-op なので MIDIRESET も無害。
- cmmidi.c が無改造で済む確認: Emscripten では OS MIDI デバイス open ブロックが `#if !defined(EMSCRIPTEN)` で
  除外され常に -1 → device 非依存で `midiout=="VERMOUTH"` 分岐に入る。`midiwrite` は running-status 対応の
  完全な MIDI バイトパーサで realtime (0xFE 等) も吸収して `midiout_vermouth` へ流す。

**ブラウザ遅延 on-demand — `enable_midi` は create 前必須 / ゲーム選択は起動後、を「reset で繋ぎ直す」で解決:**
- `pccore_reset → iocore_reset → rs232c_reset` が毎リセットで `commng_create(SERIAL)` を呼ぶので、VERMOUTH を
  後から読んでから reset すれば `com_nc → com_serial` に昇格する (コア再生成 不要)。
- `bridge.c:np2kai_enable_midi_now()` (create 後に VERMOUTH 構築、mpuenable は触らない) +
  `batscript.js:usesMidi()` (MIDI ドライバ検出) + `bridge.js:ensureMidiLoaded()` (MIDI レシピ Run 時のみ
  freepats を `index.json` から fetch → `/tmp` 配置 → `enable_midi_now` → runStaged の reset で結線)。
  **非 MIDI ゲームは freepats を一切 DL しない = 即プレイ維持**。診断 `qbDebug.midi()` → `{active, bytes}`。

**reset 跨ぎの無音バグ修正 (実機で発覚):** 1 回目は鳴るが別 .bat を挟んで再起動すると無音 (active=true・
bytes 増えるのに音だけ出ない)。真因 = `sound_reset` の `streamreset` が `sound_streamregist` 登録を全消去
するのに cmmidi を singleton 保持していたため初回しか登録されなかった。`commng_destroy(com_serial)` で inner を
release+NULL 化し、毎リセット作り直す = 毎回再登録 (stock MPU98II の「reset で NULL→遅延再生成」と同型。
`rs232c_open` は `cm_rs232c==NULL` ガード付きなので生成はサイクル毎 1 回 = 重複/dangling 無し)。

**思わぬ収穫 (音量):** 旧 create 前 `enable_midi(1)` は `mpuenable=1` で MPU 経路も VERMOUTH stream を二重登録し、
同一 `vermouth_module` を 2 つの getpcm が食い合って音量激減していた。`enable_midi_now` は serial 単独 stream
なので **peak ~27800/32767 (=77%) と健全**。MPU を触らない判断が音量面でも正解だった。

**deploy:** freepats (33MB) を本番 (Cloudflare Pages) に同梱する方針に変更 (`tools/deploy.sh` の除外解除)。
遅延 on-demand なので MIDI ゲーム起動時のみ初回 DL される。

- **`native/qb_commng.c`** (+結線/再登録)、**`native/qb_vermouth.c`** (`qb_vermouth_ready()`)、
  **`native/bridge.c` + `CMakeLists.txt`** (`np2kai_enable_midi_now` + 診断 export)、
  **`web/player/batscript.js`** (`usesMidi`)、**`web/player/bridge.js`** (`ensureMidiLoaded` + Run フック + `qbDebug.midi`)。
- **`tools/midi_serial_test.js`** 新設: TW212 を lha 展開→freepats を MEMFS→TWMIDI.BAT を実 Run 経路で
  **2 サイクル**起動し、active / MIDI byte 増分 / audio peak を検証 (reset 跨ぎ回帰ガード)。

検証: ビルド clean、2 サイクルとも active=true・bytes+2058・peak~27800、回帰なし (exec_env PASS / batscript 33-0 /
JS 構文 OK、MIDI OFF 既定は `com_nc` で従来不変)。残: `-X0` MPU 直叩き経路 / MIDI+FM 同時の音量バランス。

**本番デプロイ + 進捗表示の追記:** freepats(33MB) 同梱で Cloudflare Pages にデプロイし、**本番で MIDI 発音を
ユーザー確認済**。初回 freepats DL (128 ファイル) が固定文字「取得中…」で進捗不明だった不満を受け、
`ensureMidiLoaded` の DL ループで完了件数+累積バイトを数え `MIDI 音色データ取得中… 47/128 (37%, 12.3MB)` と
runStatusEl をライブ更新するようにした (JS のみ・wasm 不変)。今後の候補: DL 済 freepats を IndexedDB/Cache
Storage に保存して再訪時もスキップ / プログレスバー化。

## [快適化: async 自動クロック — 達成フレーム時間から CPU 倍率を逆算 (既定 ON)] — 2026-06-04

CPU クロック倍率 (`np2cfg.multiple`) の「快適化」を計測で詰めた結果**当初前提が反転**し、最終的に
**自作の適応コントローラ (async 自動クロック)** を実装した。実機ブラウザで「おおむね快適・音切れ無し」を
ユーザー確認済み。

**計測で判明したこと (CPU 飽和の自作 busy-loop 自己起動ディスクで headless 計測):**
- run_frame コストは `fps(M) ≈ 3300 / M` (反比例)。real-time 目標 = PC-98 vsync 56.4Hz に対し
  **multiple=42 は headless 78.6fps で楽に超える** (余裕 1.4×)。TODO の「42 で音声 underrun 再発」懸念は
  非代表的な FreeDOS ベンチからの誤外挿だった。
- **大半のゲームは vsync 待ちで HLT する → HLT fast-forward (`hltflag=pccore.multiple`) で倍率が
  ほぼ無料**。倍率コストが効くのは「毎フレーム CPU 飽和する稀なゲーム」だけ。
  → **静的な multiple バンプは低価値** (共通ケース=HLT に無益・稀な CPU 飽和に危険) という結論。

**multiple を live 変更する罠:** `gdc.dispclock ∝ pccore.multiple` (gdc.c) がフレームあたり CPU 予算を
決めるため、`pccore.multiple` だけ書いても `gdc_updateclock()` を呼ばないと**倍率変更が一切効かない**
(実測で確認)。正しい live 反映は pccore.c の async-CPU クロック変更と同一カスケード
(`pcm86/nevent/sound/beep/mpu98ii/keyboard/mouseif_changeclock` + `gdc_updateclock`) が必須。

**engine の `SUPPORT_ASYNC_CPU` は使えない:** 実時間フィードバック `lastTimingValue` が初期化以外
どこにも代入されず**未結線** → 有効化しても throttle-down せず maxmultiple へ上げ続けるだけ。なので
フラグ有効化ではなく、engine の調整カスケードだけ借りて**フィードバックは我々の実時間信号で駆動**する。

- **`native/bridge.{c,h}` + `CMakeLists.txt`**: `np2kai_set_clock_multiple()` を追加 (reset 不要の
  live カスケード。np2cfg.multiple も書くので次 Run でも保持)。
- **`web/player/bridge.js`**: 適応コントローラ `autoClock` を run loop に実装。run_frame の wall-time を
  EMA で測り、1 step 予算 (1000/56ms) に対する負荷比で multiple を **[floor=20, ceil=42]** で 1 段ずつ
  増減 (hi=0.70/lo=0.40 ヒステリシス、評価 30rAF 毎)。host が速ければ自動で上げ (HLT-idle ゲームは
  ceil 張り付き)、遅ければ下げて pull 音声の枯渇を未然に防ぐ。**既定 ON** (重い host では floor=20 まで
  絞れるので最悪でも現挙動と同等)。`qbDebug.autoclock(0|1[,ceil])` / `qbDebug.multiple(n)` 手動固定を公開。
- **ceil=42 の根拠**: 60 だと vsync ロックゲームの CPU-bound バースト (ステージ遷移等) が速すぎになる
  (Nyahax で確認)。HLT 中の高倍率はプレイに無益で遷移だけ速くなる純粋な downside のため、速度上限を
  仕様の x42 快適化目標に固定。
- **`tools/bench_cpu/`**: CPU 飽和ベンチ資産を新設 (`boot_busy.asm` + `busy.d88` + `build.sh` +
  倍率 sweep `bench_multiple.js` + コントローラ収束テスト `test_autoclock.js`)。収束テスト合格:
  busy→24 安定 / HLT-idle→42 安定、発振なし。

検証: ビルド clean、headless bench (default path) 退行なし、exec_env_test PASS、JS スイート4本 pass、
収束テスト PASS、ブラウザ実機でユーザー確認済 (快適・音切れ無し)。

## [音声を pull 型に再設計 — ドリフト由来のプチ/途切れを根絶 (劇的音質向上)] — 2026-06-04

FM 音声が比較対象 **irori/np2-wasm** より明確に劣る (数秒ごとの「プチッ」「一瞬の途切れ」) 問題を、
**音声デリバリのアーキテクチャを pull 型に戻して**根治。実機 A/B で「AM ラジオと CD くらい違う」レベルの
劇的改善・途切れ皆無をユーザー確認済み。

**真因 = クロックのマスターが2つでドリフト**: 旧実装はプッシュ型だった — `np2kai_run_frame` を rAF
(`performance.now` の 56Hz catch-up) で回して生成 PCM を C リング→postMessage→AudioWorklet リング(~680ms)
に push し、Worklet が再生。生成レートは system 時計、消費レートは audio DAC の水晶発振器で、**別クロックが
必ずドリフト**し、リングが周期的に溢れ (古サンプル破棄=プチ) / 枯れ (無音=途切れ) ていた。`-O0` 時代に
メインスレッドジャンクから再生を守るため Worklet を足したが、**生成をメインスレッドに残したまま**だったため
ドリフトを再混入していた (調査で `sound.c` が CPU 駆動で呼ぶ `soundmng_sync` を乗っ取って push していたのが
スモーキングガン)。NP2kai の `sound.c` (`sound_pcmlock`/`pcmunlock`) は本来**オーディオコールバックから
引かれる pull 型前提**の設計で、irori はそれを SDL でそのまま使うから綺麗だった。

- **`native/qb_soundmng.c`**: 自前リング + `qb_audio_drain` を撤去。`qb_audio_fill(dst,frames)` を公開し、
  `sound_pcmlock`→soft-clip→`sound_pcmunlock` を引く**唯一の consumer** に。`soundmng_sync` は **no-op 化**
  (二重消費回避)。`streamprepare` は `remain` 上限管理で、consumer が fill だけでも sndstream は溢れない。
  バッファ長 = `soundmng_create` が `rate*ms/2000` を 2 の冪へ丸めた値 (= ScriptProcessorNode バッファ長)。
- **`web/player/bridge.js`**: AudioWorklet + メインスレッド pump + postMessage を撤去し、
  **`ScriptProcessorNode.onaudioprocess` (audio DAC クロックで発火) が毎回 `np2kai_audio_fill` を直接 pull**
  する形に。これでマスタークロックが audio DAC ただ 1 つ = **ドリフト原理的に消滅**。`audio-worklet.js` 削除。
- **`native/bridge.c/.h`・`CMakeLists.txt`**: `np2kai_audio_drain` → `np2kai_audio_fill` +
  `np2kai_audio_get_bufsize` に置換。`np2cfg.delayms=100` を明示 (ini 既定 0 だと最小バッファで underrun)。
- **SDL を使わなかった理由**: irori と同じ `SDL_OpenAudio` 経路 (`-sUSE_SDL=2`) も検討したが、SDL2 ポートの
  ネットワーク取得 + 書き込み可能 emscripten cache (`/usr/share/emscripten/cache` は root 所有で不可) を要求し
  環境と不適合。**SDL 依存を捨て、ScriptProcessorNode で同型 pull を自前 glue で実装** (我々の独自プラットフォーム
  層方針とも一致・SAB 不要なのでデプロイに COOP/COEP も不要)。音色は変えず (soft-clip 据え置き)、変えたのは
  デリバリ方式だけ。CPU 負荷は不変 (FM 合成量は同じ・むしろ postMessage コピー撤去で微減)。
- **別スレッド化 (AudioWorklet + SharedArrayBuffer でオーディオスレッド生成 = C2)** は将来課題。SPN は非推奨
  API だが全ブラウザで動作し、Emscripten SDL2 の非 worklet 音声も内部でこれを使う。

検証: ビルド clean、headless bench **77.6fps** (CPU 退行なし)、exec_env_test PASS (DOS ローダ/EXEC 回帰なし)、
**ブラウザ実機でユーザーが劇的音質向上・途切れ皆無を確認**。

## [HLE-DOS: EXEC 子の env を per-child 化し argv[0] を子パスに正規化 (C1)] — 2026-06-04

AH=4Bh EXEC の継承 (env_seg=0) で、子の PSP[0x2C] が最上位プログラムの env を共有し argv[0] が
親パス (例 A:\RAY.EXE) になっていた不具合を解消。実 DOS は子の env をコピーして子自身のフルパスを
argv[0] に置くので、自実行パスからデータ dir を切り出す子が将来動くようにした。

- `native/dos_loader.c`: **`build_child_env`** を新設。コピー元 env の変数部を二重NULまで境界付きで
  複製し `WORD=1` + `A:\<NAME>` (大文字) を追記してアリーナから確保。`qb_dos_exec_load` は継承時に
  env を**子本体より先に**確保 (子は最大空きブロックを丸取りするため) → child_psp 確定後に所有権を
  子へ付け替え (子終了で free-on-terminate、TSR では resize 任せで残留)。確保失敗時は親 env にフォールバック。
- `native/dos_loader.h` / `native/dos_int21.c`: `qb_dos_exec_load` に `child_name` 引数を追加し、
  EXEC ハンドラが子 basename を渡す。
- スコープ: **`env_seg!=0` (明示 env) は現行維持** (corpus に該当タイトル無し)。`build_child_env` は
  供給源セグを引数に取るので、完全 faithful 化は呼び出し1行の拡張で済む構造。
- `tools/exec_env_test.js` (新規・恒久): loader.d88 を実ブートしミニ COMMAND.COM に HELLO.COM を
  EXEC させ、(1) 継承 (env=0000) (2) 親 PSP 復帰 (EXEC 機構の回帰なし) (3) 子 env に A:\HELLO.COM
  (C1 解消) を assert する headless 回帰テスト。

検証: ビルド clean、headless bench 78.8fps (回帰なし)、JS スイート4本 pass、exec_env_test PASS、
ブラウザ実機で ザルバール (siz EXEC 往復) / Ray (RIN.COM 常駐+FM) / .bat 起動が従来どおり動作
(Ray 黒画面は無関係の既知課題)。

## [音響クリーンアップ: vol_master が fmgen に無影響と判明 → 65→100 中立化] — 2026-06-03

opngen 時代の名残の調査。**`np2cfg.vol_master` は既定の fmgen に一切届かない**ことが判明:
fmgen の音量は `opna_reset` が `vol_fm` で直接設定し、vol_master を畳む経路
(`fmboard_updatevolume`→`opna_fmgen_setallvolume*_linear`) は **opnalist が一度も populate されず &
fmboard_updatevolume が通常フローで未呼び出し**のため完全な no-op (grep で確認)。vol_master が効くのは
opngen/beep/psg(opngen)/cs4231 等の整数合成経路だけ。

- `native/bridge.c`: `np2cfg.vol_master` を **65→100 に中立化**。65 は opngen+ハードクリップ時代に
  「低音のビリビリ」回避で絞った値だが、(1) 真因はクリップ段で今は soft-clip が捌く、(2) そもそも
  fmgen には無影響、の二点から不要。コメントを実態に訂正。fmgen の音は変化なし (= 無影響の裏付け)。
- 補足: 前エントリで「soft-clip + vol_master=65 + -O3 で fmgen 高音質」と書いたが、vol_master=65 は
  fmgen の音質には寄与していなかった (効いていたのは soft-clip と -O3 の CPU 余裕)。
- fmgen の音量を変えたい場合の本物のレバーは `vol_fm` (opna_reset 経由)。今回はノブ化せず据え置き。

## [エンジン性能・音質: 実質 -O0 → -O2/-O3 で 2x 高速化 + FM を fmgen 既定化] — 2026-06-03

エンジンそのものの質を底上げ。2 つの独立した大きな改善。

- **ビルド最適化 (実質 -O0 → compile -O2 / link -O3)**: `CMAKE_BUILD_TYPE` 空・`target_*_options` に
  `-O` 指定無しで、IA-32 インタプリタ (毎フレームの支配項) が `-O0` 相当のまま動いていた。上流
  `sdl/Makefile21.em` と同じ「compile -O2 / link -O3」を `native/CMakeLists.txt` に self-contained 追加
  (build.sh 引数に非依存)。strict-aliasing は上流 libretro が `-fstrict-aliasing` で通すため無効化不要。
  - 計測 (`tools/bench_frame.js`、FreeDOS boot.d88 を headless 600 フレーム): **26.1→12.9 ms/frame =
    38.3→77.4 fps (2.02x)**、wasm **2.73→0.86MB (3.2x 縮小)**。`-O0` は実機 56fps 未達だったのが超えに転じ、
    multiple 引き上げ (快適化) と重い FM エンジンを払う余地が生まれた。
  - 回帰: JS スイート全 pass、boot 720 フレーム完走、実機でさめがめ/ザルバール/うさちゃん列車 動作・体感軽量化。
- **FM 音源を fmgen 既定化** (`native/bridge.c` `usefmgen=1`): 以前は「低音のビリビリ」で opngen を選んで
  いたが、真因は **soft-clip 導入前のハードクリップ**だった。soft-clip + `vol_master=65` + `-O2/-O3` 後の
  実機 A/B で fmgen が明確に高音質と確認 (ユーザー評「opngen では埋もれて聞こえなかったパートが表に出る」)。
  CPU は重いが `-O3` の余裕で吸収 (処理落ちなし)。
- **FM エンジンの実行時 A/B トグル**: `np2kai_set_fmgen(0|1)` (`bridge.c/h` + CMake export) / `qbDebug.fmgen(0|1)`。
  `np2cfg.usefmgen` を書くだけで `pccore_reset` が再読込し `opna_bind` が再ディスパッチ → 次の Run で反映。
  音質チューニング/回帰確認で再利用する道具。`tools/bench_frame.js` も headless A/B ベンチとして恒久追加。

## [② ミニ COMMAND.COM — 起動 .bat を 1 DOS セッション内で逐次 EXEC (音源ドライバ TSR 常駐)] — 2026-06-03

①(.bat レシピ解釈) の積み残し **②** を実装。Run 毎に `pccore_reset` で別 DOS セッションになる構造では
ドライバを常駐させても本体に効かない。そこで **最上位プログラムとして小さなシェル (ミニ COMMAND.COM) を
起動し、.bat のコマンドを順に `AH=4Bh EXEC` する**ことで、`mdrv98`(TSR 常駐) → game → `mdrv98 -r` を
**1 セッション内**で実行する (= 実 DOS の `COMMAND.COM /C batch` 相当)。EXEC / TSR(31h) / MCB /
free-on-terminate は既存機構をそのまま再利用 — **追加は「親シェル」だけ**で、既存の単一起動・EXEC 経路
(さめがめ〜うさちゃん列車・zar・Ray) には一切手を入れていない (回帰リスク隔離)。

- **新規 `tools/dos_loader/shell.asm`** (nasm → `shell.bin` → `native/dos_shell_blob.h`、`bin2h.py` 生成):
  COM。起動時にスタックを KEEP 領域 (0x200 para=8KB) 内へ退避 → `AH=4Ah` self-shrink (子に ≈632KB を渡す)
  → コマンド表を順に `DS:DX=パス / ES:BX=パラメータブロック / AX=4B00 / INT 21h` → 全完了で `AX=4C00`。
  表 (count + path_off/tail_off ペア + ASCIZ パス/DOS cmdtail) は C が blob 末尾 (`table:` ラベル) に append。
- **`native/dos_loader.c/h` `qb_dos_stage_script()`**: shell blob + コマンド表を COM image に組んで stage。
  子イメージのバイトは渡さない (展開済 `/run` から `AH=4Bh` が case-insensitive 解決して読む)。
- **`native/bridge.c/h` `np2kai_dos_stage_script(script,len,name)`** (CMake export 追加): script は
  `"PATH\tARGS\n…"` の**生バイト** (SJIS パス名を壊さないよう NUL 終端でなく len 指定)。
- **`web/player/batscript.js` `resolveSequence()`**: .bat を**元の順序**でコマンド列に解決 (ドライバ常駐込み)。
  制御フロー (goto/if) 入りや本体不在は `null` → ①(単一起動) にフォールバック。束に無いコマンドは skip。
- **`web/player/bridge.js`**: Run 時に複数コマンド (本体+ドライバ・制御フロー無し) なら `stageAndRunScript`
  でシェル起動、それ以外は従来の単一起動。staging 後の共通処理を `runStaged()` に集約。
- **起動 .bat の中身が読める** (③敬意): .bat を選ぶとテキスト面に**生の .bat 内容**を表示し、先頭に
  **解釈した起動順** (`▷ 起動順 (1 セッション逐次 EXEC): MDRV98.COM → … → MDRV98.COM -r`) を注記。
  起動不能な .bat も中身は読ませる。`openText(ent, annotation)` 拡張 + `batRecipeSummary()` (純 JS)。

検証: `tools/batscript_test.js` **33/0** (resolveSequence の順序保持/制御フロー null/単一=1要素/skip を追加)。
回帰: `diskimage_test` 30/0・`lzh_l1ext_test` PASS・`lh5_test` 420/0、emscripten ビルド (bridge/dos_int21/
dos_loader) クリーン、export 確認済。**ブラウザ実機で FM 音源が鳴ることをユーザー確認 (2026-06-03)** ―― 
音源ドライバが 1 セッション内で常駐し本体に効く ② の核心が成立。

**既知の割り切り / 次の課題**: ① 子は `env_seg=0` 継承で起動するので **argv[0] は最上位 (シェル) のパス**に
なる (C1)。mdrv98 等は argv[0] を読まないので未影響だが、argv[0] からデータ dir を得る本体が .bat 経由だと
破綻する → `qb_dos_exec_load` の **per-child env** で正す (共有 EXEC 経路を触るので独立ステップ)。
② TSR が旧式 `INT 27h` を使う場合は現状 IRET スタブ止まり (`AH=31h` のみ対応)。③ `-r` 常駐解除は
best-effort。④ 制御フロー .bat の線形化は未対応。

## [起動 .bat を「作者の起動レシピ」として解釈 — エントリ自動検出に統合] — 2026-06-03

PC-98 フリーソフトの約 1/3 (調査: `games/` 40 書庫中 14 本) は起動 .bat を同梱し、主プログラム名・
引数 (`%1..%9`)・音源ドライバの常駐手順を書いている。この .bat を「作者が書いた機械可読の起動レシピ」
として解釈し、「実際に走らせる主プログラム + cmdline」を導出してフロントのエントリ自動検出に橋渡しした。
**純 JS・Wasm 不変。**`db/games.json` への手書き (entry/cmdline) が実質不要になる。

- **新規 `web/player/batscript.js`** (`qbBatScript`): .bat バイト列 → 起動レシピ。`^Z`(0x1A) 切り・
  CRLF 分割・`rem`/`echo`/`@`/`:label`/`goto`/`if` 除去 → コマンド行を `{program,args}` に。音源ドライバ /
  セットアップ常駐 (mdrv98/middrv/middrv98/middrvpc/opndrv/ssgdrv/tkydrv/cats/calib/mfree 等) を分類して
  主プログラムを特定。`resolveMain` (ドライブ `X:`・パス剥がし → DOS の `.COM`>`.EXE` 解決・大小無視) と
  `buildCmdline` (`%1..%9` をユーザー入力で置換、リテラルフラグ `-B1` 等は保持、`%0`/未入力 `%N` は除去)。
- **`web/player/bridge.js`**: エントリ検出を .bat 対応に。**起動 .bat があれば最優先で自動選択** (作者の
  意図したレシピ)、複数 .bat (起動方法/音源モードの選択肢) は一覧から選ばせる、Run 時にレシピ引数へ
  cmdline 欄の `%N` を差し込んで主プログラムを起動。.bat 行は金色太字 (▷) で強調しランク上位に。
- **`web/index.html`**: batscript.js 読込 + `.frow.bat` CSS。
- **`db/games.json` は元々 Run 経路から未参照** (dev fixture)。.bat 化でフリーソフト一般に対し手書き辞書なしで
  entry/引数が決まる。.bat を持たない裸タイトル用の薄いフォールバックとしてのみ残す。

検証: `tools/batscript_test.js` 新規 **26/0** (合成 fixture。games/ は再配布不可でコミットしないので調査パターンを
再現)。実書庫の全 .bat 26 個をローカル横断 → すべて妥当な主プログラムに解決 (zar.bat→zar.exe、
tw0.bat→twopn "1 0 0 0"、finaltyb→findemo "-B0"、ドライバ全除外)。回帰: `diskimage_test` 30/0・
`lzh_l1ext_test` PASS・`lh5_test` 420/0、JS 構文クリーン。

**既知の MVP 制約 (= 次の課題 ②)**: 制御フロー付き .bat (コーパス唯一の finalty 系) は demo 止まり。
音源ドライバ TSR の実常駐 (mdrv98 → game → mdrv98 -r を 1 セッションで保つ) は、Run 毎に `pccore_reset` で
別セッションになる都合上 JS だけでは無理 → C 側に AH=4Bh EXEC ベースの COMMAND.COM もどきが要る
(別セッションで実装予定。Ray IV の rin.com 常駐経路を再利用)。

## [ディスクイメージ取り出しの実機目視確認 + SJIS 名テストの恒久化] — 2026-06-03

ディスクイメージ「ブートせず中身取り出し」(2026-06-02 実装) の **ブラウザ実機目視を消化**。
コード変更は無く、未テストだった経路を 1 つ自動テストに固定した (docs/test のみ)。

- **実機目視 OK**: ①`boot.d88` (FreeDOS=FAT12) の取り出し + サブディレクトリ再帰 + パンくずでのフォルダ
  往復 / ②自己起動・非FAT (`np2kai_boot.d88` 等) を赤線で弾く / ③恒久対応外 (`.nfd`/`.hdb`/`.fdd` =
  NFD/BKDSK/VFDD) の形式別メッセージ / ④漢字ファイル名が化けず SJIS 表示。
- **④ の盲点と対策**: `games/` の全書庫・全ディスクイメージは**ファイル名が ASCII 8.3 のみ**で、
  表示側 `sjisName()` の SJIS 復号分岐を踏むデータが corpus に存在しない (= これまで実質未検証)。
  日本語 8.3 名 (`漢字.TXT` = 生 SJIS `8a bf 8e 9a`) を 1 本持つ**合成 FAT12 `.hdm`** を作って実機確認。
- **`tools/diskimage_test.js` に SJIS セクション追加**: 同じ合成イメージを in-memory で組み、抽出した
  名前が①生 SJIS バイトを保持し②`漢字.TXT` に復号されることを assert。`lzh_l1ext_test.js` と同じ
  「corpus で覆えない経路は合成データで守る」方針。回帰 = **pass 30/0** (旧 27 + SJIS 3)。

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

NP2kai のテキスト面描画は **セル単位の dirty-flag 最適化 (`tramupdate[]`)** を持っており、メモリ直書き
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
- **dirty-flag 通知は GDCSCRN_ALLDRAW2 一択**: セル単位 dirty (`tramupdate[]`、当時は内部詳細
  不明・2026-06-11 に確認) を個別に立てる代わりに「全セルを次フレーム再描画」フラグで対応。
  毎 putc で立つので最適化余地はあるが、無害 (NP2kai 自身の合成 BIOS bios18.c と同じイディオム)
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
