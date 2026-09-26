import { describe, expect, it } from 'vitest';
import { checkBearer, constantTimeEqual } from '@/lib/auth/bearer';

function req(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set('authorization', authHeader);
  return new Request('http://localhost/api/capture', { headers });
}

describe('constantTimeEqual', () => {
  it('true for identical strings', () => expect(constantTimeEqual('abc123', 'abc123')).toBe(true));
  it('false for different strings of the same length', () => expect(constantTimeEqual('abc123', 'abc124')).toBe(false));
  it('false for different lengths', () => expect(constantTimeEqual('abc', 'abcd')).toBe(false));
});

describe('checkBearer', () => {
  it('missing-config when the expected token is unset', () => {
    expect(checkBearer(req('Bearer x'), undefined)).toBe('missing-config');
    expect(checkBearer(req('Bearer x'), '')).toBe('missing-config');
  });

  it('unauthorized when the header is absent', () => {
    expect(checkBearer(req(), 'secret')).toBe('unauthorized');
  });

  it('unauthorized when the header does not match Bearer <token>', () => {
    expect(checkBearer(req('Basic abc'), 'secret')).toBe('unauthorized');
  });

  it('unauthorized when the token is wrong', () => {
    expect(checkBearer(req('Bearer wrong'), 'secret')).toBe('unauthorized');
  });

  it('ok when the token matches', () => {
    expect(checkBearer(req('Bearer secret'), 'secret')).toBe('ok');
  });
});
