import type { BuildingId, EchoId, HeroId, RarityId, RelicId, ResourceId, SlotId } from '../core/types';

/** Every tuning number the simulation reads, in one place. */
export const BALANCE = {
  tickSeconds: 1 / 20,
  encountersPerFloor: 3,
  descendSeconds: 1.6,
  lootSeconds: 0.7,
  climbSecondsPerFloor: 0.28,
  campRestSeconds: 6,
  wipePauseSeconds: 5,
  betweenFightHealing: 0.1,
  woundRecoverySeconds: 55,
  restHealPerSecond: 0.09,
  offlineHoursBase: 4,
  offlineHoursPerRelic: 2,
  attackInterval: 1.45,
  critMultiplier: 1.8,
  guardWindow: 6,
  maxWounds: 5,
  woundPenalty: 0.08,
  foe: {
    health: { base: 42, growth: 1.138 },
    attack: { base: 6.2, growth: 1.126 },
    defence: { base: 1.6, growth: 1.1 },
    speed: 100,
    crit: 0.05,
  },
  loot: {
    coin: { base: 7, growth: 1.13 },
    iron: { base: 1.1, growth: 1.1 },
    crystalFromFloor: 21,
    crystal: { base: 0.5, growth: 1.08 },
    itemChance: 0.17,
    itemPower: { base: 4.5, growth: 1.095 },
  },
  xp: { base: 5.5, growth: 1.115, levelCost: 26, levelGrowth: 1.28 },
  prestige: { minFloor: 25, divisor: 9, exponent: 1.4 },
  /**
   * Breaking off mid fight is not free. A party that turns and runs drops part
   * of what it was carrying, which keeps the retreat level an actual decision:
   * set it high and bank a little every time, set it low and risk the lot.
   */
  fleeLoss: 0.25,
} as const;

/**
 * The risk dial. One lever moves what the shaft is worth and what it costs, so
 * a rout is the player's own decision rather than the depth curve's.
 */
export const RISK = {
  steps: 5,
  /** Added to foe health and attack per step. */
  foe: 0.2,
  /** Added to everything the satchel picks up per step. */
  loot: 0.34,
} as const;

/** Every fifth floor holds something other than three fights. */
export const EVENT_CHANCE = 0.2;
export const EVENT_SECONDS = 14;
export const EVENT_FIRST_FLOOR = 3;

export type EventId = 'altar' | 'trap' | 'hoard' | 'warband';

export const EVENT_ORDER: EventId[] = ['altar', 'trap', 'hoard', 'warband'];

export const EVENTS: Record<EventId, { icon: string; bold: string; safe: string }> = {
  altar: { icon: 'faith', bold: 'faith', safe: 'gate' },
  trap: { icon: 'fang', bold: 'pick', safe: 'gate' },
  hoard: { icon: 'hoard', bold: 'swords', safe: 'coin' },
  warband: { icon: 'tusk', bold: 'swords', safe: 'ascend' },
};

/** A blessing or a curse that rides along for the next few floors. */
export const BOON = {
  altarAttack: 0.28,
  altarFloors: 3,
  altarCoinShare: 0.3,
  trapDamage: 0.14,
  hoardLoot: 3,
  warbandFoe: 0.5,
  warbandLoot: 2,
  warbandFlightLoss: 0.2,
} as const;

/** Ten floors banked is worth keeping, whatever happens after it. */
export const MILESTONE = { everyFloors: 10, attack: 0.02, health: 0.02, maxSteps: 20 } as const;

export type ContractId = 'depth' | 'bank' | 'keepers' | 'dives' | 'loot';

export const CONTRACT_ORDER: ContractId[] = ['depth', 'bank', 'keepers', 'dives', 'loot'];

export const CONTRACTS: Record<ContractId, { icon: string }> = {
  depth: { icon: 'descend' },
  bank: { icon: 'coin' },
  keepers: { icon: 'keeper' },
  dives: { icon: 'gate' },
  loot: { icon: 'satchel' },
};

/** Three a day, sized against how deep the player has actually been. */
export function contractTarget(id: ContractId, deepest: number): number {
  const depth = Math.max(1, deepest);
  switch (id) {
    case 'depth':
      return Math.max(3, Math.round(depth * 0.85));
    case 'bank':
      return Math.max(200, Math.round(BALANCE.loot.coin.base * BALANCE.loot.coin.growth ** depth * 22));
    case 'keepers':
      return 2 + Math.floor(depth / 25);
    case 'dives':
      return 4 + Math.floor(depth / 18);
    case 'loot':
      return 3 + Math.floor(depth / 30);
  }
}

export function contractReward(id: ContractId, deepest: number): { coin: number; iron: number } {
  const depth = Math.max(1, deepest);
  const coin = Math.round(BALANCE.loot.coin.base * BALANCE.loot.coin.growth ** depth * 14);
  const iron = Math.round(BALANCE.loot.iron.base * BALANCE.loot.iron.growth ** depth * 12);
  const weight = id === 'depth' || id === 'keepers' ? 1.4 : 1;
  return { coin: Math.round(coin * weight), iron: Math.round(iron * weight) };
}

