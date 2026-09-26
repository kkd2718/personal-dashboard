// Server-only. Call at the top of every Server Action / non-public route handler
// that touches the repo, in addition to proxy.ts (defense in depth — see
// "Data Security" note in Next's proxy docs: a matcher change can silently
// remove proxy coverage, so every action must check for itself too).
if (typeof window !== 'undefined') {
  throw new Error('lib/auth/require-user.ts is server-only');
}

import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';

/** True when APP_PASSWORD + SESSION_SECRET are both set — auth is independent of
 * which Repo adapter is in use. Absent in local mode -> auth is skipped entirely. */
export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET);
}

/** A production deploy with Supabase configured must not silently run open. */
export function authMisconfiguredInProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    !authConfigured()
  );
}

/**
 * In local mode (no auth env) this is a no-op. Otherwise throws unless the
 * `cc_session` cookie carries a validly signed, unexpired token.
 */
export async function requireUser(): Promise<void> {
  if (authMisconfiguredInProduction()) {
    throw new Error('Auth not configured (APP_PASSWORD/SESSION_SECRET missing) in production — refusing to serve');
  }
  if (!authConfigured()) return;

  const secret = process.env.SESSION_SECRET as string;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const info = token ? await verifySessionToken(token, secret) : null;
  if (!info) throw new Error('Unauthorized');
}
