// statedb.js — ステートセーブの保存先 (IndexedDB、フェーズ 2 段階 E)。メインスレッドで使う。
//
// DB "quubee-state" / ストア "slots" (キー = "<gameId>:<slot>")。1 件 =
//   { key, gameId, slot, gameName, created (ISO), settings ({ soundBoard, midi }), thumb (160x100 RGB Uint8Array),
//     bytes (保存ファイル) }
// slot は 'quick' (クイックセーブ) / 'quick-prev' (上書き前の 1 つ前 = 上書きの「元に戻す」) / '1'〜'8'。
// 一覧は gameId の索引で引く。IndexedDB が使えない環境 (プライベートブラウズの一部等) では例外を投げるので、
// 呼び出し側でセーブ機能を出さない判断に使う。
(function (root) {
'use strict';

const DB_NAME = 'quubee-state', STORE = 'slots', VERSION = 1;
let dbp = null;

function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const st = db.createObjectStore(STORE, { keyPath: 'key' });
                st.createIndex('gameId', 'gameId', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbp = null; reject(req.error); };
    });
    return dbp;
}

function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const st = t.objectStore(STORE);
        let out;
        Promise.resolve(fn(st)).then((v) => { out = v; });
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    }));
}
const req2p = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

const key = (gameId, slot) => `${gameId}:${slot}`;

// 1 件を書く (同じキーは上書き)
function put(rec) {
    const r = Object.assign({}, rec, { key: key(rec.gameId, rec.slot) });
    return tx('readwrite', (st) => req2p(st.put(r)));
}
function get(gameId, slot) { return tx('readonly', (st) => req2p(st.get(key(gameId, slot)))); }
function del(gameId, slot) { return tx('readwrite', (st) => req2p(st.delete(key(gameId, slot)))); }
// そのゲームの全枠 (bytes は重いので省いた一覧)。新しい順
function list(gameId) {
    return tx('readonly', (st) => req2p(st.index('gameId').getAll(gameId))).then((all) =>
        (all || []).map(({ bytes, ...rest }) => Object.assign(rest, { size: bytes ? bytes.length : 0 }))
            .sort((a, b) => String(b.created).localeCompare(String(a.created))));
}
// 全ゲーム合計の保存件数 (更新の告知を、セーブを持つ人にだけ出す判定用)
function count() { return tx('readonly', (st) => req2p(st.count())); }
// クイックセーブ: 既存のクイックを quick-prev へずらしてから書く (上書きの「元に戻す」用)
async function putQuick(rec) {
    const cur = await get(rec.gameId, 'quick');
    if (cur) await put(Object.assign({}, cur, { slot: 'quick-prev' }));
    await put(Object.assign({}, rec, { slot: 'quick' }));
}
// クイックセーブの上書きを取り消す (quick-prev を quick へ戻す)。戻せたら true
async function undoQuick(gameId) {
    const prev = await get(gameId, 'quick-prev');
    if (!prev) { await del(gameId, 'quick'); return false; }
    await put(Object.assign({}, prev, { slot: 'quick' }));
    await del(gameId, 'quick-prev');
    return true;
}

root.QBStateDB = { put, get, del, list, count, putQuick, undoQuick };
})(typeof self !== 'undefined' ? self : globalThis);