export type AchievementId =
  | 'firstclimb'
  | 'keeper'
  | 'floor10'
  | 'floor25'
  | 'floor50'
  | 'floor75'
  | 'fullparty'
  | 'fabled'
  | 'coin100k'
  | 'clean20'
  | 'daring'
  | 'prestige'
  | 'deepdive'
  | 'bestiary';

export const ACHIEVEMENTS: { id: AchievementId; icon: string }[] = [
  { id: 'firstclimb', icon: 'ascend' },
  { id: 'keeper', icon: 'keeper' },
  { id: 'floor10', icon: 'descend' },
  { id: 'floor25', icon: 'descend' },
  { id: 'floor50', icon: 'descend' },
  { id: 'floor75', icon: 'descend' },
  { id: 'fullparty', icon: 'swords' },
  { id: 'fabled', icon: 'relic' },
  { id: 'coin100k', icon: 'coin' },
  { id: 'clean20', icon: 'guard' },
  { id: 'daring', icon: 'wound' },
  { id: 'prestige', icon: 'relic' },
  { id: 'deepdive', icon: 'stone' },
  { id: 'bestiary', icon: 'ledger' },
];

export const ZONES = [
  { id: 'cellars', tiles: 'cellars', foes: ['rat', 'goblin', 'cutthroat', 'ambusher'], boss: 'boarman', drop: 'iron' },
  {
    id: 'catacombs',
    tiles: 'catacombs',
    foes: ['skeleton', 'revenant', 'gravewarden', 'skeleton_archer', 'stitched'],
    boss: 'bone_knight',
    drop: 'iron',
  },
  { id: 'warrens', tiles: 'warrens', foes: ['orc', 'boarman', 'wolfman', 'orc_spear'], boss: 'troll', drop: 'iron' },
  { id: 'seam', tiles: 'seam', foes: ['lizard', 'warlock', 'troll', 'hag'], boss: 'minotaur', drop: 'crystal' },
  {
    id: 'maw',
    tiles: 'maw',
    foes: ['minotaur', 'vampire', 'bone_knight', 'wartotaur'],
    boss: 'vampire',
    drop: 'crystal',
  },
] as const;

export type ZoneId = (typeof ZONES)[number]['id'];

/** Per-foe multipliers applied on top of the depth curve. */
export const FOES: Record<string, { health: number; attack: number; defence: number; speed: number }> = {
  rat: { health: 0.6, attack: 0.75, defence: 0.6, speed: 128 },
  goblin: { health: 0.8, attack: 0.95, defence: 0.8, speed: 110 },
  cutthroat: { health: 0.9, attack: 1.15, defence: 0.9, speed: 118 },
  ambusher: { health: 0.85, attack: 1.25, defence: 0.7, speed: 124 },
  skeleton_archer: { health: 0.9, attack: 1.35, defence: 0.8, speed: 112 },
  stitched: { health: 1.7, attack: 1.1, defence: 1, speed: 78 },
  orc_spear: { health: 1.25, attack: 1.3, defence: 1.15, speed: 100 },
  hag: { health: 1, attack: 1.45, defence: 0.8, speed: 104 },
  wartotaur: { health: 2.3, attack: 1.55, defence: 1.4, speed: 92 },
  skeleton: { health: 1, attack: 1, defence: 1.1, speed: 100 },
  revenant: { health: 1.35, attack: 0.9, defence: 0.9, speed: 84 },
  gravewarden: { health: 1.2, attack: 1.2, defence: 1.4, speed: 92 },
  orc: { health: 1.3, attack: 1.25, defence: 1, speed: 96 },
  boarman: { health: 1.5, attack: 1.15, defence: 1.1, speed: 90 },
  wolfman: { health: 1, attack: 1.3, defence: 0.8, speed: 132 },
  lizard: { health: 1.1, attack: 1.2, defence: 1.2, speed: 104 },
  warlock: { health: 0.9, attack: 1.5, defence: 0.7, speed: 96 },
  troll: { health: 1.9, attack: 1.3, defence: 1.2, speed: 82 },
  minotaur: { health: 2.1, attack: 1.5, defence: 1.3, speed: 94 },
  vampire: { health: 1.7, attack: 1.6, defence: 1.2, speed: 116 },
  bone_knight: { health: 2.2, attack: 1.4, defence: 1.7, speed: 88 },
};

export const BOSS_SCALE = { health: 3.4, attack: 1.35, defence: 1.2 };

/** The first floors pull their punches while a lone warden finds his feet. */
export function openingEase(floor: number): number {
  return Math.min(1, 0.58 + floor * 0.085);
}
export const ELITE_SCALE = { health: 1.9, attack: 1.15, defence: 1.1 };

