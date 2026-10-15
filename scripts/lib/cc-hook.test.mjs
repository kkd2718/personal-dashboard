import { describe, expect, it } from 'vitest';
import {
  cacheIsStale,
  inboxIds,
  newInboxItems,
  promptHookOutput,
  protocolBlock,
  recentlyChecked,
  shouldRemind,
  statusStateText,
} from './cc-hook.mjs';

describe('statusStateText', () => {
  const now = new Date('2026-09-27T12:00:00.000Z').getTime();

  it('없음 for null/non-finite', () => {
    expect(statusStateText(null, now)).toBe('없음');
    expect(statusStateText(NaN, now)).toBe('없음');
  });

  it('최근 갱신 for < 1 day old', () => {
    expect(statusStateText(now - 3 * 60 * 60 * 1000, now)).toBe('최근 갱신');
  });

  it('N일 전 갱신 for older', () => {
    expect(statusStateText(now - 3 * 24 * 60 * 60 * 1000, now)).toBe('3일 전 갱신');
  });
});

describe('protocolBlock', () => {
  it('embeds the root path and state text', () => {
    const block = protocolBlock('/home/user/projects/example', '최근 갱신');
    expect(block).toContain('## Command Center 기록 규칙');
    expect(block).toContain('/home/user/projects/example/docs/cc-status.json');
    expect(block).toContain('현재 상태: 최근 갱신');
  });
});

describe('shouldRemind', () => {
  const marker = { startedAt: '2026-09-27T09:00:00.000Z', reminded: false };

  it('false with no marker', () => {
    expect(shouldRemind({ marker: null, hasCommits: true, statusMtimeMs: null })).toBe(false);
  });

  it('false when already reminded', () => {
    expect(shouldRemind({ marker: { ...marker, reminded: true }, hasCommits: true, statusMtimeMs: null })).toBe(false);
  });

  it('false with no commits since session start', () => {
    expect(shouldRemind({ marker, hasCommits: false, statusMtimeMs: null })).toBe(false);
  });

  it('true when status file missing', () => {
    expect(shouldRemind({ marker, hasCommits: true, statusMtimeMs: null })).toBe(true);
  });

  it('true when status file is older than session start', () => {
    const older = Date.parse('2026-09-27T08:00:00.000Z');
    expect(shouldRemind({ marker, hasCommits: true, statusMtimeMs: older })).toBe(true);
  });

  it('false when status file was updated after session start', () => {
    const newer = Date.parse('2026-09-27T10:00:00.000Z');
    expect(shouldRemind({ marker, hasCommits: true, statusMtimeMs: newer })).toBe(false);
  });
});

describe('prompt hook helpers', () => {
  const data = { tasks: [{ id: 't1' }, { id: 't2' }], memos: [{ id: 'n1' }] };

  it('newInboxItems drops already shown ids', () => {
    expect(newInboxItems(data, ['t1', 'n1'])).toEqual({ tasks: [{ id: 't2' }], memos: [] });
    expect(newInboxItems(data, [])).toEqual(data);
  });

  it('inboxIds lists tasks then memos', () => {
    expect(inboxIds(data)).toEqual(['t1', 't2', 'n1']);
  });

  it('promptHookOutput shape', () => {
    expect(JSON.parse(promptHookOutput('a')).hookSpecificOutput).toEqual({
      hookEventName: 'UserPromptSubmit',
      additionalContext: 'a',
    });
  });

  it('recentlyChecked throttles', () => {
    const iso = new Date(0).toISOString();
    expect(recentlyChecked(iso, 10000)).toBe(true);
    expect(recentlyChecked(iso, 40000)).toBe(false);
    expect(recentlyChecked(undefined, 10000)).toBe(false);
  });
});

describe('cacheIsStale', () => {
  it('absent or old is stale, recent is fresh', () => {
    const iso = new Date(0).toISOString();
    expect(cacheIsStale(undefined, 10000)).toBe(true);
    expect(cacheIsStale(iso, 10000)).toBe(false);
    expect(cacheIsStale(iso, 40000)).toBe(true);
  });
});
