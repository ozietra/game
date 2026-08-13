/**
 * Build time wiring for anything that lives outside the browser tab.
 *
 * Every value here is optional. With none of them set the game behaves exactly
 * as it always has: no network calls, nothing collected, nothing to opt out of.
 */

const env = import.meta.env as Record<string, string | undefined>;

function trimmed(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * Base address of the metrics collector, for example
 * `https://hollowdeep-metrics.<account>.workers.dev`. Set it with
 * VITE_METRICS_URL at build time. Empty means metrics are switched off in the
 * build itself, not merely disabled at runtime.
 */
export const METRICS_ENDPOINT = trimmed(env.VITE_METRICS_URL);

/** Which build a measurement came from, so a bad release is visible in the panel. */
export const BUILD_ID = (env.VITE_BUILD_ID ?? 'dev').trim().slice(0, 32);

/** Payload shape version. The collector rejects anything it does not know. */
export const METRICS_PROTOCOL = 1;