export interface HeroDefinition {
  id: HeroId;
  icon: string;
  cost: number;
  taunt: number;
  base: { maxHp: number; attack: number; defence: number; speed: number; crit: number };
  growth: { maxHp: number; attack: number; defence: number };
  ability: {
    kind: 'bulwark' | 'pierce' | 'volley' | 'mend' | 'backstab' | 'rally' | 'fervour' | 'snare';
    cooldown: number;
    power: number;
    unlockLevel: number;
  };
}

export const HEROES: Record<HeroId, HeroDefinition> = {
  warden: {
    id: 'warden',
    icon: 'helm',
    cost: 0,
    taunt: 3,
    base: { maxHp: 128, attack: 11.5, defence: 11, speed: 94, crit: 0.05 },
    growth: { maxHp: 1.093, attack: 1.076, defence: 1.075 },
    ability: { kind: 'bulwark', cooldown: 17, power: 0.42, unlockLevel: 1 },
  },
  ranger: {
    id: 'ranger',
    icon: 'bow',
    cost: 220,
    taunt: 1,
    base: { maxHp: 74, attack: 17.5, defence: 4, speed: 122, crit: 0.14 },
    growth: { maxHp: 1.082, attack: 1.086, defence: 1.06 },
    ability: { kind: 'pierce', cooldown: 9, power: 2.6, unlockLevel: 1 },
  },
  magus: {
    id: 'magus',
    icon: 'spell',
    cost: 900,
    taunt: 1,
    base: { maxHp: 66, attack: 15, defence: 3, speed: 100, crit: 0.08 },
    growth: { maxHp: 1.08, attack: 1.088, defence: 1.055 },
    ability: { kind: 'volley', cooldown: 12, power: 1.35, unlockLevel: 1 },
  },
  cutpurse: {
    id: 'cutpurse',
    icon: 'wound',
    cost: 9000,
    taunt: 1,
    base: { maxHp: 78, attack: 19, defence: 4, speed: 130, crit: 0.2 },
    growth: { maxHp: 1.082, attack: 1.088, defence: 1.06 },
    ability: { kind: 'backstab', cooldown: 11, power: 3.4, unlockLevel: 1 },
  },
  preacher: {
    id: 'preacher',
    icon: 'faith',
    cost: 2600,
    taunt: 1,
    base: { maxHp: 96, attack: 10, defence: 7, speed: 100, crit: 0.05 },
    growth: { maxHp: 1.088, attack: 1.072, defence: 1.07 },
    ability: { kind: 'mend', cooldown: 10, power: 0.3, unlockLevel: 1 },
  },
  // The three who come later, each doing something the first five cannot.
  sentinel: {
    id: 'sentinel',
    icon: 'guard',
    cost: 26000,
    taunt: 2,
    base: { maxHp: 116, attack: 13, defence: 9, speed: 98, crit: 0.06 },
    growth: { maxHp: 1.089, attack: 1.079, defence: 1.072 },
    ability: { kind: 'rally', cooldown: 26, power: 0.4, unlockLevel: 1 },
  },
  zealot: {
    id: 'zealot',
    icon: 'faith',
    cost: 62000,
    taunt: 1,
    base: { maxHp: 88, attack: 19, defence: 5, speed: 104, crit: 0.1 },
    growth: { maxHp: 1.083, attack: 1.09, defence: 1.058 },
    ability: { kind: 'fervour', cooldown: 14, power: 1.7, unlockLevel: 1 },
  },
  tinker: {
    id: 'tinker',
    icon: 'gear',
    cost: 145000,
    taunt: 1,
    base: { maxHp: 78, attack: 14.5, defence: 5, speed: 112, crit: 0.11 },
    growth: { maxHp: 1.081, attack: 1.083, defence: 1.06 },
    ability: { kind: 'snare', cooldown: 18, power: 0.3, unlockLevel: 1 },
  },
};

export const HERO_ORDER: HeroId[] = [
  'warden',
  'ranger',
  'magus',
  'preacher',
  'cutpurse',
  'sentinel',
  'zealot',
  'tinker',
];

export const SLOTS: SlotId[] = ['weapon', 'armour', 'charm'];

export const RARITIES: Record<RarityId, { weight: number; multiplier: number; shade: string }> = {
  worn: { weight: 100, multiplier: 1, shade: '#8b8377' },
  sound: { weight: 46, multiplier: 1.28, shade: '#7f9d76' },
  master: { weight: 17, multiplier: 1.66, shade: '#6f92b8' },
  ancient: { weight: 5, multiplier: 2.2, shade: '#a583c4' },
  fabled: { weight: 1.1, multiplier: 3.05, shade: '#c8a24a' },
};

export const RARITY_ORDER: RarityId[] = ['worn', 'sound', 'master', 'ancient', 'fabled'];

