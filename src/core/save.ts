import { SAVE_VERSION, freshState } from './game';
import type { GameState } from './types';

const KEY = 'alacakuyu.save.v1';

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
  } catch {
    // ignored
  }
}

/** Fills in anything a newer build expects but an older save never wrote. */
function migrate(state: GameState): GameState {
  const base = freshState();
  const merged: GameState = {
    ...base,
    ...state,
    bank: { ...base.bank, ...state.bank },
    buildings: { ...base.buildings, ...state.buildings },
    relics: { ...base.relics, ...state.relics },
    policy: { ...base.policy, ...state.policy },
    run: { ...base.run, ...state.run, satchel: { ...base.run.satchel, ...state.run?.satchel } },
    heroes: { ...base.heroes },
  };

  for (const id of Object.keys(base.heroes) as (keyof GameState['heroes'])[]) {
    const stored = state.heroes?.[id];
    merged.heroes[id] = stored ? { ...base.heroes[id], ...stored, gear: { ...base.heroes[id].gear, ...stored.gear } } : base.heroes[id];
  }

  merged.stash = Array.isArray(state.stash) ? state.stash : [];
  merged.version = SAVE_VERSION;

  // A dive cannot be resumed mid-swing from a cold start; the party waits in camp.
  if (merged.run.phase === 'fighting' || merged.run.phase === 'looting' || merged.run.phase === 'descending') {
    merged.run.climbFrom = merged.run.floor;
    merged.run.phase = 'climbing';
    merged.run.phaseTimer = 0.1;
  }

  return merged;
}
