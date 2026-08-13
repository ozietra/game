import {
  BALANCE,
  BUILDINGS,
  BUILDING_EFFECT,
  HEROES,
  HERO_ORDER,
  RARITIES,
  RARITY_ORDER,
  RELICS,
  RELIC_EFFECT,
  SLOTS,
  isBossFloor,
  isEliteFloor,
  zoneForFloor,
} from '../data/content';
import { buildFoes, encounterOver, heroCombatant, stepCombat, type CombatEvent } from './combat';
import { Rng } from './rng';
import {
  grantXp,
  healParty,
  heroStats,
  itemScore,
  masteryCost,
  offlineCapSeconds,
  partyOf,
  relicYield,
  maxStartFloor,
  xpForLevel,
} from './stats';
import type {
  BuildingId,
  GameState,
  Hero,
  HeroId,
  Item,
  LogEntry,
  RelicId,
  Satchel,
  SlotId,
} from './types';

export const SAVE_VERSION = 1;
const LOG_LIMIT = 90;
const STASH_LIMIT = 24;

export interface Harvest {
  coin: number;
  iron: number;
  crystal: number;
  items: number;
  floors: number;
  fights: number;
  wipes: number;
  deepest: number;
  seconds: number;
}

function emptySatchel(): Satchel {
  return { coin: 0, iron: 0, crystal: 0, items: [] };
}

function emptyHarvest(): Harvest {
  return { coin: 0, iron: 0, crystal: 0, items: 0, floors: 0, fights: 0, wipes: 0, deepest: 0, seconds: 0 };
}

function newHero(id: HeroId, unlocked: boolean): Hero {
  return {
    id,
    unlocked,
    level: 1,
    xp: 0,
    mastery: 0,
    wounds: 0,
    hp: HEROES[id].base.maxHp,
    gear: { weapon: null, armour: null, charm: null },
  };
}

export function freshState(): GameState {
  const heroes = {} as Record<HeroId, Hero>;
  for (const id of HERO_ORDER) heroes[id] = newHero(id, id === 'warden');

  return {
    version: SAVE_VERSION,
    language: 'tr',
    audio: { volume: 0.6, muted: false },
    bank: { coin: 0, iron: 0, crystal: 0, relic: 0 },
    heroes,
    stash: [],
    buildings: { smithy: 0, armoury: 0, infirmary: 0, drillyard: 0, ropewright: 0, cartographer: 0 },
    relics: { deepmark: 0, looteye: 0, knot: 0, guidestone: 0, wakingcamp: 0, lampoil: 0 },
    policy: { autoDive: true, startFloor: 1, targetFloor: 8, retreatHealth: 0.35, satchelLimit: 0 },
    run: {
      phase: 'camp',
      floor: 0,
      deepestThisRun: 0,
      encounter: 0,
      encountersOnFloor: BALANCE.encountersPerFloor,
      phaseTimer: 0,
      climbFrom: 0,
      satchel: emptySatchel(),
      party: [],
      foes: [],
      seed: Math.floor(Math.random() * 0xffffffff),
    },
    deepestFloor: 0,
    deepestBanked: 1,
    totalDives: 0,
    totalWipes: 0,
    descents: 0,
    prestiges: 0,
    lifetimeCoin: 0,
    playedSeconds: 0,
    lastSeen: Date.now(),
    nextUid: 1,
    tutorialSeen: false,
  };
}

export class Game {
  state: GameState;
  log: LogEntry[] = [];
  events: CombatEvent[] = [];
  harvest: Harvest = emptyHarvest();

  private rng: Rng;
  private logId = 1;
  private quiet = false;
  private woundRest = 0;

  constructor(state?: GameState) {
    this.state = state ?? freshState();
    this.rng = Rng.restore(this.state.run.seed);
  }

  // ---------------------------------------------------------------- logging

  private note(key: string, params: Record<string, string | number> = {}, tone: LogEntry['tone'] = 'plain'): void {
    if (this.quiet) return;
    this.log.unshift({ id: this.logId++, time: Date.now(), key, params, tone });
    if (this.log.length > LOG_LIMIT) this.log.length = LOG_LIMIT;
  }

  // ------------------------------------------------------------ derived bits

  get run() {
    return this.state.run;
  }

  satchelValue(): number {
    const satchel = this.run.satchel;
    let value = satchel.coin + satchel.iron * 12 + satchel.crystal * 60;
    for (const item of satchel.items) value += item.power * 6;
    return Math.round(value);
  }

