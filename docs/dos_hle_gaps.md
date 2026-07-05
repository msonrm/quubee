# HLE-DOS (INT 21h) の実 DOS との差異・未対応一覧

> 2026-06-02 調査。`native/dos_int21.c` / `native/dos_loader.c` のコードベース調査結果。
> QuuBee の DOS は「実 DOS の忠実再現」ではなく、**フロッピー2D・〜1998 年の同人/フリー
> ソフト向けに INT 21h を ~38 fn だけ HLE 実装したサブセット**（CLAUDE.md 記載のカバー率
> 80〜90% 想定）。BIOS レベル（INT 18h/1Bh/1Ch/DCh 等）は NP2kai の合成 BIOS が担当する
> ので、本書の「未対応」は **DOS(INT 21h) 層に限った話**。

実装済み AH: `01 02 06-0C 0E / 19 1A 25 29 2A 2C 2F / 30 31 33 34 35 36 38 39-3B / 3C-4F /
50 51 52 58 62 63`（ディスパッチは `dos_int21.c` の `qb_dos_int21_dispatch()`）。
2026-07-05 訂正: 旧記載の「01-0C」は過大申告 — **AH=03/04/05 (AUX in/out・PRN out) と 0Dh
(disk reset) は未実装**で default（CF=1/AX=1）に落ちる。実 DOS の AH=05h はエラーを返さない
関数なので、プリンタ出力を試すソフトは CF=1 を受ける（大半は無視する）。PRN 経路は
TODO.md「プリンタ出力 → ブラウザ」参照。

## 1. 未実装の INT 21h ファンクション（`default` → CF=1, AL=01「invalid function」）

| AH | 機能 | 影響度 | 状態 |
|---|---|---|---|
| **39/3A/3B** | MKDIR / RMDIR / **CHDIR** | 高（セーブ用フォルダ作成・カレント移動が破綻） | ✅ 2026-06-02 実装 |
| **36** | Get Disk Free Space | 高（空き容量チェックで誤判定） | ✅ 2026-06-02 実装（合成値） |
| 0F-17,21-24,27,28 | FCB 系ファイル I/O 全般 | 中（〜DOS2 系・FCB FindFirst） | 未対応 |
| 56 / 57 | Rename / Get-Set ファイル日時 | 中（temp→rename セーブ・書庫ツール） | 未対応 |
| 59 | Get Extended Error | 中（エラー後の詳細コード取得） | 未対応 |
| 63 | Get DBCS Lead-Byte Table | 中（日本語特有。多くはハードコードにフォールバック） | ✅ 2026-06-09 実装（東方 op.exe の壁①） |
| 62 / 50 / 51 | Get/Set PSP | 中 | ✅ 2026-07-02 実装（`g_cur_psp` を BX で往復するだけ。SimK 氏 EXECTEST で顕在化 — 62h 未実装だと BX=0 のまま返り、子が ES=0 の IVT を PSP と誤読して command tail 表示が漢字化けする。回帰 `tools/exec_psp_test.js`） |
| 00 | Terminate（旧式） | 低（終了は INT 20h / 4Ch 想定） | 未対応 |
| 2B / 2D | Set Date / Set Time | 低（Get のみ実装） | 未対応 |
| 38 | Get/Set Country Info | 中（QB 日本語ランタイム等が起動時に呼ぶ） | ✅ 2026-07-02 実装（日本 country 81 固定・YMD・通貨 "\"・24h・case-map は far RET スタブ。Set は日本以外を正直に拒否。回帰 `tools/country_info_test.js`） |
| 5B / 5A / 67 / 68 … | 排他作成 / temp / handle 数 / commit | 低〜中 | 未対応 |
| 4B AL=01,03 | Load-only / オーバーレイ | 中（大きめゲームの overlay） | AL=03 ✅ 2026-06-09 実装（東方 op→main 遷移）。AL=01 ✅ 2026-07-02 実装（exec_load の load-only モード: CPU は切り替えずパラメータブロック +0Eh..+15h に初期 SP/SS/IP/CS を書き戻し、current PSP は子へ。COM は AX 初期値 word を積んで SP=FFFC = np21w 一致。回帰 `tools/exec_psp_test.js`） |

## 2. 実装済みだが実 DOS と挙動が異なる点

1. **ファイルハンドル = ホスト `FILE*`（DOS の SFT ではない）**
   - 45h DUP / 46h DUP2 が**ファイルポインタを共有しない**（同 path/mode で開き直して seek する独立ハンドル）。read 用途では実用上等価だが、dup 後の interleaved seek/read は乖離。
   - ~~**stdin(ハンドル0)からの 3Fh Read が "invalid handle"**（`fh_get(0)`=NULL）。実 DOS はキーボードを読む。AH=0Ah 経由なら可。~~ → ✅ 2026-06-30 実装（handle 0 を CON の cooked 行入力に分岐 — Enter まで待って「行 + CR LF」を返す・BS 行編集・エコー付き。TurboC の getchar/scanf/gets が動く）。✅ 2026-07-02 さらに実 DOS の行持ち越しへ是正（takapyu 氏実機指摘）: **CX の大小はブロックに関係せず CX=1 でも Enter まで戻らない**。行はホスト側行バッファ（255+CR LF）に組み立て、CX で読み切れない分は次回 read が待たずに受け取る（getchar 型の 1 バイト読みは行を 1 バイトずつ配る形）。BS の SJIS 全角は行頭からのパリティ走査で文字境界を確定して 2 バイト消す（AH=0Ah の BS も同ヘルパ）。回帰 `tools/stdin_read_test.js` / `stdin_partial_line_test.js` / `stdin_cx1_test.js`。✅ 2026-07-02 **raw(binary) モードも実装**: IOCTL AX=4401h の bit5 (0x20) を実際に保持（AX=4400h が反映して返す・実 DOS 同様 DH≠0 はエラー）。raw の read はエコー無し・行編集無し・CR LF 変換無しで **CX バイトそろい次第返る**（CX=1 なら 1 キーごとに即返し）。takapyu 氏提供の NORMAL.COM / RAWMODE.COM（実バイナリ）で両モードとも実機挙動一致を確認。残る差異: Ctrl-C/Ctrl-Z 特別扱いなし・raw フラグは CON 全体で 1 本（handle 0/1/2 共有 = 実 DOS の SFT 単位と同じ実効）。
   - ~~**EXEC 子の終了時にハンドルを閉じない**＋ハンドル表 `g_fh` がプロセス間共有 → ランチャ往復でハンドル枯渇~~ → ✅ 2026-06-02 修正（子が開いたハンドルだけ子終了で close。TSR は常駐なので閉じない）。

