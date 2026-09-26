// Server-only. Loads real seed data from data/seed.local.json (gitignored) when
// present, falling back to the fictional lib/seed.example.ts otherwise. Keeps
// no personal data in tracked source files (see docs/PLAN_1b.md §1).
if (typeof window !== 'undefined') {
  throw new Error('lib/seed/index.ts is server-only');
}

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '@/lib/types';
import { exampleSeedDb } from '@/lib/seed.example';

const LOCAL_SEED_PATH = path.join(process.cwd(), 'data', 'seed.local.json');

/** Fresh copy of the seed database: data/seed.local.json if present, else the example. */
export function seedDb(): Db {
  try {
    const raw = readFileSync(LOCAL_SEED_PATH, 'utf-8');
    return JSON.parse(raw) as Db;
  } catch {
    return exampleSeedDb();
  }
}
