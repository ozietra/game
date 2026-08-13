/**
 * Does the shaft ever become a wall?
 *
 * A party that keeps diving into the same floor and dying there all night is
 * the one failure this game cannot have: it is supposed to run unattended and
 * come back with something. This replays a long stretch from a given save and
 * reports what actually happened, floor by floor, so a keeper that cannot be
 * killed shows up as a column of routs rather than as a support message.
 *
 *   npx esbuild tools/wall.ts --bundle --platform=node --format=cjs --outfile=tools/.cache/wall.cjs
 *   node tools/.cache/wall.cjs tools/.cache/save.json 4      # four simulated hours
 */

import { readFileSync } from 'node:fs';
import { Game } from '../src/core/game';
import { migrate } from '../src/core/save';
import type { GameState } from '../src/core/types';

const path = process.argv[2] ?? 'tools/.cache/save.json';
const hours = Number(process.argv[3] ?? 4);
const target = Number(process.argv[4] ?? 0);
// The step the shaft is replayed at. Live play uses a twentieth of a second,
// offline catch up uses a fifth, and the two must agree.
const step = Number(process.argv[5] ?? 0.2);

// Through the same migration the game uses, so a save written before a hero or
// a field existed is filled in rather than crashing the resolver.
const save = migrate(JSON.parse(readFileSync(path, 'utf8')) as GameState);
if (target > 0) save.policy.targetFloor = target;
save.policy.autoDive = true;

const game = new Game(save);
const total = hours * 3600;

for (let elapsed = 0; elapsed < total; elapsed += step) game.tick(step);

const history = game.state.diveHistory;
const routs = history.filter((report) => report.wiped).length;
const banked = history.reduce((sum, report) => sum + report.coin, 0);

console.log(`save ${path}, ${hours}h, target floor ${game.state.policy.targetFloor}`);
console.log(`dives recorded ${history.length}, routs ${routs}, coin from them ${Math.round(banked)}`);
console.log('deepest banked', game.state.deepestBanked, 'bank', Math.round(game.state.bank.coin));

for (const report of history) {
  const tag = report.wiped ? 'ROUT' : 'back';
  console.log(
    `  ${tag}  floor ${String(report.deepest).padStart(3)}  ` +
      `${String(report.fights).padStart(3)} fights  ${Math.round(report.seconds)}s  ${Math.round(report.coin)} coin`,
  );
}

const allRouts = history.length >= 4 && routs === history.length;
console.log(allRouts ? 'WALL: every recorded dive was a rout' : 'no wall: the party is coming back');
if (allRouts) process.exit(1);
