// SPDX-License-Identifier: MIT
// LZH アーカイブパーサ + LH1/4/5/6/7 / -lh0- デコーダ
// 対応ヘッダ: Level 0 / Level 1 / Level 2 (Level 3 は throw)
// 対応メソッド: "-lh1-" (適応Huffman+4KB), "-lh4/5/6/7-" (静的Huffman 4/8/32/64KB),
//             "-lh0-"/"-lz4-" (stored), "-lhd-" (dir), "-lz5-"/"-lzs-" (LArc LZSS)。
//             未対応メソッドは data=null で返し呼び出し側が skip
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
            if (e.name) out.push({ name: e.name, data: e.data, method: e.method, mtime: e.mtime });
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

        let name, dataStart, mtime = null;
        let compBytes = compSize;   // 実圧縮データ長 (Level1 は ext header 長を後で減算)
        if (level === 0 || level === 1) {
            const nameLen = buf[base + 21];
            let fname = lzhFilename(buf, base + 22, nameLen);
            let dir = '';
            // +15..18 = DOS 形式の更新日時 (low word=time, high word=date)
            const dosT = readU32(buf, base + 15);
            mtime = dosDateTime(dosT & 0xffff, (dosT >>> 16) & 0xffff);
            // basic header 終端 (バイト 0,1 含めず headerSize 個)
            const basicEnd = base + 2 + headerSize;
            let p = basicEnd;
            if (level === 1) {
                // Level 1 ext header chain: basic header の末尾 2 byte が
                // 「最初の ext header のサイズ」、各 ext header の末尾 2 byte が
                // 「次の ext header のサイズ」(チェーン構造)。size=0 で終了。
                // 各 ext header は [type:1][data...][next size:2]。type は L2 と共通で
                // 0x01=ファイル名 / 0x02=ディレクトリ名 (0xFF 区切り)。L1 でもディレクトリ名は
                // 拡張ヘッダに入るので、ここで拾わないと構造がルートへ潰れる (issue kiss218)。
                let nextSize = buf[basicEnd - 2] | (buf[basicEnd - 1] << 8);
                while (nextSize > 0) {
                    if (p + nextSize > buf.length || nextSize < 2) break;
                    if (nextSize >= 3) {          // type(1) + data + next size(2) が入る最小長
                        const type = buf[p];
                        const dlen = nextSize - 3;
                        if (type === 0x01) {                    // ファイル名 (basic header を上書き)
                            fname = lzhFilename(buf, p + 1, dlen);
                        } else if (type === 0x02) {             // ディレクトリ名 (0xFF 区切り)
                            dir = '';
                            for (let i = 0; i < dlen; i++) {
                                const c = buf[p + 1 + i];
                                dir += (c === 0xff) ? '/' : String.fromCharCode(c);
                            }
                        }
                    }
                    const nxt = p + nextSize;
                    nextSize = buf[nxt - 2] | (buf[nxt - 1] << 8);
                    p = nxt;
                }
            }
            name = dir + fname;
            dataStart = p;
            // LHA Level1 の compSize は「圧縮データ + 全 ext header」の合算値 (lha 本家が
            // 読み取り後に packed_size -= ext 長 する仕様)。ext header 分 (p-basicEnd) を
            // 引いて実圧縮データ長にする。Level0 は p==basicEnd なので減算 0。
            compBytes = compSize - (p - basicEnd);
        } else if (level === 2) {
            // Level 2: 先頭 2 byte = 全ヘッダ長 (basic + 全 ext header)。チェックサム無し。
            // ファイル名は ext header (type 0x01)、ディレクトリは type 0x02 (0xFF 区切り)。
            // 圧縮データは base + ヘッダ長 から始まる。
            // ext header chain は L1 と違い [size:2][type:1][data...] を先頭から順に辿り、
            // size==0 で終端 (L1 は「次サイズ」が各ヘッダ末尾、L2 は先頭)。
            const hdrSize = buf[base] | (buf[base + 1] << 8);
            dataStart = base + hdrSize;
            // L2 の +15..18 = Unix time_t (秒)
            const unixT = readU32(buf, base + 15);
            mtime = unixT ? new Date(unixT * 1000) : null;
            let fname = '', dir = '';
            let p = base + 24;  // basic header 末尾 (= 最初の ext header)
            while (p + 2 <= buf.length) {
                const extSize = buf[p] | (buf[p + 1] << 8);
                if (extSize === 0) break;               // 終端
                if (extSize < 3 || p + extSize > buf.length) break;  // 壊れ防御
                const type = buf[p + 2];
                const dlen = extSize - 3;
                if (type === 0x01) {                    // ファイル名
                    fname = lzhFilename(buf, p + 3, dlen);
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
        if (method === '-lh0-' || method === '-lhd-' || method === '-lz4-') {
            data = buf.slice(dataStart, dataStart + compBytes);   // stored (-lz4- = LArc 無圧縮)
        } else if (LH_DICBIT[method] !== undefined) {
            data = lhDecode(buf.subarray(dataStart, dataStart + compBytes),
                            origSize, LH_DICBIT[method]);
        } else if (method === '-lh1-') {
            data = lh1Decode(buf.subarray(dataStart, dataStart + compBytes), origSize);
        } else if (method === '-lz5-') {
            data = larc5Decode(buf.subarray(dataStart, dataStart + compBytes), origSize);
        } else if (method === '-lzs-') {
            data = larcsDecode(buf.subarray(dataStart, dataStart + compBytes), origSize);
        }

        return { name, data, method, mtime, next: dataStart + compBytes };
    }

    function decodeName(buf, off, len) {
        // PC-98 DOS のファイル名は ASCII / Shift_JIS. 多くは ASCII なので
        // とりあえず latin1 で渡す (FS のキーとしては保つ)。
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(buf[off + i]);
        return s;
    }

    // LHA のファイル名フィールド (level 0/1 の basic header・ext type 0x01) は、
    // ディレクトリ区切りに 0xFF を使う (level 0 は ext header を持てないので、サブ
    // ディレクトリを保つ唯一の手段がこれ)。ext type 0x02 の dir 名と同じ区切り。
    // 0xFF は SJIS に現れないバイトなので '/' へ無条件正規化して安全。
    function lzhFilename(buf, off, len) {
        return decodeName(buf, off, len).replace(/\xff/g, '/');
    }

    function readU32(buf, off) {
        return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
    }

    // DOS 形式の date/time word → JS Date (date=0 は「無し」→ null)。
    // date: bit15-9=年-1980 / 8-5=月 / 4-0=日、time: bit15-11=時 / 10-5=分 / 4-0=秒/2
    function dosDateTime(time, date) {
        if (!date) return null;
        const y = 1980 + ((date >> 9) & 0x7f), mo = (date >> 5) & 0x0f, d = date & 0x1f;
        const h = (time >> 11) & 0x1f, mi = (time >> 5) & 0x3f, s = (time & 0x1f) * 2;
        return new Date(y, mo - 1, d, h, mi, s);
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
    // 中央ディレクトリ (End of Central Directory → Central Directory) を正典に読む。
    // これにより data descriptor (bit 3) 付き zip でも各エントリの圧縮/原サイズと
    // 位置が確定する (LFH のサイズ欄が 0 でも CD には正しい値が入る = 真の長さの所在地)。
    // 中央ディレクトリが見つからない (ストリーム生成 zip 等) ときだけ LFH チェーン走査に
    // フォールバックする。
    // 対応: method 0 (stored), method 8 (deflate-raw)
    // 非対応: encrypted (skip), ZIP64 (LFH フォールバックへ)
    //
    // API: async parseZip(bytes: Uint8Array) -> [{name, data: Uint8Array, mtime}, ...]

    const ZIP_LFH_SIG = 0x04034b50;
    const ZIP_CDH_SIG = 0x02014b50;   // central directory file header
    const ZIP_EOCD_SIG = 0x06054b50;  // end of central directory

    // ZIP General Purpose bit 11 (0x0800) が立つとファイル名は UTF-8。だが MEMFS の規約は
    // 「名前 = 生 SJIS バイトの latin1 写像」(docs/dos_hle_gaps.md §2-13) なので、UTF-8 名は
    // 一度 Unicode に直してから SJIS バイト列へ再符号化し、ネイティブ SJIS 名の zip と同じ
    // latin1 表現に揃える。エンコード表はブラウザ/Node 共通の TextDecoder('shift_jis') を
    // 全 SJIS バイト空間に通して逆引き Map を作る (自己完結・追加データ不要・CP932 と同写像)。
    let SJIS_ENCODER = null;
    function sjisEncoder() {
        if (SJIS_ENCODER) return SJIS_ENCODER;
        const dec = new TextDecoder('shift_jis');
        const map = new Map();   // Unicode 1 文字 → [byte, ...]
        for (let b = 0; b <= 0xff; b++) {
            if ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc)) continue;  // 単独不可なリードバイト
            const ch = dec.decode(Uint8Array.from([b]));
            if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [b]);
        }
        for (let lead = 0x81; lead <= 0xfc; lead++) {
            if (lead > 0x9f && lead < 0xe0) continue;
            for (let trail = 0x40; trail <= 0xfc; trail++) {
                if (trail === 0x7f) continue;
                const ch = dec.decode(Uint8Array.from([lead, trail]));
                if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [lead, trail]);
            }
        }
        SJIS_ENCODER = map;
        return map;
    }

    // UTF-8 名 (bit 11) → 生 SJIS バイトの latin1 文字列。SJIS で表せない文字は '?' 1 byte に
    // 落とす (実害なし; PC-98 名はそもそも SJIS 由来)。
    function utf8NameToSjisLatin1(buf, off, len) {
        const uni = new TextDecoder('utf-8').decode(buf.subarray(off, off + len));
        const enc = sjisEncoder();
        let s = '';
        for (const ch of uni) {
            const bytes = enc.get(ch);
            if (bytes) for (const b of bytes) s += String.fromCharCode(b);
            else s += '?';
        }
        return s;
    }

    function zipEntryName(buf, off, len, flags) {
        return (flags & 0x0800) ? utf8NameToSjisLatin1(buf, off, len) : decodeName(buf, off, len);
    }

    async function parseZip(buf) {
        const eocd = findEocd(buf);
        if (eocd >= 0) {
            const entries = await parseZipViaCentralDir(buf, eocd);
            if (entries) return entries;
        }
        return parseZipViaLocalHeaders(buf);
    }

    // 末尾から EOCD シグネチャを後方走査 (ZIP コメント最大 65535 byte + EOCD 22 byte を考慮)。
    function findEocd(buf) {
        const min = Math.max(0, buf.length - 0x10016);
        for (let p = buf.length - 22; p >= min; p--) {
            if (readU32(buf, p) === ZIP_EOCD_SIG) return p;
        }
        return -1;
    }

    // 中央ディレクトリ経由 (正典)。ZIP64 は範囲外なので null を返して LFH フォールバックへ。
    async function parseZipViaCentralDir(buf, eocd) {
        const cdCount  = buf[eocd + 10] | (buf[eocd + 11] << 8);
        const cdOffset = readU32(buf, eocd + 16);
        if (cdOffset === 0xffffffff || cdCount === 0xffff) return null;   // ZIP64
        const out = [];
        let p = cdOffset;
        for (let n = 0; n < cdCount && p + 46 <= buf.length; n++) {
            if (readU32(buf, p) !== ZIP_CDH_SIG) break;
            const flags    = buf[p + 8]  | (buf[p + 9]  << 8);
            const method   = buf[p + 10] | (buf[p + 11] << 8);
            const mtime    = dosDateTime(buf[p + 12] | (buf[p + 13] << 8),
                                         buf[p + 14] | (buf[p + 15] << 8));
            const compSize = readU32(buf, p + 20);
            const origSize = readU32(buf, p + 24);
            const nameLen  = buf[p + 28] | (buf[p + 29] << 8);
            const extraLen = buf[p + 30] | (buf[p + 31] << 8);
            const cmntLen  = buf[p + 32] | (buf[p + 33] << 8);
            const lfhOff   = readU32(buf, p + 42);
            const name = zipEntryName(buf, p + 46, nameLen, flags);
            p += 46 + nameLen + extraLen + cmntLen;
            // データ開始位置は LFH 側の name/extra 長で決まる (CD の extra 長とは別物のことがある)。
            if (lfhOff + 30 > buf.length || readU32(buf, lfhOff) !== ZIP_LFH_SIG) continue;
            const lNameLen  = buf[lfhOff + 26] | (buf[lfhOff + 27] << 8);
            const lExtraLen = buf[lfhOff + 28] | (buf[lfhOff + 29] << 8);
            const dataStart = lfhOff + 30 + lNameLen + lExtraLen;
            const ent = await decodeZipData(buf, name, flags, method, compSize, origSize, dataStart, mtime);
            if (ent) out.push(ent);
        }
        return out;
    }

    // 中央ディレクトリ無し (EOCD 不在) のフォールバック: LFH チェーンを順に走査する。
    // この経路では data descriptor (bit 3) のサイズを復元できないため、その場合は未対応。
    async function parseZipViaLocalHeaders(buf) {
        const out = [];
        let pos = 0;
        while (pos + 30 <= buf.length) {
            if (readU32(buf, pos) !== ZIP_LFH_SIG) break;   // central directory に到達 (or 終端)
            const flags    = buf[pos + 6] | (buf[pos + 7] << 8);
            const method   = buf[pos + 8] | (buf[pos + 9] << 8);
            const mtime    = dosDateTime(buf[pos + 10] | (buf[pos + 11] << 8),
                                         buf[pos + 12] | (buf[pos + 13] << 8));
            const compSize = readU32(buf, pos + 18);
            const origSize = readU32(buf, pos + 22);
            const nameLen  = buf[pos + 26] | (buf[pos + 27] << 8);
            const extraLen = buf[pos + 28] | (buf[pos + 29] << 8);
            const name = zipEntryName(buf, pos + 30, nameLen, flags);
            const dataStart = pos + 30 + nameLen + extraLen;
            if (flags & 0x08) {
                // data descriptor: LFH の compSize が 0/不定。中央ディレクトリがあれば
                // parseZip がそちら経由で解決済 (= ここには来ない)。EOCD 不在の生ストリーム
                // zip でだけ到達し、descriptor 走査が要るため未対応。
                throw new Error('ZIP data descriptor (bit 3, 中央ディレクトリ無し) は未対応: ' + name);
            }
            const ent = await decodeZipData(buf, name, flags, method, compSize, origSize, dataStart, mtime);
            if (ent) out.push(ent);
            pos = dataStart + compSize;
        }
        return out;
    }

    // 1 エントリの圧縮データを展開して {name, data, mtime} を返す。未対応/暗号化/ディレクトリ/
    // 破損は null を返し、呼び出し側が skip する (書庫全体を巻き添えにしない)。
    async function decodeZipData(buf, name, flags, method, compSize, origSize, dataStart, mtime) {
        if (name.endsWith('/')) return null;                  // ディレクトリエントリ (書き出し側が親を作る)
        if (flags & 0x01) return null;                        // 暗号化: skip
        if (dataStart < 0 || dataStart + compSize > buf.length) return null;   // 範囲外: skip
        const comp = buf.subarray(dataStart, dataStart + compSize);
        let data;
        if (method === 0) {
            data = new Uint8Array(comp);                      // stored: そのままコピー
        } else if (method === 8) {
            try { data = await inflateRaw(comp, origSize); }
            catch (_) { return null; }                        // 破損/サイズ不一致: skip
        } else {
            return null;                                      // 未対応 method: skip
        }
        return { name, data, mtime };
    }

    async function inflateRaw(comp, expectedSize) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([comp]).stream().pipeThrough(ds);
        const buf = await new Response(stream).arrayBuffer();
        const out = new Uint8Array(buf);
        // 展開後サイズが ZIP ヘッダの値と食い違う = 破損/切り詰め。黙って通さず弾く
        // (呼び出し側が try/catch で該当エントリだけ skip する)。
        if (expectedSize != null && out.length !== expectedSize) {
            throw new Error('ZIP inflate サイズ不一致: ' + out.length + ' != ' + expectedSize);
        }
        return out;
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

    // ---- LArc デコーダ (-lz5- / -lzs-) ----
    // LArc (三木和彦, 1988-90) の LZSS。90 年代初頭以前の最初期 PC-98 フリーソフトで使われた
    // 旧形式。-lz4- は無圧縮 (stored) なので上の method 分岐で -lh0- と同じ扱い。
    //
    // 参考: Simon Howard の Lhasa (lib/lz5_decoder.c / lzs_decoder.c, ISC ライセンス) の
    //       アルゴリズムを理解して自前で書き起こしたもの。実 LArc 3.33 書庫を lhasa を
    //       独立オラクルにして byte 一致検証済 (tools/larc_test.js)。
    //
    // 両者とも「絶対位置リングバッファ」型 LZSS。lh1/lh5 の「現在位置からの相対オフセット」型と
    // 違い、コピー元はリング内の絶対インデックスで指定される。リングは特定パターンで初期化され、
    // 書き込み位置は RING - START_OFFSET から始まる (未書き込み領域を過去マッチとして参照しうる)。

    // -lz5- (LArc 5): 4KB リング・START_OFFSET=18・THRESHOLD=3。
    //   8 コマンドを 1 ビットマップ (LSB first) で束ねる。bit=1→リテラル1byte / bit=0→コピー2byte。
    //   コピー: seqstart = ((c1 & 0xF0) << 4) | c0 (12bit 絶対位置)、seqlen = (c1 & 0x0F) + 3。
    function larc5Decode(src, outSize) {
        const RING = 4096, START_OFFSET = 18, THRESHOLD = 3;
        const ring = new Uint8Array(RING);
        // fill_initial: 各バイト値の 13 連 → 昇順 256 → 降順 256 → 0×128 → ' '×110 → 0×18
        let f = 0;
        for (let i = 0; i < 256; i++) for (let j = 0; j < 13; j++) ring[f++] = i;
        for (let i = 0; i < 256; i++) ring[f++] = i;
        for (let i = 0; i < 256; i++) ring[f++] = 255 - i;
        for (let i = 0; i < 128; i++) ring[f++] = 0;
        for (let i = 0; i < 110; i++) ring[f++] = 0x20;
        for (let i = 0; i < 18;  i++) ring[f++] = 0;

        const out = new Uint8Array(outSize);
        let o = 0, s = 0, rpos = RING - START_OFFSET;
        function put(b) { out[o++] = b; ring[rpos] = b; rpos = (rpos + 1) % RING; }

        while (o < outSize && s < src.length) {
            const bitmap = src[s++];
            for (let bit = 0; bit < 8 && o < outSize; bit++) {
                if (bitmap & (1 << bit)) {                 // リテラル
                    if (s >= src.length) break;
                    put(src[s++]);
                } else {                                   // コピー
                    if (s + 2 > src.length) break;
                    const c0 = src[s++], c1 = src[s++];
                    const start = ((c1 & 0xf0) << 4) | c0;
                    const len = (c1 & 0x0f) + THRESHOLD;
                    for (let i = 0; i < len && o < outSize; i++) put(ring[(start + i) % RING]);
                }
            }
        }
        return out;
    }

    // -lzs- (LArc S, 旧版): 2KB リング・START_OFFSET=17・THRESHOLD=2・init は全 ' '(0x20)。
    //   コマンド先頭 1 ビット (MSB first) が種別。bit=1→リテラル8bit / bit=0→コピー(11bit 絶対
    //   位置 + 4bit 長)、seqlen = len + 2。
    function larcsDecode(src, outSize) {
        const RING = 2048, START_OFFSET = 17, THRESHOLD = 2;
        const ring = new Uint8Array(RING).fill(0x20);
        const out = new Uint8Array(outSize);
        let o = 0, rpos = RING - START_OFFSET;
        // MSB-first ビットリーダ (Lhasa bit_stream_reader と同順)。acc は消費後に残ビットだけ保持。
        let acc = 0, nbits = 0, s = 0;
        function getbits(n) {
            while (nbits < n) {
                acc = ((acc << 8) | (s < src.length ? src[s++] : 0)) >>> 0;
                nbits += 8;
            }
            nbits -= n;
            const v = (acc >>> nbits) & ((1 << n) - 1);
            acc &= (nbits > 0) ? ((1 << nbits) - 1) : 0;
            return v;
        }
        function put(b) { out[o++] = b; ring[rpos] = b; rpos = (rpos + 1) % RING; }

        while (o < outSize) {
            if (s >= src.length && nbits === 0) break;     // 入力枯渇
            if (getbits(1)) {                              // リテラル
                put(getbits(8));
            } else {                                       // コピー
                const pos = getbits(11);
                const len = getbits(4) + THRESHOLD;
                for (let i = 0; i < len && o < outSize; i++) put(ring[(pos + i) % RING]);
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
