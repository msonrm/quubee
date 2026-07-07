// HLE FEP — ホスト側 composition 状態機械 (M1: ローマ字→ひらがな + スタブ候補巡回)。
//
// 実 PC-98 の FEP (ATOK/VJE/WX...) と同じ役割分担を再現する:
//   キーをアプリより上流で飲む → 未確定文字列をゲスト画面へインライン描画 →
//   確定 SJIS を通常の入力ストリームへ流す (アプリは確定まで何も知らない)。
// このモジュールは純状態機械で、DOM も emu も知らない。bridge.js が keydown を
// feed() し、コールバックで描画/確定を配線する:
//   cb.show(segments)  segments = [{text, kind}] kind='yomi'(未確定よみ)/'focus'(注目=候補表示中)
//   cb.hide()          表示消去 (バッファが空になった)
//   cb.commit(text)    確定 (呼び元が hide → SJIS 注入の順で処理する)
//
// 変換エンジンは convert() 1 点で差し替え可能に分離してある。M1 のスタブは
// [ひらがな, カタカナ] の巡回のみ (Mozc-Wasm が後日この点に入る)。
// 配列 (キー→かな) も M1 は内蔵ローマ字固定。keymap-format ランタイムは将来
// resolvePend の前段を置換する形で入る。
(function (global) {
    'use strict';

    // ---- ローマ字→ひらがな 標準テーブル ----
    // "n" は単独キー (ん) かつ na/nya... の接頭辞なので「待ち」になる。"nn" は
    // キーにしない (キーにすると konnichiha の nn+i が んい に化ける)。n の解決は
    // resolvePend の専用分岐で行う: nn+母音/y → ん+n○ / nn+子音・末尾 → ん /
    // n+子音 → ん。
    const ROMAJI = {
        a:'あ', i:'い', u:'う', e:'え', o:'お',
        ka:'か', ki:'き', ku:'く', ke:'け', ko:'こ',
        ga:'が', gi:'ぎ', gu:'ぐ', ge:'げ', go:'ご',
        sa:'さ', si:'し', su:'す', se:'せ', so:'そ',
        za:'ざ', zi:'じ', zu:'ず', ze:'ぜ', zo:'ぞ',
        ta:'た', ti:'ち', tu:'つ', te:'て', to:'と',
        da:'だ', di:'ぢ', du:'づ', de:'で', do:'ど',
        na:'な', ni:'に', nu:'ぬ', ne:'ね', no:'の', n:'ん', "n'":'ん',
        ha:'は', hi:'ひ', hu:'ふ', he:'へ', ho:'ほ', fu:'ふ',
        ba:'ば', bi:'び', bu:'ぶ', be:'べ', bo:'ぼ',
        pa:'ぱ', pi:'ぴ', pu:'ぷ', pe:'ぺ', po:'ぽ',
        ma:'ま', mi:'み', mu:'む', me:'め', mo:'も',
        ya:'や', yu:'ゆ', yo:'よ',
        ra:'ら', ri:'り', ru:'る', re:'れ', ro:'ろ',
        wa:'わ', wo:'を', wi:'うぃ', we:'うぇ',
        kya:'きゃ', kyu:'きゅ', kyo:'きょ', kye:'きぇ',
        gya:'ぎゃ', gyu:'ぎゅ', gyo:'ぎょ',
        sha:'しゃ', shi:'し', shu:'しゅ', she:'しぇ', sho:'しょ',
        sya:'しゃ', syu:'しゅ', syo:'しょ',
        ja:'じゃ', ji:'じ', ju:'じゅ', je:'じぇ', jo:'じょ',
        jya:'じゃ', jyu:'じゅ', jyo:'じょ',
        zya:'じゃ', zyu:'じゅ', zyo:'じょ',
        cha:'ちゃ', chi:'ち', chu:'ちゅ', che:'ちぇ', cho:'ちょ',
        tya:'ちゃ', tyu:'ちゅ', tyo:'ちょ',
        dya:'ぢゃ', dyu:'ぢゅ', dyo:'ぢょ',
        tsu:'つ', tsa:'つぁ', tsi:'つぃ', tse:'つぇ', tso:'つぉ',
        tha:'てゃ', thi:'てぃ', thu:'てゅ', the:'てぇ', tho:'てょ',
        dha:'でゃ', dhi:'でぃ', dhu:'でゅ', dhe:'でぇ', dho:'でょ',
        nya:'にゃ', nyu:'にゅ', nyo:'にょ',
        hya:'ひゃ', hyu:'ひゅ', hyo:'ひょ',
        fa:'ふぁ', fi:'ふぃ', fe:'ふぇ', fo:'ふぉ',
        bya:'びゃ', byu:'びゅ', byo:'びょ',
        pya:'ぴゃ', pyu:'ぴゅ', pyo:'ぴょ',
        mya:'みゃ', myu:'みゅ', myo:'みょ',
        rya:'りゃ', ryu:'りゅ', ryo:'りょ',
        va:'ヴァ', vi:'ヴィ', vu:'ヴ', ve:'ヴェ', vo:'ヴォ',   // ゔ は JIS X 0208 に無い → カナ
        qa:'くぁ', qi:'くぃ', qe:'くぇ', qo:'くぉ',
        xa:'ぁ', xi:'ぃ', xu:'ぅ', xe:'ぇ', xo:'ぉ',
        la:'ぁ', li:'ぃ', lu:'ぅ', le:'ぇ', lo:'ぉ',
        xya:'ゃ', xyu:'ゅ', xyo:'ょ', lya:'ゃ', lyu:'ゅ', lyo:'ょ',
        xtu:'っ', xtsu:'っ', ltu:'っ', ltsu:'っ', xwa:'ゎ', lwa:'ゎ',
        '-':'ー', ',':'、', '.':'。', '[':'「', ']':'」',
    };
    // 「待ち」判定用: 全キーの真の接頭辞集合 + "nn" (n の特別待ち)
    const PREFIXES = new Set(['nn']);
    for (const k of Object.keys(ROMAJI)) {
        for (let i = 1; i < k.length; i++) PREFIXES.add(k.slice(0, i));
    }

    const isVowelY = (c) => c !== undefined && 'aiueoy'.includes(c);
    const isCons   = (c) => c !== undefined && /[bcdfghjklmpqrstvwxz]/.test(c);

    // pend (未解決ローマ字) を左から解決して kana に積む。flush=true は確定時
    // (「待ち」を許さず出し切る)。戻り値 = 新しい {kana, pend}。
    function resolve(kana, pend, flush) {
        for (;;) {
            if (!pend) break;
            const exact = Object.prototype.hasOwnProperty.call(ROMAJI, pend);
            const wait  = PREFIXES.has(pend);
            if (!flush && wait) break;                       // 続きを待つ (exact でも延長優先: n など)
            if (exact) { kana += ROMAJI[pend]; pend = ''; break; }
            if (pend[0] === 'n') {
                if (pend[1] === 'n') {
                    if (isVowelY(pend[2])) { kana += 'ん'; pend = pend.slice(1); continue; }  // nn+母音/y → ん + n○
                    kana += 'ん'; pend = pend.slice(2); continue;                             // nn+子音/末尾 → ん
                }
                kana += 'ん'; pend = pend.slice(1); continue;                                 // n+子音 → ん
            }
            if (pend.length >= 2 && pend[0] === pend[1] && isCons(pend[0])) {
                kana += 'っ'; pend = pend.slice(1); continue;                                 // 子音重ね → っ
            }
            kana += pend[0]; pend = pend.slice(1);           // 未知の先頭は素通し (記号/数字)
        }
        return { kana, pend };
    }

    // ひらがな→カタカナ (U+3041..3096 → +0x60)。スタブ候補用。
    function toKatakana(s) {
        let out = '';
        for (const ch of s) {
            const c = ch.codePointAt(0);
            out += (c >= 0x3041 && c <= 0x3096) ? String.fromCodePoint(c + 0x60) : ch;
        }
        return out;
    }

    // M1 スタブ変換: よみ → 候補列。カタカナを先頭に置く (初回変換で見た目が
    // 変わり、属性遷移 yomi→focus と合わせて動作確認しやすい)。Mozc-Wasm は
    // ここを差し替える (候補列を返す同発想の API になる予定)。
    function convert(yomi) {
        const kata = toKatakana(yomi);
        return (kata !== yomi) ? [kata, yomi] : [yomi];
    }

    function createFep(cb) {
        let active = false;   // FEP モード (トグルキー/qbDebug.fep)
        let kana = '';        // 解決済みかな
        let pend = '';        // 未解決ローマ字
        let cands = null;     // 候補列 (null = よみ入力中)
        let candIdx = 0;

        const composing = () => (kana + pend).length > 0;
        const clear = () => { kana = ''; pend = ''; cands = null; candIdx = 0; };

        function render() {
            if (cands)               cb.show([{ text: cands[candIdx], kind: 'focus' }]);
            else if (composing())    cb.show([{ text: kana + pend, kind: 'yomi' }]);
            else                     cb.hide();
        }

        function commit(text) {
            clear();
            cb.commit(text);   // 呼び元が hide → 注入の順で処理
        }

        // keydown 1 個を消費する。戻り値 true = FEP が飲んだ (ゲストへ送らない)。
        // e は KeyboardEvent 互換 ({key, ctrlKey, altKey, metaKey} を読む)。
        function feed(e) {
            if (!active) return false;
            if (e.ctrlKey || e.altKey || e.metaKey) return false;   // 修飾コンボは常に透過
            const k = e.key;

            if (k === 'Enter') {
                if (!composing()) return false;
                commit(cands ? cands[candIdx] : resolve(kana, pend, true).kana);
                return true;
            }
            if (k === 'Escape') {
                if (!composing()) return false;
                if (cands) { cands = null; candIdx = 0; }   // 候補 → よみへ戻す
                else clear();
                render();
                return true;
            }
            if (k === 'Backspace') {
                if (!composing()) return false;
                if (cands) { cands = null; candIdx = 0; }   // 候補 → よみへ戻す
                else if (pend) pend = pend.slice(0, -1);
                else kana = Array.from(kana).slice(0, -1).join('');
                render();
                return true;
            }
            if (k === ' ') {
                if (!composing()) return false;             // 空なら Space はゲストへ
                if (cands) candIdx = (candIdx + 1) % cands.length;   // 次候補
                else {                                      // 変換 (よみを flush してから)
                    const r = resolve(kana, pend, true);
                    kana = r.kana; pend = '';
                    cands = convert(kana); candIdx = 0;
                }
                render();
                return true;
            }
            // 印字キー (1 文字): 空のときは英字だけが composition を開始 (数字・記号は
            // ゲストへ透過 = VZ のコマンド操作を邪魔しない)。composing 中は全部バッファへ
            // (記号は ROMAJI の -、。「」等に解決、未知はそのまま)。候補表示中の追加入力は
            // 実 FEP と同じく現候補を確定してから次の入力を始める。
            if (k.length === 1 && k >= ' ' && k <= '~') {
                const ch = k.toLowerCase();
                if (!composing() && !/[a-z]/.test(ch)) return false;
                if (cands) commit(cands[candIdx]);          // 候補中の追加入力 = 確定して継続
                pend += ch;
                const r = resolve(kana, pend, false);
                kana = r.kana; pend = r.pend;
                render();
                return true;
            }
            // その他 (矢印/Tab/F キー等): composing 中は飲む (実 FEP 同様)、空なら透過
            return composing();
        }

        return {
            get active() { return active; },
            setActive(on) {
                on = !!on;
                if (active && !on && composing()) { clear(); cb.hide(); }   // OFF は未確定を破棄
                active = on;
                return active;
            },
            toggle() { return this.setActive(!active); },
            feed,
            reset() { clear(); },   // 表示は呼び元が消す (リセット時等)
        };
    }

    global.qbFepCreate = createFep;
})(typeof window !== 'undefined' ? window : globalThis);
