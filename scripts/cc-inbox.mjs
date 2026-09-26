#!/usr/bin/env node
// SessionStart hook (phase 2a): delivers a project's open agent tasks + memos
// "sent" to it into that project's Claude Code session. Plain JS, must run under
// Node 18 (WSL's system node — no --env-file, no TS stripping, no import attributes).
//
// Usage:
//   node cc-inbox.mjs hook            # reads {"cwd": "..."} from stdin (SessionStart payload)
//   node cc-inbox.mjs list [path]     # manual: same lookup, always prints (for debugging)
//   node cc-inbox.mjs done <id>       # marks a task or note done
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './lib/env.mjs';

// import.meta.dirname/filename need Node >=20.11 — this script must run on Node 18
// (WSL), so derive both from import.meta.url instead.
const THIS_FILE = fileURLToPath(import.meta.url);
const SCRIPT_PATH = path.resolve(process.argv[1] ?? THIS_FILE);
const ROOT = path.resolve(path.dirname(THIS_FILE), '..');
const HOOK_TIMEOUT_MS = 3000;

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
    for (const t of data.tasks) lines.push(`- [${t.id}] ${t.title}${formatDue(t.dueDate)}`);
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

async function runHookOrList({ verbose }) {
  let cwd;
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
      cwd = JSON.parse(stdinText).cwd;
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

  if (!data || !data.project || (data.tasks.length === 0 && data.memos.length === 0)) {
    if (verbose) console.log(`No agent inbox items for ${cwd}.`);
    return;
  }
  console.log(renderBlock(data));
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
} else if (cmd === 'list') {
  await runHookOrList({ verbose: true });
} else if (cmd === 'done') {
  await runDone(arg);
} else {
  console.error('Usage: node cc-inbox.mjs hook|list [path]|done <id>');
  process.exit(1);
}
