#!/usr/bin/env python3
"""
SJIS 漢字描画の単離検証用 COM。INT 21h AH=09h で「既知の Shift-JIS 文字列」を
印字するだけ。tty_putc → vram_put_char(ANK) / vram_put_kanji(全角) の経路を
ゲームの複雑さ抜きで白黒つける (T1 の hello.com と同じ流儀)。

画面に出るべき内容 (上から):
  ANK :0123456789ABC      ← 単バイト ASCII (vram_put_char)
  HANK:ｱｲｳｴｵ              ← 半角カナ 0xB1-0xB5 (単バイト ANK、漢字経路に行かない)
  KANA:あいうえお          ← 全角ひらがな (SJIS 82a0.. → JIS 2422.. → 漢字 2 セル)
  KANJI:日本語漢字         ← 全角漢字
  END.

レイアウト (ORG 0x100): hello.com.py と同じ
  100: B4 09          MOV AH, 09h
  102: BA <off>       MOV DX, msg_offset
  105: CD 21          INT 21h
  107: B4 4C          MOV AH, 4Ch
  109: B0 00          MOV AL, 00h
  10B: CD 21          INT 21h
  10D: msg ($ 終端)
"""
import sys

# ESC c で画面クリア + カーソル原点 (tty の TTY_ESC→'c' 経路)。
text = (
    '\x1bc'
    'ANK :0123456789ABC\r\n'
    'HANK:ｱｲｳｴｵ\r\n'   # 半角カナ ｱｲｳｴｵ
    'KANA:あいうえお\r\n'   # あいうえお
    'KANJI:日本語漢字\r\n'  # 日本語漢字
    'END.\r\n'
)
MSG = text.encode('shift_jis') + b'$'
# 念のため: AH=09h を途中で止める '$' (0x24) が本文中に無いことを保証
assert 0x24 not in MSG[:-1], 'string contains a stray $ (0x24) before terminator'

code = bytearray()
code += b'\xB4\x09'         # MOV AH, 09h
code += b'\xBA\x00\x00'     # MOV DX, msg_offset (後で埋める)
code += b'\xCD\x21'         # INT 21h
code += b'\xB4\x4C'         # MOV AH, 4Ch
code += b'\xB0\x00'         # MOV AL, 00h
code += b'\xCD\x21'         # INT 21h
msg_offset = 0x100 + len(code)
code[3] = msg_offset & 0xFF
code[4] = (msg_offset >> 8) & 0xFF
code += MSG

out = sys.argv[1] if len(sys.argv) > 1 else 'sjistest.com'
with open(out, 'wb') as f:
    f.write(code)
print(f'Written: {out} ({len(code)} bytes), msg={len(MSG)} bytes')
