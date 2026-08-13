/**
 * The one anonymous number this browser is known by.
 *
 * Metrics and the ladder both need a way to recognise the same browser twice,
 * and neither should invent its own: a player who clears site data becomes a
 * new person to both at once, which is the behaviour anybody would expect.
 * It is random, it means nothing anywhere else, and there is nothing attached
 * to it but a floor number.
 */

const PID_KEY = 'hollowdeep.pid.v1';

export function randomId(length = 24): string {
  const scope = globalThis.crypto;
  if (scope && 'randomUUID' in scope) return scope.randomUUID().replace(/-/g, '').slice(0, length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A blocked store just means this browser stays new every visit.
  }
}

/** Returns the stored identifier, or null when there is not one yet. */
export function knownId(): string | null {
  const stored = readLocal(PID_KEY);
  return stored && stored.length >= 8 ? stored : null;
}

/** Returns the stored identifier, making one if this is the first visit. */
export function playerId(): string {
  const known = knownId();
  if (known) return known;
  const fresh = randomId();
  writeLocal(PID_KEY, fresh);
  return fresh;
}
