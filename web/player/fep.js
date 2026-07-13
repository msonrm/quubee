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
//   cb.hostKey(name)   ゲスト (PC-98) へ実キーを 1 打注入する (name = 'ArrowLeft' 等の
//                      KeyboardEvent.code 名)。薙刀式の編集キー (T/Y=カーソル・U=BS) を
//                      バッファが空のときに実カーソル/BS へ橋渡しするための口。省略可。
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
        '-':'ー', ',':'、', '.':'。', '[':'「', ']':'」', '?':'？', '!':'！', '/':'・',
    };
    // バッファが空のときに押された句読点・記号の即確定表 (実 IME の「句読点は即確定」)。
    // 文中 (composing) は ROMAJI 経由で同じ全角になる。数字・その他記号は従来どおり
    // ゲストへ透過 (VZ のコマンド操作等を邪魔しない)。
    const DIRECT_COMMIT = {
        '.':'。', ',':'、', '?':'？', '!':'！', '[':'「', ']':'」', '-':'ー', '/':'・',
    };
    // engine (新配列) 経路で「編集・カーソル移動・確定の実キー」を二重経路にするための集合。
    // composing 中 = engine のバッファ操作 / composing 空 = ゲストへ実キー透過 (PC-98 カーソル/改行)。
    // Space は naginata で入力キー (SandS) なので **含めない**。
    const HOST_NAV_KEYS = new Set([
        'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'Home', 'End', 'PageUp', 'PageDown', 'Enter', 'Tab', 'Escape',
    ]);
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

    // フォールバック変換 (Mozc 未ロード/失敗時): よみ全体を 1 文節、候補 = カタカナ/ひらがな。
    function fallbackConvert(yomi) {
        const kata = toKatakana(yomi);
        return [{ key: yomi, candidates: (kata !== yomi) ? [kata, yomi] : [yomi] }];
    }

    function createFep(cb) {
        // cb.convert(yomi) → Promise<[{key, candidates:[...]}] | null> (省略/null = フォールバック)。
        // Mozc-Wasm (bridge.js の mozc-worker RPC) がここに注入される。
        let active = false;   // FEP モード (トグルキー/ボタン/qbDebug.fep)
        let kana = '';        // 解決済みかな
        let pend = '';        // 未解決ローマ字
        let segs = null;      // 変換中: [{key, candidates, idx}] (null = よみ入力中)
        let focus = 0;        // 注目文節 index
        let genId = 0;        // 変換の世代。編集/確定/取消で ++ → in-flight な結果を無効化

        const composing = () => (kana + pend).length > 0;
        const clear = () => { kana = ''; pend = ''; segs = null; focus = 0; genId++; };
        const backToYomi = () => { segs = null; focus = 0; genId++; };

        function render() {
            if (segs) {
                cb.show(segs.map((s, i) =>
                    ({ text: s.candidates[s.idx], kind: (i === focus) ? 'focus' : 'other' })));
            } else if (composing()) {
                cb.show([{ text: kana + pend, kind: 'yomi' }]);
            } else {
                cb.hide();
            }
        }

        const joined = () => segs.map((s) => s.candidates[s.idx]).join('');

        function commit(text) {
            clear();
            cb.commit(text);   // 呼び元が hide → 注入の順で処理
        }

        // 変換開始 (Space 初回)。cb.convert は非同期 (Mozc worker RPC) なので、結果到着時に
        // 世代とよみが変わっていないことを確認してから候補モードへ入る (途中で打鍵/取消して
        // いたら結果は捨てる)。実機 FEP は同期だったが、変換は 2〜45ms なので体感差はない。
        function startConvert() {
            const r = resolve(kana, pend, true);
            kana = r.kana; pend = '';
            render();                       // flush 後のよみを表示したまま結果を待つ
            const yomi = kana;
            const gen = ++genId;
            Promise.resolve(cb.convert ? cb.convert(yomi) : null).then((result) => {
                if (gen !== genId || !composing() || kana !== yomi) return;   // 打鍵等で無効化済み
                if (!result || !result.length) result = fallbackConvert(yomi);
                segs = result.map((s) => ({
                    key: s.key,
                    candidates: (s.candidates && s.candidates.length) ? s.candidates : [s.key],
                    idx: 0,
                }));
                focus = 0;
                render();
            }).catch(() => { /* 変換失敗 = よみ表示のまま (正直な失敗) */ });
        }

        // ---- 新配列 (keymap-format) エンジン経路 ------------------------------------
        // bridge が setEngine で KeymapEngine の InputEngine を注入すると、Phase 1 (物理キー→かな)
        // をエンジンへ委譲する。Phase 2 (Mozc 候補) は内蔵経路と同じ segs 機構をそのまま使う。
        // エンジンは「キー→かな」だけを担い、確定かな (takeConfirmedText) を fep が Mozc へ流す。
        // SandS (naginata の space=シフト / 単打=convert) は keyup と窓満了 (onStateChange) で決まる
        // ので engineUp と pumpEngine の両方から状態を汲む。OS リピートは chord を壊すため破棄。
        let engine = null;         // InputEngine | null (null = 内蔵ローマ字リゾルバ)
        let engineKeyOf = null;    // (tap) => KeyEvent | null (KeymapEngine.keyEventFromBrowser)

        // エンジンの現状態を fep 表示/変換へ反映。onStateChange (chord 窓満了) と各打鍵後に呼ぶ。
        function pumpEngine() {
            if (!engine || segs) return;                 // Phase 2 中は反映しない
            const confirmed = engine.takeConfirmedText();
            if (confirmed) {
                if (engine.getState().inputMode === 'english') {
                    cb.commit(confirmed);                // 英字モードの確定は Mozc を通さず直接注入
                    return;
                }
                kana += confirmed; pend = '';            // 確定かな → fep の変換前バッファへ
                startConvert();                          // → Mozc → segs (Phase 2)
                return;
            }
            const st = engine.getState();
            if (st.isComposing) {
                cb.show([{ text: st.composingKana + st.pendingDisplay, kind: 'yomi' }]);
            } else if (!(kana || pend)) {
                cb.hide();
            }
        }

        // Phase 2 (Mozc 候補表示中) のキー操作。内蔵経路の segs 分岐と同義。engine 経路は取消を
        // 全クリアに倒す (よみを engine と共有しないため、部分取消の中間状態を作らない)。
        function navCandidates(tap) {
            const k = tap.key;
            if (k === 'Enter')     { commit(joined()); return true; }
            if (k === 'Escape' || k === 'Backspace') { clear(); engine.reset(); cb.hide(); return true; }
            if (k === ' ')         { const s = segs[focus]; s.idx = (s.idx + 1) % s.candidates.length; render(); return true; }
            if (k === 'ArrowLeft' || k === 'ArrowRight') {
                if (segs.length > 1) focus = (focus + (k === 'ArrowRight' ? 1 : segs.length - 1)) % segs.length;
                render(); return true;
            }
            if (k === 'ArrowUp' || k === 'ArrowDown') {
                const s = segs[focus]; s.idx = (s.idx + (k === 'ArrowDown' ? 1 : s.candidates.length - 1)) % s.candidates.length;
                render(); return true;
            }
            commit(joined());          // その他キー = 現候補を確定してから…
            return engineDown(tap);    // …その打鍵で新しい合成を始める
        }

        // 薙刀式など chord 配列が発火する編集/移動アクション (specialAction) を二重経路へ橋渡し。
        // engine 単体は moveLeft/moveRight を confirmComposition に、deleteBack を自前バッファ削除に
        // 倒すだけで「ホスト側の文書 (= PC-98 ゲスト画面) の編集」を表現できない。そこで bridge が
        // setEngine 経由で engine.chordBuffer.onSpecialAction を本関数に配線し、ここで横取りする。
        //   Phase 2 (Mozc 候補中) → 文節フォーカス移動 / 取消
        //   変換前よみを engine が保持中 → deleteBack だけ engine 既定 (composingKana 削除) へ委ねる
        //   空バッファ → ゲストへ実キー注入 (cb.hostKey: カーソル/BS)
        // 戻り値 true = 横取りした (engine 既定を走らせない)。false = engine 既定へ流す。
        function handleEngineAction(action) {
            const t = action && action.type;
            if (t !== 'moveLeft' && t !== 'moveRight' && t !== 'deleteBack') return false;
            if (segs) {                                     // Phase 2 (候補表示中)
                if (t === 'deleteBack') { clear(); if (engine) engine.reset(); cb.hide(); return true; }
                if (segs.length > 1) focus = (focus + (t === 'moveRight' ? 1 : segs.length - 1)) % segs.length;
                render();
                return true;
            }
            if (engine && engine.getState().isComposing) { // 変換前よみを engine が保持中
                if (t === 'deleteBack') return false;       // engine の handleDeleteBack に委ねる
                return true;                                // moveLeft/moveRight は飲む (よみ中はカーソル無し)
            }
            // 空 = ゲスト (PC-98) へ実キー注入 (カーソル移動 / BS)。
            if (cb.hostKey) {
                cb.hostKey(t === 'deleteBack' ? 'Backspace'
                    : (t === 'moveRight' ? 'ArrowRight' : 'ArrowLeft'));
            }
            return true;
        }

        // engine 経路の keydown。true = 飲んだ (ゲストへ送らない・bridge が preventDefault)。
        function engineDown(tap) {
            if (segs) return navCandidates(tap);                        // Phase 2
            if (tap.ctrlKey || tap.altKey || tap.metaKey) return false; // Ctrl 等コンボは透過
            if (tap.repeat) return true;                               // OS リピート破棄 (chord/SandS 保護)
            const composingNow = engine.getState().isComposing;
            // 編集/移動/確定の実キーは二重経路: composing 空ならゲストへ実キー (PC-98 カーソル/改行)。
            if (!composingNow && HOST_NAV_KEYS.has(tap.code)) return false;
            const kev = engineKeyOf ? engineKeyOf(tap) : null;
            if (!kev) return false;                                    // HID 変換表外 → ゲストへ透過
            engine.processKey(kev);
            pumpEngine();
            return true;
        }

        // engine 経路の keyup。SandS の単打 convert はここ (processKeyUp) で発火する。
        function engineUp(tap) {
            if (tap.ctrlKey || tap.altKey || tap.metaKey) return false;
            const kev = engineKeyOf ? engineKeyOf(tap) : null;
            if (kev) { engine.processKeyUp(kev); pumpEngine(); }
            return false;   // keyup は消費表明不要 (飲んだ keydown はゲストの pressed に未登録)
        }

        // keydown 1 個を消費する。戻り値 true = FEP が飲んだ (ゲストへ送らない)。
        // e は KeyboardEvent 互換 ({key, ctrlKey, altKey, metaKey} を読む)。
        function feed(e) {
            if (!active) return false;
            if (engine) return engineDown(e);                       // 新配列: Phase 1 を engine へ委譲
            if (e.ctrlKey || e.altKey || e.metaKey) return false;   // 修飾コンボは常に透過
            const k = e.key;

            if (k === 'Enter') {
                if (!composing()) return false;
                commit(segs ? joined() : resolve(kana, pend, true).kana);
                return true;
            }
            if (k === 'Escape') {
                if (!composing()) return false;
                if (segs) backToYomi();     // 候補 → よみへ戻す
                else clear();
                render();
                return true;
            }
            if (k === 'Backspace') {
                if (!composing()) return false;
                if (segs) backToYomi();     // 候補 → よみへ戻す
                else if (pend) pend = pend.slice(0, -1);
                else kana = Array.from(kana).slice(0, -1).join('');
                render();
                return true;
            }
            if (k === ' ') {
                if (!composing()) return false;             // 空なら Space はゲストへ
                if (segs) {                                 // 注目文節の次候補
                    const s = segs[focus];
                    s.idx = (s.idx + 1) % s.candidates.length;
                    render();
                } else {
                    startConvert();
                }
                return true;
            }
            if (k === 'ArrowLeft' || k === 'ArrowRight') {
                if (!composing()) return false;             // 空なら矢印はゲストへ
                if (segs && segs.length > 1) {              // 注目文節の移動
                    focus = (focus + (k === 'ArrowRight' ? 1 : segs.length - 1)) % segs.length;
                    render();
                }
                return true;                                // よみ中も飲む (従来どおり)
            }
            if (k === 'ArrowUp' || k === 'ArrowDown') {     // 前候補/次候補 (実 FEP の ↑↓)
                if (!composing()) return false;
                if (segs) {
                    const s = segs[focus];
                    const d = (k === 'ArrowDown') ? 1 : s.candidates.length - 1;
                    s.idx = (s.idx + d) % s.candidates.length;
                    render();
                }
                return true;
            }
            // 印字キー (1 文字): 空のときは英字が composition を開始、句読点・記号は
            // 即確定で全角に (DIRECT_COMMIT)、それ以外 (数字等) はゲストへ透過。
            // composing 中は全部バッファへ (記号は ROMAJI の 、。？！「」等に解決、
            // 未知はそのまま)。候補表示中の追加入力は実 FEP と同じく現候補列を確定して
            // から次の入力を始める。
            if (k.length === 1 && k >= ' ' && k <= '~') {
                const ch = k.toLowerCase();
                if (!composing() && !/[a-z]/.test(ch)) {
                    if (DIRECT_COMMIT[ch]) { commit(DIRECT_COMMIT[ch]); return true; }
                    return false;
                }
                if (segs) commit(joined());                 // 候補中の追加入力 = 確定して継続
                pend += ch;
                const r = resolve(kana, pend, false);
                kana = r.kana; pend = r.pend;
                genId++;                                    // in-flight な変換結果は捨てる
                render();
                return true;
            }
            // その他 (Tab/F キー等): composing 中は飲む (実 FEP 同様)、空なら透過
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
            // keyup を消費する。engine (新配列) 経路では processKeyUp へ配線し、SandS の単打 convert が
            // ここで発火する (keyup 必須 — docs/keymap-engine-embedding §5.1)。内蔵ローマ字経路は
            // keyup を使わないので false。
            feedUp(e) { return engine ? engineUp(e) : false; },
            // 新配列エンジンを注入 (bridge が InputEngine と keyEventFromBrowser を渡す)。null = 内蔵。
            setEngine(eng, keyOf) {
                if (engine && engine !== eng) { try { engine.reset(); } catch (_) {} }
                clear(); cb.hide();
                engine = eng || null;
                engineKeyOf = keyOf || null;
                // chord 配列の specialAction (薙刀式 T/Y/U など編集キー) を二重経路へ横取りする。
                // engine 内部ハンドラ (executeAction + onStateChange) は inner として温存し、
                // 横取りしなかったアクション (confirm/cancel/switch/deleteBack合成中…) はそのまま流す。
                const cbuf = engine && engine.chordBuffer;
                if (cbuf && !cbuf._qbHostWrapped) {
                    const inner = cbuf.onSpecialAction;
                    cbuf.onSpecialAction = (action) => {
                        if (handleEngineAction(action)) return;
                        if (inner) inner(action);
                    };
                    cbuf._qbHostWrapped = true;
                }
            },
            pumpEngine,             // engine.onStateChange (chord 窓満了) から呼ぶ
            reset() { clear(); if (engine) { try { engine.reset(); } catch (_) {} } },
        };
    }

    global.qbFepCreate = createFep;
})(typeof window !== 'undefined' ? window : globalThis);
