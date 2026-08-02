#!/usr/bin/env node
// Space の意味論 (hechima v0.19.0 + keymap-engine v2.0.0 追随) の headless 回帰。
//
// 直した実害: 逐次系の配列 (AZIK / 月 / Colemak / JSON ローマ字) を選ぶと、合成中の Space が
// 「変換」ではなく「よみのまま確定」になっていた。KeymapEngine 単体 (漢字変換なし) では
// confirm が正しい既定だったが、hechima と合成すると「変換せずに確定」に化ける
// — 層を合成したときに前提が失効していた事故 (labo 指示書 docs/hechima_v0160_quubee_handoff.md)。
//
// ここは QuuBee 側の配線 (fep.feed → engine → onHostAction → hechima) を実打鍵で通す:
// engine.onHostAction を直叩きするだけだと Phase 2 の routing 穴を素通りする、という
// v0.3.0 追随の教訓 (docs/hechima_v020_phase2_chord_feedback.md) に従う。
//
//   [1-3] AZIK: 合成中 Space = 変換 / 2 度目 = 次候補 / Enter = 確定 (確定を挟まない)
//   [4-5] 空バッファ Space = 全角スペースを commit・Shift+Space = 半角 (ブラウザ側は
//         cb.commit → encodeSjis → injectText。0x8140 が引けることは bridge の逆引き表が担保)
//   [6]   JSON ローマ字の句読点 , . → 、。 (組み込みローマ字だけが持っていた characterMap の非対称)
//   [7]   BS 後の pending 復帰: 「dか」→ BS →「d」+ a →「だ」
//   [8]   月配列でも Space = 変換 (逐次系の一般化)
//   [9]   薙刀式 (space = 相互シフト宣言) は従来どおり = 回帰ガード
//   [10]  候補選択中の Shift+Space = 前候補 (hechima v0.18.0。旧版は次候補へ進んでいた)
//   [11]  Shift+英字 = 英字合成 (hechima v0.17.0。旧版は英字と知らず Mozc へ投げていた)
//
// 使い方: node tools/fep_space_test.js

const path = require('path');
const fs   = require('fs');

const WEB = path.join(__dirname, '..', 'web');
const H = require(path.join(WEB, 'assets', 'hechima.js'));         // labo hechima (UMD)
const K = require(path.join(WEB, 'assets', 'keymap-engine.js'));    // 逐次系 Space は v1.6.0〜

let fails = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) fails++; };
const tick = () => new Promise((r) => setImmediate(r));

// Mozc モック: よみ 1 文節・候補 = [よみ+'!', よみ] (決定的。第 1/第 2 候補を識別できる)
const mockConvert = (yomi) => Promise.resolve([{ key: yomi, candidates: [yomi + '!', yomi] }]);

// 配列 JSON を実ロードして engine を装着したハーネス (fep_resize_test と同型)。
// keymap-format v2 から JIS/US は配列でなくレイアウトの選択 = 1 配列 1 ファイル + { layout }。
function harness(layout, kb = 'us', convert = mockConvert) {
    const log = { hostKeys: [], commits: [], shows: [], hides: 0 };
    const fep = H.createFep({
        show(segments) { log.shows.push(segments); },
        hide() { log.hides++; },
        commit(text) { log.commits.push(text); },
        convert,
        hostKey(name) { log.hostKeys.push(name); },
    });
    const json = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'keymaps', layout + '.json'), 'utf8'));
    const eng = new K.InputEngine(K.decodeKeymap(json, { layout: kb }));
    eng.onStateChange = () => fep.pumpEngine();
    fep.setEngine(eng, (tap) => K.keyEventFromBrowser(tap));
    fep.setActive(true);
    const tap = (code, key, shiftKey = false) => ({ code, key, repeat: false,
        shiftKey, ctrlKey: false, altKey: false, metaKey: false });
    // 1 打 = down + up (mutual 判定は時間を見ないので sleep 不要 = タイマー不使用のガードも兼ねる)
    const hit = (code, key, shiftKey = false) => {
        const r = fep.feed(tap(code, key, shiftKey));
        fep.feedUp(tap(code, key, shiftKey));
        return r;
    };
    const type = (s) => { for (const ch of s) hit('Key' + ch.toUpperCase(), ch); };
    const lastShow = () => log.shows[log.shows.length - 1];
    const lastText = () => (lastShow() || []).map((s) => s.text).join('');
    const lastKind = () => (lastShow() && lastShow()[0]) ? lastShow()[0].kind : null;
    return { fep, eng, log, hit, type, lastShow, lastText, lastKind };
}

