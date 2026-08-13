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

/** Reads a value out of the page's own head, so a built site stays editable. */
function fromMeta(name: string): string {
  if (typeof document === 'undefined') return '';
  return trimmed(document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? '');
}

export const METRICS_META = 'hollowdeep-metrics';

/**
 * Base address of the metrics collector, for example
 * `https://hollowdeep-metrics.<account>.workers.dev`.
 *
 * Two ways to set it, and the page wins. A meta tag in index.html can be
 * edited on a site that is already published, which matters because the
 * alternative is rebuilding and redeploying to change one string. Failing
 * that, VITE_METRICS_URL at build time. Empty means the game makes no network
 * calls at all.
 */
export const METRICS_ENDPOINT = fromMeta(METRICS_META) || trimmed(env.VITE_METRICS_URL);

/** Which build a measurement came from, so a bad release is visible in the panel. */
export const BUILD_ID = (env.VITE_BUILD_ID ?? 'dev').trim().slice(0, 32);

/** Payload shape version. The collector rejects anything it does not know. */
export const METRICS_PROTOCOL = 1;
