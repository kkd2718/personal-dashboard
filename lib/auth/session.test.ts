import { describe, expect, it } from 'vitest';
import { createSessionToken, shouldRefresh, verifySessionToken, type SessionInfo } from '@/lib/auth/session';

const SECRET = 'test-secret';

describe('createSessionToken / verifySessionToken', () => {
  it('round-trips a freshly created token', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const token = await createSessionToken(SECRET, now);
    const info = await verifySessionToken(token, SECRET, now);
    expect(info).toEqual({ issuedAt: now, expiresAt: now + 90 * 24 * 60 * 60 * 1000 });
  });

  it('rejects a token signed with a different secret', async () => {
    const now = Date.now();
    const token = await createSessionToken(SECRET, now);
    expect(await verifySessionToken(token, 'wrong-secret', now)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const now = Date.now();
    const token = await createSessionToken(SECRET, now);
    const [issuedAt, expiresAt, sig] = token.split('.');
    const tampered = `${issuedAt}.${Number(expiresAt) + 1000}.${sig}`;
    expect(await verifySessionToken(tampered, SECRET, now)).toBeNull();
  });

  it('rejects a malformed token', async () => {
    expect(await verifySessionToken('not-a-token', SECRET)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const token = await createSessionToken(SECRET, now);
    const later = now + 91 * 24 * 60 * 60 * 1000;
    expect(await verifySessionToken(token, SECRET, later)).toBeNull();
  });
});

describe('shouldRefresh', () => {
  it('false when more than the threshold remains', () => {
    const now = Date.now();
    const info: SessionInfo = { issuedAt: now, expiresAt: now + 89 * 24 * 60 * 60 * 1000 };
    expect(shouldRefresh(info, now)).toBe(false);
  });

  it('true when less than the threshold remains', () => {
    const now = Date.now();
    const info: SessionInfo = { issuedAt: now, expiresAt: now + 10 * 24 * 60 * 60 * 1000 };
    expect(shouldRefresh(info, now)).toBe(true);
  });
});
