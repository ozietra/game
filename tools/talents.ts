/**
 * Does a talent path actually pay, and does the crowning row open?
 *
 * Builds the same save three times, sends every hero down one of the three
 * paths, and replays a long stretch of the shaft for each. A path that cannot
 * reach its own crowning talent, or one that runs away with the game, shows up
 * here rather than in somebody's night of idling.
 *
 *   npx esbuild tools/talents.ts --bundle --platform=node --format=cjs --outfile=tools/.cache/talents.cjs
 *   node tools/.cache/talents.cjs tools/.cache/eight.json 4
 */

import { readFileSync } from 'node:fs';
import { Game } from '../src/core/game';
import { migrate } from '../src/core/save';
import { HERO_ORDER, TALENT_LINES, TALENT_TREES, TALENTS, talentsOpen, type TalentLine } from '../src/data/content';
import type { GameState } from '../src/core/types';

const path = process.argv[2] ?? 'tools/.cache/eight.json';
const hours = Number(process.argv[3] ?? 4);
const target = Number(process.argv[4] ?? 0);
const step = 0.2;

function fresh(): GameState {
  const save = migrate(JSON.parse(readFileSync(path, 'utf8')) as GameState);
  if (target > 0) save.policy.targetFloor = target;
  return save;
}

/** Sends every unlocked hero as far down one path as the tree allows. */
function walk(game: Game, line: TalentLine | 'none'): { taken: number; crowned: number; barred: number } {
  let taken = 0;
  let crowned = 0;
  let barred = 0;
  for (const id of HERO_ORDER) {
    const hero = game.state.heroes[id];
    hero.talents = [];
    if (!hero.unlocked || line === 'none') continue;
    const tree = TALENT_TREES[id] ?? [];
    const rows = Math.min(tree.length, talentsOpen(hero.level));
    for (let tier = 0; tier < rows; tier += 1) {
      // Prefer the chosen path, and fall back to whatever the row will give.
      const wanted = tree[tier].find((one) => TALENTS[one]?.line === line);
      const order = wanted ? [wanted, ...tree[tier].filter((one) => one !== wanted)] : tree[tier];
      const got = order.find((one) => game.chooseTalent(id, tier, one));
      if (!got) continue;
      taken += 1;
      if (TALENTS[got]?.needs) crowned += 1;
      if (wanted && got !== wanted) barred += 1;
    }
  }
  return { taken, crowned, barred };
}

function run(line: TalentLine | 'none'): void {
  const save = fresh();
  save.policy.autoDive = true;
  const game = new Game(save);
  const picks = walk(game, line);

  const total = hours * 3600;
  for (let elapsed = 0; elapsed < total; elapsed += step) game.tick(step);

  const history = game.state.diveHistory;
  const routs = history.filter((report) => report.wiped).length;
  const coin = Math.round(history.reduce((sum, report) => sum + report.coin, 0));
  const fights = history.reduce((sum, report) => sum + report.fights, 0);
  console.log(
    `${line.padEnd(6)} picks ${String(picks.taken).padStart(3)}` +
      `  crowning ${String(picks.crowned).padStart(2)}` +
      `  fell back ${String(picks.barred).padStart(2)}` +
      `  dives ${String(history.length).padStart(3)}` +
      `  routs ${String(routs).padStart(2)}` +
      `  fights ${String(fights).padStart(4)}` +
      `  coin ${coin}`,
  );
}

console.log(`${path}, ${hours}h each, target floor ${fresh().policy.targetFloor}`);
run('none');
for (const line of TALENT_LINES) run(line);
