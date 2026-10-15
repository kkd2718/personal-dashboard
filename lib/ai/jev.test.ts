import { describe, expect, it } from 'vitest';
import { createJev, jevToken, parseJevResponse, type JevQuestion } from './jev';

const noulQ: JevQuestion = { type: 'noul', instructions: 'x' };
const choiceQ: JevQuestion = { type: 'choice', instructions: 'x', criteria: { x: 'a', y: 'b' } };
const scoreQ: JevQuestion = { type: 'score', instructions: 'x', criteria: ['low', 'high'] };

describe('parseJevResponse', () => {
  it('noul', () => {
    expect(parseJevResponse({ answers: { a: { type: 'noul', noul: 0.98 } } }, { a: noulQ })).toEqual({
      a: { type: 'noul', p: 0.98 },
    });
  });

  it('choice: top and margin from probabilities', () => {
    const r = parseJevResponse(
      { answers: { a: { type: 'choice', choice: 'x', confidence: 0.5, probabilities: { x: 0.7, y: 0.3 } } } },
      { a: choiceQ }
    );
    const a = r?.a;
    expect(a).toMatchObject({ type: 'choice', choice: 'x', top: 0.7 });
    expect((a as { margin: number }).margin).toBeCloseTo(0.4);
  });

  it('choice without probabilities has null top/margin', () => {
    expect(parseJevResponse({ answers: { a: { type: 'choice', choice: 'x' } } }, { a: choiceQ })?.a).toMatchObject({
      top: null,
      margin: null,
    });
  });

  it('single option: margin = top', () => {
    const a = parseJevResponse(
      { answers: { a: { type: 'choice', choice: 'x', probabilities: { x: 0.9 } } } },
      { a: choiceQ }
    )?.a;
    expect(a).toMatchObject({ top: 0.9, margin: 0.9 });
  });

  it('score', () => {
    const a = parseJevResponse(
      { answers: { s: { type: 'score', score: 1, legend: { '0': 'low', '1': 'high' }, probabilities: { '0': 0.2, '1': 0.8 } } } },
      { s: scoreQ }
    )?.s;
    expect(a).toMatchObject({ type: 'score', score: 1, top: 0.8 });
  });

  it('drops mismatched types; garbage and error bodies are null', () => {
    expect(parseJevResponse({ answers: { a: { type: 'noul', noul: 1 } } }, { a: choiceQ })).toEqual({});
    expect(parseJevResponse('nope', { a: noulQ })).toBeNull();
    expect(parseJevResponse({ message: 'bad', error_type: 'x' }, { a: noulQ })).toBeNull();
  });
});

describe('jevToken', () => {
  it('prefers the API key, then OIDC env, then the request header', () => {
    expect(jevToken({ AI_GATEWAY_API_KEY: 'a', VERCEL_OIDC_TOKEN: 'b' })).toBe('a');
    expect(jevToken({ VERCEL_OIDC_TOKEN: 'b' })).toBe('b');
    expect(jevToken({}, new Headers({ 'x-vercel-oidc-token': 'c' }))).toBe('c');
    expect(jevToken({})).toBeNull();
  });
});

describe('createJev', () => {
  it('null without a token', () => expect(createJev({ token: null })).toBeNull());

  it('posts the model and bearer token', async () => {
    let seen: { body: Record<string, unknown>; auth: string } | null = null;
    const f = async (_url: string, init: RequestInit) => {
      seen = {
        body: JSON.parse(init.body as string),
        auth: (init.headers as Record<string, string>).authorization,
      };
      return new Response(JSON.stringify({ answers: { a: { type: 'noul', noul: 0.5 } } }), { status: 200 });
    };
    const jev = createJev({ token: 'k', fetchImpl: f as unknown as typeof fetch });
    expect(await jev?.ask('s', { a: noulQ })).toEqual({ a: { type: 'noul', p: 0.5 } });
    expect(seen).toMatchObject({ auth: 'Bearer k', body: { model: 'typesafe-ai/jev', state: 's' } });
  });

  it('resolves null on http error or abort', async () => {
    const bad = createJev({ token: 'k', fetchImpl: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch });
    expect(await bad?.ask('s', { a: noulQ })).toBeNull();
    const aborted = createJev({
      token: 'k',
      fetchImpl: (async () => {
        throw new DOMException('aborted', 'AbortError');
      }) as unknown as typeof fetch,
    });
    expect(await aborted?.ask('s', { a: noulQ })).toBeNull();
  });
});
