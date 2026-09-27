#!/usr/bin/env node
// state_ui_check.js — ステートセーブの UI (段階 G) をヘッドレス Chromium で操作して撮影する確認。
//
// TW212 (games/bio_100/TW212.LZH) を TWFM.BAT で起動 → クイックセーブ → トースト (元に戻す・5 秒で消える) →
// 一覧 (4 枠・セーブ・上書きの確認・Esc) → クイックロード → 元に戻す → 狭い幅 (390px) で一覧からロード。
// 撮影した画面は OUT (既定 /tmp/qb_state_ui) に残るので、自分の目で見る。ページのエラーは最後に表示。
//
// 準備: playwright-core をどこかに入れ (npm i playwright-core)、PW_DIR でその node_modules の親を指す。
//   ブラウザ本体は ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell (CHROME で上書き可)。
//   開発サーバを起動しておく: node tools/devserver.js 8080
// 使い方: PW_DIR=<dir> node tools/browser/state_ui_check.js
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(process.env.PW_DIR || '.', 'node_modules', 'playwright-core'));
const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.OUT || '/tmp/qb_state_ui';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || (() => {
  const base = path.join(process.env.HOME, '.cache', 'ms-playwright');
  const d = fs.readdirSync(base).find((n) => n.startsWith('chromium_headless_shell-'));
  return path.join(base, d, 'chrome-linux', 'headless_shell');
})();
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
(async () => {
  const b = await chromium.launch({ executablePath: CHROME,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 760 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' || /\[state\]/.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
  await p.goto('http://localhost:8080/?cb=' + Date.now());
  await p.waitForTimeout(1500);
  const vis = async () => p.evaluate(() => ({ btns: !document.getElementById('state-btns').hidden }));
  console.log('before load', await vis());
  await p.setInputFiles('#file-input', path.join(ROOT, 'games', 'bio_100', 'TW212.LZH'));
  await p.waitForSelector('.frow');
  await p.locator('.frow', { hasText: /twfm\.bat/i }).click();
  await p.click('#run-button');
  await p.waitForTimeout(6000);
  console.log('running', await vis());
  await shot(p, '1_running');
  await p.click('#state-qsave'); await p.waitForTimeout(1500);
  console.log('toast1', await p.textContent('#state-toast'), 'undoVisible', await p.isVisible('#st-undo'), 'focus', await p.evaluate(() => document.activeElement.id || document.activeElement.tagName));
  await shot(p, '2_qsave');
  await p.waitForTimeout(5500);
  console.log('toast hidden after 5s', await p.evaluate(() => document.getElementById('state-toast').hidden));
  await p.click('#state-list'); await p.waitForTimeout(1200);
  await shot(p, '3_modal');
  console.log('cards', await p.locator('.st-card').count(), await p.locator('.st-card').allInnerTexts());
  // スロット 1 にセーブ
  await p.locator('.st-card').nth(1).locator('button', { hasText: /^セーブ$/ }).click(); await p.waitForTimeout(1500);
  await shot(p, '4_slot1');
  // 上書きの確認
  await p.locator('.st-card').nth(1).locator('button', { hasText: '上書き' }).click(); await p.waitForTimeout(200);
  console.log('confirm label', await p.locator('.st-card').nth(1).locator('button.confirm').innerText());
  await shot(p, '5_confirm');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  console.log('modal hidden after Esc', await p.evaluate(() => document.getElementById('state-modal').hidden));
  await p.waitForTimeout(3000);
  await p.click('#state-qload'); await p.waitForTimeout(1500);
  console.log('toast2', await p.textContent('#state-toast'), 'undo', await p.isVisible('#st-undo'));
  await shot(p, '6_qload');
  await shot(p, '6a_toast_pos');
  await p.click('#st-undo'); await p.waitForTimeout(1500);
  console.log('toast3', await p.textContent('#state-toast'));
  // 狭い画面
  await p.setViewportSize({ width: 390, height: 760 });
  await p.waitForTimeout(500);
  await shot(p, '6b_narrow_before');
  await p.evaluate(() => document.getElementById('state-list').click()); await p.waitForTimeout(1200);
  await shot(p, '7_narrow_modal');
  await p.locator('.st-card').nth(1).locator('button', { hasText: 'ロード' }).click(); await p.waitForTimeout(1200);
  await shot(p, '7b_narrow_loaded');
  await shot(p, '8_narrow_bar');
  console.log('errors', errs);
  console.log('screenshots:', OUT);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
