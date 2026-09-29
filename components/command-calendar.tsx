'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Link2,
  CalendarClock,
  ClipboardCheck,
  FileText,
  StickyNote,
  CalendarDays,
  Plus,
} from 'lucide-react';
import { calendarEvents, calendarVisibilityOptions, filterVisibleEvents, type CalendarPoint } from '@/lib/logic/calendar';
import { tagCounts } from '@/lib/logic/notes';
import { addDaysStr, addMonthsStr, dday, startOfMonthStr, todayKST, urgency } from '@/lib/logic/dates';
import { projectColorClasses } from '@/lib/project-colors';
import { createNoteAction } from '@/app/actions/notes';
import { createTaskAction } from '@/app/actions/tasks';
import { createDeadlineAction } from '@/app/actions/deadlines';
import { setVisibleCalendarsAction } from '@/app/actions/calendar';
import { loadCareMonthAction } from '@/app/actions/carenote';
import { recordsByDate } from '@/lib/logic/carenote';
import { NoteItem } from '@/components/note-item';
import { MentionTextarea } from '@/components/mention-textarea';
import { CareDaySection } from '@/components/carenote/care-day-section';
import { parseCapture } from '@/lib/logic/capture';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { DdayChip } from '@/components/dday-chip';
import type { CalendarEvent, Deadline, DeadlineKind, Milestone, Note, Project, ReviewJob, Task } from '@/lib/types';
import type { CareRecord, Person, ProcedureType } from '@/lib/carenote/types';

const POINT_ICON: Record<CalendarPoint['kind'], typeof ClipboardCheck> = {
  task: ClipboardCheck,
  deadline: CalendarClock,
  review: FileText,
  milestone: Link2,
  memo: StickyNote,
  google: CalendarDays,
};

const DEADLINE_KIND_OPTIONS: DeadlineKind[] = [
  'paper', 'review', 'grant', 'thesis', 'interview', 'date', 'personal', 'other',
];

type PopoverTab = 'memo' | 'task' | 'deadline';

const POPOVER_WIDTH = 340;
const POPOVER_MARGIN = 8;

/** True on viewports narrower than Tailwind's `md` breakpoint (768px). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser-only media check
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

/**
 * Floating popover anchored to a calendar cell rect (fixed positioning, flips
 * above/left when it would overflow the viewport). On mobile it renders as a
 * full-width bottom sheet instead. Portaled to `document.body` so the calendar
 * grid never reflows when it opens. Closes on Esc, outside click, and route
 * change; moves focus in on open and returns it to the triggering cell on close.
 */
function DayPopoverOverlay({
  anchorRect,
  triggerEl,
  onClose,
  children,
}: {
  anchorRect: DOMRect;
  triggerEl: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const pathname = usePathname();

  const reposition = useCallback(() => {
    if (!panelRef.current) return;
    const panel = panelRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelH = panel.offsetHeight;

    let left = anchorRect.left;
    if (left + POPOVER_WIDTH + POPOVER_MARGIN > vw) left = anchorRect.right - POPOVER_WIDTH;
    left = Math.max(POPOVER_MARGIN, Math.min(left, vw - POPOVER_WIDTH - POPOVER_MARGIN));

    let top = anchorRect.bottom + 4;
    const overflowsBelow = top + panelH + POPOVER_MARGIN > vh;
    if (overflowsBelow) {
      const above = anchorRect.top - 4 - panelH;
      top = above >= POPOVER_MARGIN ? above : Math.max(POPOVER_MARGIN, vh - panelH - POPOVER_MARGIN);
    }

    setPos({ top, left });
  }, [anchorRect]);

  useLayoutEffect(() => {
    if (!isMobile) reposition();
  }, [isMobile, reposition]);

  useEffect(() => {
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerEl?.contains(target)) return;
      onClose();
    }
    function onResize() {
      reposition();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      triggerEl?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose/reposition are stable enough per open popover instance
  }, [triggerEl]);

  // Close on route change. Compares against the pathname captured at first render
  // (not a mutated "have we mounted" ref) so this is safe under Strict Mode's dev
  // double-invocation of effects, which would otherwise self-close the popover
  // immediately after opening.
  const openedAtPathname = useRef(pathname);
  useEffect(() => {
    if (pathname !== openedAtPathname.current) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the route itself changes
  }, [pathname]);

  if (typeof document === 'undefined') return null;
  const style: React.CSSProperties =
    !isMobile && pos ? { position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH } : { visibility: 'hidden' };

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" aria-hidden onMouseDown={() => onClose()} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        style={isMobile ? undefined : style}
        className={
          isMobile
            ? 'fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface-raised p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-sm text-foreground shadow-lg outline-none'
            : 'z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface-raised p-3 text-sm text-foreground shadow-lg ring-1 ring-black/5 outline-none dark:ring-white/10'
        }
      >
        {children}
      </div>
    </>,
    document.body
  );
}

