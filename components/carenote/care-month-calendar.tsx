'use client';

// CareNote-style month calendar for the project history panel (PLAN_CARENOTE.md
// Addendum B). Mirrors CareNote's own MonthGrid/DayCell/DayPanel (read only,
// aesthetics-tracker/components/calendar/*) using this repo's own date helpers,
// tokens and CareDaySection — nothing persisted dashboard-side, nothing imported
// across repos.
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CareDaySection } from '@/components/carenote/care-day-section';
import { loadCareMonthAction } from '@/app/actions/carenote';
import { dayRecordChips, isMonthWithinRange, recordsByDate } from '@/lib/logic/carenote';
import { addDaysStr, addMonthsStr, endOfSundayWeek, startOfSundayWeek, startOfMonthStr, todayKST } from '@/lib/logic/dates';
import { Button } from '@/components/ui/button';
import type { CareRecord, Person, ProcedureType } from '@/lib/carenote/types';

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

interface Props {
  /** Already filtered by the panel's person/type chips — drives the grid chips. */
  displayRecords: CareRecord[];
  /** Full unfiltered set of every record loaded so far — drives the day panel's
   * list (so a filtered-out record on a clicked day isn't hidden from editing)
   * and suggestSeries (which needs a person+type's whole history, not one day). */
  allRecords: CareRecord[];
  persons: Person[];
  procedureTypes: ProcedureType[];
  /** The panel's already-loaded history range — months fully inside it reuse
   * `allRecords`; months outside it are fetched via loadCareMonthAction. */
  historyFrom: string;
  historyTo: string;
  onRecordsChange: Dispatch<SetStateAction<CareRecord[]>>;
}

export function CareMonthCalendar({
  displayRecords,
  allRecords,
  persons,
  procedureTypes,
  historyFrom,
  historyTo,
  onRecordsChange,
}: Props) {
  const today = todayKST();
  const [cursor, setCursor] = useState(startOfMonthStr(today));
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const monthLastDay = addDaysStr(addMonthsStr(cursor, 1), -1);
  const gridStart = startOfSundayWeek(cursor);
  const gridEnd = endOfSundayWeek(monthLastDay);
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDaysStr(d, 1)) out.push(d);
    return out;
  }, [gridStart, gridEnd]);

  useEffect(() => {
    if (isMonthWithinRange(cursor, historyFrom, historyTo)) {
      setError(null);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    loadCareMonthAction(gridStart, gridEnd).then((result) => {
      if (requestRef.current !== requestId) return; // stale response for an old month
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const fetched = result.data.records;
      onRecordsChange((prev) => [...prev.filter((r) => r.date < gridStart || r.date > gridEnd), ...fetched]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the visible grid range changes
  }, [gridStart, gridEnd, historyFrom, historyTo]);

  const displayByDate = useMemo(() => recordsByDate(displayRecords), [displayRecords]);
  const allByDate = useMemo(() => recordsByDate(allRecords), [allRecords]);
  const personById = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons]);
  const typeById = useMemo(() => new Map(procedureTypes.map((t) => [t.id, t])), [procedureTypes]);

  function handleDayChanged(date: string, updated: CareRecord[]) {
    onRecordsChange((prev) => [...prev.filter((r) => r.date !== date), ...updated]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setCursor((c) => addMonthsStr(c, -1))}
          aria-label="이전 달"
          className="rounded-md p-1 text-foreground/60 hover:bg-foreground/5"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="tnum min-w-20 text-center text-sm font-medium">
          {cursor.slice(0, 4)}년 {Number(cursor.slice(5, 7))}월
        </span>
        <button
          type="button"
          onClick={() => setCursor((c) => addMonthsStr(c, 1))}
          aria-label="다음 달"
          className="rounded-md p-1 text-foreground/60 hover:bg-foreground/5"
        >
          <ChevronRight size={16} />
        </button>
        <Button size="sm" variant="ghost" onClick={() => setCursor(startOfMonthStr(today))} className="ml-1">
          오늘
        </Button>
        {loading && <span className="ml-2 text-xs text-foreground/40">불러오는 중…</span>}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="grid grid-cols-7 text-center text-[11px] text-foreground/40">
        {WEEKDAY_KO.map((w, i) => (
          <div key={w} className={i === 0 ? 'text-danger/70' : undefined}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-7 gap-px">
        {days.map((date) => {
          const inMonth = date.slice(0, 7) === cursor.slice(0, 7);
          const isToday = date === today;
          const dayRecords = displayByDate.get(date) ?? [];
          const { shown, overflowCount } = dayRecordChips(dayRecords);
          return (
            <button
              type="button"
              key={date}
              onClick={() => setSelected(date)}
              className={`flex min-h-16 min-w-0 flex-col items-start gap-0.5 rounded-md p-1 text-left text-[11px] sm:min-h-24 ${
                inMonth ? '' : 'text-foreground/25'
              } ${isToday ? 'bg-accent-soft' : 'hover:bg-foreground/5'} ${selected === date ? 'ring-1 ring-accent' : ''}`}
            >
              <span className={isToday ? 'font-semibold text-accent' : ''}>{Number(date.slice(8, 10))}</span>

              {/* Mobile (<640px): person-colour dots only, max 4, no horizontal scroll. */}
              <span className="flex flex-wrap items-center gap-0.5 sm:hidden" aria-hidden={dayRecords.length === 0}>
                {dayRecords.slice(0, 4).map((r) => (
                  <span
                    key={r.id}
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: personById.get(r.personId)?.color ?? '#999' }}
                    aria-hidden
                  />
                ))}
                {dayRecords.length > 4 && <span className="text-[9px] text-foreground/40">+{dayRecords.length - 4}</span>}
              </span>

              {/* Desktop/tablet: up to 3 chips, person colour as a left border. */}
              <span className="hidden w-full min-w-0 flex-col gap-0.5 sm:flex">
                {shown.map((r) => {
                  const person = personById.get(r.personId);
                  const typeName = typeById.get(r.procedureTypeId)?.name ?? '시술';
                  return (
                    <span
                      key={r.id}
                      className="w-full min-w-0 truncate rounded border-l-2 bg-foreground/5 px-1 text-[10px] text-foreground/70"
                      style={{ borderColor: person?.color ?? '#999' }}
                    >
                      {typeName}
                    </span>
                  );
                })}
                {overflowCount > 0 && <span className="text-[10px] text-foreground/40">+{overflowCount}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="rounded-xl border border-border bg-surface p-2">
          <p className="mb-1.5 text-xs font-medium text-foreground/60">{selected}</p>
          <CareDaySection
            date={selected}
            records={allByDate.get(selected) ?? []}
            historyRecords={allRecords}
            persons={persons}
            procedureTypes={procedureTypes}
            loading={false}
            error={null}
            onChanged={(updated) => handleDayChanged(selected, updated)}
          />
        </div>
      )}
    </div>
  );
}
