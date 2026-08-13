import { KINDS_BY_SLOT } from '../data/content';
import { SAVE_VERSION, freshState } from './game';
import type { GameState, Item } from './types';

const KEY = 'hollowdeep.save.v1';
/** The game was called Alacakuyu until the rename; those saves still load. */
const OLD_KEYS = ['alacakuyu.save.v1'];

export function writeSave(state: GameState): void {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A full or blocked store should never take the game down.
  }
}

export function readSave(): GameState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    for (const old of OLD_KEYS) {
      if (raw) break;
      raw = localStorage.getItem(old);
    }
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as GameState;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    for (const old of OLD_KEYS) localStorage.removeItem(old);
  } catch {
    // ignored
  }
}

/** Gear predates item kinds, so anything without one takes the plain kind. */
function withKind(item: Item): Item {
  return item.kind ? item : { ...item, kind: KINDS_BY_SLOT[item.slot][0] };
}

/** Fills in anything a newer build expects but an older save never wrote. */
function migrate(state: GameState): GameState {
  const base = freshState();
  const merged: GameState = {
    ...base,
    ...state,
    audio: { ...base.audio, ...state.audio },
    bank: { ...base.bank, ...state.bank },
    buildings: { ...base.buildings, ...state.buildings },
    relics: { ...base.relics, ...state.relics },
    policy: { ...base.policy, ...state.policy },
    run: { ...base.run, ...state.run, satchel: { ...base.run.satchel, ...state.run?.satchel } },
    heroes: { ...base.heroes },
  };

  for (const id of Object.keys(base.heroes) as (keyof GameState['heroes'])[]) {
    const stored = state.heroes?.[id];
    merged.heroes[id] = stored
      ? {
          ...base.heroes[id],
          ...stored,
          gear: { ...base.heroes[id].gear, ...stored.gear },
          talents: Array.isArray(stored.talents) ? stored.talents : [],
        }
      : base.heroes[id];
  }

  merged.stash = (Array.isArray(state.stash) ? state.stash : []).map(withKind);
  for (const hero of Object.values(merged.heroes)) {
    for (const slot of Object.keys(hero.gear) as (keyof typeof hero.gear)[]) {
      const item = hero.gear[slot];
      if (item) hero.gear[slot] = withKind(item);
    }
  }
  merged.version = SAVE_VERSION;

  // A dive cannot be resumed mid-swing from a cold start; the party waits in camp.
  if (merged.run.phase === 'fighting' || merged.run.phase === 'looting' || merged.run.phase === 'descending') {
    merged.run.climbFrom = merged.run.floor;
    merged.run.phase = 'climbing';
    merged.run.phaseTimer = 0.1;
  }

  return merged;
}
