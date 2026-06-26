# CREDITS / サードパーティ ライセンス表記

QuuBee が同梱・配布する第三者アセットおよびコンポーネントの著作権表示。
（QuuBee 自身が再配布・ホスティングするのは下記。ゲーム/ソフト本体はユーザーが用意するフリーソフトであり、
QuuBee は配布しない。）

---

## プロジェクト全体のライセンス

- **配布物（`np2kai_core.wasm` を含むアプリ全体）: 寛容ライセンスの集合体（GPL なし）**。
  内訳は下表のとおり BSD-3 / 2 条項 BSD / MIT / fmgen 独自（フリーソフト配布）で、いずれも
  「著作権表示を添えれば再配布可」の寛容ライセンス。**コピーレフト（GPL）部品はビルドに含めていない**
  （FPU は GPL の DOSBox 由来ではなく BSD の Berkeley SoftFloat 3e を使用。経緯は下記 ＊）。
- **QuuBee 独自のソース（msonrm 著作の部分）: `MIT`**（`LICENSE-MIT`）。
- 「著作権クリーン」＝ NEC BIOS / MS-DOS 等 proprietary を**同梱しない**こと。加えて、配布バイナリ内の
  各部品ライセンスも相互に整合している（下記 ＊ のとおり 2026-06-26 に GPL 部品を除去して整合化）。

| コンポーネント | ライセンス |
|---|---|
| QuuBee 独自コード（`native/` の `qb_*`/`bridge`/`dos_*`、`web/player/`、`tools/`、`docs/` 等） | MIT |
| NP2kai ラッパ本体（AZO234） | MIT |
| i386c CPU コア（NONAKA Kimihiro 他） | BSD（2 条項） |
| **FPU `softfloat3`（Berkeley SoftFloat 3e, Regents of the University of California）** | **BSD-3-Clause** |
| FM 音源 `fmgen`（cisc） | fmgen 独自（フリーソフト配布・下記 ＊＊） |
| 音源チップ `mamebsd`（MAME の BSD 部分） | BSD-3-Clause |
| `web/assets/font.bmp` | 修正 BSD |
| `native/third_party/tsf.h`（TinySoundFont, Bernhard Schelling） | MIT |
| `web/assets/soundfont.sf2`（GeneralUser GS, S. Christian Collins） | 寛容ライセンス（下記） |
| `tools/testdata/boot.d88`（FreeDOS(98)・テスト専用素材／**デプロイ非同梱**） | GPL |
| `tools/testdata/VZ.COM`（VZ Editor・テスト専用素材／**デプロイ非同梱**） | BSD-3-Clause |

> ＊ **ライセンス整合化（2026-06-26）**: FPU を NP2kai 同梱の BSD 実装 **Berkeley SoftFloat 3e**
> （`SUPPORT_FPU_SOFTFLOAT3`、本家 NP21/W も rev.98 以降この構成）に切替え、配布バイナリから GPL 部品を
> 除去した（DOSBox 由来 FPU のソースはサブモジュールに残るがビルド対象外）。経緯は CHANGELOG.md /
> `msonrm/quubee` Issue #1 を参照。
>
> ＊＊ **fmgen の条件**: cisc 氏のライセンスは「著作権表示・免責の保持」「改変箇所の明示」に加え、**配布は
> フリーソフトに限る／商用ソフトへの組込みは事前許諾が必要**という条件を持つ（このため GPL とは非互換）。
> QuuBee は無償のフリーソフトとして配布するためこの条件を満たす。全文は `core/np2kai/sound/fmgen/fmgen_readme.txt`。

---

## フォント — `web/assets/font.bmp`

Neko Project II 系エミュレータ用の **代替フォントビットマップ**。ベースは「さざなみフォント」で、
東雲 (Shinonome) / 美咲 (Misaki) / M+ FONTS / Ayu / Oradano / Kappa 等の自由フォント、および
Neko Project II 内蔵グリフを組み合わせたもの。配布元の表記に従い、**全体として修正 BSD ライセンス**。

