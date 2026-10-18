import { describe, expect, it } from 'vitest';
import { project } from '@/lib/logic/ax-fixtures';
import type { CalendarEvent, ProjectActivity } from '@/lib/types';
import {
  googleEventId,
  parseRemindArg,
  parseSendArg,
  recentActiveProjects,
  remindExpiry,
  reminderEvent,
  upcomingReminders,
} from './send-remind';

const projects = [
  project({ id: 'p1', slug: 'brainct', name: 'BrainCT' }),
  project({ id: 'p2', slug: 'amgi', name: 'Amgi', aliases: ['암기'] }),
  project({ id: 'p3', slug: 'old', name: 'Old', status: 'paused' }),
];

describe('parseSendArg', () => {
  it('a matching @token picks the project and leaves the content', () => {
    expect(parseSendArg('@brainct 리뷰어 답변 반영해줘', projects, null)).toEqual({ content: '리뷰어 답변 반영해줘', projectId: 'p1' });
    expect(parseSendArg('내용 @암기 끝', projects, null)).toEqual({ content: '내용 끝', projectId: 'p2' });
  });
  it('unknown project: null id, token stays in the content', () => {
    expect(parseSendArg('@nothing 할 일', projects, null)).toEqual({ content: '@nothing 할 일', projectId: null });
    expect(parseSendArg('그냥 내용', projects, null).projectId).toBeNull();
  });
  it('only the project token falls back to the replied-to text; otherwise empty', () => {
    expect(parseSendArg('@amgi', projects, '답변 본문')).toEqual({ content: '답변 본문', projectId: 'p2' });
    expect(parseSendArg('@amgi', projects, null).content).toBe('');
    expect(parseSendArg('', projects, null).content).toBe('');
    expect(parseSendArg('@amgi 직접 쓴 글', projects, '답변 본문').content).toBe('직접 쓴 글');
  });
});

describe('recentActiveProjects', () => {
  const act = (projectId: string, lastCommitAt: string | null): ProjectActivity => ({
    projectId,
    branch: null,
    lastCommitAt,
    lastCommitMsg: null,
    dirty: null,
    lastSessionAt: null,
    memoryDigest: null,
    metrics: {},
    collectedAt: '2026-01-01T00:00:00.000Z',
  });
  it('active only, most recent activity first, at most 8', () => {
    const order = recentActiveProjects(projects, [act('p1', '2026-10-01T00:00:00Z'), act('p2', '2026-11-01T00:00:00Z')]);
    expect(order.map((p) => p.id)).toEqual(['p2', 'p1']);
    const many = Array.from({ length: 12 }, (_, i) => project({ id: `q${i}`, slug: `q${i}`, name: `Q${i}` }));
    expect(recentActiveProjects(many, [])).toHaveLength(8);
  });
});

// 2026-11-07 (Sat) 12:00 KST
const T = '2026-11-07';
const SCOPE = { account: 'a', calendar: 'primary' };
const N = '12:00';

