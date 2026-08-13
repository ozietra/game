/**
 * Plays the game without a browser so the curve can be inspected.
 *
 *   npx esbuild tools/balance.ts --bundle --platform=node --outfile=.cache/balance.cjs
 *   node .cache/balance.cjs [hours]
 *
 * A crude stand-in for a player spends whatever is in the vault, pushes the
 * target floor when a dive comes back whole, and pulls it in after a rout.
 */

import { writeFileSync } from 'node:fs';

import { BUILDING_ORDER, HERO_ORDER } from '../src/data/content';
import { Game } from '../src/core/game';
import { maxStartFloor, partyOf, relicYield } from '../src/core/stats';

const hours = Number(process.argv[2] ?? 6);
const dumpTo = process.argv[3];
const neverLeave = process.argv[4] === 'stay';
const game = new Game();
game.state.tutorialSeen = true;
game.state.policy.autoDive = true;
game.state.policy.targetFloor = 5;

let lastWipes = 0;
let bestSeen = 0;
let lastGain = 0;
let lastDives = 0;
const step = 0.25;
const total = hours * 3600;

function spend(): void {
  for (const id of HERO_ORDER) {
    if (!game.state.heroes[id].unlocked) game.recruit(id);
  }

  let bought = true;
  while (bought) {
    bought = false;
    const affordable = BUILDING_ORDER.map((id) => ({ id, cost: game.buildingCost(id) }))
      .filter((entry) => game.canAfford(entry.cost))
      .sort((a, b) => a.cost.coin - b.cost.coin);
    if (affordable.length > 0 && game.upgrade(affordable[0].id)) bought = true;

    for (const hero of partyOf(game.state)) {
      if (game.train(hero.id)) bought = true;
    }
  }

  if (game.mendCost() > 0 && game.state.bank.coin > game.mendCost() * 4) game.mend();

  // Give up the run only once the shaft stops giving ground.
  const stalled = !neverLeave && elapsed - lastGain > 25 * 60;
  if (stalled && relicYield(game.state) > 0 && game.state.run.phase === 'camp') {
    game.prestige();
    let spent = true;
    while (spent) {
      spent = false;
      for (const id of ['deepmark', 'guidestone', 'looteye', 'lampoil', 'knot', 'wakingcamp'] as const) {
        if (game.buyRelic(id)) spent = true;
      }
    }
    game.state.policy.targetFloor = 8;
    game.state.policy.startFloor = 1;
    bestSeen = 0;
    lastGain = elapsed;
    lastDives = game.state.totalDives;
    lastWipes = game.state.totalWipes;
  }
}

function steer(): void {
  const wiped = game.state.totalWipes > lastWipes;
  const dived = game.state.totalDives > lastDives;
  lastWipes = game.state.totalWipes;
  lastDives = game.state.totalDives;

  if (wiped) {
    game.state.policy.targetFloor = Math.max(3, Math.round(game.state.policy.targetFloor * 0.75));
  } else if (dived) {
    game.state.policy.targetFloor += 1;
  }
  if (game.state.deepestFloor > bestSeen) {
    bestSeen = game.state.deepestFloor;
    lastGain = elapsed;
  }

  // Skip the floors already proven, but never start past two thirds of them.
  const allowed = maxStartFloor(game.state);
  game.state.policy.startFloor = Math.max(1, Math.min(allowed, Math.floor(game.state.deepestBanked * 0.66)));
}

let elapsed = 0;
let nextReport = 0;
console.log('hour  floor  target  deepest  coin      iron    crystal  dives  routs  relics  party');
while (elapsed < total) {
  game.tick(step);
  elapsed += step;

  if (elapsed % 30 < step) {
    steer();
    spend();
  }

  if (elapsed >= nextReport) {
    nextReport += 1800;
    const state = game.state;
    console.log(
      [
        (elapsed / 3600).toFixed(1).padStart(4),
        String(state.run.floor).padStart(6),
        String(state.policy.targetFloor).padStart(7),
        String(state.deepestFloor).padStart(8),
        Math.round(state.bank.coin).toString().padStart(9),
        Math.round(state.bank.iron).toString().padStart(7),
        Math.round(state.bank.crystal).toString().padStart(8),
        String(state.totalDives).padStart(6),
        String(state.totalWipes).padStart(6),
        String(relicYield(state)).padStart(7),
        partyOf(state)
          .map((hero) => `${hero.id[0]}${hero.level}`)
          .join(' '),
      ].join('  '),
    );
  }
}

if (dumpTo) {
  game.state.lastSeen = Date.now();
  writeFileSync(dumpTo, JSON.stringify(game.state));
  console.log('wrote', dumpTo);
}
