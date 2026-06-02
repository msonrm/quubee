#!/usr/bin/env python3
r"""
HLE-DOS 動作確認用テスト COM (2026-06-02 追加分: 39h/3Ah/3Bh/36h + CHDIR 前置)。

新しい INT 21h ファンクションを順に叩き、各結果を画面 (tty) に PASS/FAIL で出す:
  39h MKDIR "SAVE"  / 3Bh CHDIR "SAVE" / 47h GetCurDir (実際に "SAVE" が返るか) /
  3Ch+40h+3Eh で cwd(=SAVE) 内にファイル作成 (CHDIR 前置が効いているかは /run/SAVE に
  ファイルが出来るかで確定) / 3Bh CHDIR ".." / 39h+3Ah MKDIR&RMDIR "TMP" /
  36h GetDiskFreeSpace (free クラスタ数を 16 進表示)。

冒頭で前回の SAVE\TEST.DAT と SAVE を掃除する (再実行で MKDIR が "既存=FAIL" にならないよう)。

アセンブラ非依存。小さなラベル/フィックスアップ機構で機械語を直書きする (ORG 0x100, COM)。
ブラウザで /run に置いてこの COM を Run → 画面の PASS/FAIL と、DevTools の
  qbDebug.ls('/run/SAVE')        => ['TEST.DAT']
  qbDebug.read('/run/SAVE/TEST.DAT')  => "QuuBee" のバイト列
で CHDIR 前置 + MKDIR を確定検証できる。
"""
import sys

ORG = 0x100
code = bytearray()
labels = {}          # name -> absolute offset (ORG based)
fixups = []          # (pos_in_code, name, kind)  kind: 'abs16' | 'rel8' | 'rel16'

def emit(b): code.extend(b)
def here(): return ORG + len(code)
def label(name): labels[name] = here()

def abs16(name):                       # 2-byte absolute offset placeholder
    fixups.append((len(code), name, 'abs16')); emit(b'\x00\x00')
def call(name):                        # E8 cw (near call, rel16)
    emit(b'\xE8'); fixups.append((len(code), name, 'rel16')); emit(b'\x00\x00')
def jshort(op, name):                  # opcode + rel8
    emit(bytes([op])); fixups.append((len(code), name, 'rel8')); emit(b'\x00')

# --- 高水準ヘルパ ---
def mov_ah(v):  emit(bytes([0xB4, v]))
def mov_al(v):  emit(bytes([0xB0, v]))
def mov_dx(name): emit(b'\xBA'); abs16(name)
def mov_si(name): emit(b'\xBE'); abs16(name)
def mov_cx(v):  emit(b'\xB9'); emit(v.to_bytes(2, 'little'))
def xor_dl():   emit(b'\x30\xD2')      # xor dl,dl
def xor_cx():   emit(b'\x31\xC9')      # xor cx,cx
def int21():    emit(b'\xCD\x21')
def ret():      emit(b'\xC3')
def clc():      emit(b'\xF8')
def stc():      emit(b'\xF9')

def puts(name):                        # AH=09h print $-terminated string
    mov_ah(0x09); mov_dx(name); int21()

# ============================ main ============================
# 前回実行の残骸を掃除 (結果は無視): delete SAVE\TEST.DAT, rmdir SAVE
mov_ah(0x41); mov_dx('SAVEFILE'); int21()      # 41h delete
mov_ah(0x3A); mov_dx('SAVENAME'); int21()      # 3Ah rmdir SAVE

puts('HDR')

# --- MKDIR SAVE ---
puts('P_MKDIR')
mov_ah(0x39); mov_dx('SAVENAME'); int21()
call('prstat')

# --- CHDIR SAVE ---
puts('P_CHDIR')
mov_ah(0x3B); mov_dx('SAVENAME'); int21()
call('prstat')

# --- GETCWD (should print "SAVE") ---
puts('P_GETCWD')
xor_dl(); mov_si('CWDBUF'); mov_ah(0x47); int21()   # 47h DL=drive DS:SI=buf
mov_si('CWDBUF'); call('prasciz')
puts('RBRK')

# --- create+write+close in cwd (=SAVE) ---
puts('P_WRITE')
mov_ah(0x3C); xor_cx(); mov_dx('FNAME'); int21()    # 3Ch create
jshort(0x72, 'wfail')                                # jc wfail
emit(b'\x89\xC3')                                    # mov bx,ax (handle)
mov_ah(0x40); mov_cx(6); mov_dx('WDATA'); int21()    # 40h write 6 bytes
jshort(0x72, 'wfail')
mov_ah(0x3E); int21()                                # 3Eh close (BX=handle)
jshort(0x72, 'wfail')
clc(); jshort(0xEB, 'wdone')
label('wfail'); stc()
label('wdone'); call('prstat')

# --- CHDIR .. ---
puts('P_CHUP')
mov_ah(0x3B); mov_dx('DOTDOT'); int21()
call('prstat')

