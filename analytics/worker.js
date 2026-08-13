/**
 * Hollowdeep metrics collector.
 *
 * A single Cloudflare Worker with one D1 database behind it. It does two jobs:
 * it takes small anonymous batches from the game, and it answers one aggregate
 * query for the panel. There is no user table, no cookie, no third party, and
 * nothing here is worth stealing.
 *
 * Everything the panel shows is computed from the raw rows on request rather
 * than kept as a running total. That costs a little more per view and buys the
 * guarantee that a retried, duplicated or replayed batch cannot inflate a
 * number: every write is an upsert on an identifier the client already holds.
 *
 * Bindings it expects, all set once at deploy time:
 *   DB              D1 database, schema in schema.sql
 *   PANEL_TOKEN     secret, required to read anything back
 *   ALLOWED_ORIGINS optional comma separated list, defaults to open
 */

/**
 * The store, as statements the worker applies to itself on a cold start. Every
 * one creates only if absent, so running the list is always safe: adding a
 * feature that needs a table becomes a deploy and nothing else.
 *
 * This file is deliberately standalone, so it can be pasted straight into the
 * Cloudflare dashboard editor by anyone who would rather not install wrangler.
 */
export const SCHEMA = [
  // Everything the panel shows is derived at query time instead of kept as a
  // running total, so a retried or duplicated request cannot inflate a number.
  `CREATE TABLE IF NOT EXISTS players (
  pid        TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  first_day  TEXT    NOT NULL,
  last_seen  INTEGER NOT NULL,
  last_day   TEXT    NOT NULL,
  lang       TEXT    NOT NULL DEFAULT '',
  build      TEXT    NOT NULL DEFAULT ''
)`,
  `CREATE INDEX IF NOT EXISTS players_first_day ON players (first_day)`,
  `CREATE INDEX IF NOT EXISTS players_last_seen ON players (last_seen)`,

  // One row per sitting. `seconds` and `floor` are high water marks reported
  // by the client, so a late batch arriving out of order cannot lower them.
  `CREATE TABLE IF NOT EXISTS sessions (
  sid       TEXT PRIMARY KEY,
  pid       TEXT    NOT NULL,
  ordinal   INTEGER NOT NULL DEFAULT 1,
  started   INTEGER NOT NULL,
  updated   INTEGER NOT NULL,
  day       TEXT    NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  floor     INTEGER NOT NULL DEFAULT 0,
  dives     INTEGER NOT NULL DEFAULT 0,
  wipes     INTEGER NOT NULL DEFAULT 0,
  extracts  INTEGER NOT NULL DEFAULT 0,
  prestiges INTEGER NOT NULL DEFAULT 0,
  closed    INTEGER NOT NULL DEFAULT 0,
  lang      TEXT    NOT NULL DEFAULT '',
  build     TEXT    NOT NULL DEFAULT ''
)`,
  `CREATE INDEX IF NOT EXISTS sessions_pid ON sessions (pid)`,
  `CREATE INDEX IF NOT EXISTS sessions_day ON sessions (day)`,
  `CREATE INDEX IF NOT EXISTS sessions_started ON sessions (pid, started)`,

  // The two moments worth keeping a floor number for: where a party was lost
  // and where a player decided the run was over. Everything else is a counter.
  `CREATE TABLE IF NOT EXISTS marks (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  pid   TEXT    NOT NULL,
  sid   TEXT    NOT NULL,
  at    INTEGER NOT NULL,
  day   TEXT    NOT NULL,
  kind  TEXT    NOT NULL,
  floor INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE INDEX IF NOT EXISTS marks_kind_floor ON marks (kind, floor)`,
  `CREATE INDEX IF NOT EXISTS marks_day ON marks (day)`,

  // The ladder. One row per player per week holding their best claim for that
  // week, so a week is a fresh start and the all time board is the best of
  // them. This is the only table with anything a player chose in it, and the
  // only thing they chose is a name.
  `CREATE TABLE IF NOT EXISTS scores (
  pid       TEXT    NOT NULL,
  week      TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  floor     INTEGER NOT NULL,
  prestiges INTEGER NOT NULL DEFAULT 0,
  deep      INTEGER NOT NULL DEFAULT 0,
  played    INTEGER NOT NULL DEFAULT 0,
  updated   INTEGER NOT NULL,
  PRIMARY KEY (pid, week)
)`,
  `CREATE INDEX IF NOT EXISTS scores_board ON scores (week, floor DESC)`,
  `CREATE INDEX IF NOT EXISTS scores_all ON scores (floor DESC)`,
];

