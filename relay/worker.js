// QuuBee のリモートキーボードの**シグナリング中継** (quubee-relay)。
//
// 別の端末 (タブレット・スマホ) のブラウザに PC-98 のキーボードを出し、そこで押したキーを QuuBee へ
// 送る (web/remote/)。キーは WebRTC DataChannel で端末間を直接流れる (同じ LAN の中)。WebRTC は最初に
// 接続情報 (SDP) を 1 往復だけ交換する必要があり、ブラウザ同士にはその受け渡し役が居ないので、
// ここで部屋ごとに WebSocket をつないで中身を宛先へ流す。
//   - 中継が見るのは SDP だけ。押したキーは中継を通らない
//   - 部屋 = Durable Object 1 個。受け手 (QuuBee) 1 台 + 送り手 (キーボード) 4 台まで。何も保存しない
//   - 部屋の名前は受け手が乱数で作り、QR で送り手に渡す (知らなければ入れない)
//
// 元はへちま言語ラボの /remote/ の中継 (hechima repo worker/index.js、2 人まで)。QuuBee は二人プレイ
// (送り手 2 台) を見込むので、宛先 (to) を持つ形に広げた。規則は tools/devserver.js の代役と同じ。
//
// 接続:   wss://<relay>/api/pair/<room>?role=host|kbd&id=<端末 id>&sid=<ページ読み込みごとの id>
// 中継 →  { t: "peers", list: [{ id, role, sid }] }   入退室のたびに全員へ
// 端末 →  { to: <id>, ... }                         宛先の端末へ { from: <id>, ... } として流す
//
// 同じ id の端末が入り直したら古い接続を閉じる (コード 4001 = 入れ替わった。閉じられた側は再接続しない)。
// 受け手は 1 台だけで、2 台目の受け手も同じ扱い (後から開いたタブが勝つ)。

import { DurableObject } from "cloudflare:workers";

const ROOM_PATH = /^\/api\/pair\/([A-Za-z0-9_-]{16,64})$/;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_KEYBOARDS = 4;
/** 1 メッセージの上限。SDP は数 KB に収まる */
const MAX_MESSAGE = 16 * 1024;
const REPLACED = 4001;

/** つないでよいページ (本番・プレビュー・ローカル開発)。ブラウザは WebSocket にも Origin を付ける */
function allowedOrigin(origin) {
  if (!origin) return false;
  return origin === "https://quubee.pages.dev" ||
    /^https:\/\/[a-z0-9-]+\.quubee\.pages\.dev$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = ROOM_PATH.exec(url.pathname);
    if (!m) return new Response("not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket で接続してください", { status: 426 });
    }
    if (!allowedOrigin(request.headers.get("Origin"))) {
      return new Response("forbidden", { status: 403 });
    }
    const role = url.searchParams.get("role");
    const id = url.searchParams.get("id") || "";
    const sid = url.searchParams.get("sid") || "";
    if ((role !== "host" && role !== "kbd") || !ID.test(id) || !ID.test(sid)) {
      return new Response("bad request", { status: 400 });
    }
    const stub = env.PAIR_ROOM.get(env.PAIR_ROOM.idFromName(m[1]));
    return stub.fetch(request);
  },
};

export class PairRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const id = url.searchParams.get("id");
    const sid = url.searchParams.get("sid");

    // 同じ id の入り直し (読み込み直し) と、2 台目の受け手は古い方を閉じる
    const stale = this.ctx.getWebSockets("id:" + id);
    if (role === "host") stale.push(...this.ctx.getWebSockets("host"));
    const keyboards = this.ctx.getWebSockets("kbd").filter((s) => !stale.includes(s));
    if (role === "kbd" && keyboards.length >= MAX_KEYBOARDS) {
      return new Response("この部屋にはもうキーボードが 4 台つながっています", { status: 409 });
    }
    for (const s of stale) {
      try { s.close(REPLACED, "replaced"); } catch { /* 閉じかけ */ }
    }

    const pair = new WebSocketPair();
    // ハイバネーション API で受ける (待っている間は DO が眠れる)。タグで宛先を引く
    this.ctx.acceptWebSocket(pair[1], [role, "id:" + id]);
    pair[1].serializeAttachment({ id, role, sid });
    this.announce(stale);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MESSAGE) {
      ws.close(1009, "message too large");
      return;
    }
    let m;
    try { m = JSON.parse(message); } catch { return; }
    if (!m || typeof m !== "object" || typeof m.to !== "string" || !ID.test(m.to)) return;
    const me = ws.deserializeAttachment();
    if (!me) return;
    const out = JSON.stringify({ ...m, to: undefined, from: me.id });
    for (const s of this.ctx.getWebSockets("id:" + m.to)) {
      if (s === ws) continue;
      try { s.send(out); } catch { /* 閉じかけ */ }
    }
  }

  webSocketClose(ws) {
    this.announce([ws]);
  }

  webSocketError(ws) {
    this.announce([ws]);
  }

  /** 部屋にいる端末を全員に知らせる (gone = いま抜けた・閉じたソケット。一覧から除く) */
  announce(gone = []) {
    const socks = this.ctx.getWebSockets().filter((s) => !gone.includes(s));
    const list = [];
    for (const s of socks) {
      const a = s.deserializeAttachment();
      if (a) list.push({ id: a.id, role: a.role, sid: a.sid });
    }
    const msg = JSON.stringify({ t: "peers", list });
    for (const s of socks) {
      try { s.send(msg); } catch { /* 閉じかけ。次の announce で数え直される */ }
    }
  }
}
