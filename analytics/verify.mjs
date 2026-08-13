/**
 * Drives worker.js end to end against a real SQLite file, so the queries are
 * checked by running them rather than by reading them.
 *
 * D1 is SQLite, and Node ships one, so the whole collector can be exercised
 * offline: fabricate a month of players, post their batches through the same
 * fetch handler Cloudflare would call, then read the panel's own endpoint back
 * and assert the numbers add up.
 *
 *   node analytics/verify.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { schemaText } from './schema.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const worker = (await import(join(here, 'worker.js'))).default;

// ---------------------------------------------------------------- D1 stand-in

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
    if (/^\s*(select|with)/i.test(this.sql)) {
      return { results: prepared.all(...this.args), success: true };
    }
    prepared.run(...this.args);
    return { results: [], success: true };
  }

  /** D1 statements answer on their own as well as inside a batch. */
  async all() {
    return this.run();
  }
}

class Database {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    return statements.map((statement) => statement.run());
  }
}

// -------------------------------------------------------------- fake players

const DAY = 86400000;
const TOKEN = 'test-token';

let ids = 0;
const nextId = () => `p${String(++ids).padStart(8, '0')}`;

function batchFor(pid, sid, ordinal, at, events) {
  return JSON.stringify({ v: 1, pid, sid, n: ordinal, build: 'test', lang: 'tr', events });
}

/**
 * The collector refuses to believe a client's clock beyond the last day, which
 * is exactly what stops someone back-dating themselves into an old cohort. To
 * fabricate three weeks of history the test has to move the server's clock
 * instead, one batch at a time.
 */
async function post(env, body, at) {
  const real = Date.now;
  Date.now = () => at;
  try {
    const response = await worker.fetch(
      new Request('https://metrics.test/collect', { method: 'POST', body, headers: { 'content-type': 'text/plain' } }),
      env,
    );
    if (response.status !== 204) throw new Error(`collect returned ${response.status}: ${await response.text()}`);
  } finally {
    Date.now = real;
  }
}

/** One sitting: a session mark, some running, and a clean close. */
function sitting(at, seconds, floor, { dives = 1, wipes = 0, extracts = 1, prestiges = 0 } = {}) {
  const events = [{ k: 'session', t: at, s: 0, f: 0 }];
  for (let i = 0; i < dives; i += 1) events.push({ k: 'dive', t: at + 1000, s: 10, f: 1 });
  for (let i = 0; i < wipes; i += 1) events.push({ k: 'wipe', t: at + 2000, s: 20, f: floor });
  for (let i = 0; i < extracts; i += 1) events.push({ k: 'extract', t: at + 3000, s: 30, f: floor });
  for (let i = 0; i < prestiges; i += 1) events.push({ k: 'prestige', t: at + 4000, s: 40, f: floor });
  events.push({ k: 'close', t: at + 5000, s: seconds, f: floor });
  return events;
}

/** The ladder: a name gets cleaned, a claim gets weighed, a board comes back. */
async function checkLadder(env) {
  const post = async (body) =>
    worker.fetch(new Request('https://metrics.test/score', { method: 'POST', body: JSON.stringify(body) }), env);

  const honest = await post({ v: 1, pid: 'ladder00000001', name: '  Kuyucu  ', floor: 40, played: 8 * 3600, prestiges: 2, deep: 0 });
  assert(honest.status === 200, `an honest claim should be taken, got ${honest.status}`);

  const silly = await post({ v: 1, pid: 'ladder00000002', name: 'Hızlı', floor: 900, played: 300, prestiges: 0, deep: 0 });
  assert(silly.status === 422, `an impossible claim should be refused, got ${silly.status}`);

  const nameless = await post({ v: 1, pid: 'ladder00000003', name: ' <b> ', floor: 5, played: 3600, prestiges: 0, deep: 0 });
  assert(nameless.status === 400, 'a name that is only markup should be refused');

  const second = await post({ v: 1, pid: 'ladder00000004', name: 'Derinci', floor: 30, played: 6 * 3600, prestiges: 1, deep: 1 });
  assert(second.status === 200, 'a second player should be taken');

  const response = await worker.fetch(new Request('https://metrics.test/board'), env);
  assert(response.status === 200, `the board should be public, got ${response.status}`);
  const table = await response.json();

  assert(table.rows.length === 2, `the board should hold two players, saw ${table.rows.length}`);
  assert(table.rows[0].floor >= table.rows[1].floor, 'the board should be sorted by floor');
  assert(table.rows[0].name === 'Kuyucu', `the name should come back trimmed, saw "${table.rows[0].name}"`);
  assert(table.rows[0].rank === 1, 'the board should carry ranks');

  const all = await worker.fetch(new Request('https://metrics.test/board?scope=all'), env);
  assert((await all.json()).rows.length === 2, 'the all time board should hold the same players');
}

