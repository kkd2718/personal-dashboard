import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.mjs';

describe('parseEnv', () => {
  it('parses KEY=VALUE lines, ignoring blanks and comments', () => {
    const text = ['# comment', '', 'CLOUD_URL=https://example.com', 'INGEST_TOKEN=abc123'].join('\n');
    expect(parseEnv(text)).toEqual({ CLOUD_URL: 'https://example.com', INGEST_TOKEN: 'abc123' });
  });

  it('strips CR and surrounding quotes', () => {
    const text = 'A="quoted"\r\nB=\'single\'\r\nC=plain\r\n';
    expect(parseEnv(text)).toEqual({ A: 'quoted', B: 'single', C: 'plain' });
  });

  it('ignores lines with no =', () => {
    expect(parseEnv('not-a-line\nX=1')).toEqual({ X: '1' });
  });
});
