// Korean natural-language date/time extraction (docs/PLAN_AX.md §3). Pure; all date
// math goes through dates.ts. Each rule is one branch so the owner can tweak it.
import {
  addDaysStr,
  addMonthsStr,
  startOfSundayWeek,
  startOfMonthStr,
  weekdayOf,
} from '@/lib/logic/dates';

export type DateShift = { unit: 'day' | 'month'; n: number };

export interface KoDateTime {
  date: string | null; // first absolute date
  shift: DateShift | null; // postpone phrase
  times: string[]; // 'HH:mm', order of appearance, de-duplicated
  range: { start: string; end: string } | null;
  durationMin: number | null;
  spans: Array<[number, number]>; // half-open char ranges consumed in `text`
}

const WEEKDAYS = '월화수목금토일';
const WEEKDAY_INDEX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const RELATIVE_DAYS: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2, 내일모레: 2, 글피: 3 };
const SHIFT_WORDS: Record<string, DateShift> = {
  하루: { unit: 'day', n: 1 },
  이틀: { unit: 'day', n: 2 },
  사흘: { unit: 'day', n: 3 },
  나흘: { unit: 'day', n: 4 },
  일주일: { unit: 'day', n: 7 },
  보름: { unit: 'day', n: 15 },
};
const KO_COUNT: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4 };

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const fmtDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Year-less month/day: this year, or next year when more than 60 days in the past. */
function resolveMonthDay(m: number, d: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const cutoff = addDaysStr(today, -60);
  for (const y of [year, year + 1]) {
    if (!validDate(y, m, d)) return null;
    const candidate = fmtDate(y, m, d);
    if (candidate >= cutoff) return candidate;
  }
  return null;
}

/** Bare day-of-month: this month if still ahead (and valid), else the first of the next two valid months. */
function resolveDayOfMonth(d: number, today: string): string | null {
  const todayDay = Number(today.slice(8));
  for (let k = d >= todayDay ? 0 : 1; k <= 2; k++) {
    const [y, m] = addMonthsStr(startOfMonthStr(today), k).split('-').map(Number);
    if (validDate(y, m, d)) return fmtDate(y, m, d);
  }
  return null;
}

function weekdayDate(wd: number, prefix: string | undefined, today: string): string {
  if (!prefix) {
    const delta = (wd - weekdayOf(today) + 7) % 7 || 7;
    return addDaysStr(today, delta);
  }
  const weeks = prefix.startsWith('다다음') ? 2 : prefix.startsWith('다음') ? 1 : /^(저번|지난)/.test(prefix) ? -1 : 0;
  // Owner decision: weeks run Sunday to Saturday.
  return addDaysStr(startOfSundayWeek(addDaysStr(today, weeks * 7)), wd);
}

type Meridiem = 'am' | 'pm';
const meridiemOf = (w: string | undefined): Meridiem | null =>
  !w ? null : '오전아침새벽'.includes(w) ? 'am' : 'pm';

/** Minutes since midnight for hour `h` under an explicit meridiem; null = not parseable. */
function explicitHour(h: number, mer: Meridiem, word?: string): number | null {
  if (h > 23) return null;
  if (mer === 'am') return h === 12 ? 0 : h;
  if (word === '밤' && h === 12) return null;
  return h < 12 ? h + 12 : h;
}

const bareHour = (h: number) => (h >= 1 && h <= 6 ? h + 12 : h);

interface TimeToken {
  start: number;
  end: number;
  word?: string;
  h: number;
  m: number;
  colon: boolean;
}

const TIME_RE =
  /(?:(오전|아침|새벽|오후|낮|저녁|밤)\s?)?(?:(\d{1,2})시(?!간)(?:\s?(반)|\s?(\d{1,2})분)?(?:\s?(?:쯤|경))?|(?<![\d:])(\d{1,2}):(\d{2})(?![\d:]))|정오/g;
