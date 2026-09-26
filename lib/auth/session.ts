// Signed session tokens for the single-user app-password login (see
// lib/auth/password.ts, proxy.ts, lib/auth/require-user.ts). Uses Web Crypto
// (globalThis.crypto.subtle) rather than node:crypto so the same code works in
// both the Node.js and Edge runtimes (Next 16 Proxy defaults to Node, but this
// stays portable if that ever changes).
import { constantTimeEqual } from '@/lib/auth/bearer';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_DAYS = 90;
export const REFRESH_THRESHOLD_DAYS = 30;
export const SESSION_COOKIE = 'cc_session';

export interface SessionInfo {
  issuedAt: number;
  expiresAt: number;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(sig);
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HMAC-SHA256(secret, message) as a base64url string — used for the password check too. */
export async function hmacDigest(secret: string, message: string): Promise<string> {
  return hmac(secret, message);
}

/** Signed `issuedAt.expiresAt.signature` cookie value, valid for SESSION_DAYS. */
export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const issuedAt = now;
  const expiresAt = now + SESSION_DAYS * DAY_MS;
  const payload = `${issuedAt}.${expiresAt}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

/** Verifies signature + expiry. Returns null if malformed, forged, or expired. */
export async function verifySessionToken(token: string, secret: string, now = Date.now()): Promise<SessionInfo | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [issuedAtStr, expiresAtStr, sig] = parts;
  const payload = `${issuedAtStr}.${expiresAtStr}`;
  const expectedSig = await hmac(secret, payload);
  if (!constantTimeEqual(sig, expectedSig)) return null;

  const issuedAt = Number(issuedAtStr);
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  if (now > expiresAt) return null;

  return { issuedAt, expiresAt };
}

/** True when less than REFRESH_THRESHOLD_DAYS remain — caller should reissue the cookie. */
export function shouldRefresh(info: SessionInfo, now = Date.now()): boolean {
  return info.expiresAt - now < REFRESH_THRESHOLD_DAYS * DAY_MS;
}
