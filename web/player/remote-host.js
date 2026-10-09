// リモートキーボードの受け手 (QuuBee のページ側)。
//
// 入力バーの Remote ボタンで QR を出し、別の端末 (タブレット・スマホ) がそれを読むと web/remote/ の
// PC-98 キーボードが開いてつながる。届いた押下・解放は PC-98 のキーコード (NKEY) のまま keyHub
// (bridge.js のキー押下の合流点) へ注ぐ。押した元の名前 = 'remote:<端末 id>'。PC98_KEYMAP の翻訳も、
// 物理キーボードの経路 (FEP・IME 欄・Ctrl ショートカットの除外) も通らない。
//
// - 部屋の名前は localStorage に覚える。一度つないだら、QuuBee を読み込み直しても中継へつなぎ直すので、
//   キーボード側は何もしなくてよい (Stop で止めるまで)
// - QuuBee のモーダル (設定・ビューア等) を開いている間もキーは届く。物理キーボードと違って keyup を
//   取りこぼさないので、止める理由が無い (CAPS・カナのロックを途中で外すほうが害がある)
// - 回線が切れたら、その端末が押していたキーをすべて離す
'use strict';

(function () {
    const STORE_KEY = 'quubee_remote_v1';
    const STATUS = {
        off: ['Off', '止まっています。'],
        signal: ['Connecting', '中継につないでいます…'],
        open: ['Ready', 'キーボードにする端末のカメラで、この QR を読んでください。2 台は同じ Wi-Fi につないでおきます。'],
        replaced: ['Moved', '別のタブで Remote が開かれたので、こちらは止めました。'],
    };
    const PEER_TEXT = { connecting: 'つないでいます…', open: 'つながっています', failed: '直接つながりませんでした (同じ Wi-Fi か確かめてください)' };

    function load() {
        try {
            const v = JSON.parse(localStorage.getItem(STORE_KEY));
            if (v && QBRemote.isRoom(v.room)) return { room: v.room, on: !!v.on };
        } catch (_) { /* storage 不可 */ }
        return { room: null, on: false };
    }
    function save(st) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (_) { /* 同上 */ }
    }

    // route(id, nkey, down, repeat) = 届いたキーの行き先 (bridge.js の remoteRoute: FEP → keyHub)。
    // release(id) = その端末が押していたキーを全部離す。省略時は keyHub へ直接。
    function init({ keyHub, route, release, onModalOpen }) {
        const $ = (id) => document.getElementById(id);
        const btn = $('remote-toggle'), modal = $('remote-modal');
        const qrEl = $('remote-qr'), urlEl = $('remote-url'), statusEl = $('remote-status'), peersEl = $('remote-peers');
        if (!btn || !modal) return null;

        let st = load();
        let link = null, relayState = 'off', peers = [];
        const layouts = new Map();   // id → hello で宣言されたキーボード

        const src = (id) => 'remote:' + id;
        const releasePeer = release || ((id) => keyHub.releaseWhere((s) => s === src(id)));
        const toGuest = route || ((id, k, down, repeat) => (down ? keyHub.down(src(id), k, repeat) : keyHub.up(src(id), k)));

        function onMessage(id, m) {
            if (m.t === 'key') {
                const k = m.k;
                if (!Number.isInteger(k) || k < 0 || k > 0x7f || (m.d !== 0 && m.d !== 1)) return;
                toGuest(id, k, m.d === 1, m.r === 1);
            } else if (m.t === 'hello' && typeof m.layout === 'string' && m.layout.length <= 32) {
                layouts.set(id, m.layout);
                paint();
            }
        }

        function paint() {
            const [en, ja] = STATUS[relayState] || STATUS.off;
            const open = peers.filter((p) => p.state === 'open').length;
            statusEl.textContent = open ? `${open} 台つながっています。` : ja;
            statusEl.dataset.state = open ? 'live' : relayState;
            statusEl.title = en;
            peersEl.replaceChildren();
            peers.forEach((p, i) => {
                const li = document.createElement('li');
                const name = document.createElement('span');
                name.className = 'rp-name';
                name.textContent = `Keyboard ${i + 1}`;
                const sub = document.createElement('span');
                sub.className = 'rp-state ' + p.state;
                const lay = layouts.get(p.id);
                sub.textContent = (PEER_TEXT[p.state] || p.state) + (lay && p.state === 'open' ? ` (${lay})` : '');
                li.append(name, sub);
                peersEl.appendChild(li);
            });
            btn.classList.toggle('on', open > 0);
            $('remote-stop').hidden = !link;
        }

        async function qrOrigin() {
            // ローカル開発 (localhost) のままでは別の端末から開けないので、devserver に LAN の住所を聞く
            if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
                try {
                    const r = await fetch('/api/dev-origin');
                    const j = await r.json();
                    if (j && typeof j.origin === 'string') return j.origin;
                } catch (_) { /* 代役の無いサーバ */ }
            }
            return location.origin;
        }

        async function drawQr(room) {
            const url = QBRemote.keyboardUrl(await qrOrigin(), room);
            urlEl.href = url;
            urlEl.textContent = url;
            const qr = qrcode(0, 'M');
            qr.addData(url);
            qr.make();
            qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        }

        function stopLink() {
            if (!link) return;
            link.close();
            link = null;
            for (const p of peers) releasePeer(p.id);
            keyHub.releaseWhere((s) => s.startsWith('remote:'));
            peers = [];
            relayState = 'off';
        }

        function start() {
            stopLink();
            if (!st.room) st.room = QBRemote.randomId(16);
            st.on = true;
            save(st);
            drawQr(st.room);
            relayState = 'signal';
            link = QBRemote.connectHost(st.room, {
                onRelay(s) {
                    relayState = s;
                    if (s === 'replaced') {
                        for (const p of peers) releasePeer(p.id);
                        link = null; peers = [];
                        keyHub.releaseWhere((x) => x.startsWith('remote:'));
                    }
                    paint();
                },
                onPeers(list) { peers = list; paint(); },
                onPeerClose(id) { releasePeer(id); },
                onMessage,
            });
            paint();
        }

        function stop() {
            stopLink();
            st.on = false;
            save(st);
            paint();
        }

        function openModal() {
            if (!link) start();
            else drawQr(st.room);
            modal.hidden = false;
            if (onModalOpen) onModalOpen();
            paint();
        }
        function closeModal() { modal.hidden = true; }

        btn.addEventListener('click', openModal);
        $('remote-close').addEventListener('click', closeModal);
        $('remote-done').addEventListener('click', closeModal);
        $('remote-stop').addEventListener('click', stop);
        $('remote-renew').addEventListener('click', () => { st.room = QBRemote.randomId(16); start(); });
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        // 一度つないだ部屋は、読み込み直しても中継へつなぎ直す (キーボード側は何もしなくてよい)
        if (st.on && st.room) start();
        else paint();

        return {
            isOpen: () => !modal.hidden,
            close: closeModal,
            state: () => ({ room: st.room, relay: relayState, peers: peers.slice() }),
        };
    }

    window.QBRemoteHost = { init };
})();
