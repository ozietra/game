# Hollowdeep

An idle RPG about knowing when to turn back. A party climbs down a shaft,
fights on its own, and fills a satchel. Nothing in that satchel counts
until they climb back out; a rout leaves all of it on the floor they died on.

Two languages (Turkish and English), no accounts, no server. The whole game runs
in one browser tab and saves to local storage.

## Playing

**<https://ozietra.github.io/game/>** is the published build. Nothing to install:
open it, press the button on the title screen and the party starts climbing
down. Progress lives in that browser's local storage.

The site lives on the `gh-pages` branch, which holds the built files and
nothing else. It has to be switched on once: repository Settings, then Pages,
then Source, Deploy from a branch, `gh-pages`, `/ (root)`.

Publishing a new build afterwards is one command:

```sh
bash tools/publish-pages.sh
```

For hands off deploys, `tools/pages-workflow.yml` is a ready made Actions
workflow; copying it to `.github/workflows/pages.yml` from the GitHub web
interface and setting Pages Source to GitHub Actions makes every push publish
itself.

To run it locally instead:

```sh
npm install
npm run dev
```

Open the address Vite prints. `npm run build` produces a static `dist/` that can
be served from any file host, including a subdirectory, since every asset path
is relative.

Three goals turn over every day, one floor in five holds something other than
three fights, and a risk dial raises what the shaft pays and what it hits for
at the same time. Ten floors banked sets a mark that nothing takes back, not a
rout and not an offering. The Records tab keeps the last eight dives, the
achievements, a bestiary and the ladder.

There are two ways to run the shaft. Press Descend and the party keeps going
down until you press Turn back, whatever the orders say. Leave the automatic
descent on instead and the standing orders drive: the floor to start from, the
floor to stop at, the health level that sends them home early, and a satchel
value that does the same. Either way they keep working while the tab is closed,
up to the offline window that Waking Camp relics extend.

The floor they start from can be any floor they have climbed out of before.

Floor keepers are not ordinary foes with more health: a keeper carries a ward
that soaks blows and comes back up on a clock, fights its last third harder,
and calls in help twice on the way down.

Relics carry a party only so far, and the curve flattens in the eighties. Past
floor sixty the deep descent opens: it gives up the relics as well and pays in
echoes, which nothing takes back.

Gear is picked up mid dive and sorted out on the way home: whoever gains most
puts it on, the rest waits in the store, filtered by rarity, where it can be
handed to somebody else or melted down for iron, one piece or a whole tab at a
time. Every piece states plainly what it adds, because "Fabled Axe" means
nothing next to "+192 attack, -19 speed". Better gear also shows: each hero is
drawn in one of three kits depending on what they carry, and the best of it
catches the light.

## How the game is put together

| Path | What lives there |
| --- | --- |
| `src/core` | The simulation: combat resolution, the descent state machine, loot, saves, offline catch up. No DOM access, so it also runs under Node. |
| `src/data/content.ts` | Every tuning number, foe, hero, building and relic in one file. |
| `src/ui` | Title screen, canvas scene, panels, floating numbers, the sound mixer. |
| `src/net` | The only thing that ever leaves the tab: anonymous play metrics, switched off unless a build says otherwise. |
| `src/i18n` | Turkish and English string tables. The English table is typed against the Turkish one, so a missing key fails the type check. |
| `panel` | The owner's metrics dashboard, built as a second page at `/panel/`. |
| `analytics` | The collector behind it: a Cloudflare Worker, a D1 schema, and two checks that run offline. |
| `tools` | The asset pipeline and a headless balance harness. |

### Balance harness

The simulation is plain TypeScript with no browser dependencies, so it can be
played by a script:

```sh
npx esbuild tools/balance.ts --bundle --platform=node --format=cjs --outfile=tools/.cache/balance.cjs
node tools/.cache/balance.cjs 24            # 24 simulated hours, printed twice an hour
node tools/.cache/balance.cjs 3 save.json   # also dump a mid game save
```

A crude stand-in for a player spends the vault, pushes the target floor after a
clean dive, pulls it back after a rout, and gives up the run once the shaft
stops giving ground. It is what the depth curve was tuned against.

### Browser pass

`tools/smoke.cjs` seeds one of those dumped saves, lets the shaft run, walks
every panel in both languages, shrinks the window and reports any console error
or failed request:

```sh
npm run build
npx vite preview --port 4173 &
npm install --no-save playwright
npm run smoke -- tools/.cache/save.json tools/.cache
```

## Measuring it

A finished game and a game people keep playing are different problems, and the
second one cannot be argued about without numbers. `analytics` holds a small
collector and `panel` holds the dashboard that reads it: how many people have
ever opened it, how many arrive each day, whether they come back the next day
and the seventh, how long a first sitting lasts and how deep it gets, which
floor a party is usually lost on, which floor players are on when they stop
coming back, and how many ever take the offering.

None of it is switched on by default. The game only sends anything when a build
carries a `VITE_METRICS_URL`, and even then it stays quiet if the browser asks
not to be tracked or the player turns the switch off under Settings, Privacy.
What travels is a random number, a length and a floor. There is no name, no
address, no account, no cookie and no third party.

The panel lives at **<https://ozietra.github.io/game/panel/>** and is safe to
publish because it holds nothing: without the address and key, typed in once
and kept in that browser, it has nothing to show. It also opens a saved report
from a file, so the numbers can be read on a machine that has neither.

The same worker carries the ladder, which is the one thing on it anybody may
read: a name a player typed and the deepest floor they climbed back out of,
weekly and all time.

The collector is a Cloudflare Worker over a D1 database, which is free at any
scale this game is likely to see. `analytics/README.md` has the eight commands
that put it up, and both halves can be exercised without deploying anything:

```sh
node analytics/verify.mjs sample.json    # collector and queries, offline
node analytics/roundtrip.mjs             # browser, collector and panel end to end
```

## Art, sound and typefaces

Nothing here was drawn or recorded for this project and nothing was generated.
Character sheets are composited from the Liberated Pixel Cup libraries, dungeon
tiles come from the CC0 export of Dungeon Crawl Stone Soup, interface icons come
from game-icons.net, sound effects are Kenney's CC0 RPG and UI audio packs, and
the typefaces are Open Font Licence families served from the game's own files.

Sound is deliberately quiet: every cue has a minimum gap and the mixer as a
whole is capped, so a busy fight does not turn into a rattle. Volume and a
silent switch live on the title screen and travel with the save.

`tools/build_assets.py` fetches all of it and writes the credits at the same
time, straight from the metadata each source ships with:

```sh
python3 tools/build_assets.py           # sprites, tiles, sounds, icons, fonts
python3 tools/build_assets.py sprites   # one stage at a time
```

Character sheets are stacked layer by layer in the z order the LPC project
assigns each part, then cropped to the animation rows the game actually plays.
Every fetched file is recorded with its authors, licence and source URL in
`ASSETS.md` and `src/data/credits.json`, and the game reads that file for its
own credits screen.

## Licence

Game code is MIT, see `LICENSE`. The composited spritesheets in
`public/assets/sprites` include CC BY-SA 3.0 material and are therefore
distributed under CC BY-SA 3.0. Full per source attribution is in `ASSETS.md`.
