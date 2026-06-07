// PC-98 .MAG (MAKI02) 画像デコーダ。
//
// MAG は PC-98 時代のデファクト標準画像形式 (woody-RINN 系)。ここでは「フォーマットの事実」のみを
// 用いて自前実装する (Magd v1.25 のソース games/magd25s.lzh を仕様リファレンスに参照したが、
// コードは逐語移植していない。同梱の実サンプル savefont.mag でストリーム消費・寸法・描画を実証済)。
//
// フォーマット要点:
//  - "MAKI02  " (8B) + コメント (0x1A 終端) + 32B ヘッダ + パレット + flagA + flagB + pixel
//  - ヘッダ内オフセットは「ヘッダ先頭 (0x1A の次)」からの相対
//  - flag unit = 2 word = 4 byte 出力。16色: 4B=8px(4bpp) / 256色: 4B=4px(8bpp)
//  - units/line = (x1>>shift)-(x0>>shift)+1  (shift: 16色=3, 256色=2)、lines = y1-y0+1
//  - flagA = MSB 先頭の連続ビット列 (行で再整列しない)。1 のとき flagB を 1 バイト読む
//  - flag[col] (列ごとに行を跨いで持続) に XOR 累積。上位ニブル→左 word, 下位ニブル→右 word
//  - ニブル 0 = pixel ストリームから新規 word を読む / 非0 = 近傍コピー (下記オフセット表)
//  - パレットは G,R,B 順
(function (global) {
    'use strict';

    // pixeloffset[16] (globals.c) を (dy=行, dx=word) に分解。index 0 = リテラル (新規ピクセル)。
    // コピー元 = 現在位置 - (dy*byteWidth + dx*2)。
    const COPY = [
        null,   [0, 1], [0, 2], [0, 4],
        [1, 0], [1, 1], [2, 0], [2, 1], [2, 2],
        [4, 0], [4, 1], [4, 2], [8, 0], [8, 1], [8, 2], [16, 0],
    ];

    const SIG = 'MAKI02  ';
    const MAX_DIM = 2048;   // PC-98 は 640x400 級。暴走ヘッダによる過大確保を弾く上限。

    const rdW = (b, o) => b[o] | (b[o + 1] << 8);
    const rdD = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

    function isMag(bytes) {
        if (!bytes || bytes.length < 9) return false;
        for (let i = 0; i < 8; i++) if (bytes[i] !== SIG.charCodeAt(i)) return false;
        return true;
    }

    // bytes(Uint8Array) → { width, height, scaleY, rgba(Uint8ClampedArray w*h*4),
    //                       comment(string), colors, consumed }。失敗時は throw。
    function decode(bytes) {
        if (!isMag(bytes)) throw new Error('MAKI02 シグネチャがありません (.MAG ではない)');

        // コメント (0x1A 終端) を読み飛ばしてヘッダ先頭 H を得る
        let p = 8;
        while (p < bytes.length && bytes[p] !== 0x1a) p++;
        let comment = '';
        try { comment = new TextDecoder('shift_jis').decode(bytes.subarray(8, p)); } catch (e) {}
        const H = p + 1;
        if (H + 32 > bytes.length) throw new Error('ヘッダが切り詰められています');

        const screenMode = bytes[H + 3];
        const x0 = rdW(bytes, H + 4),  y0 = rdW(bytes, H + 6);
        const x1 = rdW(bytes, H + 8),  y1 = rdW(bytes, H + 10);
        const offA = rdD(bytes, H + 12), offB = rdD(bytes, H + 16), offP = rdD(bytes, H + 24);
        const c256    = (screenMode & 0x80) !== 0;   // bit7 = 256 色
        const line200 = (screenMode & 0x01) !== 0;   // bit0 = 200 ライン (表示時に縦 2 倍)

        const shift = c256 ? 2 : 3;
        const units = (x1 >> shift) - (x0 >> shift) + 1;
        const lines = (y1 - y0 + 1);
        if (units <= 0 || lines <= 0) throw new Error('画像サイズが不正です');
        const byteWidth = units * 4;
        const width = c256 ? byteWidth : byteWidth * 2;
        if (width > MAX_DIM || lines > MAX_DIM) throw new Error(`画像が大きすぎます (${width}x${lines})`);

        // パレット = ヘッダ直後 (offA-32 バイト, G,R,B 順)。16色=48B / 256色=768B。
        const palN = c256 ? 256 : 16;
        const pal = new Uint8Array(palN * 3);
        const palBase = H + 32;
        const palAvail = Math.max(0, Math.min(palN, ((offA - 32) / 3) | 0));
        for (let i = 0; i < palAvail; i++) {
            const o = palBase + i * 3;
            if (o + 2 < bytes.length) { pal[i * 3] = bytes[o]; pal[i * 3 + 1] = bytes[o + 1]; pal[i * 3 + 2] = bytes[o + 2]; }
        }

        // ストリーム読み出し (範囲外は 0 を返して堅牢化)
        const aBase = H + offA, bBase = H + offB, pBase = H + offP;
        const at = (i) => (i >= 0 && i < bytes.length) ? bytes[i] : 0;
        let aByte = 0, aBits = 0, aC = 0;
        const bitA = () => {                          // MSB 先頭・連続
            if (aBits === 0) { aByte = at(aBase + aC++); aBits = 8; }
            const bit = (aByte >> 7) & 1; aByte = (aByte << 1) & 0xff; aBits--; return bit;
        };
        let bC = 0; const byteB = () => at(bBase + bC++);
        let pC = 0;

        const out  = new Uint8Array(byteWidth * lines);   // 出力 (パック済バイト)
        const flag = new Uint8Array(units);               // 列ごとの累積フラグ (行を跨いで持続)
        const copyWord = (dst, e) => {
            const s = dst - (e[0] * byteWidth + e[1] * 2);
            if (s < 0) return;                            // 上端より上は参照不可 → 0 のまま
            out[dst] = out[s]; out[dst + 1] = out[s + 1];
        };

        for (let y = 0; y < lines; y++) {
            for (let c = 0; c < units; c++) if (bitA()) flag[c] ^= byteB();
            const rowBase = y * byteWidth;
            for (let c = 0; c < units; c++) {
                const f = flag[c], hi = f >> 4, lo = f & 0x0f, pos = rowBase + c * 4;
                if (hi === 0) { out[pos]     = at(pBase + pC++); out[pos + 1] = at(pBase + pC++); }
                else copyWord(pos, COPY[hi]);
                if (lo === 0) { out[pos + 2] = at(pBase + pC++); out[pos + 3] = at(pBase + pC++); }
                else copyWord(pos + 2, COPY[lo]);
            }
        }

        // パック → RGBA。16色は 1 バイト = 上位ニブル(左px)/下位ニブル(右px)。パレット G,R,B → R=p1,G=p0,B=p2。
        const rgba = new Uint8ClampedArray(width * lines * 4);
        let di = 0;
        const putPx = (idx) => {
            const o = idx * 3;
            rgba[di] = pal[o + 1]; rgba[di + 1] = pal[o]; rgba[di + 2] = pal[o + 2]; rgba[di + 3] = 255;
            di += 4;
        };
        for (let y = 0; y < lines; y++) {
            for (let x = 0; x < byteWidth; x++) {
                const b = out[y * byteWidth + x];
                if (c256) putPx(b);
                else { putPx(b >> 4); putPx(b & 0x0f); }
            }
        }

        return {
            width, height: lines, scaleY: line200 ? 2 : 1, rgba, comment, colors: palN,
            consumed: { flagA: aC, flagB: bC, pixel: pC },
        };
    }

    global.QBMag = { isMag, decode };
})(typeof window !== 'undefined' ? window : globalThis);
