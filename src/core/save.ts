import { KINDS_BY_SLOT, TALENT_TREES } from '../data/content';
import { SAVE_VERSION, freshState } from './game';
import type { GameState, HeroId, Item } from './types';

/**
 * Keeps only the picks that still sit on the row they were recorded against.
 * When a tree is rebuilt, a stale pick would otherwise hold its row shut
 * forever while counting for nothing, so it is dropped and the row reopens.
 */
function keepTalents(hero: HeroId, stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  const tree = TALENT_TREES[hero] ?? [];
  const kept: string[] = [];
  for (let tier = 0; tier < tree.length; tier += 1) {
    const pick = stored[tier];
    kept[tier] = typeof pick === 'string' && tree[tier].includes(pick) ? pick : '';
  }
  return kept;
}

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

/**
 * The save as a file the player owns.
 *
 * Everything lives in one browser's local storage, which is one cleared cache
 * away from gone, so there has to be a way to take a copy out and put it back.
 * It is the same JSON the game already writes, with a stamp on it so an
 * import can tell a save from any other file that happens to be JSON.
 */
export const EXPORT_TAG = 'hollowdeep.save';

export function exportSave(state: GameState): string {
  return JSON.stringify({ tag: EXPORT_TAG, version: SAVE_VERSION, saved: Date.now(), state }, null, 2);
}

export type ImportResult = { ok: true; state: GameState } | { ok: false; reason: 'shape' | 'parse' };

export function importSave(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse' };
  }

  const wrapper = parsed as { tag?: string; state?: GameState };
  // A bare save file from somewhere else is still worth accepting, so long as
  // it looks like one: the tag is a convenience, not a lock.
  const candidate = wrapper && wrapper.tag === EXPORT_TAG ? wrapper.state : (parsed as GameState);
  if (!candidate || typeof candidate !== 'object' || typeof candidate.heroes !== 'object') {
    return { ok: false, reason: 'shape' };
  }
  return { ok: true, state: migrate(candidate) };
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

/**
 * Fills in anything a newer build expects but an older save never wrote.
 * Exported so the offline harnesses read a save the same way the game does,
 * rather than handing raw JSON to the resolver and tripping over a field that
 * only exists in this build.
 */
export function migrate(state: GameState): GameState {
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
          talents: keepTalents(id, stored.talents),
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
