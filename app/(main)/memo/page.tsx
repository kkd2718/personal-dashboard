import { getRepo } from '@/lib/repo';
import { QuickCapture } from '@/components/quick-capture';
import { NoteItem } from '@/components/note-item';
import { TagManager } from '@/components/tag-manager';
import { tagCounts } from '@/lib/logic/notes';
import { addDaysStr, startOfIsoWeek, todayKST } from '@/lib/logic/dates';
import type { Note, NoteKind, NoteStatus } from '@/lib/types';

const KIND_LABEL: Record<NoteKind, string> = { idea: '아이디어', memo: '메모', todo: '할 일', link: '링크' };
const STATUS_LABEL: Record<NoteStatus, string> = {
  inbox: '인박스',
  filed: '분류됨',
  sent: '전달됨',
  done: '완료',
  archived: '보관됨',
};

interface SearchParams {
  kind?: string;
  status?: string;
  project?: string;
  tag?: string;
}

/** Groups notes into 오늘/어제/이번 주/이전 buckets by createdAt (KST calendar day). */
function groupByDate(notes: Note[], today: string): { label: string; notes: Note[] }[] {
  const yesterday = addDaysStr(today, -1);
  const weekStart = startOfIsoWeek(today);
  const groups = { 오늘: [] as Note[], 어제: [] as Note[], '이번 주': [] as Note[], 이전: [] as Note[] };
  for (const n of notes) {
    const day = n.createdAt.slice(0, 10);
    if (day === today) groups['오늘'].push(n);
    else if (day === yesterday) groups['어제'].push(n);
    else if (day >= weekStart) groups['이번 주'].push(n);
    else groups['이전'].push(n);
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, notes: list }));
}

export default async function MemoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { kind, status, project, tag } = await searchParams;
  const repo = getRepo();
  const [notes, projects, milestones] = await Promise.all([
    repo.listNotes(),
    repo.listProjects(),
    repo.listMilestones(),
  ]);

  const filtered = notes
    .filter((n) => (status ? n.status === status : n.status !== 'archived'))
    .filter((n) => (kind ? n.kind === kind : true))
    .filter((n) => (project ? n.projectId === project : true))
    .filter((n) => (tag ? n.tags.some((t) => t.toLowerCase() === tag.toLowerCase()) : true))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });

  const groups = groupByDate(filtered, todayKST());
  const tags = tagCounts(notes);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">메모</h1>
        <p className="text-sm text-foreground/50">
          떠오른 생각을 적어두고, 필요하면 할 일로 바꾸세요.
        </p>
      </div>
      <QuickCapture projects={projects.filter((p) => p.status === 'active')} existingTags={tags} />
      <TagManager tags={tags} />

      <form className="flex flex-wrap gap-2 text-sm" method="get">
        <select name="kind" defaultValue={kind ?? ''} className="rounded-md border border-border bg-transparent px-2 py-1.5">
          <option value="">모든 종류</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={status ?? ''}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          <option value="">보관 제외 전체</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          name="project"
          defaultValue={project ?? ''}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          <option value="">모든 프로젝트</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          name="tag"
          defaultValue={tag ?? ''}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          <option value="">모든 태그</option>
          {tags.map(({ tag: t, count }) => (
            <option key={t} value={t}>
              #{t} ({count})
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md border border-border px-3 py-1.5">
          필터 적용
        </button>
      </form>

      {groups.length === 0 ? (
        <p className="text-sm text-foreground/50">조건에 맞는 메모가 없습니다.</p>
      ) : (
        groups.map(({ label, notes: groupNotes }) => (
          <section key={label} className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-foreground/50">{label}</h2>
            <ul className="flex flex-col gap-2">
              {groupNotes.map((note) => (
                <NoteItem key={note.id} note={note} projects={projects} milestones={milestones} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
