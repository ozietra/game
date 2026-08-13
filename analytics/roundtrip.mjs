/**
 * The whole chain in one pass: a real browser plays the game, the batches it
 * sends are caught, replayed through the collector against a real SQLite file,
 * and the panel's own endpoint is read back to see the sitting appear.
 *
 * It proves the three halves agree about the payload, which unit checks on
 * either side cannot.
 *
 *   npm run build                          # with VITE_METRICS_URL set
 *   npx vite preview --port 4173 &
 *   npm install --no-save playwright
 *   node analytics/roundtrip.mjs [save.json]
 *
 * Set CHROMIUM_PATH when the browser lives outside the playwright cache.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(join(here, 'worker.js'))).default;

const SAVE_PATH = process.argv[2] ?? 'tools/.cache/save.json';
const TOKEN = 'roundtrip-token';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  run() {
    const prepared = this.db.prepare(this.sql);
    if (/^\s*(select|with)/i.test(this.sql)) return { results: prepared.all(...this.args), success: true };
    prepared.run(...this.args);
    return { results: [], success: true };
  }
}

const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
const env = {
  DB: {
    prepare: (sql) => new Statement(db, sql),
    batch: async (statements) => statements.map((statement) => statement.run()),
  },
  PANEL_TOKEN: TOKEN,
};

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const batches = [];
await page.route('**/collect', async (route) => {
  batches.push(route.request().postData() ?? '');
  await route.fulfill({ status: 204, body: '' });
});

page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});

// The save is seeded before the first load, so the run under test is the only
// sitting the collector ever hears about.
const save = JSON.parse(readFileSync(SAVE_PATH, 'utf8'));
await page.addInitScript((seed) => {
  seed.lastSeen = Date.now();
  localStorage.setItem('hollowdeep.save.v1', JSON.stringify(seed));
}, save);
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });

// Into the game, then let the shaft run long enough for a dive and a climb.
await page.locator('.menu-button.primary').click();
await page.waitForTimeout(1200);
const intro = page.locator('.modal .button');
if (await intro.count()) await intro.first().click();
await page.waitForTimeout(14000);

// A closing tab is what normally flushes the last batch.
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await page.waitForTimeout(600);

check(batches.length > 0, 'the game sent nothing at all');

for (const body of batches) {
  const response = await worker.fetch(
    new Request('https://metrics.test/collect', { method: 'POST', body, headers: { 'content-type': 'text/plain' } }),
    env,
  );
  check(response.status === 204, `the collector refused a real batch with ${response.status}`);
}

const stats = await worker.fetch(new Request(`https://metrics.test/stats?token=${TOKEN}`), env);
check(stats.status === 200, `stats returned ${stats.status}`);
const report = await stats.json();

check(report.totals.players === 1, `expected one player, saw ${report.totals.players}`);
check(report.totals.sessions === 1, `expected one sitting, saw ${report.totals.sessions}`);
check(report.totals.seconds > 0, 'the sitting reported no time played');
check(report.firstSession.medianFloor > 0, 'the sitting reported no floor');

const kinds = new Set(batches.flatMap((body) => JSON.parse(body).events.map((event) => event.k)));
check(kinds.has('session'), 'no session mark was sent');
check(kinds.has('close'), 'no closing mark was sent');

await browser.close();

console.log(`batches ${batches.length}, marks seen: ${[...kinds].sort().join(', ')}`);
console.log(
  `player ${report.totals.players}, sitting ${report.totals.sessions}, ` +
    `${report.totals.seconds}s, floor ${report.firstSession.medianFloor}, ` +
    `dives ${report.totals.dives}, routs ${report.totals.wipes}, climbs ${report.totals.extracts}`,
);

if (problems.length > 0) {
  console.error(`problems:\n${problems.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('problems: none');