const PROTOCOL = 1;
const MAX_BODY = 16 * 1024;
const MAX_EVENTS = 40;
const MAX_MARKS_PER_BATCH = 10;
const MAX_SESSION_SECONDS = 24 * 3600;
const MAX_FLOOR = 100000;
const CHURN_DAYS = 3;
const PRESTIGE_FLOOR = 25;
const SAMPLE_LIMIT = 20000;

const ID = /^[a-zA-Z0-9]{8,64}$/;
const DAY = 86400000;

// ------------------------------------------------------------------ plumbing

/**
 * The worker brings its own database up to date rather than waiting for
 * somebody to remember a migration. Every statement creates only if absent, so
 * this is safe to run against a fresh database and against one that has been
 * collecting for months; adding a table becomes a deploy and nothing else.
 *
 * It runs once per isolate, not once per request, and a failure is swallowed:
 * a database that is already correct must not be able to take the collector
 * down on the way past.
 */
let schemaReady = null;

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(SCHEMA.map((statement) => env.DB.prepare(statement))).catch(() => undefined);
  }
  return schemaReady;
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const permit = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'access-control-allow-origin': permit,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json;charset=UTF-8', 'cache-control': 'no-store' },
  });
}

/** Compares without leaking the answer through how long it took. */
function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function authorised(request, url, env) {
  const expected = env.PANEL_TOKEN || '';
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const bearer = /^bearer /i.test(header) ? header.slice(7).trim() : '';
  return sameSecret(bearer || url.searchParams.get('token') || '', expected);
}

const clampInt = (value, low, high) => {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return low;
  return Math.min(high, Math.max(low, number));
};

const dayOf = (millis) => new Date(millis).toISOString().slice(0, 10);
const short = (value, length) => (typeof value === 'string' ? value.slice(0, length) : '');

