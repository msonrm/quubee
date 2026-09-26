; M.COM — MPU-PC98 (UART) へ MIDI を送って音を鳴らしたまま止まる。ステートセーブの MIDI の控え用。
;   ch0: 音色 40 (バイオリン)・CC7=90・CC11=100・CC10=20・RPN0 (ベンド幅) = 12 半音・ピッチベンド 1000h・
;        サステイン ON・RPN 0 を選んだまま。ch1: 音色 73 (フルート)・CC10=110。両 ch で note on。
org 100h
    mov dx, 0E0D2h
    mov al, 3Fh             ; UART モード
    out dx, al
    mov dx, 0E0D0h
    mov si, msg
.s: lodsb
    cmp si, msg_end + 1
    je hang
    out dx, al
    jmp .s
hang: jmp hang
msg:
    db 0C0h, 40
    db 0B0h, 7, 90
    db 0B0h, 11, 100
    db 0B0h, 10, 20
    db 0B0h, 101, 0, 0B0h, 100, 0, 0B0h, 6, 12, 0B0h, 38, 0
    db 0E0h, 00h, 20h
    db 0B0h, 64, 127
    db 0C1h, 73
    db 0B1h, 10, 110
    db 90h, 60, 100
    db 91h, 72, 100
msg_end:
