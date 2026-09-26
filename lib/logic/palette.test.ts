import { describe, expect, it } from 'vitest';
import { filterPaletteEntries, type PaletteEntry } from './palette';

const entries: PaletteEntry[] = [
  { id: 'p1', label: '홈', kind: 'page', href: '/' },
  { id: 'p2', label: '동네시세', sublabel: 'realty-chart', kind: 'project', keywords: ['realty', '시세'] },
  { id: 'p3', label: 'BrainCT_FU', sublabel: 'AI 논문', kind: 'paper' },
  { id: 'p4', label: 'flow-sorter', kind: 'project' },
];

describe('filterPaletteEntries', () => {
  it('empty query returns entries in original order, capped at limit', () => {
    expect(filterPaletteEntries(entries, '', 2)).toEqual([entries[0], entries[1]]);
  });

  it('matches a substring case-insensitively', () => {
    const result = filterPaletteEntries(entries, 'brainct');
    expect(result.map((e) => e.id)).toEqual(['p3']);
  });

  it('matches via sublabel/keywords, not just the label', () => {
    const result = filterPaletteEntries(entries, 'realty');
    expect(result.map((e) => e.id)).toEqual(['p2']);
  });

  it('ranks a tight substring match above a scattered subsequence match', () => {
    const scattered: PaletteEntry = { id: 'x', label: 'f-l-o-w s-o-r-t-e-r extra', kind: 'project' };
    const tight: PaletteEntry = { id: 'y', label: 'flow-sorter', kind: 'project' };
    const result = filterPaletteEntries([scattered, tight], 'flow-sorter');
    expect(result[0].id).toBe('y');
  });

  it('drops entries with no match at all', () => {
    const result = filterPaletteEntries(entries, 'zzz-no-match');
    expect(result).toEqual([]);
  });
});
