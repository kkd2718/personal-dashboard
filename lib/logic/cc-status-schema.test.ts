import { describe, expect, it } from 'vitest';
import { ccStatusSchema } from './cc-status-schema';
import { parseCcStatus } from '../../scripts/lib/cc-status.mjs';

describe('ccStatusSchema', () => {
  it('accepts whatever parseCcStatus normalizes (aliases, long text, many items)', () => {
    const checklist = Array.from({ length: 130 }, (_, i) => ({ title: `t${i}`, status: i % 2 ? 'blocked' : 'in_progress', due: '2026-11-02' }));
    checklist[0] = { title: 'x'.repeat(250), status: 'in_progress', due: '2026-11-02' };
    const parsed = parseCcStatus(JSON.stringify({ updatedAt: '2026-11-02T00:00:00Z', focus: 'f', checklist }));
    expect(parsed).not.toBeNull();
    expect(ccStatusSchema.safeParse(parsed).success).toBe(true);
  });

  it('rejects an unknown item status and a malformed due', () => {
    const base = { updatedAt: null, focus: null, next: [], blockers: [], done: [] };
    const item = { text: 't', status: 'todo', section: null, owner: 'me' };
    expect(ccStatusSchema.safeParse({ ...base, checklist: [{ ...item, status: 'later' }] }).success).toBe(false);
    expect(ccStatusSchema.safeParse({ ...base, checklist: [{ ...item, due: '11/02' }] }).success).toBe(false);
  });
});
