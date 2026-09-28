'use client';

// Add/edit one CareNote record (PLAN_CARENOTE.md §2). Talks only through the
// carenote server actions — no dashboard-side persistence.
import { useMemo, useState, useTransition } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CareParamForm } from '@/components/carenote/care-param-form';
import { createCareRecordAction, deleteCareRecordAction, updateCareRecordAction } from '@/app/actions/carenote';
import { cleanParams, suggestSeries } from '@/lib/logic/carenote';
import { todayKST } from '@/lib/logic/dates';
import { Button } from '@/components/ui/button';
import type { CareRecord, ParamValue, Person, ProcedureType } from '@/lib/carenote/types';

const CATEGORY_LABEL: Record<ProcedureType['category'], string> = {
  laser: '레이저',
  lifting: '리프팅',
  booster: '부스터',
  botox: '보톡스',
  filler: '필러',
  etc: '기타',
};
const CATEGORY_ORDER: ProcedureType['category'][] = ['laser', 'lifting', 'booster', 'botox', 'filler', 'etc'];

interface Props {
  date: string;
  record?: CareRecord | null;
  persons: Person[];
  procedureTypes: ProcedureType[];
  records: CareRecord[];
  onSaved: (record: CareRecord) => void;
  onDeleted: (id: number) => void;
  onCancel: () => void;
}

export function CareRecordEditor({ date, record, persons, procedureTypes, records, onSaved, onDeleted, onCancel }: Props) {
  const isEdit = !!record;
  const activePersons = useMemo(() => persons.filter((p) => p.active), [persons]);

  const [personId, setPersonId] = useState<number>(record?.personId ?? activePersons[0]?.id ?? persons[0]?.id ?? 0);
  const [procedureTypeId, setProcedureTypeId] = useState<number>(record?.procedureTypeId ?? 0);
  const [recordDate, setRecordDate] = useState(record?.date ?? date ?? todayKST());
  const [params, setParams] = useState<Record<string, ParamValue>>(record?.params ?? {});
  const [seriesIndex, setSeriesIndex] = useState<string>(record?.seriesIndex != null ? String(record.seriesIndex) : '');
  const [seriesTotal, setSeriesTotal] = useState<string>(record?.seriesTotal != null ? String(record.seriesTotal) : '');
  const [cost, setCost] = useState<string>(record?.cost != null ? String(record.cost) : '');
  const [note, setNote] = useState(record?.note ?? '');
  const [extraOpen, setExtraOpen] = useState(isEdit && (record?.seriesIndex != null || record?.cost != null || !!record?.note));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const type = procedureTypes.find((t) => t.id === procedureTypeId) ?? null;

  const groupedTypes = useMemo(() => {
    const active = procedureTypes.filter((t) => t.active || t.id === record?.procedureTypeId);
    const groups = new Map<ProcedureType['category'], ProcedureType[]>();
    for (const t of active) {
      const list = groups.get(t.category);
      if (list) list.push(t);
      else groups.set(t.category, [t]);
    }
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({ category: c, types: groups.get(c)! }));
  }, [procedureTypes, record?.procedureTypeId]);

  function handleProcedureChange(id: number) {
    setProcedureTypeId(id);
    setParams({});
    const nextType = procedureTypes.find((t) => t.id === id);
    if (nextType && personId) {
      const suggestion = suggestSeries(nextType, records, personId, recordDate);
      setSeriesIndex(suggestion ? String(suggestion.seriesIndex) : '');
      setSeriesTotal(suggestion ? String(suggestion.seriesTotal) : '');
    } else {
      setSeriesIndex('');
      setSeriesTotal('');
    }
  }

  function buildInput() {
    if (!type) return null;
    return {
      personId,
      procedureTypeId,
      date: recordDate,
      params: cleanParams(type.paramSchema, params),
      seriesIndex: seriesIndex === '' ? null : Number(seriesIndex),
      seriesTotal: seriesTotal === '' ? null : Number(seriesTotal),
      cost: cost === '' ? null : Number(cost),
      note: note.trim() === '' ? null : note.trim(),
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = buildInput();
    if (!input) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = isEdit
        ? await updateCareRecordAction(record!.id, input)
        : await createCareRecordAction(input);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onSaved(result.data);
    });
  }

  function handleDelete() {
    if (!record) return;
    if (!window.confirm('이 기록을 삭제할까요?')) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCareRecordAction(record.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted(record.id);
    });
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-2">
      {error && <p className="rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">{error}</p>}

      {activePersons.length > 1 && (
        <select
          value={personId}
          onChange={(e) => setPersonId(Number(e.target.value))}
          className="w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
        >
          {activePersons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}

      <select
        value={procedureTypeId || ''}
        onChange={(e) => handleProcedureChange(Number(e.target.value))}
        className="w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
      >
        <option value="" disabled>
          시술 선택
        </option>
        {groupedTypes.map(({ category, types }) => (
          <optgroup key={category} label={CATEGORY_LABEL[category]}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.active ? ' (비활성)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <input
        type="date"
        value={recordDate}
        onChange={(e) => setRecordDate(e.target.value)}
        className="w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
      />

      {type && (
        <CareParamForm schema={type.paramSchema} values={params} onChange={setParams} fieldErrors={fieldErrors} />
      )}

      <button
        type="button"
        onClick={() => setExtraOpen((v) => !v)}
        className="flex items-center gap-1 self-start text-xs text-foreground/60 hover:text-foreground"
      >
        {extraOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        추가 정보
      </button>

      {extraOpen && (
        <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-2">
          <div className="flex min-w-0 items-center gap-2">
            <label className="w-16 shrink-0 text-xs text-foreground/60">회차</label>
            <input
              type="number"
              min={1}
              max={99}
              value={seriesIndex}
              onChange={(e) => setSeriesIndex(e.target.value)}
              placeholder="회"
              className="w-16 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            />
            <span className="text-xs text-foreground/40">/</span>
            <input
              type="number"
              min={1}
              max={99}
              value={seriesTotal}
              onChange={(e) => setSeriesTotal(e.target.value)}
              placeholder="총"
              className="w-16 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            />
            {fieldErrors.seriesIndex && <p className="text-xs text-danger">{fieldErrors.seriesIndex}</p>}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <label className="w-16 shrink-0 text-xs text-foreground/60">비용</label>
            <input
              type="number"
              min={0}
              max={100_000_000}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="원"
              className="w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
            />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="메모"
            className="w-full min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-sm"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || !type}>
          저장
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          취소
        </Button>
        {isEdit && (
          <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={pending} className="ml-auto">
            삭제
          </Button>
        )}
      </div>
    </form>
  );
}
