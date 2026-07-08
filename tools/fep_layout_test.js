#!/usr/bin/env node
// 新配列 (keymap-format) アダプタの end-to-end 回帰 — 薙刀式 (SandS chord) 先行。
// fep.js の engine 経路を、同梱 KeymapEngine を実注入して駆動する:
//   キー(tap) → fep.feed/feedUp → engine.processKey/Up → (窓満了 onStateChange) → fep.pumpEngine
//   → 確定かな → fep(Mozc モック) → 候補 → commit(SJIS 注入相当)
// chord 窓 (naginata=80ms) は実タイマーで待つ。Mozc はモック (yomi→[yomi+'!', yomi]) で決定的に。
// 内蔵ローマ字経路のゼロ回帰は fep_test.js / fep_mozc_test.js が別途担保。
const path = require('path');
const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'player', 'fep.js'));            // globalThis.qbFepCreate
const qbFepCreate = globalThis.qbFepCreate;
const K = require(path.join(WEB, 'assets', 'keymap-engine.js'));
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// fep のコールバック (bridge 相当のモック)。show の最後の payload / commit された文字列を捕捉。
let lastShow = null, hidden = true, committed = [];
const cb = {
    show(segs) { lastShow = segs; hidden = false; },
    hide()     { lastShow = null; hidden = true; },
    commit(t)  { committed.push(t); hidden = true; },
    // Mozc モック: よみ 1 文節、候補 = [よみ+'!', よみ] (決定的・第1候補で確定を検証)
    convert(yomi) { return Promise.resolve([{ key: yomi, candidates: [yomi + '!', yomi] }]); },
};
const fep = qbFepCreate(cb);

// naginata_us を実ロードしてエンジン装着
const raw = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'keymaps', 'naginata_us.json'), 'utf8'));
const engine = new K.InputEngine(K.decodeKeymap(raw));
engine.onStateChange = () => fep.pumpEngine();
fep.setEngine(engine, (tap) => K.keyEventFromBrowser(tap));

const tap = (code, key, down, opt = {}) => ({
    down, code, key, repeat: !!opt.repeat, timestamp: 0,
    ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
});
const dn = (code, key, opt) => fep.feed(tap(code, key, true, opt));
const up = (code, key) => fep.feedUp(tap(code, key, false));
const yomiText = () => (lastShow && lastShow.length && lastShow[0].kind === 'yomi') ? lastShow[0].text : null;

function resetAll() { fep.reset(); lastShow = null; hidden = true; committed = []; }

