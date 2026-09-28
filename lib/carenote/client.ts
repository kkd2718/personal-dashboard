// Server-only CareNote workspace API client (PLAN_CARENOTE.md §0/§2). The workspace
// token never reaches the browser, is never logged, and never appears in an error
// message. Nothing fetched here is persisted dashboard-side — callers hold it in
// request/client state only.
import 'server-only';

import type {
  CareApiError,
  CareRecord,
  CareRecordInput,
  CareRecordPatch,
  Person,
  ProcedureType,
} from '@/lib/carenote/types';

const DEFAULT_BASE = 'https://care-note-app.vercel.app/api/ws/v1';
const TIMEOUT_MS = 10_000;
const META_TTL_MS = 5 * 60 * 1000;

export class CareNoteError extends Error {
  code: string;
  status: number;
  fieldErrors?: Record<string, string>;

  constructor(err: CareApiError) {
    super(err.message);
    this.name = 'CareNoteError';
    this.code = err.code;
    this.status = err.status;
    this.fieldErrors = err.fieldErrors;
  }
}

/** True when CARENOTE_WS_TOKEN is set — the sole feature flag (PLAN_CARENOTE.md §0). */
export function careNoteConfigured(): boolean {
  return Boolean(process.env.CARENOTE_WS_TOKEN);
}

function baseUrl(): string {
  return process.env.CARENOTE_API_BASE || DEFAULT_BASE;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = process.env.CARENOTE_WS_TOKEN;
  if (!token) {
    throw new CareNoteError({ code: 'unreachable', message: '케어노트에 연결할 수 없어요', status: 0 });
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Network failure or timeout — never surface the underlying error (may embed
    // the request URL/token).
    throw new CareNoteError({ code: 'unreachable', message: '케어노트에 연결할 수 없어요', status: 0 });
  }

  if (res.status === 204) return undefined as T;

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // fall through — non-JSON body handled below
  }

  if (!res.ok) {
    const errBody = (json as { error?: { code?: string; message?: string; fieldErrors?: Record<string, string> } } | null)
      ?.error;
    throw new CareNoteError({
      code: errBody?.code ?? 'internal',
      message: errBody?.message ?? `요청 실패 (${res.status})`,
      fieldErrors: errBody?.fieldErrors,
      status: res.status,
    });
  }

  return json as T;
}

let metaCache: { persons: Person[]; procedureTypes: ProcedureType[] } | null = null;
let metaCacheAt = 0;

/** GET /meta, cached in module scope for 5 minutes (throttle is 20 req/min per IP). */
export async function getCareMeta(): Promise<{ persons: Person[]; procedureTypes: ProcedureType[] }> {
  const now = Date.now();
  if (metaCache && now - metaCacheAt < META_TTL_MS) return metaCache;
  const data = await request<{ persons: Person[]; procedureTypes: ProcedureType[] }>('GET', '/meta');
  metaCache = data;
  metaCacheAt = now;
  return data;
}

export async function listCareRecords(from: string, to: string, personId?: number): Promise<CareRecord[]> {
  const params = new URLSearchParams({ from, to });
  if (personId !== undefined) params.set('personId', String(personId));
  const data = await request<{ records: CareRecord[] }>('GET', `/records?${params.toString()}`);
  return data.records;
}

export async function createCareRecord(input: CareRecordInput): Promise<CareRecord> {
  const data = await request<{ record: CareRecord }>('POST', '/records', input);
  return data.record;
}

export async function updateCareRecord(id: number, patch: CareRecordPatch): Promise<CareRecord> {
  const data = await request<{ record: CareRecord }>('PATCH', `/records/${id}`, patch);
  return data.record;
}

export async function deleteCareRecord(id: number): Promise<void> {
  await request<void>('DELETE', `/records/${id}`);
}
