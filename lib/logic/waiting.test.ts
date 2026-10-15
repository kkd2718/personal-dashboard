import { describe, expect, it } from 'vitest';
import {
  applyWaitingMatches,
  extractEmailOrDomain,
  newWaitingId,
  openWaitingList,
  parseWaitCommand,
  resolveWaitTarget,
  waitingGmailQuery,
  waitingNudges,
  waitingQueries,
  type WaitingItem,
} from './waiting';

const item = (o: Partial<WaitingItem> = {}): WaitingItem => ({
  id: 'w000001',
  title: '편집자 답장',
  projectId: null,
  taskId: null,
  deadlineId: null,
  match: { from: 'editor@journal.org' },
  since: '2026-10-15',
  createdAt: '2026-10-15T03:00:00.000Z',
  nudgeAfterDays: 7,
  status: 'open',
  ...o,
});

const match = (receivedAt: string, messageId = 'm1') => ({ messageId, from: 'e', subject: 's', snippet: 'x', receivedAt });

describe('waitingGmailQuery', () => {
  it('from', () => {
    expect(waitingGmailQuery(item())).toBe('from:editor@journal.org after:2026/10/14 -in:sent -in:chats in:anywhere');
  });
  it('subject without quotes and parentheses', () => {
    expect(waitingGmailQuery(item({ match: { subject: 'Re: "BrainCT" (rev)' } }))).toContain('subject:"Re: BrainCT rev"');
  });
  it('null without from/subject', () => {
    expect(waitingGmailQuery(item({ match: {} }))).toBeNull();
  });
});

describe('waitingQueries', () => {
  it('only open, searchable items; after = createdAt', () => {
    const q = waitingQueries([item(), item({ id: 'w2', status: 'replied' }), item({ id: 'w3', match: {} })]);
    expect(q).toEqual([{ id: 'w000001', query: expect.stringContaining('from:'), after: '2026-10-15T03:00:00.000Z' }]);
  });
});

describe('applyWaitingMatches', () => {
  it('ignores a match from before the item was created', () => {
    const r = applyWaitingMatches([item()], [{ id: 'w000001', matches: [match('2026-10-15T02:59:00.000Z')] }]);
    expect(r.replied).toEqual([]);
    expect(r.items[0].status).toBe('open');
  });
  it('picks the earliest eligible match', () => {
    const r = applyWaitingMatches(
      [item()],
      [{ id: 'w000001', matches: [match('2026-10-16T00:00:00.000Z', 'late'), match('2026-10-15T05:00:00.000Z', 'early')] }]
    );
    expect(r.items[0]).toMatchObject({ status: 'replied', reply: { messageId: 'early' } });
    expect(r.replied).toHaveLength(1);
  });
  it('never re-alerts a replied item; closed and unknown ids are ignored', () => {
    const m = [{ id: 'w000001', matches: [match('2026-10-16T00:00:00.000Z')] }];
    expect(applyWaitingMatches([item({ status: 'replied' })], m).replied).toEqual([]);
    expect(applyWaitingMatches([item({ status: 'closed' })], m).items[0].status).toBe('closed');
    expect(applyWaitingMatches([item()], [{ id: 'nope', matches: m[0].matches }]).replied).toEqual([]);
  });
});

describe('waitingNudges', () => {
  const old = item({ since: '2026-10-08' });
  it('fires at nudgeAfterDays', () => {
    expect(waitingNudges([old], '2026-10-15')).toMatchObject([{ days: 7 }]);
    expect(waitingNudges([old], '2026-10-14')).toEqual([]);
    expect(waitingNudges([{ ...old, status: 'replied' }], '2026-10-15')).toEqual([]);
  });
});

describe('extractEmailOrDomain', () => {
  it('email, domain, URL, none', () => {
    expect(extractEmailOrDomain('editor@journal.org 답장 기다림')).toBe('editor@journal.org');
    expect(extractEmailOrDomain('mdpi.com 에서 답 오면')).toBe('mdpi.com');
    expect(extractEmailOrDomain('https://x.com/a')).toBeNull();
    expect(extractEmailOrDomain('그냥 기다리는 중')).toBeNull();
  });
});

describe('parseWaitCommand', () => {
  it.each([
    ['', { kind: 'list' }],
    ['2 from:a@b.com', { kind: 'edit', target: '2', patch: { from: 'a@b.com' } }],
    ['w1a2b3 subject:"Major revision"', { kind: 'edit', target: 'w1a2b3', patch: { subject: 'Major revision' } }],
    ['2 days:5', { kind: 'edit', target: '2', patch: { nudgeAfterDays: 5 } }],
    ['2 close', { kind: 'close', target: '2' }],
    ['x', { kind: 'invalid' }],
    ['2 whatever', { kind: 'invalid' }],
  ])('%j', (arg, expected) => expect(parseWaitCommand(arg)).toEqual(expected));
});

describe('list helpers', () => {
  const a = item({ id: 'wa', since: '2026-10-10', createdAt: '2026-10-10T00:00:00.000Z' });
  const b = item({ id: 'wb', since: '2026-10-12', createdAt: '2026-10-12T00:00:00.000Z' });
  it('openWaitingList is oldest first; resolveWaitTarget by index or id', () => {
    expect(openWaitingList([b, a]).map((i) => i.id)).toEqual(['wa', 'wb']);
    expect(resolveWaitTarget([b, a], '1')?.id).toBe('wa');
    expect(resolveWaitTarget([b, a], 'wb')?.id).toBe('wb');
    expect(resolveWaitTarget([b, a], '9')).toBeNull();
    expect(resolveWaitTarget([b, a], 'zzzzzzz')).toBeNull();
  });
  it('newWaitingId', () => expect(newWaitingId()).toMatch(/^w[0-9a-z]{6}$/));
});
