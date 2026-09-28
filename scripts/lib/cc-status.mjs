// Plain JS, Node >=18. Parses docs/cc-status.json — written by a managed project's
// own Claude session per the Command Center protocol (see cc-inbox.mjs's SessionStart
// block). Pure function, unit-tested from vitest.

function trimTo(s, max) {
  return s.trim().slice(0, max);
}

/** Trims non-empty strings from an array, drops non-strings, caps length and item length. */
function cleanStringArray(arr, maxItems, maxLen) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => typeof s === 'string')
    .map((s) => trimTo(s, maxLen))
    .filter((s) => s.length > 0)
    .slice(0, maxItems);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Project sessions don't always follow the schema to the letter (e.g. trading-system
// wrote `title` + `blocked` + `due`), so accept the common variants rather than
// silently dropping a whole checklist.
function itemText(o) {
  for (const k of ['text', 'title', 'item', 'name']) if (typeof o[k] === 'string') return o[k];
  return null;
}

function cleanDone(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((d) => d && typeof d === 'object' && itemText(d) !== null)
    .map((d) => ({
      date: typeof d.date === 'string' && DATE_RE.test(d.date) ? d.date : null,
      text: trimTo(itemText(d), 200),
    }))
    .filter((d) => d.text.length > 0)
    .slice(0, 10);
}

const STATUS_ALIASES = {
  todo: 'todo',
  open: 'todo',
  pending: 'todo',
  doing: 'doing',
  in_progress: 'doing',
  wip: 'doing',
  blocked: 'blocked',
  waiting: 'blocked',
  done: 'done',
  completed: 'done',
};

/** Drops items with an unknown status; owner defaults to 'agent' for anything
 * else/missing. Section (max 40 chars) and due (YYYY-MM-DD) are optional. Caps at 60 items. */
function cleanChecklist(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && typeof c === 'object' && itemText(c) !== null && typeof c.status === 'string' && STATUS_ALIASES[c.status.toLowerCase()])
    .map((c) => ({
      text: trimTo(itemText(c), 200),
      status: STATUS_ALIASES[c.status.toLowerCase()],
      section: typeof c.section === 'string' ? trimTo(c.section, 40) || null : null,
      owner: c.owner === 'me' ? 'me' : 'agent',
      due: typeof c.due === 'string' && DATE_RE.test(c.due) ? c.due : null,
    }))
    .filter((c) => c.text.length > 0)
    .slice(0, 60);
}

/**
 * Parses + normalizes a project's docs/cc-status.json. Returns null for bad JSON,
 * a non-object, or an object where every field ends up empty.
 * @param {string} text
 * @returns {{updatedAt:string|null,focus:string|null,next:string[],blockers:string[],done:Array<{date:string|null,text:string}>,checklist:Array<{text:string,status:string,section:string|null,owner:string}>}|null}
 */
export function parseCcStatus(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const focus = typeof obj.focus === 'string' ? trimTo(obj.focus, 200) : '';
  const next = cleanStringArray(obj.next, 8, 200);
  const blockers = cleanStringArray(obj.blockers, 8, 200);
  const done = cleanDone(obj.done);
  const checklist = cleanChecklist(obj.checklist);
  const updatedAt = typeof obj.updatedAt === 'string' && Number.isFinite(Date.parse(obj.updatedAt)) ? obj.updatedAt : null;

  if (!updatedAt && !focus && next.length === 0 && blockers.length === 0 && done.length === 0 && checklist.length === 0) return null;

  return { updatedAt, focus: focus || null, next, blockers, done, checklist };
}
