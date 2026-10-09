// statefmt.js — ステートセーブの保存ファイル (フェーズ 2 段階 E)。
//
// worker (emu-worker.js)・メインスレッドの従来経路 (bridge.js)・headless (tools/lib/machine.js) の
// どれからも同じコードを使う。環境の違いは「アダプタ」で吸収する:
//   ad.ccall(name, ret, argTypes, args)   Emscripten の ccall
//   ad.FS                                  Emscripten の FS (MEMFS)
//   ad.framebuffer()                       → { px: Uint16Array (RGB565), w, h } | null  (縮小画像用)
//   ad.clearAudio()                        ロード後にホスト側の音声リングを空にする (任意)
//
// 保存ファイル = gzip( "QBSV" u32 版 | u32 長さ + ヘッダ JSON | u32 長さ + 縮小画像 (160x100 RGB) |
//                      区画 (タグ 4 文字 + u32 長さ + 中身) ... )
//   区画 NP2K = NP2kai の statsave (np2kai_state_np2_save の出力ファイル)。**疎な形**で持つ: 4KB ページに
//             区切り、ゼロだけのページを省く (u32 全長 | u32 ページ長 | ビットマップ | 中身のあるページ)。
//             statsave は拡張メモリ 32MB を丸ごと書くので 36MB あり、ほぼゼロ。gzip に全部かけると
//             保存・読み込みそれぞれ 300〜400ms かかった (2026-09-27 実測) のを、gzip の入力ごと減らす
//        QBST = QuuBee 区画 (HLE-DOS・XMS・INT 33h・音声の鳴りかけ・MIDI の控え。native/qb_state.c)
//        FILE = /run の全ディレクトリとファイル (セーブ時の並び順。ロードで /run を作り直す = 巻き戻す)
// 数値はリトルエンディアン。ヘッダの compat (NP2kai のコミット + パッチ一式) が今のビルドと違う
// セーブは読み込まずに断る (NP2kai を上げたら古いセーブは使えない = 2026-09-27 ユーザー決定)。
//
// ロードは「今の状態を取っておく → 適用 → 失敗したら取っておいた状態に戻す」(PC98PLAYER と同じ)。
// 取っておいた状態 (snapshot) は「元に戻す」にもそのまま使える。
(function (root) {
'use strict';

const MAGIC = 'QBSV';
const FORMAT = 1;
const THUMB_W = 160, THUMB_H = 100;
const TMP_NP2 = '/tmp/qbstate.np2';
const TMP_QB = '/tmp/qbstate.qb';

// ---- バイト列の読み書き ----
class W {
    constructor() { this.parts = []; this.len = 0; }
    bytes(u8) { this.parts.push(u8); this.len += u8.length; }
    u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.bytes(b); }
    f64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.bytes(b); }
    blob(u8) { this.u32(u8.length); this.bytes(u8); }
    tag(t) { this.bytes(latin1(t)); }
    out() { const o = new Uint8Array(this.len); let p = 0; for (const x of this.parts) { o.set(x, p); p += x.length; } return o; }
}
class R {
    constructor(u8) { this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.p = 0; }
    need(n) { if (this.p + n > this.u8.length) throw new Error('state: 保存ファイルが途中で切れています'); }
    bytes(n) { this.need(n); const v = this.u8.subarray(this.p, this.p + n); this.p += n; return v; }
    u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
    f64() { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
    blob() { return this.bytes(this.u32()); }
    tag() { return String.fromCharCode(...this.bytes(4)); }
    get done() { return this.p >= this.u8.length; }
}
// MEMFS の名前は SJIS 生バイトを latin1 文字列にしたもの (bridge / worker と同じ) なので latin1 で往復する
function latin1(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; }
function unlatin1(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; }
const utf8enc = new TextEncoder(), utf8dec = new TextDecoder();

// ---- 圧縮 (ブラウザ・Node 18+ 内蔵の CompressionStream) ----
function available() { return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'; }
async function pipe(u8, stream) {
    const s = new Blob([u8]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
}
const gzip = (u8) => pipe(u8, new CompressionStream('gzip'));
const gunzip = (u8) => pipe(u8, new DecompressionStream('gzip'));

// ---- NP2K の疎な形 (ゼロだけの 4KB ページを省く) ----
const PAGE = 4096;
function sparse(u8) {
    const n = Math.ceil(u8.length / PAGE);
    const bm = new Uint8Array(Math.ceil(n / 8));
    const aligned = (u8.byteOffset & 3) === 0 ? u8 : u8.slice();
    const u32 = new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.length >> 2);
    const pages = [];
    for (let p = 0; p < n; p++) {
        const b = p * PAGE, e = Math.min(b + PAGE, u8.length);
        let nz = false;
        for (let i = b >> 2, ie = e >> 2; i < ie; i++) if (u32[i]) { nz = true; break; }
        if (!nz) for (let i = e & ~3; i < e; i++) if (u8[i]) { nz = true; break; }   // 4 で割れない端
        if (nz) { bm[p >> 3] |= 1 << (p & 7); pages.push(u8.subarray(b, e)); }
    }
    const w = new W();
    w.u32(u8.length); w.u32(PAGE); w.bytes(bm);
    for (const pg of pages) w.bytes(pg);
    return w.out();
}
function unsparse(u8) {
    const r = new R(u8);
    const len = r.u32(), page = r.u32();
    const n = Math.ceil(len / page);
    const bm = r.bytes(Math.ceil(n / 8));
    const out = new Uint8Array(len);
    for (let p = 0; p < n; p++) {
        if (!(bm[p >> 3] & (1 << (p & 7)))) continue;
        const b = p * page, sz = Math.min(page, len - b);
        out.set(r.bytes(sz), b);
    }
    return out;
}

// ---- /run の走査・作り直し ----
function listRun(FS) {
    const out = [];   // { dir: bool, name (/run 相対), mtime, data }
    (function walk(path, prefix) {
        let ents; try { ents = FS.readdir(path); } catch (_) { return; }
        for (const e of ents) {
            if (e === '.' || e === '..') continue;
            const p = path + '/' + e;
            let st; try { st = FS.stat(p); } catch (_) { continue; }
            if (FS.isDir(st.mode)) { out.push({ dir: true, name: prefix + e, mtime: +st.mtime }); walk(p, prefix + e + '/'); }
            else out.push({ dir: false, name: prefix + e, mtime: +st.mtime, data: FS.readFile(p) });
        }
    })('/run', '');
    return out;
}
function clearRun(FS) {
    (function walk(path, isRoot) {
        let ents; try { ents = FS.readdir(path); } catch (_) { return; }
        for (const e of ents) {
            if (e === '.' || e === '..') continue;
            const p = path + '/' + e;
            let st; try { st = FS.stat(p); } catch (_) { continue; }
            if (FS.isDir(st.mode)) { walk(p, false); try { FS.rmdir(p); } catch (_) {} }
            else { try { FS.unlink(p); } catch (_) {} }
        }
    })('/run', true);
}
function restoreRun(FS, files) {
    clearRun(FS);
    try { FS.mkdir('/run'); } catch (_) {}
    for (const f of files) {                               // セーブ時の並び順で作る = readdir の順も戻る
        const p = '/run/' + f.name;
        if (f.dir) { try { FS.mkdir(p); } catch (_) {} }
        else FS.writeFile(p, f.data);
        try { FS.utime(p, f.mtime, f.mtime); } catch (_) {}   // run-sync (size:mtime) の比較に合わせる
    }
}

// ---- 縮小画像 (RGB565 → 160x100 RGB、面積平均) ----
function thumbnail(fb) {
    const out = new Uint8Array(THUMB_W * THUMB_H * 3);
    if (!fb || !fb.px || fb.w <= 0 || fb.h <= 0) return out;
    for (let ty = 0; ty < THUMB_H; ty++) {
        const y0 = Math.floor(ty * fb.h / THUMB_H), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * fb.h / THUMB_H));
        for (let tx = 0; tx < THUMB_W; tx++) {
            const x0 = Math.floor(tx * fb.w / THUMB_W), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * fb.w / THUMB_W));
            let r = 0, g = 0, b = 0, n = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
                const v = fb.px[y * fb.w + x];
                r += ((v >> 11) & 31) * 255 / 31; g += ((v >> 5) & 63) * 255 / 63; b += (v & 31) * 255 / 31; n++;
            }
            const o = (ty * THUMB_W + tx) * 3;
            out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
        }
    }
    return out;
}