const SHORT_RANGE_RE = /(?:(오전|아침|새벽|오후|낮|저녁|밤)\s?)?(?<![\d-])(\d{1,2})\s?-\s?(\d{1,2})시(?!간)/g;
const RANGE_GAP_RE = /^\s?(?:~|-|–|부터)\s?$/;

const SHIFT_VERB = '(?:\\s*(?:뒤로|후로|더))?\\s*(?:미뤄|미루|미룸|연기|늦춰)(?:줘|주세요)?';
// A unit (일/주/달/개월) is required so "버전 2 미뤄" is no shift; a number right after
// "월" ("10월 3일 미뤄") is a date, not a shift.
const SHIFT_RE = new RegExp(
  `(?<!월\\s?)(?<![\\d/.])(하루|이틀|사흘|나흘|일주일|보름|(한|두|세|네)\\s?(주|달)|(\\d+)\\s?(주일|주|일|달|개월))${SHIFT_VERB}`,
  'g'
);
const SHIFT_NEXT_WEEK_RE = new RegExp(`다음\\s?주로\\s*(?:미뤄|미루|미룸|연기|늦춰)(?:줘|주세요)?`, 'g');
const SHIFT_PLUS_RE = /\+(\d+)\s?(일|주|달)/g;

const DURATION_RE = /(\d+)\s?시간(?:\s?(반))?|(\d+)\s?분\s?(?:간|동안|짜리)/g;

