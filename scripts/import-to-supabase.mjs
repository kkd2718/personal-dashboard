#!/usr/bin/env node
// Reads .data/db.json if present, else data/seed.local.json, and upserts every
// entity into Supabase (idempotent by id — safe to re-run). Requires
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
//
// Usage: node --env-file=.env.local scripts/import-to-supabase.mjs [--dry-run]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  deadlineToRow,
  milestoneToRow,
  noteToRow,
  paperToRow,
  projectActivityToRow,
  projectToRow,
  reviewToRow,
  taskToRow,
} from '../lib/repo/mappers.ts';

const dryRun = process.argv.includes('--dry-run');
const root = path.resolve(import.meta.dirname, '..');

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, 'utf-8'));
  } catch {
    return null;
  }
}

const dbJsonPath = path.join(root, '.data', 'db.json');
const seedLocalPath = path.join(root, 'data', 'seed.local.json');
let db = await readJson(dbJsonPath);
let source = dbJsonPath;
if (!db) {
  db = await readJson(seedLocalPath);
  source = seedLocalPath;
}

if (!db) {
  console.error('Neither .data/db.json nor data/seed.local.json found.');
  process.exit(1);
}

const TABLES = [
  { key: 'projects', table: 'projects', toRow: projectToRow, conflict: 'id' },
  { key: 'milestones', table: 'milestones', toRow: milestoneToRow, conflict: 'id' },
  { key: 'tasks', table: 'tasks', toRow: taskToRow, conflict: 'id' },
  { key: 'notes', table: 'notes', toRow: noteToRow, conflict: 'id' },
  { key: 'papers', table: 'papers', toRow: paperToRow, conflict: 'id' },
  { key: 'reviews', table: 'review_jobs', toRow: reviewToRow, conflict: 'id' },
  { key: 'deadlines', table: 'deadlines', toRow: deadlineToRow, conflict: 'id' },
  { key: 'projectActivity', table: 'project_activity', toRow: projectActivityToRow, conflict: 'project_id' },
];

const counts = Object.fromEntries(TABLES.map(({ key }) => [key, (db[key] ?? []).length]));
console.log(`Source: ${path.relative(root, source)}`);
console.log('Counts:', counts);

if (dryRun) {
  console.log('[dry-run] no writes performed.');
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

for (const { key: dbKey, table, toRow, conflict } of TABLES) {
  const rows = (db[dbKey] ?? []).map(toRow);
  if (rows.length === 0) continue;
  const { error } = await sb.from(table).upsert(rows, { onConflict: conflict });
  if (error) {
    console.error(`${table}: ${error.message}`);
    process.exit(1);
  }
  console.log(`${table}: upserted ${rows.length}`);
}

console.log('Done.');