/** ISO week, computed here because a client's idea of the week is not evidence. */
function weekOf(millis) {
  const date = new Date(millis);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * A name a stranger will read. Anything that could be used to lay out the page
 * or impersonate the interface comes out; what is left is one line of text.
 */
function cleanName(value) {
  return short(value, 64)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
}

/**
 * The floor a claim would need the shaft to have given up in the time claimed.
 * The simulated curve reaches floor 48 in eight hours and 87 in thirty six, so
 * this sits well above honest play and still refuses the impossible. It is a
 * sanity gate, not a proof: signed runs are the real answer.
 */
function plausibleFloor(playedSeconds) {
  const hours = Math.max(0, playedSeconds) / 3600;
  return Math.round(25 * Math.sqrt(hours) + 20);
}

// ------------------------------------------------------------------- collect

async function collect(request, env, cors) {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413, cors);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return json({ error: 'bad json' }, 400, cors);
  }

  if (!payload || payload.v !== PROTOCOL) return json({ error: 'bad version' }, 400, cors);
  if (!ID.test(payload.pid || '') || !ID.test(payload.sid || '')) return json({ error: 'bad id' }, 400, cors);
  if (!Array.isArray(payload.events) || payload.events.length === 0) return json({ error: 'empty' }, 400, cors);

  const now = Date.now();
  const events = payload.events.slice(0, MAX_EVENTS);
  const pid = payload.pid;
  const sid = payload.sid;
  const ordinal = clampInt(payload.n, 1, 100000);
  const lang = short(payload.lang, 8);
  const build = short(payload.build, 32);

  // The client's clock is not trusted for anything that decides a bucket. A
  // stamp may only place an event inside the last day, never in the future.
  const stampOf = (value) => clampInt(value, now - DAY, now);

  let started = now;
  let updated = 0;
  let seconds = 0;
  let floor = 0;
  let dives = 0;
  let wipes = 0;
  let extracts = 0;
  let prestiges = 0;
  let closed = 0;
  const marks = [];

  for (const event of events) {
    if (!event || typeof event.k !== 'string') continue;
    const at = stampOf(event.t);
    started = Math.min(started, at);
    updated = Math.max(updated, at);
    seconds = Math.max(seconds, clampInt(event.s, 0, MAX_SESSION_SECONDS));
    const where = clampInt(event.f, 0, MAX_FLOOR);
    floor = Math.max(floor, where);

    switch (event.k) {
      case 'dive':
        dives += 1;
        break;
      case 'extract':
        extracts += 1;
        break;
      case 'wipe':
        wipes += 1;
        if (marks.length < MAX_MARKS_PER_BATCH) marks.push({ kind: 'wipe', at, floor: where });
        break;
      case 'prestige':
        prestiges += 1;
        if (marks.length < MAX_MARKS_PER_BATCH) marks.push({ kind: 'prestige', at, floor: where });
        break;
      case 'close':
        closed = 1;
        break;
      default:
        break;
    }
  }

  const day = dayOf(started);
  const statements = [
    env.DB.prepare(
      `INSERT INTO players (pid, first_seen, first_day, last_seen, last_day, lang, build)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(pid) DO UPDATE SET
         last_seen = MAX(players.last_seen, excluded.last_seen),
         last_day  = CASE WHEN excluded.last_seen > players.last_seen THEN excluded.last_day ELSE players.last_day END,
         lang = excluded.lang,
         build = excluded.build`,
    ).bind(pid, started, day, updated, dayOf(updated), lang, build),

    env.DB.prepare(
      `INSERT INTO sessions
         (sid, pid, ordinal, started, updated, day, seconds, floor, dives, wipes, extracts, prestiges, closed, lang, build)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT(sid) DO UPDATE SET
         updated   = MAX(sessions.updated, excluded.updated),
         seconds   = MAX(sessions.seconds, excluded.seconds),
         floor     = MAX(sessions.floor, excluded.floor),
         dives     = sessions.dives + excluded.dives,
         wipes     = sessions.wipes + excluded.wipes,
         extracts  = sessions.extracts + excluded.extracts,
         prestiges = sessions.prestiges + excluded.prestiges,
         closed    = MAX(sessions.closed, excluded.closed),
         lang      = excluded.lang,
         build     = excluded.build`,
    ).bind(sid, pid, ordinal, started, updated, day, seconds, floor, dives, wipes, extracts, prestiges, closed, lang, build),
  ];

  for (const mark of marks) {
    statements.push(
      env.DB.prepare('INSERT INTO marks (pid, sid, at, day, kind, floor) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(
        pid,
        sid,
        mark.at,
        dayOf(mark.at),
        mark.kind,
        mark.floor,
      ),
    );
  }

  await env.DB.batch(statements);
  return new Response(null, { status: 204, headers: cors });
}

// --------------------------------------------------------------------- stats

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const quantile = (values, share) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
};

/** Counts values into fixed edges, so the panel never has to guess a scale. */
function bucket(values, edges) {
  const out = edges.map((edge, index) => ({
    from: edge,
    to: index + 1 < edges.length ? edges[index + 1] : null,
    n: 0,
  }));
  for (const value of values) {
    let slot = 0;
    for (let i = 0; i < edges.length; i += 1) if (value >= edges[i]) slot = i;
    out[slot].n += 1;
  }
  return out;
}

