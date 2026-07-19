#!/usr/bin/env node
// 文節伸縮 (hechima v0.12.0 + keymap-engine v1.4.0 + hechima-wasm v0.2.0) の headless 回帰。
// 薙刀式 space+T/Y → editSegmentLeft/Right → cb.resize → Mozc ResizeSegment の追随
// (labo 指示書 docs/hechima_v020_quubee_handoff.md §5 + v0.3.0 追随 docs/hechima_v030_quubee_handoff.md)。
//
// Part A (アセット不要): セッション層 (hechima.js) の resize 意味論を stub で決定的に検証
//   - Phase 2 + editSegmentRight/Left → cb.resize(focus, ±1)・返った文節列で表示差し替え
//   - 結合で文節が減ったら focus clamp
//   - null 解決 = 伸縮不能 → 現状維持
//   - 空バッファ / 変換前よみ合成中 / cb.resize 未実装 → 飲む (hostKey も出さない)
//   - in-flight 中に状態が変わったら世代トークンで結果破棄
//   - 実打鍵 E2E (v0.3.0 で解禁。fire 直叩きだけだと Phase 2 の routing 穴を素通りする教訓):
//     space+T 同時打鍵 → resize / 三重奏 (次候補化け・即確定・余剰 ArrowLeft) の再発防止 /
//     space 単打 → 次候補 / Shift+←→ → 伸縮 (engine 経路と内蔵ローマ字経路の両方)
// Part B (web/assets/hechima-wasm.* + mozc.data がある時のみ): 実 Mozc ラウンドトリップ
//   - convert('きょうはいいてんきですね') → resize(0,-1) で「きょうは」→「きょう」
//     → resize(0,+1) で第 1 候補列が完全復元 (labo hechima_wasm_test.js と同じ決定的アサート)
//   - 構造だけ見る版: 「あい」→ -1 → +1 で初期分節に依らず最終 1 文節に収束
//     (labo golden mozc_e2e.json の方式)
//
// 使い方: node tools/fep_resize_test.js
const path = require('path');
const fs   = require('fs');

const WEB = path.join(__dirname, '..', 'web');
const H = require(path.join(WEB, 'assets', 'hechima.js'));           // labo hechima (UMD)
const K = require(path.join(WEB, 'assets', 'keymap-engine.js'));      // v1.1.0 (onHostAction)

let fails = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) fails++; };
const tick = () => new Promise((r) => setImmediate(r));

// 薙刀式 engine 込みハーネス (fep_naginata_edit_test と同型)。editSegment* は
// engine.onHostAction 経由でしか届かないので engine 装着が前提。
function harness(convert, resize) {
    const log = { hostKeys: [], commits: [], shows: [], hides: 0, resizes: [] };
    const cb = {
        show(segments) { log.shows.push(segments); },
        hide() { log.hides++; },
        commit(text) { log.commits.push(text); },
        convert,
        hostKey(name) { log.hostKeys.push(name); },
    };
    if (resize) cb.resize = (segIdx, offset) => { log.resizes.push([segIdx, offset]); return resize(segIdx, offset); };
    const fep = H.createFep(cb);
    const json = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'keymaps', 'naginata_jis.json'), 'utf8'));
    const eng = new K.InputEngine(K.decodeKeymap(json));
    eng.onStateChange = () => fep.pumpEngine();
    fep.setEngine(eng, (tap) => K.keyEventFromBrowser(tap));
    fep.setActive(true);
    const fire = (type) => eng.onHostAction({ type });
    const lastShow = () => log.shows[log.shows.length - 1];
    const lastText = () => lastShow().map((s) => s.text).join('');
    // engine が確定したよみを注入して Phase 2 (候補選択中) に入れる
    const toPhase2 = async (yomi) => { eng.confirmedText = yomi; fep.pumpEngine(); await tick(); };
    return { fep, eng, log, fire, lastShow, lastText, toPhase2 };
}

const SEGS2 = [
    { key: 'きょうは', candidates: ['今日は', '京は'] },
    { key: 'はれ',     candidates: ['晴れ', 'ハレ'] },
];

