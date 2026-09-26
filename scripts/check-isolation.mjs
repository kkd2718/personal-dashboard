#!/usr/bin/env node
// Isolation gate: fails if any tracked file outside data/ and docs/ contains
// personal identifiers. Run standalone (`node scripts/check-isolation.mjs`) or
// via lib/check-isolation.test.ts in `npm test`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

const PATTERNS = [/기덕/, /skdgh23/, /kkd2718/, /C:\\Users/, /\/home\/kkd2718/];

const EXEMPT_PREFIXES = ['data/', 'docs/'];
// The gate's own pattern list necessarily contains the strings it searches for.
const EXEMPT_FILES = ['scripts/check-isolation.mjs'];

/** Returns `{ file, pattern }` violations among tracked + untracked (non-ignored) files. */
export function checkIsolation() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !EXEMPT_PREFIXES.some((p) => f.startsWith(p)) && !EXEMPT_FILES.includes(f));

  const violations = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(path.join(ROOT, file), 'utf-8');
    } catch {
      continue; // binary or unreadable — not a text leak
    }
    for (const pattern of PATTERNS) {
      if (pattern.test(content)) violations.push({ file, pattern: pattern.source });
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = checkIsolation();
  if (violations.length > 0) {
    console.error('Isolation gate failed:');
    for (const v of violations) console.error(`  ${v.file}: matches /${v.pattern}/`);
    process.exit(1);
  }
  console.log('Isolation gate passed.');
}