// ---- ゲームの識別子 = Run したファイルの名前と中身の SHA-256 (先頭 16 桁) ----
async function gameId(name, data) {
    const nm = latin1(String(name).toUpperCase());
    const buf = new Uint8Array(nm.length + 1 + data.length);
    buf.set(nm, 0); buf.set(data, nm.length + 1);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return Array.from(h.subarray(0, 8), (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---- 状態の取得と適用 (同期。フレーム境界で呼ぶ) ----
function compatId(ad) { return ad.ccall('np2kai_state_compat_id', 'string', [], []); }

// 今の状態を取る。{ ok:false, reason:'fep' } = FEP の変換中 (断る) / reason:'error' = 書けなかった
function capture(ad) {
    if (ad.ccall('np2kai_state_qb_busy', 'number', [], [])) return { ok: false, reason: 'fep' };
    const np2 = ad.ccall('np2kai_state_np2_save', 'number', ['string'], [TMP_NP2]);
    const qb = ad.ccall('np2kai_state_qb_save', 'number', ['string'], [TMP_QB]);   // 開いているファイルを fflush する
    if (np2 !== 0 || qb !== 0) return { ok: false, reason: 'error', detail: `np2=${np2} qb=${qb}` };
    const snap = { ok: true, np2k: ad.FS.readFile(TMP_NP2), qbst: ad.FS.readFile(TMP_QB), files: listRun(ad.FS) };
    try { ad.FS.unlink(TMP_NP2); ad.FS.unlink(TMP_QB); } catch (_) {}
    return snap;
}

// 状態を適用する。/run を作り直し → NP2kai 区画 → QuuBee 区画の順 (QuuBee 区画は開き直すファイルと
// statsave の sound_reset の後始末に依存する)。{ ok, detail }
function apply(ad, snap) {
    restoreRun(ad.FS, snap.files);
    ad.FS.writeFile(TMP_NP2, snap.np2k);
    ad.FS.writeFile(TMP_QB, snap.qbst);
    const np2 = ad.ccall('np2kai_state_np2_load', 'number', ['string'], [TMP_NP2]);
    // statsave の戻り値: 0 = 成功。0x01 (DISKCHG = ローダのディスクの更新時刻違い) は無害なので許す
    const np2ok = np2 >= 0 && (np2 & ~0x01) === 0;
    const qb = np2ok ? ad.ccall('np2kai_state_qb_load', 'number', ['string'], [TMP_QB]) : -1;
    try { ad.FS.unlink(TMP_NP2); ad.FS.unlink(TMP_QB); } catch (_) {}
    if (ad.clearAudio) ad.clearAudio();
    return { ok: np2ok && qb === 0, detail: `np2=0x${(np2 >>> 0).toString(16)} qb=${qb}` };
}

// ---- 保存ファイル ----
// meta = { gameId, gameName, settings: {...} }。戻り値 { ok, reason?, bytes?, header?, thumb? }
async function save(ad, meta) {
    const snap = capture(ad);
    if (!snap.ok) return snap;
    const thumb = thumbnail(ad.framebuffer ? ad.framebuffer() : null);
    const header = {
        format: FORMAT, created: new Date().toISOString(),
        gameId: meta.gameId || '', gameName: meta.gameName || '',
        compat: compatId(ad), qbRev: ad.ccall('np2kai_build_rev', 'string', [], []),
        settings: meta.settings || {}, thumb: { w: THUMB_W, h: THUMB_H },
    };
    const bytes = await encode(header, thumb, snap);
    return { ok: true, bytes, header, thumb };
}

async function encode(header, thumb, snap) {
    const w = new W();
    w.tag(MAGIC); w.u32(FORMAT);
    w.blob(utf8enc.encode(JSON.stringify(header)));
    w.blob(thumb);
    w.tag('NP2K'); w.blob(sparse(snap.np2k));
    w.tag('QBST'); w.blob(snap.qbst);
    const f = new W();
    f.u32(snap.files.length);
    for (const e of snap.files) {
        f.u32(e.dir ? 1 : 0); f.blob(latin1(e.name)); f.f64(e.mtime);
        f.blob(e.dir ? new Uint8Array(0) : e.data);
    }
    w.tag('FILE'); w.blob(f.out());
    return gzip(w.out());
}

// 保存ファイルを読み解く (状態には触らない)。{ header, thumb, snap }
async function decode(bytes) {
    const r = new R(await gunzip(bytes));
    if (r.tag() !== MAGIC) throw new Error('state: QuuBee の保存ファイルではありません');
    const fmt = r.u32();
    if (fmt !== FORMAT) throw new Error(`state: 保存ファイルの形式 ${fmt} は読めません`);
    const header = JSON.parse(utf8dec.decode(r.blob()));
    const thumb = r.blob();
    const snap = { ok: true, np2k: null, qbst: null, files: [] };
    while (!r.done) {
        const t = r.tag(), body = r.blob();
        if (t === 'NP2K') snap.np2k = unsparse(body);
        else if (t === 'QBST') snap.qbst = body;
        else if (t === 'FILE') {
            const fr = new R(body);
            const n = fr.u32();
            for (let i = 0; i < n; i++) {
                const dir = fr.u32() === 1, name = unlatin1(fr.blob()), mtime = fr.f64(), data = fr.blob();
                snap.files.push(dir ? { dir, name, mtime } : { dir, name, mtime, data: new Uint8Array(data) });
            }
        }   // 知らない区画は読み飛ばす
    }
    if (!snap.np2k || !snap.qbst) throw new Error('state: 必要な区画がありません');
    return { header, thumb, snap };
}

// 読み込み。戻り値 { ok, reason?, detail?, header?, undo? }
//   reason: 'version' (NP2kai の互換識別子が違う) / 'corrupt' (読み解けない) / 'fep' (変換中は取れない) /
//           'failed' (適用に失敗 → 元の状態に戻した)
//   undo: 読み込み前の状態 (restore に渡すと「元に戻す」)
async function load(ad, bytes) {
    let d;
    try { d = await decode(bytes); } catch (e) { return { ok: false, reason: 'corrupt', detail: String(e.message || e) }; }
    const cur = compatId(ad);
    if (d.header.compat !== cur) return { ok: false, reason: 'version', detail: `${d.header.compat} ≠ ${cur}`, header: d.header };
    const undo = capture(ad);
    if (!undo.ok) return { ok: false, reason: undo.reason, detail: undo.detail };
    const r = apply(ad, d.snap);
    if (!r.ok) {
        const back = apply(ad, undo);
        return { ok: false, reason: 'failed', detail: r.detail + (back.ok ? '' : ' / 元に戻すのにも失敗: ' + back.detail) };
    }
    return { ok: true, header: d.header, undo };
}

// 取っておいた状態 (load の undo) に戻す
function restore(ad, snap) { return apply(ad, snap); }

// ヘッダだけを読む (先頭だけ展開する。全体は数 MB あるので、一覧で古いセーブを見分けるのに全部は解かない)
async function readHeader(bytes) {
    const rd = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    let buf = new Uint8Array(0);
    try {
        for (;;) {
            if (buf.length >= 12) {
                const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
                if (unlatin1(buf.subarray(0, 4)) !== MAGIC) throw new Error('state: QuuBee の保存ファイルではありません');
                const n = dv.getUint32(8, true);
                if (buf.length >= 12 + n) return JSON.parse(utf8dec.decode(buf.subarray(12, 12 + n)));
            }
            const { value, done } = await rd.read();
            if (done) throw new Error('state: ヘッダが途中で切れています');
            const nb = new Uint8Array(buf.length + value.length);
            nb.set(buf); nb.set(value, buf.length);
            buf = nb;
        }
    } finally { rd.cancel().catch(() => {}); }
}

root.QBStateFmt = { available, save, load, restore, decode, encode, readHeader, capture, apply, thumbnail, gameId,
    THUMB_W, THUMB_H };
if (typeof module !== 'undefined' && module.exports) module.exports = root.QBStateFmt;
})(typeof self !== 'undefined' ? self : globalThis);
