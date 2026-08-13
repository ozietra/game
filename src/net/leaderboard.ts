import { METRICS_ENDPOINT, METRICS_PROTOCOL } from '../data/config';
import { playerId } from './identity';
import type { GameState } from '../core/types';

/**
 * The ladder.
 *
 * It rides on the same collector the metrics use, because standing up a second
 * service for one table would be silly. Reading is public: a board of names and
 * floor numbers is the whole point. Writing takes a name the player typed and
 * nothing else about them.
 *
 * A week is a fresh start. The all time board is the best week each player ever
 * had, so a good week is never taken away by a bad one.
 */

export interface BoardRow {
  rank: number;
  pid: string;
  name: string;
  floor: number;
  prestiges: number;
  deep: number;
  played: number;
  updated: number;
}

export interface Board {
  scope: 'week' | 'all';
  week: string;
  generated: number;
  rows: BoardRow[];
}

export type BoardScope = 'week' | 'all';
/** `stale` means the collector is up but predates the ladder. */
export type SubmitResult = 'ok' | 'name' | 'implausible' | 'stale' | 'offline';

/** Whether this build has anywhere to send a score at all. */
export const ladderAvailable = (): boolean => METRICS_ENDPOINT.length > 0;

export function myId(): string {
  return playerId();
}

export async function fetchBoard(scope: BoardScope): Promise<Board | null> {
  if (!ladderAvailable()) return null;
  try {
    const response = await fetch(`${METRICS_ENDPOINT}/board?scope=${scope}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as Board;
  } catch {
    return null;
  }
}

export async function submitScore(state: GameState, name: string): Promise<SubmitResult> {
  if (!ladderAvailable()) return 'offline';
  const trimmed = name.trim().slice(0, 18);
  if (trimmed.length < 2) return 'name';

  const body = JSON.stringify({
    v: METRICS_PROTOCOL,
    pid: playerId(),
    name: trimmed,
    // The board ranks the deepest floor a party actually climbed out of, not
    // the deepest one they died on.
    floor: Math.max(1, Math.round(state.deepestBanked)),
    prestiges: Math.round(state.prestiges),
    deep: Math.round(state.deepPrestiges ?? 0),
    played: Math.round(state.playedSeconds),
  });

  try {
    const response = await fetch(`${METRICS_ENDPOINT}/score`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      cache: 'no-store',
    });
    if (response.status === 422) return 'implausible';
    if (response.status === 400) return 'name';
    // A collector that answers but has never heard of the ladder is one that
    // was deployed before it existed, which is a different problem entirely
    // from being unreachable and deserves a different sentence.
    if (response.status === 404) return 'stale';
    return response.ok ? 'ok' : 'offline';
  } catch {
    return 'offline';
  }
}