export type ItemKindId =
  | 'blade'
  | 'axe'
  | 'spear'
  | 'bow'
  | 'rod'
  | 'leather'
  | 'mail'
  | 'plate'
  | 'robe'
  | 'amulet'
  | 'ring'
  | 'talisman';

export interface StatGain {
  maxHp?: number;
  attack?: number;
  defence?: number;
  speed?: number;
  crit?: number;
}

/**
 * What one point of item power is worth, per kind of gear. Every kind adds up
 * to roughly the same total, so the choice is about shape rather than size.
 */
export const ITEM_KINDS: Record<ItemKindId, { slot: SlotId; gain: StatGain }> = {
  blade: { slot: 'weapon', gain: { attack: 1, crit: 0.0006 } },
  axe: { slot: 'weapon', gain: { attack: 1.22, speed: -0.12 } },
  spear: { slot: 'weapon', gain: { attack: 0.95, defence: 0.22 } },
  bow: { slot: 'weapon', gain: { attack: 0.9, crit: 0.0018 } },
  rod: { slot: 'weapon', gain: { attack: 0.85, maxHp: 0.9 } },
  leather: { slot: 'armour', gain: { maxHp: 2.2, defence: 0.45, speed: 0.12 } },
  mail: { slot: 'armour', gain: { maxHp: 2.6, defence: 0.62 } },
  plate: { slot: 'armour', gain: { maxHp: 3, defence: 0.85, speed: -0.14 } },
  robe: { slot: 'armour', gain: { maxHp: 2, defence: 0.35, crit: 0.0009 } },
  amulet: { slot: 'charm', gain: { speed: 0.5, crit: 0.002, attack: 0.25 } },
  ring: { slot: 'charm', gain: { crit: 0.0032, attack: 0.3 } },
  talisman: { slot: 'charm', gain: { maxHp: 1.1, defence: 0.3, speed: 0.3 } },
};

/**
 * A prefix hangs one more stat on a piece, on top of whatever its kind already
 * gives. The numbers are per point of power, same as the kinds above, so a
 * cruel blade is worth about a fifth again in attack.
 */
export type AffixId = 'cruel' | 'bear' | 'warded' | 'swift' | 'keen' | 'grim';

export const AFFIXES: Record<AffixId, { gain: StatGain; weight: number }> = {
  cruel: { gain: { attack: 0.18 }, weight: 22 },
  bear: { gain: { maxHp: 0.85 }, weight: 22 },
  warded: { gain: { defence: 0.16 }, weight: 20 },
  swift: { gain: { speed: 0.07 }, weight: 15 },
  keen: { gain: { crit: 0.0007 }, weight: 12 },
  grim: { gain: { attack: 0.11, maxHp: 0.35 }, weight: 9 },
};

export const AFFIX_ORDER: AffixId[] = ['cruel', 'bear', 'warded', 'swift', 'keen', 'grim'];

/**
 * A suffix says which workshop a piece came out of. Two from the same one on
 * the same hero start paying, three pay properly. Health, attack and defence
 * are fractions of the total; speed and crit are added outright.
 */
export type SetId = 'wellwork' | 'gravewrought' | 'emberforged' | 'huntsman';

export interface SetBonus {
  attack?: number;
  defence?: number;
  maxHp?: number;
  speed?: number;
  crit?: number;
}

export const SETS: Record<SetId, { two: SetBonus; three: SetBonus }> = {
  wellwork: { two: { maxHp: 0.07 }, three: { maxHp: 0.16, defence: 0.1 } },
  gravewrought: { two: { defence: 0.1 }, three: { defence: 0.22, maxHp: 0.08 } },
  emberforged: { two: { attack: 0.07 }, three: { attack: 0.17, crit: 0.02 } },
  huntsman: { two: { speed: 5 }, three: { speed: 12, crit: 0.03 } },
};

export const SET_ORDER: SetId[] = ['wellwork', 'gravewrought', 'emberforged', 'huntsman'];

/** Better pieces carry more of both, which is most of what rarity buys. */
export const AFFIX_CHANCE = { base: 0.22, perRarity: 0.13 } as const;
export const SET_CHANCE = { base: 0.12, perRarity: 0.09 } as const;

/**
 * What a floor keeper does that an ordinary foe does not: it raises a ward
 * that has to be broken through again, it fights harder as it dies, and it
 * calls for help twice.
 */
export const KEEPER = {
  ward: 0.2,
  /**
   * The ward comes back when the keeper's health crosses these, and never on a
   * clock. A ward on a timer can outlast a party that is winning slowly, which
   * turns a hard fight into one that cannot be finished at all: the shaft is
   * supposed to be a decision about how deep to go, not a wall that eats an
   * evening. Three wards, then it is a fair fight.
   */
  wardAt: [0.7, 0.4],
  rageBelow: 0.35,
  rageAttack: 0.5,
  summonAt: [0.62, 0.31],
  maxFoes: 5,
} as const;

