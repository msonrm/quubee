#!/usr/bin/env node
// 薙刀式の編集キー (T=moveLeft / Y=moveRight / U=deleteBack) の二重経路 回帰。
// labo の keymap-engine が発火する specialAction を fep が横取りし、状態別に振り分ける:
//   空バッファ         → ゲストへ実キー注入 (cb.hostKey: ArrowLeft/ArrowRight/Backspace)
//   Phase 2 (Mozc 候補中) → 文節フォーカス移動 / 取消
//   変換前よみ合成中    → engine 既定 (composingKana 削除)。moveLeft/Right は飲む
//
// Part A: 二重経路のロジックを engine.chordBuffer.onSpecialAction 直叩きで決定的に検証。
// Part B: 実 T 打鍵を fep.feed に通し、naginata JSON の T→moveLeft 割当 + chord 窓 + 配線が
//         end-to-end で「空 → ArrowLeft 注入」まで到達することを確認。
//
// 使い方: node tools/fep_naginata_edit_test.js
const path = require('path');
const fs   = require('fs');

const WEB = path.join(__dirname, '..', 'web');
const qbFepCreate = require(path.join(WEB, 'assets', 'hechima.js')).createFep;   // labo hechima (UMD)
const K = require(path.join(WEB, 'assets', 'keymap-engine.js'));                  // v1.1.0 (onHostAction)

let fails = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) fails++; };
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function harness(convert) {
    const log = { hostKeys: [], commits: [], shows: [], hides: 0 };
    const fep = qbFepCreate({
        show(segments) { log.shows.push(segments); },
        hide() { log.hides++; },
        commit(text) { log.commits.push(text); },
        convert,
        hostKey(name) { log.hostKeys.push(name); },
    });
    const json = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'keymaps', 'naginata_jis.json'), 'utf8'));
    const eng = new K.InputEngine(K.decodeKeymap(json));
    eng.onStateChange = () => fep.pumpEngine();
    fep.setEngine(eng, (tap) => K.keyEventFromBrowser(tap));
    fep.setActive(true);
    // hechima の setEngine が engine.onHostAction を配線済み (v1.1.0 の正式 API)。chord 窓の
    // タイミングに依存せず二重経路ロジックを叩くため、ホスト委譲を直接発火させる。
    // 返り値 = hechima の handleEngineAction の bool (true=横取り / false=engine 既定へ委譲)。
    const fire = (type) => eng.onHostAction({ type });
    const lastShow = () => log.shows[log.shows.length - 1];
    return { fep, eng, log, fire, lastShow };
}

(async () => {
    // ---- Part A1: 空バッファ → ゲストへ実キー ----
    {
        const h = harness(null);
        h.fire('moveLeft');
        ok(h.log.hostKeys.pop() === 'ArrowLeft',  '空 + moveLeft(T) → hostKey ArrowLeft');
        h.fire('moveRight');
        ok(h.log.hostKeys.pop() === 'ArrowRight', '空 + moveRight(Y) → hostKey ArrowRight');
        h.fire('deleteBack');
        ok(h.log.hostKeys.pop() === 'Backspace',  '空 + deleteBack(U) → hostKey Backspace');
        ok(h.log.hostKeys.length === 0, '空: 実キーは 1 打ずつ (余剰注入なし)');
    }

    // ---- Part A2: Phase 2 (Mozc 候補中) → 文節フォーカス移動 / 取消 ----
    {
        const h = harness(() => Promise.resolve([
            { key: 'きょうは', candidates: ['今日は', '京は'] },
            { key: 'はれ',     candidates: ['晴れ', 'ハレ'] },
        ]));
        // chord 入力の代わりに、engine が確定したよみを注入して Phase 2 に入れる
        // (pumpEngine → takeConfirmedText → startConvert → cb.convert)。
        h.eng.confirmedText = 'きょうははれ';
        h.fep.pumpEngine();
        await tick();
        ok(h.lastShow() && h.lastShow().length === 2 && h.lastShow()[0].kind === 'focus',
           `Phase2: 2 文節・先頭 focus (got ${h.lastShow() ? h.lastShow().length : 0} 文節)`);
        h.fire('moveRight');
        ok(h.lastShow()[1].kind === 'focus' && h.lastShow()[0].kind === 'other',
           'Phase2 + moveRight(Y) → 注目文節が右へ');
        ok(h.log.hostKeys.length === 0, 'Phase2: moveRight は実キーを注入しない (バッファ操作)');
        h.fire('moveLeft');
        ok(h.lastShow()[0].kind === 'focus', 'Phase2 + moveLeft(T) → 注目文節が左へ');
        const hidesBefore = h.log.hides;
        h.fire('deleteBack');
        ok(h.log.hides > hidesBefore, 'Phase2 + deleteBack(U) → 取消 (hide)');
        ok(h.log.hostKeys.length === 0, 'Phase2: deleteBack も実キーを注入しない');
    }

    // ---- Part A3: 変換前よみ合成中 → engine 既定へ委譲 (onHostAction が false を返す) ----
    // ※ 直接 onHostAction を叩くので engine 内部の executeAction フォールバック (composingKana
    //   削除そのもの) は走らない。ここで検証するのは QuuBee 側の関心事 =「合成中は委譲を選び
    //   実キーを注入しない」こと。実際の削除は engine (labo golden) の責務。
    {
        const h = harness(null);
        h.eng.composingKana = 'かな';
        ok(h.eng.getState().isComposing, 'setup: engine が composingKana="かな" を保持');
        const rDel = h.fire('deleteBack');
        ok(rDel === false, '合成中 + deleteBack(U) → engine 既定へ委譲 (onHostAction=false)');
        ok(h.log.hostKeys.length === 0, '合成中: deleteBack は実キーを注入しない');
        const rMove = h.fire('moveLeft');
        ok(rMove === true && h.log.hostKeys.length === 0,
           '合成中 + moveLeft(T) → 飲む (onHostAction=true・実キーなし)');
    }

    // ---- Part B: 実 T 打鍵 (end-to-end: naginata JSON T→moveLeft + chord 窓 + 配線) ----
    {
        const h = harness(null);
        const tap = (code, key) => ({ code, key, repeat: false,
            shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
        h.fep.feed(tap('KeyT', 't'));      // T 単打 (chord 窓へ)
        h.fep.feedUp(tap('KeyT', 't'));
        await sleep(220);                  // 同時打鍵窓 (~100ms) 満了を待つ
        ok(h.log.hostKeys.includes('ArrowLeft'),
           `E2E: 空で実 T 打鍵 → moveLeft → hostKey ArrowLeft (got [${h.log.hostKeys.join(',')}])`);
    }

    console.log(fails ? `\nFAIL — ${fails} 件` : '\nPASS — 薙刀式 編集キー 二重経路 全チェック通過');
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