2. **カレントドライブ/ディレクトリ** — 19h は常に A:(=0)。ドライブレターは剥がして `/run` に集約するので、**A:/B: を別ボリュームとして使う2枚組ゲームは両者が混ざる**。CHDIR は ✅ 実装したが「ドライブ」は依然 1 つ（`g_cwd` で論理カレントを保持）。
   - **パス解決（`read_dos_rel`）は 8.3 フィールドのパディング空白を除去**（2026-06-15）。DOS の 8.3 名に空白は入らない（空白＝FCB の埋め文字）ので、プログラムが FindFirst 結果を 11 byte FCB 形式で持ち `"NAME    .EXT"` の形で再 open するケース（MUAP98 が選択曲を開く経路）でも実 DOS 同様に開ける。`0x20` は SJIS リード/トレイル範囲外なので DBCS を壊さない。
   - **起動 .bat の `cd` / `set`**（2026-06-15）— ミニ COMMAND.COM（`shell.asm` + C 文インタプリタ）が `cd PATH` で `g_cwd` を移動し（`qb_dos_chdir`）、`set VAR=VALUE` を DOS env に反映して以降 EXEC される子へ継承させる（環境変数でデータディレクトリを知る MUAP98 等のため）。env ブロックは 256 byte 固定なので収まらない set は honest に捨てる。

3. **FindFirst/Next がグローバル1本（`g_find`）** — 実 DOS は検索状態を DTA に持つので入れ子・並行検索が可能。2 つ目の FindFirst が 1 つ目を破壊。DTA の reserved 検索状態も書かない。
   - **wildcard 照合（`dos_wildcard_match`）は実 DOS 流の `name.ext` フィールド分割**（2026-06-15）。`.` を含む pattern は base/ext を別々に glob するので `*.*` は拡張子の無い名前（ディレクトリ `NORM` 等）にも一致する（MUAP98 のファイラがサブディレクトリを巡回できる）。`.` を含まない pattern は名前全体に char glob（末尾 `*` は `.` を跨ぐので `FOO*`→`FOO.BAR` 可、ただしワイルドカード無しの `HTJL` は `HTJL.COM` に**一致しない**＝実 DOS で ext 空のみ。緩めると「素の名前で FindFirst→無ければ `.COM` 補完」型のソフト＝GS100=gsnake が誤分岐で壊れる）。

4. **ファイル属性 43h** — Get は常に 0x20(archive)、Set は無視。read-only/hidden を区別しない。

5. **MCB チェーンは実 DOS 同様の単一連続鎖**（2026-06-09 で忠実化）。先頭 MCB `g_first_mcb`=env ブロックの MCB（`ENV_SEG-1`）から、**env ブロック → プログラム本体ブロック → 空きアリーナ**を 0xA000 まで連続被覆する（いずれも owner=最上位 PSP）。env・プログラム本体も実 MCB なので、それらの `AH=4Ah` resize / `AH=49h` free / 先頭から歩くメモリツールが忠実に動く。**無効ブロックの resize/free は嘘の成功でなく `AX=9`（invalid memory block address）/ CF=1 で正直に失敗**。
   - **AH=52h (Get List of Lists)** は最小の**合成 List of Lists** を返す（segment 0x00A0）。`[BX-2]`=先頭 MCB は `g_first_mcb`（=env の MCB、実 DOS 同等）、DPB/CDS/デバイス系は `0xFFFF`「無し」、NUL デバイスヘッダ・LASTDRIVE=5・max 512B/block のみ実値。master.lib 系 (例: Super Spartan の本体 `sspartan.d98`) の「先頭 MCB を辿って利用可能メモリを算定する」用途に十分。
   - **`[+4]` first SFT は合成 SFT ブロックを指す**（✅ 2026-06-11、`QB_SFT_SEG=0x00B0`、DOS 5 形式: ヘッダ 6B + 8 エントリ × 0x3B、FCB 名 +0x20 / file size +0x11）。チェーン先頭に `FFFF:FFFF`「無し」は**置けない** — 実機の SFT walker（PMD86.COM の install-check 等）は先頭ポインタを終端チェックなしで follow するため、ゴミ count/next を辿る無限走査になる（TH03 GAME.BAT ハングの真因だった）。エントリには実 DOS 同様「**直近 EXEC/ロードしたファイルの stale エントリ**」（close 済 ref=0、名前+実ファイルサイズ）を 1 本だけ書く（loader-start と AH=4Bh EXEC で更新、`qb_dos_sft_note_load`）。PMD86 はこれで自分を発見しサイズ照合まで実 DOS と同じ経路で成立する。**差異**: AH=3Dh open / 3Ch create は SFT エントリを作らない（ハンドルはホスト `FILE*`）ので、「開いている全ファイル」を SFT で列挙するツールとは整合しない。回帰 = `tools/sft_test.js`。DPB/CDS を実際に辿るツールも未整合（必要になったら実体を足す）。

6. **DOS 経由の拡張キー入力が落ちる** — BIOS キーバッファの**下位バイト(ANK)だけ**返す。矢印/ファンクションキー（DOS では 00h+スキャンコードの2バイト）の2バイト目が失われる。多くは BIOS INT 18h / 生 IRQ で読むので実害限定。

7. **Ctrl-C / Ctrl-Break を検出しない**（33h は値保持のみ、INT 23h は IRET スタブ）。

