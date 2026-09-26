'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { loginAction } from '@/app/actions/auth';

/** Single-user app-password login. Sets an HMAC-signed session cookie on success. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await loginAction(password);
      if (!res.ok) return setError(res.error);
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2.5">
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          required
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          className="w-full rounded-[var(--r-sm)] border border-border bg-transparent px-3 py-2.5 pr-10 text-[16px]"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? '비밀번호 숨기기' : '비밀번호 표시'}
          className="absolute inset-y-0 right-1 flex w-9 items-center justify-center text-foreground/40 hover:text-foreground/70"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={pending || !password}
        className="rounded-[var(--r-sm)] bg-accent px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? '확인 중...' : '들어가기'}
      </button>
    </form>
  );
}
