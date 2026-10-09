// リモートキーボードの接続層 (受け手 = QuuBee のページ / 送り手 = web/remote/ のキーボード)。
//
// 別の端末 (タブレット・スマホ) に出した PC-98 キーボードで押したキーを、WebRTC DataChannel で QuuBee へ
// 直接送る。最初の接続情報 (SDP) の受け渡しだけ、中継 (relay/worker.js。ローカルでは tools/devserver.js の
// 代役) を通す。押したキーは中継を通らない。元はへちま言語ラボの /remote/ (hechima repo site/src/remote/
// link.ts) で、QuuBee は受け手 1 台に送り手を複数つなぐ (二人プレイを見込む) ので宛先付きに広げてある。
//
// 中継の上:   中継 → { t: "peers", list: [{ id, role, sid }] } / 端末 ⇄ { to | from, t: "offer"|"answer", sdp }
//   id  = 端末の id。キーボードは localStorage に覚える (読み込み直しで同じ id = 古い接続が閉じられる)
//   sid = ページの読み込みごとの id。同じ id でも sid が変われば「別の回線」として張り直す
// DataChannel の上 (JSON):
//   送り手 → 受け手  { t: "hello", v: 1, layout }               回線が開いたら最初に 1 通
//   送り手 → 受け手  { t: "key", d: 1|0, k: <NKEY 0-127>, r?: 1 }  押した / 離した (r = オートリピート)
// シグナリングは非トリクル (候補を集め切ってから SDP を 1 通で送る)。受け手が offer、送り手が answer。
'use strict';

