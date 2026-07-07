// Mozc-Wasm を専用 Worker で動かす — HLE FEP のかな漢字変換バックエンド。
//
// mozc_qb.wasm (fcitx-contrib/fcitx5-mozc 由来のビルド、BSD-3。レシピは
// ~/development/mozc-wasm-build/README.md) は -pthread ビルドなので SharedArrayBuffer
// (COOP/COEP) が必須 — QuuBee は音声 Worker のため配信済み。pthread pool の再スポーンは
// mainScriptUrlOrBlob で mozc_qb.js 自身を指す (importScripts 環境では自動解決できない)。
//
// main とのプロトコル:
//   ← {type:'init'}                       辞書 fetch + module 構築。progress を随時送る
//   → {type:'progress', loaded, total}
//   → {type:'ready'} / {type:'error', message}
//   ← {type:'convert', id, kana, maxCands}
//   → {type:'result', id, segments}       segments = [{key, candidates:[...]}] / null=変換失敗
//
// 辞書 mozc.data (~19MB) は初回 init でのみ fetch (FEP を使わないユーザーは一切取得しない)。

'use strict';

importScripts('../assets/mozc_qb.js');

let M = null;

async function init() {
    const res = await fetch('../assets/mozc.data');
    if (!res.ok) throw new Error(`mozc.data fetch failed (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    let buf;
    if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const parts = [];
        let n = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            n += value.length;
            postMessage({ type: 'progress', loaded: n, total });
        }
        buf = new Uint8Array(n);
        let o = 0;
        for (const p of parts) { buf.set(p, o); o += p.length; }
    } else {
        buf = new Uint8Array(await res.arrayBuffer());
    }
    // Cloudflare Pages は未配備パスにも 200+HTML を返す (SPA フォールバック) ので、
    // 先頭が '<' なら辞書ではない (soundfont の RIFF 検査と同じ発想)。
    if (!buf.length || buf[0] === 0x3C) throw new Error('mozc.data が不正 (未配備で HTML が返った可能性)');

    // ホストのタイムゾーンを cctz の固定オフセットゾーン名 (Fixed/UTC±hh:mm:ss) で注入する。
    // wasm には zoneinfo が無く TZ 未設定だと absl/cctz が UTC に落ち、「いま」「きょう」の
    // 日時候補が 9 時間ずれる (JST)。POSIX 形式 (JST-9 等) は zoneinfo 不在では解決できないが、
    // この特殊名は cctz が合成する (time_zone_fixed.cc FixedOffsetFromName)。DST は起動時
    // オフセット固定 (日本は DST なし。セッション跨ぎの DST 切替だけ追従しない — 許容)。
    const offMin = -new Date().getTimezoneOffset();   // 東側が正 (JST = +540)
    const tzSign = offMin >= 0 ? '+' : '-';
    const tzAbs = Math.abs(offMin);
    const tzName = `Fixed/UTC${tzSign}${String(Math.floor(tzAbs / 60)).padStart(2, '0')}:${String(tzAbs % 60).padStart(2, '0')}:00`;
    const mod = {
        mainScriptUrlOrBlob: new URL('../assets/mozc_qb.js', self.location.href).href,
        locateFile: (p) => new URL('../assets/' + p, self.location.href).href,
    };
    mod.preRun = [() => { mod.ENV.TZ = tzName; }];   // ENV は EXPORTED_RUNTIME_METHODS で公開済み
    M = await self.MozcQbModule(mod);
    M.FS.writeFile('/mozc.data', buf);
    const r = M.ccall('mozc_qb_init', 'number', ['string'], ['/mozc.data']);
    if (r !== 0) throw new Error('mozc_qb_init failed (r=' + r + ')');
}

onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'init') {
        init().then(
            () => postMessage({ type: 'ready' }),
            (e) => postMessage({ type: 'error', message: String((e && e.message) || e) }));
    } else if (m.type === 'convert') {
        let segments = null;
        try {
            const json = M.ccall('mozc_qb_convert', 'string',
                ['string', 'number'], [m.kana, m.maxCands | 0]);
            const parsed = JSON.parse(json);
            if (parsed && Array.isArray(parsed.segments) && parsed.segments.length) {
                segments = parsed.segments;
            }
        } catch (e) {
            console.warn('[mozc-worker] convert failed:', e);
        }
        postMessage({ type: 'result', id: m.id, segments });
    }
};