export function parseKoDateTime(text: string, today: string): KoDateTime {
  // Blank URLs (same length, so spans stay aligned with the caller's text).
  const src = text.replace(/https?:\/\/\S+/g, (u) => ' '.repeat(u.length));
  const used = new Array<boolean>(src.length).fill(false);
  const spans: Array<[number, number]> = [];
  const dateHits: Array<{ pos: number; date: string }> = [];

  const free = (s: number, e: number) => !used.slice(s, e).some(Boolean);
  const take = (s: number, e: number) => {
    for (let i = s; i < e; i++) used[i] = true;
    spans.push([s, e]);
  };
  /** Runs `fn` on each match whose range is still free; `fn` returns true to consume it. */
  const scan = (re: RegExp, fn: (m: RegExpExecArray) => boolean) => {
    re.lastIndex = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const s = m.index;
      const e = s + m[0].length;
      if (free(s, e) && fn(m)) take(s, e);
    }
  };

  // 1. shift phrases
  let shift: DateShift | null = null;
  const setShift = (s: DateShift) => {
    shift ??= s;
    return true;
  };
  scan(SHIFT_RE, (m) => {
    if (m[2] !== undefined) {
      const n = KO_COUNT[m[2]];
      return setShift(m[3] === '달' ? { unit: 'month', n } : { unit: 'day', n: n * 7 });
    }
    if (m[4] !== undefined) {
      const n = Number(m[4]);
      if (m[5] === '달' || m[5] === '개월') return setShift({ unit: 'month', n });
      return setShift({ unit: 'day', n: m[5].startsWith('주') ? n * 7 : n });
    }
    return setShift(SHIFT_WORDS[m[1]]);
  });
  scan(SHIFT_NEXT_WEEK_RE, () => setShift({ unit: 'day', n: 7 }));
  scan(SHIFT_PLUS_RE, (m) => {
    const n = Number(m[1]);
    if (m[2] === '달') return setShift({ unit: 'month', n });
    return setShift({ unit: 'day', n: m[2] === '주' ? n * 7 : n });
  });

  // 2. ISO date
  scan(/(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/g, (m) => {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validDate(y, mo, d)) return false;
    dateHits.push({ pos: m.index, date: fmtDate(y, mo, d) });
    return true;
  });

  // 3-4. M/D and M월 D일
  const monthDay = (m: RegExpExecArray) => {
    const date = resolveMonthDay(Number(m[1]), Number(m[2]), today);
    // An invalid day is still consumed so its "30일" half isn't re-read as a bare D일.
    if (date) dateHits.push({ pos: m.index, date });
    return true;
  };
  scan(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g, monthDay);
  scan(/(?<!\d)(\d{1,2})\s?월\s?(\d{1,2})\s?일/g, monthDay);

  // 5. relative words
  scan(/내일모레|글피|모레|내일|오늘/g, (m) => {
    dateHits.push({ pos: m.index, date: addDaysStr(today, RELATIVE_DAYS[m[0]]) });
    return true;
  });

  // 6. weekdays
  scan(
    new RegExp(`(다다음\\s?주|다음\\s?주|이번\\s?주|저번\\s?주|지난\\s?주)?\\s?(?:([${WEEKDAYS}])(?:요일|욜)|\\(([${WEEKDAYS}])\\))`, 'g'),
    (m) => {
      const wd = WEEKDAY_INDEX[m[2] ?? m[3]];
      dateHits.push({ pos: m.index, date: weekdayDate(wd, m[1], today) });
      return true;
    }
  );

  // 7. bare D일
  scan(/(?<![\d/.월])(\d{1,2})일(?!\s?(?:간|동안|뒤|후|미뤄|연기))/g, (m) => {
    const date = resolveDayOfMonth(Number(m[1]), today);
    if (!date) return false;
    dateHits.push({ pos: m.index, date });
    return true;
  });

  // 8-9. ranges and times
  const entries: Array<{ pos: number; time: string }> = [];
  let range: { start: string; end: string } | null = null;
  const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  /** Sets the range and returns true; false (range dropped) when it would cross midnight. */
  const setRange = (startMin: number, endMin: number): boolean => {
    let end = endMin;
    if (end <= startMin) end += 720;
    if (end >= 1440) return false;
    range ??= { start: hhmm(startMin), end: hhmm(end) };
    return true;
  };

  scan(SHORT_RANGE_RE, (m) => {
    const mer = meridiemOf(m[1]);
    const h1 = Number(m[2]);
    const h2 = Number(m[3]);
    const a = mer ? explicitHour(h1, mer, m[1]) : bareHour(h1);
    const b = mer ? explicitHour(h2, mer, m[1]) : bareHour(h2);
    if (a === null || b === null || a > 23 || b > 23) return false;
    entries.push({ pos: m.index, time: hhmm(a * 60) });
    if (setRange(a * 60, b * 60)) entries.push({ pos: m.index + 1, time: hhmm(b * 60) });
    return true;
  });

  const tokens: TimeToken[] = [];
  TIME_RE.lastIndex = 0;
  for (let m = TIME_RE.exec(src); m; m = TIME_RE.exec(src)) {
    const s = m.index;
    const e = s + m[0].length;
    if (!free(s, e)) continue;
    if (m[0] === '정오') tokens.push({ start: s, end: e, h: 12, m: 0, colon: false });
    else if (m[5] !== undefined) tokens.push({ start: s, end: e, word: m[1], h: Number(m[5]), m: Number(m[6]), colon: true });
    else tokens.push({ start: s, end: e, word: m[1], h: Number(m[2]), m: m[3] ? 30 : m[4] ? Number(m[4]) : 0, colon: false });
  }

  let carry: { mer: Meridiem; word: string } | null = null;
  let prev = -1;
  const resolved: Array<{ tok: TimeToken; min: number }> = [];
  for (const tok of tokens) {
    if (tok.m > 59) continue;
    const explicit = meridiemOf(tok.word);
    let hour: number | null;
    if (explicit) {
      hour = explicitHour(tok.h, explicit, tok.word);
      if (hour !== null) carry = { mer: explicit, word: tok.word as string };
    } else if (tok.colon || tok.h >= 13) {
      hour = tok.h > 23 ? null : tok.h;
    } else {
      const carried = carry ? explicitHour(tok.h, carry.mer, carry.word) : null;
      hour = carried !== null && carried * 60 + tok.m > prev ? carried : bareHour(tok.h);
    }
    if (hour === null) continue;
    prev = hour * 60 + tok.m;
    resolved.push({ tok, min: prev });
  }

  for (let i = 0; i < resolved.length; i++) {
    const { tok, min } = resolved[i];
    const next = resolved[i + 1];
    let e = tok.end;
    entries.push({ pos: tok.start, time: hhmm(min) });
    if (next && range === null && RANGE_GAP_RE.test(src.slice(tok.end, next.tok.start))) {
      e = next.tok.end;
      const tail = /^\s?까지/.exec(src.slice(e));
      if (tail) e += tail[0].length;
      // A range crossing midnight is dropped: keep only the start, never a second event.
      if (setRange(min, next.min)) entries.push({ pos: next.tok.start, time: hhmm(next.min) });
      i++;
    }
    take(tok.start, e);
  }

  // 10. duration
  let durationMin: number | null = null;
  scan(DURATION_RE, (m) => {
    const minutes = m[1] !== undefined ? Number(m[1]) * 60 + (m[2] ? 30 : 0) : Number(m[3]);
    durationMin ??= minutes;
    return true;
  });

  const times: string[] = [];
  for (const e of entries.sort((a, b) => a.pos - b.pos)) if (!times.includes(e.time)) times.push(e.time);
  dateHits.sort((a, b) => a.pos - b.pos);

  return {
    date: dateHits[0]?.date ?? null,
    shift,
    times,
    range,
    durationMin,
    spans: spans.sort((a, b) => a[0] - b[0]),
  };
}

