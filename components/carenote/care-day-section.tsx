'use client';

// CareNote section of the calendar's DayPopover (PLAN_CARENOTE.md §2). Everything
// here lives in the parent's in-memory month state — nothing is persisted
// dashboard-side.
import { useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { CareRecordEditor } from '@/components/carenote/care-record-editor';
import { recordSummary } from '@/lib/logic/carenote';
import type { CareRecord, Person, ProcedureType } from '@/lib/carenote/types';

const CARENOTE_CALENDAR_URL = 'https://care-note-app.vercel.app/calendar';

interface Props {
  date: string;
  records: CareRecord[];
  persons: Person[];
  procedureTypes: ProcedureType[];
  loading: boolean;
  error: string | null;
  onChanged: (updatedRecords: CareRecord[]) => void;
}

type EditState = 'closed' | 'new' | number;

export function CareDaySection({ date, records, persons, procedureTypes, loading, error, onChanged }: Props) {
  const [editing, setEditing] = useState<EditState>('closed');

  const personById = new Map(persons.map((p) => [p.id, p]));
  const typeById = new Map(procedureTypes.map((t) => [t.id, t]));
  const showPersonDot = new Set(records.map((r) => r.personId)).size > 1;

  function upsert(record: CareRecord) {
    const exists = records.some((r) => r.id === record.id);
    onChanged(exists ? records.map((r) => (r.id === record.id ? record : r)) : [...records, record]);
    setEditing('closed');
  }

  function remove(id: number) {
    onChanged(records.filter((r) => r.id !== id));
    setEditing('closed');
  }

  const editingRecord = typeof editing === 'number' ? (records.find((r) => r.id === editing) ?? null) : null;

  return (
    <div className="mb-2 flex min-w-0 flex-col gap-1.5 border-b border-border pb-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-medium text-foreground/50">
          시술
          <a
            href={CARENOTE_CALENDAR_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="케어노트에서 열기"
            className="text-foreground/30 hover:text-foreground/60"
          >
            <ExternalLink size={11} />
          </a>
        </p>
        {editing === 'closed' && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex items-center gap-0.5 text-[11px] text-accent hover:underline"
          >
            <Plus size={11} />
            시술 기록
          </button>
        )}
      </div>

      {loading && <p className="text-xs text-foreground/40">불러오는 중…</p>}
      {!loading && error && <p className="text-xs text-danger">{error}</p>}

      {!loading && !error && editing === 'closed' && (
        <>
          {records.length === 0 && <p className="text-xs text-foreground/40">기록 없음</p>}
          <ul className="flex flex-col gap-1">
            {records.map((r) => {
              const type = typeById.get(r.procedureTypeId);
              const person = personById.get(r.personId);
              if (!type) return null;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(r.id)}
                    className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs hover:bg-foreground/5"
                  >
                    {showPersonDot && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: person?.color ?? '#999' }}
                      />
                    )}
                    <span className="min-w-0 truncate">{recordSummary(type, r)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {editing === 'new' && (
        <CareRecordEditor
          date={date}
          persons={persons}
          procedureTypes={procedureTypes}
          records={records}
          onSaved={upsert}
          onDeleted={remove}
          onCancel={() => setEditing('closed')}
        />
      )}
      {editingRecord && (
        <CareRecordEditor
          date={date}
          record={editingRecord}
          persons={persons}
          procedureTypes={procedureTypes}
          records={records}
          onSaved={upsert}
          onDeleted={remove}
          onCancel={() => setEditing('closed')}
        />
      )}
    </div>
  );
}
