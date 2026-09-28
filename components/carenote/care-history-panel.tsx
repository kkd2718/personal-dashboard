'use client';

// CareNote history panel on the project detail page (PLAN_CARENOTE.md Addendum A2).
// Fetches its own wider range via loadCareHistoryAction — independent of the
// calendar's month state, nothing persisted dashboard-side.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { CareRecordEditor } from '@/components/carenote/care-record-editor';
import { loadCareHistoryAction } from '@/app/actions/carenote';
import { procedureStats, recordSummary } from '@/lib/logic/carenote';
import { todayKST } from '@/lib/logic/dates';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import type { CareRecord, Person, ProcedureType } from '@/lib/carenote/types';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function shortDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d} (${WEEKDAY_KO[wd]})`;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return `${y}년 ${m}월`;
}

const STATS_PAGE_SIZE = 8;

type EditState = 'closed' | 'new' | number;

export function CareHistoryPanel() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [types, setTypes] = useState<ProcedureType[]>([]);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditState>('closed');
  const [statsExpanded, setStatsExpanded] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    loadCareHistoryAction().then((result) => {
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPersons(result.data.persons);
      setTypes(result.data.procedureTypes);
      setRecords(result.data.records);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const activePersons = useMemo(() => persons.filter((p) => p.active), [persons]);
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const usedTypes = useMemo(() => {
    const seen = new Set(records.map((r) => r.procedureTypeId));
    return types.filter((t) => seen.has(t.id));
  }, [records, types]);

  const filtered = useMemo(
    () =>
      records.filter(
        (r) => (personFilter == null || r.personId === personFilter) && (typeFilter == null || r.procedureTypeId === typeFilter)
      ),
    [records, personFilter, typeFilter]
  );

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1)),
    [filtered]
  );

  const groups = useMemo(() => {
    const map = new Map<string, CareRecord[]>();
    for (const r of sorted) {
      const key = r.date.slice(0, 7);
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()];
  }, [sorted]);

  const stats = useMemo(() => procedureStats(filtered, types, todayKST()), [filtered, types]);
  const visibleStats = statsExpanded ? stats : stats.slice(0, STATS_PAGE_SIZE);

  function upsert(record: CareRecord) {
    setRecords((prev) =>
      prev.some((r) => r.id === record.id) ? prev.map((r) => (r.id === record.id ? record : r)) : [...prev, record]
    );
    setEditing('closed');
  }

  function remove(id: number) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setEditing('closed');
  }

  if (loading) {
    return (
      <section className="flex flex-col gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-foreground/10" />
        <div className="h-6 w-full animate-pulse rounded bg-foreground/5" />
        <div className="h-6 w-full animate-pulse rounded bg-foreground/5" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
        <span className="min-w-0 truncate text-danger">{error}</span>
        <Button size="sm" variant="secondary" onClick={load}>
          다시 시도
        </Button>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground/60">
          시술 기록 <span className="text-foreground/40">{records.length}</span>
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
          <Plus size={14} />
          시술 기록
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {activePersons.length > 1 && (
          <>
            <button type="button" onClick={() => setPersonFilter(null)}>
              <Chip tone={personFilter == null ? 'accent' : 'neutral'} className="cursor-pointer">
                전체
              </Chip>
            </button>
            {activePersons.map((p) => (
              <button key={p.id} type="button" onClick={() => setPersonFilter(p.id)}>
                <Chip tone={personFilter === p.id ? 'accent' : 'neutral'} className="cursor-pointer">
                  {p.name}
                </Chip>
              </button>
            ))}
          </>
        )}
        <select
          value={typeFilter ?? ''}
          onChange={(e) => setTypeFilter(e.target.value === '' ? null : Number(e.target.value))}
          className="min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
        >
          <option value="">전체 시술</option>
          {usedTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {editing === 'new' && (
        <div className="rounded-md border border-border p-2">
          <CareRecordEditor
            date={todayKST()}
            persons={persons}
            procedureTypes={types}
            records={records}
            onSaved={upsert}
            onDeleted={remove}
            onCancel={() => setEditing('closed')}
          />
        </div>
      )}

      {stats.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-2">
          <ul className="flex flex-col gap-1">
            {visibleStats.map((s) => (
              <li key={`${s.personId}-${s.procedureTypeId}`} className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {activePersons.length > 1 ? `${personById.get(s.personId)?.name ?? ''} · ${s.typeName}` : s.typeName}
                </span>
                <span className="tnum shrink-0 text-foreground/40">{shortDateLabel(s.lastDate)}</span>
                <span className="tnum shrink-0 text-foreground/40">{s.count}회</span>
                {s.status === 'overdue' && <span className="shrink-0 text-danger">지남</span>}
                {s.status === 'available' && <span className="shrink-0 text-success">가능</span>}
                {s.status === 'upcoming' && s.nextFrom && s.nextTo && (
                  <span className="tnum shrink-0 text-foreground/40">
                    다음 {shortDateLabel(s.nextFrom).split(' ')[0]}~{shortDateLabel(s.nextTo).split(' ')[0]}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {stats.length > STATS_PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setStatsExpanded((v) => !v)}
              className="self-start text-xs text-accent hover:underline"
            >
              {statsExpanded ? '접기' : '더보기'}
            </button>
          )}
        </div>
      )}

      {groups.length === 0 && editing !== 'new' && <p className="text-xs text-foreground/40">기록 없음</p>}

      <ul className="flex flex-col gap-3">
        {groups.map(([month, list]) => (
          <li key={month} className="flex flex-col gap-1">
            <p className="text-[11px] font-medium text-foreground/40">{monthLabel(month)}</p>
            <ul className="flex flex-col gap-1">
              {list.map((r) => {
                const type = typeById.get(r.procedureTypeId);
                const person = personById.get(r.personId);
                if (!type) return null;
                if (editing === r.id) {
                  return (
                    <li key={r.id} className="rounded-md border border-border p-2">
                      <CareRecordEditor
                        date={r.date}
                        record={r}
                        persons={persons}
                        procedureTypes={types}
                        records={records}
                        onSaved={upsert}
                        onDeleted={remove}
                        onCancel={() => setEditing('closed')}
                      />
                    </li>
                  );
                }
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(r.id)}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-foreground/5"
                    >
                      <span className="tnum w-16 shrink-0 text-xs text-foreground/40">{shortDateLabel(r.date)}</span>
                      {activePersons.length > 1 && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: person?.color ?? '#999' }}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{recordSummary(type, r)}</span>
                      {r.cost != null && (
                        <span className="shrink-0 text-xs text-foreground/40">{r.cost.toLocaleString()}원</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
