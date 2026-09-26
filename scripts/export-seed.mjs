#!/usr/bin/env node
// One-off: dumps the current lib/seed.ts (real data) to data/seed.local.json
// (gitignored) so lib/seed.ts can be deleted. Run once: `node scripts/export-seed.mjs`.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { seedDb } from '../lib/seed.ts';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'data', 'seed.local.json');
const db = seedDb();
await writeFile(out, JSON.stringify(db, null, 2), 'utf-8');

const counts = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]));
console.log(`Wrote ${out}`);
console.log(counts);
