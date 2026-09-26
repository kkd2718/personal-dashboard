'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { updateProjectAction } from '@/app/actions/projects';
import { useToast } from '@/components/ui/toast';
import { PROJECT_COLORS, projectColorClasses } from '@/lib/project-colors';
import type { LinkRef, Project } from '@/lib/types';

const STATUS_LABEL: Record<Project['status'], string> = {
  active: '진행중',
  paused: '일시중지',
  done: '완료',
  archived: '보관됨',
};

const LINK_KIND_LABEL: Record<LinkRef['kind'], string> = {
  public: '공개',
  local: 'PC 전용',
  tailscale: 'Tailscale',
  repo: '저장소',
  folder: '폴더',
};

/** Settings form for a project, opened from the detail page's ✎ 편집 sheet
 * (ux-advice.md §5.4) — never rendered inline on the page itself. */
export function ProjectEditForm({ project, onSaved }: { project: Project; onSaved?: () => void }) {
  const [status, setStatus] = useState(project.status);
  const [summary, setSummary] = useState(project.summary);
  const [nextAction, setNextAction] = useState(project.nextAction ?? '');
  const [aliasesText, setAliasesText] = useState(project.aliases.join(', '));
  const [backlogGlobsText, setBacklogGlobsText] = useState(project.backlogGlobs.join(', '));
  const [pathsText, setPathsText] = useState(project.paths.join('\n'));
  const [links, setLinks] = useState<LinkRef[]>(project.links);
  const [color, setColor] = useState(project.color);
  const [pinned, setPinned] = useState(project.pinned);
  const [pending, startTransition] = useTransition();
  const { show } = useToast();

  function addLink() {
    setLinks((prev) => [...prev, { label: '', url: '', kind: 'public' }]);
  }

  function updateLink(i: number, patch: Partial<LinkRef>) {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLink(i: number) {
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  function save() {
    const aliases = aliasesText.split(',').map((a) => a.trim()).filter(Boolean);
    const backlogGlobs = backlogGlobsText.split(',').map((g) => g.trim()).filter(Boolean);
    const paths = pathsText.split('\n').map((p) => p.trim()).filter(Boolean);
    const cleanLinks = links.filter((l) => l.label.trim() && l.url.trim());
    startTransition(async () => {
      await updateProjectAction({
        id: project.id,
        status,
        summary,
        nextAction: nextAction || null,
        aliases,
        backlogGlobs,
        paths,
        links: cleanLinks,
        color,
        pinned,
      });
      show('저장했어요', { variant: 'success' });
      onSaved?.();
    });
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        상태
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Project['status'])}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        >
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        요약
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1">
        다음 액션
        <input
          value={nextAction}
          onChange={(e) => setNextAction(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1">
        별칭 (쉼표로 구분, @멘션에 사용)
        <input
          value={aliasesText}
          onChange={(e) => setAliasesText(e.target.value)}
          placeholder="예: 브레인CT, brain ct, 뇌CT"
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1">
        백로그 파일 (쉼표로 구분, 프로젝트 경로 기준 상대경로)
        <input
          value={backlogGlobsText}
          onChange={(e) => setBacklogGlobsText(e.target.value)}
          placeholder="예: docs/BACKLOG.md"
          className="rounded-md border border-border bg-transparent px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1">
        경로 (한 줄에 하나, PC/WSL 절대경로 — 화면에는 표시되지 않아요)
        <textarea
          value={pathsText}
          onChange={(e) => setPathsText(e.target.value)}
          rows={2}
          className="rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-xs"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span>링크</span>
        {links.map((link, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input
              value={link.label}
              onChange={(e) => updateLink(i, { label: e.target.value })}
              placeholder="라벨"
              className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
            />
            <input
              value={link.url}
              onChange={(e) => updateLink(i, { url: e.target.value })}
              placeholder="URL"
              className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-xs"
            />
            <select
              value={link.kind}
              onChange={(e) => updateLink(i, { kind: e.target.value as LinkRef['kind'] })}
              className="rounded-md border border-border bg-transparent px-1.5 py-1 text-xs"
            >
              {Object.entries(LINK_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => removeLink(i)} aria-label="링크 삭제" className="rounded-md p-1 text-foreground/40 hover:bg-foreground/5">
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addLink}
          className="flex w-fit items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-foreground/50 hover:bg-foreground/5"
        >
          <Plus size={12} /> 링크 추가
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span>색상</span>
        <div className="flex flex-wrap gap-1.5">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              aria-pressed={c === color}
              className={`h-6 w-6 rounded-full ${projectColorClasses(c).dot} ${
                c === color ? 'ring-2 ring-offset-2 ring-offset-surface ring-accent' : ''
              }`}
            />
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        고정
      </label>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="self-start rounded-[var(--r-sm)] bg-accent px-4 py-1.5 text-white disabled:opacity-40"
      >
        저장
      </button>
    </div>
  );
}
