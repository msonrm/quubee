// QuuBee headless machine — テストと計測の共通土台。
//
// なぜ作るか (2026-07-10):
//   tools/ の headless スクリプトはブート手順を毎回コピペしており、そのたびに微妙に違うバグを
//   埋め込んでいた。実害を 3 つ踏んだ:
//     1. 音声を「1 エミュフレーム分」の端数サンプルで汲んだ。qb_audio_fill は frames < bufsize
//        でも 1 ブロック丸ごと消費するので、音が約 5 倍速で進み PI 割り込みが 5 倍に見えた
//        (= 存在しないエミュのバグを追いかけた)。→ captureAudio は必ず bufsize ちょうどで汲む。
//     2. ヘッダだけ直したら ninja が再ビルドせず、古い wasm を測って結論を出しかけた。
//        → info() が wasm の SHA と mtime を必ず返す。素性の分からない数字を出さない。
//     3. 「BGM が鳴る場面」まで毎回 2500〜3000 フレーム空回ししていた (1 回 60〜250 秒)。
//        → snapshot()/restore() で「バグの直前」から始められるようにする。
//
// 使い方:
//     const { Machine } = require('./lib/machine');
//     const m = await Machine.boot({ dir: '/path/to/game', multiple: 20 });
//     m.runFrames(3000);
//     const snap = m.snapshot();  fs.writeFileSync('warm.qbsn', Machine.serialize(snap));
//     ...
//     const m2 = await Machine.restore(fs.readFileSync('warm.qbsn'));   // 暖機ゼロで再開

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');

const EMU_FPS = 56.42;          // emu-worker.js の MS_PER_FRAME と同じ基準
const NKEY = { RETURN: 0x1c, SPACE: 0x34, ESC: 0x00, CTRL: 0x74, SHIFT: 0x70 };

const SNAP_MAGIC = 'QBSN';
const SNAP_VERSION = 1;

/* ---- wasm の素性 (どのバイナリを測ったのかを常に言えるようにする) ---- */
function wasmProvenance() {
    const p = path.join(WEB, 'np2kai_core.wasm');
    const buf = fs.readFileSync(p);
    return {
        sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
        bytes: buf.length,
        mtime: fs.statSync(p).mtime.toISOString(),
    };
}

/* ---- 最小 PNG エンコーダ (screenshot 用) ---- */
let CRC_TABLE = null;
function crc32(buf) {
    if (!CRC_TABLE) {
        CRC_TABLE = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function encodePng(w, h, rgb) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]);
}

/* ---- MEMFS の採取/復元 (Wasm 線形メモリの外に居る唯一の状態) ---- */
function memfsDump(M, dirs) {
    const out = [];
    const walk = (dir) => {
        let names;
        try { names = M.FS.readdir(dir); } catch (_) { return; }
        for (const n of names) {
            if (n === '.' || n === '..') continue;
            const p = dir === '/' ? '/' + n : dir + '/' + n;
            let st;
            try { st = M.FS.stat(p); } catch (_) { continue; }
            if (M.FS.isDir(st.mode)) walk(p);
            else out.push({ path: p, data: Buffer.from(M.FS.readFile(p)) });
        }
    };
    for (const d of dirs) walk(d);
    return out;
}
/* ---- 開いているファイルのストリーム表。
 *      libc の FILE* は heap に載るが、その先の fd → ノード/位置 の対応は Emscripten の JS 側
 *      (FS.streams) に居る。ここを取りこぼすと、復元後の最初の fread が壊れる
 *      (実際に踏んだ: Suika3 は assets.arc を開きっぱなしで、画面も音もずれた)。 ---- */
