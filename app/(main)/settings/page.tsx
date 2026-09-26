import { Download, Settings as SettingsIcon } from 'lucide-react';
import { getRepo } from '@/lib/repo';
import { Card } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme-toggle';
import { IntegrationRow } from '@/components/settings/integration-row';
import { CalendarVisibilitySettings } from '@/components/settings/calendar-visibility-settings';
import { LogoutButton } from '@/components/settings/logout-button';
import { authConfigured } from '@/lib/auth/require-user';
import { googleAccountsFromMeta, integrationRowInfo, type IntegrationMeta } from '@/lib/logic/integrations';
import { CALENDAR_VISIBLE_META_KEY } from '@/lib/logic/calendar';
import { addDaysStr, todayKST } from '@/lib/logic/dates';

// Timestamps compared against "now" server-side; never cache this page.
export const dynamic = 'force-dynamic';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold text-foreground/80">{children}</h2>;
}

export default async function SettingsPage() {
  const repo = getRepo();
  const today = todayKST();
  const now = new Date().toISOString();

  const [collector, telegram, obsidian, googleMetaRaw, visibleCalendars, googleEvents] = await Promise.all([
    repo.getMeta<IntegrationMeta>('integration:collector'),
    repo.getMeta<IntegrationMeta>('integration:telegram'),
    repo.getMeta<IntegrationMeta>('integration:obsidian'),
    repo.listMetaByPrefix('integration:google:'),
    repo.getMeta<string[]>(CALENDAR_VISIBLE_META_KEY),
    repo.listCalendarEvents(addDaysStr(today, -30), addDaysStr(today, 60)),
  ]);
  const googleAccounts = googleAccountsFromMeta(googleMetaRaw);

  const isSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const deployedAt = process.env.VERCEL ? now : null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">설정</h1>

      <section>
        <SectionTitle>연동 상태</SectionTitle>
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            <IntegrationRow name="수집기" {...integrationRowInfo('collector', collector, now)} />
            <IntegrationRow name="Telegram" {...integrationRowInfo('telegram', telegram, now)} />
            <IntegrationRow name="Obsidian" {...integrationRowInfo('obsidian', obsidian, now)} />
            {Object.keys(googleAccounts).length === 0 ? (
              <IntegrationRow name="Google" {...integrationRowInfo('google', null, now)} />
            ) : (
              Object.entries(googleAccounts).map(([account, meta]) => (
                <IntegrationRow key={account} name={`Google (${account})`} {...integrationRowInfo('google', meta, now)} />
              ))
            )}
          </ul>
        </Card>
      </section>

      <section>
        <SectionTitle>캘린더 표시</SectionTitle>
        <Card>
          <CalendarVisibilitySettings googleEvents={googleEvents} visibleCalendars={visibleCalendars} />
        </Card>
      </section>

      <section>
        <SectionTitle>데이터</SectionTitle>
        <Card className="flex items-center justify-between">
          <p className="text-sm text-foreground/60">모든 테이블의 전체 JSON 백업을 내려받아요.</p>
          <a
            href="/api/export"
            className="flex items-center gap-1.5 rounded-[var(--r-sm)] border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
          >
            <Download size={14} />
            JSON 내보내기
          </a>
        </Card>
      </section>

      <section>
        <SectionTitle>표시</SectionTitle>
        <Card className="flex items-center justify-between">
          <p className="text-sm text-foreground/60">라이트/다크 테마</p>
          <ThemeToggle />
        </Card>
      </section>

      {authConfigured() && (
        <section>
          <SectionTitle>계정</SectionTitle>
          <Card className="flex items-center justify-between">
            <p className="text-sm text-foreground/60">이 기기에서 로그아웃해요.</p>
            <LogoutButton />
          </Card>
        </section>
      )}

      <section>
        <SectionTitle>정보</SectionTitle>
        <Card>
          <ul className="flex flex-col gap-1 text-sm text-foreground/60">
            <li>어댑터: {isSupabase ? 'Supabase' : '로컬 (JSON 파일)'}</li>
            <li>빌드: {commitSha ? commitSha.slice(0, 7) : '알 수 없음 (로컬 개발)'}</li>
            {deployedAt && <li>배포: {deployedAt}</li>}
          </ul>
        </Card>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-foreground/30">
        <SettingsIcon size={12} />
        Command Center
      </p>
    </div>
  );
}