  climbSeconds(): number {
    const speed = 1 + this.state.buildings.ropewright * BUILDING_EFFECT.ropewright;
    return (this.run.climbFrom * BALANCE.climbSecondsPerFloor) / speed;
  }

  // -------------------------------------------------------------- run control

  beginDive(): void {
    if (this.run.phase !== 'camp') return;
    const party = partyOf(this.state);
    if (party.length === 0) return;

    for (const hero of party) if (hero.hp <= 0) hero.hp = 1;

    this.run.floor = Math.max(1, Math.min(this.state.policy.startFloor, maxStartFloor(this.state)));
    this.run.deepestThisRun = this.run.floor;
    this.run.encounter = 0;
    this.run.satchel = emptySatchel();
    this.run.party = party.map((hero) => heroCombatant(this.state, hero));
    this.run.foes = [];
    this.run.phase = 'descending';
    this.run.phaseTimer = BALANCE.descendSeconds;
    this.state.totalDives += 1;
    this.note('log.dive.start', { floor: this.run.floor }, 'loud');
  }

  extract(): void {
    if (this.run.phase === 'camp' || this.run.phase === 'climbing' || this.run.phase === 'wiped') return;
    this.run.climbFrom = this.run.floor;
    this.run.phase = 'climbing';
    this.run.phaseTimer = this.climbSeconds();
    this.note('log.climb.start', { floor: this.run.floor });
  }

  private startEncounter(): void {
    this.run.encounter += 1;
    this.run.foes = buildFoes(this.run.floor, this.run.encounter, this.rng);
    this.run.phase = 'fighting';
    this.syncPartyHealth();
    if (isBossFloor(this.run.floor) && this.run.encounter === BALANCE.encountersPerFloor) {
      this.note('log.boss', { name: `foe.${zoneForFloor(this.run.floor).boss}`, floor: this.run.floor }, 'loud');
    }
  }

  private syncPartyHealth(): void {
    for (const fighter of this.run.party) {
      if (!fighter.hero) continue;
      const hero = this.state.heroes[fighter.hero];
      fighter.stats = heroStats(this.state, hero);
      fighter.hp = Math.min(fighter.stats.maxHp, Math.max(0, Math.round(hero.hp)));
      fighter.alive = fighter.hp > 0;
      if (!fighter.alive) fighter.action = 'down';
    }
  }

  private writeBackHealth(): void {
    for (const fighter of this.run.party) {
      if (!fighter.hero) continue;
      this.state.heroes[fighter.hero].hp = fighter.hp;
    }
  }

  // ------------------------------------------------------------------- loot

  private rollLoot(): void {
    const floor = this.run.floor;
    const zone = zoneForFloor(floor);
    const boost = 1 + this.state.relics.looteye * RELIC_EFFECT.looteye;
    const rank = isBossFloor(floor) ? 3.1 : isEliteFloor(floor) ? 1.7 : 1;

    const coin = Math.round(
      BALANCE.loot.coin.base * BALANCE.loot.coin.growth ** (floor - 1) * this.rng.range(0.85, 1.2) * boost * rank,
    );
    const iron = Math.round(
      BALANCE.loot.iron.base * BALANCE.loot.iron.growth ** (floor - 1) * this.rng.range(0.7, 1.3) * boost * rank,
    );
    const crystal =
      floor >= BALANCE.loot.crystalFromFloor && zone.drop === 'crystal'
        ? Math.round(
            BALANCE.loot.crystal.base *
              BALANCE.loot.crystal.growth ** (floor - BALANCE.loot.crystalFromFloor) *
              this.rng.range(0.6, 1.4) *
              boost *
              rank,
          )
        : 0;

    this.run.satchel.coin += coin;
    this.run.satchel.iron += iron;
    this.run.satchel.crystal += crystal;

    const dropChance = BALANCE.loot.itemChance * rank;
    if (this.rng.chance(Math.min(0.85, dropChance))) {
      const item = this.rollItem(floor);
      this.run.satchel.items.push(item);
      this.note('log.loot.item', { rarity: `rarity.${item.rarity}`, slot: `slot.${item.slot}`, power: item.power }, 'good');
    }

    for (const fighter of this.run.party) {
      if (!fighter.hero || !fighter.alive) continue;
      const hero = this.state.heroes[fighter.hero];
      const xp = BALANCE.xp.base * BALANCE.xp.growth ** (floor - 1) * rank;
      const levels = grantXp(this.state, hero, xp);
      if (levels > 0) this.note('log.level', { name: `hero.${hero.id}.name`, level: hero.level }, 'good');
    }
  }