export const KINDS_BY_SLOT: Record<SlotId, ItemKindId[]> = {
  weapon: ['blade', 'axe', 'spear', 'bow', 'rod'],
  armour: ['leather', 'mail', 'plate', 'robe'],
  charm: ['amulet', 'ring', 'talisman'],
};

export interface BuildingDefinition {
  id: BuildingId;
  icon: string;
  maxLevel: number;
  cost: { coin: number; iron?: number; crystal?: number; growth: number };
}

export const BUILDINGS: Record<BuildingId, BuildingDefinition> = {
  smithy: { id: 'smithy', icon: 'blade', maxLevel: 120, cost: { coin: 120, iron: 20, growth: 1.42 } },
  armoury: { id: 'armoury', icon: 'guard', maxLevel: 120, cost: { coin: 140, iron: 24, growth: 1.44 } },
  infirmary: { id: 'infirmary', icon: 'vitals', maxLevel: 50, cost: { coin: 200, iron: 14, growth: 1.5 } },
  drillyard: { id: 'drillyard', icon: 'talent', maxLevel: 60, cost: { coin: 260, iron: 30, growth: 1.52 } },
  ropewright: { id: 'ropewright', icon: 'ascend', maxLevel: 40, cost: { coin: 340, iron: 40, crystal: 2, growth: 1.6 } },
  cartographer: { id: 'cartographer', icon: 'gate', maxLevel: 60, cost: { coin: 500, crystal: 4, growth: 1.66 } },
};

export const BUILDING_ORDER: BuildingId[] = [
  'smithy',
  'armoury',
  'infirmary',
  'drillyard',
  'ropewright',
  'cartographer',
];

/** Effect per building level. */
export const BUILDING_EFFECT = {
  smithy: 0.05,
  armoury: 0.05,
  infirmary: 0.03,
  drillyard: 0.06,
  ropewright: 0.035,
  cartographer: 0.06,
} as const;

export interface RelicDefinition {
  id: RelicId;
  icon: string;
  maxRank: number;
  cost: number;
  costGrowth: number;
}

export const RELICS: Record<RelicId, RelicDefinition> = {
  deepmark: { id: 'deepmark', icon: 'rank', maxRank: 25, cost: 1, costGrowth: 1.4 },
  looteye: { id: 'looteye', icon: 'coin', maxRank: 25, cost: 1, costGrowth: 1.5 },
  knot: { id: 'knot', icon: 'satchel', maxRank: 5, cost: 3, costGrowth: 2.1 },
  guidestone: { id: 'guidestone', icon: 'gate', maxRank: 20, cost: 2, costGrowth: 1.62 },
  wakingcamp: { id: 'wakingcamp', icon: 'camp', maxRank: 10, cost: 2, costGrowth: 1.7 },
  lampoil: { id: 'lampoil', icon: 'talent', maxRank: 15, cost: 1, costGrowth: 1.5 },
};

export const RELIC_ORDER: RelicId[] = ['deepmark', 'looteye', 'knot', 'guidestone', 'wakingcamp', 'lampoil'];

export const RELIC_EFFECT = {
  deepmark: 0.15,
  looteye: 0.2,
  knot: 0.15,
  guidestone: 5,
  wakingcamp: BALANCE.offlineHoursPerRelic,
  lampoil: 0.2,
} as const;

/**
 * The second reset. Relics make each run start stronger, and eventually that
 * stops mattering: the depth curve flattens somewhere in the eighties and no
 * amount of the same currency moves it. Going deep gives up the relics too and
 * pays in echoes, which nothing takes back.
 */
export const DEEP = { minFloor: 60, divisor: 26, exponent: 1.25 } as const;

export interface EchoDefinition {
  id: EchoId;
  icon: string;
  maxRank: number;
  cost: number;
  costGrowth: number;
}

export const ECHOES: Record<EchoId, EchoDefinition> = {
  wellspring: { id: 'wellspring', icon: 'coin', maxRank: 20, cost: 1, costGrowth: 1.85 },
  ironblood: { id: 'ironblood', icon: 'vitals', maxRank: 20, cost: 1, costGrowth: 1.85 },
  oldlamp: { id: 'oldlamp', icon: 'ember', maxRank: 10, cost: 2, costGrowth: 2.2 },
  firstlight: { id: 'firstlight', icon: 'descend', maxRank: 15, cost: 2, costGrowth: 2 },
};

export const ECHO_ORDER: EchoId[] = ['wellspring', 'ironblood', 'oldlamp', 'firstlight'];

export const ECHO_EFFECT = {
  wellspring: 0.08,
  ironblood: 0.06,
  oldlamp: 1,
  firstlight: 3,
} as const;

export const RESOURCE_ICONS: Record<ResourceId, string> = {
  coin: 'coin',
  iron: 'ingot',
  crystal: 'crystal',
  relic: 'relic',
};

