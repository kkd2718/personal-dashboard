import { describe, expect, it } from 'vitest';
import { countBacklog, countJsonProgress, extractSection, parseBacklogEntry } from './backlog.mjs';

describe('countBacklog', () => {
  it('counts checkbox-style markdown', () => {
    const text = ['- [ ] a', '- [x] b', '* [X] c', '- [ ] d'].join('\n');
    expect(countBacklog(text)).toEqual({ open: 2, done: 2 });
  });

  it('counts Amgi-style numbered items (real BACKLOG.md format)', () => {
    const text = [
      '13. ~~submit-answer-batch 다건 INSERT 재시도 중복쓰기 리스크~~ **완료·배포(2026-09-02)** — 상세',
      '3. **테스트 격리 부채 라운드** — 병렬 워커 공유 실DB 레이스 ✅ **해소(2026-09-14)**',
      '8. **scripts/export/knowledge.ts JSONL 덤프** — digital twin export',
    ].join('\n');
    expect(countBacklog(text)).toEqual({ open: 1, done: 2 });
  });

  it('ignores nested/indented lines under numbered items', () => {
    const text = ['1. **top level** — open', '   - nested detail line', '   추가 설명 줄'].join('\n');
    expect(countBacklog(text)).toEqual({ open: 1, done: 0 });
  });

  it('ignores numbered items when the file has checkboxes (no double counting)', () => {
    const text = ['- [ ] a', '1. **also numbered**'].join('\n');
    expect(countBacklog(text)).toEqual({ open: 1, done: 0 });
  });

  it('returns zeros for a file with neither format', () => {
    expect(countBacklog('# just a heading\nsome prose')).toEqual({ open: 0, done: 0 });
  });
});

describe('backlog sections', () => {
  const md = ['# BACKLOG', '## 코드 (coder 소관)', '1. **a** ✅', '2. **b**', '## 콘텐츠', '3. **c**', '4. **d**'].join('\n');
  it('parses file#section entries', () => {
    expect(parseBacklogEntry('docs/BACKLOG.md#코드')).toEqual({ label: null, file: 'docs/BACKLOG.md', section: '코드' });
    expect(parseBacklogEntry('docs/TODO.md')).toEqual({ label: null, file: 'docs/TODO.md', section: null });
  });
  it('counts only the named section', () => {
    expect(countBacklog(extractSection(md, '코드'))).toEqual({ open: 1, done: 1 });
  });
  it('missing section counts nothing', () => {
    expect(extractSection(md, '없음')).toBe('');
  });
});

describe('labeled entries + JSON progress files', () => {
  it('parses a 라벨= prefix', () => {
    expect(parseBacklogEntry('노트=docs/progress.json#notes')).toEqual({ label: '노트', file: 'docs/progress.json', section: 'notes' });
    expect(parseBacklogEntry('코드=docs/BACKLOG.md#코드')).toEqual({ label: '코드', file: 'docs/BACKLOG.md', section: '코드' });
  });

  it('reads {key:{done,total}} and rejects nonsense', () => {
    expect(countJsonProgress('{"notes":{"done":161,"total":420}}', 'notes')).toEqual({ open: 259, done: 161 });
    expect(countJsonProgress('{"notes":{"done":5,"total":0}}', 'notes')).toEqual({ open: 0, done: 0 });
    expect(countJsonProgress('not json', 'notes')).toEqual({ open: 0, done: 0 });
    expect(countJsonProgress('{"notes":{"done":9,"total":4}}', 'notes')).toEqual({ open: 0, done: 4 });
  });
});