/** Day-cell popover content: add a memo/task/deadline, or edit an existing memo point. */
interface CareSectionProps {
  records: CareRecord[];
  persons: Person[];
  procedureTypes: ProcedureType[];
  loading: boolean;
  error: string | null;
  onChanged: (updatedRecords: CareRecord[]) => void;
}

function DayPopover({
  date,
  points,
  notes,
  projects,
  milestones,
  care,
  onClose,
}: {
  date: string;
  points: CalendarPoint[];
  notes: Note[];
  projects: Project[];
  milestones: Milestone[];
  care?: CareSectionProps;
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PopoverTab>('memo');
  const [memoBody, setMemoBody] = useState('');
  const [memoProjectId, setMemoProjectId] = useState('');
  const [memoProjectTouched, setMemoProjectTouched] = useState(false);
  const [memoTags, setMemoTags] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskProjectId, setTaskProjectId] = useState(projects[0]?.id ?? '');
  const [taskAssignee, setTaskAssignee] = useState<'me' | 'agent'>('me');
  const [deadlineTitle, setDeadlineTitle] = useState('');
  const [deadlineKind, setDeadlineKind] = useState<DeadlineKind>('other');
  const [deadlineTime, setDeadlineTime] = useState('');

  const tags = useMemo(() => tagCounts(notes), [notes]);
  const existingTagNames = useMemo(() => tags.map((t) => t.tag), [tags]);
  const memoParsed = useMemo(
    () => parseCapture(memoBody, projects, existingTagNames),
    [memoBody, projects, existingTagNames]
  );
  const effectiveMemoProjectId = memoProjectTouched ? memoProjectId : (memoParsed.projectId ?? memoProjectId);
  const effectiveMemoTags = useMemo(() => {
    const manual = memoTags.split(',').map((t) => t.trim()).filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...manual, ...memoParsed.tags]) {
      const k = t.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(t);
      }
    }
    return out;
  }, [memoTags, memoParsed.tags]);

  async function submitMemo(e: React.FormEvent) {
    e.preventDefault();
    if (!memoBody.trim()) return;
    await createNoteAction({
      body: memoBody.trim(),
      kind: 'memo',
      projectId: effectiveMemoProjectId || null,
      tags: effectiveMemoTags,
      date,
      source: 'web',
    });
    router.refresh();
    onClose();
  }

  async function submitTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    await createTaskAction({
      title: taskTitle.trim(),
      projectId: taskProjectId || null,
      dueDate: date,
      assignee: taskAssignee,
    });
    router.refresh();
    onClose();
  }

  async function submitDeadline(e: React.FormEvent) {
    e.preventDefault();
    if (!deadlineTitle.trim()) return;
    await createDeadlineAction({
      title: deadlineTitle.trim(),
      kind: deadlineKind,
      dueDate: date,
      dueTime: deadlineTime || null,
    });
    router.refresh();
    onClose();
  }

  const memoNotes = points.filter((p) => p.kind === 'memo').map((p) => notes.find((n) => n.id === p.id)).filter((n): n is Note => !!n);
  const googlePoints = points.filter((p) => p.kind === 'google');
  const otherPoints = points.filter((p) => p.kind !== 'memo' && p.kind !== 'google');

  return (
    <>
      <p className="mb-2 font-semibold">{date}</p>

      {googlePoints.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[11px] font-medium text-foreground/50">일정</p>
          <ul className="flex flex-col gap-1">
            {googlePoints.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5 text-foreground/70">
                <CalendarDays size={12} className="shrink-0" />
                {p.startTime && <span className="text-foreground/50">{p.startTime}</span>}
                {p.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(memoNotes.length > 0 || otherPoints.length > 0) && (
        <ul className="mb-2 flex flex-col gap-2">
          {memoNotes.map((n) => (
            <NoteItem key={n.id} note={n} projects={projects} milestones={milestones} />
          ))}
          {otherPoints.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5">
              <span className="rounded-full bg-foreground/10 px-1.5 py-0.5">{p.kind}</span>
              {p.title}
            </li>
          ))}
        </ul>
      )}

      {care && (
        <CareDaySection
          date={date}
          records={care.records}
          persons={care.persons}
          procedureTypes={care.procedureTypes}
          loading={care.loading}
          error={care.error}
          onChanged={care.onChanged}
        />
      )}

      <div className="mb-2 flex gap-1 rounded-lg border border-border p-0.5">
        {(['memo', 'task', 'deadline'] as PopoverTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1 ${tab === t ? 'bg-accent text-white' : 'text-foreground/80 hover:bg-foreground/5'}`}
          >
            {t === 'memo' ? '메모' : t === 'task' ? '할 일' : '마감'}
          </button>
        ))}
      </div>

      {tab === 'memo' && (
        <form onSubmit={submitMemo} className="flex flex-col gap-1.5">
          <MentionTextarea
            value={memoBody}
            onChange={setMemoBody}
            onAcceptProject={(p) => {
              setMemoProjectId(p.id);
              setMemoProjectTouched(true);
            }}
            projects={projects}
            existingTags={tags}
            placeholder="메모 내용 (@프로젝트 #태그)"
            rows={2}
            className="w-full rounded-md border border-border bg-transparent p-1.5"
          />
          <select
            value={effectiveMemoProjectId}
            onChange={(e) => {
              setMemoProjectId(e.target.value);
              setMemoProjectTouched(true);
            }}
            className="rounded-md border border-border bg-transparent px-2 py-1"
          >
            <option value="">프로젝트 없음</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            value={memoTags}
            onChange={(e) => setMemoTags(e.target.value)}
            placeholder="추가 태그 (쉼표로 구분)"
            list="calendar-memo-tags"
            className="rounded-md border border-border bg-transparent px-2 py-1"
          />
          <datalist id="calendar-memo-tags">
            {tags.map(({ tag: t }) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {effectiveMemoTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {effectiveMemoTags.map((t) => (
                <span key={t} className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-foreground/85">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <button type="submit" disabled={!memoBody.trim()} className="rounded-md bg-accent px-2 py-1 text-white disabled:opacity-40">
            메모 추가
          </button>
        </form>
      )}

      {tab === 'task' && (
        <form onSubmit={submitTask} className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="할 일 제목"
            className="rounded-md border border-border bg-transparent px-2 py-1"
          />
          <select
            value={taskProjectId}
            onChange={(e) => setTaskProjectId(e.target.value)}
            className="rounded-md border border-border bg-transparent px-2 py-1"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {(['me', 'agent'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setTaskAssignee(a)}
                className={`flex-1 rounded px-1.5 py-1 ${taskAssignee === a ? 'bg-accent text-white' : 'text-foreground/80 hover:bg-foreground/5'}`}
              >
                {a === 'me' ? '나' : '에이전트'}
              </button>
            ))}
          </div>
          <button type="submit" disabled={!taskTitle.trim()} className="rounded-md bg-accent px-2 py-1 text-white disabled:opacity-40">
            할 일 추가
          </button>
        </form>
      )}

      {tab === 'deadline' && (
        <form onSubmit={submitDeadline} className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={deadlineTitle}
            onChange={(e) => setDeadlineTitle(e.target.value)}
            placeholder="마감 제목"
            className="rounded-md border border-border bg-transparent px-2 py-1"
          />
          <select
            value={deadlineKind}
            onChange={(e) => setDeadlineKind(e.target.value as DeadlineKind)}
            className="rounded-md border border-border bg-transparent px-2 py-1"
          >
            {DEADLINE_KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <input
            type="time"
            value={deadlineTime}
            onChange={(e) => setDeadlineTime(e.target.value)}
            className="rounded-md border border-border bg-transparent px-2 py-1"
          />
          <button type="submit" disabled={!deadlineTitle.trim()} className="rounded-md bg-accent px-2 py-1 text-white disabled:opacity-40">
            마감 추가
          </button>
        </form>
      )}
    </>
  );
}

interface Props {
  milestones: Milestone[];
  tasks: Task[];
  deadlines: Deadline[];
  reviews: ReviewJob[];
  notes?: Note[];
  googleEvents?: CalendarEvent[];
  /** app_meta 'calendar:visible' — null means "use the primary-calendar default"
   * (see lib/logic/calendar.ts filterVisibleEvents/calendarVisibilityOptions). */
  visibleCalendars?: string[] | null;
  projects: Project[];
  defaultView?: 'month' | 'week';
  compact?: boolean;
  /** Set from careNoteConfigured() server-side — renders the 시술 section and day
   * markers, fetched live per visible range (PLAN_CARENOTE.md §2). */
  careNoteEnabled?: boolean;
}

export function CommandCalendar({
  milestones,
  tasks,
  deadlines,
  reviews,
  notes = [],
  googleEvents = [],
  visibleCalendars = null,
  projects,
  defaultView = 'month',
  compact = false,
  careNoteEnabled = false,
}: Props) {
  const today = todayKST();
  const router = useRouter();
  const [calendarPending, startCalendarTransition] = useTransition();
  const calendarOptions = useMemo(() => calendarVisibilityOptions(googleEvents), [googleEvents]);
  const effectiveVisible = useMemo(
    () => visibleCalendars ?? calendarOptions.filter((o) => o.defaultVisible).map((o) => o.name),
    [visibleCalendars, calendarOptions]
  );
  const visibleGoogleEvents = useMemo(
    () => filterVisibleEvents(googleEvents, visibleCalendars),
    [googleEvents, visibleCalendars]
  );
  function toggleCalendar(name: string) {
    const next = effectiveVisible.includes(name)
      ? effectiveVisible.filter((n) => n !== name)
      : [...effectiveVisible, name];
    startCalendarTransition(async () => {
      await setVisibleCalendarsAction(next);
      router.refresh();
    });
  }
  const [cursor, setCursor] = useState(today);
  const [view, setView] = useState<'month' | 'week'>(defaultView);
  // Defaults to week view on mobile widths. Read once after mount (window is unavailable
  // during SSR, so this can't be a lazy useState initializer without a hydration mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser-only media check
    if (window.innerWidth < 1024) setView('week');
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  function openDay(date: string, e: React.MouseEvent<HTMLButtonElement>) {
    setTriggerEl(e.currentTarget);
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setSelected(date);
  }

  function closeDay() {
    setSelected(null);
    setAnchorRect(null);
    setTriggerEl(null);
  }

  function openAddToday(e: React.MouseEvent<HTMLButtonElement>) {
    openDay(today, e);
  }

  const monthStart = startOfMonthStr(cursor);
  const events = useMemo(
    () =>
      calendarEvents(monthStart, {
        milestones,
        tasks,
        deadlines,
        reviews,
        notes,
        googleEvents: visibleGoogleEvents,
      }),
    [monthStart, milestones, tasks, deadlines, reviews, notes, visibleGoogleEvents]
  );

  const weeks =
    view === 'week' ? events.weeks.filter((w) => w <= cursor && cursor <= addDaysStr(w, 6)) : events.weeks;

  // CareNote (PLAN_CARENOTE.md §2): fetched live for the visible grid range only,
  // on mount and whenever that range changes — never persisted dashboard-side.
  const careRangeFrom = weeks[0];
  const careRangeTo = addDaysStr(weeks[weeks.length - 1], 6);
  const [careRecords, setCareRecords] = useState<CareRecord[]>([]);
  const [carePersons, setCarePersons] = useState<Person[]>([]);
  const [careTypes, setCareTypes] = useState<ProcedureType[]>([]);
  const [careLoading, setCareLoading] = useState(false);
  const [careError, setCareError] = useState<string | null>(null);
  const careRequestRef = useRef(0);

  useEffect(() => {
    if (!careNoteEnabled) return;
    const requestId = ++careRequestRef.current;
    setCareLoading(true);
    setCareError(null);
    loadCareMonthAction(careRangeFrom, careRangeTo).then((result) => {
      if (careRequestRef.current !== requestId) return; // stale response for an old range
      setCareLoading(false);
      if (!result.ok) {
        setCareError(result.error);
        return;
      }
      setCarePersons(result.data.persons);
      setCareTypes(result.data.procedureTypes);
      setCareRecords(result.data.records);
    });
  }, [careNoteEnabled, careRangeFrom, careRangeTo]);

  const careByDate = useMemo(() => recordsByDate(careRecords), [careRecords]);
  const carePersonById = useMemo(() => new Map(carePersons.map((p) => [p.id, p])), [carePersons]);
  const careTypeById = useMemo(() => new Map(careTypes.map((t) => [t.id, t])), [careTypes]);

  function handleCareChanged(date: string, updatedForDate: CareRecord[]) {
    setCareRecords((prev) => [...prev.filter((r) => r.date !== date), ...updatedForDate]);
  }

  const maxLane = events.ranges.reduce((m, r) => Math.max(m, r.lane), -1);
  const laneRows = maxLane + 1;
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const milestoneById = new Map(milestones.map((m) => [m.id, m]));

  function projectColorFor(projectId: string | null): string {
    if (!projectId) return 'bg-foreground/30';
    return projectColorClasses(projectById.get(projectId)?.color).bar;
  }

  return (
    <div className="flex h-full flex-col gap-2 rounded-[var(--r-lg)] border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
            {monthStart.slice(0, 4)}년 {Number(monthStart.slice(5, 7))}월
          </span>
          <button
            type="button"
            onClick={() => setCursor((c) => addMonthsStr(c, 1))}
            aria-label="다음 달"
            className="rounded-md p-1 text-foreground/60 hover:bg-foreground/5"
          >
            <ChevronRight size={16} />
          </button>
          <Button size="sm" variant="ghost" onClick={() => setCursor(today)} className="ml-1">
            오늘
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            options={[{ value: 'month', label: '월' }, { value: 'week', label: '주' }]}
            value={view}
            onChange={setView}
          />
          <Button size="sm" variant="secondary" onClick={openAddToday}>
            <Plus size={14} />
            추가
          </Button>
        </div>
      </div>

      {calendarOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarDays size={12} className="text-foreground/30" />
          {calendarOptions.map((o) => {
            const on = effectiveVisible.includes(o.name);
            return (
              <button key={o.name} type="button" disabled={calendarPending} onClick={() => toggleCalendar(o.name)}>
                <Chip tone={on ? 'accent' : 'neutral'} className="cursor-pointer disabled:opacity-40">
                  {o.name}
                </Chip>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
      <div className="grid grid-cols-7 text-center text-[11px] text-foreground/40">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        {weeks.map((weekMon) => {
          const weekIndex = events.weeks.indexOf(weekMon);
          const segs = events.ranges.filter((r) => r.weekIndex === weekIndex);
          return (
            <div key={weekMon} className="flex flex-col">
              {laneRows > 0 && (
                <div className="relative grid grid-cols-7 gap-px" style={{ minHeight: laneRows * 16 }}>
                  {segs.map((seg) => {
                    const m = milestoneById.get(seg.milestoneId);
                    return (
                      <div
                        key={`${seg.milestoneId}-${seg.weekIndex}`}
                        className={`h-3.5 min-w-0 truncate rounded-full px-1.5 text-[10px] leading-3.5 text-white ${projectColorFor(m?.projectId ?? null)}`}
                        style={{
                          gridColumn: `${seg.colStart} / ${seg.colEnd + 1}`,
                          gridRow: seg.lane + 1,
                        }}
                        title={m?.title}
                      >
                        {seg.isStart ? m?.title : ''}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="grid grid-cols-7 gap-px">
                {Array.from({ length: 7 }, (_, i) => addDaysStr(weekMon, i)).map((date) => {
                  const inMonth = date.slice(0, 7) === monthStart.slice(0, 7);
                  const isToday = date === today;
                  const isHoliday = events.holidays.has(date);
                  const points = events.points[date] ?? [];
                  const careForDay = careNoteEnabled ? (careByDate.get(date) ?? []) : [];
                  // Care rows share the existing 3-row point cap (PLAN_CARENOTE.md
                  // Addendum A1): care first, then other points, then +N.
                  const careShown = compact ? [] : careForDay.slice(0, 3);
                  const pointsShown = compact ? [] : points.slice(0, Math.max(0, 3 - careShown.length));
                  const overflow = careForDay.length + points.length - careShown.length - pointsShown.length;
                  return (
                    <button
                      type="button"
                      key={date}
                      onClick={(e) => openDay(date, e)}
                      className={`flex min-h-14 min-w-0 flex-col items-start gap-0.5 rounded-md p-1 text-left text-[11px] ${
                        inMonth ? '' : 'text-foreground/25'
                      } ${isToday ? 'bg-accent-soft' : 'hover:bg-foreground/5'} ${
                        selected === date ? 'ring-1 ring-accent' : ''
                      } ${compact ? 'min-h-11' : ''}`}
                    >
                      <span className="flex w-full items-center gap-1">
                        <span className={isToday ? 'font-semibold text-accent' : isHoliday ? 'font-semibold text-danger' : ''}>
                          {Number(date.slice(8, 10))}
                        </span>
                        {compact && careForDay.length > 0 && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                        )}
                      </span>
                      {careShown.map((r) => {
                        const person = carePersonById.get(r.personId);
                        const typeName = careTypeById.get(r.procedureTypeId)?.name ?? '시술';
                        return (
                          <span
                            key={`care-${r.id}`}
                            className="flex w-full min-w-0 items-center gap-1 rounded-full px-1 text-[10px] text-foreground/60"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: person?.color ?? '#999' }}
                              aria-hidden
                            />
                            <span className="min-w-0 truncate">{typeName}</span>
                          </span>
                        );
                      })}
                      {pointsShown.map((p) => {
                        const Icon = POINT_ICON[p.kind];
                        const isGoogle = p.kind === 'google';
                        // Deadlines/reviews render as a solid, urgency-tinted D-day chip;
                        // Google events as an outline "◦ HH:mm 제목" chip (§5.7).
                        const isDday = p.kind === 'deadline' || p.kind === 'review';
                        const u = isDday ? urgency(dday(date, today)) : null;
                        const ddayTone =
                          u === 'overdue' || u === 'today'
                            ? 'bg-danger-soft text-danger'
                            : u === 'soon'
                              ? 'bg-warn-soft text-warn'
                              : 'bg-foreground/8 text-foreground/60';
                        return (
                          <span
                            key={p.id}
                            className={`flex w-full min-w-0 items-center gap-0.5 rounded-full px-1 text-[10px] ${
                              isGoogle
                                ? 'border border-border text-foreground/50'
                                : isDday
                                  ? ddayTone
                                  : 'text-foreground/60'
                            }`}
                          >
                            <Icon size={9} className="shrink-0" />
                            {isGoogle && p.startTime && <span>{p.startTime}</span>}
                            <span className="min-w-0 truncate">{p.title}</span>
                          </span>
                        );
                      })}
                      {overflow > 0 && <span className="text-[10px] text-foreground/40">+{overflow}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {/* Mobile agenda for the visible week (§5.7: mobile defaults to week + agenda,
          not a month grid). Desktop already reads the grid directly. */}
      {view === 'week' && weeks[0] && (
        <ul className="flex flex-col gap-2 md:hidden">
          {Array.from({ length: 7 }, (_, i) => addDaysStr(weeks[0], i)).map((date) => {
            const points = events.points[date] ?? [];
            const careForDay = careNoteEnabled ? (careByDate.get(date) ?? []) : [];
            if (points.length === 0 && careForDay.length === 0) return null;
            const isToday = date === today;
            return (
              <li key={date} className="flex gap-2">
                <span
                  className={`tnum w-12 shrink-0 pt-0.5 text-xs ${isToday ? 'font-semibold text-accent' : 'text-foreground/40'}`}
                >
                  {Number(date.slice(5, 7))}/{Number(date.slice(8, 10))}
                </span>
                <ul className="flex min-w-0 flex-1 flex-col gap-1">
                  {careForDay.map((r) => {
                    const person = carePersonById.get(r.personId);
                    const typeName = careTypeById.get(r.procedureTypeId)?.name ?? '시술';
                    return (
                      <li key={`care-${r.id}`} className="flex min-w-0 items-center gap-1.5 text-sm">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: person?.color ?? '#999' }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate">{typeName}</span>
                      </li>
                    );
                  })}
                  {points.map((p) => {
                    const Icon = POINT_ICON[p.kind];
                    const isDday = p.kind === 'deadline' || p.kind === 'review';
                    return (
                      <li key={p.id} className="flex min-w-0 items-center gap-1.5 text-sm">
                        <Icon size={12} className="shrink-0 text-foreground/40" />
                        {p.kind === 'google' && p.startTime && (
                          <span className="tnum shrink-0 text-xs text-foreground/50">{p.startTime}</span>
                        )}
                        <span className="min-w-0 truncate">{p.title}</span>
                        {isDday && <DdayChip n={dday(date, today)} />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {Array.from({ length: 7 }, (_, i) => addDaysStr(weeks[0], i)).every(
            (d) => (events.points[d] ?? []).length === 0 && (careByDate.get(d)?.length ?? 0) === 0
          ) && <p className="text-xs text-foreground/40">이번 주는 비어 있어요.</p>}
        </ul>
      )}

      {selected && anchorRect && (
        <DayPopoverOverlay anchorRect={anchorRect} triggerEl={triggerEl} onClose={closeDay}>
          <DayPopover
            date={selected}
            points={events.points[selected] ?? []}
            notes={notes}
            projects={projects}
            milestones={milestones}
            care={
              careNoteEnabled
                ? {
                    records: careByDate.get(selected) ?? [],
                    persons: carePersons,
                    procedureTypes: careTypes,
                    loading: careLoading,
                    error: careError,
                    onChanged: (updated) => handleCareChanged(selected, updated),
                  }
                : undefined
            }
            onClose={closeDay}
          />
        </DayPopoverOverlay>
      )}

    </div>
  );
}
