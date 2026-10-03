// Pure CareNote helpers (PLAN_CARENOTE.md §2, Addendum A) — framework-free so they
// stay unit testable. HTTP lives in lib/carenote/client.ts.
import type { CareApiError, CareRecord, ParamSchema, ParamValue, ProcedureType } from '@/lib/carenote/types';
import { addDaysStr, addMonthsStr, startOfMonthStr } from '@/lib/logic/dates';

/** Project id of the CareNote entry in this dashboard's own project list
 * (PLAN_CARENOTE.md Addendum A2) — used to gate the history panel on the project
 * detail page. */
export const CARENOTE_PROJECT_ID = 'p-carenote';

/** Drops undefined/''/NaN/empty arrays/empty region maps and any key not in the
 * schema (PLAN_CARENOTE.md §2 cleanParams — CareNote rejects unknown params keys). */
export function cleanParams(schema: ParamSchema, values: Record<string, ParamValue>): Record<string, ParamValue> {
  const schemaKeys = new Set(schema.fields.map((f) => f.key));
  const out: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!schemaKeys.has(key)) continue;
    if (value === undefined) continue;
    if (typeof value === 'number' && Number.isNaN(value)) continue;
    if (typeof value === 'string' && value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const cleaned = Object.fromEntries(
        Object.entries(value).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n !== 0)
      );
      if (Object.keys(cleaned).length === 0) continue;
      out[key] = cleaned;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Prefills seriesIndex/seriesTotal for a new record of `type`, for `personId` on
 * `date`, looking only at already-loaded `records` (PLAN_CARENOTE.md §1). */
export function suggestSeries(
  type: ProcedureType,
  records: CareRecord[],
  personId: number,
  date: string
): { seriesIndex: number; seriesTotal: number } | null {
  const seriesTotal = type.seriesDefaultCount;
  if (!seriesTotal) return null;

  const prior = records
    .filter((r) => r.personId === personId && r.procedureTypeId === type.id && r.date <= date)
    .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
  const last = prior[prior.length - 1];

  if (!last || last.seriesIndex == null || last.seriesTotal == null) {
    return { seriesIndex: 1, seriesTotal };
  }
  if (last.seriesIndex >= last.seriesTotal) {
    return { seriesIndex: 1, seriesTotal };
  }
  return { seriesIndex: last.seriesIndex + 1, seriesTotal: last.seriesTotal };
}

function formatParamValue(field: ParamSchema['fields'][number], value: ParamValue): string | null {
  switch (field.type) {
    case 'checkbox':
      return value === true ? field.label : null;
    case 'multiselect':
      return Array.isArray(value) && value.length > 0 ? value.join('·') : null;
    case 'region_units': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
      const entries = Object.entries(value as Record<string, number>).filter(([, n]) => n !== 0);
      if (entries.length === 0) return null;
      return entries.map(([region, n]) => `${region} ${n}`).join(' ');
    }
    case 'number':
      return typeof value === 'number' ? `${field.label} ${value}${field.unit ?? ''}` : null;
    default:
      return typeof value === 'string' && value !== '' ? `${field.label} ${value}` : null;
  }
}

/** One-line Korean summary for a record list row (PLAN_CARENOTE.md §2 recordSummary). */
export function recordSummary(type: ProcedureType, record: CareRecord): string {
  const parts: string[] = [type.name];

  const paramParts: string[] = [];
  for (const field of type.paramSchema.fields) {
    if (paramParts.length >= 3) break;
    const value = record.params[field.key];
    if (value === undefined) continue;
    const formatted = formatParamValue(field, value);
    if (formatted) paramParts.push(formatted);
  }
  parts.push(...paramParts);

  if (record.seriesIndex != null && record.seriesTotal != null) {
    parts.push(`${record.seriesIndex}/${record.seriesTotal}회`);
  }

  return parts.join(' · ');
}

/** Groups records by their date string. */
export function recordsByDate(records: CareRecord[]): Map<string, CareRecord[]> {
  const map = new Map<string, CareRecord[]>();
  for (const r of records) {
    const list = map.get(r.date);
    if (list) list.push(r);
    else map.set(r.date, [r]);
  }
  return map;
}

/** Per-(person, procedureType) rollup for the history panel (PLAN_CARENOTE.md
 * Addendum A2). `nextFrom`/`nextTo` are null when the type has no interval. */
export interface ProcedureStat {
  personId: number;
  procedureTypeId: number;
  typeName: string;
  lastDate: string;
  count: number;
  nextFrom: string | null;
  nextTo: string | null;
  status: 'overdue' | 'available' | 'upcoming' | null;
}

/** Distinct non-empty string values saved under `params[key]` for one procedure type,
 * most recently used first. Offered as tap-to-pick chips so a free-text 부위 is reused
 * verbatim (CareNote groups due-dates by the exact string). */