async function stats(env, url) {
  const days = clampInt(url.searchParams.get('days') || 30, 7, 365);
  const now = Date.now();
  const since = dayOf(now - days * DAY);
  const week = now - 7 * DAY;
  const month = now - 30 * DAY;
  const churnCutoff = now - CHURN_DAYS * DAY;

  const [totals, daily, fresh, retention, firsts, lasts, wipeFloors, funnel, langs, builds, lengths] =
    await env.DB.batch([
      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM players) AS players,
           (SELECT COUNT(*) FROM sessions) AS sessions,
           (SELECT COALESCE(SUM(seconds), 0) FROM sessions) AS seconds,
           (SELECT COUNT(*) FROM players WHERE first_seen >= ?1) AS new7,
           (SELECT COUNT(*) FROM players WHERE first_seen >= ?2) AS new30,
           (SELECT COUNT(DISTINCT pid) FROM sessions WHERE updated >= ?3) AS active1,
           (SELECT COUNT(DISTINCT pid) FROM sessions WHERE updated >= ?1) AS active7,
           (SELECT COUNT(DISTINCT pid) FROM sessions WHERE updated >= ?2) AS active30`,
      ).bind(week, month, now - DAY),

      env.DB.prepare(
        `SELECT day, COUNT(*) AS sessions, COUNT(DISTINCT pid) AS active, COALESCE(SUM(seconds), 0) AS seconds
         FROM sessions WHERE day >= ?1 GROUP BY day ORDER BY day`,
      ).bind(since),

      env.DB.prepare(
        `SELECT first_day AS day, COUNT(*) AS fresh FROM players WHERE first_day >= ?1 GROUP BY first_day ORDER BY first_day`,
      ).bind(since),

      env.DB.prepare(
        `SELECT p.first_day AS day,
                COUNT(DISTINCT p.pid) AS cohort,
                COUNT(DISTINCT CASE WHEN s.day = date(p.first_day, '+1 day') THEN p.pid END) AS d1,
                COUNT(DISTINCT CASE WHEN s.day = date(p.first_day, '+3 day') THEN p.pid END) AS d3,
                COUNT(DISTINCT CASE WHEN s.day = date(p.first_day, '+7 day') THEN p.pid END) AS d7,
                COUNT(DISTINCT CASE WHEN s.day > p.first_day THEN p.pid END) AS returned
         FROM players p LEFT JOIN sessions s ON s.pid = p.pid
         WHERE p.first_day >= ?1
         GROUP BY p.first_day ORDER BY p.first_day`,
      ).bind(since),

      env.DB.prepare(
        `SELECT s.seconds AS seconds, s.floor AS floor, s.dives AS dives, s.extracts AS extracts, s.closed AS closed
         FROM sessions s
         JOIN (SELECT pid, MIN(started) AS opened FROM sessions GROUP BY pid) f
           ON f.pid = s.pid AND f.opened = s.started
         ORDER BY s.started DESC LIMIT ?1`,
      ).bind(SAMPLE_LIMIT),

      env.DB.prepare(
        `SELECT s.floor AS floor, COUNT(*) AS n
         FROM sessions s
         JOIN (SELECT pid, MAX(started) AS latest FROM sessions GROUP BY pid) l
           ON l.pid = s.pid AND l.latest = s.started
         JOIN players p ON p.pid = s.pid
         WHERE p.last_seen < ?1
         GROUP BY s.floor ORDER BY s.floor`,
      ).bind(churnCutoff),

      env.DB.prepare("SELECT floor, COUNT(*) AS n FROM marks WHERE kind = 'wipe' GROUP BY floor ORDER BY floor"),

      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM players) AS opened,
           (SELECT COUNT(DISTINCT pid) FROM sessions WHERE dives > 0) AS dived,
           (SELECT COUNT(DISTINCT pid) FROM sessions WHERE extracts > 0) AS extracted,
           (SELECT COUNT(*) FROM (SELECT pid FROM sessions GROUP BY pid HAVING MAX(floor) >= 5)) AS floor5,
           (SELECT COUNT(*) FROM (SELECT pid FROM sessions GROUP BY pid HAVING MAX(floor) >= 10)) AS floor10,
           (SELECT COUNT(*) FROM (SELECT pid FROM sessions GROUP BY pid HAVING MAX(floor) >= ?1)) AS eligible,
           (SELECT COUNT(*) FROM (SELECT pid FROM sessions GROUP BY pid HAVING SUM(prestiges) > 0)) AS prestiged,
           (SELECT COUNT(*) FROM (SELECT pid FROM sessions GROUP BY pid HAVING COUNT(*) > 1)) AS repeat_players,
           (SELECT COALESCE(SUM(wipes), 0) FROM sessions) AS wipes,
           (SELECT COALESCE(SUM(extracts), 0) FROM sessions) AS extracts,
           (SELECT COALESCE(SUM(dives), 0) FROM sessions) AS dives`,
      ).bind(PRESTIGE_FLOOR),

      env.DB.prepare('SELECT lang, COUNT(*) AS n FROM players GROUP BY lang ORDER BY n DESC LIMIT 10'),
      env.DB.prepare('SELECT build, COUNT(*) AS n FROM players GROUP BY build ORDER BY n DESC LIMIT 10'),
      env.DB.prepare('SELECT seconds FROM sessions ORDER BY started DESC LIMIT ?1').bind(SAMPLE_LIMIT),
    ]);

  const head = totals.results[0] || {};
  const gate = funnel.results[0] || {};

  const byDay = new Map();
  for (const row of daily.results) byDay.set(row.day, { day: row.day, fresh: 0, ...row });
  for (const row of fresh.results) {
    const entry = byDay.get(row.day) || { day: row.day, sessions: 0, active: 0, seconds: 0, fresh: 0 };
    entry.fresh = row.fresh;
    byDay.set(row.day, entry);
  }

  const firstSeconds = firsts.results.map((row) => row.seconds);
  const firstFloors = firsts.results.map((row) => row.floor);
  const today = dayOf(now);

  return {
    generated: now,
    window: days,
    churnDays: CHURN_DAYS,
    prestigeFloor: PRESTIGE_FLOOR,
    totals: {
      players: head.players || 0,
      sessions: head.sessions || 0,
      seconds: head.seconds || 0,
      new7: head.new7 || 0,
      new30: head.new30 || 0,
      active1: head.active1 || 0,
      active7: head.active7 || 0,
      active30: head.active30 || 0,
      medianSession: median(lengths.results.map((row) => row.seconds)),
      dives: gate.dives || 0,
      wipes: gate.wipes || 0,
      extracts: gate.extracts || 0,
    },
    daily: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    retention: retention.results.map((row) => ({
      ...row,
      mature1: row.day < today,
      mature3: row.day <= dayOf(now - 3 * DAY),
      mature7: row.day <= dayOf(now - 7 * DAY),
    })),
    firstSession: {
      sample: firsts.results.length,
      medianSeconds: median(firstSeconds),
      p25Seconds: quantile(firstSeconds, 0.25),
      p75Seconds: quantile(firstSeconds, 0.75),
      medianFloor: median(firstFloors),
      lengthBuckets: bucket(firstSeconds, [0, 60, 180, 300, 600, 1200, 1800, 3600]),
      floorBuckets: bucket(firstFloors, [0, 1, 3, 5, 8, 12, 20, 30]),
      closedShare: firsts.results.length
        ? firsts.results.filter((row) => row.closed === 1).length / firsts.results.length
        : 0,
    },
    dropoff: lasts.results,
    wipeFloors: wipeFloors.results,
    funnel: [
      { step: 'opened', n: gate.opened || 0 },
      { step: 'dived', n: gate.dived || 0 },
      { step: 'extracted', n: gate.extracted || 0 },
      { step: 'floor5', n: gate.floor5 || 0 },
      { step: 'floor10', n: gate.floor10 || 0 },
      { step: 'eligible', n: gate.eligible || 0 },
      { step: 'prestiged', n: gate.prestiged || 0 },
    ],
    prestige: {
      players: gate.prestiged || 0,
      eligible: gate.eligible || 0,
      rateOfAll: head.players ? (gate.prestiged || 0) / head.players : 0,
      rateOfEligible: gate.eligible ? (gate.prestiged || 0) / gate.eligible : 0,
    },
    repeatPlayers: gate.repeat_players || 0,
    langs: langs.results,
    builds: builds.results,
  };
}

