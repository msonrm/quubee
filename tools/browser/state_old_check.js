#!/usr/bin/env node
// state_old_check.js — 以前の版のステートセーブ (互換識別子が違う = 読めない) の見せ方をヘッドレス Chromium で
// 確かめる (2026-10-10 新設、patch 13 で互換識別子が変わったのに合わせて)。
//
// TW212 (games/bio_100/TW212.LZH) を TWFM.BAT で起動してクイックセーブし、その保存ファイルのヘッダの compat を
// 書き換えた「古いセーブ」を IndexedDB に置いて:
//   1. 一覧: 古い枠は .old (サムネイルが薄い・「以前の版」の札・ロードボタンなし)、上書きと削除は残る
//   2. compat の無い記録 (2026-10-10 より前の保存) は保存ファイルのヘッダから補われ、同じ版なら古いと言わない
//   3. 古いクイックセーブを ⤒ で読むと、トーストに理由の文だけが出る (互換識別子 "≠" を出さない)
//   4. 起動時のお知らせ: 古いセーブがあれば 1 回出る・閉じたら出ない・古いセーブが無ければ出ない
// 撮影した画面は OUT (既定 /tmp/qb_state_old) に残る。
//
// 準備: playwright-core (PW_DIR でその node_modules の親を指す)・開発サーバ (node tools/devserver.js 8080)
// 使い方: PW_DIR=<dir> node tools/browser/state_old_check.js
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.PW_DIR || '.', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.OUT || '/tmp/qb_state_old';
const BASE = process.env.BASE || 'http://localhost:8080';
const GAME = path.join(ROOT, 'games', 'bio_100', 'TW212.LZH');
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(GAME)) { console.log('SKIP — ' + GAME + ' が無い'); process.exit(0); }
const CHROME = process.env.CHROME || (() => {
  const base = path.join(process.env.HOME, '.cache', 'ms-playwright');
  const d = fs.readdirSync(base).find((n) => n.startsWith('chromium_headless_shell-'));
  return path.join(base, d, 'chrome-linux', 'headless_shell');
})();