export function zoneForFloor(floor: number): (typeof ZONES)[number] {
  const index = Math.floor((Math.max(1, floor) - 1) / 10) % ZONES.length;
  return ZONES[index];
}

/** How many times the shaft has looped past the last zone. */
export function cycleForFloor(floor: number): number {
  return Math.floor((Math.max(1, floor) - 1) / (10 * ZONES.length));
}

export function isBossFloor(floor: number): boolean {
  return floor % 10 === 0;
}

export function isEliteFloor(floor: number): boolean {
  return floor % 5 === 0 && !isBossFloor(floor);
}

/** Every foe the shaft can produce, which is the bestiary's denominator. */
export const ALL_FOES: string[] = [...new Set(ZONES.flatMap((zone) => [...zone.foes, zone.boss]))];

/** Where a foe is first met, so the bestiary can be read in shaft order. */
export const FOE_ORDER: string[] = ALL_FOES.slice().sort((a, b) => {
  const depth = (kind: string) => {
    const index = ZONES.findIndex((zone) => (zone.foes as readonly string[]).includes(kind) || zone.boss === kind);
    return index < 0 ? ZONES.length : index;
  };
  return depth(a) - depth(b) || a.localeCompare(b);
});

// ---------------------------------------------------------------- talents

/**
 * Talents are the only place two players' parties genuinely diverge. Every
 * hero gets three forks, at level five, twelve and twenty two, and the last
 * one is theirs alone. A pick is permanent: a fork nobody can walk back is a
 * decision, and a decision is the point.
 */
export interface TalentGain {
  attack?: number;
  maxHp?: number;
  defence?: number;
  speed?: number;
  crit?: number;
  /** Multiplies what the hero's ability does. */
  power?: number;
  /** Cuts the wait between uses of it. */
  haste?: number;
}

/**
 * A talent that changes how a hero fights rather than how large their numbers
 * are. Every one of these is resolved in the combat step, so a party built
 * around them plays differently instead of merely hitting harder.
 */
export type TalentEffectKind =
  /** Returns a share of every blow taken to whoever threw it. */
  | 'thorns'
  /** Heals the striker for a share of the damage they land. */
  | 'leech'
  /** Hits harder against anything already down to a third health. */
  | 'execute'
  /** The first blow of every encounter lands heavier. */
  | 'opener'
  /** Walks into each encounter behind a shield worth this much health. */
  | 'aegis'
  /** Once an encounter, refuses to fall and gets back up on this much. */
  | 'secondwind'
  /** Walks in with the knack already charged. */
  | 'primed'
  /** A chance to swing twice off one wind up. */
  | 'flurry';

export type TalentEffects = Partial<Record<TalentEffectKind, number>>;

/**
 * Which of the three columns a talent sits in. Lines matter twice: they lay
 * the tree out, and the crowning talents ask for two picks from their own line
 * before they open. Four picks across three lines means one line always
 * reaches two, so nobody is ever locked out of the last row entirely.
 */
export type TalentLine = 'might' | 'guard' | 'craft';

export const TALENT_LINES: readonly TalentLine[] = ['might', 'guard', 'craft'] as const;

export interface TalentDefinition {
  id: string;
  icon: string;
  line: TalentLine;
  gain: TalentGain;
  effect?: { kind: TalentEffectKind; value: number };
  /** Picks needed in this talent's own line before it can be taken. */
  needs?: number;
}

export const TALENT_LEVELS = [4, 9, 15, 23, 32] as const;

/** How much of its own line a crowning talent asks for. */
export const CAPSTONE_NEEDS = 2;

