# HLE-DOS (INT 21h) の実 DOS との差異・未対応一覧

> 2026-06-02 調査。`native/dos_int21.c` / `native/dos_loader.c` のコードベース調査結果。
> QuuBee の DOS は「実 DOS の忠実再現」ではなく、**フロッピー2D・〜1998 年の同人/フリー
> ソフト向けに INT 21h を ~38 fn だけ HLE 実装したサブセット**（CLAUDE.md 記載のカバー率
> 80〜90% 想定）。BIOS レベル（INT 18h/1Bh/1Ch/DCh 等）は NP2kai の合成 BIOS が担当する
> ので、本書の「未対応」は **DOS(INT 21h) 層に限った話**。

実装済み AH: `01-0C / 19 1A 25 2A 2C 2F 30 31 33 35 / 3C-49 4A-4F / 52`
（ディスパッチは `dos_int21.c` の `qb_dos_int21_dispatch()`）。

## 1. 未実装の INT 21h ファンクション（`default` → CF=1, AL=01「invalid function」）

| AH | 機能 | 影響度 | 状態 |
|---|---|---|---|
| **39/3A/3B** | MKDIR / RMDIR / **CHDIR** | 高（セーブ用フォルダ作成・カレント移動が破綻） | ✅ 2026-06-02 実装 |
| **36** | Get Disk Free Space | 高（空き容量チェックで誤判定） | ✅ 2026-06-02 実装（合成値） |
| 0F-17,21-24,27,28 | FCB 系ファイル I/O 全般 | 中（〜DOS2 系・FCB FindFirst） | 未対応 |
| 56 / 57 | Rename / Get-Set ファイル日時 | 中（temp→rename セーブ・書庫ツール） | 未対応 |
| 59 | Get Extended Error | 中（エラー後の詳細コード取得） | 未対応 |
| 63 | Get DBCS Lead-Byte Table | 中（日本語特有。多くはハードコードにフォールバック） | 未対応 |
| 62 / 50 / 51 | Get/Set PSP | 中 | 未対応 |
| 00 | Terminate（旧式） | 低（終了は INT 20h / 4Ch 想定） | 未対応 |
| 2B / 2D | Set Date / Set Time | 低（Get のみ実装） | 未対応 |
| 38 / 5B / 5A / 67 / 68 … | 国別 / 排他作成 / temp / handle 数 / commit | 低〜中 | 未対応 |
| 4B AL=01,03 | Load-only / オーバーレイ | 中（大きめゲームの overlay） | 未対応（AL=00 のみ） |

## 2. 実装済みだが実 DOS と挙動が異なる点

1. **ファイルハンドル = ホスト `FILE*`（DOS の SFT ではない）**
   - 45h DUP / 46h DUP2 が**ファイルポインタを共有しない**（同 path/mode で開き直して seek する独立ハンドル）。read 用途では実用上等価だが、dup 後の interleaved seek/read は乖離。
   - **stdin(ハンドル0)からの 3Fh Read が "invalid handle"**（`fh_get(0)`=NULL）。実 DOS はキーボードを読む。AH=0Ah 経由なら可。
   - ~~**EXEC 子の終了時にハンドルを閉じない**＋ハンドル表 `g_fh` がプロセス間共有 → ランチャ往復でハンドル枯渇~~ → ✅ 2026-06-02 修正（子が開いたハンドルだけ子終了で close。TSR は常駐なので閉じない）。

2. **カレントドライブ/ディレクトリ** — 19h は常に A:(=0)。ドライブレターは剥がして `/run` に集約するので、**A:/B: を別ボリュームとして使う2枚組ゲームは両者が混ざる**。CHDIR は ✅ 実装したが「ドライブ」は依然 1 つ（`g_cwd` で論理カレントを保持）。

3. **FindFirst/Next がグローバル1本（`g_find`）** — 実 DOS は検索状態を DTA に持つので入れ子・並行検索が可能。2 つ目の FindFirst が 1 つ目を破壊。DTA の reserved 検索状態も書かない。

4. **ファイル属性 43h** — Get は常に 0x20(archive)、Set は無視。read-only/hidden を区別しない。

5. **MCB チェーンがアリーナ部分のみ**（`g_arena_base`〜0xA000）。プログラム本体ブロックはチェーン外なので、先頭から MCB を歩くメモリツール/一部プロテクトは整合しない。
   - **AH=52h (Get List of Lists)** は最小の**合成 List of Lists** を返す（segment 0x00A0）。`[BX-2]`=先頭 MCB は `g_arena_base`、DPB/SFT/CDS/デバイス系は `0xFFFF`「無し」、NUL デバイスヘッダ・LASTDRIVE=5・max 512B/block のみ実値。master.lib 系 (例: Super Spartan の本体 `sspartan.d98`) が「先頭 MCB を辿って利用可能メモリを算定する」用途には十分だが、DPB/CDS/SFT を実際に辿るツールとは整合しない（必要になったら実体を足す）。

6. **DOS 経由の拡張キー入力が落ちる** — BIOS キーバッファの**下位バイト(ANK)だけ**返す。矢印/ファンクションキー（DOS では 00h+スキャンコードの2バイト）の2バイト目が失われる。多くは BIOS INT 18h / 生 IRQ で読むので実害限定。

7. **Ctrl-C / Ctrl-Break を検出しない**（33h は値保持のみ、INT 23h は IRET スタブ）。

8. **PSP の既定 FCB をパースしない**（0x5C/0x6C はゼロ）。引数を旧式に PSP FCB から読むソフトは引数を得られない（0x80 コマンドテイルは正常）。

9. **セーブが揮発** — 書き込みは MEMFS `/run`。セッション中（Run 往復）は残るが**ページ再読込で消える**。永続化（IndexedDB 本棚）は別レイヤの将来課題。

