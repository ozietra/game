export type HeroId = 'warden' | 'ranger' | 'magus' | 'preacher' | 'cutpurse';

export type SlotId = 'weapon' | 'armour' | 'charm';

export type RarityId = 'worn' | 'sound' | 'master' | 'ancient' | 'fabled';

export type ResourceId = 'coin' | 'iron' | 'crystal' | 'relic';

export type BuildingId = 'smithy' | 'armoury' | 'infirmary' | 'drillyard' | 'ropewright' | 'cartographer';

export type RelicId = 'deepmark' | 'looteye' | 'knot' | 'guidestone' | 'wakingcamp' | 'lampoil';
export type EchoId = 'wellspring' | 'ironblood' | 'oldlamp' | 'firstlight';

export interface Item {
  uid: number;
  slot: SlotId;
  kind: string;
  rarity: RarityId;
  power: number;
  floor: number;
  /** A prefix, which hangs one more stat on the piece. */
  affix?: string;
  /** A suffix, which is the workshop it came from and the set it counts for. */
  set?: string;
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
  /** A keeper's ward: damage goes here first, and it comes back up. */
  ward?: number;
  wardMax?: number;
  wardTimer?: number;
  raged?: boolean;
  summons?: number;
}

export interface Satchel {
  coin: number;
  iron: number;
  crystal: number;
  items: Item[];
}

export type RunPhase = 'camp' | 'descending' | 'event' | 'fighting' | 'looting' | 'climbing' | 'wiped';

/** Which way a floor event is answered when nobody is watching. */
export type EventChoice = 'bold' | 'safe';

export interface PendingEvent {
  id: string;
  floor: number;
  /** Seconds left before the standing order answers for the player. */
  timer: number;
}

/** A blessing picked up at an altar, good for the next few floors. */
export interface Boon {
  kind: 'attack' | 'loot';
  power: number;
  floorsLeft: number;
}

/** What one descent came back with, or did not. */
export interface DiveReport {
  at: number;
  seconds: number;
  from: number;
  deepest: number;
  floors: number;
  fights: number;
  risk: number;
  coin: number;
  iron: number;
  crystal: number;
  items: number;
  /** The single hardest blow anyone in the party landed. */
  hardest: number;
  hardestBy: string;
  wiped: boolean;
  lost: number;
}

export interface Contract {
  id: string;
  target: number;
  progress: number;
  claimed: boolean;
}

export interface Contracts {
  /** The UTC day these were rolled for. */
  day: string;
  goals: Contract[];
  /** Consecutive days with all three finished. */
  streak: number;
  best: number;
}

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
  /** The dial this descent was started on; changing it mid dive changes nothing. */
  risk: number;
  event: PendingEvent | null;
  boon: Boon | null;
  report: DiveReport;
}

export interface Policy {
  autoDive: boolean;
  startFloor: number;
  targetFloor: number;
  retreatHealth: number;
  satchelLimit: number;
  /** 0 is the shaft as it comes; every step up pays better and hits harder. */
  risk: number;
  /** How floor events are answered: by hand, or the same way every time. */
  eventChoice: EventChoice | 'ask';
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
  /** Earned by the deep reset, and the only currency that survives one. */
  echo: number;
}

export interface AudioSettings {
  /** Everything, including the interface. */
  volume: number;
  muted: boolean;
  /** The shaft itself: blows landing, doors, coin. */
  effects: boolean;
  /** The looping theme, kept well under the rest by default. */
  music: number;
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
  echoes: Record<EchoId, number>;
  policy: Policy;
  run: RunState;
  deepestFloor: number;
  deepestBanked: number;
  totalDives: number;
  totalWipes: number;
  descents: number;
  prestiges: number;
  deepPrestiges: number;
  lifetimeCoin: number;
  playedSeconds: number;
  lastSeen: number;
  nextUid: number;
  tutorialSeen: boolean;
  /** Whether anonymous play metrics may leave this browser. */
  shareMetrics: boolean;
  /** The name this player goes by on the ladder, empty until they pick one. */
  ladderName: string;
  contracts: Contracts;
  /** Achievement id to when it was earned. */
  achievements: Record<string, number>;
  /** Foe kind to how many have been put down. */
  bestiary: Record<string, number>;
  /** Ten floor marks banked, which are kept through everything. */
  milestones: number;
  lastDive: DiveReport | null;
  diveHistory: DiveReport[];
}