export const TALENTS: Record<string, TalentDefinition> = {
  // ------------------------------------------------------------------ might
  keenedge: { id: 'keenedge', icon: 'blade', line: 'might', gain: { attack: 0.12 } },
  sharpeye: { id: 'sharpeye', icon: 'bow', line: 'might', gain: { crit: 0.05 } },
  savage: { id: 'savage', icon: 'fang', line: 'might', gain: { attack: 0.08, crit: 0.03 } },
  quickstep: { id: 'quickstep', icon: 'talent', line: 'might', gain: { speed: 10 } },
  bloodlet: { id: 'bloodlet', icon: 'fang', line: 'might', gain: { attack: 0.05 }, effect: { kind: 'leech', value: 0.08 } },
  finisher: { id: 'finisher', icon: 'blade', line: 'might', gain: {}, effect: { kind: 'execute', value: 0.4 } },
  ambusher: { id: 'ambusher', icon: 'swords', line: 'might', gain: { crit: 0.03 }, effect: { kind: 'opener', value: 0.6 } },
  flurried: { id: 'flurried', icon: 'swords', line: 'might', gain: {}, effect: { kind: 'flurry', value: 0.14 } },

  // ------------------------------------------------------------------ guard
  ironhide: { id: 'ironhide', icon: 'vitals', line: 'guard', gain: { maxHp: 0.14 } },
  bulwarked: { id: 'bulwarked', icon: 'guard', line: 'guard', gain: { defence: 0.18 } },
  hardened: { id: 'hardened', icon: 'helm', line: 'guard', gain: { maxHp: 0.08, defence: 0.08 } },
  stalwart: { id: 'stalwart', icon: 'stone', line: 'guard', gain: { maxHp: 0.18, speed: -4 } },
  briarmail: { id: 'briarmail', icon: 'fang', line: 'guard', gain: { defence: 0.06 }, effect: { kind: 'thorns', value: 0.18 } },
  wardstone: { id: 'wardstone', icon: 'stone', line: 'guard', gain: {}, effect: { kind: 'aegis', value: 0.18 } },
  gravewalk: { id: 'gravewalk', icon: 'grave', line: 'guard', gain: { maxHp: 0.05 }, effect: { kind: 'secondwind', value: 0.3 } },

  // ------------------------------------------------------------------ craft
  channelled: { id: 'channelled', icon: 'spell', line: 'craft', gain: { power: 0.3 } },
  deepbreath: { id: 'deepbreath', icon: 'ember', line: 'craft', gain: { haste: 0.2 } },
  focused: { id: 'focused', icon: 'rank', line: 'craft', gain: { power: 0.18, haste: 0.1 } },
  relentless: { id: 'relentless', icon: 'swords', line: 'craft', gain: { speed: 6, haste: 0.1 } },
  forethought: { id: 'forethought', icon: 'ledger', line: 'craft', gain: { power: 0.1 }, effect: { kind: 'primed', value: 1 } },
  attuned: { id: 'attuned', icon: 'crystal', line: 'craft', gain: { power: 0.22, crit: 0.02 } },

  // -------------------------------------------------- crowning, one per hero
  lastwall: { id: 'lastwall', icon: 'guard', line: 'guard', gain: { defence: 0.35, maxHp: 0.12 }, needs: CAPSTONE_NEEDS },
  heartseeker: { id: 'heartseeker', icon: 'bow', line: 'might', gain: { crit: 0.1, power: 0.35 }, needs: CAPSTONE_NEEDS },
  firestorm: { id: 'firestorm', icon: 'ember', line: 'craft', gain: { power: 0.45 }, needs: CAPSTONE_NEEDS },
  evensong: { id: 'evensong', icon: 'faith', line: 'craft', gain: { power: 0.4, haste: 0.15 }, needs: CAPSTONE_NEEDS },
  throatcut: { id: 'throatcut', icon: 'blade', line: 'might', gain: { attack: 0.18, crit: 0.08 }, needs: CAPSTONE_NEEDS },
  standfast: { id: 'standfast', icon: 'guard', line: 'guard', gain: { power: 0.5, maxHp: 0.12 }, needs: CAPSTONE_NEEDS },
  martyr: { id: 'martyr', icon: 'faith', line: 'might', gain: { attack: 0.22, maxHp: 0.15 }, needs: CAPSTONE_NEEDS },
  clockwork: { id: 'clockwork', icon: 'gear', line: 'craft', gain: { haste: 0.3, speed: 8 }, needs: CAPSTONE_NEEDS },

  // ------------------------------------ crowning, shared across the eight
  headsman: {
    id: 'headsman',
    icon: 'fang',
    line: 'might',
    gain: { attack: 0.14 },
    effect: { kind: 'execute', value: 0.7 },
    needs: CAPSTONE_NEEDS,
  },
  bloodoath: {
    id: 'bloodoath',
    icon: 'faith',
    line: 'might',
    gain: { attack: 0.1, crit: 0.04 },
    effect: { kind: 'leech', value: 0.14 },
    needs: CAPSTONE_NEEDS,
  },
  ironvow: {
    id: 'ironvow',
    icon: 'helm',
    line: 'guard',
    gain: { defence: 0.16, maxHp: 0.1 },
    effect: { kind: 'aegis', value: 0.3 },
    needs: CAPSTONE_NEEDS,
  },
  deathward: {
    id: 'deathward',
    icon: 'grave',
    line: 'guard',
    gain: { maxHp: 0.16 },
    effect: { kind: 'secondwind', value: 0.55 },
    needs: CAPSTONE_NEEDS,
  },
  quickhand: {
    id: 'quickhand',
    icon: 'gear',
    line: 'craft',
    gain: { haste: 0.18, speed: 5 },
    effect: { kind: 'primed', value: 1 },
    needs: CAPSTONE_NEEDS,
  },
  farsight: {
    id: 'farsight',
    icon: 'crystal',
    line: 'craft',
    gain: { power: 0.3, haste: 0.12 },
    needs: CAPSTONE_NEEDS,
  },
};

/**
 * Five rows, three columns. Every row offers one talent from each line, so a
 * player choosing the same column every time is deliberately building down a
 * path, and the last row asks whether they actually did.
 */