const PARTICLE_RE = /^(?:에서|으로|까지|부터|에|로|쯤)(?![가-힣])/;

/** Removes `spans` (and a particle glued to each), collapses whitespace, trims. */
export function stripSpans(text: string, spans: Array<[number, number]>): string {
  let out = '';
  let pos = 0;
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (e <= pos) continue;
    out += text.slice(pos, Math.max(s, pos));
    pos = e;
    const particle = PARTICLE_RE.exec(text.slice(pos));
    if (particle) pos += particle[0].length;
  }
  out += text.slice(pos);
  return out.replace(/\s+/g, ' ').trim();
}

export function applyShift(base: string, shift: DateShift): string {
  return shift.unit === 'day' ? addDaysStr(base, shift.n) : addMonthsStr(base, shift.n);
}

/** Postponing counts from the later of the current due date and today. */
export function rescheduleBase(currentDue: string | null, today: string): string {
  return currentDue && currentDue > today ? currentDue : today;
}

export function addMinutesKst(date: string, time: string, minutes: number): { date: string; time: string } {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes;
  const dayOffset = Math.floor(total / 1440);
  const rem = total - dayOffset * 1440;
  return { date: addDaysStr(date, dayOffset), time: `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}` };
}

const REQUEST_TAIL_RE = /\s*(?:잡아|추가해|넣어|등록해|알려|해)\s?(?:줘요?|주세요|줄래)[.!]?$/;

/** Drops a trailing request verb ("치과 잡아줘" -> "치과") from an event title. */
export function stripRequestVerbs(title: string): string {
  return title.replace(REQUEST_TAIL_RE, '').trim();
}

const REL_OFFSET_RE = /(?:(\d+|한|두|세|네)\s?시간(?:\s?(반)|\s?(\d{1,2})\s?분)?|(\d+)\s?분)\s?(?:뒤|후)(?:에)?/g;

/** "30분 뒤", "2시간 뒤", "1시간 30분 후", "한 시간 반 뒤": minutes from now plus the matched span; null when absent. */
export function parseRelativeOffset(text: string): { minutes: number; span: [number, number] } | null {
  REL_OFFSET_RE.lastIndex = 0;
  const m = REL_OFFSET_RE.exec(text);
  if (!m) return null;
  let minutes: number;
  if (m[4] !== undefined) minutes = Number(m[4]);
  else {
    const hours = KO_COUNT[m[1]] ?? Number(m[1]);
    minutes = hours * 60 + (m[2] ? 30 : m[3] ? Number(m[3]) : 0);
  }
  return minutes > 0 ? { minutes, span: [m.index, m.index + m[0].length] } : null;
}
