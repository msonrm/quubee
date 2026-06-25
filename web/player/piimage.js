// PC-98 .PI (Pi) 画像デコーダ。
//
// Pi 形式は柳沢明氏が考案した 16 色グラフィックフォーマット (X68 版 Pi.r が原典、PC-98 ローダは
// 電脳科学研究所/BERO による)。資料・ソースが完全公開され、転載/改変/営利利用が承認不要で自由
// (条件は「Pi を使っている旨をどこかに一言書く」のみ — CREDITS に記載)。ここでは「フォーマットの
// 事実」のみを用いて自前実装する (組み込み用ローダ pi24.lzh の piloadc.asm を仕様リファレンスに
// 参照したが、コードは逐語移植していない。同一画像の MAG 版とのピクセル一致で検証)。
//
// フォーマット要点:
//  - "Pi" (2B) + コメント (0x1A 終端) + 追加情報 (0x00 終端) + palflag(1) + aspect(2,LE)
//    + planes(1, 4=16色) + machine(4) + ext_size(2,BE) + ext data + width(2,BE) + height(2,BE)
//    + palette(16*3=48B, R,G,B 順, 各成分は上位ニブルが値 0-15) + 圧縮ストリーム
//  - ext_size / width / height は BE。palflag / aspect は LE
//  - 展開は 1 バイト = 1 ピクセル (色番号を上位ニブルに格納)、2 ピクセル = 1 word 単位で処理
//  - 各 word は「位置予測コピー」か「新規色読み」。位置予測 = 直前word(-2)/2つ左(-4)/真上(-W)/
//    2つ上(-2W)/右上(-W+1)/左上(-W-1)。予測位置が前回と一致するかで分岐
//  - コピー長は Elias-γ 風の可変長 (ランレングス)
//  - 色は「直前色をコンテキストにした MTF カラーリスト + rank のハフマン符号」
//    (rank 0/1 = 2bit、2-3 = 3bit、4-7 = 5bit、8-15 = 6bit)
//  - VRAM プレーン変換 (gtrans) はブラウザでは不要 → 上に番兵 2 行を置いたフルフレームに展開
(function (global) {
    'use strict';

    const MAX_DIM = 2048;   // PC-98 は 640x400 級。暴走ヘッダによる過大確保を弾く上限。

    // 16 色標準パレット (piloadc.asm dftpal、値は 0-15)。palflag bit7=1 (パレット無し) 用。
    const DFTPAL = [
        0,0,0,   0,0,7,   7,0,0,   7,0,7,
        0,7,0,   0,7,7,   7,7,0,   7,7,7,
        0,0,0,   0,0,15,  15,0,0,  15,0,15,
        0,15,0,  0,15,15, 15,15,0, 15,15,15,
    ];

    function isPi(bytes) {
        return !!bytes && bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x69; // "Pi"
    }

    // bytes(Uint8Array) → { width, height, scaleY, rgba(Uint8ClampedArray w*h*4),
    //                       comment(string), colors, consumed }。失敗時は throw。
    function decode(bytes) {
        if (!isPi(bytes)) throw new Error('Pi シグネチャがありません (.PI ではない)');
        const len = bytes.length;
        const at = (i) => (i >= 0 && i < len ? bytes[i] : 0);

        // --- ヘッダ ---
        let p = 2;
        // コメント (0x1A 終端)
        const cstart = p;
        while (p < len && bytes[p] !== 0x1a) p++;
        let comment = '';
        try { comment = new TextDecoder('shift_jis').decode(bytes.subarray(cstart, p)); } catch (e) {}
        if (p < len) p++;                          // skip 0x1A
        // 追加情報 (機種名等、0x00 終端) を読み飛ばす
        while (p < len && bytes[p] !== 0x00) p++;
        if (p < len) p++;                          // skip 0x00

        const palflag = at(p); p += 1;
        p += 2;                                    // aspect (LE) — 画面モード用、展開には不要
        const planes = at(p); p += 1;
        if (planes !== 4) throw new Error(`Pi: 16色 (planes=4) のみ対応 (planes=${planes})`);
        p += 4;                                    // machine code ("PC98" 等) skip
        const extSize = (at(p) << 8) | at(p + 1); p += 2;   // BE
        p += extSize;                              // ext data (始点/透明色) は表示に不要 → skip
        const width  = (at(p) << 8) | at(p + 1); p += 2;    // BE
        const height = (at(p) << 8) | at(p + 1); p += 2;    // BE
        if (width <= 0 || height <= 0 || width > MAX_DIM || height > MAX_DIM)
            throw new Error(`画像サイズが不正です (${width}x${height})`);

        // パレット (48B, R,G,B 順, 各成分の上位ニブルが値 0-15)
        const pal = new Uint8Array(16 * 3);
        if (!(palflag & 0x80)) {
            for (let i = 0; i < 48; i++) pal[i] = at(p + i) >> 4;
            p += 48;
        } else {
            for (let i = 0; i < 48; i++) pal[i] = DFTPAL[i];
        }

        // --- ビットリーダー (MSB 先頭) ---
        let bitByte = 0, bitCnt = 0;
        const bit = () => {
            if (bitCnt === 0) { bitByte = at(p++); bitCnt = 8; }
            const b = (bitByte >> 7) & 1;
            bitByte = (bitByte << 1) & 0xff; bitCnt--;
            return b;
        };

        // --- カラーテーブル (16 色 × 16 rank の MTF リスト)。値は 色番号*0x10 ---
        const col = new Uint8Array(256);           // col[ctx*16 + rank]
        for (let ctx = 0, k = 0; ctx < 16; ctx++)
            for (let r = 0; r < 16; r++) col[k++] = ((ctx - r) & 0x0f) << 4;

        // 1 ピクセルの色 (= 色番号*0x10) を読む。base = 直前色 (色番号*0x10) の MTF コンテキスト先頭。
        const readColor = (base) => {
            if (bit()) {                           // rank 0/1 (短縮符号)
                if (bit()) {                       // rank 1: front と swap
                    const a = col[base], b = col[base + 1];
                    col[base] = b; col[base + 1] = a;
                    return b;
                }
                return col[base];                  // rank 0: 直前と同色
            }
            // rank >= 2: 可変長で rank を読む
            let cx = 1;
            if (!bit()) {
                cx = (cx << 1) | bit();            // {2,3}
            } else if (!bit()) {
                cx = (cx << 1) | bit();            // {4..7}
                cx = (cx << 1) | bit();
            } else {
                cx = (cx << 1) | bit();            // {8..15}
                cx = (cx << 1) | bit();
                cx = (cx << 1) | bit();
            }
            const idx = base + cx;
            const c = col[idx];
            for (let k = idx; k > base; k--) col[k] = col[k - 1];   // MTF
            col[base] = c;
            return c;
        };
        // 1 word (左 px, 右 px) を読む。右の予測コンテキストは左の色。
        const readWord = (prev) => {
            const left = readColor(prev);
            return [left, readColor(left)];
        };

        // --- 展開 (上に番兵 2 行、実画像は行 2 から) ---
        const W = width;                           // 1 行 = W バイト (1 バイト 1 px)
        const total = W * (height + 2);
        const g = new Uint8Array(total);
        let di = 0;
        // 最初の word を読み 2 行分 (W word) 複製 = 番兵
        const fw = readWord(0);
        for (let i = 0; i < W; i++) { g[di++] = fw[0]; g[di++] = fw[1]; }   // di = 2*W

        let predBp = 0;                            // 前回の予測オフセット
        const copyRun = (src) => {                 // bjmp: 1 word か ランレングス
            if (!bit()) {                          // 1 word コピー
                g[di] = g[src]; g[di + 1] = g[src + 1]; di += 2;
                return;
            }
            let cnt = 0, b;                         // Elias-γ 風の長さ
            do { cnt++; b = bit(); } while (b);
            let n = 1;
            for (let k = 0; k < cnt; k++) n = (n << 1) | bit();
            for (let k = 0; k < n && di < total; k++) {
                g[di] = g[src]; g[di + 1] = g[src + 1]; di += 2; src += 2;
            }
        };
        const newColors = () => {                  // nopres: 新規色を 1 個以上読む
            let prev = g[di - 1];
            do {
                const w = readWord(prev);
                g[di] = w[0]; g[di + 1] = w[1]; di += 2;
                prev = w[1];
            } while (bit());
            predBp = 0;
        };

        while (di < total) {
            let si, pos00 = false;
            if (bit()) {                           // pos2: 上方向の予測
                if (!bit()) si = -2 * W;           // 2 つ上
                else if (!bit()) si = -W + 1;      // 右上
                else si = -W - 1;                  // 左上
            } else if (bit()) {
                si = -W;                           // 真上
            } else {
                si = -4;                           // 2 つ左
                if (g[di - 1] === g[di - 2]) pos00 = true;   // 直前 word が同色
            }
            if (si === predBp) { predBp = si; newColors(); continue; }
            predBp = si;
            copyRun(pos00 ? di - 2 : di + si);     // pos00 は直前 word からコピー
        }

        // --- 色番号 (g の行 2..height+1) → RGBA。R=pal*17 で 0-15→0-255 ---
        const rgba = new Uint8ClampedArray(W * height * 4);
        let o = 0;
        for (let i = 2 * W; i < total; i++) {
            const c = (g[i] >> 4) * 3;
            rgba[o] = pal[c] * 17; rgba[o + 1] = pal[c + 1] * 17; rgba[o + 2] = pal[c + 2] * 17;
            rgba[o + 3] = 255; o += 4;
        }

        return {
            width: W, height, scaleY: 1, rgba, comment, colors: 16,
            consumed: { header: p, end: di },
        };
    }

    global.QBPi = { isPi, decode };
})(typeof window !== 'undefined' ? window : globalThis);
