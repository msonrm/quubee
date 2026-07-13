#!/usr/bin/env node
// HLE FEP M2 の headless 回帰: fep.js (複数文節 + async convert) × Mozc-Wasm。
//
// Part A (アセット不要): 状態機械の純ロジック
//   - ローマ字 n 処理 (konnichiha / minna / nn 単独)
//   - フォールバック変換 (convert=null → カナ巡回)
//   - in-flight 無効化 (変換待ち中に打鍵 → 古い結果を捨てる)
//   - 文節移動 (←→)・文節別候補 (Space/↑↓)・Enter で結合確定
// Part B (web/assets/hechima-wasm.* + mozc.data がある時のみ): 実 Mozc で
//   "kyouhaiitenkidesune" → 変換 → 確定が「今日はいい天気ですね」になること。
//
// 使い方: node tools/fep_mozc_test.js

const path = require('path');
const fs   = require('fs');

const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'player', 'fep.js'));   // globalThis.qbFepCreate
const qbFepCreate = globalThis.qbFepCreate;

let fails = 0;
const ok = (cond, label) => {
    console.log((cond ? 'ok   ' : 'FAIL ') + label);
    if (!cond) fails++;
};
const tick = () => new Promise((r) => setImmediate(r));   // microtask + macrotask flush

function makeHarness(convert) {
    const log = { shows: [], commits: [], hides: 0 };
    const fep = qbFepCreate({
        show(segments) { log.shows.push(segments); },
        hide() { log.hides++; },
        commit(text) { log.commits.push(text); },
        convert,
    });
    fep.setActive(true);
    const type = (s) => { for (const ch of s) fep.feed({ key: ch }); };
    const key = (k) => fep.feed({ key: k });
    const last = () => log.shows[log.shows.length - 1];
    const lastText = () => last().map((s) => s.text).join('');
    return { fep, log, type, key, last, lastText };
}

