// Plain JS, Node >=18. One-line-per-run log for the collector (.data/collector.log).
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

/** `<at> ok|fail [stage=..] k=v.. attempts=N ms=N [reason=".."]` — reason is flattened and capped at 200 chars. */
export function formatRunLogLine({ at, ok, stage, reason, counts, ms, attempts }) {
  let line = `${at} ${ok ? 'ok' : 'fail'}`;
  if (stage) line += ` stage=${stage}`;
  for (const [k, v] of Object.entries(counts ?? {})) line += ` ${k}=${v}`;
  line += ` attempts=${attempts} ms=${ms}`;
  if (reason) {
    const clean = String(reason).replace(/[\r\n]+/g, ' ').replace(/"/g, "'").slice(0, 200);
    line += ` reason="${clean}"`;
  }
  return line;
}

/** Appends a line; rotates to `<file>.1` once the file exceeds `maxBytes`. Never throws. */
export async function appendRunLog(file, line, maxBytes = 256 * 1024) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const st = await stat(file).catch(() => null);
    if (st && st.size > maxBytes) await rename(file, `${file}.1`);
    await appendFile(file, `${line}\n`, 'utf-8');
  } catch {
    // logging must never fail a run
  }
}
