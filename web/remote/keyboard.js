// リモートキーボード (送り手)。タブレット・スマホに PC-98 のキーボードを出し、押した・離したを
// PC-98 のキーコード (NKEY) のまま QuuBee へ送る。QuuBee 側は KeyboardEvent の翻訳を通さずに
// ゲストへ注ぐので、XFER・NFER・カナ・GRPH・STOP・COPY・HELP・VF1〜5・テンキーの = と , がそのまま届く。
// 接続は link.js (WebRTC DataChannel、SDP だけ中継)。盤面は layouts/<id>.json から描く。
//
// キーの振る舞い:
//   - ふつうのキー: 押している間だけ押下。長押しでオートリピート (送り手が再 down を送る。NP2kai は
//     押下中のキーへの再 down を break+make = 新しいキーストロークとして扱う)。指を滑らせると隣のキーへ移る
//     (カーソル・テンキーで動かすゲーム向け)
//   - SHIFT・CTRL・GRPH: 押しながら他のキーを打てる (マルチタッチ)。単独で短くタップすると次の 1 打だけ
//     押したままになる (ラッチ)。ラッチ中にもう一度タップすると外れる
//   - CAPS・カナ: 実機と同じ機械式ロック。1 回目のタップで押し下げたまま、2 回目で離す
// 回線が開くたびに、押し下げたままのキー (ロック・ラッチ・押している指) を送り直す。
'use strict';

