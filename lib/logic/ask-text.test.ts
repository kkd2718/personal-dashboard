import { describe, expect, it } from 'vitest';
import { extractText, mdToTelegramHtml, splitTelegram, stopReasonNote } from './ask-text';

describe('extractText', () => {
  it('joins text blocks only', () => {
    expect(extractText([{ type: 'thinking' }, { type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });
  it('thinking only gives empty', () => {
    expect(extractText([{ type: 'thinking' }, { type: 'redacted_thinking' }])).toBe('');
  });
});

describe('mdToTelegramHtml', () => {
  it('escapes, converts bold/code/link', () => {
    expect(mdToTelegramHtml('**a<b>** `x&y` [t](https://e.org/?a=1&b=2)')).toBe(
      '<b>a&lt;b&gt;</b> <code>x&amp;y</code> <a href="https://e.org/?a=1&amp;b=2">t</a>'
    );
  });
  it('leaves javascript: links as text', () => {
    const out = mdToTelegramHtml('[x](javascript:alert(1))');
    expect(out).not.toContain('<a');
    expect(out).toContain('javascript:');
  });
  it('fenced code becomes escaped <pre>', () => {
    expect(mdToTelegramHtml('```ts\nconst a = 1 < 2;\n```')).toBe('<pre>const a = 1 &lt; 2;</pre>');
  });
  it('bullets and headings', () => {
    expect(mdToTelegramHtml('# 제목\n- 하나\n* 둘')).toBe('<b>제목</b>\n• 하나\n• 둘');
  });
  it('markdown inside code stays literal', () => {
    expect(mdToTelegramHtml('`**x**`')).toBe('<code>**x**</code>');
  });
  it('stray NUL characters cannot forge placeholders', () => {
    expect(mdToTelegramHtml('a\u00000\u0000b')).toBe('a0b');
  });
});

describe('splitTelegram', () => {
  const noCutInTag = (chunk: string) => chunk.lastIndexOf('<') <= chunk.lastIndexOf('>');

  it('short text is one chunk', () => {
    expect(splitTelegram('hello')).toEqual(['hello']);
  });
  it('9000 chars split into 3 chunks <= 4000', () => {
    const chunks = splitTelegram('가'.repeat(9000));
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(4000);
      expect(noCutInTag(c)).toBe(true);
    }
    expect(chunks.join('').length).toBe(9000);
  });
  it('prefers blank-line boundaries', () => {
    const para = 'a'.repeat(2500);
    const chunks = splitTelegram(`${para}\n\n${para}`);
    expect(chunks).toEqual([para, para]);
  });
  it('closes and reopens <pre> across a cut', () => {
    const html = `<pre>${'x\n'.repeat(3000)}</pre>`;
    const chunks = splitTelegram(html);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(4000);
      expect(c.startsWith('<pre>')).toBe(true);
      expect(c.endsWith('</pre>')).toBe(true);
    }
  });
  it('never cuts inside an entity', () => {
    const chunks = splitTelegram('&amp;'.repeat(2000));
    for (const c of chunks) expect(c.replace(/&amp;/g, '')).toBe('');
  });
});

describe('stopReasonNote', () => {
  it('notes only abnormal stops', () => {
    expect(stopReasonNote('max_tokens')).not.toBeNull();
    expect(stopReasonNote('refusal')).not.toBeNull();
    expect(stopReasonNote('end_turn')).toBeNull();
    expect(stopReasonNote(null)).toBeNull();
  });
});
