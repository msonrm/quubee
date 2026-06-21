#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
font.bmp に JIS 区8 (罫線 / box-drawing) のグリフを生成・注入する。

背景: web/assets/font.bmp (sazanami 由来の自作生成フォント) は生成時に JIS 区8 を
まるごと取りこぼしており (全 94 点が ink=0)、VZ Editor の GAME.BAT (テトリス) が
プレイフィールド枠を区8の太線罫線 (┏━┓┃┗┛) でテキスト VRAM に直接書くため、
NP2kai のテキストレンダラがフォント ROM を引いても枠が描かれず不可視になっていた。
ブロックは区2 (□■、font.bmp に在り) なので表示される、という非対称が症状。

罫線は単純な幾何形状なのでクリーンに自前生成できる (font.bmp 自体が NEC フォントの
クリーン代替なのと同じ思想)。本スクリプトは区8 点1-32 を 16x16 セルに中央寄せ
(細線 1px / 太線 2px) で描き、既存 font.bmp の区8ストリップだけを上書きする。

font.bmp 形式: 2048x2048, 1bpp, bottom-up。背景=1 ビット (0xff バイト)、ink=0 ビット。
NP2kai font.c の fontpc98.c:pc98knjcpy が読む際 fontrom = ~BMP なので、ink を立てるには
BMP 側のビットを 0 にする。グリフ (ku, jis_lo=N) の配置式は pc98knjcpy の逆写像:
  p_start = SIZE + (ku<<1) - (FONTY*LINE) - (N-1)*FONTY*LINE   (N = 点+0x20)
  表示行 r (0=上) のファイルオフセット = p_start - (16-r)*LINE
  左バイト = x0..7、右バイト = x8..15。

