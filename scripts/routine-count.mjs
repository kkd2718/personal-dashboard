#!/usr/bin/env node
// Logs a count routine's daily tally (e.g. problems solved) to the Command Center.
// Called from another project's Claude session; reads CLOUD_URL + AGENT_TOKEN from this
// repo's .env.local, so the caller needs no secrets. Plain JS, runs under Node 18 (WSL).
//
// Usage:
//   node routine-count.mjs <routineId> +5      # add 5 to today's count
//   node routine-count.mjs <routineId> =12     # set today's count to 12
//   node routine-count.mjs <routineId> ^12     # raise to at least 12 (syncs: never lowers a hand-entered count)
//   node routine-count.mjs <routineId>         # print today's count
//   ... [--date YYYY-MM-DD]                    # another KST day (default: today)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './lib/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node routine-count.mjs <routineId> [+N|-N|=N|^N] [--date YYYY-MM-DD]');
  process.exit(2);
}

const args = process.argv.slice(2);
const dateIdx = args.indexOf('--date');
let date;
if (dateIdx !== -1) {
  date = args[dateIdx + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) usage('bad --date');
  args.splice(dateIdx, 2);
}
const [id, change] = args;
if (!id) usage();

const body = { id };
if (date) body.date = date;
if (change !== undefined) {
  const m = /^([+=^-])(\d+)$/.exec(change);
  if (!m) usage(`bad change '${change}' (use +N, -N, =N or ^N)`);
  const n = Number(m[2]);
  if (m[1] === '=') body.set = n;
  else if (m[1] === '^') body.atLeast = n;
  else body.add = m[1] === '-' ? -n : n;
}

const { CLOUD_URL, AGENT_TOKEN } = { ...loadEnvFile(path.join(ROOT, '.env.local')), ...process.env };
if (!CLOUD_URL || !AGENT_TOKEN) {
  console.error('CLOUD_URL / AGENT_TOKEN not set in .env.local.');
  process.exit(1);
}

const res = await fetch(`${CLOUD_URL.replace(/\/$/, '')}/api/routine/count`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${AGENT_TOKEN}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(10000),
});
const json = await res.json().catch(() => ({}));
if (!res.ok || !json.ok) {
  console.error(`failed (${res.status}): ${json.error ?? 'unknown error'}`);
  process.exit(1);
}
console.log(`${json.id} ${json.date}: ${json.count}${json.unit ?? ''}`);
