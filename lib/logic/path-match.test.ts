import { describe, expect, it } from 'vitest';
import { matchProjectByPath, normalizePath } from './path-match';
import type { Project } from '@/lib/types';

function project(overrides: Partial<Project>): Project {
  return {
    id: 'p1',
    slug: 'p1',
    name: 'P1',
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

describe('normalizePath', () => {
  it('lowercases and converts backslashes', () => {
    expect(normalizePath('C:\\Users\\Kkd\\Desktop\\Work')).toBe('c:/users/kkd/desktop/work');
  });

  it('rewrites /mnt/c/ to c:/', () => {
    expect(normalizePath('/mnt/c/Users/kkd/Desktop/Work')).toBe('c:/users/kkd/desktop/work');
  });

  it('strips a trailing slash', () => {
    expect(normalizePath('/home/kkd/projects/amgi/')).toBe('/home/kkd/projects/amgi');
  });

  it('leaves a /home path as-is (besides lowercasing)', () => {
    expect(normalizePath('/home/minsu/projects/amgi')).toBe('/home/minsu/projects/amgi');
  });
});

describe('matchProjectByPath', () => {
  const flowSorter = project({
    id: 'p-flow-sorter',
    paths: ['C:\\Users\\kkd\\Desktop\\Work\\traicer-corp\\flow-sorter'],
  });
  const amgi = project({ id: 'p-amgi', paths: ['/home/minsu/projects/amgi'] });
  const projects = [flowSorter, amgi];

  it('matches a Windows cwd against a Windows Project.paths entry', () => {
    expect(matchProjectByPath(projects, 'C:\\Users\\kkd\\Desktop\\Work\\traicer-corp\\flow-sorter')?.id).toBe(
      'p-flow-sorter'
    );
  });

  it('matches a /mnt/c cwd against the same Windows Project.paths entry', () => {
    expect(
      matchProjectByPath(projects, '/mnt/c/Users/kkd/Desktop/Work/traicer-corp/flow-sorter')?.id
    ).toBe('p-flow-sorter');
  });

  it('matches a /home cwd against a WSL Project.paths entry', () => {
    expect(matchProjectByPath(projects, '/home/minsu/projects/amgi')?.id).toBe('p-amgi');
  });

  it('matches a subdirectory of a project path (longest-prefix)', () => {
    expect(matchProjectByPath(projects, '/home/minsu/projects/amgi/src')?.id).toBe('p-amgi');
  });

  it('returns null when no project path is a prefix', () => {
    expect(matchProjectByPath(projects, '/home/minsu/projects/other')).toBeNull();
  });

  it('picks the longer (more specific) path when one project path is a prefix of another', () => {
    const outer = project({ id: 'p-outer', paths: ['/home/minsu/projects'] });
    const inner = project({ id: 'p-inner', paths: ['/home/minsu/projects/amgi'] });
    expect(matchProjectByPath([outer, inner], '/home/minsu/projects/amgi/src')?.id).toBe('p-inner');
  });
});
