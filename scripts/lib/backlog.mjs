// Plain JS, Node >=18 (runs under WSL's Node 18 too). Pure function, unit-tested from vitest.

/**
 * Counts open/done items in a BACKLOG-style markdown file.
 * - Checkbox lines `- [ ]` / `- [x]` / `* [X]` -> open/done.
 * - Else top-level numbered items `1. ...` (Amgi BACKLOG.md style): done if the
 *   item's first line contains a checkmark (✅), starts with a `~~strike~~`, or
 *   contains `**완료`; otherwise open. Nested/indented lines are ignored.
 * - If the file has any checkbox lines, numbered items are ignored entirely
 *   (avoids double counting a file that mixes both conventions).
 * @param {string} text
 * @returns {{ open: number, done: number }}
 */
export function countBacklog(text) {
  const lines = text.split(/\r?\n/);
  const checkboxRe = /^\s*[-*]\s\[( |x|X)\]/;
  const numberedRe = /^\d+\.\s/;

  const checkboxLines = lines.filter((l) => checkboxRe.test(l));
  if (checkboxLines.length > 0) {
    let open = 0;
    let done = 0;
    for (const line of checkboxLines) {
      const m = checkboxRe.exec(line);
      if (m[1] === ' ') open += 1;
      else done += 1;
    }
    return { open, done };
  }

  let open = 0;
  let done = 0;
  for (const line of lines) {
    if (!numberedRe.test(line)) continue;
    const isDone = line.includes('✅') || /^\d+\.\s*~~/.test(line) || line.includes('**완료');
    if (isDone) done += 1;
    else open += 1;
  }
  return { open, done };
}

/**
 * Titles of the *open* items in a BACKLOG-style markdown file, using the same
 * checkbox-vs-numbered classification as countBacklog. Title = the line's first
 * `**bold**` segment if present, else the line with its prefix removed and
 * `**`/`~~`/backticks stripped. Trailing `:`/`—` trimmed, truncated to 80 chars.
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
export function listOpenItems(text, max = 15) {
  const lines = text.split(/\r?\n/);
  const checkboxRe = /^\s*[-*]\s\[( |x|X)\]\s*/;
  const numberedRe = /^\d+\.\s*/;

  const checkboxLines = lines.filter((l) => checkboxRe.test(l));
  const openLines = [];
  if (checkboxLines.length > 0) {
    for (const line of checkboxLines) {
      const m = checkboxRe.exec(line);
      if (m[1] === ' ') openLines.push(line.replace(checkboxRe, ''));
    }
  } else {
    for (const line of lines) {
      if (!numberedRe.test(line)) continue;
      const isDone = line.includes('✅') || /^\d+\.\s*~~/.test(line) || line.includes('**완료');
      if (!isDone) openLines.push(line.replace(numberedRe, ''));
    }
  }

  return openLines.slice(0, max).map(titleFromLine);
}

/** Extracts a display title from one open-item line (see listOpenItems). */
function titleFromLine(line) {
  const bold = /\*\*(.+?)\*\*/.exec(line);
  let title = bold ? bold[1] : line.replace(/\*\*|~~|`/g, '');
  title = title.trim().replace(/[:—]$/, '').trim();
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

/**
 * Splits a backlogGlobs entry `[라벨=]path[#Heading]` into { label, file, section }.
 * No `#` -> section null. A `라벨=` prefix makes the entry its own named progress bar
 * (e.g. Amgi `코드=docs/BACKLOG.md#코드`, `노트=docs/progress.json#notes`); unlabeled
 * entries are summed into the single legacy backlog bar.
 * @param {string} entry
 * @returns {{ label: string | null, file: string, section: string | null }}
 */
export function parseBacklogEntry(entry) {
  let label = null;
  let rest = entry;
  const eq = entry.indexOf('=');
  if (eq > 0 && !entry.slice(0, eq).includes('/')) {
    label = entry.slice(0, eq).trim() || null;
    rest = entry.slice(eq + 1);
  }
  const i = rest.indexOf('#');
  if (i < 0) return { label, file: rest, section: null };
  const section = rest.slice(i + 1).trim();
  return { label, file: rest.slice(0, i), section: section || null };
}

/**
 * Reads `{ "<key>": { "done": n, "total": n } }` (a project-written progress file)
 * as open/done counts. Missing key, bad JSON or nonsense numbers -> zeros.
 * @param {string} text
 * @param {string | null} key
 * @returns {{ open: number, done: number }}
 */
export function countJsonProgress(text, key) {
  try {
    const obj = JSON.parse(text);
    const v = key ? obj?.[key] : obj;
    const done = Number(v?.done);
    const total = Number(v?.total);
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done < 0) return { open: 0, done: 0 };
    const d = Math.min(done, total);
    return { open: total - d, done: d };
  } catch {
    return { open: 0, done: 0 };
  }
}

/**
 * Returns only the markdown section whose heading text starts with `section`
 * (case-insensitive), up to the next heading of the same or higher level.
 * Missing heading -> '' (counts as nothing, so a typo never inflates numbers).
 * @param {string} text
 * @param {string} section
 * @returns {string}
 */
export function extractSection(text, section) {
  const lines = text.split(/\r?\n/);
  const want = section.toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (start < 0) {
      if (m[2].trim().toLowerCase().startsWith(want)) {
        start = i + 1;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join('\n');
    }
  }
  return start < 0 ? '' : lines.slice(start).join('\n');
}