8. **最上位プログラムの PSP 既定 FCB はパースしない**（0x5C/0x6C はゼロ）。**AH=4Bh EXEC の子は ✅ 2026-06-09 で実機 COMMAND.COM 同様にコマンドテイル第1/第2トークンを FCB1/FCB2 へ parse 済**（東方 zun.com の常駐成立に必須だった）。引数を PSP FCB から読むソフトを直接 stage した場合のみ引数を得られない（0x80 コマンドテイルは正常）。

9. **セーブが揮発** — 書き込みは MEMFS `/run`。セッション中（Run 往復）は残るが**ページ再読込で消える**。永続化（IndexedDB 本棚）は別レイヤの将来課題。

10. AH=09h は `$` が無い場合 4096 byte で打ち切り。AH=0Ah のバッファ満杯は BEEP せず黙殺。
    tty 制御コードは CR/LF/BS に加え **TAB(0x09)→8桁タブストップ前進**・**BEL(0x07)→無視**（2026-06-07 追加。
    GBOX ヘルプの行頭乱れ対策）。**SJIS 区9-11（NEC 半角グラフィック/罫線、SJIS 0x86xx）は半角=1セル幅**で描く
    （`vram_put_kanji_half`、同日。全角扱いで2セル書くと横2倍に化けた＝Ray IV の枠崩れの真因）。
    **DOS CON ワークエリア `0000:0711h`（fkey 行表示状態）/`0712h`（テキスト行数−1）/`071Dh`（現在属性）を
    維持**（2026-06-11）— 起動時 0/24/0xE1（fkey 非表示・25 行・白。我々はファンクションキー行を描画しないので
    これが正直な状態）に初期化し、私用シーケンス **`ESC[>1h/l`（fkey 行 非表示/表示）・`ESC[>3h/l`（20/25 行）**
    で追従更新する。master.lib（`TEXT_HEIGHT`/`text_fillca`）はこのバイトを**直読み**するため、未初期化（=0）だと
    全画面 fill が 1 行で切れる＝**東方が黒反転セルで隠す VRAM タイルキャッシュ（右端 64×400px）が露出**していた
    真因。`ESC[>5h/l` は**カーソル非表示/表示**（master.lib TEXT_CURSOR_HIDE/SHOW）— カーソル非描画なので
    no-op（同日修正。旧解釈「テキスト面 ON/OFF」は終了時の `>5l` でテキスト面を消す地雷だった）。20 行モードは
    bookkeeping のみで tty 描画自体は 25 行のまま。
    **SGR（`ESC[...m`）は実装済み**（同日、NEC CON 準拠 = DOSBox-X dev_con.h と突合）: 毎シーケンス先頭で
    属性リセット（絶対指定）、30-37=文字色（ANSI RGB→PC-98 GRB 写像）、40-47=色+**反転**（背景色は無い）、
    17-23=NEC 別系色コード、2/4/5/7/8=bit4/下線/点滅/反転/シークレット、空 param=0（リセット）。回帰 =
    `tools/sgr_test.js`。
    **CON ワークエリアの残りスロットも live 化**（2026-07-03、SimK PC98WORK/PC98RET で判明・DOS 3.x 世代の
    実機結果と突合）: **消去系（ESC[J/K・cls）とスクロール新規行は現在属性でなく `0719h`（クリア文字、既定
    20h）+ `0714h`（クリア属性、既定 E1h）で埋める**（SGR で色を変えたままスクロールしても新規行は白 = 実機の
    観測面）。**現在属性 `071Dh` は出力前に読み戻す**（直書きが次の出力から効く）。**`ESC[s/u` の保存先は
    `0726h/0727h/072Bh`（Y/X/属性）で、ESC[u は毎回 live 読み**（直書きで飛び先を差し替え可能 = DOS 3.x 意味論。
    DOS 6.x には one-shot 化+属性無視+word スロット `013Ch/013Eh` 参照という世代差があるが、古典 byte 側で統一。
    word 側は起動時初期値 00E1 のみ）。起動時既定は PC98WORK PAGE1 の実機 dump と一致（`071Bh`=1 含む）。
    **AH=02h/06h/09h は AL を返す**（02h: AL=出力文字・TAB は展開スペースの 20h / 06h: AL=DL / 09h: AL=24h、
    PC98RET と突合）。回帰 = `tools/conwork_test.js`。**残**: スクロール範囲 `011Eh`(top)/`0112h`(bottom) の
    窓スクロールは未対応（全画面固定。実 DOS は DOS3/6 とも窓内だけ回る。corpus 未遭遇のためゆるい TODO —
    TODO.md 参照）。
    **INT DCh（DOS CON 拡張）= キー定義 setkey/getkey を実装済み**（2026-06-20〜24）。`CL=0Dh` setkey は
    2 系統あり、どちらも C 側正準テーブル `g_keytbl`（KTBLSZ レイアウト）へ書く: `AX=0` で全体一括（VZ Editor
    が使う・386byte 表を丸ごと）、`AX=key# 1..31` で 1 キー単位（JED が使う・key# のスロットに発行文字列だけ）。
    `CL=0Ch` getkey も AX=0/key# 両対応。ソフトキー押下（bios09 が char=0x00 で enqueue）を `g_keytbl` の
    発行文字列に翻訳して DOS 文字入力へ流す（`softkey_fill`）→ エディタのカーソル/編集キーが効く。未 install
    （`g_keytbl_set=0`）なら従来どおり char をそのまま返す＝非エディタはゼロ回帰。その他 CL（fkey 行表示 on/off
    の 0x0F/0x10/0x11 等）は良性 no-op。**残**: JED は GDC ハードウェアカーソルを表示するが位置を一切設定しない
    （CSRW/AH=13h 皆無）作りなので点滅カーソルが左上に居座る（バイナリに位置設定コードが無く実機でも同じはず）。

12. **AH=58h（メモリ確保ストラテジ）は実際に効く** — get/set strategy（下位 2 ビット: 0=first-fit / 1=best-fit /
    2=last-fit）を MCB アロケータが honor する（2026-06-09。last-fit を要求するゲームに first-fit で応えると本体直上を
    埋めて PSP ブロックの拡大を阻害し破綻した＝GOGGLE-II の真因）。**UMB リンク状態（AL=02/03）は持たないので「無し・成功」**
    を返す（2026-06-07、GBOX United モードの AX=5803h 対策）。UMB（上位メモリブロック）の実体は無い。

11-a. **ディレクトリの open は実 DOS どおり失敗する（✅ 2026-07-03）** — MEMFS の `fopen` は
    ディレクトリでも成功して FILE* を返すため、AH=3Dh/3Ch がディレクトリ（空ファイル名が
    カレントに解決されるケース含む）に偽ハンドルを返していた。呼び手は seek end の異常サイズで
    確保を試みる等の遠隔誤動作になる（MIMPI 引数なし起動の "Out of memory !" が実例。根治後は
    本来の "Song file does not exist." 表示）。`dos_open_common` で `fs_stat` + `S_ISDIR` を
    検査し error 5 (access denied) を返す。

11. **パス解決が `.`/`..` を畳まない（CHDIR とは非対称）** — `read_dos_rel`/`resolve_dir`（open/create/
    delete/exec/findfirst が通る）は `\`→`/`・大小無視・カレント前置はするが `.`/`..` を正規化しない。一方
    `AH=3Bh CHDIR` は `..` を畳む。実害は限定的: `..` は MEMFS のホスト解決で自然に親へ落ちるので**展開ツリー内の
    親参照（`..\COMMON\DAT` 等）は正常動作**し、`/run` より上に登る `..` を多用した時だけ無防備になる。その場合も
    到達先は**揮発・完全仮想の MEMFS**（実機 FS 不可達・guest にネットワーク egress 無し＝流出経路なし・本棚
    IndexedDB は guest 名前空間外）で、最悪でも `/tmp` の loader.d88/スロット画像を踏んで**そのセッションが自爆する
    だけ**（再読込で復旧）。フロッピー2D 同人は install root 内で動くのが基本なので発生確率も低い。**対策保留**
    （2026-06-03 判断）。直すなら read_dos_rel/resolve_dir に `.` 破棄 + `..` で1段上がる正規化を入れ、`/run` より
    上には登らせず clamp すれば CHDIR との非対称も解消する（~15 行、defense-in-depth）。

13. **ファイル名の正準形（2026-06-10 統一）** — 不変条件: **MEMFS ノード名 = SJIS 生バイト列を
    1 文字 1 バイトで U+0000-00FF に写した JS 文字列（latin1）**。JS 側（archive.js / diskimage.js）は
    この形で書き、表示だけ `decodeSjisText` が SJIS→Unicode に復号する。C 側は内部パスを生 SJIS に
    統一し、変換は次の 2 箇所だけ:
    - 読み（d_name → 内部）: `utf8_next_lowbyte` / `ci_equal_fsname` / `fold_fsname_to_sjis`
    - 書き（内部 → libc）: `fs_path_utf8` + `fs_fopen/fs_opendir/fs_stat/fs_unlink/fs_mkdir/fs_rmdir`
      ラッパ群（`dos_int21.c`）。**ラッパを通さず DOS 由来パスで libc を直接呼んではならない** —
      Emscripten がパスを UTF-8 復号し、不正バイトを TextDecoder が U+FFFD に潰す（不可逆。
      「東」93 60 と「残」8E 60 が同名に衝突）。自己展開書庫（東方 TH03-05 等）が AH=3Ch で作る
      SJIS 名が化け・相互上書き・FindFirst 不一致になった真因で、2026-06-10 に根治。
    - パス読み取り（`read_dos_rel` / CHDIR）は DBCS ペアを素通しし、トレイルバイト 0x5C
      （「表」95 5C 等）を `\` 区切りと誤解しない（実 DOS と同じ DBCS-aware パース）。
    - 回帰テスト: `tools/create_sjis_test.js`（ゲスト作成・衝突・round-trip）/
      `tools/find_sjis_test.js`（find↔open 対称）。
    - 残課題: JS 側の書庫内パス区切り変換（bridge.js `dosPathToSlash`）は 0x5C トレイル非対応
      （トレイル 0x5C を含む SJIS 名がパス区切りに化ける。corpus では未遭遇のため保留）。

## 3. INT 21h の外（DOS 周辺機能）

- **XMS（HIMEM.SYS 相当）= 実装済み（Tier 1 MVP、2026-06-05、既定 ON）**。EXTMEM 32MB は
  `i386core.e.ext`（`CPU_EXTMEM`、`extbase = ext - 0x100000`）に実在し、これを「HIMEM ロード済の DOS」
  として素直に再現する。`native/dos_xms.{c,h}`。
  - 経路: ゲームが INT 2Fh `AX=4300h` で検出（→`AL=80h`）→ `AX=4310h` で driver entry 取得
    （→`ES:BX = F000:EE70`）→ その far アドレスを CALL FAR して `AH`=関数番号で各機能。entry は
    `dos_loader.c` のトランポリン（NOP+RETF, `QB_TRAMP_XMS_ENTRY`）。
  - EMB は `CPU_EXTMEM` のサブ領域に first-fit 確保（先頭 64KB は HMA 用に予約）。実装関数 = `00h`Version /
    `08h`Query free / `09h`Alloc / `0Ah`Free / `0Bh`**Move**（物理 memmove、handle=0 は conventional の seg:off）/
    `0Ch`/`0Dh`Lock/Unlock（実 linear `0x100000+offset` を返す）/ `0Eh`Info / `0Fh`Realloc / `03h-07h`A20（成功応答）。
    戻り値は XMS 3.0 契約（成功 AX=1 / 失敗 AX=0+BL=err）。
  - 未提供（素直に「無い」と応答）: HMA（`01h/02h`→BL=0x90）/ UMB（`10h/11h`→BL=0xB1）/ 32-bit版（`88h/89h`）。
  - 制御/診断: `qbDebug.xms(0|1)`（既定 ON、A/B 用に切替可）→ `{enabled, handles, usedKB, freeKB}`。
    検証 = `tools/xms_test.js`（合成 COM で検出→entry→alloc→Move 往復のバイト一致）。実証 = AMEL `/X` が
    338KB EMB を確保（games/mem_test）。
  - ⚠ **既定 ON は全タイトルへの提示挙動を変える（許容済みの設計判断、2026-06-05 記録）**: INT 2Fh `AX=4300h`
    が全ゲームに「XMS あり」と返すようになった。これまで XMS 無しで conventional にフォールバックして動いていた
    タイトルが XMS 経路に入り、未実装 fn（`default`→`BL=0x80` NOTIMPL や HMA 拒否 `0x90`）に当たって挙動が
    変わる可能性がある（実装済みは EMB 標準ライフサイクルを網羅するのでリスクは低い）。**回帰が疑わしい時は
    `qbDebug.xms(0)` と ON で A/B** すれば切り分けできる。困ったらタイトル別に既定を OFF へ落とす余地あり。
  - ⚠ **Move（`0Bh`）は奇数長を `BL=0xA7`(BADLEN) で弾く（仕様準拠だが実 HIMEM より厳格、2026-06-05 記録）**:
    XMS 3.0 仕様は「長さ偶数」だが実 HIMEM.SYS は奇数長も通す。当方は素の `memmove` で偶奇に依存しないため、
    奇数長 Move を要求するタイトルが現れたら `dos_xms.c` の `if (length & 1)` ガードを外せば寛容化できる
    （faithful 寄りにするなら外す方が互換的）。現 corpus に該当は未確認。
- **EMS（EMM386 相当）= 未実装**。INT 67h は需要プローブのみ（検出ログ+カウント、応答は「無し」）。
  - **需要プローブ常設（2026-06-05）**: INT 2Fh `AX=43xx` / INT 67h / `EMMXXXX0` デバイス open を
    「検出ログ + 件数カウント」化。XMS 無効時は INT 2Fh も「無し」と応答。集計は `qbDebug.memprobe()`
    → `{xms, ems, emmOpen}`（Run 毎リセット）。実装 = `dos_loader.c`（trampoline 0xFEE50/0xFEE60）+
    `dos_int21.c`（AH=3Dh で `EMMXXXX0` 検出）。検証 = `tools/memprobe_test.js`。
  - **盲点**: エディタ系（JED/mm46/VZ 等）の EMS 検出は IVT[0x67] のドライバヘッダ署名をメモリ読みで
    memcmp するパッシブ方式で、INT 67h も open も通らず能動カウント不可。バイナリ内 `EMMXXXX0` の有無が
    より確実な EMS 需要シグナル。
  - 実装する場合: EMS はページフレーム（D000:0000 の 64KB 窓）の copy 同期エミュが要るため XMS より重い。
    DPMI/DOS エクステンダは射程外。
  - **据え置き判断の根拠（2026-06-05、静的サーベイ + 実クライアント検証）**: `games/mem_test` 14 本を
    静的スキャンした結果、`EMMXXXX0`（EMS）を実行ファイルに持つのは 5 本（VZ/5ds/amel/jed/mm46＝全てエディタ系）
    のみで、**その 5 本は例外なく XMS（INT 2Fh AX=4300）も叩く＝EMS 専用タイトルはゼロ**。さらに
    `tools/xms_clients_test.js` で実 EXE を headless にステージして走らせ、**AMEL `/X` が Tier1 XMS 経由で
    338KB を実確保（未実装 fn ゼロ・EMS 落下ゼロ）**を確認。＝これらは XMS にフォールバックして EMS 無しで動く
    公算が高く、EMS HLE の現 corpus への効果は薄い。**結論: EMS は据え置き**。再評価のトリガ = ①`qbDebug.memprobe()`
    で `ems`/`emmOpen` が実プレイ中に >0（XMS で足りず EMS を試したタイトル出現）、または ②EMS 専用（XMS 非対応）
    タイトルの発見。それまでは需要プローブを常設したまま様子を見る。
- **INT 33h（マウスドライバ API）= 実装済み（Tier 1、2026-07-03、既定 ON・MS 仕様）**。「MOUSE.COM
  ロード済の DOS」を再現する。`native/dos_mouse33.c` + トランポリン `0xFEEE0`。実ドライバと違い
  **コンベンショナルメモリは消費しない**（IVT[0x33] の 4 バイトのみ）。
  - **二流派問題**: PC-98 のマウスドライバは NEC 仕様と MS 仕様でファンクション番号の意味が食い違う
    （fn3 の戻り = NEC は AX/BX に左右ボタンの 0/FFFF・**AX を壊す** / MS は AX 温存・BX ビットフィールド。
    fn7/8 = NEC は右ボタン press/release 情報 / MS は X/Y 範囲設定。範囲設定 = NEC は fn10h/11h）。
    **両ペルソナ実装済み・既定 MS**（corpus 実測: bepn/brpn は「fn3 が AX を温存するか」で流派を自動判別する
    両対応、ADV98 は BX bit0 読み = MS 前提。HImouse の既定も MS = 当時の現場感覚）。切替 =
    `qbDebug.mouse33('nec'|'ms'|0)`。
  - **正典 = 実ドライバの実測**（`tools/mousetest/` の MOUSETEST.COM、2026-07-03）: MS 仕様 = 実物
    MS Mouse Driver 7.06、NEC 仕様 = HImouse v0.2 `-n`（緋色樹氏 1994 のデュアルモードフリードライバ。
    MS モードが 7.06 と全項目一致することを確認済み = 測定台として信頼可）。真理値表は
    `native/dos_mouse33.c` 冒頭。回帰 = `tools/mouse33_test.js`（4 構成を実測正典と全項目突合）。
  - **カーソルは表示オーバーレイ**: ゲスト VRAM に書かず `np2kai_get_framebuffer` が dispsurf へ合成する
    （fn9 のマスクも反映）。ゲスト状態を一切壊さない代わり、**VRAM を読み戻すソフトにはカーソルが写らない**
    （実 NEC 仕様は XOR プレーン描画）。実害が出たら guest VRAM XOR 描画へ昇格を検討。
  - **未対応（正直に空振り + 初回ログ）**: fn0C/14h イベントハンドラは登録保存のみで**呼び出さない**
    （要 IRQ13 → vector 0x15 トランポリン = Tier 2。登録されたら stderr に UNIMPL 警告）/ NEC fn0 の
    「グラフィック表示 ON」副作用（Orange House 系が依存との DOSBox-X 知見）/ NEC fn9 カーソルパターンの
    プレーン描画・fn12h プレーン選択は保存のみ / fn24h バージョン照会等は UNIMPL ログ。
  - ゲームが実ドライバ（MOUSE.COM 同梱等）を常駐させた場合は IVT[0x33] が上書きされ HLE は影に隠れる
    （衝突しない。`tools/mouse_chain_probe.js` で確認）。需要計測 = `qbDebug.memprobe().mouse33`（呼び出し数）。
- **INT 29h（DOS 高速文字出力 / "fast putchar"）= 実装済み（2026-06-07）**。AL の 1 文字を CON（= テキスト
  VRAM tty、ANSI/ESC パーサ込み）へ流す。**master.lib `text_clear()` は実体が「`INT 29h` で `ESC[2J` を送るだけ」**
  なので、未実装（IRET スタブ）だと master.lib 系の画面消去が無音で効かず、書いた文字が残留していた（SSP の
  タイトル banner ゴースト等）。トランポリン `0xFEE80`。INT 29h は DOS 標準なので他プログラムの画面出力一般にも効く。
- **INT 27h（Terminate and Stay Resident / DOS 1.x 旧式 TSR）= 実装済み（2026-06-25）**。`DX` = PSP 先頭からの
  常駐バイト数（CS=PSP 前提）・終了コード 0 固定で、`(DX+15)>>4` で paragraph 化して `AH=31h` と同じ
  `qb_dos_signal_tsr` へ委譲。トランポリン `0xFEEB0`。**未実装（IRET スタブ）だと `int 27h` が素通りして直下の
  `AH=4Ch` 通常終了にフォールスルー → 常駐したつもりのドライバが自身を解放**し、hook 済みベクタがダングリングして
  後続が暴走する（Microsoft マウスドライバ `mouse.com` の「Mouse driver installed 表示後に停止」の真因だった）。
- **INT 25h/26h（絶対セクタ R/W）= IRET スタブ** → 直接セクタアクセス・一部コピープロテクト不可。
- **INT 33h マウスドライバ = 我々は直接は提供しない**が、**ハード（PC-98 8255 マウス）経由は NP2kai 側で動き**、
  さらに **DOS のマウスドライバ（MS `mouse.com` 7.06 等）を常駐させれば INT 33h API も使える**（INT 27h TSR 実装後、
  `mouse.com` が常駐し INT 33h AX=0 に AX=0xFFFF を返すまで確認済み・2026-06-25）。実マウス移動の追従は
  OPNA タイマ割り込み + 8255 読みの実時間挙動依存でブラウザ実機確認が要る。
- **COMMAND.COM は起動 .bat 専用のミニ実装のみ**（2026-06-03、`tools/dos_loader/shell.asm` +
  `qb_dos_stage_script`）。起動 .bat のコマンドを 1 セッション内で順に `AH=4Bh` EXEC する（ドライバ TSR 常駐 →
  game → -r 解除）専用シェルで、汎用シェルではない。**対話プロンプト・環境変数展開・`cd`/`set`・リダイレクトは
  非対応**。制御フロー（`:label`/`goto`/`if errorlevel`/`if "%N"==`）は ✅ 2026-06-10 の errorlevel 分岐
  インタプリタで対応（`qb_dos_stage_batch`、`IF ERRORLEVEL == N` の `=` 区切り変種も可）。それ以外の構文
  （`for`/`call`/`choice`/`shift`、then 節が goto 以外）は単一主プログラム起動にフォールバック。プログラム以外の
  行（`echo`/`rem`/`pause` 等）は echo 表示以外読み飛ばす。シェル経由の子の `argv[0]` は **子自身のパスに正規化される**
  （C1 解消済、2026-06-04。`build_child_env` で子固有 env を確保）。
- **環境変数は `COMSPEC=A:\COMMAND.COM` と `PATH=A:\` の 2 つだけ**（`build_env`、2026-06-11 に COMSPEC 追加）。
  COMSPEC は実 DOS が必ず設定する変数で、存在チェックして起動拒否するソフトがある（Canvas-98 は無いと exit 5）。
  実ファイル A:\COMMAND.COM は置かないが、✅ 2026-07-02 から **`%COMSPEC%` を `/C <cmd>` 付きで EXEC する
  シェルアウト（TurboC 系 `system()` / SimK 氏 EXECTEST）は通る** — EXEC 先の basename が COMMAND.COM かつ
  tail が `/C` の時だけ、約 40byte の COM スタブ（自己縮小 → `AX=4B00h` で `<cmd>` を EXEC → `AH=4Ch` code=0）
  を合成して通常の exec_load に流す（`build_comspec_stub`）。実 DOS 同様に中間プロセスが立つので PSP 連鎖
  （子の PSP:16h = COMMAND の PSP）も「/C は子の終了コードを破棄して 0」（AH=4Dh=0000）も忠実。`<cmd>` の
  拡張子無しは .COM → .EXE を補完。**差異**: `/C` 無し（対話シェル）・`.bat` ターゲット・内部コマンド
  （`del`/`copy` 等）・リダイレクトは非対応で、従来どおり file not found（AX=2）で正直に失敗する。
  `set` 非対応なのでゲストから変数の追加・変更はできない。回帰 `tools/exec_psp_test.js`。
- **EXEC ネストは 8 段**（`g_exec_stack[8]`）、**子 EXE は 256KB・最上位 EXE は 640KB 上限**。
  ✅ 2026-06-11 から子 EXE の上限は**ロードイメージ（MZ ヘッダ記載の header+body+reloc 表）に対して**適用 —
  実 DOS のローダ同様、ファイル末尾の付加データは読まない（FINALTY finmain.exe = 628KB 中ロード対象 138KB が
  起動できなかった真因。PC-98 ソフトは EXE 末尾にデータを連結し自分のファイルを開いて後読みする慣用がある。
  `read_child_image`、overlay AL=03 も同じ読み方）。
  ⚠ **厳密には不正だが実害なしの既知挙動**: 9 段目以降は親復帰フレームを保存せず子を起動するため、その子の
  終了時に別の子のフレームを誤 pop して復帰先が壊れる（`dos_loader.c:994` に WARN あり）。対象 corpus は最大
  1〜2 段で**到達不能**。ハードニングするならネスト満杯時に EXEC を `AX=8`（メモリ不足）で失敗させる（数行）。
- ~~**子の env 共有（C1）**~~ → **解消済（2026-06-04）**: `env_seg=0` 継承の子も `build_child_env` で子固有 env を
  確保し `argv[0]` を子パス（`A:\NAME`）へ正規化する（`tools/exec_env_test.js` で headless 回帰）。残る拡張
  ポイントは `env_seg!=0`（明示 env）の完全 faithful 化のみ（現 corpus に該当タイトル無し）。

## 4. 2026-07-05 全体精査で見つかった未記載ギャップ（指摘のみ・未修正）

> 2026-07-05 のコードベース全体精査（多エージェント + 手動裏取り）で判明した、本書に
> 未記載だった実 DOS との乖離。修正はユーザー判断待ち。実装バグ（クラッシュ等）の一覧は
> TODO.md「全体コード精査 (2026-07-05)」を参照。

### 4-1. ファイル I/O 系（当たりやすい順）

1. ~~**AH=40h CX=0 の truncate/extend 未実装**~~ → ✅ 2026-07-05 実装（`int21_40_write`）。
   実 DOS は CX=0 で「現在位置でファイルを切り詰め（または延長）」する。旧実装は AX=0/CF=0 を
   返すだけで何もせず、seek→write(0 byte) でセーブを短く書き直す定石が壊れ、旧データの尻尾が
   残って次回ロードのパースが壊れる遠隔破壊型だった。fflush + `ftruncate(fileno)` で実装、
   read-only ("rb") ハンドルは EINVAL → 実 DOS 同様 error 5。回帰 `tools/seek_trunc_test.js`。
2. ~~**AH=42h Seek の負オフセット**~~ → ✅ 2026-07-05 実装。実 DOS は whence=1/2 でファイル
   先頭より前に seek してもエラーにしない（負の位置を DX:AX (CF=0) で返し後続 I/O が失敗する）。
   旧実装は MEMFS fseek の失敗を CF=1/**AX=6 (invalid handle)** で返し、`seek(h, -N, SEEK_END)`
   で末尾フッタを後読みする型が異常系へ分岐した。ハンドル表に負の論理位置 `neg_pos` を持たせ、
   負位置中の read/write は error 5・非負 seek で解除（EOF 超え SEEK_SET は従来どおり成功）。
   回帰 `tools/seek_trunc_test.js`（8 項目、DX:AX=FFFF:FFA4 まで検証）。
3. **read-only ("rb") ハンドルへの AH=40h が「0 バイト書けた・成功」**— 実 DOS は
   CF=1/AX=5 (access denied)。CF しか見ないソフトは書けたと誤認して進む。
4. **AH=41h Delete のエラーコードが一律 AX=2**— 途中ディレクトリ欠は実 DOS では 3。
   open/create 系は st で 2/3 を出し分けており不整合。
5. **AH=29h Parse Filename が DBCS 非対応**— `IS_FCB_SEP` に SJIS トレイル範囲の
   `\ [ ] |` が入っておりトレイルで名前パースが切れる + トレイルバイトへの大文字化で
   別文字に化ける（`dta_write_find` は丁寧に回避しているのに 29h だけ素通し）。
   漢字名を FCB 経由で受け渡す親子連携で破壊。
6. **`ci_equal_fsname` / `glob_field` の byte 単位 case-fold がトレイルに及ぶ**—
   トレイルが 0x20 ビット違いの別漢字同士が誤一致し得る（該当ペア共存が要るので稀）。
7. **FindFirst/Next が `.` / `..` を返さない**— 実 DOS は attr に 0x10 を含む検索で
   返す。ファイラの「.. で親へ」項目が出ない。逆方向の安全はあるので実害は片方向。
8. **FindFirst CX=0x08（volume label 専用検索）が通常ファイルを返す**— 古典意味論では
   label のみ返すべき。ラベル取得ツールがファイル名をラベル表示する。
9. **`g_fh[].path` が 160 バイト**— 長い SJIS パスのハンドルは記録パスが黙って切れ、
   AH=45h/46h DUP の「同 path 開き直し」が失敗または別ファイルを掴む。

### 4-2. コンソール / tty 系

10. **AH=0Ah の Enter エコーが CR+LF**— 実 DOS は **CR のみ**（LF はプログラム側が
    出す規約）。自前で LF を出すソフトは 1 行余分に進む。
11. ~~**ESC[1J（先頭〜カーソル消去）が黙って no-op**~~ → ✅ 2026-07-05 実装。`case 'J'` に
    p=1（先頭〜カーソル、カーソル位置含む）を追加。INT DCh CL=10h AH=0Ah DX=1 も同経路で解消。
12. **TAB がセルを書かずカーソル前進のみ**— 実 CON は空白に展開して書く（AH=02h が
    AL=20h を返す自前実装とも矛盾）。前フレームの残骸が TAB 区間に消え残る。
13. **AH=0Ch の flush が 0x502 リングのみ**— softkey 発行文字列の未消費分・3Fh cooked
    の持ち越し行・inject FIFO は生き残る。type-ahead 破棄の目的からは softkey 残りも
    捨てるべき。
14. **標準ハンドル 0-4 の扱いが関数間で不整合**— 44h/3Eh は「open な char device」と
    申告するのに、3Fh は h=0 のみ・40h は h=1/2 のみ・42h は 0-4 全部 AX=6（実 DOS は
    char device の seek に AX=0:DX=0 成功）。IOCTL プローブ成功→write 失敗の矛盾。
15. **IOCTL AL=01h がハンドル未検証**— 未 open/範囲外でも CF=0 成功（AL=00h は AX=6 を
    返すのと非対称。「正直な失敗」ポリシー違反）。
16. **AH=33h AL=05/06 が別契約を get 扱い**— AL=05 (DOS4+: DL=起動ドライブ) /
    AL=06 (DOS5+: BX=true version) を実装せず break フラグ get として応答。
    AX=3306h で DOS5 判定するランタイムは caller の BX 残骸を読む。
17. **CSI パラメータ 9 個目以降が第 8 パラメータへ連結される**（実害ほぼ無し）。

### 4-3. プロセス / PSP / ローダ系

18. **PSP フィールドの欠落一式**（`build_psp` / EXEC 子共通）:
    - +05h CP/M CALL 5 ゲート無し（既知）に加え **+06h「セグメント内使用可能バイト数」も 0**
      — これで自メモリ量を測る古典ソフトが 0 と誤読。
    - **+0Ah/0Eh/12h（INT 22h/23h/24h 保存）を EXEC 時に保存せず、終了時の復元も無い**
      — 現 HLE は 23h/24h を発火しないため潜在バグ止まり。
    - **+18h JFT 20 バイト全ゼロ**（実 DOS: `01 01 01 00 02 FF…`）、+32h ハンドル数・
      +34h JFT far ptr も 0 — PSP:19h で stdout リダイレクト判定するソフトが誤動作。
    - **最上位 PSP の +16h（親 PSP）= 0**（実 DOS の最初のシェルは自己参照）— EXEC 子は
      正しく設定されるのと非対称。親チェーン歩行ツールが seg 0 = IVT を PSP と誤読し得る。
19. ~~**AH=4Dh の終了種別 (AH) が常に 0**~~ → ✅ 2026-07-05 実装。signal_tsr（AH=31h/INT 27h
    経由の常駐）で type 3 を記録し、実 DOS 同様 4Dh の AH=3 で「TSR 終了」が返る。
    最上位 TSR（親無し halt loop）は 4Dh の読み手が存在しないため対象外。
20. **最上位 COM のブロックが 64KB 固定**— 実 DOS は最大ブロック全部を渡す
    (PSP:2=0xA000 とも整合)。self-shrink 前の AH=48h が実 DOS では失敗するのに成功する /
    shrink せず EXEC する行儀の悪い COM は実 DOS なら AX=8 で失敗するが、ここでは
    64KB 超に spill した親データの上に子がロードされ得る。
21. **最上位 COM の SS:SP に zero word を積まない**— EXEC 子 COM / load-only は積むのに
    loader-start だけ欠落。RET 終了（CP/M 流）の契約。※実害は現状ほぼ無し —
    `pccore_reset` が毎 Run `ZeroMemory(mem, 0x110000)` するため当該 word は常に 0。
22. **起動時 AX が常に 0**— 実 DOS はコマンドライン FCB のドライブ有効性を AL/AH に
    返す（無効ドライブで FFh）。EXEC 子は FCB parse するようになったのに AX は未対応。
23. **EXEC 子の `build_one_fcb` が '*' を '?' に展開しない**（INT 21h AH=29h 側は展開
    する）+ 区切りが space/tab のみ（実 DOS は `, ; =` も）。
24. **FCB1=null で FCB2 が無視される**（EXEC パラメータブロック処理の構造）。
25. **INT 27h が CS でなく current PSP を常駐対象にする**— 実 INT 27h は CS=PSP 前提。
    CS を far jmp で移した変則 TSR では別ブロックを縮める。
26. **TSR が開いたままのハンドルが祖先の終了で閉じられる**— TSR は fh_mask を捨てて
    pop するため、祖先の close_since がTSR の open 中ハンドルを巻き込む。実 DOS では
    常駐 SFT は生存。
27. **AH=50h Set PSP 後の 4Ch/31h で EXEC スタックと g_cur_psp が乖離し得る**—
    signal_exit/tsr は LIFO pop + g_cur_psp 基準の解放。実 DOS は PSP:0Ah (INT 22h)
    連鎖で復帰先を決める。デバッガ的な使い方（load-only の子を自前で走らせて終了させる）
    で顕在化。
28. **exec_load の必要量計算に EXE スタック頂点が入らない**（loader-start は入れる）—
    minalloc がスタックを覆わない変則 EXE をぎりぎりで EXEC すると子の push が隣接
    ブロックを破壊。

### 4-4. INT 21h の外

29. **XMS AH=08h: 空きゼロでも BL=00h**— XMS 3.0 は BL=A0h。32MB を使い切るのは稀。
30. **INT 33h fn5/6 (MS) の BX=2（中ボタン）が右ボタン扱い**— 実 7.06 は存在しない
    中ボタンとして空カウンタを返すはず（2 ボタン前提の PC-98 では実害ほぼ無し。
    真理値表とコードの突合はこれ以外全項目一致）。
31. **ミニ COMMAND.COM（batscript.js）の追加乖離**: ②線形シーケンス経路が `call` /
    `for` / `choice` / `shift` を**無言スキップ**（③は honest fallback するのと非対称）/
    リダイレクト `> nul` がトークンとして子の command tail に漏れる（実 COMMAND.COM は
    剥がす。`echo x > file` もファイルを作らず画面表示）/ tail 再構成で連続空白・タブが
    単一空白に潰れる（実 DOS は raw tail を PSP:80h へ）/ goto ラベル照合が完全一致
    （実 DOS は先頭 8 文字有意）/ `if "%1"==FM` の非対称 quote が実 DOS と逆判定。

## まとめ（当たりやすさ・優先度）

1. **CHDIR/MKDIR/RMDIR + 36h 空き容量** — セーブ機能付きゲームで顕在化しやすい → ✅ 対応済
2. **EXEC 子のハンドル未クローズ** — ランチャ往復型の潜在バグ → ✅ 対応済
3. 56h rename / 57h 日時 — セーブ・ファイル操作系 → 次の候補
4. 63h DBCS テーブル — 日本語ソフト特有 → 次の候補

FCB I/O・EMS/XMS・INT 25h/26h・overlay(4B AL=03) は「スコープ外」と割り切った領域。
