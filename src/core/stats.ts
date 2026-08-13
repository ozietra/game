import {
  AFFIXES,
  BALANCE,
  DEEP,
  ECHO_EFFECT,
  BUILDING_EFFECT,
  HEROES,
  ITEM_KINDS,
  KINDS_BY_SLOT,
  MILESTONE,
  RARITY_ORDER,
  RELIC_EFFECT,
  SETS,
  SLOTS,
  talentGain,
  type AffixId,
  type ItemKindId,
  type SetBonus,
  type SetId,
  type StatGain,
} from '../data/content';
import type { GameState, Hero, Item, Stats } from './types';

/** What a single item adds, already multiplied by its power. */
/** The sheet a hero is drawn from, and whether their kit is worth a glint. */
export function heroLook(hero: Hero): { sprite: string; gleam: boolean } {
  let best = -1;
  for (const slot of SLOTS) {
    const item = hero.gear[slot];
    if (item) best = Math.max(best, RARITY_ORDER.indexOf(item.rarity));
  }
  const tier = best >= 3 ? 2 : best >= 2 ? 1 : 0;
  return { sprite: tier === 0 ? hero.id : `${hero.id}_t${tier}`, gleam: best >= 4 };
}

export function itemGain(item: Item): StatGain {
  const kind = ITEM_KINDS[item.kind as ItemKindId] ?? ITEM_KINDS[KINDS_BY_SLOT[item.slot][0]];
  const gain: StatGain = {};
  for (const [stat, per] of Object.entries(kind.gain) as [keyof StatGain, number][]) {
    gain[stat] = per * item.power;
  }

  const affix = item.affix ? AFFIXES[item.affix as AffixId] : undefined;
  if (affix) {
    for (const [stat, per] of Object.entries(affix.gain) as [keyof StatGain, number][]) {
      gain[stat] = (gain[stat] ?? 0) + per * item.power;
    }
  }
  return gain;
}

/**
 * What a piece is worth when deciding who should wear it. Power is most of it;
 * a prefix and a workshop mark are worth a little more than the raw number
 * says, which is why they are not simply compared by power.
 */
export function itemScore(item: Item | null): number {
  if (!item) return 0;
  return Math.round(item.power * (1 + (item.affix ? 0.12 : 0) + (item.set ? 0.05 : 0)));
}

/** What a hero's matching pieces add up to. Two pays, three pays properly. */
export function setBonus(hero: Hero): SetBonus {
  const counts = new Map<string, number>();
  for (const slot of SLOTS) {
    const mark = hero.gear[slot]?.set;
    if (mark) counts.set(mark, (counts.get(mark) ?? 0) + 1);
  }

  const total: SetBonus = {};
  for (const [id, count] of counts) {
    const definition = SETS[id as SetId];
    if (!definition || count < 2) continue;
    const bonus = count >= 3 ? definition.three : definition.two;
    for (const [stat, value] of Object.entries(bonus) as [keyof SetBonus, number][]) {
      total[stat] = (total[stat] ?? 0) + value;
    }
  }
  return total;
}

/** Which sets a hero has going, and how far along each one is. */
export function setsWorn(hero: Hero): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const slot of SLOTS) {
    const mark = hero.gear[slot]?.set;
    if (mark) counts.set(mark, (counts.get(mark) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
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
  // Ten floor marks are knowledge of the shaft, kept through every reset.
  const marks = state.milestones ?? 0;

  const set = setBonus(hero);
  const ironblood = 1 + (state.echoes?.ironblood ?? 0) * ECHO_EFFECT.ironblood;
  const talents = talentGain(hero.id, hero.talents);

  maxHp =
    maxHp * mastery * armoury * deepmark * wounds * (1 + marks * MILESTONE.health) * (1 + (set.maxHp ?? 0)) * ironblood * (1 + (talents.maxHp ?? 0));
  attack = attack * mastery * smithy * deepmark * (1 + marks * MILESTONE.attack) * (1 + (set.attack ?? 0)) * (1 + (talents.attack ?? 0));
  defence = defence * mastery * armoury * deepmark * (1 + (set.defence ?? 0)) * (1 + (talents.defence ?? 0));
  speed += (set.speed ?? 0) + (talents.speed ?? 0);
  crit += (set.crit ?? 0) + (talents.crit ?? 0);

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

/**
 * Any floor the party has climbed back out of can be reached again, and relics
 * are knowledge they keep for good, so the shaft stays open that far down even
 * after everything else is left behind.
 */
export function maxStartFloor(state: GameState): number {
  const fromRelic = state.relics.guidestone * RELIC_EFFECT.guidestone;
  const fromEcho = (state.echoes?.firstlight ?? 0) * ECHO_EFFECT.firstlight;
  return Math.max(1, state.deepestBanked, fromRelic + fromEcho);
}

export function offlineCapSeconds(state: GameState): number {
  const lamp = (state.echoes?.oldlamp ?? 0) * ECHO_EFFECT.oldlamp;
  return (BALANCE.offlineHoursBase + state.relics.wakingcamp * RELIC_EFFECT.wakingcamp + lamp) * 3600;
}

export function relicYield(state: GameState): number {
  if (state.deepestFloor < BALANCE.prestige.minFloor) return 0;
  const raw = (state.deepestFloor / BALANCE.prestige.divisor) ** BALANCE.prestige.exponent;
  return Math.max(1, Math.floor(raw));
}

/** What the deep reset would pay right now, and zero until it is worth doing. */
export function echoYield(state: GameState): number {
  if (state.deepestFloor < DEEP.minFloor) return 0;
  return Math.max(1, Math.floor((state.deepestFloor / DEEP.divisor) ** DEEP.exponent));
}

/** Everything the satchel picks up is multiplied by this, once, on the way in. */
export function echoFortune(state: GameState): number {
  return 1 + (state.echoes?.wellspring ?? 0) * ECHO_EFFECT.wellspring;
}
