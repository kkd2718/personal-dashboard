#!/usr/bin/env node
// SessionStart hook (phase 2a): delivers a project's open agent tasks + memos
// "sent" to it into that project's Claude Code session, and (Post-3 polish) the
// Command Center recording protocol block for every managed project. Also the
// Stop hook that nudges once per session when it committed but never refreshed
// docs/cc-status.json. Plain JS, must run under Node 18 (WSL's system node — no
// --env-file, no TS stripping, no import attributes).
//
// Usage:
//   node cc-inbox.mjs hook            # SessionStart: reads {cwd, session_id} from stdin
//   node cc-inbox.mjs stop            # Stop: reads {session_id, cwd, stop_hook_active} from stdin
//   node cc-inbox.mjs list [path]     # manual: same lookup as hook, always prints (for debugging)
//   node cc-inbox.mjs done <id>       # marks a task or note done
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './lib/env.mjs';
import { parseCcStatus } from './lib/cc-status.mjs';
import { protocolBlock, shouldRemind, statusStateText } from './lib/cc-hook.mjs';

// import.meta.dirname/filename need Node >=20.11 — this script must run on Node 18
// (WSL), so derive both from import.meta.url instead.
const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_PATH = path.resolve(process.argv[1] ?? THIS_FILE);
const ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const HOOK_TIMEOUT_MS = 3000;
const GIT_TIMEOUT_MS = 2000;

const execFileAsync = promisify(execFile);

function env() {
  return { ...loadEnvFile(path.join(ROOT, '.env.local')), ...process.env };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function fetchInbox(cwd) {
  const { CLOUD_URL, AGENT_TOKEN } = env();
  if (!CLOUD_URL || !AGENT_TOKEN) return null;
  const url = `${CLOUD_URL.replace(/\/$/, '')}/api/agent-inbox?path=${encodeURIComponent(cwd)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${AGENT_TOKEN}` },
    signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return res.json();
}

function formatDue(dueDate) {
  if (!dueDate) return '';
  const [, m, d] = dueDate.split('-');
  return ` (마감 ${m}-${d})`;
}

function renderBlock(data) {
  const lines = ['## Command Center — 이 프로젝트에 전달된 항목'];
  if (data.tasks.length > 0) {
    lines.push('에이전트 할 일:');
    for (const t of data.tasks) {
      lines.push(`- [${t.id}] ${t.title}${formatDue(t.dueDate)}`);
      if (t.description) for (const d of t.description.split('\n')) lines.push(`  ${d}`);
    }
  }
  if (data.memos.length > 0) {
    lines.push('사용자 메모:');
    for (const n of data.memos) {
      const tags = n.tags.length > 0 ? ` ${n.tags.map((t) => `#${t}`).join(' ')}` : '';
      lines.push(`- [${n.id}] ${n.body}${tags}`);
    }
  }
  lines.push(`완료하면: node "${SCRIPT_PATH}" done <id>`);
  return lines.join('\n');
}

/** `git -C cwd rev-parse --show-toplevel`, falling back to cwd on any error. */
async function gitTopLevel(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: GIT_TIMEOUT_MS });
    return stdout.trim() || cwd;
  } catch {
    return cwd;
  }
}

function ccStatusPath(root) {
  return path.join(root, 'docs', 'cc-status.json');
}

/** ms to date the SessionStart "현재 상태" line by: the file's own updatedAt if
 * parseable, else the file's mtime, else null (no file yet). */
async function statusStateMs(root) {
  let text;
  try {
    text = await readFile(ccStatusPath(root), 'utf-8');
  } catch {
    return null;
  }
  const parsed = parseCcStatus(text);
  const updatedMs = parsed?.updatedAt ? Date.parse(parsed.updatedAt) : NaN;
  if (Number.isFinite(updatedMs)) return updatedMs;
  try {
    return (await stat(ccStatusPath(root))).mtimeMs;
  } catch {
    return null;
  }
}

/** Raw file mtime (Stop hook's staleness check — the file itself, not its content). */
async function statusMtimeMs(root) {
  try {
    return (await stat(ccStatusPath(root))).mtimeMs;
  } catch {
    return null;
  }
}

function markerPath(sessionId) {
  return path.join(os.tmpdir(), `cc-session-${sessionId}.json`);
}

