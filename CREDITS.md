# CREDITS / サードパーティ ライセンス表記

QuuBee が同梱・配布する第三者アセットおよびコンポーネントの著作権表示。
（QuuBee 自身が再配布・ホスティングするのは下記。ゲーム/ソフト本体はユーザーが用意するフリーソフトであり、
QuuBee は配布しない。）

---

## プロジェクト全体のライセンス

- **配布物（`np2kai_core.wasm` を含むアプリ全体）: GNU GPL v2 or later**（`LICENSE`）。
  理由は下記の DOSBox 由来 FPU エミュレータ（GPLv2-or-later）が結合物全体に GPL を及ぼすため。
- **QuuBee 独自のソース（msonrm 著作の部分）: `MIT OR GPL-2.0-or-later` のデュアル**（`LICENSE-MIT`）。
- 「著作権クリーン」＝ NEC BIOS / MS-DOS 等 proprietary を**同梱しない**意味であり、GPL（オープンソース）
  は公開ホスティングと両立する（ソース公開済み＝GPL 遵守の条件を満たす）。

| コンポーネント | ライセンス |
|---|---|
| QuuBee 独自コード（`native/` の `qb_*`/`bridge`/`dos_*`、`web/player/`、`tools/`、`docs/` 等） | MIT OR GPL-2.0-or-later |
| NP2kai ラッパ本体（AZO234） | MIT |
| i386c CPU コア（NONAKA Kimihiro 他） | BSD（2条項） |
| **FPU `fpemul_dosbox*.c`（DOSBox Team）** | **GPLv2 or later**（← 全体を GPL 化する要因） |
| `web/assets/font.bmp` | 修正 BSD |
| `native/third_party/tsf.h`（TinySoundFont, Bernhard Schelling） | MIT |
| `web/assets/soundfont.sf2`（GeneralUser GS, S. Christian Collins） | 寛容ライセンス（下記） |
| `tools/testdata/boot.d88`（FreeDOS(98)・テスト専用素材） | GPL |

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

THIS SOFTWARE IS PROVIDED BY <COPYRIGHT HOLDER> ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

構成フォントの個別ライセンス（東雲 / 美咲 / M+ / Ayu / Oradano / Kappa / さざなみ）は、
配布アーカイブ `sazanami-fontbmp.zip` の `doc/<フォント名>/` および各フォントの配布元を参照。
いずれも自由に再配布可能なライセンス。

---

## エミュレータコア — NP2kai (`core/np2kai`, git submodule)

AZO234 / Neko Project II kai。ラッパ本体の `LICENSE` は **MIT**（Copyright (c) 2017 AZO）。
QuuBee がビルドする WebAssembly には NP2kai が静的リンクされる。NP2kai は複数ライセンスの集合体で、
QuuBee のビルドに含まれる主なものは:

- **i386c CPU コア**（`i386c/`, Copyright NONAKA Kimihiro 他）— **修正 BSD**（permissive）。
- **FPU エミュレータ**（`i386c/ia32/instructions/fpu/fpemul_dosbox.c` / `fpemul_dosbox2.c`,
  Copyright (C) 2002–2015 The DOSBox Team）— **GNU GPL v2 or later**。QuuBee は `SUPPORT_FPU_DOSBOX2`
  でこれをコンパイルするため、**配布される結合バイナリ全体が GPL v2-or-later となる**（GPL の伝播）。
- 音源（fmgen / opngen）、mamebsd、VERMOUTH 等のライセンスは `core/np2kai` 配下の各ディレクトリを参照。

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
~32MB と大きいためリポジトリには含めず（`.gitignore`）、`tools/setup_soundfont.sh` で取得する。
別の SF2 に差し替えるのも自由（TSF が読める SF2 を `web/assets/soundfont.sf2` に置くだけ・コード変更不要）。

---

## FreeDOS — `tools/testdata/boot.d88`

FreeDOS(98) の 2HD フロッピーイメージ（**GPL**、再配布可）。headless テスト
（`tools/bench_frame.js` / `tools/diskimage_test.js`）専用の素材で、**デプロイ対象外**
（サイトには含まれない。帰属: The FreeDOS Project）。

---

## PMD (Professional Music Driver) — PC-98 FM 音楽 .M の再生

PC-98 同人 FM 音楽の事実上の標準フォーマット `.M`(PMD)を QuuBee 内で再生するため、KAJA(梶原正裕)氏作の
**PMD ドライバ + PMP プレイヤ**を同梱する。KAJA 氏は 2019/12/25 に PMD/MC/PMP の全ソースを公開し、
「ソースについての著作権は放棄しませんが、**ご自由に使って頂いて構いません**。むしろ…再利用するアイデアが
あるようでしたら、ぜひ利用してやってください」と明記している。QuuBee はこの自由公開ソースから**自分自身で
バイナリをビルド**する(1997 配布バイナリは「無断の改変・営利使用を禁ず」の別ライセンスなので使わない)。

ビルドは `tools/pmd_build/build_pmd.sh`(MASM 互換アセンブラ UASM を用意し、OPTASM→UASM の機械的な
移植補正を当てて `PMD86.COM` + `PMP.COM` を生成)。素性が完全にクリーンなバイナリのみを同梱する。
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

## QuuBee 自身

QuuBee のブリッジ層・フロントエンド・ツール群（`native/` の `qb_*`/`bridge`/`dos_*`、`web/player/`、
`web/index.html`、`tools/`、`emscripten/`、`docs/` 等、msonrm 著作の部分）は
**`MIT OR GPL-2.0-or-later` のデュアルライセンス**（`LICENSE-MIT`）。FPU を除けば MIT 部分のみで再利用できる。
ただし上記 DOSBox FPU を含む**配布バイナリ全体は GPL v2-or-later**（`LICENSE`）。
BIOS は NEC の ROM を使用せず NP2kai の合成 BIOS を用い、DOS は MS-DOS を使用せず INT 21h を独自に
HLE 実装している（proprietary 非同梱という意味で「著作権クリーン」）。
