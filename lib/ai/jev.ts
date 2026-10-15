// Server-only client for Jev (typesafe-ai/jev via Vercel AI Gateway): structured
// classification with per-option probabilities. Never throws, never logs the state
// text or the token. Response shape verified live 2026-10-15:
//   {answers: {key: {type:'noul', noul} | {type:'choice', choice, confidence, probabilities}
//                   | {type:'score', score, confidence, legend, probabilities}}, usage, ...}
// `confidence` runs systematically below the top probability, so callers threshold on
// `top` + `margin` instead (lib/logic/ax-intent.ts).
if (typeof window !== 'undefined') {
  throw new Error('lib/ai/jev.ts is server-only');
}

import { z } from 'zod';

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> } // 1..255 options
  | { type: 'score'; instructions: string; criteria: string[] }; // ordered labels, index = score

export type JevAnswer =
  | { type: 'noul'; p: number }
  | {
      type: 'choice';
      choice: string;
      top: number | null; // probabilities[choice] ?? max
      margin: number | null; // top - runner-up (single option => top)
      probabilities: Record<string, number> | null;
    }
  | {
      type: 'score';
      score: number;
      top: number | null;
      probabilities: Record<string, number> | null;
      legend: Record<string, string> | null;
    };

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone';

/** `AI_GATEWAY_API_KEY`, else `VERCEL_OIDC_TOKEN`, else the `x-vercel-oidc-token` request header. */
export function jevToken(
  env: Record<string, string | undefined> = process.env,
  headers?: Headers
): string | null {
  return env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || headers?.get('x-vercel-oidc-token') || null;
}

const probs = z.record(z.string(), z.number());
const answerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: z.number() }),
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities: probs.nullish() }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    probabilities: probs.nullish(),
    legend: z.record(z.string(), z.string()).nullish(),
  }),
]);

function topAndMargin(
  probabilities: Record<string, number> | null,
  key: string
): { top: number | null; margin: number | null } {
  if (!probabilities) return { top: null, margin: null };
  const values = Object.values(probabilities).sort((a, b) => b - a);
  if (values.length === 0) return { top: null, margin: null };
  const top = probabilities[key] ?? values[0];
  const others = Object.entries(probabilities)
    .filter(([k]) => k !== key)
    .map(([, v]) => v);
  return { top, margin: top - (others.length > 0 ? Math.max(...others) : 0) };
}

/** Tolerant parse: unknown/malformed answers are dropped; an answer whose type doesn't
 * match its question is dropped; no `answers` object at all => null. */
export function parseJevResponse(
  json: unknown,
  questions: Record<string, JevQuestion>
): Record<string, JevAnswer> | null {
  const answers = json && typeof json === 'object' ? (json as { answers?: unknown }).answers : undefined;
  if (!answers || typeof answers !== 'object') return null;
  const out: Record<string, JevAnswer> = {};
  for (const [key, q] of Object.entries(questions)) {
    const parsed = answerSchema.safeParse((answers as Record<string, unknown>)[key]);
    if (!parsed.success || parsed.data.type !== q.type) continue;
    const a = parsed.data;
    if (a.type === 'noul') out[key] = { type: 'noul', p: a.noul };
    else if (a.type === 'choice') {
      const probabilities = a.probabilities ?? null;
      out[key] = { type: 'choice', choice: a.choice, probabilities, ...topAndMargin(probabilities, a.choice) };
    } else {
      const probabilities = a.probabilities ?? null;
      out[key] = {
        type: 'score',
        score: a.score,
        probabilities,
        legend: a.legend ?? null,
        top: topAndMargin(probabilities, String(a.score)).top,
      };
    }
  }
  return out;
}

export interface Jev {
  ask(state: string, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer> | null>;
}

/** null when no token is available (callers then skip AI entirely). */
export function createJev(opts: { token?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Jev | null {
  const token = opts.token === undefined ? jevToken() : opts.token;
  if (!token) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  return {
    async ask(state, questions) {
      try {
        const res = await fetchImpl(GATEWAY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ model: 'typesafe-ai/jev', state, questions }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        return parseJevResponse(await res.json(), questions);
      } catch {
        return null;
      }
    },
  };
}