function streamsDump(M) {
    const out = [];
    M.FS.streams.forEach((s, fd) => {
        if (!s || fd < 3) return;   // 0,1,2 は /dev/tty。モジュール初期化時に作り直される
        out.push({ fd, path: s.path, flags: s.flags, position: s.position });
    });
    return out;
}
function streamsRestore(M, streams) {
    const FS = M.FS;
    const O_TRUNC = 512;
    for (let fd = FS.streams.length - 1; fd >= 3; fd--) {
        if (FS.streams[fd]) { try { FS.close(FS.streams[fd]); } catch (_) { FS.streams[fd] = null; } }
    }
    for (const s of [...streams].sort((a, b) => a.fd - b.fd)) {
        const st = FS.open(s.path, s.flags & ~O_TRUNC);   // O_TRUNC は落とす (復元した中身を消さない)
        if (st.fd !== s.fd) {
            if (FS.streams[s.fd]) throw new Error(`fd ${s.fd} が塞がっている`);
            FS.streams[st.fd] = null;
            FS.streams[s.fd] = st;
            st.fd = s.fd;
        }
        st.position = s.position;
    }
}

function memfsRestore(M, files) {
    for (const f of files) {
        const dir = f.path.slice(0, f.path.lastIndexOf('/')) || '/';
        const parts = dir.split('/').filter(Boolean);
        let cur = '';
        for (const part of parts) {
            cur += '/' + part;
            try { M.FS.mkdir(cur); } catch (_) { /* 既存 */ }
        }
        M.FS.writeFile(f.path, new Uint8Array(f.data));
    }
}

/* ---- Wasm 線形メモリを snapshot のサイズまで伸ばす。
 *      Emscripten は wasmMemory.grow() を隠すので、malloc で押し広げる。
 *      罠: 1 回ごとに free すると、解放した空きブロックが次の要求を満たしてしまい
 *      heap が伸びない (無限ループになる)。目標に届くまで**確保したまま積み**、最後に解放する。
 *      growth は単調なので縮まない。この後 heap 全体を snapshot で上書きするので痕跡は消える。 ---- */
function growHeapTo(M, bytes) {
    const held = [];
    let guard = 0;
    while (M.HEAPU8.buffer.byteLength < bytes) {
        if (++guard > 64) { held.forEach((p) => M._free(p)); throw new Error('heap を ' + bytes + ' まで伸ばせない'); }
        const need = bytes - M.HEAPU8.buffer.byteLength;
        const p = M._malloc(need);
        if (!p) { held.forEach((q) => M._free(q)); throw new Error('malloc(' + need + ') 失敗'); }
        held.push(p);
    }
    held.forEach((p) => M._free(p));
}

