#!/usr/bin/env python3
"""
T3 用テスト: 最小 MZ EXE ジェネレータ。reloc 1 件を含み、データセグメントを
コードセグメントと別に持つ構造で「reloc 適用 + multi-segment 起動」両方の
通電を確認する。

レイアウト (image body, header strip 後):
  body 0x00..0x11: code (18 byte、relative seg 0、IP=0)
    B8 02 00        MOV AX, 0002h        ; immediate (body+1) が reloc 対象
    8E D8           MOV DS, AX           ; DS = image_base + 2
    B4 09           MOV AH, 09h
    BA 00 00        MOV DX, 0000h        ; offset within data segment
    CD 21           INT 21h              ; print "HELLO EXE\r\n"
    B4 4C           MOV AH, 4Ch
    B0 00           MOV AL, 00h
    CD 21           INT 21h              ; exit code 0
  body 0x12..0x1F: NOP padding (data alignment 用)
  body 0x20..0x2B: "HELLO EXE\r\n$" (relative seg 2)

MZ ヘッダ (32 byte):
  e_magic   = 'MZ'
  e_cblp    = file size mod 512
  e_cp      = ceil(file_size / 512)
  e_crlc    = 1
  e_cparhdr = 2  (= 32 byte = 2 paragraphs)
  e_minalloc = 0x10 (256 byte extra)
  e_maxalloc = 0xFFFF
  e_ss/sp   = 0004 / 0100
  e_cs/ip   = 0000 / 0000
  e_lfarlc  = 0x1C  (reloc table 直後)

reloc エントリ (4 byte): off=0x0001, seg=0x0000
  → 実行時 image_base_seg (0x0110) を MOV AX の即値に加算 → DS = 0x0112
  → DS:0000 (= linear 0x1120) = MSG 先頭

期待出力: "HELLO EXE\r\n"、exit code 0。
"""

import struct
import sys

MSG = b'HELLO EXE\r\n$'
DATA_REL_SEG  = 0x0002
STACK_REL_SEG = 0x0004
STACK_SP      = 0x0100

# --- code ---
code = bytearray()
code += b'\xB8'                                # MOV AX, imm16
reloc_off_in_body = len(code)                  # immediate at body offset 1
code += struct.pack('<H', DATA_REL_SEG)        # 02 00 → reloc'd to (image_base + 2)
code += b'\x8E\xD8'                            # MOV DS, AX
code += b'\xB4\x09'                            # MOV AH, 09h
code += b'\xBA\x00\x00'                        # MOV DX, 0000h
code += b'\xCD\x21'                            # INT 21h
code += b'\xB4\x4C'                            # MOV AH, 4Ch
code += b'\xB0\x00'                            # MOV AL, 00h
code += b'\xCD\x21'                            # INT 21h

# data を relative seg 2 (= body offset 0x20) に置くため NOP で埋める
while len(code) < 0x20:
    code += b'\x90'

body = bytes(code) + MSG
body_size = len(body)

# --- MZ header (32 byte = 2 paragraphs) ---
HEADER_PARAGRAPHS = 2
HEADER_BYTES = HEADER_PARAGRAPHS * 16

image_size_file = HEADER_BYTES + body_size
e_cp   = (image_size_file + 511) // 512
e_cblp = image_size_file % 512   # 0 = full last page convention

header = bytearray(HEADER_BYTES)
struct.pack_into('<H', header, 0x00, 0x5A4D)            # e_magic = 'MZ'
struct.pack_into('<H', header, 0x02, e_cblp)
struct.pack_into('<H', header, 0x04, e_cp)
struct.pack_into('<H', header, 0x06, 1)                 # e_crlc
struct.pack_into('<H', header, 0x08, HEADER_PARAGRAPHS) # e_cparhdr
struct.pack_into('<H', header, 0x0A, 0x0010)            # e_minalloc
struct.pack_into('<H', header, 0x0C, 0xFFFF)            # e_maxalloc
struct.pack_into('<H', header, 0x0E, STACK_REL_SEG)     # e_ss
struct.pack_into('<H', header, 0x10, STACK_SP)          # e_sp
struct.pack_into('<H', header, 0x12, 0x0000)            # e_csum
struct.pack_into('<H', header, 0x14, 0x0000)            # e_ip
struct.pack_into('<H', header, 0x16, 0x0000)            # e_cs
struct.pack_into('<H', header, 0x18, 0x001C)            # e_lfarlc
struct.pack_into('<H', header, 0x1A, 0x0000)            # e_ovno
# reloc entry: off, seg (within body)
struct.pack_into('<HH', header, 0x1C, reloc_off_in_body, 0x0000)

out = sys.argv[1] if len(sys.argv) > 1 else 'hello.exe'
exe = bytes(header) + body
with open(out, 'wb') as f:
    f.write(exe)
print(f'Written: {out} ({len(exe)} bytes; header={HEADER_BYTES} body={body_size} '
      f'e_cp={e_cp} e_cblp={e_cblp})')
