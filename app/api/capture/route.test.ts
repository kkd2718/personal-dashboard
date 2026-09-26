import { describe, expect, it, beforeEach, afterEach } from 'vitest';

const ORIGINAL_TOKEN = process.env.CAPTURE_TOKEN;

beforeEach(() => {
  process.env.CAPTURE_TOKEN = 'test-token';
});

afterEach(() => {
  process.env.CAPTURE_TOKEN = ORIGINAL_TOKEN;
});

function req(body: unknown, auth = 'Bearer test-token'): Request {
  return new Request('http://localhost/api/capture', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/capture (auth branches — never open when token unset)', () => {
  it('503s when CAPTURE_TOKEN is not configured', async () => {
    delete process.env.CAPTURE_TOKEN;
    const { POST } = await import('./route');
    const res = await POST(req({ text: 'hi' }, 'Bearer x'));
    expect(res.status).toBe(503);
  });

  it('401s on a missing/wrong bearer token', async () => {
    const { POST } = await import('./route');
    expect((await POST(req({ text: 'hi' }, 'Bearer wrong'))).status).toBe(401);
    const noAuthReq = new Request('http://localhost/api/capture', {
      method: 'POST',
      body: JSON.stringify({ text: 'hi' }),
    });
    expect((await POST(noAuthReq)).status).toBe(401);
  });

  it('400s on an empty text body', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ text: '' }));
    expect(res.status).toBe(400);
  });
});