(async () => {
    ok(H.version === '0.19.0', `hechima.version = 0.19.0 (got ${H.version})`);
    ok(K.version === '2.0.0', `KeymapEngine.version = 2.0.0 (got ${K.version}) — hechima 0.19.0 とセット必須`);

    // ---- [1-3] AZIK: 合成中 Space = 変換 → 次候補 → Enter 確定 ----
    {
        const h = harness('azik');
        h.type('kyouha');
        await tick();
        const yomi = h.lastText();
        ok(h.lastKind() === 'yomi' && /^[ぁ-ゖァ-ヶー]+$/.test(yomi),
           `[1] AZIK "kyouha" → よみ合成 (got ${JSON.stringify(yomi)})`);
        ok(h.log.commits.length === 0, '[1b] 打鍵中に確定は起きない');

        h.hit('Space', ' ');
        await tick();
        ok(h.lastKind() === 'focus', `[2] 合成中 Space = 変換 (kind=${h.lastKind()}) — 主修正`);
        ok(h.lastText() === yomi + '!', `[2b] 第 1 候補が出る (got ${JSON.stringify(h.lastText())})`);
        ok(h.log.commits.length === 0,
           `[2c] Space で確定しない (従来の実害。commits=${JSON.stringify(h.log.commits)})`);

        h.hit('Space', ' ');
        await tick();
        ok(h.lastText() === yomi, `[3] Space 2 度目 = 次候補 (got ${JSON.stringify(h.lastText())})`);
        ok(h.log.commits.length === 0, '[3b] 次候補でも確定しない');
        h.hit('Enter', 'Enter');
        await tick();
        ok(h.log.commits.length === 1 && h.log.commits[0] === yomi,
           `[3c] Enter で確定 (got ${JSON.stringify(h.log.commits)})`);
    }

    // ---- [4-5] 空バッファの Space = スペース挿入 (全角 / Shift = 半角) ----
    {
        const h = harness('azik');
        h.hit('Space', ' ');
        await tick();
        ok(h.log.commits.join('') === '　',
           `[4] 空バッファ Space → 全角スペースを commit (got ${JSON.stringify(h.log.commits)})`);
        ok(h.log.shows.length === 0, '[4b] 未確定表示に居座らない (show は出ない)');

        const h2 = harness('azik');
        h2.hit('Space', ' ', true);
        await tick();
        ok(h2.log.commits.join('') === ' ',
           `[5] 空バッファ Shift+Space → 半角スペース (got ${JSON.stringify(h2.log.commits)})`);
    }

    // ---- [6] JSON ローマ字の句読点 , . → 、。 ----
    {
        const h = harness('romaji');
        h.hit('Comma', ',');
        h.hit('Period', '.');
        await tick();
        const out = h.log.commits.join('') + h.lastText();
        ok(out.includes('、') && out.includes('。'),
           `[6] JSON ローマ字の , . → 、。 (got ${JSON.stringify(out)})`);
        ok(!/[,.]/.test(out), `[6b] 生の , . がよみに残らない (got ${JSON.stringify(out)})`);
    }

    // ---- [7] BS 後の pending 復帰 (「dか」→ BS →「d」+ a →「だ」) ----
    {
        const h = harness('romaji');
        h.type('dka');
        await tick();
        ok(h.lastText() === 'dか', `[7] 打ち損じ "dka" → よみ "dか" (got ${JSON.stringify(h.lastText())})`);
        h.hit('Backspace', 'Backspace');
        await tick();
        ok(h.lastText() === 'd', `[7b] BS で "d" まで戻る (got ${JSON.stringify(h.lastText())})`);
        h.type('a');
        await tick();
        ok(h.lastText() === 'だ',
           `[7c] 続きの a で pending 復帰 → "だ" (got ${JSON.stringify(h.lastText())})`);
    }

    // ---- [8] 月配列でも Space = 変換 (逐次系の一般化) ----
    // 月配列 2-263 は d / k が前置シフト。単打 s = か / 前置 k+s = を (JSON 実値)。
    {
        const h = harness('tsuki2-263');
        h.type('s');
        h.hit('KeyK', 'k');                           // 前置シフト
        h.type('s');
        await tick();
        ok(h.lastKind() === 'yomi' && h.lastText() === 'かを',
           `[8] 月配列 単打 s + 前置 k→s → よみ "かを" (got ${JSON.stringify(h.lastText())})`);
        h.hit('Space', ' ');
        await tick();
        ok(h.lastKind() === 'focus' && h.lastText() === 'かを!',
           `[8b] 月配列 合成中 Space = 変換 (kind=${h.lastKind()}, got ${JSON.stringify(h.lastText())})`);
        ok(h.log.commits.length === 0, '[8c] 月配列 Space で確定しない');
    }

    // ---- [9] 薙刀式 = 従来どおり (space は相互シフトとして宣言済み) ----
    {
        const h = harness('naginata', 'jis');
        h.hit('KeyF', 'f');
        await tick();
        ok(h.lastText() === 'か', `[9] 薙刀式 F 単打 → "か" (got ${JSON.stringify(h.lastText())})`);
        h.hit('Space', ' ');
        await tick();
        ok(h.lastKind() === 'focus' && h.lastText() === 'か!',
           `[9b] 薙刀式 space 単打 = 変換のまま (got ${JSON.stringify(h.lastText())})`);
        ok(h.log.commits.length === 0, '[9c] 薙刀式でも Space は確定しない');
        // 相互シフト (時間窓ではない) の再確認: space 押しっぱ + E = レイヤ (sleep 無しで成立)
        const h2 = harness('naginata', 'jis');
        h2.fep.feed({ code: 'Space', key: ' ', repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
        h2.fep.feed({ code: 'KeyE', key: 'e', repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
        h2.fep.feedUp({ code: 'KeyE', key: 'e', repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
        h2.fep.feedUp({ code: 'Space', key: ' ', repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
        await tick();
        ok(h2.lastText() === 'り', `[9d] 薙刀式 space+E レイヤ → "り" (got ${JSON.stringify(h2.lastText())})`);
        ok(h2.log.commits.length === 0, '[9e] レイヤ打鍵でスペースは入らない');
    }

    // ---- [10] Shift+Space = 前候補 (hechima v0.18.0。engine 挿し時にも効くのが修正点) ----
    // 旧版は engine 由来の insertSpace:shifted を素の convert = 次候補に落としていた。
    // 候補 2 個だと prev と next が同じ表示に着地して差が出ないので、ここは 3 候補で縛る。
    {
        const conv3 = (yomi) => Promise.resolve([{ key: yomi, candidates: [yomi + '1', yomi + '2', yomi + '3'] }]);
        const h = harness('azik', 'us', conv3);
        h.type('kyouha');
        await tick();
        const yomi = h.lastText();
        h.hit('Space', ' '); await tick();            // 第 1 候補
        h.hit('Space', ' '); await tick();            // 第 2 候補
        ok(h.lastText() === yomi + '2', `[10] 前提: 第 2 候補まで進む (got ${JSON.stringify(h.lastText())})`);
        h.hit('Space', ' ', true); await tick();      // Shift+Space = 前候補 (旧版はここで第 3 候補へ進んだ)
        ok(h.lastKind() === 'focus' && h.lastText() === yomi + '1',
           `[10b] 候補選択中の Shift+Space = 前候補 (got ${JSON.stringify(h.lastText())})`);
        ok(h.log.commits.length === 0, '[10c] 前候補で確定しない');
    }

    // ---- [11] Shift+英字 = 英字合成 (hechima v0.17.0。engine 挿し時にも効くのが修正点) ----
    // Shift+A は engine へ回さず英字として合成する。見た目のよみは旧版も "A" になるが、旧版は
    // 英字と知らないまま Mozc へ投げていた (かな漢字変換に回る)。ここは「Space を打っても
    // 変換に回らない」で縛る = 英字合成として扱われている証拠。
    {
        const h = harness('tsuki2-263');
        h.hit('KeyA', 'A', true);
        await tick();
        ok(h.lastText() === 'A', `[11] Shift+A → 英字 "A" を合成 (got ${JSON.stringify(h.lastText())})`);
        h.hit('Space', ' ');
        await tick();
        ok(h.lastText() === 'A',
           `[11b] 英字合成中の Space は変換に回さない (got ${JSON.stringify(h.lastText())})`);
        h.hit('Enter', 'Enter');
        await tick();
        ok(h.log.commits.join('') === 'A', `[11c] Enter で "A" 確定 (got ${JSON.stringify(h.log.commits)})`);
    }

    console.log(fails ? `\nFAIL — ${fails} 件` : '\nPASS — Space の意味論 全チェック通過');
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
