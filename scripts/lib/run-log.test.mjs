import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendRunLog, formatRunLogLine } from './run-log.mjs';

describe('formatRunLogLine', () => {
  it('flattens and quotes the reason', () => {
    expect(formatRunLogLine({ at: 'T', ok: false, stage: 'config', reason: 'a\nb "c"', counts: {}, ms: 5, attempts: 3 })).toBe(
      `T fail stage=config attempts=3 ms=5 reason="a b 'c'"`
    );
  });

  it('writes counts in order and truncates long reasons', () => {
    expect(formatRunLogLine({ at: 'T', ok: true, counts: { projects: 19, collected: 18 }, ms: 9, attempts: 1 })).toBe(
      'T ok projects=19 collected=18 attempts=1 ms=9'
    );
    const line = formatRunLogLine({ at: 'T', ok: false, reason: 'x'.repeat(500), ms: 1, attempts: 1 });
    expect(line.match(/reason="(x+)"/)[1]).toHaveLength(200);
  });
});

describe('appendRunLog', () => {
  const dirs = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('creates the dir and rotates past maxBytes', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'runlog-'));
    dirs.push(base);
    const file = path.join(base, 'nested', 'collector.log');
    const line = (c) => c.repeat(29);
    for (const c of ['a', 'b', 'c']) await appendRunLog(file, line(c), 50);
    expect((await stat(`${file}.1`)).isFile()).toBe(true);
    const current = await readFile(file, 'utf-8');
    expect(current).toContain(line('c'));
    expect(current).not.toContain(line('a'));
  });
});
