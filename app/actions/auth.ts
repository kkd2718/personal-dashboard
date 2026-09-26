'use server';

import { z } from 'zod';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkPassword } from '@/lib/auth/password';
import { isRateLimited, recordFailure, recordSuccess } from '@/lib/auth/rate-limit';
import { createSessionToken, SESSION_COOKIE, SESSION_DAYS } from '@/lib/auth/session';
import { authConfigured } from '@/lib/auth/require-user';

const passwordSchema = z.string().min(1);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() ?? h.get('x-real-ip') ?? 'unknown';
}

export async function loginAction(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!authConfigured()) return { ok: false, error: '로그인이 설정되어 있지 않습니다.' };

  const key = await clientKey();
  if (isRateLimited(key)) {
    return { ok: false, error: '너무 여러 번 실패했습니다. 10분 후 다시 시도하세요.' };
  }

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: '비밀번호를 입력하세요.' };

  const ok = await checkPassword(parsed.data, process.env.APP_PASSWORD as string, process.env.SESSION_SECRET as string);
  if (!ok) {
    recordFailure(key);
    await sleep(1000);
    return { ok: false, error: '비밀번호가 올바르지 않습니다.' };
  }

  recordSuccess(key);
  const token = await createSessionToken(process.env.SESSION_SECRET as string);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return { ok: true };
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect('/login');
}