(function () {
    // NP2kai のキー名 → NKEY (core/np2kai/keystat.tbl の s_keyname と同じ)
    const NKEY = (() => {
        const t = {};
        const seq = (start, names) => names.forEach((n, i) => { if (n) t[n] = start + i; });
        seq(0x00, ['ESC', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '^', '\\', 'BS', 'TAB']);
        seq(0x10, ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '@', '[', 'RET', 'A', 'S', 'D']);
        seq(0x20, ['F', 'G', 'H', 'J', 'K', 'L', ';', ':', ']', 'Z', 'X', 'C', 'V', 'B', 'N', 'M']);
        seq(0x30, [',', '.', '/', '_', 'SPC', 'XFER', 'RLUP', 'RLDN', 'INS', 'DEL', 'UP', 'LEFT', 'RIGHT', 'DOWN', 'HOME', 'HELP']);
        seq(0x40, ['[-]', '[/]', '[7]', '[8]', '[9]', '[*]', '[4]', '[5]', '[6]', '[+]', '[1]', '[2]', '[3]', '[=]', '[0]', '[,]']);
        seq(0x50, ['[.]', 'NFER', 'VF1', 'VF2', 'VF3', 'VF4', 'VF5']);
        seq(0x60, ['STOP', 'COPY', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);
        seq(0x70, ['SHIFT', 'CAPS', 'KANA', 'GRPH', 'CTRL']);
        return t;
    })();
    const MODS = new Set([NKEY.SHIFT, NKEY.GRPH, NKEY.CTRL]);
    const LOCKS = new Set([NKEY.CAPS, NKEY.KANA]);
    const REPEAT_DELAY = 500, REPEAT_INTERVAL = 50;
    const LATCH_TAP_MS = 400;
    const KBD_ID_KEY = 'quubee_remote_kbd_id';

    const $ = (id) => document.getElementById(id);
    const board = $('board'), statusEl = $('status'), dotEl = $('dot'), hintEl = $('hint');

    // ---- 押下の状態 (NKEY ごとに「押している理由」の集合。空になったら離す) ----
    const holders = new Map();      // nkey → Set(token)。token = 'p<pointerId>' | 'latch' | 'lock'
    const keyEls = new Map();       // nkey → [要素]
    const ledEls = new Map();       // nkey → [ランプ] (CAPS・カナのロックの表示)
    let link = null;

    const held = (k) => { const s = holders.get(k); return !!s && s.size > 0; };
    function send(msg) { if (link) link.send(msg); }
    function hold(k, token) {
        let s = holders.get(k);
        if (!s) holders.set(k, (s = new Set()));
        if (s.has(token)) return;
        s.add(token);
        if (s.size === 1) { send({ t: 'key', d: 1, k }); if (navigator.vibrate) navigator.vibrate(8); }
        paint(k);
    }
    function unhold(k, token) {
        const s = holders.get(k);
        if (!s || !s.delete(token)) return;
        if (s.size === 0) send({ t: 'key', d: 0, k });
        paint(k);
    }
    function paint(k) {
        const s = holders.get(k) || new Set();
        for (const el of keyEls.get(k) || []) {
            el.classList.toggle('down', [...s].some((t) => t[0] === 'p'));
            el.classList.toggle('locked', s.has('lock'));
            el.classList.toggle('latched', s.has('latch'));
        }
        // 実機の左下のランプ。ロックは機械式なので、ランプも送り手のロックの状態そのもの
        for (const el of ledEls.get(k) || []) el.classList.toggle('on', s.has('lock'));
    }

    // ---- 指 (pointer) ----
    // pointerId → { el, k, kind, t0, used, timer }
    const fingers = new Map();
    const kindOf = (k) => LOCKS.has(k) ? 'lock' : MODS.has(k) ? 'mod' : 'key';

    function keyAt(x, y) {
        const el = document.elementFromPoint(x, y);
        return el && el.closest ? el.closest('.key') : null;
    }

    function startRepeat(f) {
        stopRepeat(f);
        f.timer = setTimeout(function tick() {
            if (fingers.get(f.id) !== f) return;
            send({ t: 'key', d: 1, k: f.k, r: 1 });
            f.timer = setTimeout(tick, REPEAT_INTERVAL);
        }, REPEAT_DELAY);
    }
    function stopRepeat(f) { if (f.timer) clearTimeout(f.timer); f.timer = 0; }

    function press(id, el) {
        const k = +el.dataset.k, kind = kindOf(k);
        const f = { id, el, k, kind, t0: performance.now(), used: false, timer: 0 };
        if (kind === 'lock') {
            // 機械式ロック: 押した瞬間に倒れる / 起きる。指を離しても変わらない
            const s = holders.get(k);
            if (s && s.has('lock')) unhold(k, 'lock'); else hold(k, 'lock');
            fingers.set(id, f);
            return;
        }
        if (kind === 'mod') {
            // ラッチ中のキーをもう一度タップ = 外す (このタップ自体は押下にしない)
            const s = holders.get(k);
            if (s && s.has('latch')) { unhold(k, 'latch'); f.unlatched = true; fingers.set(id, f); return; }
        } else {
            // ふつうのキーが押された = 押さえている修飾キーは「使われた」(ラッチにしない)
            for (const g of fingers.values()) if (g.kind === 'mod') g.used = true;
        }
        fingers.set(id, f);
        hold(k, 'p' + id);
        if (kind === 'key') startRepeat(f);
    }

    function release(id) {
        const f = fingers.get(id);
        if (!f) return;
        fingers.delete(id);
        stopRepeat(f);
        if (f.kind === 'lock' || f.unlatched) return;
        if (f.kind === 'mod' && !f.used && performance.now() - f.t0 < LATCH_TAP_MS) {
            hold(f.k, 'latch');          // 単独の短いタップ = 次の 1 打だけ押したまま
        }
        unhold(f.k, 'p' + id);
        if (f.kind === 'key') {
            // ラッチは次の 1 打 (の解放) で外れる
            for (const k of MODS) {
                const s = holders.get(k);
                if (s && s.has('latch') && ![...fingers.values()].some((g) => g.kind === 'key')) unhold(k, 'latch');
            }
        }
    }

    // 指を滑らせたら隣のキーへ (ふつうのキー同士だけ。修飾・ロックへは移らない、キーの外では今のキーのまま)
    function glide(id, x, y) {
        const f = fingers.get(id);
        if (!f || f.kind !== 'key') return;
        const el = keyAt(x, y);
        if (!el || el === f.el || kindOf(+el.dataset.k) !== 'key') return;
        stopRepeat(f);
        unhold(f.k, 'p' + id);
        f.el = el; f.k = +el.dataset.k; f.t0 = performance.now();
        hold(f.k, 'p' + id);
        startRepeat(f);
    }

    board.addEventListener('pointerdown', (e) => {
        const el = keyAt(e.clientX, e.clientY);
        if (!el) return;
        e.preventDefault();
        try { board.setPointerCapture(e.pointerId); } catch (_) { /* 古いブラウザ */ }
        press(e.pointerId, el);
    });
    board.addEventListener('pointermove', (e) => { if (fingers.has(e.pointerId)) glide(e.pointerId, e.clientX, e.clientY); });
    board.addEventListener('pointerup', (e) => release(e.pointerId));
    board.addEventListener('pointercancel', (e) => release(e.pointerId));
    // BS 連打がダブルタップの拡大に化けるのを止める (へちま言語ラボの /remote/ が実機で踏んだもの)
    board.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
    board.addEventListener('contextmenu', (e) => e.preventDefault());

    // 裏に回ったら指の押下を離す (pointerup が届かないことがある)。ロック・ラッチはそのまま
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) for (const id of [...fingers.keys()]) release(id);
    });

    // ---- 盤面 ----
    function render(layout) {
        board.replaceChildren();
        keyEls.clear();
        ledEls.clear();
        const keys = [], leds = [];
        let W = 0, H = 0;
        for (const b of layout.blocks || []) {
            let y = b.y || 0;
            for (const row of b.rows || []) {
                let x = b.x || 0;
                for (const it of row) {
                    if (it.gap) { x += it.gap; continue; }
                    const k = NKEY[it.k];
                    const w = it.w || 1, h = it.h || 1;
                    if (k !== undefined) keys.push({ it, k, x, y, w, h });
                    else if (Array.isArray(it.led)) leds.push({ it, x, y, w, h });
                    x += w;
                    W = Math.max(W, x); H = Math.max(H, y + h);
                }
                y += 1;
            }
        }
        for (const { it, k, x, y, w, h } of keys) {
            const el = document.createElement('div');
            const kind = it.c || '';
            el.className = 'key' + (kind ? ' ' + kind : '') + (it.s ? '' : ' single') + (it.a === 'c' ? ' center' : '');
            el.dataset.k = k;
            el.dataset.x = x; el.dataset.y = y; el.dataset.w = w; el.dataset.h = h;
            if (it.notch) el.dataset.notch = it.notch;
            const add = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; el.appendChild(s); };
            // 刻印の位置: 記号のキーは左に 2 段 (シフト側が上)・カナは右に 2 段 (シフト側が上)。
            // 英字のキーは英字が左上・カナが下の辺の中央
            if (it.s) add('s', it.s);
            add('l', it.l !== undefined ? it.l : it.k);
            if (it.ks) add('ks', it.ks);
            if (it.kn) add(it.s ? 'kn r' : 'kn', it.kn);
            board.appendChild(el);
            if (!keyEls.has(k)) keyEls.set(k, []);
            keyEls.get(k).push(el);
        }
        for (const { it, x, y, w, h } of leds) {
            const el = document.createElement('div');
            el.className = 'leds';
            el.dataset.x = x; el.dataset.y = y; el.dataset.w = w; el.dataset.h = h;
            for (const name of it.led) {
                const k = NKEY[name];
                if (k === undefined) continue;
                const row = document.createElement('span');
                const dot = document.createElement('i');
                row.append(dot, name === 'KANA' ? 'カナ' : name);
                el.appendChild(row);
                if (!ledEls.has(k)) ledEls.set(k, []);
                ledEls.get(k).push(dot);
            }
            board.appendChild(el);
        }
        board.dataset.w = W; board.dataset.h = H;
        fit();
        for (const k of new Set([...keyEls.keys(), ...ledEls.keys()])) paint(k);
    }

    function fit() {
        const W = +board.dataset.w, H = +board.dataset.h;
        if (!W || !H) return;
        const stage = $('stage');
        const cs = getComputedStyle(stage);
        const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const u = Math.max(8, Math.floor(Math.min(aw / W, ah / H)));
        const gap = Math.max(1, Math.round(u * 0.06));
        board.style.width = (W * u) + 'px';
        board.style.height = (H * u) + 'px';
        board.style.fontSize = Math.max(8, Math.round(u * 0.3)) + 'px';
        for (const el of board.children) {
            el.style.left = (el.dataset.x * u + gap / 2) + 'px';
            el.style.top = (el.dataset.y * u + gap / 2) + 'px';
            el.style.width = (el.dataset.w * u - gap) + 'px';
            el.style.height = (el.dataset.h * u - gap) + 'px';
            // 左下の切り欠き (RETURN の逆 L 字)。指の当たり判定も clip-path に従う
            if (el.dataset.notch) {
                const nx = el.dataset.notch * u, ny = u - gap;
                el.style.clipPath = `polygon(0 0, 100% 0, 100% 100%, ${nx}px 100%, ${nx}px ${ny}px, 0 ${ny}px)`;
            }
        }
        hintEl.hidden = !(innerHeight > innerWidth && u < 36);
    }
    window.addEventListener('resize', fit);

    // ---- 回線 ----
    const STATUS_TEXT = {
        none: 'QuuBee の画面の Remote に出る QR から開いてください。',
        signal: '中継につないでいます…',
        waiting: 'QuuBee 側を待っています。QuuBee のページで Remote を開いてください。',
        connecting: 'QuuBee 側が見つかりました。直接つないでいます…',
        open: 'つながりました。',
        failed: '直接つながりませんでした。2 台が同じ Wi-Fi にいるか確かめてください。',
        replaced: '別のタブでこのキーボードが開かれたので、こちらは切りました。読み込み直すと、こちらに戻ります。',
    };
    function showStatus(s) {
        statusEl.textContent = STATUS_TEXT[s] || s;
        dotEl.className = s;
    }

    let wakeLock = null;
    async function keepAwake(on) {
        try {
            if (on && !wakeLock && navigator.wakeLock && !document.hidden) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => { wakeLock = null; });
            } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
        } catch (_) { /* 使えない環境では何もしない */ }
    }
    let isOpen = false;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && isOpen) keepAwake(true); });

    function kbdId() {
        try {
            const v = localStorage.getItem(KBD_ID_KEY);
            if (QBRemote.isId(v)) return v;
            const n = QBRemote.randomId(12);
            localStorage.setItem(KBD_ID_KEY, n);
            return n;
        } catch (_) { return QBRemote.randomId(12); }
    }

    let layoutId = 'pc98-full';
    function onStatus(s) {
        showStatus(s);
        isOpen = s === 'open';
        keepAwake(isOpen);
        if (isOpen) {
            send({ t: 'hello', v: 1, layout: layoutId });
            // 押し下げたままのキー (ロック・ラッチ・押している指) を送り直す
            for (const [k, s2] of holders) if (s2.size) send({ t: 'key', d: 1, k });
        }
    }

    const fsBtn = $('fullscreen');
    if (document.documentElement.requestFullscreen) {
        fsBtn.hidden = false;
        fsBtn.addEventListener('click', () => {
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else document.documentElement.requestFullscreen().catch(() => {});
        });
    }

    async function main() {
        const want = new URLSearchParams(location.hash.slice(1)).get('l');
        if (want && /^[a-z0-9-]{1,32}$/.test(want)) layoutId = want;
        try {
            const res = await fetch(`layouts/${layoutId}.json`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            render(await res.json());
        } catch (e) {
            statusEl.textContent = `キーボードの定義を読めませんでした (${layoutId}: ${e.message || e})`;
            return;
        }
        const room = QBRemote.roomFromHash();
        if (!room) { showStatus('none'); return; }
        link = QBRemote.connectKeyboard(room, kbdId(), { onStatus, onMessage() {} });
        // 閉じる・離れるときは回線を明示的に閉じる。閉じないと受け手は ICE の時間切れ (数十秒) まで
        // つながったままだと思い、押していたキーも離さない
        window.addEventListener('pagehide', () => { if (link) { link.close(); link = null; } });
        // 戻る・進むのキャッシュから戻ってきたら、閉じた回線を張り直すために読み込み直す
        window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
    }
    main();

    // 検査用 (tools/browser/remote_check.js)
    window.qbRemoteKeyboard = { NKEY, holders, status: () => dotEl.className };
})();