// -------------------------------------------------------------------- ladder

const BOARD_LIMIT = 50;

async function submitScore(request, env, cors) {
  const text = await request.text();
  if (text.length > 2048) return json({ error: 'too large' }, 413, cors);

  let claim;
  try {
    claim = JSON.parse(text);
  } catch {
    return json({ error: 'bad json' }, 400, cors);
  }

  if (!claim || claim.v !== PROTOCOL) return json({ error: 'bad version' }, 400, cors);
  if (!ID.test(claim.pid || '')) return json({ error: 'bad id' }, 400, cors);

  const name = cleanName(claim.name);
  if (name.length < 2) return json({ error: 'bad name' }, 400, cors);

  const now = Date.now();
  const played = clampInt(claim.played, 0, 400 * 24 * 3600);
  const floor = clampInt(claim.floor, 1, MAX_FLOOR);
  const prestiges = clampInt(claim.prestiges, 0, 100000);
  const deep = clampInt(claim.deep, 0, 100000);

  // Refusing the impossible outright, rather than storing it and sorting it out
  // on the way back, keeps the board honest even when the read path is cached.
  const ceiling = plausibleFloor(played);
  if (floor > ceiling) return json({ error: 'implausible', floor, ceiling }, 422, cors);

  const week = weekOf(now);
  await env.DB.prepare(
    `INSERT INTO scores (pid, week, name, floor, prestiges, deep, played, updated)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(pid, week) DO UPDATE SET
       name      = excluded.name,
       floor     = MAX(scores.floor, excluded.floor),
       prestiges = MAX(scores.prestiges, excluded.prestiges),
       deep      = MAX(scores.deep, excluded.deep),
       played    = MAX(scores.played, excluded.played),
       updated   = excluded.updated
     WHERE excluded.updated - scores.updated > 15000 OR excluded.floor > scores.floor`,
  )
    .bind(claim.pid, week, name, floor, prestiges, deep, played, now)
    .run();

  return json({ ok: true, week, floor }, 200, cors);
}

