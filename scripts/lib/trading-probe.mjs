// Plain JS, Node >=18. Re-implements lib/status/trading.ts's GET-only probe logic
// for the standalone collector process (which can't import .ts files). Never POSTs.

const TIMEOUT_MS = 3000;

function addDaysToDateStr(dateStr, n) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
          title: '계좌 대시보드 꺼짐 (PC)',
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
      const overdue = d.next_due != null && d.next_due < today;
      const stale = d.last_run != null && d.next_due != null && d.last_run < addDaysToDateStr(d.next_due, -3);
      const alreadyAlerted = (alerts?.alerts ?? []).some((a) => a.message.includes(d.label));
      if ((overdue || stale) && !alreadyAlerted) {
        items.push({
          id: `trading:daemon:${d.label}`,
          severity: 'warn',
          source: 'trading',
          projectId: 'p-trading-system',
          title: `${d.label} 데몬 지연`,
          detail: `last_run=${d.last_run ?? '-'} next_due=${d.next_due ?? '-'}`,
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
