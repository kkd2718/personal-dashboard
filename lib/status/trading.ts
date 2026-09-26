// Server-only: talks to the user's local trading dashboard. Never import from a client component.
if (typeof window !== 'undefined') {
  throw new Error('lib/status/trading.ts is server-only');
}

import { todayKST } from '@/lib/logic/dates';
import type { StatusItem } from '@/lib/status/types';
import { memoize, withTimeout } from '@/lib/status/types';

const BASE_URL = process.env.TRADING_URL ?? 'http://127.0.0.1:8899';
const TIMEOUT_MS = 3000;
// Degraded results (offline/partial/error) are not cached so the next load retries.
const DEGRADED = new Set(['trading:offline', 'trading:partial', 'trading:error']);
const cached = memoize<StatusItem[]>(5 * 60 * 1000, (items) => !items.some((i) => DEGRADED.has(i.id)));

interface Alert {
  severity: 'critical' | 'warn' | 'info';
  message: string;
}

interface Daemon {
  label: string;
  last_run: string | null;
  next_due: string | null;
}

interface Overview {
  grand_total?: { real_total_krw?: number };
}

async function getJson<T>(path: string): Promise<T | null> {
  return withTimeout(
    async () => {
      const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      return (await res.json()) as T;
    },
    TIMEOUT_MS,
    null
  );
}

/** GET-only status probe for the local trading dashboard. Never POSTs. Never throws. */
export async function tradingStatus(): Promise<StatusItem[]> {
  return cached('trading', async () => {
    try {
      const [alerts, health, overview] = await Promise.all([
        getJson<{ alerts: Alert[] }>('/api/alerts'),
        getJson<{ daemons: Daemon[] }>('/api/health'),
        getJson<Overview>('/api/overview'),
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

      const items: StatusItem[] = [];
      const today = todayKST();
      if (alerts === null || health === null || overview === null) {
        items.push({
          id: 'trading:partial',
          severity: 'info',
          source: 'trading',
          projectId: 'p-trading-system',
          title: '계좌 대시보드 일부 응답 없음',
          detail: null,
          href: BASE_URL,
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
          href: BASE_URL,
        });
      }

      for (const d of health?.daemons ?? []) {
        const overdue = d.next_due != null && d.next_due < today;
        const stale =
          d.last_run != null && d.next_due != null && d.last_run < addDaysToDateStr(d.next_due, -3);
        const alreadyAlerted = (alerts?.alerts ?? []).some((a) => a.message.includes(d.label));
        if ((overdue || stale) && !alreadyAlerted) {
          items.push({
            id: `trading:daemon:${d.label}`,
            severity: 'warn',
            source: 'trading',
            projectId: 'p-trading-system',
            title: `${d.label} 데몬이 ${sinceLabel(d.last_run, today)} 안 돌았어요`,
            detail: `마지막 ${formatDateKo(d.last_run)} · 예정 ${formatDateKo(d.next_due)}`,
            href: BASE_URL,
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
            href: BASE_URL,
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
          href: BASE_URL,
        },
      ];
    }
  });
}

function addDaysToDateStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** '2026-07-31' -> '7월 31일' (ux-advice.md §6 absolute date format). */
function formatDateKo(dateStr: string | null): string {
  if (!dateStr) return '알 수 없음';
  const [, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** How long a daemon has been silent, in Korean weeks/days (never raw hours/dates). */
function sinceLabel(lastRun: string | null, today: string): string {
  if (!lastRun) return '오랫동안';
  const days = Math.round(
    (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastRun.slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000
  );
  if (days < 14) return `${Math.max(days, 0)}일째`;
  return `${Math.floor(days / 7)}주째`;
}
