// Intent/target questions for Jev and the decision rule over its answers
// (docs/PLAN_AX.md §6). Pure.
import type { Candidate } from '@/lib/logic/ax-candidates';
import { weekdayOf } from '@/lib/logic/dates';
import type { JevAnswer, JevQuestion } from '@/lib/ai/jev';

export const INTENTS = [
  'memo',
  'task_done',
  'task_reschedule',
  'deadline_done',
  'deadline_reschedule',
  'calendar_event',
  'waiting_reply',
] as const;
export type Intent = (typeof INTENTS)[number];

/** Accept a choice only when its probability is at least this and leads the runner-up by AX_MARGIN. */
export const AX_THRESHOLD = 0.6;
export const AX_MARGIN = 0.2;
/** Whether the reply tracker (waiting_reply intent) is offered to Jev. */
export const WAITING_ENABLED = true;

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function axState(text: string, today: string): string {
  return `메시지: "${text.replace(/"/g, "'")}"\n오늘: ${today} (${WEEKDAY_KO[weekdayOf(today)]})`;
}

const INTENT_CRITERIA: Record<Intent, string> = {
  memo: '단순 메모, 아이디어, 잡담, 링크 저장 (일정/할 일 상태 변경 아님)',
  task_done: '기존 할 일을 끝냈다는 보고 (예: "초안 끝냈어")',
  task_reschedule: '기존 할 일의 마감을 미루거나 날짜를 바꿔 달라는 요청',
  deadline_done: '기존 마감/제출 항목을 끝냈거나 제출했다는 보고',
  deadline_reschedule: '기존 마감 항목의 날짜나 시간을 바꿔 달라는 요청',
  calendar_event: '새 일정(약속, 회의, 진료 등)을 캘린더에 추가해 달라는 요청',
  waiting_reply: '누군가의 답장을 기다리는 중이니 추적해 달라는 요청',
};

export function axQuestions(candidates: Candidate[]): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  for (const i of INTENTS) if (i !== 'waiting_reply' || WAITING_ENABLED) criteria[i] = INTENT_CRITERIA[i];
  const questions: Record<string, JevQuestion> = {
    intent: { type: 'choice', instructions: '사용자 메시지의 의도를 하나 고르세요.', criteria },
  };
  if (candidates.length > 0) {
    const targets: Record<string, string> = {};
    for (const c of candidates) {
      targets[c.key] = `${c.title} · ${c.projectName ?? '프로젝트 없음'} · 마감 ${c.dueDate ?? '없음'}`;
    }
    targets.none = '위 항목 중 해당하는 것이 없음';
    questions.target = { type: 'choice', instructions: '메시지가 가리키는 기존 항목을 고르세요.', criteria: targets };
  }
  return questions;
}

export type Decision =
  | { ok: true; intent: Intent; target: Candidate | null }
  | { ok: false; reason: 'low_intent' | 'low_target' | 'no_target' | 'kind_mismatch' | 'jev_error' };

type ChoiceAnswer = Extract<JevAnswer, { type: 'choice' }>;

/** True when a choice clears both the probability threshold and the runner-up margin. */
export function confident(a: ChoiceAnswer, threshold = AX_THRESHOLD): boolean {
  return a.top !== null && a.margin !== null && a.top >= threshold && a.margin >= AX_MARGIN;
}

export function decide(
  answers: Record<string, JevAnswer> | null,
  candidates: Candidate[],
  threshold = AX_THRESHOLD
): Decision {
  const intentAnswer = answers?.intent;
  if (!intentAnswer || intentAnswer.type !== 'choice') return { ok: false, reason: 'jev_error' };
  if (!confident(intentAnswer, threshold)) return { ok: false, reason: 'low_intent' };
  const intent = (INTENTS as readonly string[]).includes(intentAnswer.choice) ? (intentAnswer.choice as Intent) : null;
  if (!intent) return { ok: false, reason: 'low_intent' };
  if (intent === 'memo' || intent === 'calendar_event') return { ok: true, intent, target: null };
  if (intent === 'waiting_reply') {
    // A linked task/deadline is optional: use it only when Jev is confident about it.
    const t = answers?.target;
    const linked =
      t?.type === 'choice' && t.choice !== 'none' && confident(t, threshold)
        ? candidates.find((c) => c.key === t.choice)
        : undefined;
    return { ok: true, intent, target: linked ?? null };
  }

  const targetAnswer = answers?.target;
  if (candidates.length === 0 || (targetAnswer?.type === 'choice' && targetAnswer.choice === 'none')) {
    return { ok: false, reason: 'no_target' };
  }
  if (!targetAnswer || targetAnswer.type !== 'choice' || !confident(targetAnswer, threshold)) {
    return { ok: false, reason: 'low_target' };
  }
  const wantsTask = intent.startsWith('task_');
  if (targetAnswer.choice.startsWith(wantsTask ? 'd:' : 't:')) return { ok: false, reason: 'kind_mismatch' };
  const target = candidates.find((c) => c.key === targetAnswer.choice);
  return target ? { ok: true, intent, target } : { ok: false, reason: 'low_target' };
}

/** Texts that are explicitly memos: skip Jev (no cost, no latency). */
export function obviousMemo(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith('!') ||
    t.startsWith('아이디어:') ||
    t.startsWith('[ ]') ||
    t.startsWith('메모:') ||
    /^https?:\/\/\S+$/i.test(t)
  );
}
