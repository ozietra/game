export type HeroId = 'warden' | 'ranger' | 'magus' | 'preacher' | 'cutpurse';

export type SlotId = 'weapon' | 'armour' | 'charm';

export type RarityId = 'worn' | 'sound' | 'master' | 'ancient' | 'fabled';

export type ResourceId = 'coin' | 'iron' | 'crystal' | 'relic';

export type BuildingId = 'smithy' | 'armoury' | 'infirmary' | 'drillyard' | 'ropewright' | 'cartographer';

export type RelicId = 'deepmark' | 'looteye' | 'knot' | 'guidestone' | 'wakingcamp' | 'lampoil';

export interface Item {
  uid: number;
  slot: SlotId;
  kind: string;
  rarity: RarityId;
  power: number;
  floor: number;
}

export interface Hero {
  id: HeroId;
  unlocked: boolean;
  level: number;
  xp: number;
  mastery: number;
  wounds: number;
  hp: number;
  gear: Record<SlotId, Item | null>;
}

export interface Stats {
  maxHp: number;
  attack: number;
  defence: number;
  speed: number;
  crit: number;
}

/** A fighter as the combat resolver sees it. */
export interface Combatant {
  key: string;
  side: 'party' | 'foe';
  sprite: string;
  nameKey: string;
  hero?: HeroId;
  rank?: 'common' | 'elite' | 'boss';
  /** Sheet to draw, when better gear has changed how a hero looks. */
  look?: string;
  gleam?: boolean;
  stats: Stats;
  hp: number;
  timer: number;
  abilityTimer: number;
  guard: number;
  alive: boolean;
  /** Animation state driven by the resolver, read by the renderer. */
  action: 'idle' | 'attack' | 'hurt' | 'down';
  actionUntil: number;
}

export interface Satchel {
  coin: number;
  iron: number;
  crystal: number;
  items: Item[];
}

export type RunPhase = 'camp' | 'descending' | 'fighting' | 'looting' | 'climbing' | 'wiped';

export interface RunState {
  phase: RunPhase;
  /** A descent the player started by hand ignores the standing orders. */
  manual: boolean;
  floor: number;
  deepestThisRun: number;
  encounter: number;
  encountersOnFloor: number;
  phaseTimer: number;
  climbFrom: number;
  satchel: Satchel;
  party: Combatant[];
  foes: Combatant[];
  seed: number;
}

export interface Policy {
  autoDive: boolean;
  startFloor: number;
  targetFloor: number;
  retreatHealth: number;
  satchelLimit: number;
}

export interface LogEntry {
  id: number;
  time: number;
  key: string;
  params: Record<string, string | number>;
  tone: 'plain' | 'good' | 'bad' | 'loud';
}

export interface Bank {
  coin: number;
  iron: number;
  crystal: number;
  relic: number;
}

export interface AudioSettings {
  volume: number;
  muted: boolean;
}

export interface GameState {
  version: number;
  language: 'tr' | 'en';
  audio: AudioSettings;
  bank: Bank;
  heroes: Record<HeroId, Hero>;
  stash: Item[];
  buildings: Record<BuildingId, number>;
  relics: Record<RelicId, number>;
  policy: Policy;
  run: RunState;
  deepestFloor: number;
  deepestBanked: number;
  totalDives: number;
  totalWipes: number;
  descents: number;
  prestiges: number;
  lifetimeCoin: number;
  playedSeconds: number;
  lastSeen: number;
  nextUid: number;
  tutorialSeen: boolean;
  /** Whether anonymous play metrics may leave this browser. */
  shareMetrics: boolean;
}
