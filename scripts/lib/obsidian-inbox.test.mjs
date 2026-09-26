import { describe, expect, it } from 'vitest';
import { applyImports, defaultInboxContent, externalIdFor, parseNewMemos } from './obsidian-inbox.mjs';

describe('parseNewMemos', () => {
  it('parses simple top-level bullets', () => {
    const text = ['## 새 메모', '- first memo', '- second memo', '', '## 가져옴', ''].join('\n');
    const memos = parseNewMemos(text);
    expect(memos.map((m) => m.text)).toEqual(['first memo', 'second memo']);
  });

  it('joins continuation lines indented by 2+ spaces', () => {
    const text = ['## 새 메모', '- first line', '  continued line', '  another line', '- next memo', '## 가져옴'].join(
      '\n'
    );
    const memos = parseNewMemos(text);
    expect(memos).toHaveLength(2);
    expect(memos[0].text).toBe('first line\ncontinued line\nanother line');
    expect(memos[1].text).toBe('next memo');
  });

  it('supports the checkbox bullet form', () => {
    const text = ['## 새 메모', '- [ ] todo-style memo', '- [x] done-style memo'].join('\n');
    const memos = parseNewMemos(text);
    expect(memos.map((m) => m.text)).toEqual(['todo-style memo', 'done-style memo']);
  });

  it('returns [] for an empty section', () => {
    const text = ['## 새 메모', '<!-- comment only -->', '', '## 가져옴'].join('\n');
    expect(parseNewMemos(text)).toEqual([]);
  });

  it('returns [] when the "새 메모" heading is missing', () => {
    const text = ['## 가져옴', '- old imported entry'].join('\n');
    expect(parseNewMemos(text)).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const text = ['## 새 메모', '- crlf memo', '## 가져옴'].join('\r\n');
    const memos = parseNewMemos(text);
    expect(memos.map((m) => m.text)).toEqual(['crlf memo']);
  });

  it('preserves the exact raw block for later removal', () => {
    const text = ['## 새 메모', '- memo with @project #tag', '## 가져옴'].join('\n');
    const memos = parseNewMemos(text);
    expect(memos[0].raw).toBe('- memo with @project #tag');
  });
});

describe('externalIdFor', () => {
  it('is stable across trivial whitespace differences', () => {
    expect(externalIdFor('hello   world')).toBe(externalIdFor('hello world'));
    expect(externalIdFor('  hello world  ')).toBe(externalIdFor('hello world'));
  });

  it('differs for different text and is prefixed', () => {
    expect(externalIdFor('a')).not.toBe(externalIdFor('b'));
    expect(externalIdFor('a')).toMatch(/^obsidian:[0-9a-f]{40}$/);
  });
});

describe('applyImports', () => {
  it('removes imported bullets from 새 메모 and prepends them under 가져옴', () => {
    const text = ['## 새 메모', '- keep this', '- import this', '## 가져옴', '- old entry <!-- cc:n0 2026-01-01 -->'].join(
      '\n'
    );
    const result = applyImports(text, [
      { raw: '- import this', text: 'import this', noteId: 'n1', date: '2026-09-26' },
    ]);
    const memosAfter = parseNewMemos(result);
    expect(memosAfter.map((m) => m.text)).toEqual(['keep this']);
    expect(result).toContain('- import this <!-- cc:n1 2026-09-26 -->');
    expect(result.indexOf('cc:n1')).toBeLessThan(result.indexOf('cc:n0')); // newest first
  });

  it('caps 가져옴 at 50 entries, dropping the oldest', () => {
    const oldEntries = Array.from({ length: 50 }, (_, i) => `- old ${i} <!-- cc:o${i} 2026-01-01 -->`);
    const text = ['## 새 메모', '- new memo', '## 가져옴', ...oldEntries].join('\n');
    const result = applyImports(text, [{ raw: '- new memo', text: 'new memo', noteId: 'n1', date: '2026-09-26' }]);
    const importedLines = result.split('\n').filter((l) => l.trim().startsWith('- '));
    expect(importedLines).toHaveLength(50);
    expect(result).toContain('cc:n1');
    expect(result).not.toContain('cc:o49'); // oldest dropped
  });

  it('creates a 가져옴 section when missing', () => {
    const text = ['## 새 메모', '- solo memo'].join('\n');
    const result = applyImports(text, [{ raw: '- solo memo', text: 'solo memo', noteId: 'n1', date: '2026-09-26' }]);
    expect(result).toContain('## 가져옴');
    expect(result).toContain('cc:n1');
  });

  it('is a no-op when there is nothing to import', () => {
    const text = defaultInboxContent();
    expect(applyImports(text, [])).toBe(text);
  });

  it('preserves CRLF line endings', () => {
    const text = ['## 새 메모', '- crlf memo', '## 가져옴', ''].join('\r\n');
    const result = applyImports(text, [{ raw: '- crlf memo', text: 'crlf memo', noteId: 'n1', date: '2026-09-26' }]);
    expect(result).toContain('\r\n');
    expect(result).not.toMatch(/[^\r]\n/); // every \n is preceded by \r
  });

  it('preserves a multi-line memo body only as its first line in the archived entry', () => {
    const text = ['## 새 메모', '- first line', '  second line', '## 가져옴'].join('\n');
    const [memo] = parseNewMemos(text);
    const result = applyImports(text, [{ raw: memo.raw, text: memo.text, noteId: 'n1', date: '2026-09-26' }]);
    expect(result).toContain('- first line <!-- cc:n1 2026-09-26 -->');
    expect(result).not.toContain('- first line\n  second line <!--');
  });
});

describe('defaultInboxContent', () => {
  it('includes frontmatter and both sections', () => {
    const content = defaultInboxContent();
    expect(content).toContain('tags: [command-center]');
    expect(content).toContain('## 새 메모');
    expect(content).toContain('## 가져옴');
  });
});
