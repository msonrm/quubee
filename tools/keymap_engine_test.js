#!/usr/bin/env node
// 同梱した keymap-engine (labo logical-layout-labo の UMD 単体ビルド) が QuuBee 環境で
// 正しくロード・動作するかを守る回帰。エンジン差し替え (ファイル vendoring) 時の受け入れ検査。
//   - 全配列 7 本が JIS/US 両レイアウトで decodeKeymap + InputEngine 構築できる
//   - 逐次 (ローマ字): "ka" → か
//   - 同時打鍵 (NICOLA): 窓内 2 キーで chord バッファが回りかな系を出す (onStateChange 発火)
//   - レイアウト差: NICOLA の親指キーが US=スペース / JIS=無変換 で切り替わる (v2 の肝)
//   - 版ゲート: keymap-format v1 の JSON はエラーで弾かれる (旧 JSON 置き去りの事故を落とす)
// アダプタ/統合の回帰は別途 fep_layout_test で golden を流す。ここは vendored 成果物の健全性のみ。
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web', 'assets');
const K = require(path.join(WEB, 'keymap-engine.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };

ok(K.version === '2.0.0', `engine version = 2.0.0 (got ${K.version})`);

// 1) 全配列が decode + 構築できる (chord フラグも既知配列と一致)。
// keymap-format v2 から JIS/US は配列でなくレイアウトの選択 = 同じファイルを両方で読めること自体が回帰。
const CHORD = { naginata: true, nicola: true, oyayubi_pyun_1key: true };
const maps = fs.readdirSync(path.join(WEB, 'keymaps')).filter((f) => f.endsWith('.json') && f !== 'index.json');
ok(maps.length === 7, `配列 JSON = 7 本 (got ${maps.length})`);
const loadMap = (name, layout, sink) =>
    K.decodeKeymap(JSON.parse(fs.readFileSync(path.join(WEB, 'keymaps', `${name}.json`), 'utf8')),
        { layout, onDiagnostic: sink });
for (const f of maps) {
    const name = f.replace('.json', '');
    for (const layout of ['jis', 'us']) {
        try {
            // onDiagnostic = 解釈できずに捨てたエントリの報告。同梱配列では 0 件であるべき
            // (1 件でも出たら「書いたのに効かない」が本番で起きる)。
            const diags = [];
            const eng = new K.InputEngine(loadMap(name, layout, (d) => diags.push(d)));
            const expectChord = !!CHORD[name];
            ok(eng.isChord === expectChord && diags.length === 0,
                `decode+construct: ${f} [${layout}] (chord=${eng.isChord}, 診断=${diags.length}件` +
                `${diags.length ? ': ' + diags.map((d) => d.message).join(' / ') : ''})`);
        } catch (e) {
            ok(false, `decode+construct: ${f} [${layout}] — ${e.message}`);
        }
    }
}

const ev = (code, key) => ({ code, key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
const shownOf = (eng) => { const s = eng.getState(); return s.composingKana + s.pendingDisplay + s.confirmedText; };

// 2) ローマ字 (逐次): k,a → か
{
    const eng = new K.InputEngine(loadMap('romaji', 'us'));
    for (const [c, k] of [['KeyK', 'k'], ['KeyA', 'a']]) eng.processKey(K.keyEventFromBrowser(ev(c, k)));
    const st = eng.getState();
    ok((st.composingKana + st.pendingDisplay).includes('か'),
        `romaji: "ka" → か (got composing="${st.composingKana}" pending="${st.pendingDisplay}")`);
}

// 3) 版ゲート: v1 形式 (formatVersion 1.0 / 省略) は明確なエラーで弾かれる。
// 旧 14 本の JSON を消し忘れたまま差し替えた、という事故をここで落とす。
for (const [label, json] of [['formatVersion 1.0', { formatVersion: '1.0', name: 'x' }],
                             ['formatVersion 省略', { name: 'x' }]]) {
    let msg = null;
    try { K.decodeKeymap(json, { layout: 'us' }); } catch (e) { msg = e.message; }
    ok(msg !== null && /formatVersion/.test(msg), `v1 の JSON は拒否される (${label}): ${msg}`);
}

// 4) 同時打鍵 (NICOLA): 窓満了を待ってかな系が出る
async function chord() {
    const eng = new K.InputEngine(loadMap('nicola', 'us'));
    let changed = 0;
    eng.onStateChange = () => { changed++; };
    eng.processKey(K.keyEventFromBrowser(ev('KeyF', 'f')));
    eng.processKey(K.keyEventFromBrowser(ev('KeyJ', 'j')));
    await new Promise((r) => setTimeout(r, 180));   // 窓 (~100ms) 満了 + 余裕
    const shown = shownOf(eng);
    ok(/[぀-ヿ]/.test(shown), `nicola: F+J → かな系出力 (got "${shown}", onStateChange×${changed})`);
}

// 5) レイアウト差 (v2 の肝): NICOLA の holder1 (左親指) は US=スペース / JIS=無変換。
// holder1+S = "あ"。layout を渡し忘れると US で親指シフトが死ぬ (指示書 §1.2) ので、
// 「US はスペースで あ / JIS はスペースでは あ にならず無変換で あ」を両方向から縛る。
async function thumbShift() {
    const press = async (km, codes) => {
        const eng = new K.InputEngine(km);
        for (const [c, k] of codes) eng.processKey(K.keyEventFromBrowser(ev(c, k)));
        await new Promise((r) => setTimeout(r, 180));
        return shownOf(eng);
    };
    const us = await press(loadMap('nicola', 'us'), [['Space', ' '], ['KeyS', 's']]);
    ok(us.includes('あ'), `nicola[us]: Space+S → "あ" (got "${us}")`);

    const jisThumb = await press(loadMap('nicola', 'jis'), [['NonConvert', 'NonConvert'], ['KeyS', 's']]);
    ok(jisThumb.includes('あ'), `nicola[jis]: 無変換+S → "あ" (got "${jisThumb}")`);

    const jisSpace = await press(loadMap('nicola', 'jis'), [['Space', ' '], ['KeyS', 's']]);
    ok(!jisSpace.includes('あ'), `nicola[jis]: Space+S は親指シフトでない (got "${jisSpace}")`);
}

chord().then(thumbShift).then(() => {
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — keymap-engine vendored: ${pass} ok / ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
});