async function main() {
  // Nothing is created here on purpose: the worker is supposed to bring its
  // own database up to date on the first request, and that is worth checking.
  const db = new DatabaseSync(':memory:');
  const env = { DB: new Database(db), PANEL_TOKEN: TOKEN };

  const onDisk = readFileSync(join(here, 'schema.sql'), 'utf8');
  assert(onDisk === schemaText(), 'schema.sql is stale: run node analytics/schema.js > analytics/schema.sql');

  const now = Date.now();
  const players = 60;
  let expectedReturners = 0;
  let expectedPrestige = 0;

  const SPAN = 5000;
  let expectedD1 = 0;

  for (let i = 0; i < players; i += 1) {
    const pid = nextId();
    // Spread first sittings over the last three weeks, oldest first.
    const firstAt = now - (20 - (i % 20)) * DAY - 3600000 - i * 1000;
    const firstFloor = 1 + (i % 14);
    await post(env, batchFor(pid, `${pid}s1`, 1, firstAt, sitting(firstAt, 120 + i * 17, firstFloor)), firstAt + SPAN);

    // Every third player comes back the next day, every seventh a week later.
    if (i % 3 === 0) {
      expectedReturners += 1;
      expectedD1 += 1;
      const at = firstAt + DAY;
      await post(env, batchFor(pid, `${pid}s2`, 2, at, sitting(at, 900, firstFloor + 6, { wipes: 1, extracts: 2 })), at + SPAN);
    }
    if (i % 7 === 0) {
      const at = firstAt + 7 * DAY;
      if (at + SPAN < now) {
        if (i % 3 !== 0) expectedReturners += 1;
        expectedPrestige += 1;
        await post(
          env,
          batchFor(pid, `${pid}s3`, 3, at, sitting(at, 2400, 30 + i, { dives: 4, wipes: 2, extracts: 3, prestiges: 1 })),
          at + SPAN,
        );
      }
    }
  }

  // A duplicate batch must not double count anything.
  const repeatPid = 'p00000001';
  const repeatAt = now - 20 * DAY - 3600000;
  await post(
    env,
    batchFor(repeatPid, `${repeatPid}s1`, 1, repeatAt, sitting(repeatAt, 120, 1, { dives: 0, extracts: 0 })),
    repeatAt + SPAN,
  );

  const unauthorised = await worker.fetch(new Request('https://metrics.test/stats'), env);
  assert(unauthorised.status === 401, 'stats without a token must be refused');

  const response = await worker.fetch(new Request(`https://metrics.test/stats?token=${TOKEN}&days=30`), env);
  assert(response.status === 200, `stats returned ${response.status}`);
  const report = await response.json();

  assert(report.totals.players === players, `players ${report.totals.players} should be ${players}`);
  const sessionsSeen = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  assert(report.totals.sessions === sessionsSeen, 'session count should match the table');
  assert(report.totals.seconds > 0, 'total play time should be positive');

  const cohorts = report.retention.reduce((sum, row) => sum + row.cohort, 0);
  assert(cohorts === players, `retention cohorts ${cohorts} should cover every player`);

  const returned = report.retention.reduce((sum, row) => sum + row.returned, 0);
  assert(returned === expectedReturners, `returners ${returned} should be ${expectedReturners}`);

  const d1 = report.retention.reduce((sum, row) => sum + row.d1, 0);
  assert(d1 === expectedD1, `day one returns ${d1} should be ${expectedD1}`);

  assert(report.prestige.players === expectedPrestige, `prestige players ${report.prestige.players} should be ${expectedPrestige}`);
  assert(report.prestige.rateOfEligible > 0, 'prestige rate should be measurable');

  const steps = report.funnel.map((entry) => entry.n);
  assert(steps[0] === players, 'the funnel should open with every player');
  assert(steps[1] <= steps[0], 'the funnel must never widen');

  assert(report.firstSession.sample === players, 'every player should contribute one first sitting');
  assert(report.firstSession.medianSeconds > 0, 'first sitting length should be measurable');
  assert(report.firstSession.medianFloor > 0, 'first sitting floor should be measurable');
  assert(report.firstSession.lengthBuckets.reduce((sum, b) => sum + b.n, 0) === players, 'length buckets should hold everyone');
  assert(report.firstSession.floorBuckets.reduce((sum, b) => sum + b.n, 0) === players, 'floor buckets should hold everyone');

  const freshTotal = report.daily.reduce((sum, row) => sum + row.fresh, 0);
  assert(freshTotal === players, `new players per day ${freshTotal} should add to ${players}`);

  assert(report.dropoff.length > 0, 'churned players should land somewhere on the drop-off chart');
  assert(report.wipeFloors.length > 0, 'wipes should be recorded with a floor');

  const first = db.prepare('SELECT dives, extracts FROM sessions WHERE sid = ?').get(`${repeatPid}s1`);
  assert(first.dives === 1 && first.extracts === 1, 'a repeated batch must not double count counters');

  await checkLadder(env);

  const forget = await worker.fetch(
    new Request(`https://metrics.test/forget?token=${TOKEN}&pid=${repeatPid}`, { method: 'DELETE' }),
    env,
  );
  assert(forget.status === 200, 'forgetting a player should succeed');
  const left = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE pid = ?').get(repeatPid).n;
  assert(left === 0, 'forgetting a player should take their sittings with them');

  console.log(`checked ${players} players, ${report.totals.sessions} sittings`);
  console.log(
    `d1 ${d1}/${players}  returners ${returned}  prestige ${report.prestige.players}` +
      `  median first sitting ${report.firstSession.medianSeconds}s at floor ${report.firstSession.medianFloor}`,
  );

  // The panel can be opened against this file before a collector exists, so
  // the layout is arguable before anybody has any real players.
  const dump = process.argv[2];
  if (dump) {
    writeFileSync(dump, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${dump}`);
  }
}

let failures = 0;
function assert(condition, message) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL ${message}`);
}

await main();
if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
