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

## FreeDOS — `tools/testdata/boot.d88`

FreeDOS(98) の 2HD フロッピーイメージ（**GPL**、再配布可）。headless テスト
（`tools/bench_frame.js` / `tools/diskimage_test.js`）専用の素材で、**デプロイ対象外**
（サイトには含まれない。帰属: The FreeDOS Project）。

---

## QuuBee 自身

QuuBee のブリッジ層・フロントエンド・ツール群（`native/` の `qb_*`/`bridge`/`dos_*`、`web/player/`、
`web/index.html`、`tools/`、`emscripten/`、`docs/` 等、msonrm 著作の部分）は
**`MIT OR GPL-2.0-or-later` のデュアルライセンス**（`LICENSE-MIT`）。FPU を除けば MIT 部分のみで再利用できる。
ただし上記 DOSBox FPU を含む**配布バイナリ全体は GPL v2-or-later**（`LICENSE`）。
BIOS は NEC の ROM を使用せず NP2kai の合成 BIOS を用い、DOS は MS-DOS を使用せず INT 21h を独自に
HLE 実装している（proprietary 非同梱という意味で「著作権クリーン」）。
