#!/usr/bin/env node
// One-off: obtains a Google OAuth refresh token (calendar.events scope) for the /cal
// write path. Desktop-app client + loopback redirect + PKCE. Prints only the refresh
// token to stdout; writes nothing to disk.
//
//   node --env-file=.env.local scripts/google-oauth.mjs
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';

const { GOOGLE_OAUTH_CLIENT_ID: clientId, GOOGLE_OAUTH_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set in .env.local.');
  process.exit(1);
}

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');
const TIMEOUT_MS = 5 * 60 * 1000;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/') {
    res.writeHead(404).end();
    return;
  }
  const finish = (code, message, exitCode) => {
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end(message);
    server.close();
    setTimeout(() => process.exit(exitCode), 50);
  };
  if (url.searchParams.get('state') !== state) return finish(400, 'state mismatch', 1);
  const code = url.searchParams.get('code');
  if (!code) return finish(400, `authorization failed: ${url.searchParams.get('error') ?? 'no code'}`, 1);

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const body = await tokenRes.json();
    if (!tokenRes.ok || !body.refresh_token) {
      console.error(`Token exchange failed: ${body.error ?? tokenRes.status}`);
      return finish(500, 'token exchange failed — see terminal', 1);
    }
    console.log(body.refresh_token);
    finish(200, '완료 — 터미널에 출력된 리프레시 토큰을 Vercel 환경 변수에 넣으세요. 이 창은 닫아도 됩니다.', 0);
  } catch {
    finish(500, 'token exchange failed', 1);
  }
});

let redirectUri = '';
server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
  console.error('Open this URL in your browser and approve access:\n');
  console.error(authUrl);
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', authUrl]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [authUrl]];
  execFile(cmd, args, () => {}); // best-effort; the URL is printed above
});

setTimeout(() => {
  console.error('Timed out after 5 minutes.');
  process.exit(1);
}, TIMEOUT_MS).unref();
