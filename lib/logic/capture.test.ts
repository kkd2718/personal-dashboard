import { describe, expect, it } from 'vitest';
import { parseCapture } from './capture';
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
    pinned: false,
    sort: 0,
    color: 'blue',
    updatedAt: '2026-09-25',
    ...overrides,
  };
}

const projects: Project[] = [
  project({ id: 'p-brainct-fu', slug: 'brainct-fu', name: 'BrainCT_FU' }),
];

describe('parseCapture', () => {
  it('parses project mention + tag', () => {
    const r = parseCapture('@brainct #연구아이디어 counterfactual RL', projects);
    expect(r.projectId).toBe('p-brainct-fu');
    expect(r.tags).toEqual(['연구아이디어']);
    expect(r.kind).toBe('memo');
    expect(r.body).toBe('@brainct #연구아이디어 counterfactual RL');
  });

  it('detects idea from leading !', () => {
    expect(parseCapture('! 새 앱', projects).kind).toBe('idea');
  });

  it('detects idea from leading 아이디어:', () => {
    expect(parseCapture('아이디어: 새 앱', projects).kind).toBe('idea');
  });

  it('detects todo from leading [ ]', () => {
    expect(parseCapture('[ ] 장보기', projects).kind).toBe('todo');
  });

  it('leaves projectId null for an unmatched mention', () => {
    const r = parseCapture('@unknown hi', projects);
    expect(r.projectId).toBeNull();
    expect(r.body).toBe('@unknown hi');
  });

  it('does not false-positive match on unrelated text', () => {
    expect(parseCapture('@브레인 메모', projects).projectId).toBeNull();
  });

  it('dedupes tags case-insensitively, keeping first casing', () => {
    const r = parseCapture('#A #a memo', projects);
    expect(r.tags).toEqual(['A']);
  });

  it('detects link kind for URL-only body', () => {
    expect(parseCapture('https://example.com/paper', projects).kind).toBe('link');
  });

  it('matches full slug/name mention (case-insensitive, underscores)', () => {
    expect(parseCapture('@BrainCT_FU note', projects).projectId).toBe('p-brainct-fu');
  });

  it('matches a project alias', () => {
    const withAlias = [
      project({ id: 'p-brainct-fu', slug: 'brainct-fu', name: 'BrainCT_FU', aliases: ['브레인CT', 'brain ct'] }),
    ];
    expect(parseCapture('@브레인CT 메모', withAlias).projectId).toBe('p-brainct-fu');
    expect(parseCapture('@brain_ct 메모', withAlias).projectId).toBe('p-brainct-fu');
  });

  it('resolves a tag to an existing one with the same normalized form', () => {
    const r = parseCapture('#연구-아이디어', projects, ['연구아이디어']);
    expect(r.tags).toEqual(['연구아이디어']);
  });

  it('keeps a new tag as typed when no existing tag normalizes the same', () => {
    const r = parseCapture('#새태그', projects, ['다른태그']);
    expect(r.tags).toEqual(['새태그']);
  });
});
