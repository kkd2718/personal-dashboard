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
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6">
        <h1 className="mb-1 text-lg font-semibold">Command Center</h1>
        <p className="mb-4 text-sm text-foreground/60">비밀번호를 입력하세요.</p>
        <LoginForm next={next && next.startsWith('/') ? next : '/'} />
      </div>
    </div>
  );
}
