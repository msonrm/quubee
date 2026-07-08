#!/usr/bin/env node
// 同梱した keymap-engine (labo logical-layout-labo の UMD 単体ビルド) が QuuBee 環境で
// 正しくロード・動作するかを守る回帰。エンジン差し替え (ファイル vendoring) 時の受け入れ検査。
//   - 全配列 (JIS/US × 6) が decodeKeymap + InputEngine 構築できる
//   - 逐次 (ローマ字): "ka" → か
//   - 同時打鍵 (NICOLA): 窓内 2 キーで chord バッファが回りかな系を出す (onStateChange 発火)
// アダプタ/統合の回帰は別途 fep_layout_test で golden を流す。ここは vendored 成果物の健全性のみ。
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web', 'assets');
const K = require(path.join(WEB, 'keymap-engine.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };

ok(K.version === '1.0.0', `engine version = 1.0.0 (got ${K.version})`);

// 1) 全配列が decode + 構築できる (chord フラグも既知配列と一致)
const CHORD = { naginata_jis: true, naginata_us: true, nicola_jis: true, nicola_us: true };
const maps = fs.readdirSync(path.join(WEB, 'keymaps')).filter((f) => f.endsWith('.json') && f !== 'index.json');
ok(maps.length === 12, `配列 JSON = 12 本 (got ${maps.length})`);
for (const f of maps) {
    const name = f.replace('.json', '');
    try {
        const json = JSON.parse(fs.readFileSync(path.join(WEB, 'keymaps', f), 'utf8'));
        const eng = new K.InputEngine(K.decodeKeymap(json));
        const expectChord = !!CHORD[name];
        ok(eng.isChord === expectChord, `decode+construct: ${f} (chord=${eng.isChord})`);
    } catch (e) {
        ok(false, `decode+construct: ${f} — ${e.message}`);
    }
}

const ev = (code, key) => ({ code, key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });

// 2) ローマ字 (逐次): k,a → か
{
    const json = JSON.parse(fs.readFileSync(path.join(WEB, 'keymaps', 'romaji_us.json'), 'utf8'));
    const eng = new K.InputEngine(K.decodeKeymap(json));
    for (const [c, k] of [['KeyK', 'k'], ['KeyA', 'a']]) eng.processKey(K.keyEventFromBrowser(ev(c, k)));
    const st = eng.getState();
    ok((st.composingKana + st.pendingDisplay).includes('か'),
        `romaji_us: "ka" → か (got composing="${st.composingKana}" pending="${st.pendingDisplay}")`);
}

// 3) 同時打鍵 (NICOLA): 窓満了を待ってかな系が出る
async function chord() {
    const json = JSON.parse(fs.readFileSync(path.join(WEB, 'keymaps', 'nicola_us.json'), 'utf8'));
    const eng = new K.InputEngine(K.decodeKeymap(json));
    let changed = 0;
    eng.onStateChange = () => { changed++; };
    eng.processKey(K.keyEventFromBrowser(ev('KeyF', 'f')));
    eng.processKey(K.keyEventFromBrowser(ev('KeyJ', 'j')));
    await new Promise((r) => setTimeout(r, 180));   // 窓 (~100ms) 満了 + 余裕
    const st = eng.getState();
    const shown = st.composingKana + st.pendingDisplay + st.confirmedText;
    ok(/[぀-ヿ]/.test(shown), `nicola_us: F+J → かな系出力 (got "${shown}", onStateChange×${changed})`);
}

chord().then(() => {
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — keymap-engine vendored: ${pass} ok / ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
});