class Machine {
    constructor(M, opts) {
        this.M = M;
        this.opts = opts;
        this.frame = 0;
        this.produced = 0;          // これまでに汲んだ音声サンプル数 (フレーム換算の帳尻用)
        this._held = null;          // { key, untilFrame }
        this._capture = null;       // 音声キャプチャ中のバッファ列
        this.prov = wasmProvenance();

        const c = (n, r, a) => M.cwrap(n, r, a);
        this._fn = {
            runFrame: c('np2kai_run_frame', null, ['number']),
            keyDown: c('np2kai_key_down', null, ['number', 'number']),
            keyUp: c('np2kai_key_up', null, ['number', 'number']),
            getFB: c('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']),
            audioFill: c('np2kai_audio_fill', null, ['number', 'number', 'number']),
            peek8: c('np2kai_debug_peek8', 'number', ['number', 'number']),
            int21: c('np2kai_debug_int21_count', 'number', ['number']),
            getExit: c('np2kai_dos_get_exit', 'number', ['number']),
            batchDone: c('np2kai_dos_batch_done', 'number', []),
            xmsStat: c('np2kai_xms_stat', 'number', ['number', 'number']),
        };
    }

    /* --- 素性。どの応答にも添えられるようにする (「どの wasm を測ったか」を毎回言う) --- */
    info() {
        return {
            wasm: this.prov,
            frame: this.frame,
            emuSeconds: +(this.frame / EMU_FPS).toFixed(3),
            settings: {
                soundboard: this.opts.soundboard,
                multiple: this.opts.multiple,
                extmem: this.opts.extmem,
            },
            audio: { rate: this.rate, blockFrames: this.bufsize },
        };
    }

    /* --- 実行。音声は本番 (emu-worker.js) と同じくブロック長ちょうどで汲む。
     *     端数で汲むと qb_audio_fill が 1 ブロック丸ごと消費し、音が数倍速で進む。 --- */
    runFrames(n) {
        for (let i = 0; i < n; i++) this._step();
        return this;
    }

    /* --- 条件が真になるまで走らせる。pred(m) → bool。max 到達で false を返す。 --- */
    runUntil(pred, maxFrames = 20000, checkEvery = 20) {
        for (let i = 0; i < maxFrames; i++) {
            this._step();
            if (i % checkEvery === 0 && pred(this)) return true;
        }
        return pred(this);
    }

    _step() {
        if (this._held && this.frame >= this._held.untilFrame) {
            this._fn.keyUp(this.h, this._held.key);
            this._held = null;
        }
        this._fn.runFrame(this.h);
        this.frame++;
        // 「これまでに出すべきサンプル総数」に届くまでブロック単位で汲む (端数は次フレームへ持ち越し)
        const target = Math.round(this.frame * this.rate / EMU_FPS);
        while (this.produced + this.bufsize <= target) {
            this._fn.audioFill(this.h, this.abuf, this.bufsize);
            this.produced += this.bufsize;
            if (this._capture) {
                this._capture.push(new Int16Array(this.M.HEAP16.buffer, this.abuf, this.bufsize * 2).slice());
            }
        }
    }

    /* --- 入力 --- */
    pressKey(key, holdFrames = 6) {
        if (this._held) { this._fn.keyUp(this.h, this._held.key); this._held = null; }
        this._fn.keyDown(this.h, key);
        this._held = { key, untilFrame: this.frame + holdFrames };
        return this;
    }

    /* --- 観測 --- */
    textVram(rows = 25, cols = 80) {
        const out = [];
        for (let r = 0; r < rows; r++) {
            let line = '';
            for (let c = 0; c < cols; c++) {
                const ch = this._fn.peek8(this.h, 0xA0000 + (r * cols + c) * 2);
                line += (ch >= 0x20 && ch < 0x7f) ? String.fromCharCode(ch) : ' ';
            }
            out.push(line.replace(/\s+$/, ''));
        }
        return out;
    }

    framebuffer() {
        const M = this.M;
        const p = this._fn.getFB(this.h, this._wP, this._hP, this._bP);
        const w = M.HEAP32[this._wP >> 2], h = M.HEAP32[this._hP >> 2];
        return { ptr: p, w, h };
    }

    screenshotPng(file) {
        const { ptr, w, h } = this.framebuffer();
        const rgb = Buffer.alloc(w * h * 3);
        for (let i = 0; i < w * h; i++) {
            const v = this.M.HEAPU16[(ptr >> 1) + i];
            rgb[i * 3] = ((v >> 11) & 31) * 255 / 31;
            rgb[i * 3 + 1] = ((v >> 5) & 63) * 255 / 63;
            rgb[i * 3 + 2] = (v & 31) * 255 / 31;
        }
        const png = encodePng(w, h, rgb);
        if (file) fs.writeFileSync(file, png);
        return png;
    }

    /* 画面の指紋 (回帰比較用。色数 + 全画素の 32bit ハッシュ) */
    screenHash() {
        const { ptr, w, h } = this.framebuffer();
        let hash = 0x811c9dc5;
        for (let i = 0; i < w * h; i++) {
            hash ^= this.M.HEAPU16[(ptr >> 1) + i];
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash >>> 0;
    }

    /* --- 音声。seconds ぶんをブロック単位で捕まえる (エミュ時間で数える) --- */
    captureAudio(seconds) {
        this._capture = [];
        this.runFrames(Math.ceil(seconds * EMU_FPS));
        const chunks = this._capture;
        this._capture = null;
        let total = 0;
        for (const c of chunks) total += c.length;
        const pcm = new Int16Array(total);
        let o = 0;
        for (const c of chunks) { pcm.set(c, o); o += c.length; }
        return pcm;   // stereo interleaved
    }

    int21(ah) { return this._fn.int21(ah); }
    /* ゲストのメインループ周期の目安に使う (process_input が kbhit→getch を回すエンジン向け) */
    exited() { return !!this._fn.getExit(this._exitPtr); }
    batchDone() { return !!this._fn.batchDone(); }
    xms() {
        return {
            handles: this._fn.xmsStat(this.h, 1),
            usedMB: +(this._fn.xmsStat(this.h, 2) / 1048576).toFixed(2),
            largestMB: +(this._fn.xmsStat(this.h, 4) / 1048576).toFixed(2),
        };
    }

    /* --- スナップショット。Wasm の線形メモリ + MEMFS + JS が握っているポインタ。
     *     関数テーブルの索引はビルド固有なので、wasm の SHA が違う snapshot は復元しない。 --- */
    snapshot() {
        const heap = Buffer.from(this.M.HEAPU8.buffer.slice(0));
        const files = memfsDump(this.M, ['/run', '/tmp']);
        return {
            meta: {
                version: SNAP_VERSION,
                wasm: this.prov,
                opts: this.opts,
                streams: streamsDump(this.M),
                cwd: this.M.FS.cwd(),
                frame: this.frame,
                produced: this.produced,
                rate: this.rate,
                bufsize: this.bufsize,
                // 押しっぱなしのキーは JS 側にしか無い (C 側の keystat は heap に載る)。
                // これを落とすと復元後に keyUp を撃ち忘れ、ゲストがキーを押されたままになる。
                held: this._held,
                ptrs: { h: this.h, abuf: this.abuf, wP: this._wP, hP: this._hP, bP: this._bP, exitPtr: this._exitPtr },
            },
            heap,
            files,
        };
    }

    static serialize(snap) {
        const filesMeta = snap.files.map((f) => ({ path: f.path, len: f.data.length }));
        const header = Buffer.from(JSON.stringify({ ...snap.meta, files: filesMeta }), 'utf8');
        const hdrLen = Buffer.alloc(8);
        hdrLen.writeUInt32LE(header.length, 0);
        hdrLen.writeUInt32LE(snap.heap.length, 4);
        return Buffer.concat([Buffer.from(SNAP_MAGIC), hdrLen, header, snap.heap, ...snap.files.map((f) => f.data)]);
    }

    static deserialize(buf) {
        if (buf.slice(0, 4).toString() !== SNAP_MAGIC) throw new Error('QBSN ではない');
        const hdrLen = buf.readUInt32LE(4), heapLen = buf.readUInt32LE(8);
        const meta = JSON.parse(buf.slice(12, 12 + hdrLen).toString('utf8'));
        if (meta.version !== SNAP_VERSION) throw new Error('snapshot の版が違う');
        let off = 12 + hdrLen;
        const heap = buf.slice(off, off + heapLen); off += heapLen;
        const files = meta.files.map((f) => {
            const data = buf.slice(off, off + f.len); off += f.len;
            return { path: f.path, data };
        });
        return { meta, heap, files };
    }

    /* --- 新しいモジュールへ復元する (別プロセス/別 run から暖機ゼロで再開できる) --- */
    static async restore(buf, { quiet = true } = {}) {
        const snap = Buffer.isBuffer(buf) ? Machine.deserialize(buf) : buf;
        const prov = wasmProvenance();
        if (snap.meta.wasm.sha256 !== prov.sha256) {
            throw new Error(`wasm が違う: snapshot=${snap.meta.wasm.sha256} 現在=${prov.sha256}\n` +
                            '(関数テーブルの索引はビルド固有。ビルドし直したら snapshot も取り直す)');
        }
        const M = await Machine._load(quiet);
        growHeapTo(M, snap.heap.length);
        M.HEAPU8.set(snap.heap);
        memfsRestore(M, snap.files);
        streamsRestore(M, snap.meta.streams || []);   // heap の FILE* が指す fd を実在させる
        if (snap.meta.cwd) { try { M.FS.chdir(snap.meta.cwd); } catch (_) {} }

        const m = new Machine(M, snap.meta.opts);
        m.frame = snap.meta.frame;
        m.produced = snap.meta.produced;
        m.rate = snap.meta.rate;
        m.bufsize = snap.meta.bufsize;
        m._held = snap.meta.held || null;
        const p = snap.meta.ptrs;
        m.h = p.h; m.abuf = p.abuf; m._wP = p.wP; m._hP = p.hP; m._bP = p.bP; m._exitPtr = p.exitPtr;
        return m;
    }

    static async _load(quiet) {
        const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
        return await NP2KaiModule({
            noInitialRun: true,
            print: () => {},
            printErr: quiet ? () => {} : (s) => console.error(s),
        });
    }

    /* --- 起動。dir 内の .bat を batscript で解釈して stage する (ブラウザと同じ経路)。 --- */
    static async boot(opts) {
        const o = {
            dir: null, bat: null, soundboard: 'matex', multiple: 20, extmem: null, quiet: true,
            ...opts,
        };
        const M = await Machine._load(o.quiet);
        M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
        M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
        const h = M.ccall('np2kai_create', 'number', [], []);
        try { M.FS.mkdir('/run'); } catch (_) {}

        const names = [];
        for (const nb of fs.readdirSync(o.dir, { encoding: 'buffer' })) {
            const name = nb.toString('latin1');
            M.FS.writeFile('/run/' + name, new Uint8Array(fs.readFileSync(Buffer.concat([Buffer.from(o.dir + '/'), nb]))));
            names.push(name);
        }
        const batName = o.bat || names.find((n) => /\.bat$/i.test(n));
        if (!batName) throw new Error('.bat が見つからない (bat: を指定してください)');
        const bat = require(path.join(WEB, 'player', 'batscript.js'));
        const stmts = bat.buildStatements(bat.parse(M.FS.readFile('/run/' + batName)), names, o.args || '');
        if (!stmts) throw new Error('buildStatements が null');
        const prog = Buffer.from(bat.serializeStatements(stmts), 'latin1');
        const ptr = M._malloc(prog.length); M.HEAPU8.set(prog, ptr);
        const r = M.ccall('np2kai_dos_stage_batch', 'number', ['number', 'number', 'string'],
            [ptr, prog.length, batName.toUpperCase()]);
        M._free(ptr);
        if (r !== 0) throw new Error('stage_batch failed r=' + r);

        // 音源ボード / 拡張メモリ は reset より前に適用する (ブラウザの run 経路と同じ順序)
        if (o.soundboard === 'matex') M.ccall('np2kai_set_wss', 'number', ['number'], [1]);
        else M.ccall('np2kai_set_chibioto', 'number', ['number'], [o.soundboard === 'adpcm' ? 1 : 0]);
        if (o.extmem) M.ccall('np2kai_set_extmem', 'number', ['number'], [o.extmem]);

        M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
        M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [h, '/tmp/loader.d88', 0, 0]);
        M.ccall('np2kai_reset', null, ['number'], [h]);
        if (o.multiple) M.ccall('np2kai_set_clock_multiple', 'number', ['number'], [o.multiple]);

        const m = new Machine(M, o);
        m.h = h;
        m.rate = M.ccall('np2kai_audio_get_rate', 'number', ['number'], [h]) || 44100;
        m.bufsize = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [h]) || 2048;
        m.abuf = M._malloc(m.bufsize * 4);
        m._wP = M._malloc(4); m._hP = M._malloc(4); m._bP = M._malloc(4);
        m._exitPtr = M._malloc(4);
        return m;
    }
}

module.exports = { Machine, NKEY, EMU_FPS, encodePng };
