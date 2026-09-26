#!/usr/bin/env node
// Applies supabase/migrations/*.sql in filename order via the Supabase Management
// API (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF) — used instead of a direct
// Postgres connection because Supabase's connection-pooler password isn't always
// available/known. Tracks applied files in a `_migrations` table. Idempotent:
// migrations use `create table if not exists` / `create or replace function`,
// and this script skips files it has already recorded as applied.
//
// Usage: node --env-file=.env.local scripts/migrate.mjs [--dry-run]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF;
if (!accessToken || !projectRef) {
  console.error('SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set. See .env.example / docs/SETUP.md.');
  console.error('Run with: node --env-file=.env.local scripts/migrate.mjs');
  process.exit(1);
}

async function runQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

await runQuery(`create table if not exists _migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
)`);

const applied = new Set((await runQuery('select filename from _migrations')).map((r) => r.filename));
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip (already applied): ${file}`);
    continue;
  }
  const contents = await readFile(path.join(migrationsDir, file), 'utf-8');
  console.log(`${dryRun ? '[dry-run] would apply' : 'applying'}: ${file}`);
  if (!dryRun) {
    await runQuery(contents);
    await runQuery(`insert into _migrations (filename) values ('${file.replace(/'/g, "''")}')`);
  }
}
console.log('Done.');