let fails = 0;
function ok(cond, name, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
  if (!cond) fails++;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1200, height: 760 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  const noticeShown = () => p.evaluate(() => !document.getElementById('notice-modal').hidden);
  async function reload() {
    await p.goto(`${BASE}/?cb=${Date.now()}`);
    await p.waitForFunction(() => window.qbDebug && window.QBStateDB);
    await p.waitForTimeout(1500);   // お知らせの判定 (非同期) を待つ
  }

  // まっさらな状態から
  await reload();
  await p.evaluate(async () => {
    for (const m of await QBStateDB.listAll()) await QBStateDB.del(m.gameId, m.slot);
    localStorage.removeItem('quubee_notice_seen_20261010_after');
  });
  await reload();
  ok(!(await noticeShown()), '4. セーブが無ければお知らせは出ない');

  await p.setInputFiles('#file-input', GAME);
  await p.waitForSelector('.frow');
  await p.locator('.frow', { hasText: /twfm\.bat/i }).click();
  await p.click('#run-button');
  await p.waitForTimeout(6000);
  await p.click('#state-qsave');
  await p.waitForTimeout(1500);

  // クイックセーブを元に、slot 1 = 古い版 (compat を書き換え・記録に compat なし)、
  // slot 2 = 同じ版だが記録に compat なし (2026-10-10 より前の作りで保存した形)
  const info = await p.evaluate(async () => {
    const all = await QBStateDB.listAll();
    const q = all.find((m) => m.slot === 'quick');
    const full = await QBStateDB.get(q.gameId, 'quick');
    const d = await QBStateFmt.decode(full.bytes);
    const oldHeader = Object.assign({}, d.header, { compat: 'np2kai-0000000000+p0000000000000000' });
    const oldBytes = await QBStateFmt.encode(oldHeader, d.thumb, d.snap);
    const { compat, ...noCompat } = full;
    await QBStateDB.put(Object.assign({}, noCompat, { slot: '1', bytes: oldBytes }));
    await QBStateDB.put(Object.assign({}, noCompat, { slot: '2' }));
    return { gameId: q.gameId, quickCompat: q.compat };
  });
  ok(/^np2kai-/.test(info.quickCompat || ''), '新しい保存は記録に compat を持つ', info.quickCompat);

  await p.click('#state-list');
  await p.waitForTimeout(1500);
  await shot(p, '1_list');
  const cards = await p.evaluate(() => [...document.querySelectorAll('.st-card')].map((c) => ({
    old: c.classList.contains('old'),
    badge: (c.querySelector('.st-old') || {}).textContent || '',
    titles: [...c.querySelectorAll('button')].map((x) => x.title),
  })));
  ok(!cards[0].old && cards[0].titles.includes('ロード / Load'), '1. クイック (今の版) はロードできる', cards[0]);
  ok(cards[1].old && cards[1].badge === '以前の版Old version', '1. スロット 1 (古い版) に「以前の版」の札', cards[1]);
  ok(!cards[1].titles.includes('ロード / Load'), '1. 古い枠にロードボタンは出ない', cards[1].titles);
  ok(cards[1].titles.some((t) => t.startsWith('上書き')) && cards[1].titles.includes('削除 / Delete'), '1. 古い枠も上書きと削除はできる', cards[1].titles);
  ok(!cards[2].old && cards[2].titles.includes('ロード / Load'), '2. compat の無い同じ版の記録は古いと言わない', cards[2]);
  const backfill = await p.evaluate(async (g) => {
    const a = await QBStateDB.get(g, '1'), c = await QBStateDB.get(g, '2');
    return { s1: a.compat, s2: c.compat };
  }, info.gameId);
  ok(backfill.s1 === 'np2kai-0000000000+p0000000000000000' && backfill.s2 === info.quickCompat, '2. compat がヘッダから補われる', backfill);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // 3. 古いクイックセーブを ⤒ で読む
  await p.evaluate(async (g) => {
    const s1 = await QBStateDB.get(g, '1');
    await QBStateDB.put(Object.assign({}, s1, { slot: 'quick' }));
  }, info.gameId);
  await p.click('#state-qload');
  await p.waitForTimeout(1500);
  await shot(p, '2_toast');
  const toast = await p.evaluate(() => ({
    ja: document.getElementById('st-msg').textContent, en: document.getElementById('st-msg-en').textContent,
    err: document.getElementById('state-toast').classList.contains('err'),
  }));
  ok(toast.err && toast.ja === 'このセーブは以前の版のQuuBeeのものなので読み込めません', '3. トーストに理由の文', toast);
  ok(toast.en === 'This save is from an older version of QuuBee and cannot be loaded', '3. 英語にも互換識別子を出さない', toast.en);

  // 4. 起動時のお知らせ
  await reload();
  ok(await noticeShown(), '4. 古いセーブがあると起動時にお知らせが出る');
  const text = await p.evaluate(() => document.getElementById('notice-ja').textContent);
  ok(/更新しました/.test(text) && /以前の版/.test(text), '4. 事後の文面', text);
  await shot(p, '3_notice');
  await p.click('#notice-ok');
  await reload();
  ok(!(await noticeShown()), '4. 閉じたら次からは出ない');
  await p.evaluate(async (g) => {
    await QBStateDB.del(g, '1'); await QBStateDB.del(g, 'quick');
    localStorage.removeItem('quubee_notice_seen_20261010_after');
  }, info.gameId);
  await reload();
  ok(!(await noticeShown()), '4. 古いセーブが無ければ (今の版だけなら) 出ない');

  // 後始末
  await p.evaluate(async () => { for (const m of await QBStateDB.listAll()) await QBStateDB.del(m.gameId, m.slot); });
  if (errs.length) { console.log('ページのエラー:'); for (const e of errs) console.log('  ' + e); }
  await b.close();
  console.log(fails ? `FAIL — ${fails} 件` : '全 PASS');
  console.log('screenshots:', OUT);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
