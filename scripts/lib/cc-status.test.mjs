import { describe, expect, it } from 'vitest';
import { parseCcStatus } from './cc-status.mjs';

describe('parseCcStatus', () => {
  it('parses a well-formed file', () => {
    const text = JSON.stringify({
      updatedAt: '2026-09-27T16:00:00+09:00',
      focus: '지금 하고 있는 일',
      next: ['다음 할 일'],
      blockers: [],
      done: [{ date: '2026-09-27', text: '끝낸 일' }],
    });
    expect(parseCcStatus(text)).toEqual({
      updatedAt: '2026-09-27T16:00:00+09:00',
      focus: '지금 하고 있는 일',
      next: ['다음 할 일'],
      blockers: [],
      done: [{ date: '2026-09-27', text: '끝낸 일' }],
      checklist: [],
    });
  });

  it('returns null for bad JSON', () => {
    expect(parseCcStatus('not json')).toBeNull();
  });

  it('returns null for a non-object', () => {
    expect(parseCcStatus('[1,2,3]')).toBeNull();
    expect(parseCcStatus('"a string"')).toBeNull();
  });

  it('drops non-strings and trims', () => {
    const text = JSON.stringify({ focus: '  padded  ', next: [1, '  ok  ', null], blockers: 'not an array' });
    expect(parseCcStatus(text)).toEqual({ updatedAt: null, focus: 'padded', next: ['ok'], blockers: [], done: [], checklist: [] });
  });

  it('caps focus at 200 chars', () => {
    const long = 'a'.repeat(300);
    expect(parseCcStatus(JSON.stringify({ focus: long })).focus).toHaveLength(200);
  });

  it('caps next/blockers at 8 items x 200 chars', () => {
    const many = Array.from({ length: 12 }, (_, i) => `item ${i} ${'x'.repeat(250)}`);
    const parsed = parseCcStatus(JSON.stringify({ next: many, blockers: many }));
    expect(parsed.next).toHaveLength(8);
    expect(parsed.blockers).toHaveLength(8);
    expect(parsed.next[0].length).toBe(200);
  });

  it('caps done at 10, keeps given order, nulls a bad date', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ date: '2026-09-27', text: `done ${i}` }));
    many[0] = { date: 'not-a-date', text: 'bad date' };
    const parsed = parseCcStatus(JSON.stringify({ done: many }));
    expect(parsed.done).toHaveLength(10);
    expect(parsed.done[0]).toEqual({ date: null, text: 'bad date' });
  });

  it('parses checklist items, dropping an invalid status and defaulting owner to agent', () => {
    const text = JSON.stringify({
      checklist: [
        { text: '코드 정리', status: 'doing', section: '코드', owner: 'me' },
        { text: '문서 갱신', status: 'todo' },
        { text: '취소된 항목', status: 'cancelled' },
        { text: '나쁜 owner', status: 'done', owner: 'nobody' },
      ],
    });
    expect(parseCcStatus(text).checklist).toEqual([
      { text: '코드 정리', status: 'doing', section: '코드', owner: 'me', due: null },
      { text: '문서 갱신', status: 'todo', section: null, owner: 'agent', due: null },
      { text: '나쁜 owner', status: 'done', section: null, owner: 'agent', due: null },
    ]);
  });

  it('accepts common schema variants: title for text, blocked/in_progress statuses, due dates', () => {
    const text = JSON.stringify({
      checklist: [
        { title: 'IB+VR 시작', status: 'todo', due: '2026-10-01', owner: 'me' },
        { title: '프로브 승인', status: 'blocked' },
        { name: '리팩터', status: 'IN_PROGRESS', due: '10/2' },
      ],
      done: [{ title: '끝난 일', date: '2026-09-27' }],
    });
    const parsed = parseCcStatus(text);
    expect(parsed.checklist).toEqual([
      { text: 'IB+VR 시작', status: 'todo', section: null, owner: 'me', due: '2026-10-01' },
      { text: '프로브 승인', status: 'blocked', section: null, owner: 'agent', due: null },
      { text: '리팩터', status: 'doing', section: null, owner: 'agent', due: null },
    ]);
    expect(parsed.done).toEqual([{ date: '2026-09-27', text: '끝난 일' }]);
  });

  it('caps checklist at 120 items, text at 200 chars, section at 40', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ text: `item ${i} ${'x'.repeat(250)}`, status: 'todo', section: 'y'.repeat(50) }));
    const parsed = parseCcStatus(JSON.stringify({ checklist: many }));
    expect(parsed.checklist).toHaveLength(120);
    expect(parsed.checklist[0].text.length).toBe(200);
    expect(parsed.checklist[0].section.length).toBe(40);
  });

  it('keeps updatedAt only when Date.parse is finite', () => {
    expect(parseCcStatus(JSON.stringify({ focus: 'x', updatedAt: 'garbage' })).updatedAt).toBeNull();
    expect(parseCcStatus(JSON.stringify({ focus: 'x', updatedAt: '2026-09-27T00:00:00Z' })).updatedAt).toBe('2026-09-27T00:00:00Z');
  });

  it('returns null when every field ends up empty', () => {
    expect(parseCcStatus('{}')).toBeNull();
    expect(parseCcStatus(JSON.stringify({ next: [], blockers: [], done: [], checklist: [] }))).toBeNull();
  });
});
