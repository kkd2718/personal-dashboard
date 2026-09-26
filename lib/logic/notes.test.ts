import { describe, expect, it } from 'vitest';
import { filterNotes, tagCounts } from './notes';
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

describe('tagCounts', () => {
  it('dedupes case-insensitively and counts', () => {
    const notes = [note({ tags: ['A'] }), note({ tags: ['a'] }), note({ tags: ['B'] })];
    const counts = tagCounts(notes);
    expect(counts.find((c) => c.tag === 'A')?.count).toBe(2);
  });
});
