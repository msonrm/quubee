# CREDITS / サードパーティ ライセンス表記

QB が同梱・配布する第三者アセットおよびコンポーネントの著作権表示。
（QB 自身が再配布・ホスティングするのは下記。ゲーム/ソフト本体はユーザーが用意するフリーソフトであり、
QB は配布しない。）

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

AZO234 / Neko Project II kai。**MIT License**（全文は `core/np2kai` 内のライセンスファイルを参照）。
QB がビルドする WebAssembly には NP2kai が静的リンクされる。NP2kai が内蔵する各コンポーネント
（fmgen / opngen、mamebsd、VERMOUTH 等）のライセンスは `core/np2kai` 配下の各ディレクトリを参照。

---

## QB 自身

QB のブリッジ層・フロントエンド・ツール群（`native/`, `web/`, `tools/`, `emscripten/`）は本リポジトリの
ライセンスに従う。BIOS は NEC の ROM を使用せず NP2kai の合成 BIOS を用い、DOS は MS-DOS を使用せず
INT 21h を独自に HLE 実装している（著作権クリーンな構成）。