(function () {
    const ICE = {
        // 同じ LAN ならホスト候補だけでつながる。STUN は LAN の外側の住所も候補に足すだけで、回線が
        // 中継を通るわけではない (TURN は持たない = 押したキーは必ず端末間を直接流れる)
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    };
    const GATHER_TIMEOUT_MS = 3000;
    const REPLACED = 4001;
    const PROD_RELAY = 'wss://quubee-relay.msonrm.workers.dev';

    function randomId(bytes) {
        const b = crypto.getRandomValues(new Uint8Array(bytes));
        let s = '';
        for (const x of b) s += String.fromCharCode(x);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    const isRoom = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);
    const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s);

    /** 中継の場所。本番 (quubee.pages.dev とプレビュー) は別の Worker、それ以外は同じオリジンの代役 */
    function relayBase() {
        const h = location.hostname;
        if (h === 'quubee.pages.dev' || h.endsWith('.quubee.pages.dev')) return PROD_RELAY;
        return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    }

    /** キーボードのページの URL (部屋はフラグメントに置く = サーバーのログに残らない) */
    function keyboardUrl(origin, room) {
        return `${origin}/remote/#r=${room}`;
    }

    function roomFromHash() {
        const r = new URLSearchParams(location.hash.slice(1)).get('r');
        return isRoom(r) ? r : null;
    }

    function waitGathering(pc) {
        if (pc.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                pc.removeEventListener('icegatheringstatechange', check);
                resolve();
            };
            const check = () => { if (pc.iceGatheringState === 'complete') done(); };
            const timer = setTimeout(done, GATHER_TIMEOUT_MS);
            pc.addEventListener('icegatheringstatechange', check);
        });
    }

    /** DataChannel のメッセージを JSON として読む (形の検査は受け取った側が行う) */
    function parseJson(data, max) {
        if (typeof data !== 'string' || data.length > max) return null;
        try {
            const m = JSON.parse(data);
            return m && typeof m === 'object' ? m : null;
        } catch (_) { return null; }
    }

    /**
     * 中継への WebSocket。切れたら 1 秒から倍々で 10 秒までつなぎ直す。4001 (同じ id が入り直した /
     * 別のタブが受け手になった) で閉じられたらつなぎ直さない。
     */
    function openRelay(room, role, id, sid, h) {
        let ws = null, closed = false, retry = 0;
        function open() {
            if (closed) return;
            const q = `role=${role}&id=${encodeURIComponent(id)}&sid=${encodeURIComponent(sid)}`;
            const s = new WebSocket(`${relayBase()}/api/pair/${room}?${q}`);
            ws = s;
            s.onopen = () => { retry = 0; h.onOpen(); };
            s.onmessage = (ev) => {
                const m = parseJson(ev.data, 32768);
                if (m) h.onMessage(m);
            };
            s.onclose = (ev) => {
                if (ws !== s || closed) return;
                ws = null;
                if (ev.code === REPLACED) { closed = true; h.onReplaced(); return; }
                h.onClose();
                setTimeout(open, Math.min(10000, 1000 * 2 ** retry++));
            };
        }
        open();
        return {
            send(m) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
            close() { closed = true; if (ws) ws.close(); ws = null; },
        };
    }

    /**
     * 受け手 (QuuBee)。部屋に来たキーボードごとに offer を出して DataChannel を張る。
     * handlers: onRelay(state)  'signal' | 'open' | 'replaced'
     *           onPeers(list)   [{ id, state }]  state = 'connecting' | 'open' | 'failed'
     *           onMessage(id, msg) / onPeerClose(id)
     */
    function connectHost(room, handlers) {
        const id = randomId(12), sid = randomId(9);
        const peers = new Map();   // id → { sid, pc, dc, state }
        let present = [];          // 中継にいるキーボード [{ id, sid }]
        let closed = false;

        const report = () => handlers.onPeers([...peers].map(([pid, p]) => ({ id: pid, state: p.state })));

        function drop(pid) {
            const p = peers.get(pid);
            if (!p) return;
            peers.delete(pid);
            if (p.dc) { p.dc.onclose = null; p.dc.close(); }
            p.pc.close();
            if (p.state === 'open') handlers.onPeerClose(pid);
        }

        async function offer(pid, psid) {
            drop(pid);
            const pc = new RTCPeerConnection(ICE);
            const p = { sid: psid, pc, dc: null, state: 'connecting' };
            peers.set(pid, p);
            report();
            pc.onconnectionstatechange = () => {
                if (peers.get(pid) !== p) return;
                if (pc.connectionState === 'failed') {
                    // 回線が死んだ (相手が黙って消えた等)。押していたキーを離させる
                    const wasOpen = p.state === 'open';
                    p.state = 'failed';
                    if (wasOpen) handlers.onPeerClose(pid);
                    report();
                }
            };
            const dc = pc.createDataChannel('quubee', { ordered: true });
            p.dc = dc;
            dc.onopen = () => { p.state = 'open'; report(); };
            dc.onmessage = (ev) => {
                const m = parseJson(ev.data, 1024);
                if (m) handlers.onMessage(pid, m);
            };
            dc.onclose = () => {
                if (peers.get(pid) !== p) return;
                const wasOpen = p.state === 'open';
                peers.delete(pid);
                pc.close();
                if (wasOpen) handlers.onPeerClose(pid);
                report();
                // 中継にまだ居る (= 回線だけ切れた) なら受け手から張り直す
                const e = present.find((x) => x.id === pid);
                if (e && !closed) setTimeout(() => { if (!peers.has(pid) && !closed) offer(pid, e.sid).catch(() => {}); }, 500);
            };
            await pc.setLocalDescription(await pc.createOffer());
            await waitGathering(pc);
            if (peers.get(pid) !== p || !pc.localDescription) return;
            relay.send({ to: pid, t: 'offer', sdp: pc.localDescription.sdp });
        }

        const relay = openRelay(room, 'host', id, sid, {
            onOpen() { handlers.onRelay('open'); },
            onClose() { handlers.onRelay('signal'); },
            onReplaced() { handlers.onRelay('replaced'); },
            onMessage(m) {
                if (m.t === 'peers' && Array.isArray(m.list)) {
                    present = m.list.filter((e) => e && e.role === 'kbd' && isId(e.id) && isId(e.sid));
                    for (const e of present) {
                        const p = peers.get(e.id);
                        // 新顔・読み込み直した (sid が変わった)・つながらなかった → 張り直す
                        if (!p || p.sid !== e.sid || p.state === 'failed') offer(e.id, e.sid).catch(() => {});
                    }
                    // 中継から抜けた端末は、直接の回線が生きていればそのまま使う (iOS が裏で WS を切る等)
                    for (const [pid, p] of [...peers]) {
                        if (p.state !== 'open' && !present.some((e) => e.id === pid)) drop(pid);
                    }
                    report();
                } else if (m.t === 'answer' && isId(m.from) && typeof m.sdp === 'string') {
                    const p = peers.get(m.from);
                    if (p && p.pc.signalingState === 'have-local-offer') {
                        p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => { p.state = 'failed'; report(); });
                    }
                }
            },
        });

        return {
            send(pid, msg) {
                const p = peers.get(pid);
                if (!p || !p.dc || p.dc.readyState !== 'open') return false;
                p.dc.send(JSON.stringify(msg));
                return true;
            },
            close() {
                closed = true;
                for (const pid of [...peers.keys()]) drop(pid);
                relay.close();
            },
        };
    }

    /**
     * 送り手 (キーボード)。受け手からの offer に answer で応える。
     * handlers: onStatus(s)  'signal' (中継へ) | 'waiting' (受け手が居ない) | 'connecting' | 'open' | 'failed' | 'replaced'
     *           onMessage(msg)
     */
    function connectKeyboard(room, id, handlers) {
        const sid = randomId(9);
        let pc = null, dc = null, status = '', hostHere = false;
        const setStatus = (s) => { if (s !== status) { status = s; handlers.onStatus(s); } };
        const live = () => !!dc && dc.readyState === 'open';

        function teardown() {
            if (dc) { dc.onclose = null; dc.close(); }
            if (pc) pc.close();
            dc = null; pc = null;
        }

        async function answer(from, sdp) {
            teardown();
            const p = new RTCPeerConnection(ICE);
            pc = p;
            p.onconnectionstatechange = () => { if (pc === p && p.connectionState === 'failed') setStatus('failed'); };
            p.ondatachannel = (ev) => {
                const ch = ev.channel;
                dc = ch;
                ch.onopen = () => setStatus('open');
                ch.onmessage = (e) => { const m = parseJson(e.data, 4096); if (m) handlers.onMessage(m); };
                ch.onclose = () => {
                    if (dc !== ch) return;
                    teardown();
                    setStatus(hostHere ? 'connecting' : 'waiting');
                };
            };
            setStatus('connecting');
            await p.setRemoteDescription({ type: 'offer', sdp });
            await p.setLocalDescription(await p.createAnswer());
            await waitGathering(p);
            if (pc !== p || !p.localDescription) return;
            relay.send({ to: from, t: 'answer', sdp: p.localDescription.sdp });
        }

        setStatus('signal');
        const relay = openRelay(room, 'kbd', id, sid, {
            onOpen() { if (!live()) setStatus(hostHere ? 'connecting' : 'waiting'); },
            onClose() { if (!live()) setStatus('signal'); },
            onReplaced() { teardown(); setStatus('replaced'); },
            onMessage(m) {
                if (m.t === 'peers' && Array.isArray(m.list)) {
                    hostHere = m.list.some((e) => e && e.role === 'host');
                    if (!live()) {
                        if (!hostHere) { teardown(); setStatus('waiting'); }
                        else if (!pc) setStatus('connecting');
                    }
                } else if (m.t === 'offer' && isId(m.from) && typeof m.sdp === 'string') {
                    answer(m.from, m.sdp).catch(() => setStatus('failed'));
                }
            },
        });

        return {
            send(msg) {
                if (!live()) return false;
                dc.send(JSON.stringify(msg));
                return true;
            },
            close() { teardown(); relay.close(); },
        };
    }

    window.QBRemote = { randomId, isRoom, isId, relayBase, keyboardUrl, roomFromHash, connectHost, connectKeyboard };
})();
