import { relTime } from '@/lib/logic/dates';

/** Shape written to app_meta['integration:<name>'] (docs/PLAN_UX.md decision 3):
 * collector -> /api/ingest, google:<account> -> /api/google/sync,
 * obsidian -> /api/capture (source obsidian), telegram -> webhook/digest sends. */
export interface IntegrationMeta {
  at: string; // ISO timestamp of last successful activity
  detail?: string; // short Korean fragment, e.g. '6개 프로젝트' or '캘린더 3개 · 후보 0'
}

export type IntegrationHealth = 'ok' | 'stale' | 'unknown';

export interface IntegrationRowInfo {
  health: IntegrationHealth;
  sentence: string; // ready-to-render Korean line, relTime already applied
}

/** Staleness thresholds in hours (ux-advice.md §5.8). Telegram has no threshold —
 * it's event-driven (webhook/digest), so any known `at` reads as ok. */
const STALE_HOURS: Record<string, number | null> = {
  collector: 3,
  google: 3,
  obsidian: 3,
  telegram: null,
};

/** Builds the 연동 상태 row copy + health dot for one integration, given its meta
 * (null when never seen) and a threshold keyed by the integration's base name
 * (e.g. `google` for `google:main`). `nowIso` is injected for testability. */
export function integrationRowInfo(
  baseName: string,
  meta: IntegrationMeta | null,
  nowIso: string
): IntegrationRowInfo {
  if (!meta) return { health: 'unknown', sentence: '설정되지 않음' };

  const rel = relTime(meta.at, nowIso);
  const sentence = meta.detail ? `마지막 수신 ${rel} · ${meta.detail}` : `마지막 수신 ${rel}`;

  const threshold = STALE_HOURS[baseName] ?? null;
  if (threshold === null) return { health: 'ok', sentence };

  const ageMs = new Date(nowIso).getTime() - new Date(meta.at).getTime();
  const stale = ageMs > threshold * 60 * 60 * 1000;
  return { health: stale ? 'stale' : 'ok', sentence };
}

/** Splits a flat `{ 'integration:google:main': {...}, ... }` map (from
 * `Repo.listMetaByPrefix('integration:google:')`) into `{ account: meta }`. */
export function googleAccountsFromMeta(prefixed: Record<string, unknown>): Record<string, IntegrationMeta> {
  const out: Record<string, IntegrationMeta> = {};
  for (const [key, value] of Object.entries(prefixed)) {
    const account = key.slice('integration:google:'.length);
    if (account) out[account] = value as IntegrationMeta;
  }
  return out;
}

/** Google accounts whose Apps Script hasn't synced for `hours` (it runs in Google's cloud
 * hourly, so a gap means a missing trigger or expired authorization — 2026-10: unnoticed
 * for 10 days). Returns e.g. `['main (10일 전)']`, oldest first. */
export function staleGoogleAccounts(
  prefixed: Record<string, unknown>,
  nowIso: string,
  hours = 6
): string[] {
  const now = new Date(nowIso).getTime();
  return Object.entries(googleAccountsFromMeta(prefixed))
    .filter(([, m]) => m?.at && now - new Date(m.at).getTime() > hours * 3_600_000)
    .sort(([, a], [, b]) => a.at.localeCompare(b.at))
    .map(([account, m]) => `${account} (${relTime(m.at, nowIso)})`);
}
