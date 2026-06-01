#!/usr/bin/env python3
"""
T2 用テスト: PSP[0x80] (cmdline length) と PSP[0x81..] (cmdline tail) を読んで
"ARGS:[<tail>]\r\n" を表示する最小の args.com を生成する。
hello.com.py と同じくバイナリ直書き (アセンブラ非依存)。

PSP tail は通常 0x0D 終端だが、INT 21h AH=09h は '$' 終端を要求するので、
length 分オフセットした位置 (PSP[0x81+len]) を '$' に書き換えてから印字する。

レイアウト (ORG 0x100):
  100: 8A 0E 80 00     MOV CL, [0080h]         ; cmdline length
  104: B5 00           MOV CH, 0               ; CX = length
  106: BB 81 00        MOV BX, 0081h           ; cmdline 先頭
  109: 01 CB           ADD BX, CX              ; BX = 0x0D terminator
  10B: C6 07 24        MOV BYTE [BX], '$'      ; '$' に置換
  10E: B4 09           MOV AH, 09h             ; print "ARGS:["
  110: BA xx xx        MOV DX, prefix_off
  113: CD 21           INT 21h
  115: B4 09           MOV AH, 09h             ; print PSP cmdline body
  117: BA 81 00        MOV DX, 0081h
  11A: CD 21           INT 21h
  11C: B4 09           MOV AH, 09h             ; print "]\r\n"
  11E: BA xx xx        MOV DX, suffix_off
  121: CD 21           INT 21h
  123: B4 4C           MOV AH, 4Ch             ; exit code 0
  125: B0 00           MOV AL, 00h
  127: CD 21           INT 21h
  129: "ARGS:[$"
  130: "]\r\n$"
"""
import sys

PREFIX = b'ARGS:['
SUFFIX = b']\r\n'

code = bytearray()

# 1) PSP[0x81 + len] (= 0x0D) を '$' に書き換え
code += b'\x8A\x0E\x80\x00'   # MOV CL, [0080h]
code += b'\xB5\x00'            # MOV CH, 0
code += b'\xBB\x81\x00'        # MOV BX, 0081h
code += b'\x01\xCB'            # ADD BX, CX
code += b'\xC6\x07\x24'        # MOV BYTE PTR [BX], '$'

# 2) print "ARGS:["
code += b'\xB4\x09'            # MOV AH, 09h
prefix_dx_pos = len(code) + 1  # 直後の MOV DX, imm16 の即値位置
code += b'\xBA\x00\x00'        # MOV DX, prefix_offset (後でパッチ)
code += b'\xCD\x21'            # INT 21h

# 3) print PSP cmdline body (DS:0081h)
code += b'\xB4\x09'            # MOV AH, 09h
code += b'\xBA\x81\x00'        # MOV DX, 0081h
code += b'\xCD\x21'            # INT 21h

# 4) print "]\r\n"
code += b'\xB4\x09'            # MOV AH, 09h
suffix_dx_pos = len(code) + 1
code += b'\xBA\x00\x00'        # MOV DX, suffix_offset (後でパッチ)
code += b'\xCD\x21'            # INT 21h

# 5) exit code 0
code += b'\xB4\x4C'            # MOV AH, 4Ch
code += b'\xB0\x00'            # MOV AL, 00h
code += b'\xCD\x21'            # INT 21h

# データ部
prefix_offset = 0x100 + len(code)
code += PREFIX + b'$'
suffix_offset = 0x100 + len(code)
code += SUFFIX + b'$'

# 即値パッチ
code[prefix_dx_pos]     = prefix_offset & 0xFF
code[prefix_dx_pos + 1] = (prefix_offset >> 8) & 0xFF
code[suffix_dx_pos]     = suffix_offset & 0xFF
code[suffix_dx_pos + 1] = (suffix_offset >> 8) & 0xFF

out = sys.argv[1] if len(sys.argv) > 1 else 'args.com'
with open(out, 'wb') as f:
    f.write(code)
print(f'Written: {out} ({len(code)} bytes)')
