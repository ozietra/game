# Alacakuyu

An idle dungeon crawler about knowing when to turn back. A party climbs down a
shaft, fights on its own, and fills a satchel. Nothing in that satchel counts
until they climb back out; a rout leaves all of it on the floor they died on.

Two languages (Turkish and English), no accounts, no server. The whole game runs
in one browser tab and saves to local storage.

## Playing

**<https://ozietra.github.io/game/>** is the published build. Nothing to install:
open it, press the button on the title screen and the party starts climbing
down. Progress lives in that browser's local storage.

Every push to the branch rebuilds and republishes through
`.github/workflows/pages.yml`. GitHub needs one manual step before the first
deploy: repository Settings, then Pages, then set Source to GitHub Actions.

To run it locally instead:

```sh
npm install
npm run dev
```

Open the address Vite prints. `npm run build` produces a static `dist/` that can
be served from any file host, including a subdirectory, since every asset path
is relative.

The first descent is manual. After that, standing orders take over: pick the
floor to start from, the floor to stop at, the health level that sends the party
home early, and a satchel value that does the same. The party then works while
the tab is closed, up to the offline window that Waking Camp relics extend.

## How the game is put together

| Path | What lives there |
| --- | --- |
| `src/core` | The simulation: combat resolution, the descent state machine, loot, saves, offline catch up. No DOM access, so it also runs under Node. |
| `src/data/content.ts` | Every tuning number, foe, hero, building and relic in one file. |
| `src/ui` | Title screen, canvas scene, panels, floating numbers, the sound mixer. |
| `src/i18n` | Turkish and English string tables. The English table is typed against the Turkish one, so a missing key fails the type check. |
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