describe('parseRemindArg', () => {
  it('absolute times', () => {
    expect(parseRemindArg('내일 오전 9시 약 먹기', T, N)).toEqual({ kind: 'set', date: '2026-11-08', time: '09:00', content: '약 먹기' });
    expect(parseRemindArg('오늘 오후 3시 30분 회의 준비', T, N)).toEqual({ kind: 'set', date: T, time: '15:30', content: '회의 준비' });
    expect(parseRemindArg('모레 14:00 치과', T, N)).toMatchObject({ date: '2026-11-09', time: '14:00', content: '치과' });
  });
  it('relative durations', () => {
    expect(parseRemindArg('30분 뒤 전화하기', T, N)).toEqual({ kind: 'set', date: T, time: '12:30', content: '전화하기' });
    expect(parseRemindArg('2시간 뒤 약', T, N)).toMatchObject({ time: '14:00', content: '약' });
    expect(parseRemindArg('13시간 뒤 알람', T, N)).toMatchObject({ date: '2026-11-08', time: '01:00' });
  });
  it('a time-only phrase already passed today rolls to tomorrow; a time still ahead stays today', () => {
    expect(parseRemindArg('오전 9시 약', T, N)).toEqual({ kind: 'set', date: '2026-11-08', time: '09:00', content: '약', rolled: true });
    expect(parseRemindArg('오후 3시 약', T, N)).toEqual({ kind: 'set', date: T, time: '15:00', content: '약' });
  });
  it('past times are refused', () => {
    expect(parseRemindArg('오늘 오전 9시 약', T, N)).toEqual({ kind: 'past' });
    expect(parseRemindArg('2026-11-06 오후 3시 약', T, N)).toEqual({ kind: 'past' });
  });
  it('no time, no content, empty -> usage; cancel parsing', () => {
    expect(parseRemindArg('내일 병원', T, N)).toEqual({ kind: 'usage' });
    expect(parseRemindArg('내일 오전 9시', T, N)).toEqual({ kind: 'usage' });
    expect(parseRemindArg('', T, N)).toEqual({ kind: 'usage' });
    expect(parseRemindArg('취소 2', T, N)).toEqual({ kind: 'cancel', n: 2 });
    expect(parseRemindArg('취소', T, N)).toEqual({ kind: 'usage' });
  });
});

describe('reminder events', () => {
  it('10 minute event with a popup at the start; clamps at midnight', () => {
    expect(reminderEvent('약', '2026-11-08', '09:00')).toEqual({ title: '🔔 약', date: '2026-11-08', startTime: '09:00', endTime: '09:10', popupMinutes: 0 });
    expect(reminderEvent('약', '2026-11-08', '23:55').endTime).toBe('23:59');
  });
  const row = (id: string, title: string, startDate: string, startTime: string | null): CalendarEvent => ({
    id,
    account: 'a',
    calendarName: 'c',
    title,
    startDate,
    endDate: startDate,
    startTime,
    endTime: null,
    location: null,
    updatedAt: '',
  });
  it('upcoming reminders: only 🔔, not past, within 14 days, sorted', () => {
    const rows = [
      row('a:primary:e3:x', '🔔 셋째', '2026-11-09', '08:00'),
      row('a:primary:e1:x', '🔔 첫째', T, '12:30'),
      row('a:primary:e0:x', '🔔 지난', T, '09:00'),
      row('a:primary:e9:x', '치과', T, '15:00'),
      row('a:primary:e8:x', '🔔 먼', '2026-12-30', '09:00'),
      row('a:primary:ed:x', '🔔 종일', T, null),
    ];
    expect(upcomingReminders(rows, T, N, SCOPE).map((r) => r.title)).toEqual(['🔔 첫째', '🔔 셋째']);
  });
  it('only the configured account and calendar; a series (same Google id on several rows) is left out', () => {
    const rows = [
      row('a:primary:e1:x', '🔔 내 것', T, '13:00'),
      { ...row('b:primary:e2:x', '🔔 다른 계정', T, '13:00'), account: 'b' },
      row('a:work:e3:x', '🔔 다른 캘린더', T, '13:00'),
      row('a:primary:e4@google.com:2026-11-08', '🔔 반복', '2026-11-08', '09:00'),
      row('a:primary:e4@google.com:2026-11-09', '🔔 반복', '2026-11-09', '09:00'),
    ];
    expect(upcomingReminders(rows, T, N, SCOPE).map((r) => r.title)).toEqual(['🔔 내 것']);
    expect(upcomingReminders(rows, T, N, { account: null, calendar: 'primary' }).map((r) => r.title)).toEqual(['🔔 내 것', '🔔 다른 계정']);
  });
  it('remindExpiry is the event time + 1 day', () => {
    expect(remindExpiry('2026-11-08', '09:00')).toBe('2026-11-09T00:00:00.000Z');
  });
  it('google event id from a mirrored row id', () => {
    expect(googleEventId('a:primary:abc123:2026-11-08T00:00:00.000Z')).toBe('abc123');
    expect(googleEventId('a:me@x.com:abc123@google.com:2026')).toBe('abc123');
    expect(googleEventId('bad')).toBeNull();
  });
});
