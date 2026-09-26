import { describe, expect, it } from 'vitest';
import { buildPaletteIndex } from './palette-index';
import type { Paper, Project, ReviewJob } from '@/lib/types';

function project(overrides: Partial<Project>): Project {
  return {
    id: 'p1',
    slug: 'flow-sorter',
    name: 'flow-sorter',
    group: 'app',
    subgroup: null,
    status: 'active',
    summary: '',
    nextAction: null,
    links: [],
    paths: [],
    aliases: [],
    backlogGlobs: [],
    pinned: false,
    sort: 0,
    color: 'blue',
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: 'pa1',
    title: 'A Fictional Study',
    shortName: 'BrainCT_FU',
    stage: 'writing',
    track: 'AI',
    journal: null,
    manuscriptId: null,
    targetJournals: [],
    folderPath: null,
    nextAction: null,
    projectId: null,
    submissions: [],
    sort: 0,
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

function review(overrides: Partial<ReviewJob>): ReviewJob {
  return {
    id: 'r1',
    journal: 'Fictional Journal',
    manuscriptId: 'FJ-001',
    title: null,
    status: 'invited',
    invitedAt: '2026-09-20',
    dueDate: '2026-10-15',
    link: null,
    note: null,
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

describe('buildPaletteIndex', () => {
  it('includes the fixed page list', () => {
    const entries = buildPaletteIndex([], [], []);
    expect(entries.find((e) => e.id === 'page:calendar')?.href).toBe('/calendar');
  });

  it('maps a project to its slug href with aliases as keywords', () => {
    const entries = buildPaletteIndex([project({ aliases: ['FS'] })], [], []);
    const entry = entries.find((e) => e.id === 'project:p1');
    expect(entry).toMatchObject({ label: 'flow-sorter', href: '/projects/flow-sorter', kind: 'project' });
    expect(entry?.keywords).toContain('FS');
  });

  it('maps papers to /papers with the title as sublabel', () => {
    const entries = buildPaletteIndex([], [paper({})], []);
    const entry = entries.find((e) => e.id === 'paper:pa1');
    expect(entry).toMatchObject({ label: 'BrainCT_FU', sublabel: 'A Fictional Study', href: '/papers' });
  });

  it('only includes reviews still open (invited/accepted)', () => {
    const open = review({ id: 'r1', status: 'invited' });
    const declined = review({ id: 'r2', status: 'declined' });
    const entries = buildPaletteIndex([], [], [open, declined]);
    expect(entries.some((e) => e.id === 'review:r1')).toBe(true);
    expect(entries.some((e) => e.id === 'review:r2')).toBe(false);
  });
});
