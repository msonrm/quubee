// SPDX-License-Identifier: MIT OR GPL-2.0-or-later
// LZH アーカイブパーサ + LH1/4/5/6/7 / -lh0- デコーダ
// 対応ヘッダ: Level 0 / Level 1 / Level 2 (Level 3 は throw)
// 対応メソッド: "-lh1-" (適応Huffman+4KB), "-lh4/5/6/7-" (静的Huffman 4/8/32/64KB),
//             "-lh0-" (stored), "-lhd-" (dir)。未対応メソッドは data=null で返し呼び出し側が skip
//
// API:
//   qbArchive.parseLzh(bytes: Uint8Array) -> [{ name: string, data: Uint8Array }, ...]
//
// 参考: Okumura/Yoshizaki LHa リファレンス実装 (huf.c, slide.c)

(function (root) {
    'use strict';

    // ---- 公開 API ----
    function parseLzh(buf) {
        const out = [];
        let pos = 0;
        while (pos < buf.length && buf[pos] !== 0) {
            const e = parseEntry(buf, pos);
            if (!e) break;
            // 未対応メソッドは e.data===null で返る (呼び出し側が skip)。ヘッダは読めているので
            // e.next で必ず次エントリへ進める → 混在書庫でも対応エントリは取りこぼさない。
            if (e.name) out.push({ name: e.name, data: e.data, method: e.method });
            pos = e.next;
        }
        return out;
    }

    function parseEntry(buf, base) {
        const headerSize = buf[base];
        if (headerSize === 0) return null;
        const method = String.fromCharCode(
            buf[base + 2], buf[base + 3], buf[base + 4], buf[base + 5], buf[base + 6]);
        const compSize = readU32(buf, base + 7);
        const origSize = readU32(buf, base + 11);
        const level    = buf[base + 20];

        let name, dataStart;
        if (level === 0 || level === 1) {
            const nameLen = buf[base + 21];
            name = decodeName(buf, base + 22, nameLen);
            // basic header 終端 (バイト 0,1 含めず headerSize 個)
            const basicEnd = base + 2 + headerSize;
            let p = basicEnd;
            if (level === 1) {
                // Level 1 ext header chain: basic header の末尾 2 byte が
                // 「最初の ext header のサイズ」、各 ext header の末尾 2 byte が
                // 「次の ext header のサイズ」(チェーン構造)。size=0 で終了。
                let nextSize = buf[basicEnd - 2] | (buf[basicEnd - 1] << 8);
                while (nextSize > 0) {
                    if (p + nextSize > buf.length || nextSize < 2) break;
                    const nxt = p + nextSize;
                    nextSize = buf[nxt - 2] | (buf[nxt - 1] << 8);
                    p = nxt;
                }
            }
            dataStart = p;
        } else if (level === 2) {
            // Level 2: 先頭 2 byte = 全ヘッダ長 (basic + 全 ext header)。チェックサム無し。
            // ファイル名は ext header (type 0x01)、ディレクトリは type 0x02 (0xFF 区切り)。
            // 圧縮データは base + ヘッダ長 から始まる。
            // ext header chain は L1 と違い [size:2][type:1][data...] を先頭から順に辿り、
            // size==0 で終端 (L1 は「次サイズ」が各ヘッダ末尾、L2 は先頭)。
            const hdrSize = buf[base] | (buf[base + 1] << 8);
            dataStart = base + hdrSize;
            let fname = '', dir = '';
            let p = base + 24;  // basic header 末尾 (= 最初の ext header)
            while (p + 2 <= buf.length) {
                const extSize = buf[p] | (buf[p + 1] << 8);
                if (extSize === 0) break;               // 終端
                if (extSize < 3 || p + extSize > buf.length) break;  // 壊れ防御
                const type = buf[p + 2];
                const dlen = extSize - 3;
                if (type === 0x01) {                    // ファイル名
                    fname = decodeName(buf, p + 3, dlen);
                } else if (type === 0x02) {             // ディレクトリ名 (0xFF 区切り)
                    dir = '';
                    for (let i = 0; i < dlen; i++) {
                        const c = buf[p + 3 + i];
                        dir += (c === 0xff) ? '/' : String.fromCharCode(c);
                    }
                }
                p += extSize;
            }
            name = dir + fname;
        } else {
            throw new Error('LZH ヘッダレベル不明: ' + level);
        }

        let data = null;   // 未対応メソッドは null (throw せず、呼び出し側で skip)
        if (method === '-lh0-' || method === '-lhd-') {
            data = buf.slice(dataStart, dataStart + compSize);
        } else if (LH_DICBIT[method] !== undefined) {
            data = lhDecode(buf.subarray(dataStart, dataStart + compSize),
                            origSize, LH_DICBIT[method]);
        } else if (method === '-lh1-') {
            data = lh1Decode(buf.subarray(dataStart, dataStart + compSize), origSize);
        }

        return { name, data, method, next: dataStart + compSize };
    }

    function decodeName(buf, off, len) {
        // PC-98 DOS のファイル名は ASCII / Shift_JIS. 多くは ASCII なので
        // とりあえず latin1 で渡す (FS のキーとしては保つ)。
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(buf[off + i]);
        return s;
    }

    function readU32(buf, off) {
        return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
    }

    // ---- LH4/5/6/7 デコーダ (静的 Huffman + スライド窓) ----
    // lh4/5/6/7 はアルゴリズム完全同一で、違うのは窓径 (DICBIT) と、それに連動する
    // NP (= DICBIT+1) / PBIT だけ。NC/CBIT/NT/TBIT/THRESHOLD は全メソッド共通。
    //   -lh4- = 4KB(12) / -lh5- = 8KB(13) / -lh6- = 32KB(15) / -lh7- = 64KB(16)
    const LH_DICBIT = { '-lh4-': 12, '-lh5-': 13, '-lh6-': 15, '-lh7-': 16 };
    const THRESHOLD = 3;
    // NC = UCHAR_MAX + MAXMATCH + 2 - THRESHOLD = 255 + 256 + 2 - 3 = 510
    const NC = 510;
    const CBIT = 9;                 // (1<<CBIT) > NC を満たす最小
    const NT   = 19;
    const TBIT = 5;                 // (1<<TBIT) > NT を満たす最小

    function lhDecode(src, outSize, dicbit) {
        const WSIZE = 1 << dicbit;
        const WMASK = WSIZE - 1;
        const NP    = dicbit + 1;    // offset top tree のシンボル数
        let   PBIT  = 4;             // (1<<PBIT) > NP を満たす最小 (lh4/5=4, lh6/7=5)
        while ((1 << PBIT) <= NP) PBIT++;
        const out = new Uint8Array(outSize);
        const win = new Uint8Array(WSIZE);
        let outPos = 0, winPos = 0;

        // bit reader (MSB-first within byte)
        let bitBuf = 0, bitCnt = 0, srcPos = 0;
        function fillBits(n) {
            while (bitCnt < n) {
                const b = srcPos < src.length ? src[srcPos++] : 0;
                bitBuf = ((bitBuf << 8) | b) >>> 0;
                bitCnt += 8;
            }
        }
        function peekBits(n) {
            if (n === 0) return 0;
            fillBits(n);
            return (bitBuf >>> (bitCnt - n)) & ((1 << n) - 1);
        }
        function getBits(n) {
            const v = peekBits(n);
            bitCnt -= n;
            return v;
        }

        // 与えられた長さ配列から正準 Huffman 木を構築 (再帰オブジェクト形式)
        function buildTree(lens) {
            const n = lens.length;
            const blCount = new Uint16Array(17);
            for (let i = 0; i < n; i++) {
                const L = lens[i];
                if (L > 0 && L < 17) blCount[L]++;
            }
            const nextCode = new Uint32Array(17);
            let code = 0;
            for (let b = 1; b < 17; b++) {
                code = (code + blCount[b - 1]) << 1;
                nextCode[b] = code;
            }
            const root = { l: null, r: null };
            for (let sym = 0; sym < n; sym++) {
                const L = lens[sym];
                if (L === 0) continue;
                const c = nextCode[L]++;
                let node = root;
                for (let b = L - 1; b >= 0; b--) {
                    const bit = (c >>> b) & 1;
                    const key = bit ? 'r' : 'l';
                    if (b === 0) {
                        node[key] = { sym };
                    } else {
                        if (!node[key]) node[key] = { l: null, r: null };
                        node = node[key];
                    }
                }
            }
            return root;
        }

        function decodeSym(tree) {
            let n = tree;
            while (n.sym === undefined) {
                fillBits(1);
                const bit = (bitBuf >>> (bitCnt - 1)) & 1;
                bitCnt--;
                n = bit ? n.r : n.l;
                if (!n) throw new Error('LH5 decode: 木を踏み外した');
            }
            return n.sym;
        }

        // PT-len / NP tree: 各コード長を読む
        //   3-bit で 0..6
        //   3-bit "111" の後、続く 1 の数 N、終端 0 → 長さ = 7 + N
        //   i === special のとき、次の 2 bit が "skip count" でその数だけ 0 を埋める
        function readPtLen(nbit, nsize, special) {
            const n = getBits(nbit);
            if (n === 0) {
                const c = getBits(nbit);
                return { fixed: c };
            }
            const lens = new Uint8Array(nsize);
            let i = 0;
            while (i < n) {
                let c = peekBits(3);
                if (c !== 7) {
                    getBits(3);
                } else {
                    getBits(3);
                    let m = 7;
                    while (peekBits(1) === 1) {
                        getBits(1);
                        m++;
                    }
                    getBits(1);  // 終端 0
                    c = m;
                }
                lens[i++] = c;
                if (special >= 0 && i === special) {
                    const z = getBits(2);
                    for (let k = 0; k < z && i < nsize; k++) lens[i++] = 0;
                }
            }
            while (i < nsize) lens[i++] = 0;
            return { tree: buildTree(lens) };
        }

        // C-len: PT-tree を使って NC コードぶんの長さを読む
        //   PT-tree の出力 c:
        //     0           → 0 を 1 個
        //     1           → 0 を 3 + read_bits(4) 個
        //     2           → 0 を 20 + read_bits(CBIT) 個
        //     3..(NT+15)  → 長さ = c - 2
        function readCLen(ptDef) {
            const n = getBits(CBIT);
            if (n === 0) {
                const c = getBits(CBIT);
                return { fixed: c };
            }
            const lens = new Uint8Array(NC);
            let i = 0;
            while (i < n) {
                let c = (ptDef.fixed !== undefined) ? ptDef.fixed : decodeSym(ptDef.tree);
                if (c === 0) {
                    lens[i++] = 0;
                } else if (c === 1) {
                    const skip = 3 + getBits(4);
                    for (let k = 0; k < skip && i < NC; k++) lens[i++] = 0;
                } else if (c === 2) {
                    const skip = 20 + getBits(CBIT);
                    for (let k = 0; k < skip && i < NC; k++) lens[i++] = 0;
                } else {
                    lens[i++] = c - 2;
                }
            }
            while (i < NC) lens[i++] = 0;
            return { tree: buildTree(lens) };
        }

        let blockRemain = 0;
        let cTree = null, ptTree = null;

        while (outPos < outSize) {
            if (blockRemain === 0) {
                blockRemain = getBits(16);
                if (blockRemain === 0) break;
                const ptDef = readPtLen(TBIT, NT, 3);
                cTree  = readCLen(ptDef);
                ptTree = readPtLen(PBIT, NP, -1);
            }
            blockRemain--;
            const c = (cTree.fixed !== undefined) ? cTree.fixed : decodeSym(cTree.tree);
            if (c < 256) {
                out[outPos++] = c;
                win[winPos] = c;
                winPos = (winPos + 1) & WMASK;
            } else {
                const matchLen = c - 256 + THRESHOLD;
                const p = (ptTree.fixed !== undefined) ? ptTree.fixed : decodeSym(ptTree.tree);
                const offset = (p === 0) ? 0 : ((1 << (p - 1)) + getBits(p - 1));
                const matchStart = (winPos - offset - 1) & WMASK;
                for (let k = 0; k < matchLen; k++) {
                    const b = win[(matchStart + k) & WMASK];
                    out[outPos++] = b;
                    win[winPos] = b;
                    winPos = (winPos + 1) & WMASK;
                }
            }
        }

        return out;
    }

    // ---- ZIP パーサ + deflate 解凍 (DecompressionStream) ----
    //
    // ZIP 構造を Local File Header チェーンで読む簡略版。
    // 各エントリの先頭 4 byte = 0x04034b50 ("PK\x03\x04") を目印に走査。
    // 対応: method 0 (stored), method 8 (deflate-raw)
    // 非対応: encrypted, ZIP64 (圧縮/原サイズが 4GB 超), data descriptor (bit 3)
    //
    // API: async parseZip(bytes: Uint8Array) -> [{name, data: Uint8Array}, ...]

    const ZIP_LFH_SIG = 0x04034b50;

    async function parseZip(buf) {
        const out = [];
        let pos = 0;
        while (pos + 30 <= buf.length) {
            const sig = readU32(buf, pos);
            if (sig !== ZIP_LFH_SIG) break;  // central directory に到達 (or 終端)
            const flags    = buf[pos + 6] | (buf[pos + 7] << 8);
            const method   = buf[pos + 8] | (buf[pos + 9] << 8);
            const compSize = readU32(buf, pos + 18);
            const origSize = readU32(buf, pos + 22);
            const nameLen  = buf[pos + 26] | (buf[pos + 27] << 8);
            const extraLen = buf[pos + 28] | (buf[pos + 29] << 8);
            const name = decodeName(buf, pos + 30, nameLen);
            const dataStart = pos + 30 + nameLen + extraLen;

            if (flags & 0x08) {
                throw new Error('ZIP data descriptor (bit 3) は未対応: ' + name);
            }
            if (flags & 0x01) {
                throw new Error('ZIP encrypted entry は未対応: ' + name);
            }

            const comp = buf.subarray(dataStart, dataStart + compSize);
            let data;
            if (method === 0) {
                data = new Uint8Array(comp);  // stored: そのままコピー
            } else if (method === 8) {
                data = await inflateRaw(comp, origSize);
            } else {
                throw new Error('ZIP method 未対応: ' + method + ' (' + name + ')');
            }
            out.push({ name, data });
            pos = dataStart + compSize;
        }
        return out;
    }

    async function inflateRaw(comp, expectedSize) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([comp]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
    }

    // 後方互換: 旧 lh5Decode(src, outSize) は dicbit=13 固定の lhDecode と等価
    function lh5Decode(src, outSize) { return lhDecode(src, outSize, 13); }

    // ---- LH1 デコーダ (LHarc 1.x: 適応 Huffman + 4KB スライド窓) ----
    // lh4-7 (静的 Huffman) とは別アルゴリズム。文字/長さは「適応(動的) Huffman 木」、
    // 位置(オフセット)は「静的 fixed テーブル」で復号する。
    //
    // 参考: Okumura/Yoshizaki LHa for UNIX (dhuf.c の block ベース適応 Huffman,
    //       shuf.c の decode_p_st0 / ready_made による静的位置テーブル, slide.c の展開ループ)。
    //       アルゴリズムを理解して自前で書き起こしたもの (逐語コピーではない)。
    //
    // lh1 用定数 (リファレンスで確定):
    //   DICBIT=12 (4KB 窓), THRESHOLD=3, maxmatch=60
    //   n_max = 256 + maxmatch - THRESHOLD + 1 = 314  (= N_CHAR; 文字木のシンボル数)
    //   np = 1 << (DICBIT - 6) = 64                    (位置シンボル数)
    //   位置 = (j << 6) + getbits(6),  match.off = 位置 + 1
    //   窓 (dtext) は空白 0x20 で初期化, loc=0 から開始。
    const LH1_DICBIT    = 12;
    const LH1_N_CHAR    = 256 + 60 - 3 + 1;   // 314
    const LH1_THRESHOLD = 3;

    function lh1Decode(src, outSize) {
        const out = new Uint8Array(outSize);
        if (outSize === 0) return out;

        const DICSIZ  = 1 << LH1_DICBIT;       // 4096
        const DICSIZ1 = DICSIZ - 1;
        const NP      = 1 << (LH1_DICBIT - 6); // 64
        const N_CHAR  = LH1_N_CHAR;            // 314

        // ---- ビットリーダ (MSB-first, LHa の 16bit bitbuf モデル相当) ----
        // peekBit(k): これから読む k 番目のビット (0=直近) を返す。consume(n): n ビット消費。
        let srcPos = 0, bitBuf = 0, bitCnt = 0;
        function need(n) {
            while (bitCnt < n) {
                const b = srcPos < src.length ? src[srcPos++] : 0;
                bitBuf = ((bitBuf << 8) | b) >>> 0;
                bitCnt += 8;
            }
        }
        function getBits(n) {
            if (n === 0) return 0;
            need(n);
            const v = (bitBuf >>> (bitCnt - n)) & ((1 << n) - 1);
            bitCnt -= n;
            return v;
        }
        // ----------------------------------------------------------------
        // 位置(オフセット): 静的 fixed テーブル (ready_made(0) 相当) から canonical
        //   Huffman 木を組む。fixed[0] = {3, 1,4,12,24,48,0}。
        //   各シンボル i (0..np-1) の符号長 pt_len[i] を生成し、シンボル昇順に
        //   コードを割り当て (= canonical) → buildTree で木化。
        const fixed0 = [1, 4, 12, 24, 48];   // 先頭の 3 (初期長) は別途
        const ptLen = new Uint8Array(NP);
        {
            let j = 3, ti = 0;
            for (let i = 0; i < NP; i++) {
                while (ti < fixed0.length && fixed0[ti] === i) { j++; ti++; }
                ptLen[i] = j;
            }
        }
        const ptTree = buildLh1Tree(ptLen);

        // canonical Huffman 木構築 (lhDecode の buildTree と同等; lh1 ローカル版)
        function buildLh1Tree(lens) {
            const n = lens.length;
            const blCount = new Uint16Array(20);
            for (let i = 0; i < n; i++) if (lens[i] > 0 && lens[i] < 20) blCount[lens[i]]++;
            const nextCode = new Uint32Array(20);
            let code = 0;
            for (let b = 1; b < 20; b++) { code = (code + blCount[b - 1]) << 1; nextCode[b] = code; }
            const root = { l: null, r: null };
            for (let sym = 0; sym < n; sym++) {
                const L = lens[sym];
                if (L === 0) continue;
                const c = nextCode[L]++;
                let node = root;
                for (let b = L - 1; b >= 0; b--) {
                    const bit = (c >>> b) & 1;
                    const key = bit ? 'r' : 'l';
                    if (b === 0) node[key] = { sym };
                    else { if (!node[key]) node[key] = { l: null, r: null }; node = node[key]; }
                }
            }
            return root;
        }
        function decodeStatic(tree) {
            let nd = tree;
            while (nd.sym === undefined) {
                const bit = getBits(1);
                nd = bit ? nd.r : nd.l;
                if (!nd) throw new Error('lh1: 位置木を踏み外した');
            }
            return nd.sym;
        }
        function decodePosition() {
            const j = decodeStatic(ptTree);   // 0..np-1
            return ((j << 6) + getBits(6)) >>> 0;
        }

        // ----------------------------------------------------------------
        // 文字/長さ: block ベースの適応 Huffman 木 (dhuf.c の start_c_dyn /
        //   swap_inc / update_c / reconst / decode_c_dyn を移植)。
        //   child[] : >0 = 内部ノード(子の index), <=0 = 葉(~symbol)。
        //   freq[], parent[], block[], edge[], stock[], s_node[] を保持。
        const TREESIZE_C = N_CHAR * 2;             // 628
        const child  = new Int32Array(TREESIZE_C);
        const parent = new Int32Array(TREESIZE_C);
        const block  = new Int32Array(TREESIZE_C);
        const edge   = new Int32Array(TREESIZE_C);
        const stock  = new Int32Array(TREESIZE_C);
        const freq   = new Int32Array(TREESIZE_C); // 0x8000 まで使うので 32bit
        const s_node = new Int32Array(TREESIZE_C / 2 + 1);
        let avail = 0;
        const ROOT_C = 0;
        const n_max  = N_CHAR;
        // n1 = (n_max >= 256 + maxmatch - THRESHOLD + 1) ? 512 : n_max-1 → lh1 は 512 (到達不能)
        const n1 = (n_max >= 256 + 60 - 3 + 1) ? 512 : (n_max - 1);

        function start_c_dyn() {
            let i, j, f;
            for (i = 0; i < TREESIZE_C; i++) { stock[i] = i; block[i] = 0; }
            for (i = 0, j = n_max * 2 - 2; i < n_max; i++, j--) {
                freq[j] = 1; child[j] = ~i; s_node[i] = j; block[j] = 1;
            }
            avail = 2;
            edge[1] = n_max - 1;
            i = n_max * 2 - 2;
            while (j >= 0) {
                f = freq[j] = freq[i] + freq[i - 1];
                child[j] = i;
                parent[i] = parent[i - 1] = j;
                if (f === freq[j + 1]) {
                    edge[block[j] = block[j + 1]] = j;
                } else {
                    edge[block[j] = stock[avail++]] = j;
                }
                i -= 2; j--;
            }
        }

        function reconst(start, end) {
            let i, j, k, l, b, f, g;
            for (i = j = start; i < end; i++) {
                if ((k = child[i]) < 0) {
                    freq[j] = ((freq[i] + 1) / 2) | 0;
                    child[j] = k;
                    j++;
                }
                if (edge[b = block[i]] === i) stock[--avail] = b;
            }
            j--;
            i = end - 1;
            l = end - 2;
            while (i >= start) {
                while (i >= l) { freq[i] = freq[j]; child[i] = child[j]; i--; j--; }
                f = freq[l] + freq[l + 1];
                for (k = start; f < freq[k]; k++) { /* find slot */ }
                while (j >= k) { freq[i] = freq[j]; child[i] = child[j]; i--; j--; }
                freq[i] = f; child[i] = l + 1; i--;
                l -= 2;
            }
            f = 0;
            for (i = start; i < end; i++) {
                if ((j = child[i]) < 0) s_node[~j] = i;
                else parent[j] = parent[j - 1] = i;
                if ((g = freq[i]) === f) {
                    block[i] = b;
                } else {
                    edge[b = block[i] = stock[avail++]] = i;
                    f = g;
                }
            }
        }

        function swap_inc(p) {
            let b, q, r, s;
            b = block[p];
            if ((q = edge[b]) !== p) {        // swap for leader
                r = child[p]; s = child[q];
                child[p] = s; child[q] = r;
                if (r >= 0) parent[r] = parent[r - 1] = q; else s_node[~r] = q;
                if (s >= 0) parent[s] = parent[s - 1] = p; else s_node[~s] = p;
                p = q;
                // --- Adjust ---
                edge[b]++;
                if (++freq[p] === freq[p - 1]) block[p] = block[p - 1];
                else edge[block[p] = stock[avail++]] = p;
            } else if (b === block[p + 1]) {
                // --- Adjust ---
                edge[b]++;
                if (++freq[p] === freq[p - 1]) block[p] = block[p - 1];
                else edge[block[p] = stock[avail++]] = p;
            } else if (++freq[p] === freq[p - 1]) {
                stock[--avail] = b;           // delete block
                block[p] = block[p - 1];
            }
            return parent[p];
        }

        function update_c(p) {
            let q;
            if (freq[ROOT_C] === 0x8000) reconst(0, n_max * 2 - 1);
            freq[ROOT_C]++;
            q = s_node[p];
            do { q = swap_inc(q); } while (q !== ROOT_C);
        }

        function decodeChar() {
            // dhuf.c decode_c_dyn: child[] を ROOT_C から葉まで辿る。
            let c = child[ROOT_C];
            do {
                const bit = getBits(1);
                c = child[c - bit];   // bit=1 のとき左の隣 (LHa: c - (buf<0))
            } while (c > 0);
            c = ~c;
            update_c(c);
            if (c === n1) c += getBits(8);   // lh1 では n1=512 で到達しない (保険)
            return c;
        }

        start_c_dyn();

        // ---- 展開ループ (slide.c decode 相当) ----
        const dtext = new Uint8Array(DICSIZ);
        dtext.fill(0x20);                     // 窓は空白で初期化
        let loc = 0, outPos = 0;
        const adjust = 256 - LH1_THRESHOLD;   // 253

        while (outPos < outSize) {
            const c = decodeChar();
            if (c < 256) {
                dtext[loc] = c;
                loc = (loc + 1) & DICSIZ1;
                out[outPos++] = c;
            } else {
                const len = c - adjust;                  // = c - 256 + THRESHOLD
                const off = decodePosition() + 1;
                let matchpos = (loc - off) & DICSIZ1;
                for (let i = 0; i < len && outPos < outSize; i++) {
                    const b = dtext[(matchpos + i) & DICSIZ1];
                    dtext[loc] = b;
                    loc = (loc + 1) & DICSIZ1;
                    out[outPos++] = b;
                }
            }
        }

        return out;
    }

    const api = { parseLzh, lhDecode, lh5Decode, parseZip };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.qbArchive = api;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
