/**
 * Prints the store as SQL, for anyone applying it by hand rather than letting
 * the worker do it. The statements themselves live in worker.js, which stays a
 * single standalone file so it can be pasted into the Cloudflare editor.
 *
 *   node analytics/schema.js > analytics/schema.sql
 */

import { SCHEMA } from './worker.js';

export { SCHEMA };

export function schemaText() {
  const head = [
    '-- Hollowdeep metrics store.',
    '--',
    '-- Generated from the list in worker.js, which the worker applies to itself',
    '-- on a cold start. Edit it there, not here:',
    '--',
    '--   node analytics/schema.js > analytics/schema.sql',
    '--',
    '-- Applying it by hand is only needed for a database the worker cannot reach:',
    '--',
    '--   npx wrangler d1 execute hollowdeep-metrics --remote --file=schema.sql',
    '',
  ].join('\n');
  return `${head}\n${SCHEMA.map((statement) => `${statement};`).join('\n\n')}\n`;
}

if (import.meta.url === `file://${process?.argv?.[1]}`) process.stdout.write(schemaText());