# --- MKDIR TMP then RMDIR TMP (report rmdir) ---
puts('P_RMDIR')
mov_ah(0x39); mov_dx('TMPNAME'); int21()             # mkdir TMP (ignore)
mov_ah(0x3A); mov_dx('TMPNAME'); int21()             # rmdir TMP
call('prstat')

# --- 36h Get Disk Free Space ---
puts('P_FREE')
mov_ah(0x36); xor_dl(); int21()                      # AX=sec/clus BX=free CX=byte/sec DX=total
emit(b'\x3D\xFF\xFF')                                # cmp ax,0FFFFh
jshort(0x74, 'fsfail')                               # je fsfail
puts('P_FREEOK')                                     # "OK  free="
call('prhex16')                                      # print BX (free clusters) hex
puts('CRLF')
jshort(0xEB, 'fsdone')
label('fsfail'); puts('FAILMSG')
label('fsdone')

puts('DONE')
mov_ah(0x4C); mov_al(0x00); int21()                  # exit

# ============================ subroutines ============================
# prstat: CF を見て "OK\r\n" / "FAIL\r\n" を出す (CALL は flags 不変なので CF が届く)
label('prstat')
jshort(0x72, 'prstat_fail')                          # jc fail
puts('OKMSG'); ret()
label('prstat_fail')
puts('FAILMSG'); ret()

# prasciz: DS:SI の ASCIZ を AH=02h で出す
label('prasciz')
label('pra_loop')
emit(b'\xAC')                                        # lodsb
emit(b'\x84\xC0')                                    # test al,al
jshort(0x74, 'pra_done')                             # jz done
emit(b'\x88\xC2')                                    # mov dl,al
mov_ah(0x02); int21()
jshort(0xEB, 'pra_loop')
label('pra_done'); ret()

# prhex16: BX を 4 桁 16 進で出す (MSB first)
label('prhex16')
mov_cx(4)
label('ph_next')
emit(b'\xC1\xC3\x04')                                # rol bx,4
emit(b'\x8A\xC3')                                    # mov al,bl
emit(b'\x24\x0F')                                    # and al,0Fh
emit(b'\x3C\x0A')                                    # cmp al,0Ah
jshort(0x72, 'ph_dig')                               # jb dig
emit(b'\x04\x37')                                    # add al,'A'-10
jshort(0xEB, 'ph_out')
label('ph_dig'); emit(b'\x04\x30')                   # add al,'0'
label('ph_out')
emit(b'\x88\xC2')                                    # mov dl,al
mov_ah(0x02); int21()
emit(b'\xE2')                                        # loop ph_next
fixups.append((len(code), 'ph_next', 'rel8')); emit(b'\x00')
ret()

# ============================ data ============================
def data(name, b):
    label(name); emit(b)

data('HDR',     b'=== DOS HLE TEST ===\r\n$')
data('P_MKDIR', b'MKDIR SAVE  : $')
data('P_CHDIR', b'CHDIR SAVE  : $')
data('P_GETCWD',b'GETCWD      : [$')
data('RBRK',    b']\r\n$')
data('P_WRITE', b'WRITE FILE  : $')
data('P_CHUP',  b'CHDIR ..    : $')
data('P_RMDIR', b'RMDIR TMP   : $')
data('P_FREE',  b'FREESPACE   : $')
data('P_FREEOK',b'OK  free=$')
data('DONE',    b'=== DONE ===\r\n$')
data('OKMSG',   b'OK\r\n$')
data('FAILMSG', b'FAIL\r\n$')
data('CRLF',    b'\r\n$')
data('SAVENAME',b'SAVE\x00')
data('TMPNAME', b'TMP\x00')
data('DOTDOT',  b'..\x00')
data('FNAME',   b'TEST.DAT\x00')
data('SAVEFILE',b'SAVE\\TEST.DAT\x00')
data('WDATA',   b'QuuBee')
data('CWDBUF',  b'\x00' * 64)

# ============================ fixups ============================
for pos, name, kind in fixups:
    if name not in labels:
        raise SystemExit(f'undefined label: {name}')
    tgt = labels[name]
    if kind == 'abs16':
        code[pos]     = tgt & 0xFF
        code[pos + 1] = (tgt >> 8) & 0xFF
    elif kind == 'rel16':
        rel = tgt - (ORG + pos + 2)
        rel &= 0xFFFF
        code[pos]     = rel & 0xFF
        code[pos + 1] = (rel >> 8) & 0xFF
    elif kind == 'rel8':
        rel = tgt - (ORG + pos + 1)
        if rel < -128 or rel > 127:
            raise SystemExit(f'rel8 out of range for {name}: {rel}')
        code[pos] = rel & 0xFF

out = sys.argv[1] if len(sys.argv) > 1 else 'dostest.com'
with open(out, 'wb') as f:
    f.write(code)
print(f'Written: {out} ({len(code)} bytes)')