  private rollItem(floor: number): Item {
    const rarity = this.rng.weighted(RARITY_ORDER, (id) => RARITIES[id].weight);
    const slot = this.rng.pick(SLOTS) as SlotId;
    const power = Math.max(
      1,
      Math.round(
        BALANCE.loot.itemPower.base * BALANCE.loot.itemPower.growth ** floor * RARITIES[rarity].multiplier * this.rng.range(0.9, 1.1),
      ),
    );
    return { uid: this.state.nextUid++, slot, rarity, power, floor };
  }

  private bankSatchel(): void {
    const satchel = this.run.satchel;
    this.state.bank.coin += satchel.coin;
    this.state.bank.iron += satchel.iron;
    this.state.bank.crystal += satchel.crystal;
    this.state.lifetimeCoin += satchel.coin;
    this.harvest.coin += satchel.coin;
    this.harvest.iron += satchel.iron;
    this.harvest.crystal += satchel.crystal;
    this.harvest.items += satchel.items.length;

    for (const item of satchel.items) this.absorbItem(item);
    this.state.deepestBanked = Math.max(this.state.deepestBanked, this.run.deepestThisRun);

    this.note(
      'log.bank',
      { coin: satchel.coin, iron: satchel.iron, crystal: satchel.crystal, floor: this.run.deepestThisRun },
      'good',
    );
    this.run.satchel = emptySatchel();
  }

  /** Equips an item when it beats what a hero carries, otherwise it waits in the stash. */
  private absorbItem(item: Item): void {
    let bestHero: Hero | null = null;
    let bestGain = 0;
    for (const hero of partyOf(this.state)) {
      const gain = item.power - itemScore(hero.gear[item.slot]);
      if (gain > bestGain) {
        bestGain = gain;
        bestHero = hero;
      }
    }
    if (bestHero) {
      const replaced = bestHero.gear[item.slot];
      bestHero.gear[item.slot] = item;
      if (replaced) this.stow(replaced);
      return;
    }
    this.stow(item);
  }

  /** The stash holds spare gear; anything past the shelf space is melted down. */
  private stow(item: Item): void {
    this.state.stash.push(item);
    if (this.state.stash.length <= STASH_LIMIT) return;
    this.state.stash.sort((a, b) => b.power - a.power);
    while (this.state.stash.length > STASH_LIMIT) {
      const dropped = this.state.stash.pop();
      if (dropped) this.salvage(dropped);
    }
  }

  private salvage(item: Item): void {
    const iron = Math.max(1, Math.round(item.power * 0.35));
    this.state.bank.iron += iron;
    this.harvest.iron += iron;
  }

  private wipe(): void {
    const satchel = this.run.satchel;
    const kept = Math.min(0.75, this.state.relics.knot * RELIC_EFFECT.knot);
    this.state.bank.coin += Math.floor(satchel.coin * kept);
    this.state.bank.iron += Math.floor(satchel.iron * kept);
    this.state.bank.crystal += Math.floor(satchel.crystal * kept);
    if (kept > 0) for (const item of satchel.items) if (this.rng.chance(kept)) this.absorbItem(item);

    for (const hero of partyOf(this.state)) {
      hero.wounds = Math.min(BALANCE.maxWounds, hero.wounds + 1);
      hero.hp = 1;
    }

    this.state.totalWipes += 1;
    this.harvest.wipes += 1;
    this.note('log.wipe', { floor: this.run.floor, lost: Math.round(satchel.coin * (1 - kept)) }, 'bad');
    this.run.satchel = emptySatchel();
    this.run.phase = 'wiped';
    this.run.phaseTimer = BALANCE.wipePauseSeconds;
  }

  /** Time in camp closes wounds without a healer's fee. */
  private restWounds(seconds: number): void {
    this.woundRest += seconds;
    while (this.woundRest >= BALANCE.woundRecoverySeconds) {
      this.woundRest -= BALANCE.woundRecoverySeconds;
      const hurt = partyOf(this.state).filter((hero) => hero.wounds > 0);
      if (hurt.length === 0) {
        this.woundRest = 0;
        break;
      }
      hurt.sort((a, b) => b.wounds - a.wounds)[0].wounds -= 1;
    }
  }