(async () => {
    // ---- Part A ----
    {   // ローマ字 n 処理
        const h = makeHarness(null);
        h.type('konnichiha');
        ok(h.lastText() === 'こんにちは', `romaji: konnichiha → こんにちは (got ${h.lastText()})`);
        h.key('Escape');
        h.type('minna');
        ok(h.lastText() === 'みんな', `romaji: minna → みんな (got ${h.lastText()})`);
        h.key('Escape');
        h.type('nn');
        h.key('Enter');
        ok(h.log.commits.pop() === 'ん', 'romaji: nn 単独 + Enter → ん');
        h.type('xtu');
        ok(h.lastText() === 'っ', 'romaji: xtu → っ');
        h.key('Escape');
    }
    {   // 句読点・記号: 空バッファでは即確定 (全角)、文中では ROMAJI 経由で全角
        const h = makeHarness(null);
        ok(h.key('.') === true && h.log.commits.pop() === '。', '空 + "." → 。 即確定');
        ok(h.key('?') === true && h.log.commits.pop() === '？', '空 + "?" → ？ 即確定');
        ok(h.key('5') === false, '空 + 数字はゲストへ透過 (従来どおり)');
        h.type('nanodesu.');
        ok(h.lastText() === 'なのです。', `文中の "." は composition 内で 。 (got ${h.lastText()})`);
        h.key('Escape');
        h.type('nanoka?');
        ok(h.lastText() === 'なのか？', `文中の "?" は composition 内で ？ (got ${h.lastText()})`);
        h.key('Escape');
    }
    {   // フォールバック変換 (convert 省略 → カナ巡回、単一文節)
        const h = makeHarness(null);
        h.type('kana');
        h.key(' ');
        await tick();
        ok(h.last().length === 1 && h.last()[0].kind === 'focus' && h.last()[0].text === 'カナ',
           `fallback: かな + Space → カナ (focus) (got ${h.lastText()})`);
        h.key(' ');
        await tick();
        ok(h.lastText() === 'かな', 'fallback: もう一度 Space → ひらがなへ巡回');
        h.key('Enter');
        ok(h.log.commits.pop() === 'かな', 'fallback: Enter で確定');
    }
    {   // in-flight 無効化: 変換待ち中に打鍵したら結果を捨てる
        let resolveLater;
        const h = makeHarness(() => new Promise((r) => { resolveLater = r; }));
        h.type('ka');
        h.key(' ');                       // 変換開始 (pending)
        h.type('na');                     // 待ち中に追加打鍵
        resolveLater([{ key: 'か', candidates: ['蚊'] }]);   // 古い結果が今ごろ到着
        await tick();
        ok(h.lastText() === 'かな' && h.last()[0].kind === 'yomi',
           `race: 待ち中打鍵で古い変換結果を破棄 (got ${h.lastText()}/${h.last()[0].kind})`);
    }
    {   // 複数文節: 移動・文節別候補・結合確定
        const h = makeHarness(() => Promise.resolve([
            { key: 'きょうは', candidates: ['今日は', '京は'] },
            { key: 'はれ',     candidates: ['晴れ', 'ハレ'] },
        ]));
        h.type('kyouhahare');
        h.key(' ');
        await tick();
        ok(h.last().length === 2 && h.last()[0].kind === 'focus' && h.last()[1].kind === 'other',
           'multi: 2 文節 (先頭 focus / 他 other)');
        ok(h.lastText() === '今日は晴れ', `multi: 第 1 候補表示 (got ${h.lastText()})`);
        h.key('ArrowRight');              // 注目文節 → 2 つ目
        ok(h.last()[1].kind === 'focus' && h.last()[0].kind === 'other', 'multi: →で注目文節移動');
        h.key(' ');                       // 2 文節目の次候補
        ok(h.lastText() === '今日はハレ', `multi: 注目文節だけ候補が進む (got ${h.lastText()})`);
        h.key('ArrowUp');                 // 前候補に戻す
        ok(h.lastText() === '今日は晴れ', 'multi: ↑で前候補');
        h.key('Enter');
        ok(h.log.commits.pop() === '今日は晴れ', 'multi: Enter で全文節結合を確定');
    }

    // ---- Part B (実 Mozc) ----
    const QBJS  = path.join(WEB, 'assets', 'hechima-wasm.js');
    const QDATA = path.join(WEB, 'assets', 'mozc.data');
    if (!fs.existsSync(QBJS) || !fs.existsSync(QDATA)) {
        console.log('skip 実 Mozc 統合 (web/assets/hechima-wasm.js / mozc.data 不在 — 成果物は logical-layout-labo の hechima-wasm Release)');
    } else {
        const M = await require(QBJS)();
        M.FS.writeFile('/mozc.data', new Uint8Array(fs.readFileSync(QDATA)));
        const r = M.ccall('hechima_init', 'number', ['string'], ['/mozc.data']);
        ok(r === 0, `hechima_init = 0 (got ${r})`);
        const mozcConvert = (yomi) => {
            const json = M.ccall('hechima_convert', 'string', ['string', 'number'], [yomi, 9]);
            try { const p = JSON.parse(json); return Promise.resolve(p.segments || null); }
            catch (_) { return Promise.resolve(null); }
        };
        const h = makeHarness(mozcConvert);
        h.type('kyouhaiitenkidesune');
        ok(h.lastText() === 'きょうはいいてんきですね',
           `mozc: よみ組み立て (got ${h.lastText()})`);
        h.key(' ');
        await tick(); await tick();
        ok(h.last().length >= 2, `mozc: 複数文節に分割 (got ${h.last().length} 文節)`);
        h.key('Enter');
        const committed = h.log.commits.pop();
        ok(committed === '今日はいい天気ですね', `mozc: 確定 = 今日はいい天気ですね (got ${committed})`);
    }

    console.log(fails ? `FAIL — ${fails} 件` : 'PASS — FEP M2 (複数文節 + Mozc) 全チェック通過');
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