```
Copyright (c) 2025, SimK, Nekosan development team
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

構成フォントの個別ライセンス（東雲 / 美咲 / M+ / Ayu / Oradano / Kappa / さざなみ、および
`font.bmp` 本体の Nekosan/SimK 宣言）は **`licenses/fonts/` に全文を収録**している（出典は配布
アーカイブ `sazanami-fontbmp.zip` の `doc/<フォント名>/`、原本の文字コードのまま温存）。いずれも
自由に再配布可能なライセンス。デプロイ（`tools/deploy.sh`）はこの `licenses/` と本 `CREDITS.md` を
公開ビルド `dist/` に同梱するので、**配布物自体が帰属表示を伴う**（修正 BSD のバイナリ再配布条項を満たす）。

---

## エミュレータコア — NP2kai (`core/np2kai`, git submodule)

AZO234 / Neko Project II kai。ラッパ本体の `LICENSE` は **MIT**（Copyright (c) 2017 AZO）。
QuuBee がビルドする WebAssembly には NP2kai が静的リンクされる。NP2kai は複数ライセンスの集合体で、
QuuBee のビルドに含まれる主なものは:

- **i386c CPU コア**（`i386c/`, Copyright NONAKA Kimihiro 他）— **2 条項 BSD**（permissive）。
- **FPU エミュレータ**: **Berkeley SoftFloat 3e**（`i386c/ia32/instructions/fpu/softfloat3/`,
  Copyright The Regents of the University of California）＋ ラッパ `fpemul_softfloat3.cpp`
  （Copyright NONAKA Kimihiro）— **いずれも BSD-3-Clause**。QuuBee は `SUPPORT_FPU_SOFTFLOAT3` で
  これをコンパイルする。**GPL の DOSBox 由来 FPU（`fpemul_dosbox*.c`）はビルドに含めない**
  （サブモジュールにソースは在るがコンパイル対象外）。経緯は上記 ＊。
- **FM 音源 `fmgen`**（`sound/fmgen/`, Copyright (C) cisc 1998, 2003）— cisc 氏独自ライセンス。
  配布はフリーソフトに限る／商用組込みは要許諾（GPL 非互換。上記 ＊＊）。QuuBee は無償配布のため適合。
- **音源チップ `mamebsd`**（MAME の BSD-3 部分）— BSD-3-Clause。GPL の `mame` 版は使用しない。
- opngen / VERMOUTH 等の他部品のライセンスは `core/np2kai` 配下の各ディレクトリを参照
  （VERMOUTH はビルド除外）。

各ファイルの著作権ヘッダは改変・削除せず温存している。

---

## MIDI 合成エンジン — `native/third_party/tsf.h` (TinySoundFont)

ブラウザでの MIDI 演奏に **TinySoundFont**（単一ヘッダの SF2 ソフトシンセ）を使用。
**MIT ライセンス**、Copyright (C) 2017–2025 Bernhard Schelling（SFZero, Copyright (C) 2012 Steve Folta
に基づく）。`native/qb_tsf.c` がこれを用いて SF2 をネイティブ再生する（旧 VERMOUTH/GUS .pat 経路を置換）。
ヘッダの著作権表示は温存している。

## MIDI 音色 — `web/assets/soundfont.sf2` (GeneralUser GS)

MIDI の音色バンクに **GeneralUser GS v2**（GM/GS 互換 SoundFont、作者 S. Christian Collins）を使用。
ライセンスは寛容で、原文（`documentation/LICENSE.txt`）いわく「自分の音楽制作・私的/商用を問わず制限なく
使用してよい。ソフトウェアプロジェクトでの使用も自由で、バンクやパッケージの改変も可」。再配布・同梱が
明示的に許可されている（QuuBee はローカルコピーを同梱・配布する。作者は直リンクでなくローカルコピー配布を推奨）。
作者の正直な注記として「一部サンプルの出自は完全には確証できない（ただし自由に入手可能なもので、商用音源 CD
由来のものは含まれない）」とある。proprietary ROM を同梱しないという QuuBee のクリーン方針とは別軸の留保だが、
ライセンス上は再配布が許諾されている。配布元: https://www.schristiancollins.com 。
SF2 本体は ~32MB と大きいためリポジトリには含めず（`.gitignore`）、`tools/setup_soundfont.sh` で取得する。
ただし**ライセンス全文（License v2.0）は `licenses/soundfont-GeneralUser-GS-LICENSE.txt` に収録**し、
デプロイにも同梱する（SF2 本体と一緒に公開ビルドへ届く）。
別の SF2 に差し替えるのも自由（TSF が読める SF2 を `web/assets/soundfont.sf2` に置くだけ・コード変更不要）。

---

## FreeDOS — `tools/testdata/boot.d88`

FreeDOS(98) の 2HD フロッピーイメージ（**GPL**、再配布可）。headless テスト
（`tools/bench_frame.js` / `tools/diskimage_test.js`）専用の素材で、**デプロイ対象外**
（サイトには含まれない。帰属: The FreeDOS Project）。

---

## VZ Editor — `tools/testdata/VZ.COM`

PC-98 版 VZ Editor Ver1.60 の実行ファイル（**BSD-3-Clause**、再配布は著作権表示の保持が条件）。
HLE-DOS の起動回帰（`tools/vz_test.js`、VZ の `checkhard` が要求する INT DCh≠DDh ベクタの検証）
専用の素材で、**デプロイ対象外**（サイトには含まれない）。原作 兵藤嘉彦（c.mos）氏、ソース公開
vcraftjp <https://github.com/vcraftjp/VZEditor>。ライセンス全文は `tools/testdata/VZ.LICENSE.txt`。

---

## PMD (Professional Music Driver) — PC-98 FM 音楽 .M の再生

PC-98 同人 FM 音楽の事実上の標準フォーマット `.M`(PMD)を QuuBee 内で再生するため、KAJA(梶原正裕)氏作の
**PMD ドライバ + PMP プレイヤ**を同梱する。KAJA 氏は 2019/12/25 に PMD/MC/PMP の全ソースを公開し、
「ソースについての著作権は放棄しませんが、**ご自由に使って頂いて構いません**。むしろ…再利用するアイデアが
あるようでしたら、ぜひ利用してやってください」と明記している。QuuBee はこの自由公開ソースから**自分自身で
バイナリをビルド**する(1997 配布バイナリは「無断の改変・営利使用を禁ず」の別ライセンスなので使わない)。

ビルドは `tools/pmd_build/build_pmd.sh`(MASM 互換アセンブラ UASM を用意し、OPTASM→UASM の機械的な
移植補正を当てて `PMD86.COM` + `PMP.COM` を生成)。素性が完全にクリーンなバイナリのみを同梱する。
**再現性のためソースは commit に pin** し、同梱バイナリの SHA-256 を記録してある（`tools/pmd_build/README.md`
の「再現性」節）。pin ソースからの再ビルドが同梱バイナリと **byte 完全一致**することは確認済（2026-06-26）で、
誰でも同スクリプトで再ビルドして同じハッシュを得られる。
帰属: PMD / MC / PMP © M.Kajihara (KAJA)。原典ソース: https://github.com/d2lmirrors/pmd (KAJA 2019 公開のミラー)。
C60 氏の PMDWin は使用していない(連絡許諾が要るため。Path B は KAJA のドライバのみで完結)。

---

## OPNA リズム音源の代替音色 — `web/assets/rhythm/2608_*.wav`

YM2608(OPNA)の内蔵リズム音源(バスドラ/スネア/シンバル/ハイハット/タム/リム)を鳴らすには、チップ内蔵 ROM
相当のサンプルデータが要る。本物の YM2608 リズム ROM はヤマハの著作物なので同梱できない(NEC BIOS を同梱しない
のと同じ理由)。そこで font.bmp が NEC フォント ROM の代替であるのと同様に、**クリーンな代替音色**を使う:

メモル氏(J'aime la musique, http://sound.jp/jaime/)が**独自に作成**した「YM2608風リズム音源音色データ」
**2608modoki2**(Ver.2.0)。作者本人が「手持ちの音源から音色を集め、YM2608のリズム音に似せてエディットした」
独自素材であり、ヤマハ ROM のダンプではない。配布同梱の利用条件で「**配布・転載・ソフトへの組み込み等、有償
無償にかかわらずご自由にどうぞ**」と明示されている(原文は `web/assets/rhythm/PROVENANCE_2608modoki2.txt`)。
作者は「組み込んだ場合は何のタイトルに使ったか知らせてくれると嬉しい」としており、これは QuuBee の③敬意の柱に
沿うので連絡したい(KAJA への姿勢と同じ)。本物の OPNA とは波形が根本的に異なるため音色は完全一致ではない。

帰属: 2608modoki2 © メモル (J'aime la musique)。入手元: http://sound.jp/jaime/ 。

---

## PC-98 画像フォーマット — Pi (`.PI`) / MAG (`.MAG`) のデコード

PC-98 のフリーソフト/同人 CG 文化で標準的に使われた 2 大画像フォーマット **Pi** と **MAG (MAKI02)** を
ビューアで表示するため、QuuBee は**フォーマットの事実だけを用いた自前デコーダ**を持つ
(`web/player/piimage.js` / `web/player/magimage.js`、QuuBee 独自コードなので **MIT**)。
画像ファイルそのものも第三者のローダ/ライブラリのバイナリ・ソースも**一切同梱しない**。

**Pi 形式**は柳沢明氏が考案 (X68 版 Pi.r が原典)、PC-98 用ローダ/セーバは電脳科学研究所/BERO (石尾孝弘氏)
による。組み込み用ローダ (`pi24.lzh` の `piloadc.asm` 等) のドキュメントには「資料が完全に公開されている」
「転載・使用は私の承認無しに自由」「組み込みに当たりソースの変更などなさってもかまわない」「営利目的で使用しても
構わない」と明記され、**唯一の条件が「その事をどこかに一言書いて下さい (簡単には見れない所でも可)」**である。
本項がその一言にあたる。QuuBee はこの公開資料を仕様リファレンスに参照したが、コードは逐語移植せず独自に実装した
(検証は同一画像の Pi 版と MAG 版がピクセル単位で一致することによる、`tools/pi_test.js`)。

帰属: Pi format © 柳沢明 / PC-98 ローダ © 電脳科学研究所・BERO (石尾孝弘)。MAG (MAKI02) format © woody-RINN ほか。

---

## QuuBee 自身

QuuBee のブリッジ層・フロントエンド・ツール群（`native/` の `qb_*`/`bridge`/`dos_*`、`web/player/`、
`web/index.html`、`tools/`、`emscripten/`、`docs/` 等、msonrm 著作の部分）は **MIT**（`LICENSE-MIT`）。
配布バイナリ全体は GPL 部品を含まない寛容ライセンスの集合体で（上記＊で整合化済み・全体像は冒頭の表）、
QuuBee 独自部分は MIT 単独で再利用できる（fmgen の「フリーソフト配布」条件のみバイナリ全体に及ぶ）。
BIOS は NEC の ROM を使用せず NP2kai の合成 BIOS を用い、DOS は MS-DOS を使用せず INT 21h を独自に
HLE 実装している（proprietary 非同梱という意味で「著作権クリーン」）。