(async () => {
    ok(H.version === '0.12.0', `hechima.version = 0.12.0 (got ${H.version})`);
    ok(K.version === '1.4.0', `KeymapEngine.version = 1.4.0 (got ${K.version}) — hechima 0.12.0 とセット必須`);

    // ---- Part A1: Phase 2 + editSegment* → cb.resize(focus, ±1)・表示差し替え ----
    {
        const h = harness(
            () => Promise.resolve(SEGS2),
            () => Promise.resolve([
                { key: 'きょうはは', candidates: ['今日母', '京は歯'] },
                { key: 'れ',         candidates: ['れ'] },
            ]));
        await h.toPhase2('きょうははれ');
        ok(h.lastText() === '今日は晴れ', `setup: Phase 2 (got ${h.lastText()})`);
        h.fire('editSegmentRight');
        await tick();
        ok(h.log.resizes.pop()?.join(',') === '0,1', 'Phase2 + editSegmentRight(space+Y) → cb.resize(0, +1)');
        ok(h.lastText() === '今日母れ', `resize 結果で表示差し替え (got ${h.lastText()})`);
        ok(h.lastShow()[0].kind === 'focus', 'フォーカス維持 (focus=0 のまま)');
        ok(h.log.hostKeys.length === 0, 'Phase2: editSegment* は実キーを注入しない');
        h.fire('editSegmentLeft');
        await tick();
        ok(h.log.resizes.pop()?.join(',') === '0,-1', 'Phase2 + editSegmentLeft(space+T) → cb.resize(0, -1)');
    }

    // ---- Part A2: 結合で文節が減ったら focus clamp ----
    {
        const h = harness(
            () => Promise.resolve(SEGS2),
            () => Promise.resolve([{ key: 'きょうははれ', candidates: ['今日は晴れ'] }]));
        await h.toPhase2('きょうははれ');
        h.fire('moveRight');                       // focus → 2 文節目
        ok(h.lastShow()[1].kind === 'focus', 'setup: focus=1');
        h.fire('editSegmentRight');
        await tick();
        ok(h.log.resizes.pop()?.join(',') === '1,1', 'resize は focus=1 で呼ばれる');
        ok(h.lastShow().length === 1 && h.lastShow()[0].kind === 'focus',
           '結合で 1 文節に減ったら focus clamp (残った文節が focus)');
    }

    // ---- Part A3: null 解決 = 伸縮不能 → 現状維持 ----
    {
        const h = harness(() => Promise.resolve(SEGS2), () => Promise.resolve(null));
        await h.toPhase2('きょうははれ');
        const showsBefore = h.log.shows.length;
        h.fire('editSegmentLeft');
        await tick();
        ok(h.log.resizes.length === 1, 'resize は呼ばれる');
        ok(h.log.shows.length === showsBefore && h.lastText() === '今日は晴れ',
           'null 解決 → 表示は現状維持 (再描画なし)');
    }

    // ---- Part A4: 空バッファ / 合成中 / cb.resize 未実装 → 飲む ----
    {
        const h = harness(null, () => Promise.resolve(null));
        const r = h.fire('editSegmentRight');
        ok(r === true && h.log.hostKeys.length === 0 && h.log.resizes.length === 0,
           '空バッファ: editSegment* は飲む (hostKey も resize も出さない)');
        h.eng.composingKana = 'かな';
        const r2 = h.fire('editSegmentLeft');
        ok(r2 === true && h.log.resizes.length === 0, '変換前よみ合成中: editSegment* は飲む');
    }
    {
        const h = harness(() => Promise.resolve(SEGS2), null);   // cb.resize 未実装
        await h.toPhase2('きょうははれ');
        const showsBefore = h.log.shows.length;
        const r = h.fire('editSegmentRight');
        ok(r === true && h.log.shows.length === showsBefore && h.log.hostKeys.length === 0,
           'cb.resize 未実装: Phase2 でも飲む (現行と同じ見た目 = 後方互換)');
    }

    // ---- Part A5: in-flight 中の状態変化 → 世代トークンで結果破棄 ----
    {
        let resolveLater;
        const h = harness(
            () => Promise.resolve(SEGS2),
            () => new Promise((r) => { resolveLater = r; }));
        await h.toPhase2('きょうははれ');
        h.fire('editSegmentRight');                // resize 発行 (pending)
        h.fire('deleteBack');                      // 待ち中に取消 → segs=null
        const showsBefore = h.log.shows.length;
        resolveLater([{ key: 'ふるい', candidates: ['古い'] }]);   // 古い結果が今ごろ到着
        await tick();
        ok(h.log.shows.length === showsBefore, 'in-flight 破棄: 取消後に届いた resize 結果は表示しない');
    }

    // ---- Part A6: 実打鍵 E2E (space+T 同時打鍵 → resize、三重奏の再発防止) ----
    {
        const tap = (code, key, shiftKey = false) => ({ code, key, repeat: false,
            shiftKey, ctrlKey: false, altKey: false, metaKey: false });
        const h = harness(() => Promise.resolve(SEGS2), () => Promise.resolve(null));
        await h.toPhase2('きょうははれ');
        h.fep.feed(tap('Space', ' '));             // space を押しながら…
        h.fep.feed(tap('KeyT', 't'));              // …T (chord)
        h.fep.feedUp(tap('KeyT', 't'));
        h.fep.feedUp(tap('Space', ' '));
        await tick();                              // mutual (v1.3.0+): タイマー不使用 (時間送り不要)
        ok(h.log.resizes.pop()?.join(',') === '0,-1', 'E2E: 実打鍵 space+T → cb.resize(0, -1)');
        ok(h.log.commits.length === 0, 'E2E: 即確定しない (三重奏 その1 の再発防止)');
        ok(h.log.hostKeys.length === 0, 'E2E: 余剰カーソルキーがゲストへ飛ばない (三重奏 その2)');
        ok(h.lastText() === '今日は晴れ', `E2E: 候補が化けない (三重奏 その3) (got ${h.lastText()})`);
        // space 単打 = 次候補 (engine の SandS 判定 → convert action 経由)
        h.fep.feed(tap('Space', ' '));
        h.fep.feedUp(tap('Space', ' '));
        await tick();                              // 単打の出力も keyUp 駆動 (タイマー無し)
        ok(h.lastText() === '京は晴れ', `E2E: space 単打 → 次候補 (got ${h.lastText()})`);
        ok(h.log.commits.length === 0, 'E2E: space 単打でも確定しない');
        // Shift+←→ = 伸縮 (engine 経路の navCandidates)
        h.fep.feed(tap('ArrowRight', 'ArrowRight', true));
        await tick();
        ok(h.log.resizes.pop()?.join(',') === '0,1', 'E2E: Shift+→ (engine 経路) → cb.resize(0, +1)');
    }

    // ---- Part A7: Shift+←→ は配列を問わない (内蔵ローマ字 = engine なし) ----
    {
        const log = { commits: [], shows: [], resizes: [] };
        const fep = H.createFep({
            show(s) { log.shows.push(s); },
            hide() {},
            commit(t) { log.commits.push(t); },
            convert: () => Promise.resolve(SEGS2),
            resize(i, o) { log.resizes.push([i, o]); return Promise.resolve(null); },
        });
        fep.setActive(true);
        for (const ch of 'kyouhahare') fep.feed({ key: ch });
        fep.feed({ key: ' ' });                    // 変換 → Phase 2
        await tick();
        fep.feed({ key: 'ArrowLeft', shiftKey: true });
        await tick();
        ok(log.resizes.pop()?.join(',') === '0,-1', '内蔵ローマ字: Shift+← → cb.resize(0, -1)');
        ok(log.commits.length === 0, '内蔵ローマ字: Shift+← で確定しない');
        fep.feed({ key: 'ArrowRight' });           // 素の → は従来どおり文節移動
        fep.feed({ key: 'ArrowRight', shiftKey: true });
        await tick();
        ok(log.resizes.pop()?.join(',') === '1,1', '内蔵ローマ字: 文節移動後の Shift+→ → cb.resize(1, +1)');
    }

    // ---- Part B (実 Mozc ラウンドトリップ) ----
    const QBJS  = path.join(WEB, 'assets', 'hechima-wasm.js');
    const QDATA = path.join(WEB, 'assets', 'mozc.data');
    if (!fs.existsSync(QBJS) || !fs.existsSync(QDATA)) {
        console.log('skip 実 Mozc 統合 (web/assets/hechima-wasm.js / mozc.data 不在 — 成果物は logical-layout-labo の hechima-wasm Release)');
    } else {
        const M = await require(QBJS)();
        M.FS.writeFile('/mozc.data', new Uint8Array(fs.readFileSync(QDATA)));
        ok(M.ccall('hechima_init', 'number', ['string'], ['/mozc.data']) === 0, 'hechima_init = 0');
        ok(typeof M._hechima_resize === 'function', '機能検出: _hechima_resize が存在 (v0.2.0 の wasm)');
        const conv = (yomi) => JSON.parse(M.ccall('hechima_convert', 'string', ['string', 'number'], [yomi, 9])).segments;
        const rsz  = (i, d) => {
            const json = M.ccall('hechima_resize', 'string', ['number', 'number', 'number'], [i, d, 9]);
            if (!json) return null;                            // "" = 伸縮不能 → 現状維持
            try { return JSON.parse(json).segments || null; } catch (_) { return null; }
        };
        const firstCands = (segs) => segs.map((s) => `${s.key}=${s.candidates[0]}`).join('/');

        const base = conv('きょうはいいてんきですね');
        ok(base.length >= 2 && base[0].key === 'きょうは',
           `mozc: 第 1 文節 = きょうは (got ${base[0].key}, ${base.length} 文節)`);
        const shrunk = rsz(0, -1);
        ok(shrunk && shrunk[0].key === 'きょう', `mozc: resize(0,-1) → きょう (got ${shrunk && shrunk[0].key})`);
        const restored = rsz(0, +1);
        ok(restored && firstCands(restored) === firstCands(base),
           `mozc: resize(0,+1) で第 1 候補列が完全復元 (got ${restored && firstCands(restored)})`);

        // 構造だけ見る版 (labo golden mozc_e2e.json の方式): -1 → +1 で最終 1 文節に収束
        let cur = conv('あい');
        cur = rsz(0, -1) || cur;
        cur = rsz(0, +1) || cur;
        ok(cur.length === 1, `mozc: あい → -1 → +1 は初期分節に依らず 1 文節に収束 (got ${cur.length})`);

        ok(rsz(99, 1) === null, 'mozc: 範囲外 segIdx → 空文字列 = null (呼び元は現状維持)');
    }

    console.log(fails ? `\nFAIL — ${fails} 件` : '\nPASS — 文節伸縮 (resize) 全チェック通過');
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