10. AH=09h は `$` が無い場合 4096 byte で打ち切り。AH=0Ah のバッファ満杯は BEEP せず黙殺。
    tty 制御コードは CR/LF/BS に加え **TAB(0x09)→8桁タブストップ前進**・**BEL(0x07)→無視**（2026-06-07 追加。
    GBOX ヘルプの行頭乱れ対策）。**SJIS 区9-11（NEC 半角グラフィック/罫線、SJIS 0x86xx）は半角=1セル幅**で描く
    （`vram_put_kanji_half`、同日。全角扱いで2セル書くと横2倍に化けた＝Ray IV の枠崩れの真因）。

12. **AH=58h（メモリ確保ストラテジ/UMB リンク状態）は良性スタブ** — get は既定値（strategy=0 first-fit、UMB link=未リンク）、
    set は no-op 成功（2026-06-07、GBOX United モードの AX=5803h 対策）。我々は UMB を持たず確保は first-fit 固定なので、
    実際のストラテジ切替/UMB 管理は行わない。

11. **パス解決が `.`/`..` を畳まない（CHDIR とは非対称）** — `read_dos_rel`/`resolve_dir`（open/create/
    delete/exec/findfirst が通る）は `\`→`/`・大小無視・カレント前置はするが `.`/`..` を正規化しない。一方
    `AH=3Bh CHDIR` は `..` を畳む。実害は限定的: `..` は MEMFS のホスト解決で自然に親へ落ちるので**展開ツリー内の
    親参照（`..\COMMON\DAT` 等）は正常動作**し、`/run` より上に登る `..` を多用した時だけ無防備になる。その場合も
    到達先は**揮発・完全仮想の MEMFS**（実機 FS 不可達・guest にネットワーク egress 無し＝流出経路なし・本棚
    IndexedDB は guest 名前空間外）で、最悪でも `/tmp` の loader.d88/スロット画像を踏んで**そのセッションが自爆する
    だけ**（再読込で復旧）。フロッピー2D 同人は install root 内で動くのが基本なので発生確率も低い。**対策保留**
    （2026-06-03 判断）。直すなら read_dos_rel/resolve_dir に `.` 破棄 + `..` で1段上がる正規化を入れ、`/run` より
    上には登らせず clamp すれば CHDIR との非対称も解消する（~15 行、defense-in-depth）。

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
- **INT 29h（DOS 高速文字出力 / "fast putchar"）= 実装済み（2026-06-07）**。AL の 1 文字を CON（= テキスト
  VRAM tty、ANSI/ESC パーサ込み）へ流す。**master.lib `text_clear()` は実体が「`INT 29h` で `ESC[2J` を送るだけ」**
  なので、未実装（IRET スタブ）だと master.lib 系の画面消去が無音で効かず、書いた文字が残留していた（SSP の
  タイトル banner ゴースト等）。トランポリン `0xFEE80`。INT 29h は DOS 標準なので他プログラムの画面出力一般にも効く。
- **INT 25h/26h（絶対セクタ R/W）= IRET スタブ** → 直接セクタアクセス・一部コピープロテクト不可。
- **INT 33h マウスドライバ = スタブ**。ただし**ハード（バスマウス）経由は NP2kai 側で動く**。
- **COMMAND.COM は起動 .bat 専用のミニ実装のみ**（2026-06-03、`tools/dos_loader/shell.asm` +
  `qb_dos_stage_script`）。起動 .bat のコマンドを 1 セッション内で順に `AH=4Bh` EXEC する（ドライバ TSR 常駐 →
  game → -r 解除）専用シェルで、汎用シェルではない。**対話プロンプト・環境変数展開・`cd`/`set`・リダイレクト・
  制御フロー（goto/if）は非対応**（制御フロー入り .bat は単一主プログラム起動にフォールバック）。プログラム以外の
  行（`echo`/`rem`/`pause` 等）は読み飛ばす。シェル経由の子の `argv[0]` は **子自身のパスに正規化される**
  （C1 解消済、2026-06-04。`build_child_env` で子固有 env を確保）。
- **EXEC ネストは 8 段**（`g_exec_stack[8]`）、**子 EXE は 256KB・最上位 EXE は 640KB 上限**。
  ⚠ **厳密には不正だが実害なしの既知挙動**: 9 段目以降は親復帰フレームを保存せず子を起動するため、その子の
  終了時に別の子のフレームを誤 pop して復帰先が壊れる（`dos_loader.c:994` に WARN あり）。対象 corpus は最大
  1〜2 段で**到達不能**。ハードニングするならネスト満杯時に EXEC を `AX=8`（メモリ不足）で失敗させる（数行）。
- ~~**子の env 共有（C1）**~~ → **解消済（2026-06-04）**: `env_seg=0` 継承の子も `build_child_env` で子固有 env を
  確保し `argv[0]` を子パス（`A:\NAME`）へ正規化する（`tools/exec_env_test.js` で headless 回帰）。残る拡張
  ポイントは `env_seg!=0`（明示 env）の完全 faithful 化のみ（現 corpus に該当タイトル無し）。

## まとめ（当たりやすさ・優先度）

1. **CHDIR/MKDIR/RMDIR + 36h 空き容量** — セーブ機能付きゲームで顕在化しやすい → ✅ 対応済
2. **EXEC 子のハンドル未クローズ** — ランチャ往復型の潜在バグ → ✅ 対応済
3. 56h rename / 57h 日時 — セーブ・ファイル操作系 → 次の候補
4. 63h DBCS テーブル — 日本語ソフト特有 → 次の候補

FCB I/O・EMS/XMS・INT 25h/26h・overlay(4B AL=03) は「スコープ外」と割り切った領域。
