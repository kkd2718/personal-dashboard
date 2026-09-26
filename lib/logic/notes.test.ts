import { describe, expect, it } from 'vitest';
import { filterNotes, groupNotesByDate, tagCounts } from './notes';
import type { Note } from '@/lib/types';

function note(overrides: Partial<Note>): Note {
  return {
    id: Math.random().toString(36),
    body: 'x',
    kind: 'memo',
    status: 'inbox',
    projectId: null,
    tags: [],
    date: null,
    pinned: false,
    source: 'web',
    deliveredAt: null,
    taskId: null,
    externalId: null,
    createdAt: '2026-09-25',
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

describe('filterNotes', () => {
  it('excludes archived by default', () => {
    const notes = [note({ status: 'archived' }), note({ status: 'inbox' })];
    expect(filterNotes(notes)).toHaveLength(1);
  });

  it('filters by projectId', () => {
    const notes = [note({ projectId: 'p1' }), note({ projectId: 'p2' })];
    expect(filterNotes(notes, { projectId: 'p1' })).toHaveLength(1);
  });

  it('filters by tag case-insensitively', () => {
    const notes = [note({ tags: ['연구아이디어'] }), note({ tags: ['다른'] })];
    expect(filterNotes(notes, { tag: '연구아이디어' })).toHaveLength(1);
  });
});

describe('groupNotesByDate', () => {
  const today = '2026-09-26'; // Saturday

  it('floats pinned notes into a 고정 group regardless of date', () => {
    const notes = [
      note({ id: 'a', pinned: true, createdAt: '2026-01-01' }),
      note({ id: 'b', createdAt: today }),
    ];
    const groups = groupNotesByDate(notes, today);
    expect(groups[0]).toEqual({ label: '고정', notes: [notes[0]] });
    expect(groups.map((g) => g.label)).toEqual(['고정', '오늘']);
  });

  it('buckets non-pinned notes into 오늘/어제/이번 주/이전 and omits empty groups', () => {
    const notes = [
      note({ id: 'today', createdAt: `${today}T09:00:00Z` }),
      note({ id: 'yesterday', createdAt: '2026-09-25T09:00:00Z' }),
      note({ id: 'thisweek', createdAt: '2026-09-22T09:00:00Z' }), // Tuesday, same ISO week
      note({ id: 'old', createdAt: '2026-08-01T09:00:00Z' }),
    ];
    const groups = groupNotesByDate(notes, today);
    expect(groups.map((g) => g.label)).toEqual(['오늘', '어제', '이번 주', '이전']);
  });

  it('returns no groups for an empty list', () => {
    expect(groupNotesByDate([], today)).toEqual([]);
  });
});

describe('tagCounts', () => {
  it('dedupes case-insensitively and counts', () => {
    const notes = [note({ tags: ['A'] }), note({ tags: ['a'] }), note({ tags: ['B'] })];
    const counts = tagCounts(notes);
    expect(counts.find((c) => c.tag === 'A')?.count).toBe(2);
  });
});
