import {
  AFFIXES,
  AFFIX_CHANCE,
  AFFIX_ORDER,
  ALL_FOES,
  ECHOES,
  BALANCE,
  BOON,
  KEEPER,
  SET_CHANCE,
  SET_ORDER,
  BUILDINGS,
  BUILDING_EFFECT,
  CONTRACT_ORDER,
  EVENT_CHANCE,
  EVENT_FIRST_FLOOR,
  EVENT_ORDER,
  EVENT_SECONDS,
  HEROES,
  HERO_ORDER,
  KINDS_BY_SLOT,
  MILESTONE,
  RARITIES,
  RARITY_ORDER,
  RELICS,
  RELIC_EFFECT,
  RISK,
  SLOTS,
  contractReward,
  contractTarget,
  isBossFloor,
  isEliteFloor,
  zoneForFloor,
  type ContractId,
} from '../data/content';
import { buildFoes, encounterOver, heroCombatant, makeFoe, stepCombat, type CombatEvent } from './combat';
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
  echoFortune,
  echoYield,
  maxStartFloor,
  xpForLevel,
} from './stats';
import type {
  BuildingId,
  Contract,
  EchoId,
  DiveReport,
  EventChoice,
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

function emptyReport(): DiveReport {
  return {
    at: 0,
    seconds: 0,
    from: 0,
    deepest: 0,
    floors: 0,
    fights: 0,
    risk: 0,
    coin: 0,
    iron: 0,
    crystal: 0,
    items: 0,
    hardest: 0,
    hardestBy: '',
    wiped: false,
    lost: 0,
  };
}

/** The day the contracts belong to, in UTC so it turns over everywhere at once. */
export function contractDay(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
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
    audio: { volume: 0.6, muted: false, effects: true, music: 0.35 },
    bank: { coin: 0, iron: 0, crystal: 0, relic: 0, echo: 0 },
    heroes,
    stash: [],
    buildings: { smithy: 0, armoury: 0, infirmary: 0, drillyard: 0, ropewright: 0, cartographer: 0 },
    relics: { deepmark: 0, looteye: 0, knot: 0, guidestone: 0, wakingcamp: 0, lampoil: 0 },
    echoes: { wellspring: 0, ironblood: 0, oldlamp: 0, firstlight: 0 },
    policy: {
      autoDive: true,
      startFloor: 1,
      targetFloor: 8,
      retreatHealth: 0.35,
      satchelLimit: 0,
      risk: 0,
      eventChoice: 'ask',
    },
    run: {
      phase: 'camp',
      manual: false,
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
      risk: 0,
      event: null,
      boon: null,
      report: emptyReport(),
    },
    deepestFloor: 0,
    deepestBanked: 1,
    totalDives: 0,
    totalWipes: 0,
    descents: 0,
    prestiges: 0,
    deepPrestiges: 0,
    lifetimeCoin: 0,
    playedSeconds: 0,
    lastSeen: Date.now(),
    nextUid: 1,
    tutorialSeen: false,
    shareMetrics: true,
    ladderName: '',
    contracts: { day: '', goals: [], streak: 0, best: 0 },
    achievements: {},
    bestiary: {},
    milestones: 0,
    lastDive: null,
    diveHistory: [],
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
  /** Extra danger the next encounter carries, from an ambush or a hoard. */
  private surge = 0;
  private surgeElite = false;
  /** Extra loot the next pile is worth, from a hoard or a warband. */
  private windfall = 0;

  constructor(state?: GameState) {
    this.state = state ?? freshState();
    this.rng = Rng.restore(this.state.run.seed);
    this.rollContracts();
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

  /** Maps shorten the walk between floors. */
  descendSeconds(): number {
    const shortcut = 1 + this.state.buildings.cartographer * BUILDING_EFFECT.cartographer;
    return Math.max(0.5, BALANCE.descendSeconds / shortcut);
  }

  climbSeconds(): number {
    const speed = 1 + this.state.buildings.ropewright * BUILDING_EFFECT.ropewright;
    return (this.run.climbFrom * BALANCE.climbSecondsPerFloor) / speed;
  }

  // -------------------------------------------------------------- run control

  beginDive(manual = false): void {
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
    this.run.manual = manual;
    this.run.phase = 'descending';
    this.run.phaseTimer = this.descendSeconds();
    this.run.risk = Math.max(0, Math.min(RISK.steps, Math.round(this.state.policy.risk)));
    this.run.event = null;
    this.run.boon = null;
    this.surge = 0;
    this.surgeElite = false;
    this.windfall = 0;

    this.run.report = emptyReport();
    this.run.report.at = Date.now();
    this.run.report.from = this.run.floor;
    this.run.report.deepest = this.run.floor;
    this.run.report.risk = this.run.risk;

    this.state.totalDives += 1;
    this.progressContract('dives', 1);
    this.note('log.dive.start', { floor: this.run.floor }, 'loud');
  }

  /** What the dial and any ambush are doing to the fight in front of the party. */
  private danger(): number {
    return 1 + this.run.risk * RISK.foe + this.surge;
  }

  /** What the dial and any blessing are doing to what the satchel picks up. */
  private fortune(): number {
    const boon = this.run.boon?.kind === 'loot' ? this.run.boon.power : 0;
    return (1 + this.run.risk * RISK.loot + boon) * (1 + this.windfall) * echoFortune(this.state);
  }

  extract(): void {
    if (this.run.phase === 'camp' || this.run.phase === 'climbing' || this.run.phase === 'wiped') return;
    this.run.event = null;
    this.run.climbFrom = this.run.floor;
    this.run.phase = 'climbing';
    this.run.phaseTimer = this.climbSeconds();
    this.note('log.climb.start', { floor: this.run.floor });
  }

  private startEncounter(): void {
    this.run.encounter += 1;
    this.run.foes = buildFoes(this.run.floor, this.run.encounter, this.rng, this.danger(), this.surgeElite);
    this.surge = 0;
    this.surgeElite = false;
    this.run.phase = 'fighting';
    this.syncPartyHealth();
    if (isBossFloor(this.run.floor) && this.run.encounter === BALANCE.encountersPerFloor) {
      this.note('log.boss', { name: `foe.${zoneForFloor(this.run.floor).boss}`, floor: this.run.floor }, 'loud');
    }
  }

  private syncPartyHealth(): void {
    const blessing = this.run.boon?.kind === 'attack' ? 1 + this.run.boon.power : 1;
    for (const fighter of this.run.party) {
      if (!fighter.hero) continue;
      const hero = this.state.heroes[fighter.hero];
      fighter.stats = heroStats(this.state, hero);
      if (blessing !== 1) fighter.stats = { ...fighter.stats, attack: Math.round(fighter.stats.attack * blessing * 10) / 10 };
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
    const boost = (1 + this.state.relics.looteye * RELIC_EFFECT.looteye) * this.fortune();
    this.windfall = 0;
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

    const dropChance = BALANCE.loot.itemChance * rank * (1 + this.run.risk * RISK.loot * 0.5);
    if (this.rng.chance(Math.min(0.85, dropChance))) {
      this.findItem(floor);
    }

    for (const fighter of this.run.party) {
      if (!fighter.hero || !fighter.alive) continue;
      const hero = this.state.heroes[fighter.hero];
      const xp = BALANCE.xp.base * BALANCE.xp.growth ** (floor - 1) * rank;
      const levels = grantXp(this.state, hero, xp);
      if (levels > 0) this.note('log.level', { name: `hero.${hero.id}.name`, level: hero.level }, 'good');
    }
  }

  /** Rolls one piece into the satchel and says so. */
  private findItem(floor: number): Item {
    const item = this.rollItem(floor);
    this.run.satchel.items.push(item);
    if (RARITY_ORDER.indexOf(item.rarity) >= 2) this.progressContract('loot', 1);
    if (item.rarity === 'fabled') this.award('fabled');
    this.note(
      'log.loot.item',
      { affix: item.affix ? `affix.${item.affix}` : '', rarity: `rarity.${item.rarity}`, kind: `kind.${item.kind}`, power: item.power },
      'good',
    );
    return item;
  }

  private rollItem(floor: number): Item {
    const rarity = this.rng.weighted(RARITY_ORDER, (id) => RARITIES[id].weight);
    const slot = this.rng.pick(SLOTS) as SlotId;
    const kind = this.rng.pick(KINDS_BY_SLOT[slot]);
    const power = Math.max(
      1,
      Math.round(
        BALANCE.loot.itemPower.base * BALANCE.loot.itemPower.growth ** floor * RARITIES[rarity].multiplier * this.rng.range(0.9, 1.1),
      ),
    );

    const item: Item = { uid: this.state.nextUid++, slot, kind, rarity, power, floor };

    // Rarity buys two things beyond raw power: a prefix, and a workshop mark
    // worth collecting a matching set of.
    const grade = RARITY_ORDER.indexOf(rarity);
    if (this.rng.chance(AFFIX_CHANCE.base + grade * AFFIX_CHANCE.perRarity)) {
      item.affix = this.rng.weighted(AFFIX_ORDER, (id) => AFFIXES[id].weight);
    }
    if (this.rng.chance(SET_CHANCE.base + grade * SET_CHANCE.perRarity)) {
      item.set = this.rng.pick(SET_ORDER);
    }
    return item;
  }

  // ----------------------------------------------------------------- events

  /**
   * Some floors hold something other than three fights. The party stops, and
   * either the player answers or the standing order does, so a shaft left
   * running overnight never waits on anybody.
   */
  private rollEvent(): boolean {
    if (this.run.floor < EVENT_FIRST_FLOOR) return false;
    if (!this.rng.chance(EVENT_CHANCE)) return false;

    const id = this.rng.pick(EVENT_ORDER);
    this.run.event = { id, floor: this.run.floor, timer: EVENT_SECONDS };
    this.run.phase = 'event';
    this.note(`log.event.${id}`, { floor: this.run.floor }, 'loud');

    const standing = this.state.policy.eventChoice;
    // Nobody is watching a replayed night, so the careful answer stands.
    if (this.quiet || standing !== 'ask') this.answerEvent(standing === 'bold' ? 'bold' : 'safe');
    return true;
  }

  answerEvent(choice: EventChoice): void {
    const event = this.run.event;
    if (!event || this.run.phase !== 'event') return;
    this.run.event = null;

    const floor = this.run.floor;
    const satchel = this.run.satchel;
    const scaled = (multiplier: number) =>
      Math.round(BALANCE.loot.coin.base * BALANCE.loot.coin.growth ** (floor - 1) * multiplier);

    switch (event.id) {
      case 'altar': {
        if (choice === 'bold') {
          const paid = Math.round(satchel.coin * BOON.altarCoinShare);
          satchel.coin -= paid;
          healParty(this.state, 1);
          this.run.boon = { kind: 'attack', power: BOON.altarAttack, floorsLeft: BOON.altarFloors };
          this.note('log.event.altar.bold', { coin: paid }, 'good');
        } else {
          healParty(this.state, 0.15);
          this.note('log.event.altar.safe', {});
        }
        break;
      }

      case 'trap': {
        if (choice === 'bold') {
          for (const hero of partyOf(this.state)) {
            hero.hp = Math.max(1, hero.hp - heroStats(this.state, hero).maxHp * BOON.trapDamage);
          }
          const crystal = Math.max(1, Math.round(floor / 6));
          satchel.crystal += crystal;
          this.findItem(floor);
          this.note('log.event.trap.bold', { crystal }, 'good');
        } else {
          const iron = Math.max(2, Math.round(floor * 1.4));
          satchel.iron += iron;
          this.note('log.event.trap.safe', { iron });
        }
        break;
      }

      case 'hoard': {
        if (choice === 'bold') {
          this.surge = 0.35;
          this.surgeElite = true;
          this.windfall = BOON.hoardLoot;
          this.note('log.event.hoard.bold', {}, 'loud');
        } else {
          const coin = scaled(2.5);
          satchel.coin += coin;
          this.note('log.event.hoard.safe', { coin });
        }
        break;
      }

      case 'warband': {
        if (choice === 'bold') {
          this.surge = BOON.warbandFoe;
          this.windfall = BOON.warbandLoot;
          this.note('log.event.warband.bold', {}, 'loud');
        } else {
          const lost = Math.round(satchel.coin * BOON.warbandFlightLoss);
          satchel.coin -= lost;
          this.note('log.event.warband.safe', { coin: lost }, 'bad');
          // Running means the whole floor is behind them.
          this.run.phase = 'descending';
          this.run.floor += 1;
          this.run.phaseTimer = this.descendSeconds();
          this.syncPartyHealth();
          return;
        }
        break;
      }
    }

    this.run.encounter = 0;
    this.startEncounter();
  }

  // -------------------------------------------------------------- contracts

  /** Three goals a day, sized against how deep this player has actually been. */
  rollContracts(): void {
    const today = contractDay();
    const contracts = this.state.contracts;
    if (contracts.day === today && contracts.goals.length === 3) return;

    // Anything finished but never collected is paid out before the day turns.
    for (const goal of contracts.goals) {
      if (!goal.claimed && goal.progress >= goal.target) this.claimContract(goal.id);
    }

    if (contracts.day !== '') {
      const done = contracts.goals.length > 0 && contracts.goals.every((goal) => goal.claimed);
      contracts.streak = done && contracts.day === contractDay(Date.now() - 86400000) ? contracts.streak + 1 : 0;
      contracts.best = Math.max(contracts.best, contracts.streak);
    }

    const deepest = Math.max(1, this.state.deepestBanked, this.state.deepestFloor);
    const pool = [...CONTRACT_ORDER];
    const goals: Contract[] = [];
    for (let index = 0; index < 3 && pool.length > 0; index += 1) {
      const [id] = pool.splice(Math.floor(this.rng.next() * pool.length), 1);
      goals.push({ id, target: contractTarget(id, deepest), progress: 0, claimed: false });
    }

    contracts.day = today;
    contracts.goals = goals;
  }

  private progressContract(id: ContractId, amount: number): void {
    for (const goal of this.state.contracts.goals) {
      if (goal.id !== id || goal.claimed) continue;
      goal.progress = Math.min(goal.target, goal.progress + amount);
    }
  }

  /** Depth is a high water mark rather than a running total. */
  private markContract(id: ContractId, value: number): void {
    for (const goal of this.state.contracts.goals) {
      if (goal.id !== id || goal.claimed) continue;
      goal.progress = Math.min(goal.target, Math.max(goal.progress, value));
    }
  }

  claimContract(id: string): boolean {
    const goal = this.state.contracts.goals.find((entry) => entry.id === id);
    if (!goal || goal.claimed || goal.progress < goal.target) return false;
    goal.claimed = true;

    const deepest = Math.max(1, this.state.deepestBanked, this.state.deepestFloor);
    const reward = contractReward(goal.id as ContractId, deepest);
    this.state.bank.coin += reward.coin;
    this.state.bank.iron += reward.iron;
    this.state.lifetimeCoin += reward.coin;
    this.note('log.contract', { name: `contract.${goal.id}.name`, coin: reward.coin, iron: reward.iron }, 'good');

    if (this.state.contracts.goals.every((entry) => entry.claimed)) {
      this.state.bank.relic += 1;
      this.note('log.contract.all', { relics: 1 }, 'loud');
    }
    return true;
  }

  // ----------------------------------------------------------- achievements

  private award(id: string): void {
    if (this.state.achievements[id]) return;
    this.state.achievements[id] = Date.now();
    this.note('log.achievement', { name: `achievement.${id}.name` }, 'loud');
  }

  /** Everything that can be read straight off the state, checked in one place. */
  private checkAchievements(): void {
    const state = this.state;
    if (state.deepestFloor >= 10) this.award('floor10');
    if (state.deepestFloor >= 25) this.award('floor25');
    if (state.deepestFloor >= 50) this.award('floor50');
    if (state.deepestFloor >= 75) this.award('floor75');
    if (state.lifetimeCoin >= 100000) this.award('coin100k');
    if (state.prestiges >= 1) this.award('prestige');
    if (HERO_ORDER.every((id) => state.heroes[id].unlocked)) this.award('fullparty');
    if (ALL_FOES.every((kind) => (state.bestiary[kind] ?? 0) > 0)) this.award('bestiary');
  }

  private updateMilestones(): void {
    const marks = Math.min(MILESTONE.maxSteps, Math.floor(this.state.deepestBanked / MILESTONE.everyFloors));
    if (marks <= this.state.milestones) return;
    this.state.milestones = marks;
    this.note('log.milestone', { floor: marks * MILESTONE.everyFloors }, 'loud');
  }

  // ------------------------------------------------------------ dive report

  private closeReport(wiped: boolean, lost: number): void {
    const report = this.run.report;
    report.wiped = wiped;
    report.lost = lost;
    report.deepest = Math.max(report.deepest, this.run.deepestThisRun);
    this.state.lastDive = { ...report };
    this.state.diveHistory.unshift({ ...report });
    if (this.state.diveHistory.length > 8) this.state.diveHistory.length = 8;
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

    const report = this.run.report;
    report.coin += satchel.coin;
    report.iron += satchel.iron;
    report.crystal += satchel.crystal;
    report.items += satchel.items.length;

    this.progressContract('bank', satchel.coin);
    this.markContract('depth', this.run.deepestThisRun);
    this.updateMilestones();
    this.award('firstclimb');
    if (this.run.deepestThisRun >= 20 && !report.wiped && report.fights > 0) this.award('clean20');
    if (this.run.risk >= RISK.steps && this.run.deepestThisRun >= 10) this.award('daring');
    this.checkAchievements();

    this.note(
      'log.bank',
      { coin: satchel.coin, iron: satchel.iron, crystal: satchel.crystal, floor: this.run.deepestThisRun },
      'good',
    );
    this.run.satchel = emptySatchel();
    this.closeReport(false, 0);
  }

  /** Equips an item when it beats what a hero carries, otherwise it waits in the stash. */
  private absorbItem(item: Item): void {
    let bestHero: Hero | null = null;
    let bestGain = 0;
    for (const hero of partyOf(this.state)) {
      const gain = itemScore(item) - itemScore(hero.gear[item.slot]);
      if (gain > bestGain) {
        bestGain = gain;
        bestHero = hero;
      }
    }
    if (bestHero) {
      const replaced = bestHero.gear[item.slot];
      bestHero.gear[item.slot] = item;
      this.note(
        'log.equip',
        {
          name: `hero.${bestHero.id}.name`,
          affix: item.affix ? `affix.${item.affix}` : '',
          kind: `kind.${item.kind}`,
          rarity: `rarity.${item.rarity}`,
          power: item.power,
        },
        'good',
      );
      if (replaced) this.stow(replaced);
      return;
    }
    this.stow(item);
    this.note('log.stow', {
      affix: item.affix ? `affix.${item.affix}` : '',
      kind: `kind.${item.kind}`,
      rarity: `rarity.${item.rarity}`,
      power: item.power,
    });
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
    const iron = this.scrapValue(item);
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
    const lost = Math.round(satchel.coin * (1 - kept));
    this.note('log.wipe', { floor: this.run.floor, lost }, 'bad');
    this.run.satchel = emptySatchel();
    this.run.phase = 'wiped';
    this.run.phaseTimer = BALANCE.wipePauseSeconds;
    this.run.boon = null;
    this.run.event = null;
    this.closeReport(true, lost);
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

  /**
   * Whether the party should break off the fight it is in. A hand pressed
   * descent is the player's own business, and so is a party that never set a
   * retreat level, but everyone else gets pulled out before they are lost.
   */
  private shouldFlee(): boolean {
    const policy = this.state.policy;
    if (this.run.manual || !policy.autoDive || policy.retreatHealth <= 0) return false;

    let current = 0;
    let total = 0;
    for (const fighter of this.run.party) {
      current += fighter.hp;
      total += fighter.stats.maxHp;
    }
    return total > 0 && current / total <= policy.retreatHealth;
  }

  /** What falls out of the satchel on the way out of a fight. */
  private dropWhileFleeing(): void {
    const satchel = this.run.satchel;
    const share = BALANCE.fleeLoss;
    const lost = Math.round(satchel.coin * share);

    satchel.coin -= lost;
    satchel.iron -= Math.round(satchel.iron * share);
    satchel.crystal -= Math.round(satchel.crystal * share);
    // One piece of gear, and it is the one they were most pleased with.
    if (satchel.items.length > 0 && this.rng.chance(share * 2)) {
      satchel.items.sort((a, b) => b.power - a.power);
      satchel.items.shift();
    }

    this.note('log.retreat.flee', { floor: this.run.floor, coin: lost }, 'bad');
  }

  private shouldTurnBack(): boolean {
    const policy = this.state.policy;
    // A descent the player started by hand keeps going until they say stop.
    if (this.run.manual) return false;
    if (!policy.autoDive) return true;
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
    if (run.phase !== 'camp') run.report.seconds += dt;

    switch (run.phase) {
      case 'camp': {
        const care = 1 + this.state.buildings.infirmary * BUILDING_EFFECT.infirmary;
        healParty(this.state, BALANCE.restHealPerSecond * dt * care);
        this.restWounds(dt * care);
        run.phaseTimer -= dt;
        if (this.state.policy.autoDive && run.phaseTimer <= 0) {
          const party = partyOf(this.state);
          const rested = party.every((hero) => hero.hp >= heroStats(this.state, hero).maxHp * 0.98);
          // Wounds compound: every rout adds one, each one costs stats, and a
          // weaker party is likelier to be routed again. Waiting for the worst
          // of them to close is what stops one bad dive turning into a night
          // of them.
          const patched = party.every((hero) => hero.wounds < 2);
          if (rested && patched) this.beginDive();
        }
        break;
      }

      case 'descending': {
        run.phaseTimer -= dt;
        if (run.phaseTimer <= 0) {
          this.state.descents += 1;
          this.harvest.floors += 1;
          run.report.floors += 1;
          run.deepestThisRun = Math.max(run.deepestThisRun, run.floor);
          run.report.deepest = Math.max(run.report.deepest, run.floor);
          this.state.deepestFloor = Math.max(this.state.deepestFloor, run.floor);
          this.harvest.deepest = Math.max(this.harvest.deepest, run.floor);
          this.checkAchievements();

          if (run.boon && run.boon.floorsLeft > 0) {
            run.boon.floorsLeft -= 1;
            if (run.boon.floorsLeft <= 0) run.boon = null;
          }

          run.encounter = 0;
          if (!this.rollEvent()) this.startEncounter();
        }
        break;
      }

      case 'event': {
        if (!run.event) {
          this.startEncounter();
          break;
        }
        run.event.timer -= dt;
        // Waiting forever is not an option for a game that runs unattended.
        if (run.event.timer <= 0) this.answerEvent('safe');
        break;
      }

      case 'fighting': {
        const events = stepCombat(run.party, run.foes, dt, this.rng);
        this.keeperBehaviour(events);
        if (!this.quiet && events.length > 0) this.events.push(...events);
        this.readFight(events);
        this.writeBackHealth();

        // Standing orders apply mid fight, not only between them. Waiting for
        // an encounter to end before honouring the retreat level is how a
        // party ends up dying on the same floor all night with nothing to show
        // for it, which is the one thing this game is not supposed to do.
        if (this.shouldFlee()) {
          this.dropWhileFleeing();
          this.extract();
          break;
        }

        const outcome = encounterOver(run.party, run.foes);
        if (outcome === 'won') {
          this.harvest.fights += 1;
          run.report.fights += 1;
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
            run.phaseTimer = this.descendSeconds();
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

  /**
   * What a floor keeper does between swings. The ward comes back up on a
   * clock, so a party that cannot break through it in fifteen seconds is not
   * getting through at all; the last third is fought at half again the
   * attack; and twice on the way down it calls somebody in.
   */
  private keeperBehaviour(events: CombatEvent[]): void {
    const run = this.run;
    const keeper = run.foes.find((foe) => foe.rank === 'boss' && foe.alive);
    if (!keeper || keeper.wardMax === undefined) return;

    const share = keeper.hp / Math.max(1, keeper.stats.maxHp);

    // Raised on the way down rather than on a clock, so a party that is
    // winning slowly still gets to finish.
    const raised = keeper.wardTimer ?? 0;
    if (raised < KEEPER.wardAt.length && share <= KEEPER.wardAt[raised]) {
      keeper.wardTimer = raised + 1;
      keeper.ward = keeper.wardMax;
      events.push({ kind: 'ward', key: keeper.key, amount: keeper.wardMax });
      this.note('log.keeper.ward', { name: keeper.nameKey }, 'bad');
    }
    if (!keeper.raged && share <= KEEPER.rageBelow) {
      keeper.raged = true;
      keeper.stats = {
        ...keeper.stats,
        attack: Math.round(keeper.stats.attack * (1 + KEEPER.rageAttack) * 10) / 10,
      };
      events.push({ kind: 'rage', key: keeper.key, amount: 0 });
      this.note('log.keeper.rage', { name: keeper.nameKey }, 'bad');
    }

    const called = keeper.summons ?? 0;
    if (called < KEEPER.summonAt.length && share <= KEEPER.summonAt[called] && run.foes.length < KEEPER.maxFoes) {
      keeper.summons = called + 1;
      const zone = zoneForFloor(run.floor);
      const kind = this.rng.pick(zone.foes);
      run.foes.push(makeFoe(kind, run.foes.length, 'common', run.floor, this.danger(), this.rng));
      events.push({ kind: 'summon', key: keeper.key, amount: 1 });
      this.note('log.keeper.summon', { name: keeper.nameKey, foe: `foe.${kind}` }, 'bad');
    }
  }

  /**
   * Reads a round of combat for everything the ledger cares about: what was
   * put down, and the hardest single blow anybody in the party landed.
   */
  private readFight(events: CombatEvent[]): void {
    for (const event of events) {
      if (event.kind === 'down' && event.key.startsWith('foe:')) {
        const kind = event.key.split(':')[2] ?? '';
        if (!kind) continue;
        this.state.bestiary[kind] = (this.state.bestiary[kind] ?? 0) + 1;
        const foe = this.run.foes.find((one) => one.key === event.key);
        if (foe?.rank === 'boss') {
          this.award('keeper');
          this.progressContract('keepers', 1);
        }
        continue;
      }
      if ((event.kind === 'hit' || event.kind === 'crit') && event.from?.startsWith('hero:')) {
        if (event.amount > this.run.report.hardest) {
          this.run.report.hardest = event.amount;
          this.run.report.hardestBy = event.from.slice(5);
        }
      }
    }
  }

  /** Replays the shaft while the tab was closed. */
  catchUp(seconds: number): Harvest {
    const capped = Math.min(seconds, offlineCapSeconds(this.state));
    this.harvest = emptyHarvest();
    // Short enough to be a hiccup rather than an absence.
    if (capped < 2) return this.harvest;

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
      // A record of what has been seen and done outlives the shaft itself.
      achievements: this.state.achievements,
      bestiary: this.state.bestiary,
      contracts: this.state.contracts,
      milestones: this.state.milestones,
      lastDive: this.state.lastDive,
      diveHistory: this.state.diveHistory,
    };

    const fresh = freshState();
    fresh.language = language;
    fresh.audio = audio;
    fresh.relics = keptRelics;
    fresh.bank.relic = relicBank;
    fresh.policy = policy;
    fresh.deepestBanked = deepestBanked;
    fresh.tutorialSeen = true;
    fresh.shareMetrics = this.state.shareMetrics;
    fresh.ladderName = this.state.ladderName;
    Object.assign(fresh, carried);
    fresh.deepestFloor = 0;

    this.state = fresh;
    this.rng = Rng.restore(fresh.run.seed);
    this.award('prestige');
    this.note('log.prestige', { relics: gain }, 'loud');
    return true;
  }

  // ------------------------------------------------------------------ echoes

  echoCost(id: EchoId): number {
    const definition = ECHOES[id];
    return Math.round(definition.cost * definition.costGrowth ** this.state.echoes[id]);
  }

  buyEcho(id: EchoId): boolean {
    if (this.state.echoes[id] >= ECHOES[id].maxRank) return false;
    const cost = this.echoCost(id);
    if (this.state.bank.echo < cost) return false;
    this.state.bank.echo -= cost;
    this.state.echoes[id] += 1;
    this.note('log.echo', { name: `echo.${id}.name`, rank: this.state.echoes[id] }, 'good');
    return true;
  }

  canDescendDeep(): boolean {
    return echoYield(this.state) > 0;
  }

  /**
   * The deep reset. It gives up the relics as well, which is the whole point:
   * the same currency stops moving the curve somewhere in the eighties, so the
   * only way further down is to trade the lot for something that never resets.
   */
  deepPrestige(): boolean {
    const gain = echoYield(this.state);
    if (gain <= 0) return false;

    const keptEchoes = { ...this.state.echoes };
    const echoBank = this.state.bank.echo + gain;
    const language = this.state.language;
    const audio = { ...this.state.audio };
    const policy = { ...this.state.policy };

    const carried = {
      prestiges: this.state.prestiges,
      deepPrestiges: this.state.deepPrestiges + 1,
      totalDives: this.state.totalDives,
      totalWipes: this.state.totalWipes,
      descents: this.state.descents,
      lifetimeCoin: this.state.lifetimeCoin,
      playedSeconds: this.state.playedSeconds,
      achievements: this.state.achievements,
      bestiary: this.state.bestiary,
      contracts: this.state.contracts,
      milestones: this.state.milestones,
      lastDive: this.state.lastDive,
      diveHistory: this.state.diveHistory,
      shareMetrics: this.state.shareMetrics,
      ladderName: this.state.ladderName,
    };

    const fresh = freshState();
    fresh.language = language;
    fresh.audio = audio;
    fresh.policy = policy;
    fresh.echoes = keptEchoes;
    fresh.bank.echo = echoBank;
    fresh.tutorialSeen = true;
    Object.assign(fresh, carried);
    fresh.deepestFloor = 0;
    fresh.deepestBanked = 1;

    this.state = fresh;
    this.rng = Rng.restore(fresh.run.seed);
    this.award('deepdive');
    this.note('log.deep', { echoes: gain }, 'loud');
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

  /** Iron a single piece is worth once melted down. */
  scrapValue(item: Item): number {
    return Math.max(1, Math.round(item.power * 0.35));
  }

  scrapItem(uid: number): number {
    const item = this.state.stash.find((entry) => entry.uid === uid);
    if (!item) return 0;
    this.state.stash = this.state.stash.filter((entry) => entry.uid !== uid);
    const iron = this.scrapValue(item);
    this.state.bank.iron += iron;
    return iron;
  }

  scrapStash(): number {
    let iron = 0;
    for (const item of this.state.stash) iron += this.scrapValue(item);
    this.state.bank.iron += iron;
    this.state.stash = [];
    return iron;
  }

  progressToNextLevel(hero: Hero): number {
    return Math.min(1, hero.xp / xpForLevel(hero.level));
  }
}