  private shouldTurnBack(): boolean {
    const policy = this.state.policy;
    if (this.run.floor >= policy.targetFloor) return true;

    let current = 0;
    let total = 0;
    for (const fighter of this.run.party) {
      current += fighter.hp;
      total += fighter.stats.maxHp;
    }
    if (total > 0 && current / total <= policy.retreatHealth) {
      this.note('log.retreat.health', { floor: this.run.floor });
      return true;
    }

    if (policy.satchelLimit > 0 && this.satchelValue() >= policy.satchelLimit) {
      this.note('log.retreat.satchel', { floor: this.run.floor });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- tick

  tick(dt: number): void {
    const run = this.run;
    this.state.playedSeconds += dt;
    this.harvest.seconds += dt;

    switch (run.phase) {
      case 'camp': {
        const care = 1 + this.state.buildings.infirmary * BUILDING_EFFECT.infirmary;
        healParty(this.state, BALANCE.restHealPerSecond * dt * care);
        this.restWounds(dt * care);
        run.phaseTimer -= dt;
        if (this.state.policy.autoDive && run.phaseTimer <= 0) {
          const party = partyOf(this.state);
          const ready = party.every((hero) => hero.hp >= heroStats(this.state, hero).maxHp * 0.98);
          if (ready) this.beginDive();
        }
        break;
      }

      case 'descending': {
        run.phaseTimer -= dt;
        if (run.phaseTimer <= 0) {
          this.state.descents += 1;
          this.harvest.floors += 1;
          run.deepestThisRun = Math.max(run.deepestThisRun, run.floor);
          this.state.deepestFloor = Math.max(this.state.deepestFloor, run.floor);
          this.harvest.deepest = Math.max(this.harvest.deepest, run.floor);
          run.encounter = 0;
          this.startEncounter();
        }
        break;
      }

      case 'fighting': {
        const events = stepCombat(run.party, run.foes, dt, this.rng);
        if (!this.quiet && events.length > 0) this.events.push(...events);
        this.writeBackHealth();

        const outcome = encounterOver(run.party, run.foes);
        if (outcome === 'won') {
          this.harvest.fights += 1;
          run.phase = 'looting';
          run.phaseTimer = BALANCE.lootSeconds;
          this.rollLoot();
          healParty(this.state, BALANCE.betweenFightHealing);
          this.syncPartyHealth();
        } else if (outcome === 'lost') {
          this.writeBackHealth();
          this.wipe();
        }
        break;
      }

      case 'looting': {
        run.phaseTimer -= dt;
        if (run.phaseTimer <= 0) {
          if (this.shouldTurnBack()) {
            this.extract();
          } else if (run.encounter < run.encountersOnFloor) {
            this.startEncounter();
          } else {
            run.floor += 1;
            run.phase = 'descending';
            run.phaseTimer = BALANCE.descendSeconds;
          }
        }
        break;
      }

      case 'climbing': {
        run.phaseTimer -= dt;
        if (run.phaseTimer <= 0) {
          this.bankSatchel();
          run.phase = 'camp';
          run.phaseTimer = BALANCE.campRestSeconds;
          run.foes = [];
          run.party = [];
        }
        break;
      }

      case 'wiped': {
        run.phaseTimer -= dt;
        if (run.phaseTimer <= 0) {
          run.phase = 'camp';
          run.phaseTimer = BALANCE.campRestSeconds;
          run.foes = [];
          run.party = [];
        }
        break;
      }
    }

    this.state.run.seed = this.rng.serialise();
  }

  /** Replays the shaft while the tab was closed. */
  catchUp(seconds: number): Harvest {
    const capped = Math.min(seconds, offlineCapSeconds(this.state));
    this.harvest = emptyHarvest();
    if (capped < 30) return this.harvest;

    this.quiet = true;
    const step = 0.2;
    let remaining = capped;
    let guard = 0;
    while (remaining > 0 && guard < 400000) {
      this.tick(step);
      remaining -= step;
      guard += 1;
    }
    this.quiet = false;
    this.harvest.seconds = capped;
    return this.harvest;
  }

  // ------------------------------------------------------- camp interactions

  buildingCost(id: BuildingId): { coin: number; iron: number; crystal: number } {
    const definition = BUILDINGS[id];
    const level = this.state.buildings[id];
    const scale = definition.cost.growth ** level;
    return {
      coin: Math.round(definition.cost.coin * scale),
      iron: Math.round((definition.cost.iron ?? 0) * scale),
      crystal: Math.round((definition.cost.crystal ?? 0) * scale),
    };
  }

  canAfford(cost: { coin: number; iron: number; crystal: number }): boolean {
    return (
      this.state.bank.coin >= cost.coin && this.state.bank.iron >= cost.iron && this.state.bank.crystal >= cost.crystal
    );
  }

  upgrade(id: BuildingId): boolean {
    const definition = BUILDINGS[id];
    if (this.state.buildings[id] >= definition.maxLevel) return false;
    const cost = this.buildingCost(id);
    if (!this.canAfford(cost)) return false;
    this.state.bank.coin -= cost.coin;
    this.state.bank.iron -= cost.iron;
    this.state.bank.crystal -= cost.crystal;
    this.state.buildings[id] += 1;
    this.note('log.build', { name: `building.${id}.name`, level: this.state.buildings[id] }, 'good');
    return true;
  }

  recruit(id: HeroId): boolean {
    const hero = this.state.heroes[id];
    if (hero.unlocked) return false;
    const cost = HEROES[id].cost;
    if (this.state.bank.coin < cost) return false;
    this.state.bank.coin -= cost;
    hero.unlocked = true;
    hero.hp = heroStats(this.state, hero).maxHp;
    this.note('log.recruit', { name: `hero.${id}.name` }, 'good');
    return true;
  }

  train(id: HeroId): boolean {
    const hero = this.state.heroes[id];
    if (!hero.unlocked) return false;
    const cost = masteryCost(hero);
    if (this.state.bank.coin < cost.coin || this.state.bank.iron < cost.iron) return false;
    this.state.bank.coin -= cost.coin;
    this.state.bank.iron -= cost.iron;
    hero.mastery += 1;
    this.note('log.train', { name: `hero.${id}.name`, rank: hero.mastery }, 'good');
    return true;
  }

  mendCost(): number {
    let wounds = 0;
    for (const hero of partyOf(this.state)) wounds += hero.wounds;
    return wounds === 0 ? 0 : Math.round(140 * wounds * 1.35 ** wounds);
  }

  mend(): boolean {
    const cost = this.mendCost();
    if (cost === 0 || this.state.bank.coin < cost) return false;
    this.state.bank.coin -= cost;
    for (const hero of partyOf(this.state)) hero.wounds = 0;
    this.note('log.mend', {}, 'good');
    return true;
  }

  relicCost(id: RelicId): number {
    const definition = RELICS[id];
    return Math.round(definition.cost * definition.costGrowth ** this.state.relics[id]);
  }

  buyRelic(id: RelicId): boolean {
    if (this.state.relics[id] >= RELICS[id].maxRank) return false;
    const cost = this.relicCost(id);
    if (this.state.bank.relic < cost) return false;
    this.state.bank.relic -= cost;
    this.state.relics[id] += 1;
    this.note('log.relic', { name: `relic.${id}.name`, rank: this.state.relics[id] }, 'good');
    return true;
  }

  canPrestige(): boolean {
    return relicYield(this.state) > 0;
  }

  prestige(): boolean {
    const gain = relicYield(this.state);
    if (gain <= 0) return false;

    const keptRelics = { ...this.state.relics };
    const relicBank = this.state.bank.relic + gain;
    const language = this.state.language;
    const audio = { ...this.state.audio };
    const policy = { ...this.state.policy };
    const deepestBanked = 1;

    const carried = {
      prestiges: this.state.prestiges + 1,
      totalDives: this.state.totalDives,
      totalWipes: this.state.totalWipes,
      descents: this.state.descents,
      lifetimeCoin: this.state.lifetimeCoin,
      playedSeconds: this.state.playedSeconds,
      deepestFloor: this.state.deepestFloor,
    };

    const fresh = freshState();
    fresh.language = language;
    fresh.audio = audio;
    fresh.relics = keptRelics;
    fresh.bank.relic = relicBank;
    fresh.policy = policy;
    fresh.deepestBanked = deepestBanked;
    fresh.tutorialSeen = true;
    Object.assign(fresh, carried);
    fresh.deepestFloor = 0;

    this.state = fresh;
    this.rng = Rng.restore(fresh.run.seed);
    this.note('log.prestige', { relics: gain }, 'loud');
    return true;
  }

  // ---------------------------------------------------------------- gear ops

  equip(heroId: HeroId, item: Item): void {
    const hero = this.state.heroes[heroId];
    const replaced = hero.gear[item.slot];
    hero.gear[item.slot] = item;
    this.state.stash = this.state.stash.filter((entry) => entry.uid !== item.uid);
    if (replaced) this.state.stash.push(replaced);
  }

  scrapStash(): number {
    let iron = 0;
    for (const item of this.state.stash) iron += Math.max(1, Math.round(item.power * 0.35));
    this.state.bank.iron += iron;
    this.state.stash = [];
    return iron;
  }

  progressToNextLevel(hero: Hero): number {
    return Math.min(1, hero.xp / xpForLevel(hero.level));
  }
}
