# tools/pmd_build — クリーン素性の PMD エンジンをソースからビルド

QuuBee は PC-98 FM 音楽 `.M`(PMD)を「素のファイル単体ドロップ→即演奏」できるように、PMD ドライバ
(`PMD86.COM`)とプレイヤ(`PMP.COM`)を内蔵する。本ディレクトリはそれを **KAJA(梶原正裕)氏の
2019 自由公開ソースから自分自身でビルド**するパイプライン(素性が完全にクリーンなバイナリのみ同梱する)。

## ライセンス / 素性

- KAJA 氏は 2019/12/25 に PMD/MC/PMP の全ソースを公開し、「ソースについての著作権は放棄しませんが、
  **ご自由に使って頂いて構いません**。むしろ…再利用するアイデアがあるようでしたら、ぜひ利用してやって
  ください」と明記。→ この自由公開ソースからのビルドはクリーン。
- **1997 配布バイナリ(PMD86.COM 等)は別ライセンス**(「無断の改変・営利使用を禁ず」)なので**使わない**。
- C60 氏の PMDWin は不使用(改変ソース公開には事前連絡が要るため)。QuuBee の再生(Path B)は
  「本物の KAJA ドライバを HLE-DOS で常駐演奏」で完結し、PMDWin に依存しない。
- 詳細は `CREDITS.md` の「PMD」項。

## 使い方

```
bash tools/pmd_build/build_pmd.sh
# → tools/pmd_build/out/{PMD86.COM, PMP.COM}
```

前提: `gh`(認証済) / `gcc` / `make` / `tar` / `python3`。`UASM=/path/to/uasm` を環境で渡すと
アセンブラの再ビルドを省略できる(スクリプトが内部で変数 `ASM` に移し `UASM` env を unset する。
理由は下記の罠を参照)。

## 再現性 / Reproducibility

同梱バイナリ（`web/assets/pmd/` — これが実際に配布される現物）の SHA-256:

```
PMD86.COM  704a40c518032b5758d76db79772dba9c79e2c2d05eda4a22fd340a46d7a43f0
PMP.COM    bbf47402c2253777f35422243f27f7b0c7828f113c8fbe9397d2b6b2bd98d1e9
```

ビルドが決定的になるよう **ソースを commit に pin** している（`build_pmd.sh` の `UASM_REF` / `PMD_REF`。
`master` は moving target なので固定）:

- UASM（アセンブラ）: `Terraspace/UASM` @ `bffb18461dd541479064990c3b2750ab50ae23e2`
- PMD ソース: `d2lmirrors/pmd` @ `c620dc95c5e47970e7839cb5f0b7b9ab742d4f46`（KAJA 2019 公開のミラー）

検証手順（誰でも実行でき、同梱バイナリが KAJA 公開ソースからの素直なビルド産物だと確かめられる）:

```
bash tools/pmd_build/build_pmd.sh
sha256sum tools/pmd_build/out/PMD86.COM tools/pmd_build/out/PMP.COM
# → 上のハッシュと一致すれば素性クリーンを byte 単位で確認できる。
```

**確認済 (2026-06-26)**: pin した上記 commit から `build_pmd.sh` で再ビルドした産物が、同梱バイナリ
（`web/assets/pmd/`）と **byte 完全一致**することを確認した（`cmp` で PMD86.COM / PMP.COM とも差分ゼロ、
SHA-256 も上記と一致）。よって同梱バイナリは KAJA 2019 公開ソースからの素直なビルド産物であることが
byte 単位で裏取りできている。将来ツールチェイン（UASM / gcc）や pin ソースを更新したらこの確認を
やり直し、`web/assets/pmd/` と本ハッシュを併せて更新すること（回帰は `tools/pmd_test.js`）。

## パイプラインの中身

1. **UASM(MASM 互換アセンブラ)をビルド** — `nasm` では MASM/OPTASM 構文を通せない。Terraspace/UASM を
   gh tarball で取得し、modern gcc-14 向けの最小パッチ(Windows 専用ヘッダ `direct.h` の shim、MSVC
   グローバル `_pgmptr` のダミー、CodeView 出力 `dbgcv.c` のポインタ演算キャスト、`-Wno-error=*` で
   厳格化の降格)を当てて `make -f Makefile_Linux CC=gcc` でビルド。
2. **KAJA 2019 ソース取得** — `d2lmirrors/pmd`(KAJA 公開のミラー)を gh tarball で。
   (サンドボックスでは生 github.com への git clone が DNS で不可なため gh api を使う。)
3. **OPTASM→UASM 移植補正**(ロジック不変・機械的):
   - (a) DOS EOF 等の制御文字 `0x1A`/`0x1C` を除去(UASM が syntax error を出す)。
   - (b) 負変位アドレッシング `-N[reg]` → `[reg-N]`(OPTASM 方言。計 9 箇所)。
   - (c) 文字列 equate を テキスト equate `<...>` に(`ver`/`_myname`/`resmes`/`_optnam`。
     UASM は `equ "str"` を数値化して "magnitude too large" を出す)。
   - (d) `loop din0` → `dec cx`/`jnz din0`(別アセンブラの僅かなコード長差で短ジャンプ範囲外になる)。
   - (e) include のファイル名大小が混在(`include PMD.ASM` と `include newpmd.inc`)。Linux は
     case-sensitive なので全 `.ASM`/`.INC` に小文字名コピーを併置。
4. **アセンブル** — `uasm -bin -Zm`(`-Zm` = MASM 5.1 互換 M510。原典の `ml /Zm` と同条件。STRUC メンバを
   素のオフセットで参照する古い書法を許可)。`PMD86.ASM`(`include PMD.ASM`)→ `PMD86.COM`、
   `PMP.ASM` → `PMP.COM`。
5. **PMP のトリム** — `-bin` は末尾の未初期化 PCM バッファをゼロ埋めして出力するため(~34KB)、末尾の
   連続ゼロを削る(プログラムが自分でバッファを初期化するので安全。原典 5742B に対し ~6KB に収まる)。

## 罠メモ

- **UASM は環境変数 `UASM` を「既定オプション」として読む**(MASM の `ML` 環境変数と同じ)。アセンブラの
  パスを変数 `UASM` のまま子プロセスへ渡すと、uasm が自分自身のパスを追加ソースと解釈して ELF バイナリを
  assemble しようとし大量のエラーになる。→ スクリプトは変数名 `ASM` を使い `UASM` env を unset 済み。
- 検証: 生成バイナリは `tools/pmd_test.js`(headless で fmgen/opngen 両方の steady-state 演奏を確認)。

## 再生に必要なコア側の対応(別途実装済み)

`.M` がブラウザで鳴るには本ビルドのバイナリに加えて以下が必要(`native/bridge.c` / `tools/dos_loader/shell.asm`):

- 86 ボードの割り込みを **INT5/IRQ12** に(`snd86opt |= 0x0C`)。PMD は OPNA タイマ割り込みで
  テンポを刻み、その ISR を IRQ12 のベクタに hook する。
- シェルのシーケンス完了後を `AH=4Ch` 終了でなく **`sti` + アイドル**に。常駐演奏ドライバの ISR が
  IF=1 で刻み続けるため(IF=0 アイドルだと「最初の 1 音だけ鳴って無音」)。
