// Plain JS, Node >=18. Pure parse/rewrite for the Obsidian one-way inbox note
// (phase 3, docs/PLAN_3.md §6). No filesystem access here — scripts/collector.mjs
// reads/writes the file and calls these functions.
import { createHash } from 'node:crypto';

const NEW_HEADING_RE = /^##\s*새 메모\s*$/;
const IMPORTED_HEADING_RE = /^##\s*가져옴\s*$/;
const MAX_IMPORTED = 50;

/** Default content for a freshly created inbox note. */
export function defaultInboxContent() {
  return [
    '---',
    'title: CC Inbox',
    'tags: [command-center]',
    'type: reference',
    '---',
    '',
    '## 새 메모',
    '<!-- 한 줄에 메모 하나씩 "- "로 시작. 여러 줄 메모는 2칸 이상 들여쓰기로 이어서 작성. @프로젝트 #태그 가능. -->',
    '',
    '## 가져옴',
    '',
  ].join('\n');
}

/** 'obsidian:<sha1>' of the memo text, normalized (trimmed, internal whitespace
 * collapsed) so trivial re-formatting doesn't create a duplicate import. */
export function externalIdFor(text) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return `obsidian:${createHash('sha1').update(normalized, 'utf8').digest('hex')}`;
}

function findSection(lines, headingRe) {
  const start = lines.findIndex((l) => headingRe.test(l.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Top-level bullets (`- text` / `- [ ] text`) under "## 새 메모"; lines indented
 * by 2+ spaces continue the previous bullet. Returns [] when the section is
 * missing or empty. `raw` is the exact original lines (for removal on import),
 * `text` is the checkbox-stripped, continuation-joined memo body.
 */
export function parseNewMemos(fileText) {
  const lines = fileText.split(/\r?\n/);
  const section = findSection(lines, NEW_HEADING_RE);
  if (!section) return [];

  const memos = [];
  let current = null;
  const flush = () => {
    if (current) memos.push({ raw: current.rawLines.join('\n'), text: current.textLines.join('\n').trim() });
    current = null;
  };
  for (let i = section.start + 1; i < section.end; i++) {
    const line = lines[i];
    const bullet = /^-\s(\[[ xX]\]\s*)?(.*)$/.exec(line);
    if (bullet) {
      flush();
      current = { rawLines: [line], textLines: [bullet[2]] };
    } else if (current && /^\s{2,}\S/.test(line)) {
      current.rawLines.push(line);
      current.textLines.push(line.trim());
    } else {
      flush(); // blank line, comment, or anything else ends the current memo block
    }
  }
  flush();
  return memos.filter((m) => m.text.length > 0);
}

/**
 * Removes the given raw bullet blocks from "## 새 메모" and prepends
 * `- <first line of text> <!-- cc:<noteId> <date> -->` entries under
 * "## 가져옴", capping that section at 50 entries (oldest dropped first).
 * `imports`: [{ raw, text, noteId, date }], newest first. Missing sections are
 * created; a totally unrecognized file is returned unchanged if `imports` is empty.
 */
export function applyImports(fileText, imports) {
  if (imports.length === 0) return fileText;

  const usesCRLF = fileText.includes('\r\n');
  const lines = fileText.split(/\r?\n/);

  const newSection = findSection(lines, NEW_HEADING_RE);
  let result = lines.slice();
  if (newSection) {
    const rawBlocks = imports.map((i) => i.raw.split('\n'));
    const before = result.slice(0, newSection.start + 1);
    const body = result.slice(newSection.start + 1, newSection.end);
    const after = result.slice(newSection.end);
    const kept = [];
    for (let i = 0; i < body.length; ) {
      const match = rawBlocks.find((rb) => body.slice(i, i + rb.length).join('\n') === rb.join('\n'));
      if (match) {
        i += match.length;
        continue;
      }
      kept.push(body[i]);
      i += 1;
    }
    result = [...before, ...kept, ...after];
  }

  const entryLines = imports.map((imp) => {
    const firstLine = imp.text.split('\n')[0];
    return `- ${firstLine} <!-- cc:${imp.noteId} ${imp.date} -->`;
  });

  const importedSection = findSection(result, IMPORTED_HEADING_RE);
  if (importedSection) {
    const existing = result
      .slice(importedSection.start + 1, importedSection.end)
      .filter((l) => l.trim().startsWith('- '));
    const merged = [...entryLines, ...existing].slice(0, MAX_IMPORTED);
    result = [
      ...result.slice(0, importedSection.start + 1),
      ...merged,
      ...result.slice(importedSection.end),
    ];
  } else {
    result = [...result, '', '## 가져옴', ...entryLines];
  }

  const joined = result.join('\n');
  return usesCRLF ? joined.replace(/\n/g, '\r\n') : joined;
}
