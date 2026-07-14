// hechima-wasm を専用 Worker で動かす — HLE FEP のかな漢字変換バックエンド。
//
// hechima-wasm.wasm (fcitx-contrib/fcitx5-mozc 由来のビルド、BSD-3。powered by Mozc。
// ビルド/正典は logical-layout-labo の hechima-wasm/、成果物は同リポの GitHub Release)
// は -pthread ビルドなので SharedArrayBuffer (COOP/COEP) が必須 — QuuBee は音声 Worker の
// ため配信済み。pthread pool の再スポーンは mainScriptUrlOrBlob で hechima-wasm.js 自身を
// 指す (importScripts 環境では自動解決できない)。
//
// main とのプロトコル:
//   ← {type:'init'}                       辞書 fetch + module 構築。progress を随時送る
//   → {type:'progress', loaded, total}
//   → {type:'ready'} / {type:'error', message}
//   ← {type:'convert', id, kana, maxCands}
//   → {type:'result', id, segments}       segments = [{key, candidates:[...]}] / null=変換失敗
//   ← {type:'resize', id, segIdx, offset, maxCands}   文節伸縮 (Mozc ResizeSegment)
//   → {type:'result', id, segments}       convert と同形 / null=伸縮不能 (呼び元は現状維持)
//
// 辞書 mozc.data (~19MB) は初回 init でのみ fetch (FEP を使わないユーザーは一切取得しない)。
//
// pin 版 (labo hechima-wasm-v0.2.0, BUILD_INFO.txt より): labo 29b6271 /
// fcitx5-mozc 8b3d34c / mozc 0651fbc / emsdk 3.1.69。成果物差し替え時はこの版も更新する。

'use strict';

importScripts('../assets/hechima-wasm.js');

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
        mainScriptUrlOrBlob: new URL('../assets/hechima-wasm.js', self.location.href).href,
        locateFile: (p) => new URL('../assets/' + p, self.location.href).href,
    };
    mod.preRun = [() => { mod.ENV.TZ = tzName; }];   // ENV は EXPORTED_RUNTIME_METHODS で公開済み
    M = await self.HechimaModule(mod);
    M.FS.writeFile('/mozc.data', buf);
    const r = M.ccall('hechima_init', 'number', ['string'], ['/mozc.data']);
    if (r !== 0) throw new Error('hechima_init failed (r=' + r + ')');
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
            const json = M.ccall('hechima_convert', 'string',
                ['string', 'number'], [m.kana, m.maxCands | 0]);
            segments = parseSegments(json);
        } catch (e) {
            console.warn('[mozc-worker] convert failed:', e);
        }
        postMessage({ type: 'result', id: m.id, segments });
    } else if (m.type === 'resize') {
        // 文節伸縮: 直近の convert 結果の m.segIdx 文節 (0 起点) のよみを m.offset (よみ文字数 ±)
        // だけ伸縮し再変換する。空文字列 = 伸縮不能 (境界/変換状態なし/範囲外) → null で現状維持。
        // 機能検出: 古い v0.1.0 の wasm が残っていたら resize を無効化 (labo golden ランナーと同方式)。
        let segments = null;
        try {
            if (typeof M._hechima_resize === 'function') {
                const json = M.ccall('hechima_resize', 'string',
                    ['number', 'number', 'number'], [m.segIdx | 0, m.offset | 0, m.maxCands | 0]);
                segments = parseSegments(json);
            }
        } catch (e) {
            console.warn('[mozc-worker] resize failed:', e);
        }
        postMessage({ type: 'result', id: m.id, segments });
    }
};

// convert / resize 共通の戻りパース: "" やパース失敗・空 segments は null。
function parseSegments(json) {
    try {
        const parsed = JSON.parse(json);
        if (parsed && Array.isArray(parsed.segments) && parsed.segments.length) {
            return parsed.segments;
        }
    } catch (_) {}
    return null;
}
