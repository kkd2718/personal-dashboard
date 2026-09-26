// Plain JS, Node >=18 (WSL's system node has no --env-file / import attributes).
import { readFileSync } from 'node:fs';

/**
 * Manual `.env.local`-style parser: `KEY=VALUE` per line, ignores blank lines and
 * lines starting with `#`, strips a trailing CR and surrounding quotes from the value.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Reads and parses a .env.local file; returns {} if missing (never throws). */
export function loadEnvFile(path) {
  try {
    return parseEnv(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}