async function main() {
    fep.setActive(true);

    // [1] F 単打 → よみ "か" 表示
    resetAll();
    dn('KeyF', 'f'); up('KeyF', 'f'); await wait(140);
    ok(yomiText() === 'か', `[1] F 単打 → よみ "か" (got ${JSON.stringify(yomiText())})`);

    // [2] F → Space 単打 (SandS convert) → Mozc 候補 → Enter 確定 "か!"
    resetAll();
    dn('KeyF', 'f'); up('KeyF', 'f'); await wait(140);
    dn('Space', ' '); up('Space', ' '); await wait(140);           // 単打 convert は keyup/窓で発火
    await wait(20);                                                // Mozc モック Promise 解決待ち
    ok(lastShow && lastShow[0] && lastShow[0].kind === 'focus',
        `[2a] Space 単打 → Mozc 候補表示 (kind=${lastShow && lastShow[0] && lastShow[0].kind})`);
    ok(lastShow && lastShow[0] && lastShow[0].text === 'か!',
        `[2b] 第1候補 = "か!" (got ${lastShow && lastShow[0] && lastShow[0].text})`);
    const enterConsumed = dn('Enter', 'Enter');
    ok(enterConsumed === true && committed[committed.length - 1] === 'か!',
        `[2c] Enter で "か!" 確定注入 (consumed=${enterConsumed}, committed=${JSON.stringify(committed)})`);

    // [3] SandS レイヤ: Space 押しっぱ + E → よみ "り" (space+E)
    resetAll();
    dn('Space', ' ');           // space 押下 (シフト候補、まだ確定しない)
    dn('KeyE', 'e');            // 窓内に E → space+E レイヤ
    up('KeyE', 'e');
    up('Space', ' ');
    await wait(140);
    ok(yomiText() === 'り', `[3] Space+E レイヤ → よみ "り" (got ${JSON.stringify(yomiText())})`);

    // [4] OS リピートは破棄: idle で F(repeat) を投げても飲むだけで合成しない
    resetAll();
    const r = dn('KeyF', 'f', { repeat: true });
    await wait(20);
    ok(r === true, `[4a] repeat=true の F は飲む (return true, got ${r})`);
    ok(engine.getState().isComposing === false && yomiText() === null,
        `[4b] repeat は engine を進めない (isComposing=${engine.getState().isComposing})`);

    // [5] 二重経路: composing 空で物理 Backspace → ゲストへ透過 (fep は飲まない)
    resetAll();
    const bs = dn('Backspace', 'Backspace');
    ok(bs === false, `[5] 空 composing の Backspace はゲストへ透過 (return false, got ${bs})`);

    // [6] Escape 空 composing → ゲストへ透過 (二重経路)
    resetAll();
    const esc = dn('Escape', 'Escape');
    ok(esc === false, `[6] 空 composing の Escape はゲストへ透過 (return false, got ${esc})`);

    // [7] レイヤ表示中に BS で編集 (composing 中の Backspace は engine が deleteBack)
    resetAll();
    dn('KeyF', 'f'); up('KeyF', 'f'); await wait(140);            // composing "か"
    ok(yomiText() === 'か', `[7a] 前提: composing "か" (got ${JSON.stringify(yomiText())})`);
    const bs2 = dn('Backspace', 'Backspace'); await wait(20);
    ok(bs2 === true, `[7b] composing 中の Backspace は engine が飲む (return true, got ${bs2})`);
    ok(engine.getState().isComposing === false,
        `[7c] deleteBack で composing 空に (isComposing=${engine.getState().isComposing})`);

    // [8] 横展開: 全 6 配列 (US) がアダプタ経由でかなを合成する (chord/逐次 両クラス)。
    // 入力→期待かなは tools 実測値 (単打がかなを出すキー)。convert→Mozc→commit の fep 側配管は
    // [2] で実証済みなので、ここは「アダプタが任意の engine 配列を駆動する」ことに絞る。
    const LAYOUTS = [
        { name: 'naginata_us',       chord: true,  code: 'KeyF', key: 'f', expect: 'か' },
        { name: 'nicola_us',         chord: true,  code: 'KeyW', key: 'w', expect: 'か' },
        { name: 'azik_us',           chord: false, code: 'KeyA', key: 'a', expect: 'あ' },
        { name: 'tsuki2-263_us',     chord: false, code: 'KeyF', key: 'f', expect: 'と' },
        { name: 'romaji_colemak_us', chord: false, code: 'KeyA', key: 'a', expect: 'あ' },
    ];
    for (const L of LAYOUTS) {
        const j = JSON.parse(fs.readFileSync(path.join(WEB, 'assets', 'keymaps', `${L.name}.json`), 'utf8'));
        const eng = new K.InputEngine(K.decodeKeymap(j));
        eng.onStateChange = () => fep.pumpEngine();
        fep.setEngine(eng, (t) => K.keyEventFromBrowser(t));
        resetAll();
        dn(L.code, L.key); up(L.code, L.key); await wait(L.chord ? 140 : 20);
        ok(yomiText() === L.expect, `[8] ${L.name}: ${L.key} → よみ "${L.expect}" (got ${JSON.stringify(yomiText())})`);
    }
    fep.setEngine(null, null);   // 後始末: 内蔵へ戻す

    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — fep_layout (naginata SandS + 全6配列): ${pass} ok / ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
}
main();