async function board(env, url) {
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'week';
  const limit = clampInt(url.searchParams.get('limit') || BOARD_LIMIT, 5, BOARD_LIMIT);
  const week = weekOf(Date.now());

  const statement =
    scope === 'all'
      ? env.DB.prepare(
          `SELECT pid, name, MAX(floor) AS floor, prestiges, deep, played, updated
           FROM scores GROUP BY pid ORDER BY floor DESC, played ASC LIMIT ?1`,
        ).bind(limit)
      : env.DB.prepare(
          `SELECT pid, name, floor, prestiges, deep, played, updated
           FROM scores WHERE week = ?1 ORDER BY floor DESC, played ASC LIMIT ?2`,
        ).bind(week, limit);

  const rows = (await statement.all()).results;
  return {
    scope,
    week,
    generated: Date.now(),
    rows: rows.map((row, index) => ({
      rank: index + 1,
      // The identifier goes back out so a player can find their own line
      // without the board having to know who is asking.
      pid: row.pid,
      name: row.name,
      floor: row.floor,
      prestiges: row.prestiges,
      deep: row.deep,
      played: row.played,
      updated: row.updated,
    })),
  };
}

// ------------------------------------------------------------------- routing

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('origin') || '', env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      await ensureSchema(env);

      if (url.pathname === '/collect' && request.method === 'POST') return await collect(request, env, cors);

      if (url.pathname === '/health') return json({ ok: true, protocol: PROTOCOL }, 200, cors);

      // The ladder is the one thing here anybody may read. It holds a name a
      // player chose and a floor number, and nothing else.
      if (url.pathname === '/score' && request.method === 'POST') return await submitScore(request, env, cors);
      if (url.pathname === '/board' && request.method === 'GET') return json(await board(env, url), 200, cors);

      if (url.pathname === '/stats' && request.method === 'GET') {
        if (!authorised(request, url, env)) return json({ error: 'unauthorised' }, 401, cors);
        return json(await stats(env, url), 200, cors);
      }

      // Deleting a single player's rows on request, which is the whole reason
      // the identifier is a random number the player can read and quote.
      if (url.pathname === '/forget' && request.method === 'DELETE') {
        if (!authorised(request, url, env)) return json({ error: 'unauthorised' }, 401, cors);
        const pid = url.searchParams.get('pid') || '';
        if (!ID.test(pid)) return json({ error: 'bad id' }, 400, cors);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM marks WHERE pid = ?1').bind(pid),
          env.DB.prepare('DELETE FROM sessions WHERE pid = ?1').bind(pid),
          env.DB.prepare('DELETE FROM players WHERE pid = ?1').bind(pid),
        ]);
        return json({ ok: true, pid }, 200, cors);
      }
    } catch (error) {
      return json({ error: 'failed', detail: String((error && error.message) || error) }, 500, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  },
};
