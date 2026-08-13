import {
  BALANCE,
  BUILDING_EFFECT,
  HEROES,
  ITEM_KINDS,
  KINDS_BY_SLOT,
  RELIC_EFFECT,
  SLOTS,
  type ItemKindId,
  type StatGain,
} from '../data/content';
import type { GameState, Hero, Item, Stats } from './types';

/** What a single item adds, already multiplied by its power. */
export function itemGain(item: Item): StatGain {
  const kind = ITEM_KINDS[item.kind as ItemKindId] ?? ITEM_KINDS[KINDS_BY_SLOT[item.slot][0]];
  const gain: StatGain = {};
  for (const [stat, per] of Object.entries(kind.gain) as [keyof StatGain, number][]) {
    gain[stat] = per * item.power;
  }
  return gain;
}

export function itemScore(item: Item | null): number {
  if (!item) return 0;
  return item.power;
}

export function heroStats(state: GameState, hero: Hero): Stats {
  const definition = HEROES[hero.id];
  const levels = hero.level - 1;

  let maxHp = definition.base.maxHp * definition.growth.maxHp ** levels;
  let attack = definition.base.attack * definition.growth.attack ** levels;
  let defence = definition.base.defence * definition.growth.defence ** levels;
  let speed = definition.base.speed;
  let crit = definition.base.crit;

  for (const slot of SLOTS) {
    const item = hero.gear[slot];
    if (!item) continue;
    const gain = itemGain(item);
    maxHp += gain.maxHp ?? 0;
    attack += gain.attack ?? 0;
    defence += gain.defence ?? 0;
    speed += gain.speed ?? 0;
    crit += gain.crit ?? 0;
  }

  const mastery = 1 + hero.mastery * 0.04;
  const smithy = 1 + state.buildings.smithy * BUILDING_EFFECT.smithy;
  const armoury = 1 + state.buildings.armoury * BUILDING_EFFECT.armoury;
  const deepmark = 1 + state.relics.deepmark * RELIC_EFFECT.deepmark;
  const wounds = Math.max(0.4, 1 - hero.wounds * BALANCE.woundPenalty);

  maxHp = maxHp * mastery * armoury * deepmark * wounds;
  attack = attack * mastery * smithy * deepmark;
  defence = defence * mastery * armoury * deepmark;

  return {
    maxHp: Math.round(maxHp),
    attack: Math.round(attack * 10) / 10,
    defence: Math.round(defence * 10) / 10,
    speed: Math.round(speed),
    crit: Math.min(0.6, crit),
  };
}

export function xpForLevel(level: number): number {
  return Math.round(BALANCE.xp.levelCost * BALANCE.xp.levelGrowth ** (level - 1));
}

export function grantXp(state: GameState, hero: Hero, amount: number): number {
  const bonus = 1 + state.buildings.drillyard * BUILDING_EFFECT.drillyard + state.relics.lampoil * RELIC_EFFECT.lampoil;
  hero.xp += amount * bonus;
  let gained = 0;
  while (hero.xp >= xpForLevel(hero.level)) {
    hero.xp -= xpForLevel(hero.level);
    hero.level += 1;
    gained += 1;
  }
  return gained;
}

export function masteryCost(hero: Hero): { coin: number; iron: number } {
  const rank = hero.mastery + 1;
  return {
    coin: Math.round(180 * 1.55 ** rank),
    iron: Math.round(16 * 1.46 ** rank),
  };
}

export function partyOf(state: GameState): Hero[] {
  return Object.values(state.heroes).filter((hero) => hero.unlocked);
}

export function partyHealthFraction(state: GameState): number {
  const party = partyOf(state);
  if (party.length === 0) return 1;
  let current = 0;
  let total = 0;
  for (const hero of party) {
    current += hero.hp;
    total += heroStats(state, hero).maxHp;
  }
  return total > 0 ? current / total : 1;
}

export function healParty(state: GameState, fraction: number): void {
  for (const hero of partyOf(state)) {
    const max = heroStats(state, hero).maxHp;
    hero.hp = Math.min(max, hero.hp + max * fraction);
  }
}

export function maxStartFloor(state: GameState): number {
  // Relics are knowledge the party keeps for good, so the shaft is always open
  // that far down. Maps drawn this run only reach as deep as this run has been.
  const fromRelic = state.relics.guidestone * RELIC_EFFECT.guidestone;
  const fromMap = Math.min(state.buildings.cartographer * BUILDING_EFFECT.cartographer, Math.max(0, state.deepestBanked - 1));
  return Math.max(1, fromRelic + fromMap);
}

export function offlineCapSeconds(state: GameState): number {
  return (BALANCE.offlineHoursBase + state.relics.wakingcamp * RELIC_EFFECT.wakingcamp) * 3600;
}

export function relicYield(state: GameState): number {
  if (state.deepestFloor < BALANCE.prestige.minFloor) return 0;
  const raw = (state.deepestFloor / BALANCE.prestige.divisor) ** BALANCE.prestige.exponent;
  return Math.max(1, Math.floor(raw));
}