export function usedParamValues(records: CareRecord[], procedureTypeId: number, key: string): string[] {
  const lastUsed = new Map<string, string>();
  for (const r of records) {
    if (r.procedureTypeId !== procedureTypeId) continue;
    const v = r.params?.[key];
    if (typeof v !== 'string') continue;
    const value = v.trim();
    if (!value) continue;
    const prev = lastUsed.get(value);
    if (!prev || r.date > prev) lastUsed.set(value, r.date);
  }
  return [...lastUsed.entries()]
    .sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? 1 : -1))
    .map(([value]) => value);
}

/** Days past `nextTo` that a type keeps showing "지남" before it's treated as paused. */
export const OVERDUE_GRACE_DAYS = 30;

/** Groups `records` by (personId, procedureTypeId), sorted overdue-first then by
 * next-window start (PLAN_CARENOTE.md Addendum A2). Records for a type not present
 * in `types` are skipped (can't be summarized without its schema/interval). */
export function procedureStats(records: CareRecord[], types: ProcedureType[], today: string): ProcedureStat[] {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const groups = new Map<string, CareRecord[]>();
  for (const r of records) {
    const key = `${r.personId}:${r.procedureTypeId}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const stats: ProcedureStat[] = [];
  for (const [key, list] of groups) {
    const [personIdStr, typeIdStr] = key.split(':');
    const type = typeById.get(Number(typeIdStr));
    if (!type) continue;
    const lastDate = list.reduce((max, r) => (r.date > max ? r.date : max), list[0].date);

    let nextFrom: string | null = null;
    let nextTo: string | null = null;
    let status: ProcedureStat['status'] = null;
    if (type.intervalMinDays != null && type.intervalMaxDays != null) {
      nextFrom = addDaysStr(lastDate, type.intervalMinDays);
      nextTo = addDaysStr(lastDate, type.intervalMaxDays);
      // Overdue only for OVERDUE_GRACE_DAYS past the window; after that the type is
      // treated as paused and shows no status (otherwise "지남" never goes away).
      if (today > addDaysStr(nextTo, OVERDUE_GRACE_DAYS)) status = null;
      else if (today > nextTo) status = 'overdue';
      else if (today >= nextFrom) status = 'available';
      else status = 'upcoming';
    }

    stats.push({
      personId: Number(personIdStr),
      procedureTypeId: type.id,
      typeName: type.name,
      lastDate,
      count: list.length,
      nextFrom,
      nextTo,
      status,
    });
  }

  stats.sort((a, b) => {
    const aOverdue = a.status === 'overdue';
    const bOverdue = b.status === 'overdue';
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (a.nextFrom && b.nextFrom) return a.nextFrom < b.nextFrom ? -1 : a.nextFrom > b.nextFrom ? 1 : 0;
    if (a.nextFrom) return -1;
    if (b.nextFrom) return 1;
    return a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0;
  });

  return stats;
}

/** Caps an already-filtered day's records to `max` chips for the month calendar grid
 * (PLAN_CARENOTE.md Addendum B1/B2). Filtering itself (person/type) happens before
 * this is called; this only decides what's shown vs the "+N" overflow count. */
export function dayRecordChips(records: CareRecord[], max = 3): { shown: CareRecord[]; overflowCount: number } {
  const shown = records.slice(0, max);
  return { shown, overflowCount: Math.max(0, records.length - shown.length) };
}

/** True when `monthStart`'s whole calendar month already sits inside
 * [rangeFrom, rangeTo] (both inclusive) — used by the month calendar to decide
 * whether it can reuse already-loaded history records or must fetch the month via
 * loadCareMonthAction (PLAN_CARENOTE.md Addendum B1/B2). */
export function isMonthWithinRange(monthStart: string, rangeFrom: string, rangeTo: string): boolean {
  const first = startOfMonthStr(monthStart);
  const last = addDaysStr(addMonthsStr(first, 1), -1);
  return first >= rangeFrom && last <= rangeTo;
}

/** Korean user-facing message per CareApiError.code (PLAN_CARENOTE.md §2). Branches
 * on `code`, never `message`, except for not_found which passes the server message
 * through (it's already specific, e.g. "unknown personId"). */
export function careErrorMessage(err: CareApiError): string {
  switch (err.code) {
    case 'unauthorized':
      return '케어노트 토큰이 유효하지 않아요 (링크 재발급 여부 확인)';
    case 'rate_limited':
      return '요청이 많아요. 잠시 후 다시 시도하세요';
    case 'unreachable':
    case 'internal':
      return '케어노트에 연결할 수 없어요';
    case 'not_found':
      return err.message;
    case 'validation':
      return '입력값을 확인하세요';
    default:
      return err.message;
  }
}
