// Pure CareNote helpers (PLAN_CARENOTE.md §2) — framework-free so they stay unit
// testable. HTTP lives in lib/carenote/client.ts.
import type { CareApiError, CareRecord, ParamSchema, ParamValue, ProcedureType } from '@/lib/carenote/types';

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
