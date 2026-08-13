-- Hollowdeep metrics store.
--
-- Three tables, and only one of them grows per sitting. Everything the panel
-- shows is derived at query time instead of kept as a running total, so a
-- retried or duplicated request can never inflate a number: writes are upserts
-- keyed on an identifier the client already holds.
--
--   sqlite3 metrics.db < schema.sql              (local)
--   npx wrangler d1 execute hollowdeep-metrics --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS players (
  pid        TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  first_day  TEXT    NOT NULL,
  last_seen  INTEGER NOT NULL,
  last_day   TEXT    NOT NULL,
  lang       TEXT    NOT NULL DEFAULT '',
  build      TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS players_first_day ON players (first_day);
CREATE INDEX IF NOT EXISTS players_last_seen ON players (last_seen);

-- One row per sitting. `seconds` and `floor` are high water marks reported by
-- the client, so a late batch that arrives out of order cannot lower them.
CREATE TABLE IF NOT EXISTS sessions (
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
);

CREATE INDEX IF NOT EXISTS sessions_pid ON sessions (pid);
CREATE INDEX IF NOT EXISTS sessions_day ON sessions (day);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions (pid, started);

-- The two moments worth keeping a floor number for: where a party was lost and
-- where a player decided the run was over. Everything else is a counter.
CREATE TABLE IF NOT EXISTS marks (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  pid   TEXT    NOT NULL,
  sid   TEXT    NOT NULL,
  at    INTEGER NOT NULL,
  day   TEXT    NOT NULL,
  kind  TEXT    NOT NULL,
  floor INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS marks_kind_floor ON marks (kind, floor);
CREATE INDEX IF NOT EXISTS marks_day ON marks (day);

-- The ladder. One row per player per week, holding their best claim for that
-- week, so a week is a fresh start and the all-time board is the best of them.
-- This is the only table with anything a player chose in it, and the only
-- thing they chose is a name.
CREATE TABLE IF NOT EXISTS scores (
  pid       TEXT    NOT NULL,
  week      TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  floor     INTEGER NOT NULL,
  prestiges INTEGER NOT NULL DEFAULT 0,
  deep      INTEGER NOT NULL DEFAULT 0,
  played    INTEGER NOT NULL DEFAULT 0,
  updated   INTEGER NOT NULL,
  PRIMARY KEY (pid, week)
);

CREATE INDEX IF NOT EXISTS scores_board ON scores (week, floor DESC);
CREATE INDEX IF NOT EXISTS scores_all ON scores (floor DESC);
