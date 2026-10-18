// Model routing for /ask: complexity question for Jev + the budget-aware choice. Pure.
import type { JevAnswer, JevQuestion } from '@/lib/ai/jev';
import { AX_MARGIN, AX_THRESHOLD } from '@/lib/logic/ax-intent';
import type { Pace } from '@/lib/logic/ask-budget';
import { MODEL_SETTINGS, worstCaseUsd, type AskModel, type Price } from '@/lib/logic/ask-cost';

export type Complexity = 'lookup' | 'summarize' | 'reason';

export const COMPLEXITY_QUESTION: JevQuestion = {
  type: 'choice',
  instructions: '개인 대시보드에 대한 질문이 얼마나 복잡한지 고르세요.',
  criteria: {
    lookup: '대시보드에서 사실 몇 개 찾기',
    summarize: '여러 항목 모아 정리',
    reason: '계획·판단·글쓰기·다단계 추론',
  },
};

const HAIKU: AskModel = 'claude-haiku-5-5';
const SONNET: AskModel = 'claude-sonnet-5-5';
const OPUS: AskModel = 'claude-opus-5-5';

/** Jev's complexity answer as `{choice, top, margin}`; null when absent or malformed. */
export function complexityOf(answer: JevAnswer | undefined): RouteInput['complexity'] {
  if (!answer || answer.type !== 'choice') return null;
  if (answer.choice !== 'lookup' && answer.choice !== 'summarize' && answer.choice !== 'reason') return null;
  return { choice: answer.choice, top: answer.top, margin: answer.margin };
}

export interface RouteInput {
  modifier: '!' | '+' | null;
  complexity: { choice: Complexity; top: number | null; margin: number | null } | null;
  pace: Pace;
  prices: Record<AskModel, Price | null>;
  /** Follow-ups reuse the conversation's last model instead of classifying again. */
  followUpModel?: AskModel | null;
}

export type RouteDecision = { model: AskModel; downgraded: boolean; reason: string } | { stop: true; reason: string };

const usd = (n: number): string => `$${n.toFixed(2)}`;

/** Picks the model for one question, in order: exhausted -> wanted -> pace -> worst case -> price -> pre-flight. */
export function chooseModel(r: RouteInput): RouteDecision {
  const { pace } = r;
  const stop = (): RouteDecision => ({
    stop: true,
    reason: `이번 주기 /ask 예산을 다 썼어요 (${usd(pace.spentUsd)}/${usd(pace.limitUsd)}) — ${pace.cycle.nextStart} 초기화`,
  });
  if (pace.exhausted) return stop();

  const c = r.complexity;
  const confidentReason = !!c && c.choice === 'reason' && c.top !== null && c.margin !== null && c.top >= AX_THRESHOLD && c.margin >= AX_MARGIN;
  const wanted: AskModel =
    r.modifier === '!' ? OPUS : r.modifier === '+' ? SONNET : r.followUpModel ?? (confidentReason ? SONNET : HAIKU);

  let model = wanted;
  let downgraded = false;
  let reason = '';
  if (wanted !== HAIKU) {
    const price = r.prices[wanted];
    if (pace.ahead) {
      [model, downgraded, reason] = [HAIKU, true, '페이스 초과'];
    } else if (price && pace.spentUsd + 2 * worstCaseUsd(price, MODEL_SETTINGS[wanted].maxTokens) > pace.allowedUsd) {
      [model, downgraded, reason] = [HAIKU, true, '페이스 여유 부족'];
    } else if (!price) {
      [model, downgraded, reason] = [HAIKU, true, '가격 미설정'];
    }
  }

  const haikuPrice = r.prices[HAIKU];
  if (model === HAIKU && haikuPrice && pace.spentUsd + worstCaseUsd(haikuPrice, MODEL_SETTINGS[HAIKU].maxTokens) > pace.limitUsd) {
    return stop();
  }
  return { model, downgraded, reason };
}
