#!/usr/bin/env node
// remote_check.js — リモートキーボード (web/remote/) をヘッドレス Chromium の 2 ページで確かめる。
//
// 受け手 = QuuBee のページ、送り手 = /remote/#r=<部屋> (別のブラウザコンテキスト = 別の端末の代わり)。
// 中継は tools/devserver.js の代役 (/api/pair)。受け手の qbDebug.keys() (キー押下の合流点の中身) を見て、
//   0. 物理キーボードも合流点を通る (左右 Shift の片方を離しても押したまま)
//   1. つながる (中継 → WebRTC DataChannel)
//   2. PC-98 固有キー (XFER) が押している間だけ届く
//   3. CAPS は機械式ロック (1 回目で押し下げたまま・2 回目で離す)
//   4. SHIFT の単独タップ = 次の 1 打だけ押したまま (ラッチ)
//   5. キーボードを読み込み直すと、押していたキーが離れ、つなぎ直す
//   6. QuuBee を読み込み直しても、覚えた部屋でつなぎ直す (キーボード側は何もしない)
//   7. キーボードを閉じると、押していたキーが離れる
//   8. FEP (段階 A): CTRL+XFER で ON/OFF・ON の間は文字キーを FEP が飲む・ファンクションキーとカナロック中は素通し
// **見えないもの**: 同じ機械の中の 2 ページなので、2 台が同じ Wi-Fi で直結できるか (mDNS・クライアント分離) と
// 本番の中継 (relay/worker.js) は実機でしか分からない。
//
// 準備: playwright-core (PW_DIR でその node_modules の親を指す)・開発サーバ (node tools/devserver.js 8080)
// 使い方: PW_DIR=<dir> node tools/browser/remote_check.js
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.PW_DIR || '.', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.env.OUT || '/tmp/qb_remote_check';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || (() => {
  const base = path.join(process.env.HOME, '.cache', 'ms-playwright');
  const d = fs.readdirSync(base).find((n) => n.startsWith('chromium_headless_shell-'));
  return path.join(base, d, 'chrome-linux', 'headless_shell');
})();

