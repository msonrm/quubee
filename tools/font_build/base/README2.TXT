■■■ Neko Project II用 代替フォントビットマップ ■■■

Windows版 Neko Project IIでは実機FONTがないときに、OSのフォントを使って
表示用のフォントを自動生成します。これによって実機FONTがなくてもある程度
使用できるようになっています。ところが、Windows以外ではこのフォント生成
機能が恐らくなく（追記：SDL版はある）実機フォントが必須になってしまいます。
そこで、どんな環境でも使用できる代替フォントファイルを用意してみました。
ベースはさざなみフォントですので、ライセンスは猫本体と同じ修正BSDになります。
なお、ビットマップには機種依存文字や欠けている文字を自力で追加していますが、
この部分も同じ修正BSDライセンスとします。

●動作環境
Neko Project II系全般
（BMPの読込対応なら他のエミュレータでも使えると思われます）

●使い方
Neko Project II系の場合、EXEと同じ場所にfont.bmpを置いて下さい。
なお、フォント読み込みの優先順位は以下のようになっています。
font.bmp → font.rom → font.tmp

●ライセンス
全体としては修正BSDライセンスになります。
文書がないと困るかも知れないので一応書いておきます。
私自身は少しいじっただけなので特に権利主張する気はありませんが、
READMEファイル記載の元フォントのライセンスは確認しておいて下さい。
一部のグリフはNeko Priject II内蔵のものです。これも修正BSDライセンスです。

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

------------------------
Neko Project 21/W 開発者
SimK
