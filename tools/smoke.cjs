/**
 * End to end check: seeds a mid game save, lets the shaft run, walks every
 * panel in both languages and shrinks the window, reporting any console error
 * or failed request along the way.
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm install --no-save playwright
 *   node tools/smoke.cjs [save.json] [screenshot-dir]
 *
 * Set CHROMIUM_PATH when the browser lives outside the playwright cache.
 */

const fs = require('fs');
const { chromium } = require('playwright');

const SAVE_PATH = process.argv[2] ?? 'tools/.cache/save.json';
const OUT = process.argv[3] ?? 'tools/.cache';
const SAVE = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });

  // Requests cancelled by the seeding reload are noise, so collection starts
  // once the game is loaded for real.
  let watching = false;
  const problems = [];
  page.on('console', (m) => { if (watching && m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => { if (watching) problems.push(`pageerror: ${e.message}`); });
  page.on('requestfailed', (r) => {
    const reason = r.failure()?.errorText ?? '';
    // A reload cancels whatever the previous page was still fetching; that is a
    // cancellation, not a broken asset.
    if (watching && reason !== 'net::ERR_ABORTED') problems.push(`request failed: ${r.url()} ${reason}`);
  });

  // seed a mid game save, pretending the tab was closed two hours ago
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((save) => {
    save.lastSeen = Date.now() - 2 * 3600 * 1000;
    save.tutorialSeen = true;
    localStorage.setItem('alacakuyu.save.v1', JSON.stringify(save));
  }, SAVE);
  watching = true;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  await page.screenshot({ path: `${OUT}/mid-offline.png` });
  const modal = page.locator('.backdrop .button');
  if (await modal.count()) await modal.first().click();

  // title screen: credits live here now
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/mid-menu.png` });
  await page.locator('.menu-buttons .button').nth(2).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/mid-credits.png` });
  await page.locator('.menu-buttons .button').last().click();
  await page.waitForTimeout(300);
  await page.locator('.menu-buttons .button').nth(1).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/mid-settings.png` });
  await page.locator('.menu-buttons .button').last().click();
  await page.waitForTimeout(300);

  await page.locator('.menu-buttons .button').first().click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/mid-shaft.png` });

  for (const tab of ['roster', 'camp', 'relics']) {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/mid-${tab}.png`, fullPage: tab === 'roster' });
  }

  // english pass, switched from the title screen
  await page.click('.topbar-right .button');
  await page.waitForTimeout(400);
  await page.locator('.menu-buttons .button').nth(1).click();
  await page.waitForTimeout(400);
  await page.click('.lang-switch .button:nth-child(2)');
  await page.waitForTimeout(500);
  await page.locator('.menu-buttons .button').last().click();
  await page.waitForTimeout(300);
  await page.locator('.menu-buttons .button').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/mid-english.png` });

  // narrow layout
  await page.setViewportSize({ width: 560, height: 940 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/mid-narrow.png` });

  const state = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('alacakuyu.save.v1'));
    return { phase: s.run.phase, floor: s.run.floor, deepest: s.deepestFloor, coin: Math.round(s.bank.coin), lang: s.language };
  });

  console.log('problems:', problems.length ? problems : 'none');
  console.log('state:', JSON.stringify(state));
  await browser.close();
})();
