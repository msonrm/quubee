// SPDX-License-Identifier: MIT OR GPL-2.0-or-later
// PC-98 フロッピーディスクイメージ → 中身 (FAT12/16 ファイル) 取り出し。
//
// 方針: イメージは「ブートさせず・ファイルとして取り出す」だけ (concept の赤線維持)。
//   de-container (形式別に生セクタ列 = flat LBA 順へ戻す)
//     → imageToVolumes (flat → ボリューム列。FD は [全体]、HDD はパーティション分割 ※将来)
//       → readFat (FAT12/16・サブディレクトリ再帰・相対パスで返す)
//
// 対応形式 (フロッピー): D88/D77/D98 (.d88/.d77/.d98/.88d/.98d) / FDI (.fdi) /
//   DCP/DCU (.dcp/.dcu) / raw beta (.xdf/.hdm/.2hd/.dup/.flp/生)。
// 恒久対応外: NFD (.nfd, セクタID保持=プロテクト保全用)・BKDSK (BASIC ディスク)・
//   VFDD (.fdd)。いずれも QuuBee のスコープ外なので明示メッセージで弾く。
//
// バイト配置は NP2kai (core/np2kai/diskimage/fd/*) を参照 (GPLv2、コピペなし・配置確認のみ)。
//
// API:
//   qbDiskImage.extractDiskImage(bytes: Uint8Array, filename: string)
//     -> { ok:true, files:[{name, data, mtime}], info }   (name = 相対パス)
//     -> { ok:false, reason: string }

