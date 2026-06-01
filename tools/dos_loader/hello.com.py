#!/usr/bin/env python3
"""
T1 用テスト: 'HELLO PHASE3\r\n$' を INT 21h AH=09h で出して AH=4Ch で終了する
最小の hello.com を生成する。アセンブラに依存しないようバイナリ直書き。

レイアウト (ORG 0x100):
  100: B4 09          MOV AH, 09h
  102: BA 0D 01       MOV DX, offset msg (= 0x010D)
  105: CD 21          INT 21h
  107: B4 4C          MOV AH, 4Ch
  109: B0 00          MOV AL, 00h           ; exit code 0
  10B: CD 21          INT 21h
  10D: msg = "HELLO PHASE3\r\n$"
"""
import sys

MSG = b'HELLO PHASE3\r\n$'

code = bytearray()
code += b'\xB4\x09'         # MOV AH, 09h
code += b'\xBA\x0D\x01'     # MOV DX, 0x010D (msg offset, fixed up after)
code += b'\xCD\x21'         # INT 21h
code += b'\xB4\x4C'         # MOV AH, 4Ch
code += b'\xB0\x00'         # MOV AL, 00h
code += b'\xCD\x21'         # INT 21h
# msg is at CS:(0x100 + len(code)). Patch the MOV DX immediate to match.
msg_offset = 0x100 + len(code)
code[3] = msg_offset & 0xFF
code[4] = (msg_offset >> 8) & 0xFF
code += MSG

out = sys.argv[1] if len(sys.argv) > 1 else 'hello.com'
with open(out, 'wb') as f:
    f.write(code)
print(f'Written: {out} ({len(code)} bytes)')
