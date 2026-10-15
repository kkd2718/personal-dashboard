import { describe, expect, it } from 'vitest';
import type { Candidate } from './ax-candidates';
import { deadline, paper, project, task } from './ax-fixtures';
import {
  buildProposal,
  decodeCallback,
  encodeCallback,
  formatProposal,
  isExpired,
  newShortId,
  proposalKeyboard,
  rememberUpdate,
  type BuildInput,
} from './ax-proposal';

const TODAY = '2026-10-15';
const tCand: Candidate = { key: 't:1', kind: 'task', id: '1', title: '논문', projectName: null, dueDate: null };
const dCand: Candidate = { key: 'd:1', kind: 'deadline', id: '1', title: '제출', projectName: null, dueDate: '2026-10-20' };

function build(text: string, intent: BuildInput['intent'], o: Partial<BuildInput> = {}) {
  return buildProposal({
    text,
    today: TODAY,
    nowTime: '10:00',
    intent,
    target: tCand,
    tasks: [task({ id: '1', title: '논문', dueDate: '2026-10-10' })],
    deadlines: [deadline({ id: '1', title: '제출', dueDate: '2026-10-20' })],
    projects: [],
    papers: [],
    ...o,
  });
}

describe('buildProposal: reschedule', () => {
  it('shift counts from today when the due date has passed', () => {
    expect(build('2주 미뤄', 'task_reschedule')).toMatchObject({
      ok: true,
      proposal: { to: '2026-10-29', from: '2026-10-10' },
    });
  });
  it('shift counts from a future due date', () => {
    const tasks = [task({ id: '1', title: '논문', dueDate: '2026-10-20' })];
    expect(build('+3일', 'task_reschedule', { tasks })).toMatchObject({ ok: true, proposal: { to: '2026-10-23' } });
  });
  it('explicit date', () => {
    expect(build('다음주 화요일로', 'task_reschedule')).toMatchObject({ ok: true, proposal: { to: '2026-10-20' } });
  });
  it('failures', () => {
    expect(build('미뤄줘', 'task_reschedule')).toEqual({ ok: false, reason: '날짜를 찾지 못했어요' });
    expect(build('10월 3일로 미뤄', 'task_reschedule')).toEqual({ ok: false, reason: '과거 날짜예요' });
    const tasks = [task({ id: '1', title: '논문', dueDate: '2026-10-20' })];
    expect(build('다음주 화요일로', 'task_reschedule', { tasks })).toEqual({ ok: false, reason: '이미 그 날짜예요' });
  });
  it('deadline gets dueTime only when given', () => {
    expect(build('금요일 5시로 미뤄', 'deadline_reschedule', { target: dCand })).toMatchObject({
      ok: true,
      proposal: { kind: 'deadline_reschedule', to: '2026-10-16', dueTime: '17:00' },
    });
    const r = build('금요일로 미뤄', 'deadline_reschedule', { target: dCand });
    expect(r.ok && 'dueTime' in r.proposal).toBe(false);
  });
  it('missing or wrong-kind target', () => {
    expect(build('끝냈어', 'task_done', { target: dCand })).toMatchObject({ ok: false });
    expect(build('끝냈어', 'task_done', { tasks: [] })).toMatchObject({ ok: false });
  });
});

describe('buildProposal: calendar_event', () => {
  it('two bare times => two events, tokens stripped', () => {
    const r = build('내일 2시 3시 미팅 @brainct #회의', 'calendar_event', { target: null });
    expect(r.ok && r.proposal.kind === 'calendar_event' && r.proposal.events).toEqual([
      { title: '미팅', date: '2026-10-16', startTime: '14:00', endTime: '15:00' },
      { title: '미팅', date: '2026-10-16', startTime: '15:00', endTime: '16:00' },
    ]);
  });
  it('strips trailing request verbs from the title', () => {
    for (const text of ['내일 3시 치과 잡아줘', '내일 3시 치과 추가해줘', '내일 3시 치과 넣어줘', '내일 3시 치과 등록해줘', '내일 3시 치과해줘']) {
      const r = build(text, 'calendar_event', { target: null });
      expect(r.ok && r.proposal.kind === 'calendar_event' && r.proposal.events[0].title).toBe('치과');
    }
  });
  it('fails without date/time, without a title, or in the past', () => {
    expect(build('미팅', 'calendar_event', { target: null })).toMatchObject({ ok: false });
    expect(build('내일', 'calendar_event', { target: null })).toEqual({ ok: false, reason: '제목을 찾지 못했어요' });
    expect(build('10월 3일 미팅', 'calendar_event', { target: null })).toEqual({ ok: false, reason: '과거 날짜예요' });
  });
});

describe('buildProposal: waiting_reply', () => {
  const projects = [project({ id: 'p1', slug: 'brainct', name: 'BrainCT 연구' })];
  const papers = [paper({ id: 'pp', shortName: 'BrainCT', projectId: 'p1' })];

  it('extracts sender, subject from the mentioned project, nudge days', () => {
    const r = build('editor@journal.org 답장 기다림 @brainct 10일 미뤄', 'waiting_reply', { target: null, projects, papers });
    expect(r).toMatchObject({
      ok: true,
      proposal: { kind: 'waiting_reply', projectId: 'p1', match: { from: 'editor@journal.org', subject: 'BrainCT' }, nudgeAfterDays: 10 },
    });
  });
  it('nudge days from a day shift; no sender means no from', () => {
    const r = build('편집자 답장 기다림 5일 뒤로 미뤄', 'waiting_reply', { target: null });
    expect(r).toMatchObject({ ok: true, proposal: { match: {}, nudgeAfterDays: 5 } });
  });
  it('formatProposal flags a missing sender', () => {
    const r = build('편집자 답장 기다림', 'waiting_reply', { target: null });
    expect(r.ok && formatProposal(r.proposal, TODAY)).toContain('미지정');
  });
});

describe('proposal plumbing', () => {
  it('formatProposal escapes', () => {
    expect(formatProposal({ kind: 'task_done', taskId: '1', title: 'a<b' }, TODAY)).toContain('a&lt;b');
  });
  it('callback codec', () => {
    const p = encodeCallback({ t: 'p', id: 'abc123', a: 'ok' });
    expect(decodeCallback(p)).toEqual({ t: 'p', id: 'abc123', a: 'ok' });
    const w = encodeCallback({ t: 'w', id: 'w1a2b3', i: 2, a: 'd' });
    expect(decodeCallback(w)).toEqual({ t: 'w', id: 'w1a2b3', i: 2, a: 'd' });
    expect(decodeCallback('p:abc:zz')).toBeNull();
    for (const row of proposalKeyboard(newShortId()).inline_keyboard)
      for (const b of row) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
  it('newShortId', () => expect(newShortId()).toMatch(/^[0-9a-z]{10}$/));
  it('isExpired', () => {
    const t0 = '2026-10-15T00:00:00.000Z';
    const at = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
    expect(isExpired(t0, at(24 * 3600_000 + 1), 24)).toBe(true);
    expect(isExpired(t0, at(23 * 3600_000), 24)).toBe(false);
  });
  it('rememberUpdate', () => {
    expect(rememberUpdate([1, 2], 2)).toEqual({ seen: true, next: [1, 2] });
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const { next } = rememberUpdate(ids, 99);
    expect(next).toHaveLength(50);
    expect(next.at(-1)).toBe(99);
  });
});