async function readMarker(sessionId) {
  try {
    return JSON.parse(await readFile(markerPath(sessionId), 'utf-8'));
  } catch {
    return null;
  }
}

async function writeMarker(sessionId, marker) {
  try {
    await writeFile(markerPath(sessionId), JSON.stringify(marker), 'utf-8');
  } catch {
    // best-effort — a missing marker just means the Stop hook stays quiet
  }
}

/** Whether `git -C root log` has any commit since `sinceIso`. */
async function hasCommitsSince(root, sinceIso) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'log', `--since=${sinceIso}`, '--format=%H', '-1'],
      { timeout: GIT_TIMEOUT_MS }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function runHookOrList({ verbose }) {
  let cwd;
  let sessionId;
  if (verbose) {
    cwd = process.argv[3] ?? process.cwd();
  } else {
    let stdinText = '';
    try {
      stdinText = await readStdin();
    } catch {
      // no stdin — fall back to process.cwd()
    }
    try {
      const data = JSON.parse(stdinText);
      cwd = data.cwd;
      sessionId = data.session_id;
    } catch {
      // ignore malformed/empty stdin
    }
    cwd = cwd ?? process.cwd();
  }

  let data;
  try {
    data = await fetchInbox(cwd);
  } catch {
    data = null; // network error / timeout — never block or slow the session
  }

  if (!data || !data.project) {
    if (verbose) console.log(`No agent inbox items for ${cwd}.`);
    return;
  }

  const root = await gitTopLevel(cwd);
  const stateMs = await statusStateMs(root).catch(() => null);
  console.log(protocolBlock(root, statusStateText(stateMs, Date.now())));
  if (data.tasks.length > 0 || data.memos.length > 0) {
    console.log(renderBlock(data));
  }

  if (sessionId) {
    await writeMarker(sessionId, {
      startedAt: new Date().toISOString(),
      root,
      projectId: data.project.id,
      reminded: false,
    });
  }
}

async function runStop() {
  try {
    let stdinText = '';
    try {
      stdinText = await readStdin();
    } catch {
      return;
    }
    const { session_id: sessionId, cwd, stop_hook_active: stopHookActive } = JSON.parse(stdinText);
    if (stopHookActive) return;
    if (!sessionId) return;

    const marker = await readMarker(sessionId);
    if (!marker || marker.reminded) return;

    const root = marker.root || cwd || process.cwd();
    const hasCommits = await hasCommitsSince(root, marker.startedAt);
    const statusMtimeMsValue = hasCommits ? await statusMtimeMs(root) : null;
    if (!shouldRemind({ marker, hasCommits, statusMtimeMs: statusMtimeMsValue })) return;

    await writeMarker(sessionId, { ...marker, reminded: true });
    console.log(
      JSON.stringify({
        decision: 'block',
        reason: 'Command Center: 이번 세션에 커밋이 있었는데 docs/cc-status.json 이 갱신되지 않았어요. 기록 규칙대로 갱신한 뒤 마치세요.',
      })
    );
  } catch {
    // the Stop hook must never wedge a session
  }
}

async function runDone(id) {
  if (!id) {
    console.error('Usage: node cc-inbox.mjs done <id>');
    process.exit(1);
  }
  const { CLOUD_URL, AGENT_TOKEN } = env();
  if (!CLOUD_URL || !AGENT_TOKEN) {
    console.error('CLOUD_URL / AGENT_TOKEN not set in .env.local.');
    process.exit(1);
  }
  const url = `${CLOUD_URL.replace(/\/$/, '')}/api/agent-inbox/done`;
  const post = (body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${AGENT_TOKEN}` },
      body: JSON.stringify(body),
    });

  let res = await post({ taskId: id });
  if (res.status === 404) res = await post({ noteId: id });
  if (!res.ok) {
    console.error(`Failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`Done: ${id}`);
}

const [, , cmd, arg] = process.argv;
if (cmd === 'hook') {
  await runHookOrList({ verbose: false });
} else if (cmd === 'stop') {
  await runStop();
} else if (cmd === 'list') {
  await runHookOrList({ verbose: true });
} else if (cmd === 'done') {
  await runDone(arg);
} else {
  console.error('Usage: node cc-inbox.mjs hook|stop|list [path]|done <id>');
  process.exit(1);
}
