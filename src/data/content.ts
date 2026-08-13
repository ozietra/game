import type { BuildingId, HeroId, RarityId, RelicId, ResourceId, SlotId } from '../core/types';

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
  woundRecoverySeconds: 110,
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
    kind: 'bulwark' | 'pierce' | 'volley' | 'mend' | 'backstab';
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
};

export const HERO_ORDER: HeroId[] = ['warden', 'ranger', 'magus', 'preacher', 'cutpurse'];

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
