// Plain JS, Node >=18. Builds the cloud-safe account summary from the local trading
// dashboard's GET endpoints (/api/overview, /api/health, /api/total_trend). Never POSTs.
//
// What leaves the PC (owner decision 2026-09-27: "화면을 가리지 않는 한에서 많이"):
// real total + day change + a week of daily totals, and per account its label, group,
// currency, total value, cumulative return and daemon schedule. Never holdings,
// sub-accounts, cash breakdowns or anything identifying an account at the broker.

const TIMEOUT_MS = 10000;

async function getJson(baseUrl, path) {
  try {
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Pure: raw endpoint JSON -> summary (or null when the overview is missing).
 * @param {any} overview @param {any} health @param {any} trend @param {string} collectedAt
 */
export function buildTradingSummary(overview, health, trend, collectedAt) {
  if (!overview || !Array.isArray(overview.accounts)) return null;
  const daemons = new Map((health?.daemons ?? []).map((d) => [d.state_id, d]));
  const accounts = overview.accounts.map((a) => {
    const d = daemons.get(a.state_id) ?? {};
    return {
      id: String(a.state_id),
      label: str(a.label) ?? String(a.state_id),
      group: str(a.group),
      currency: str(a.currency),
      totalValue: a.no_data ? null : num(a.total_value),
      cumReturnPct: a.no_data ? null : num(a.cum_return_pct),
      noData: Boolean(a.no_data),
      reserveUsd: num(a.reserve_usd), // broker-side cash waiting (e.g. IB+VR before its start date)
      status: str(d.status),
      dormantUntil: d.dormant ? str(d.dormant_until) : null,
      lastRun: str(d.last_run),
      nextDue: str(d.next_due),
    };
  });
  const points = Array.isArray(trend?.points)
    ? trend.points
        .map((p) => ({ date: str(p.date), totalKrw: num(p.total_krw) }))
        .filter((p) => p.date && p.totalKrw !== null)
    : [];
  return {
    collectedAt,
    totalKrw: num(overview.grand_total?.real_total_krw),
    dayChangeKrw: num(trend?.day_change_krw),
    dayChangePct: num(trend?.day_change_pct),
    fxRate: num(overview.grand_total?.fx_rate),
    lastSyncOk: overview.last_sync ? Boolean(overview.last_sync.ok) : null,
    points,
    accounts,
  };
}

/** GET-only fetch + build. Never throws; null when the dashboard is off. */
export async function tradingSummary(baseUrl, collectedAt) {
  const [overview, health, trend] = await Promise.all([
    getJson(baseUrl, '/api/overview'),
    getJson(baseUrl, '/api/health'),
    getJson(baseUrl, '/api/total_trend?range=week'),
  ]);
  return buildTradingSummary(overview, health, trend, collectedAt);
}
