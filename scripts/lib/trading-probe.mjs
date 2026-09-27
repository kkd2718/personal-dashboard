// Plain JS, Node >=18. Re-implements lib/status/trading.ts's GET-only probe logic
// for the standalone collector process (which can't import .ts files). Never POSTs.

// Background job — latency is irrelevant, and /api/overview can take several seconds
// on its first call after idle (it rebuilds totals from journal files).
const TIMEOUT_MS = 10000;

function addDaysToDateStr(dateStr, n) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** '2026-07-31' -> '7월 31일' (mirrors lib/status/trading.ts's formatDateKo). */
function formatDateKo(dateStr) {
  if (!dateStr) return '알 수 없음';
  const [, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** How long a daemon has been silent, in Korean weeks/days (never raw hours/dates). */
function sinceLabel(lastRun, today) {
  if (!lastRun) return '오랫동안';
  const days = Math.round(
    (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastRun.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000
  );
  if (days < 14) return `${Math.max(days, 0)}일째`;
  return `${Math.floor(days / 7)}주째`;
}

async function getJson(baseUrl, path) {
  try {
    const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * GET-only status probe for the local trading dashboard. Never POSTs, never throws.
 * @param {string} baseUrl e.g. 'http://127.0.0.1:8899'
 * @param {string} today 'YYYY-MM-DD'
 */
export async function tradingStatus(baseUrl, today) {
  try {
    const [alerts, health, overview] = await Promise.all([
      getJson(baseUrl, '/api/alerts'),
      getJson(baseUrl, '/api/health'),
      getJson(baseUrl, '/api/overview'),
    ]);

    if (alerts === null && health === null && overview === null) {
      return [
        {
          id: 'trading:offline',
          severity: 'info',
          source: 'trading',
          projectId: 'p-trading-system',
          title: '계좌 대시보드가 꺼져 있어요 (PC)',
          detail: null,
          href: null,
        },
      ];
    }

    const items = [];
    if (alerts === null || health === null || overview === null) {
      items.push({
        id: 'trading:partial',
        severity: 'info',
        source: 'trading',
        projectId: 'p-trading-system',
        title: '계좌 대시보드 일부 응답 없음',
        detail: null,
        href: baseUrl,
      });
    }

    for (const a of alerts?.alerts ?? []) {
      items.push({
        id: `trading:alert:${a.message}`,
        severity: a.severity,
        source: 'trading',
        projectId: 'p-trading-system',
        title: a.message,
        detail: null,
        href: baseUrl,
      });
    }

    for (const d of health?.daemons ?? []) {
      // Deliberately paused until a start date (e.g. IB+VR until 10/1): not "silent for
      // N weeks" — say when it starts instead.
      if (d.dormant && d.dormant_until && d.dormant_until > today) {
        items.push({
          id: `trading:dormant:${d.label}`,
          severity: 'info',
          source: 'trading',
          projectId: 'p-trading-system',
          title: `${d.label} ${formatDateKo(d.dormant_until)} 시작 예정`,
          detail: null,
          href: baseUrl,
        });
        continue;
      }
      const overdue = d.next_due != null && d.next_due < today;
      const stale = d.last_run != null && d.next_due != null && d.last_run < addDaysToDateStr(d.next_due, -3);
      const alreadyAlerted = (alerts?.alerts ?? []).some((a) => a.message.includes(d.label));
      if ((overdue || stale) && !alreadyAlerted) {
        items.push({
          id: `trading:daemon:${d.label}`,
          severity: 'warn',
          source: 'trading',
          projectId: 'p-trading-system',
          title: `${d.label} 데몬이 ${sinceLabel(d.last_run, today)} 안 돌았어요`,
          detail: `마지막 ${formatDateKo(d.last_run)} · 예정 ${formatDateKo(d.next_due)}`,
          href: baseUrl,
        });
      }
    }

    if (overview) {
      const real = overview.grand_total?.real_total_krw;
      if (real != null) {
        items.push({
          id: 'trading:overview',
          severity: 'ok',
          source: 'trading',
          projectId: 'p-trading-system',
          title: '계좌 요약',
          detail: `실전 합계 ${Math.round(real).toLocaleString('ko-KR')}원`,
          href: baseUrl,
        });
      }
    }

    return items;
  } catch (e) {
    return [
      {
        id: 'trading:error',
        severity: 'warn',
        source: 'trading',
        projectId: 'p-trading-system',
        title: '계좌 상태 확인 실패',
        detail: e instanceof Error ? e.message : String(e),
        href: baseUrl,
      },
    ];
  }
}