let fails = 0;
const ok = (cond, name, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + JSON.stringify(detail)}`);
  if (!cond) fails++;
};

async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errs.push(`${tag} pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`${tag} console: ${m.text()}`); });
  };
  const hostCtx = await b.newContext({ viewport: { width: 1200, height: 760 } });
  const kbdCtx = await b.newContext({ viewport: { width: 1180, height: 400 }, hasTouch: false });
  let host = await hostCtx.newPage();
  watch(host, 'host');
  await host.goto(`${BASE}/?cb=${Date.now()}`);
  await host.waitForFunction(() => window.qbDebug && window.qbDebug.remote);
  // 0. 物理キーボードもキー押下の合流点を通る。左右 Shift は同じ NKEY 0x70 で、片方を離しても押したまま
  await host.evaluate(() => { const n = document.getElementById('notice-modal'); if (n) n.hidden = true; });
  await host.click('#screen');
  await host.keyboard.down('ShiftLeft');
  await host.keyboard.down('ShiftRight');
  await host.keyboard.up('ShiftLeft');
  const k0 = await host.evaluate(() => window.qbDebug.keys());
  ok(JSON.stringify(k0['0x70']) === JSON.stringify(['kbd:ShiftRight']), '0. 左右 Shift の片方を離しても押したまま', k0);
  await host.keyboard.up('ShiftRight');
  const k1 = await host.evaluate(() => window.qbDebug.keys());
  ok(!k1['0x70'], '0. 両方離すと離れる', k1);
  await host.keyboard.down('z');
  const k2 = await host.evaluate(() => window.qbDebug.keys());
  ok(JSON.stringify(k2['0x29']) === JSON.stringify(['kbd:KeyZ']), '0. Z は kbd:KeyZ として届く', k2);
  await host.keyboard.up('z');
  // 起動時の告知モーダルの上からでも押せるよう、ボタンは JS で押す
  await host.evaluate(() => document.getElementById('remote-toggle').click());
  const room = await host.evaluate(() => window.qbDebug.remote().room);
  ok(/^[A-Za-z0-9_-]{16,}$/.test(room || ''), '部屋ができる', room);
  const qr = await until(() => host.evaluate(() => !!document.querySelector('#remote-qr svg')), 5000);
  ok(qr, 'QR が描かれる', qr);
  await host.screenshot({ path: `${OUT}/host_modal.png` });

  let kbd = await kbdCtx.newPage();
  watch(kbd, 'kbd');
  const kbdUrl = `${BASE}/remote/#r=${room}`;
  await kbd.goto(kbdUrl);
  const keys = () => host.evaluate(() => window.qbDebug.keys());
  const peersOpen = () => host.evaluate(() => window.qbDebug.remote().peers.filter((p) => p.state === 'open').length);
  const kstat = () => kbd.evaluate(() => window.qbRemoteKeyboard && window.qbRemoteKeyboard.status());

  ok(await until(async () => (await kstat()) === 'open'), '1. キーボードがつながる', await kstat());
  ok(await until(async () => (await peersOpen()) === 1), '1. 受け手から 1 台見える', await peersOpen());
  await kbd.screenshot({ path: `${OUT}/kbd_open.png` });

  const keyEl = (nkey, nth = 0) => kbd.locator(`.key[data-k="${nkey}"]`).nth(nth);
  async function downOn(nkey, nth = 0) {
    const bb = await keyEl(nkey, nth).boundingBox();
    await kbd.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await kbd.mouse.down();
  }
  const up = () => kbd.mouse.up();
  async function tap(nkey, nth = 0) { await downOn(nkey, nth); await kbd.waitForTimeout(60); await up(); }
  const has = async (hex) => !!(await keys())[hex];

  // 2. XFER (0x35)
  await downOn(0x35);
  ok(await until(() => has('0x35'), 3000), '2. XFER を押すと届く', await keys());
  await up();
  ok(await until(async () => !(await has('0x35')), 3000), '2. XFER を離すと離れる', await keys());

  // 3. CAPS (0x71) の機械式ロック
  await tap(0x71);
  await kbd.waitForTimeout(300);
  ok(await has('0x71'), '3. CAPS 1 回目 = 押し下げたまま', await keys());
  await kbd.screenshot({ path: `${OUT}/kbd_caps.png` });
  await tap(0x71);
  ok(await until(async () => !(await has('0x71')), 3000), '3. CAPS 2 回目 = 離れる', await keys());

  // 4. SHIFT (0x70) のラッチ → A (0x1d) の 1 打で外れる
  await tap(0x70);
  await kbd.waitForTimeout(300);
  ok(await has('0x70'), '4. SHIFT の単独タップ = 押したまま', await keys());
  await downOn(0x1d);
  ok(await until(() => has('0x1d'), 3000), '4. ラッチ中に A が届く', await keys());
  ok(await has('0x70'), '4. A を押している間も SHIFT はそのまま', await keys());
  await up();
  ok(await until(async () => !(await has('0x70')) && !(await has('0x1d')), 3000), '4. A を離すと SHIFT も外れる', await keys());

  // 5. キーボードの読み込み直し (CAPS を倒したまま)
  await tap(0x71);
  ok(await until(() => has('0x71'), 3000), '5. CAPS を倒す', await keys());
  await kbd.reload();
  ok(await until(async () => !(await has('0x71')), 8000), '5. 読み込み直すと押していたキーが離れる', await keys());
  ok(await until(async () => (await kstat()) === 'open', 15000), '5. キーボードがつなぎ直す', await kstat());
  ok(await until(async () => (await peersOpen()) === 1, 5000), '5. 受け手から 1 台のまま', await host.evaluate(() => window.qbDebug.remote()));

  // 6. QuuBee の読み込み直し
  await host.reload();
  await host.waitForFunction(() => window.qbDebug && window.qbDebug.remote);
  const room2 = await host.evaluate(() => window.qbDebug.remote().room);
  ok(room2 === room, '6. 部屋を覚えている', room2);
  ok(await until(async () => (await peersOpen()) === 1, 15000), '6. モーダルを開かずにつなぎ直す', await host.evaluate(() => window.qbDebug.remote()));
  ok(await until(async () => (await kstat()) === 'open', 5000), '6. キーボード側も open', await kstat());
  await tap(0x35);
  await downOn(0x51);   // NFER
  ok(await until(() => has('0x51'), 3000), '6. つなぎ直した後も届く (NFER)', await keys());

  // 8. FEP (段階 A): CTRL+XFER で ON/OFF・ON の間は文字キーを FEP が飲む・ファンクションキーとカナロック中は素通し
  await up();                                            // 6 の NFER を離す
  await until(async () => !(await has('0x51')), 3000);
  const fepOn = () => host.evaluate(() => document.getElementById('fep-toggle').classList.contains('on'));
  const holdCheck = async (nkey, hex) => { await downOn(nkey); await kbd.waitForTimeout(250); const v = await has(hex); await up(); await kbd.waitForTimeout(150); return v; };
  ok(!(await fepOn()), '8. FEP は OFF から', await fepOn());
  await tap(0x74); await tap(0x35);                       // CTRL のラッチ + XFER = CTRL+XFER
  ok(await until(fepOn, 3000), '8. CTRL+XFER で FEP が ON', await fepOn());
  ok(!(await has('0x35')) && !(await has('0x74')), '8. CTRL+XFER はゲストへ送らない', await keys());
  ok(await holdCheck(0x62, '0x62'), '8. FEP ON (未確定なし): f·1 はゲストへ届く (FEP が飲まない)');
  ok(!(await holdCheck(0x24, '0x24')), '8. FEP ON: K はゲストへ行かない (FEP が飲む)');
  await tap(0x1c);                                       // RETURN = 確定 (未確定を残さない)
  await tap(0x72);                                       // カナを倒す
  ok(await holdCheck(0x24, '0x24'), '8. カナロック中は FEP を通さず K がゲストへ (半角カナ)');
  await tap(0x72);                                       // カナを起こす
  await tap(0x74); await tap(0x35);
  ok(await until(async () => !(await fepOn()), 3000), '8. もう一度 CTRL+XFER で OFF', await fepOn());
  ok(await holdCheck(0x24, '0x24'), '8. FEP OFF: K はゲストへ届く');
  await downOn(0x51);                                    // 7 の準備: NFER を押したまま

  // 7. NFER を押したままキーボードを閉じる
  await kbd.close();
  ok(await until(async () => !(await has('0x51')), 10000), '7. キーボードを閉じると押していたキーが離れる', await keys());
  ok(await until(async () => (await peersOpen()) === 0, 10000), '7. 受け手から消える', await host.evaluate(() => window.qbDebug.remote()));

  const remoteKeys = Object.values(await keys()).flat().filter((s) => s.startsWith('remote:'));
  ok(remoteKeys.length === 0, '後始末: リモート由来の押下が残らない', remoteKeys);
  const realErrs = errs.filter((e) => !/favicon|404/.test(e));
  if (realErrs.length) console.log('ページのエラー:\n  ' + realErrs.join('\n  '));
  console.log(fails ? `\n${fails} 件 FAIL` : '\n全 PASS');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
