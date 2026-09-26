import { LayoutDashboard } from 'lucide-react';
import { LoginForm } from '@/components/login-form';

interface SearchParams {
  next?: string;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-5 rounded-[var(--r-lg)] border border-border bg-surface p-6">
        <div className="flex flex-col items-center gap-2">
          <LayoutDashboard size={28} className="text-accent" />
          <h1 className="text-lg font-semibold">Command Center</h1>
        </div>
        <LoginForm next={next && next.startsWith('/') ? next : '/'} />
        <p className="text-center text-xs text-foreground/40">이 기기에서 90일간 로그인이 유지돼요.</p>
      </div>
    </div>
  );
}