この読み出し式は font.c と同一で、未改変 font.bmp から □/■/ひらがなを既知形状どおり
抽出できることを確認済み (= エミュレータが実際に見る内容のグラウンドトゥルース)。
書き込み後、同式で読み戻して意図グリッドと一致することを検証する。
"""
import struct, sys, os

BMP = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'font.bmp')
W = H = 2048
LINE = W // 8          # 256
SIZE = LINE * H        # 524288
FONTY = 16

# 区8 点1-32: (up, down, left, right) のアーム重み。None / 'L'(細線) / 'H'(太線)。
# Unicode 文字キーで定義し、SJIS から区点を算出して配置する (点番号の手動ミスを排除)。
L, Hv = 'L', 'H'
GLYPHS = {
    '─': (None, None, L,  L ),  # 1  light horizontal
    '│': (L,  L,  None, None),  # 2  light vertical
    '┌': (None, L,  None, L ),  # 3
    '┐': (None, L,  L,  None),  # 4
    '┘': (L,  None, L,  None),  # 5
    '└': (L,  None, None, L ),  # 6
    '├': (L,  L,  None, L ),    # 7
    '┬': (None, L,  L,  L ),    # 8
    '┤': (L,  L,  L,  None),    # 9
    '┴': (L,  None, L,  L ),    # 10
    '┼': (L,  L,  L,  L ),      # 11
    '━': (None, None, Hv, Hv),  # 12 heavy horizontal
    '┃': (Hv, Hv, None, None),  # 13 heavy vertical
    '┏': (None, Hv, None, Hv),  # 14
    '┓': (None, Hv, Hv, None),  # 15
    '┛': (Hv, None, Hv, None),  # 16
    '┗': (Hv, None, None, Hv),  # 17
    '┣': (Hv, Hv, None, Hv),    # 18
    '┳': (None, Hv, Hv, Hv),    # 19
    '┫': (Hv, Hv, Hv, None),    # 20
    '┻': (Hv, None, Hv, Hv),    # 21
    '╋': (Hv, Hv, Hv, Hv),      # 22
    '┠': (Hv, Hv, None, L ),    # 23 heavy vert + light right
    '┯': (None, L,  Hv, Hv),    # 24 light down + heavy horiz
    '┨': (Hv, Hv, L,  None),    # 25 heavy vert + light left
    '┷': (L,  None, Hv, Hv),    # 26 light up + heavy horiz
    '┿': (L,  L,  Hv, Hv),      # 27 light vert + heavy horiz
    '┝': (L,  L,  None, Hv),    # 28 light vert + heavy right
    '┰': (None, Hv, L,  L ),    # 29 heavy down + light horiz
    '┥': (L,  L,  Hv, None),    # 30 light vert + heavy left
    '┸': (Hv, None, L,  L ),    # 31 heavy up + light horiz
    '╂': (Hv, Hv, L,  L ),      # 32 heavy vert + light horiz
}

def sjis_to_kuten(ch):
    b = ch.encode('shift_jis')
    s1, s2 = b[0], b[1]
    j1 = (s1 - 0x81) * 2 + 0x21 if s1 < 0xa0 else (s1 - 0xc1) * 2 + 0x21
    if s2 < 0x7f:   j2 = s2 - 0x1f
    elif s2 < 0x9f: j2 = s2 - 0x20
    else:           j2 = s2 - 0x7e; j1 += 1
    return j1 - 0x20, j2 - 0x20   # (ku, ten)

def make_grid(arms):
    """16x16 の bool グリッド (px[y][x], True=ink) を生成。
    中央 7,8 を跨いでアームを伸ばし接合部の隙間を防ぐ。
    細線=index 8 / 太線={7,8}。アームは中央 7..8 から端まで。"""
    up, dn, lf, rt = arms
    g = [[False]*16 for _ in range(16)]
    def rows(w): return [7, 8] if w == 'H' else [8]   # 横線が占める行
    def cols(w): return [7, 8] if w == 'H' else [8]    # 縦線が占める列
    if lf:
        for y in rows(lf):
            for x in range(0, 9):  g[y][x] = True       # 左端→中央
    if rt:
        for y in rows(rt):
            for x in range(7, 16): g[y][x] = True       # 中央→右端
    if up:
        for x in cols(up):
            for y in range(0, 9):  g[y][x] = True
    if dn:
        for x in cols(dn):
            for y in range(7, 16): g[y][x] = True
    return g

def grid_to_bytes(g):
    """各行 (left_byte, right_byte)。背景=1、ink=0 ビット。"""
    out = []
    for y in range(16):
        left = right = 0xff
        for x in range(16):
            if g[y][x]:
                if x < 8: left  &= ~(1 << (7 - x)) & 0xff
                else:     right &= ~(1 << (15 - x)) & 0xff
        out.append((left, right))
    return out

def write_glyph(pix, ku, ten, rows):
    # fontrom 行 k (= エミュレータ表示の上から k 行目) は BMP[p_start-(k+1)*LINE] を読む
    # (pc98knjcpy は k=0 を最初に読み fontrom 先頭に積む → 表示の最上段)。よって表示行 r を
    # p_start-(r+1)*LINE へ書く。既存の非対称グリフ (Ｆ/Ｌ/う) を k 順で抽出すると正立する
    # ことで向きを確定済み (対称グリフはラウンドトリップを通すため向きを検出できない)。
    N = ten + 0x20
    p_start = SIZE + (ku << 1) - (FONTY * LINE) - (N - 1) * FONTY * LINE
    for r in range(16):                       # r=0 上 .. 15 下
        off = p_start - (r + 1) * LINE
        left, right = rows[r]
        pix[off]     = left
        pix[off + 1] = right

def read_glyph(pix, ku, ten):
    """font.c と同一式で読み戻し、エミュレータ表示順 (上→下 = k 順) の bool グリッドを返す。"""
    N = ten + 0x20
    p = SIZE + (ku << 1) - (FONTY * LINE) - (N - 1) * FONTY * LINE
    rows = []
    for _ in range(16):                        # k=0 (上) .. 15 (下)、reverse しない
        p -= LINE
        b0 = (~pix[p]) & 0xff
        b1 = (~pix[p + 1]) & 0xff
        rows.append((b0, b1))
    g = [[bool((b0 >> (7 - x)) & 1) if x < 8 else bool((b1 >> (15 - x)) & 1)
          for x in range(16)] for (b0, b1) in rows]
    return g

def main():
    with open(BMP, 'rb') as f:
        data = bytearray(f.read())
    bfOff = struct.unpack('<I', data[10:14])[0]
    w, h = struct.unpack('<ii', data[18:26])
    bpp = struct.unpack('<H', data[28:30])[0]
    assert (w, h, bpp) == (W, H, 1), f"unexpected BMP {w}x{h} {bpp}bpp"
    pix = memoryview(data)[bfOff:]

    placed = []
    for ch, arms in GLYPHS.items():
        ku, ten = sjis_to_kuten(ch)
        assert ku == 8, f"{ch} is ku{ku}, expected 8"
        g = make_grid(arms)
        rows = grid_to_bytes(g)
        write_glyph(pix, ku, ten, rows)
        # ラウンドトリップ検証: 読み戻しが意図グリッドに一致するか
        back = read_glyph(pix, ku, ten)
        assert back == g, f"round-trip mismatch for {ch} (点{ten})"
        placed.append((ten, ch))

    with open(BMP, 'wb') as f:
        f.write(data)
    placed.sort()
    print(f"区8 に {len(placed)} グリフ注入・全ラウンドトリップ一致:")
    print("  " + " ".join(f"{t}:{c}" for t, c in placed))

if __name__ == '__main__':
    main()
