'use client';

import { useMemo, useRef, useState } from 'react';
import { normalize } from '@/lib/logic/capture';
import { projectColorClasses } from '@/lib/project-colors';
import type { Project } from '@/lib/types';

interface TokenMatch {
  marker: '@' | '#';
  start: number; // index of the marker itself
  end: number; // cursor position
  query: string;
}

/** Finds an unfinished @/# token ending right at the cursor, if any. */
function activeToken(value: string, cursor: number): TokenMatch | null {
  const head = value.slice(0, cursor);
  const m = /([@#])([\p{L}\p{N}_-]*)$/u.exec(head);
  if (!m) return null;
  return { marker: m[1] as '@' | '#', start: cursor - m[0].length, end: cursor, query: m[2] };
}

interface ProjectSuggestion {
  kind: 'project';
  project: Project;
}
interface TagSuggestion {
  kind: 'tag';
  tag: string;
  isNew: boolean;
}
type Suggestion = ProjectSuggestion | TagSuggestion;

function projectSuggestions(projects: Project[], query: string): ProjectSuggestion[] {
  const norm = normalize(query);
  const scored = projects
    .map((p) => {
      const candidates = [p.slug, p.name, ...p.aliases].map(normalize);
      const hit = candidates.some((c) => c.startsWith(norm)) ? 2 : candidates.some((c) => c.includes(norm)) ? 1 : 0;
      return { p, hit };
    })
    .filter((s) => norm === '' || s.hit > 0)
    .sort((a, b) => {
      if (a.hit !== b.hit) return b.hit - a.hit;
      const statusRank = (s: Project) => (s.status === 'active' ? 0 : 1);
      return statusRank(a.p) - statusRank(b.p);
    });
  return scored.slice(0, 6).map((s) => ({ kind: 'project', project: s.p }));
}

function tagSuggestions(tags: { tag: string; count: number }[], query: string): TagSuggestion[] {
  const norm = normalize(query);
  const matches = tags
    .filter((t) => norm === '' || normalize(t.tag).includes(norm))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((t): TagSuggestion => ({ kind: 'tag', tag: t.tag, isNew: false }));
  const exact = matches.some((m) => normalize(m.tag) === norm);
  if (query.trim() && !exact) {
    matches.push({ kind: 'tag', tag: query.trim(), isNew: true });
  }
  return matches;
}

/**
 * Textarea with live @project / #tag autocomplete: caret-anchored dropdown,
 * Tab/Enter to accept, Esc to close. Shared by quick-capture and the
 * calendar day popover's memo form so both resolve tokens the same way.
 */
export function MentionTextarea({
  value,
  onChange,
  onAcceptProject,
  projects,
  existingTags,
  placeholder,
  rows = 2,
  className = '',
  wrapperClassName = '',
  onFocus,
  onKeyDownExtra,
  textareaRef: externalRef,
}: {
  value: string;
  onChange: (next: string) => void;
  onAcceptProject?: (project: Project) => void;
  projects: Project[];
  existingTags: { tag: string; count: number }[];
  placeholder?: string;
  rows?: number;
  className?: string;
  wrapperClassName?: string;
  onFocus?: () => void;
  onKeyDownExtra?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? innerRef;
  const [token, setToken] = useState<TokenMatch | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!token) return [];
    return token.marker === '@'
      ? projectSuggestions(projects, token.query)
      : tagSuggestions(existingTags, token.query);
  }, [token, projects, existingTags]);

  function syncToken(nextValue: string, cursor: number) {
    setToken(activeToken(nextValue, cursor));
    setHighlight(0);
  }

  function acceptSuggestion(s: Suggestion) {
    if (!token || !textareaRef.current) return;
    const canonical = s.kind === 'project' ? `@${s.project.slug} ` : `#${s.tag} `;
    const next = value.slice(0, token.start) + canonical + value.slice(token.end);
    const cursor = token.start + canonical.length;
    onChange(next);
    setToken(null);
    if (s.kind === 'project') onAcceptProject?.(s.project);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(cursor, cursor);
      textareaRef.current?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (token && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        acceptSuggestion(suggestions[highlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setToken(null);
        return;
      }
    }
    onKeyDownExtra?.(e);
  }

  return (
    <div className={`relative ${wrapperClassName}`}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          syncToken(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => syncToken(value, e.currentTarget.selectionStart)}
        onKeyUp={(e) => syncToken(value, e.currentTarget.selectionStart)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setToken(null), 150)}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
      {token && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-border bg-surface p-1 text-xs shadow-lg"
        >
          {suggestions.map((s, i) => {
            const key = s.kind === 'project' ? s.project.id : `${s.tag}-${i}`;
            const isHighlighted = i === highlight;
            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isHighlighted}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptSuggestion(s);
                  }}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left ${
                    isHighlighted ? 'bg-blue-600 text-white' : 'hover:bg-foreground/5'
                  }`}
                >
                  {s.kind === 'project' ? (
                    <>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${projectColorClasses(s.project.color).dot}`} />
                      {s.project.name}
                    </>
                  ) : s.isNew ? (
                    <>새 태그 만들기: #{s.tag}</>
                  ) : (
                    <>#{s.tag}</>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
