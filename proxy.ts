// Next 16 proxy (renamed from middleware, see node_modules/next/dist/docs/.../proxy.md).
// Gates every route except the public/bearer-token ones behind a signed session
// cookie (single-user app password — see lib/auth/{session,password}.ts). In
// local mode (no APP_PASSWORD/SESSION_SECRET) this is a no-op — auth is skipped
// entirely and LocalRepo behaves exactly as in phase 1a/1c/1d. A production
// deploy with Supabase configured but auth env missing refuses to serve rather
// than running open.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, shouldRefresh, verifySessionToken, createSessionToken } from '@/lib/auth/session';

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/api/capture') ||
    pathname.startsWith('/api/ingest') ||
    pathname.startsWith('/api/cron/') ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/favicon.ico' ||
    pathname === '/apple-icon' ||
    pathname === '/icon.svg'
  );
}

function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!authConfigured()) {
    // Never run a production+Supabase deploy open just because auth env was forgotten.
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return new NextResponse(
        'Auth not configured (APP_PASSWORD/SESSION_SECRET missing) in production with Supabase configured — refusing to serve.',
        { status: 500 }
      );
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET as string;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const info = token ? await verifySessionToken(token, secret) : null;

  if (pathname === '/login') {
    // Already signed in — no need to show the login page again.
    if (info) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }

  if (!info) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  if (shouldRefresh(info)) {
    const refreshed = await createSessionToken(secret);
    response.cookies.set(SESSION_COOKIE, refreshed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 90 * 24 * 60 * 60,
    });
  }
  return response;
}

export const config = {
  matcher: [
    // Exclude Next internals and static assets; everything else goes through the check above
    // (which itself allow-lists /login, /api/capture, /api/ingest, /api/cron/*).
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
