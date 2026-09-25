import { describe, expect, it } from 'vitest';
import { parseShare } from './share';

describe('parseShare', () => {
  it('handles url only', () => {
    const result = parseShare({ url: 'https://example.com' });
    expect(result).toEqual({ body: 'https://example.com', kind: 'link' });
  });

  it('dedupes when text already contains the url', () => {
    const result = parseShare({
      title: 'Example',
      text: 'check this out https://example.com',
      url: 'https://example.com',
    });
    expect(result.body).toBe('Example\ncheck this out https://example.com');
    expect(result.kind).toBe('link');
  });

  it('throws when title, text, and url are all empty', () => {
    expect(() => parseShare({})).toThrow();
    expect(() => parseShare({ title: '', text: '  ', url: '' })).toThrow();
  });
});
