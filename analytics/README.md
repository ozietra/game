# Metrics

The game answers plenty of questions about one save file and none at all about
players in general. This folder is the part that answers those: how many people
have ever opened it, whether they come back the next day, how long a first
sitting lasts, and which floor they were on when they stopped.

It is a Cloudflare Worker with one D1 database behind it. Both sit inside the
free plan with a wide margin, and neither needs a card on file.

## What is collected, and what is not

Every batch carries a random identifier, a random identifier for the sitting,
which numbered sitting it is, the language and build, and a short list of
moments: the game opened, a party went down, a party was lost, a party climbed
out, an offering was taken, the tab closed. Each moment carries how many
seconds the sitting has run and which floor it was on.

There is no name, no address, no account, no cookie, no advertising network and
no third party of any kind. The identifier is generated in the browser, means
nothing anywhere else, and can be thrown away by clearing site data.

Nothing is sent at all when any of these is true:

- the build has no `VITE_METRICS_URL`, so there is no address to send to
- the browser sets Do Not Track or Global Privacy Control
- the player turns the switch off under Settings, Privacy

## Deploying it

Eight commands, once. Run them from this folder.

```sh
cd analytics
npx wrangler login
npx wrangler d1 create hollowdeep-metrics
```

The last command prints a `database_id`. Paste it into `wrangler.toml`, then
create the tables and the key:

```sh
npx wrangler d1 execute hollowdeep-metrics --remote --file=schema.sql
openssl rand -hex 24                      # this is the panel key, keep it
npx wrangler secret put PANEL_TOKEN       # paste it when asked
npx wrangler deploy
```

Deploy prints the address, something like
`https://hollowdeep-metrics.<account>.workers.dev`. Check it answers:

```sh
curl https://hollowdeep-metrics.<account>.workers.dev/health
```

Then point the game at it. In the repository root create a file called `.env`:

```
VITE_METRICS_URL=https://hollowdeep-metrics.<account>.workers.dev
VITE_BUILD_ID=2026-08-13
```

`.env` is ignored by git, so the address never lands in a commit. Publish as
usual:

```sh
bash tools/publish-pages.sh
```

Finally open `<the game address>/panel/`, paste the same address and the panel
key, and press Connect. Both are kept in that browser and nowhere else.

Once the game is live it is worth closing the door behind you: set
`ALLOWED_ORIGINS` in `wrangler.toml` to the published origin and deploy again,
so only the real site can post.

## Reading it back

The panel is the intended reader, but the endpoint is plain JSON and answers
anything that can hold a bearer token:

```sh
curl -H "authorization: Bearer $PANEL_TOKEN" \
  "https://hollowdeep-metrics.<account>.workers.dev/stats?days=30"
```

A player who asks to be removed can be removed, which is the reason the
identifier is a number they can read out of their own browser storage:

```sh
curl -X DELETE -H "authorization: Bearer $PANEL_TOKEN" \
  "https://hollowdeep-metrics.<account>.workers.dev/forget?pid=<their id>"
```

## Checking it without deploying anything

D1 is SQLite and Node ships one, so the whole collector runs offline. This
fabricates three weeks of players, posts them through the same handler
Cloudflare would call, reads the panel's own endpoint back, and checks the
numbers add up:

```sh
node analytics/verify.mjs                      # just the checks
node analytics/verify.mjs sample.json          # and a report to open in the panel
```

The panel takes that file through Open a saved report, so the layout can be
argued about before anybody has any real players.

## What it costs

The free plan allows 100,000 worker requests and 100,000 database row writes a
day. The game batches once a minute while a tab is open and writes two rows per
batch, so one player sitting for half an hour costs about 30 requests and 60
rows. That is roughly 3,000 half hour sittings a day before anything runs out,
and the panel itself costs one request per view.

If that ever becomes the limit, the cheapest fix is raising `FLUSH_SECONDS` in
`src/net/telemetry.ts`: at two minutes the cost halves and nothing in the panel
changes except how quickly a live sitting appears.

## Where each figure comes from

| Panel figure | Source |
| --- | --- |
| Players, new in 7 and 30 days | `players`, one row the first time an identifier is seen |
| Sittings, total time played, median sitting | `sessions`, one row per tab, seconds as a high water mark |
| Active in 1, 7, 30 days | distinct identifiers in `sessions` by when they last reported |
| Coming back | cohorts by `players.first_day`, joined to the days that identifier has sittings on |
| First sitting length and floor | the earliest sitting of each identifier |
| Where they stop | the last sitting of identifiers that have not been seen for three days |
| Floor lost on | `marks`, written for routs and offerings only |
| Funnel, offering rate | counters on `sessions`, grouped by identifier |

Every figure is computed from the rows when the panel asks, never kept as a
running total, so a batch that arrives twice cannot inflate anything.
