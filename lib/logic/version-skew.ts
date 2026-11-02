// Pure decisions for components/version-watcher.tsx: has the server been redeployed
// under an open tab, and is it safe to reload?

export const RELOAD_MARK_KEY = 'cc:reloadedFor';
export const VERSION_CHECK_THROTTLE_MS = 60_000;
/** Pseudo server version meaning "a stale server action proved a newer deploy exists". */
export const ACTION_MISMATCH = '__action_mismatch__';

/** The non-empty `version` string of a /api/version response, else null. */
export function parseVersionResponse(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const v = (json as { version?: unknown }).version;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export type SkewAction = 'none' | 'reload' | 'prompt';

export function skewAction(i: {
  clientVersion: string;
  serverVersion: string | null;
  unsafe: boolean;
  reloadedFor: string | null;
}): SkewAction {
  if (i.clientVersion === 'dev' || !i.serverVersion || i.serverVersion === i.clientVersion) return 'none';
  if (i.reloadedFor === i.serverVersion || i.unsafe) return 'prompt';
  return 'reload';
}
