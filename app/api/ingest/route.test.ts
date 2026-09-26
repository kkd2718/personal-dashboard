import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Isolates the zod validation path from the repo/env: no INGEST_TOKEN needed to
// reach the schema-rejection branch since checkBearer runs first, so tests set it.
const ORIGINAL_TOKEN = process.env.INGEST_TOKEN;

beforeEach(() => {
  process.env.INGEST_TOKEN = 'test-token';
  vi.resetModules();
});

afterEach(() => {
  process.env.INGEST_TOKEN = ORIGINAL_TOKEN;
});

function req(body: unknown, opts: { auth?: string } = {}): Request {
  return new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { authorization: opts.auth ?? 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ingest', () => {
  it('503s when INGEST_TOKEN is not configured', async () => {
    delete process.env.INGEST_TOKEN;
    const { POST } = await import('./route');
    const res = await POST(req({ statusItems: [] }, { auth: 'Bearer x' }));
    expect(res.status).toBe(503);
  });

  it('401s on a wrong bearer token', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ statusItems: [] }, { auth: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('400s on invalid statusItems (schema rejects malformed severity)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ statusItems: [{ id: 'x', severity: 'nope', source: 'git', projectId: null, title: 't', detail: null, href: null }] }));
    expect(res.status).toBe(400);
  });

  it('413s on an oversized payload', async () => {
    const { POST } = await import('./route');
    const huge = 'x'.repeat(300 * 1024);
    const res = await POST(req({ statusItems: [], junk: huge }));
    expect(res.status).toBe(413);
  });
});