export const TALENT_TREES: Record<HeroId, [string, string, string][]> = {
  warden: [
    ['keenedge', 'ironhide', 'channelled'],
    ['savage', 'bulwarked', 'deepbreath'],
    ['ambusher', 'briarmail', 'forethought'],
    ['quickstep', 'stalwart', 'focused'],
    ['bloodoath', 'lastwall', 'quickhand'],
  ],
  ranger: [
    ['keenedge', 'ironhide', 'channelled'],
    ['sharpeye', 'hardened', 'relentless'],
    ['ambusher', 'wardstone', 'forethought'],
    ['finisher', 'bulwarked', 'attuned'],
    ['heartseeker', 'ironvow', 'farsight'],
  ],
  magus: [
    ['savage', 'ironhide', 'channelled'],
    ['sharpeye', 'hardened', 'deepbreath'],
    ['bloodlet', 'wardstone', 'attuned'],
    ['finisher', 'stalwart', 'focused'],
    ['headsman', 'ironvow', 'firestorm'],
  ],
  preacher: [
    ['keenedge', 'ironhide', 'channelled'],
    ['savage', 'bulwarked', 'deepbreath'],
    ['bloodlet', 'gravewalk', 'forethought'],
    ['finisher', 'hardened', 'focused'],
    ['bloodoath', 'deathward', 'evensong'],
  ],
  cutpurse: [
    ['savage', 'ironhide', 'relentless'],
    ['sharpeye', 'hardened', 'deepbreath'],
    ['ambusher', 'wardstone', 'forethought'],
    ['flurried', 'stalwart', 'attuned'],
    ['throatcut', 'ironvow', 'quickhand'],
  ],
  sentinel: [
    ['keenedge', 'bulwarked', 'channelled'],
    ['quickstep', 'ironhide', 'deepbreath'],
    ['ambusher', 'briarmail', 'forethought'],
    ['savage', 'hardened', 'focused'],
    ['headsman', 'standfast', 'quickhand'],
  ],
  zealot: [
    ['savage', 'ironhide', 'channelled'],
    ['keenedge', 'bulwarked', 'deepbreath'],
    ['bloodlet', 'briarmail', 'forethought'],
    ['flurried', 'gravewalk', 'focused'],
    ['martyr', 'deathward', 'farsight'],
  ],
  tinker: [
    ['quickstep', 'ironhide', 'relentless'],
    ['sharpeye', 'hardened', 'channelled'],
    ['flurried', 'wardstone', 'forethought'],
    ['finisher', 'bulwarked', 'attuned'],
    ['heartseeker', 'ironvow', 'clockwork'],
  ],
};

/** Only picks that sit at the row they are recorded against count. */
function validPicks(hero: HeroId, picks: string[] | undefined): string[] {
  const tree = TALENT_TREES[hero] ?? [];
  if (!picks) return [];
  const kept: string[] = [];
  for (let tier = 0; tier < tree.length; tier += 1) {
    const pick = picks[tier];
    if (pick && tree[tier].includes(pick)) kept.push(pick);
  }
  return kept;
}

/** How many picks a hero has made in each line so far. */
export function lineCounts(hero: HeroId, picks: string[] | undefined): Record<TalentLine, number> {
  const counts: Record<TalentLine, number> = { might: 0, guard: 0, craft: 0 };
  for (const id of validPicks(hero, picks)) {
    const talent = TALENTS[id];
    if (talent) counts[talent.line] += 1;
  }
  return counts;
}

/** Whether a talent's line requirement is met, ignoring the row it sits on. */
export function talentOpen(hero: HeroId, picks: string[] | undefined, id: string): boolean {
  const talent = TALENTS[id];
  if (!talent?.needs) return true;
  return lineCounts(hero, picks)[talent.line] >= talent.needs;
}

/** Everything a hero's chosen talents add up to. */
export function talentGain(hero: HeroId, picks: string[] | undefined): TalentGain {
  const total: TalentGain = {};
  for (const id of validPicks(hero, picks)) {
    const talent = TALENTS[id];
    if (!talent) continue;
    for (const [stat, value] of Object.entries(talent.gain) as [keyof TalentGain, number][]) {
      total[stat] = (total[stat] ?? 0) + value;
    }
  }
  return total;
}

/** The behaviours a hero's talents bring into a fight, added where they stack. */
export function talentEffects(hero: HeroId, picks: string[] | undefined): TalentEffects {
  const total: TalentEffects = {};
  for (const id of validPicks(hero, picks)) {
    const effect = TALENTS[id]?.effect;
    if (!effect) continue;
    total[effect.kind] = (total[effect.kind] ?? 0) + effect.value;
  }
  return total;
}

/** How many rows a hero has reached, and how many are still unspent. */
export function talentsOpen(level: number): number {
  return TALENT_LEVELS.filter((needed) => level >= needed).length;
}
