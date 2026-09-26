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
 * Splits a backlogGlobs entry `path#Heading` into { file, section }. No `#` -> section null.
 * @param {string} entry
 * @returns {{ file: string, section: string | null }}
 */
export function parseBacklogEntry(entry) {
  const i = entry.indexOf('#');
  if (i < 0) return { file: entry, section: null };
  const section = entry.slice(i + 1).trim();
  return { file: entry.slice(0, i), section: section || null };
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