(function (root) {
    'use strict';

    function u16(b, o) { return b[o] | (b[o + 1] << 8); }
    function u32(b, o) {
        return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    }

    // DOS date/time word → JS Date (FAT のディレクトリ日時は LZH/ZIP と同形式)。
    function dosDateTime(time, date) {
        if (!date) return null;
        const y = 1980 + ((date >> 9) & 0x7f), mo = (date >> 5) & 0x0f, d = date & 0x1f;
        const h = (time >> 11) & 0x1f, mi = (time >> 5) & 0x3f, s = (time & 0x1f) * 2;
        return new Date(y, mo - 1, d, h, mi, s);
    }

    // ============================================================
    // de-container: イメージファイル → flat (LBA 順の生セクタ列)
    // ============================================================

    // D88/D77/D98: 0x2B0 ヘッダ + trackp[164] (LE32 オフセット表)。
    // 各トラック = [16B セクタヘッダ + データ]×n。セクタを (C,H,R) 順に並べて連結 = LBA 順。
    function deD88(b) {
        if (b.length < 0x2b0) throw new Error('D88: too small');
        const D88_TRACKMAX = 164;
        const sectors = [];     // {c,h,r,data}
        for (let t = 0; t < D88_TRACKMAX; t++) {
            let off = u32(b, 0x20 + t * 4);
            if (!off || off >= b.length) continue;
            const nsec = u16(b, off + 4);                 // このトラックのセクタ数
            if (!nsec || nsec > 64) continue;             // 壊れ防御
            for (let s = 0; s < nsec; s++) {
                if (off + 16 > b.length) break;
                const c = b[off], h = b[off + 1], r = b[off + 2];
                const dataLen = u16(b, off + 14);         // このセクタの実データ長
                if (off + 16 + dataLen > b.length) break;
                sectors.push({ c, h, r, data: b.subarray(off + 16, off + 16 + dataLen) });
                off += 16 + dataLen;
            }
        }
        if (!sectors.length) throw new Error('D88: no sectors');
        sectors.sort((a, b2) => a.c - b2.c || a.h - b2.h || a.r - b2.r);
        return concatSectors(sectors);
    }

    // FDI: LE32 ヘッダ (dummy/fddtype/headersize@8/fddsize/sectorsize/sectors/surfaces/cylinders)。
    //   data = headersize 以降の生セクタ (既に LBA 順)。
    function deFDI(b) {
        if (b.length < 32) throw new Error('FDI: too small');
        const headersize = u32(b, 0x08);
        const sectorsize = u32(b, 0x10);
        const sectors = u32(b, 0x14);
        const surfaces = u32(b, 0x18);
        const cylinders = u32(b, 0x1c);
        if ((sectorsize & (sectorsize - 1)) !== 0 || !(sectorsize & 0x7f80) ||
            sectors === 0 || sectors >= 256 || surfaces !== 2 ||
            cylinders === 0 || cylinders >= 128) {
            throw new Error('FDI: bad header');
        }
        if (b.length < headersize + sectorsize * sectors * surfaces * cylinders) {
            throw new Error('FDI: size mismatch');
        }
        return b.subarray(headersize);
    }

    // DCP/DCU: 0xA2 ヘッダ (mediatype@0 + trackmap[160] + alltrackflg@0xA1)。
    //   存在トラック (trackmap[i]==1 or alltrackflg==1) のみ tracksize ずつ格納。
    //   media 種別でジオメトリ確定。欠落トラックはゼロ埋めして LBA 順 flat を組む。
    const DCP_TABLE = {  // mediatype -> {tracks, sectors, n}  (size = 128<<n)
        0x01: { tracks: 154, sectors: 8, n: 3 },   // 2HD  8sec 1.25MB
        0x02: { tracks: 160, sectors: 15, n: 2 },  // 2HD 15sec 1.21MB
        0x03: { tracks: 160, sectors: 18, n: 2 },  // 2HQ 18sec 1.44MB
        0x04: { tracks: 160, sectors: 8, n: 2 },   // 2DD  8sec 640KB
        0x05: { tracks: 160, sectors: 9, n: 2 },   // 2DD  9sec 720KB
        0x08: { tracks: 154, sectors: 9, n: 3 },   // 2HD  9sec 1.44MB
        0x11: { tracks: 154, sectors: 26, n: 1, basic: true }, // BASIC-2HD
        0x19: { tracks: 160, sectors: 16, n: 1 },  // BASIC-2DD
        0x21: { tracks: 154, sectors: 26, n: 1 },  // 2HD 26sec
    };
    function deDCP(b) {
        const DCP_TRACKMAX = 160, DCP_HEADERSIZE = 1 + DCP_TRACKMAX + 1; // 0xA2
        if (b.length < DCP_HEADERSIZE) throw new Error('DCP: too small');
        const mediatype = b[0];
        const alltrack = b[DCP_HEADERSIZE - 1] === 0x01;
        const g = DCP_TABLE[mediatype];
        if (!g) throw new Error('DCP: unknown mediatype ' + mediatype);
        const secsize = 128 << g.n;
        const tracksize = g.sectors * secsize;
        const out = new Uint8Array(g.tracks * tracksize);
        let ptr = DCP_HEADERSIZE;
        for (let i = 0; i < g.tracks; i++) {
            const present = alltrack || b[1 + i] === 0x01;
            if (!present) continue;                       // 欠落 = ゼロ埋めのまま
            let tsz = tracksize;
            if (i === 0 && g.basic) tsz = tracksize >> 1; // BASIC-2HD track0 小細工
            if (ptr + tsz > b.length) break;
            out.set(b.subarray(ptr, ptr + tsz), i * tracksize);
            ptr += tsz;
        }
        return out;
    }

    function concatSectors(sectors) {
        let total = 0;
        for (const s of sectors) total += s.data.length;
        const out = new Uint8Array(total);
        let p = 0;
        for (const s of sectors) { out.set(s.data, p); p += s.data.length; }
        return out;
    }

    // 拡張子で恒久対応外を判定 (NFD=プロテクト保全 / BKDSK=BASIC / VFDD)。
    const UNSUPPORTED_EXT = {
        nfd: 'NFD (T98-Next, セクタID保持=プロテクト保全用)',
        hdb: 'BKDSK (BASIC ディスク)',
        dd6: 'BKDSK (BASIC ディスク)',
        ddb: 'BKDSK (BASIC ディスク)',
        fdd: 'VFDD (仮想FDD)',
    };

    function deContainer(b, ext) {
        switch (ext) {
            case 'd88': case 'd77': case 'd98': case '88d': case '98d':
                return deD88(b);
            case 'fdi':
                return deFDI(b);
            case 'dcp': case 'dcu':
                return deDCP(b);
            // raw beta: ヘッダ無しの平セクタ dump。BPB は flat 先頭にそのまま在る。
            default:
                return b;
        }
    }

    // ============================================================
    // imageToVolumes: flat → ボリューム列 (継ぎ目)
    //   FD は [全体]。HDD 対応時はここで PC-98 パーティションを分割して差し込む。
    // ============================================================
    function imageToVolumes(flat /*, opts */) {
        return [flat];
    }

    // ============================================================
    // readFat: 1 ボリューム → ファイル群 (FAT12/16・サブディレクトリ再帰)
    //   非 FAT (BPB 不正) は null を返す。
    // ============================================================
    function readFat(vol) {
        if (vol.length < 512) return null;
        const bps = u16(vol, 0x0b);
        const spc = vol[0x0d];
        const reserved = u16(vol, 0x0e);
        const nfat = vol[0x10];
        const rootEnt = u16(vol, 0x11);
        const tot16 = u16(vol, 0x13);
        const spf = u16(vol, 0x16);
        const tot32 = u32(vol, 0x20);
        const totalSec = tot16 || tot32;

        // BPB 妥当性チェック (非FAT/自己起動ディスクはここで弾かれて null)。
        if (!(bps === 128 || bps === 256 || bps === 512 || bps === 1024 ||
              bps === 2048 || bps === 4096)) return null;
        if (spc === 0 || (spc & (spc - 1)) !== 0) return null;
        if (nfat < 1 || nfat > 2) return null;
        if (reserved < 1) return null;
        if (rootEnt === 0) return null;          // FAT12/16 はルート固定領域必須
        if (spf === 0) return null;              // FAT32 はフロッピー対象外
        if (totalSec === 0) return null;
        if (totalSec * bps > vol.length + bps) return null;  // サイズ整合 (端数許容)

        const rootDirSec = Math.ceil((rootEnt * 32) / bps);
        const rootStart = reserved + nfat * spf;
        const dataStart = rootStart + rootDirSec;
        const clusters = Math.floor((totalSec - dataStart) / spc);
        if (clusters < 1) return null;
        const isFat16 = clusters >= 4085;

        // FAT (1 つ目) を読む
        const fat = vol.subarray(reserved * bps, (reserved + spf) * bps);
        const eofMin = isFat16 ? 0xfff8 : 0xff8;
        function fatEntry(cl) {
            if (isFat16) {
                return u16(fat, cl * 2);
            }
            const o = (cl * 3) >> 1;             // 12bit
            const v = fat[o] | (fat[o + 1] << 8);
            return (cl & 1) ? (v >> 4) : (v & 0xfff);
        }

        const secOff = (lba) => lba * bps;
        // クラスタ番号 → flat 内のセクタ範囲 (cluster 2 = dataStart)
        function clusterBytes(cl) {
            const lba = dataStart + (cl - 2) * spc;
            return vol.subarray(secOff(lba), secOff(lba + spc));
        }
        // クラスタチェーンを辿って size バイト集める (ループ防御つき)
        function readChain(firstCl, size) {
            const out = new Uint8Array(size);
            let p = 0, cl = firstCl, guard = clusters + 4;
            const seen = new Set();
            while (cl >= 2 && cl < eofMin && p < size && guard-- > 0) {
                if (seen.has(cl)) break;
                seen.add(cl);
                const chunk = clusterBytes(cl);
                const n = Math.min(chunk.length, size - p);
                out.set(chunk.subarray(0, n), p);
                p += n;
                cl = fatEntry(cl);
            }
            return out;
        }

        const files = [];

        // ディレクトリ 32B エントリ列 (raw バイト) を走査
        function parseDir(dirBytes, prefix, depth) {
            if (depth > 16) return;              // 異常な深さ防御
            const count = (dirBytes.length / 32) | 0;
            for (let i = 0; i < count; i++) {
                const o = i * 32;
                const first = dirBytes[o];
                if (first === 0x00) break;        // これ以降は空
                if (first === 0xe5) continue;     // 削除済
                const attr = dirBytes[o + 0x0b];
                if (attr === 0x0f) continue;      // LFN
                if (attr & 0x08) continue;        // ボリュームラベル
                const name = fat83Name(dirBytes, o);
                if (name === '.' || name === '..') continue;
                const cl = u16(dirBytes, o + 0x1a);
                const size = u32(dirBytes, o + 0x1c);
                const mtime = dosDateTime(u16(dirBytes, o + 0x16), u16(dirBytes, o + 0x18));
                if (attr & 0x10) {                // サブディレクトリ
                    if (cl < 2) continue;
                    // ディレクトリのサイズは 0 なので、チェーン全長を集める
                    const sub = readChainAll(cl);
                    parseDir(sub, prefix + name + '/', depth + 1);
                } else {
                    files.push({ name: prefix + name, data: readChain(cl, size), mtime });
                }
            }
        }
        // size 不明 (ディレクトリ) 用: チェーン全クラスタを集める
        function readChainAll(firstCl) {
            const parts = [];
            let cl = firstCl, guard = clusters + 4;
            const seen = new Set();
            while (cl >= 2 && cl < eofMin && guard-- > 0) {
                if (seen.has(cl)) break;
                seen.add(cl);
                parts.push(clusterBytes(cl));
                cl = fatEntry(cl);
            }
            let total = 0; for (const p of parts) total += p.length;
            const out = new Uint8Array(total);
            let q = 0; for (const p of parts) { out.set(p, q); q += p.length; }
            return out;
        }

        const rootBytes = vol.subarray(secOff(rootStart), secOff(rootStart) + rootEnt * 32);
        parseDir(rootBytes, '', 0);

        return { files, info: { kind: isFat16 ? 'FAT16' : 'FAT12', bps, totalSec, clusters } };
    }

    // 8.3 名 (latin1 のまま保つ — FS キーは原バイト。表示側で SJIS デコード)
    function fat83Name(b, o) {
        let base = '';
        for (let i = 0; i < 8; i++) {
            let c = b[o + i];
            if (c === 0x20) break;
            if (i === 0 && c === 0x05) c = 0xe5;  // KANJI lead-byte 0xE5 のエスケープ
            base += String.fromCharCode(c);
        }
        let ext = '';
        for (let i = 8; i < 11; i++) {
            const c = b[o + i];
            if (c === 0x20) break;
            ext += String.fromCharCode(c);
        }
        return ext ? base + '.' + ext : base;
    }

    // ============================================================
    // 公開 API
    // ============================================================
    function extractDiskImage(bytes, filename) {
        const ext = (filename.split('.').pop() || '').toLowerCase();
        if (UNSUPPORTED_EXT[ext]) {
            return { ok: false, reason: '対応外の形式です: ' + UNSUPPORTED_EXT[ext] };
        }
        let flat;
        try {
            flat = deContainer(bytes, ext);
        } catch (e) {
            return { ok: false, reason: 'イメージ解析に失敗: ' + e.message };
        }
        const vols = imageToVolumes(flat);
        let files = [], info = null;
        for (const v of vols) {
            const r = readFat(v);
            if (r) { files = files.concat(r.files); info = info || r.info; }
        }
        if (!files.length) {
            return { ok: false,
                reason: 'FAT ファイルシステムが見つかりません (自己起動 / 非FAT イメージは中身取り出しに非対応)' };
        }
        return { ok: true, files, info };
    }

    // 拡張子がディスクイメージか (UI 側 accept / 振り分け用)
    const DISK_IMAGE_RE = /\.(d88|d77|d98|88d|98d|fdi|hdm|xdf|2hd|dup|flp|dcp|dcu|nfd|hdb|dd6|ddb)$/i;
    function isDiskImageName(name) { return DISK_IMAGE_RE.test(name); }

    const api = { extractDiskImage, isDiskImageName, DISK_IMAGE_RE,
                  _deContainer: deContainer, _readFat: readFat };  // _ は test 用
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.qbDiskImage = api;
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
