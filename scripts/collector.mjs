#!/usr/bin/env node
// PC status collector (phase 2a). Runs on the Windows PC hourly (Task Scheduler,
// see scripts/register-collector-task.ps1) and on demand. Plain JS, Node >=18,
// no dev server needed. Reads which projects to probe from the cloud, gathers
// git/session/backlog telemetry locally, and POSTs it back to /api/ingest.
//
// Usage: node scripts/collector.mjs
// Requires CLOUD_URL and INGEST_TOKEN in .env.local (next to this repo). Optional TRADING_URL.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './lib/env.mjs';
import { encodeProjectDir, isWslPath, toWslPath } from './lib/project-dir.mjs';
import { countBacklog, extractSection, parseBacklogEntry } from './lib/backlog.mjs';
import { tradingStatus } from './lib/trading-probe.mjs';
import { buildStatusItems } from './lib/status-items.mjs';
import { applyImports, defaultInboxContent, externalIdFor, parseNewMemos } from './lib/obsidian-inbox.mjs';

const execFileAsync = promisify(execFile);
// import.meta.dirname needs Node >=20.11 — avoid it here too, in case this ever
// runs under WSL's Node 18.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN_TIMEOUT_MS = 5000;
const WSL_TIMEOUT_MS = 8000;

const env = { ...loadEnvFile(path.join(ROOT, '.env.local')), ...process.env };
const CLOUD_URL = env.CLOUD_URL;
const INGEST_TOKEN = env.INGEST_TOKEN;
const CAPTURE_TOKEN = env.CAPTURE_TOKEN;
const TRADING_URL = env.TRADING_URL ?? 'http://127.0.0.1:8899';
const OBSIDIAN_VAULT = env.OBSIDIAN_VAULT;
const OBSIDIAN_INBOX = env.OBSIDIAN_INBOX || '00_memo/📥 CC Inbox.md';

if (!CLOUD_URL || !INGEST_TOKEN) {
  console.error('CLOUD_URL / INGEST_TOKEN not set in .env.local. See .env.example.');
  process.exit(1);
}

function isEnoent(err) {
  return Boolean(err && typeof err === 'object' && err.code === 'ENOENT');
}

function todayKST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

async function runWin(cmd, args) {
  return execFileAsync(cmd, args, { timeout: WIN_TIMEOUT_MS });
}

async function runWsl(args) {
  return execFileAsync('wsl.exe', args, { timeout: WSL_TIMEOUT_MS });
}

/** Resolves a Project.paths entry to an existing Windows directory, or null. */
function resolveWindowsPath(p) {
  if (isWslPath(p)) return null;
  if (!/^[A-Za-z]:[\\/]/.test(p)) return null;
  return existsSync(p) ? p : null;
}

/** git log -1 / git status --porcelain for a Windows or WSL project path. Never throws. */
async function readGit(projectPath, wsl) {
  try {
    if (wsl) {
      const [log, status] = await Promise.all([
        runWsl(['-e', 'git', '-C', projectPath, 'log', '-1', '--format=%cI%x09%s']),
        runWsl(['-e', 'git', '-C', projectPath, 'status', '--porcelain']),
      ]);
      const [commitAt, msg] = log.stdout.trim().split('\t');
      return { commitAt: commitAt || null, msg: msg ?? null, dirty: status.stdout.trim().length > 0, skipped: false };
    }
    const [log, status] = await Promise.all([
      runWin('git', ['-C', projectPath, 'log', '-1', '--format=%cI%x09%s']),
      runWin('git', ['-C', projectPath, 'status', '--porcelain']),
    ]);
    const [commitAt, msg] = log.stdout.trim().split('\t');
    return { commitAt: commitAt || null, msg: msg ?? null, dirty: status.stdout.trim().length > 0, skipped: false };
  } catch {
    return { commitAt: null, msg: null, dirty: false, skipped: true };
  }
}

async function readGitBranch(projectPath, wsl) {
  try {
    const args = ['-C', projectPath, 'rev-parse', '--abbrev-ref', 'HEAD'];
    const { stdout } = wsl ? await runWsl(['-e', 'git', ...args]) : await runWin('git', args);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Newest mtime (ISO) of *.jsonl under a ~/.claude/projects/<encoded> dir, or null. */
async function newestJsonlMtime(dir) {
  try {
    const entries = await readdir(dir);
    const jsonl = entries.filter((f) => f.endsWith('.jsonl'));
    if (jsonl.length === 0) return null;
    const stats = await Promise.all(jsonl.map((f) => stat(path.join(dir, f))));
    return new Date(Math.max(...stats.map((s) => s.mtimeMs))).toISOString();
  } catch {
    return null;
  }
}

async function newestJsonlMtimeWsl(encodedDir) {
  try {
    const { stdout } = await runWsl([
      '-e',
      'bash',
      '-lc',
      `stat -c %Y ~/.claude/projects/${encodedDir}/*.jsonl 2>/dev/null | sort -n | tail -1`,
    ]);
    const epochSeconds = Number(stdout.trim());
    if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
    return new Date(epochSeconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/** Checks Windows + both WSL encodings (/home and /mnt/c forms) for every project path, takes the max. */
async function lastSessionAt(paths) {
  const homeDir = os.homedir();
  const candidates = [];
  for (const p of paths) {
    if (isWslPath(p)) {
      candidates.push(newestJsonlMtimeWsl(encodeProjectDir(p)));
    } else {
      candidates.push(newestJsonlMtime(path.join(homeDir, '.claude', 'projects', encodeProjectDir(p))));
      candidates.push(newestJsonlMtimeWsl(encodeProjectDir(toWslPath(p))));
    }
  }
  const results = (await Promise.all(candidates)).filter(Boolean);
  if (results.length === 0) return null;
  return new Date(Math.max(...results.map((r) => new Date(r).getTime()))).toISOString();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Reads a backlogGlobs entry (exact file or a simple `dir/*.md` wildcard), relative to projectPath. */
async function readBacklogGlob(projectPath, wsl, glob) {
  if (wsl) {
    try {
      const { stdout } = await runWsl(['-e', 'bash', '-lc', `cat "${projectPath}/${glob}" 2>/dev/null`]);
      return stdout;
    } catch {
      return '';
    }
  }
  if (!glob.includes('*')) {
    try {
      return await readFile(path.join(projectPath, glob), 'utf-8');
    } catch {
      return '';
    }
  }
  const idx = glob.lastIndexOf('/');
  const dir = idx >= 0 ? glob.slice(0, idx) : '';
  const pattern = idx >= 0 ? glob.slice(idx + 1) : glob;
  const fullDir = path.join(projectPath, dir);
  let entries;
  try {
    entries = await readdir(fullDir);
  } catch {
    return '';
  }
  const re = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
  const matched = entries.filter((f) => re.test(f));
  let combined = '';
  for (const f of matched) {
    try {
      combined += `${await readFile(path.join(fullDir, f), 'utf-8')}\n`;
    } catch {
      // unreadable file — skip, never throw
    }
  }
  return combined;
}

async function collectBacklogMetrics(projectPath, wsl, globs) {
  if (!globs || globs.length === 0) return {};
  let open = 0;
  let done = 0;
  for (const entry of globs) {
    // `file#Heading` limits counting to one markdown section (e.g. Amgi 'docs/BACKLOG.md#코드').
    const { file, section } = parseBacklogEntry(entry);
    const raw = await readBacklogGlob(projectPath, wsl, file);
    if (!raw) continue;
    const text = section ? extractSection(raw, section) : raw;
    const counts = countBacklog(text);
    open += counts.open;
    done += counts.done;
  }
  if (open === 0 && done === 0) return {};
  return { backlogOpen: open, backlogDone: done };
}

async function collectProjectActivity(project) {
  const winPath = project.paths.map(resolveWindowsPath).find((p) => p != null);
  const wslPath = winPath ? null : project.paths.find(isWslPath);
  const projectPath = winPath ?? wslPath;
  const collectedAt = new Date().toISOString();

  if (!projectPath) {
    return { projectId: project.id, branch: null, lastCommitAt: null, lastCommitMsg: null, dirty: null, lastSessionAt: null, memoryDigest: null, metrics: {}, collectedAt };
  }

  const wsl = wslPath != null;
  const [{ commitAt, msg, dirty, skipped }, branch, sessionAt, backlogMetrics] = await Promise.all([
    readGit(projectPath, wsl),
    readGitBranch(projectPath, wsl),
    lastSessionAt(project.paths).catch(() => null),
    collectBacklogMetrics(projectPath, wsl, project.backlogGlobs).catch(() => ({})),
  ]);

  return {
    projectId: project.id,
    branch,
    lastCommitAt: skipped ? null : commitAt,
    lastCommitMsg: skipped ? null : msg,
    dirty: skipped ? null : dirty,
    lastSessionAt: sessionAt,
    memoryDigest: null,
    metrics: wsl && skipped ? { wsl: '1', ...backlogMetrics } : backlogMetrics,
    collectedAt,
  };
}

/** Imports new memo bullets from the Obsidian inbox note into /api/capture, then
 * rewrites the file (removed from '새 메모', archived under '가져옴'). One-way
 * (vault -> notes); never touches any other file. Unset OBSIDIAN_VAULT -> silent no-op. */
async function syncObsidianInbox() {
  if (!OBSIDIAN_VAULT) return { imported: 0 };
  if (!CAPTURE_TOKEN) {
    console.error('Obsidian: OBSIDIAN_VAULT is set but CAPTURE_TOKEN is missing — skipping.');
    return { imported: 0 };
  }

  const inboxPath = path.join(OBSIDIAN_VAULT, OBSIDIAN_INBOX);
  let originalText;
  try {
    originalText = await readFile(inboxPath, 'utf-8');
  } catch (e) {
    if (!isEnoent(e)) {
      console.error(`Obsidian: failed to read inbox (${e.message}).`);
      return { imported: 0 };
    }
    await mkdir(path.dirname(inboxPath), { recursive: true });
    originalText = defaultInboxContent();
    await writeFile(inboxPath, originalText, 'utf-8');
  }
  const statBefore = await stat(inboxPath);

  const memos = parseNewMemos(originalText);
  if (memos.length === 0) return { imported: 0 };

  const imported = [];
  for (const memo of memos) {
    try {
      const res = await fetch(`${CLOUD_URL.replace(/\/$/, '')}/api/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${CAPTURE_TOKEN}` },
        body: JSON.stringify({ text: memo.text, externalId: externalIdFor(memo.text), source: 'obsidian' }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = await res.json();
      imported.push({ raw: memo.raw, text: memo.text, noteId: json.id, date: todayKST() });
    } catch (e) {
      console.error(`Obsidian: capture failed for one memo (${e instanceof Error ? e.message : e}); left in place.`);
    }
  }
  if (imported.length === 0) return { imported: 0 };

  const statNow = await stat(inboxPath);
  if (statNow.mtimeMs !== statBefore.mtimeMs) {
    console.error('Obsidian: inbox file changed on disk during import — skipping rewrite this run.');
    return { imported: imported.length };
  }

  const updated = applyImports(originalText, imported);
  const tmp = `${inboxPath}.${process.pid}.tmp`;
  await writeFile(tmp, updated, 'utf-8');
  await rename(tmp, inboxPath);
  return { imported: imported.length };
}

async function main() {
  let projects;
  try {
    const res = await fetch(`${CLOUD_URL.replace(/\/$/, '')}/api/collector/config`, {
      headers: { authorization: `Bearer ${INGEST_TOKEN}` },
    });
    if (!res.ok) throw new Error(`config fetch failed: ${res.status} ${await res.text()}`);
    ({ projects } = await res.json());
  } catch (e) {
    console.error(`Failed to fetch collector config: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const today = todayKST();
  const projectActivity = await Promise.all(projects.map((p) => collectProjectActivity(p).catch(() => null)));
  const validActivity = projectActivity.filter(Boolean);

  const trading = await tradingStatus(TRADING_URL, today).catch(() => []);
  const statusItems = buildStatusItems(projects, validActivity, trading, today);

  const payload = { statusItems, projectActivity: validActivity };
  await mkdir(path.join(ROOT, '.data'), { recursive: true });
  await writeFile(path.join(ROOT, '.data', 'collector-last.json'), JSON.stringify(payload, null, 2), 'utf-8');

  try {
    const res = await fetch(`${CLOUD_URL.replace(/\/$/, '')}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${INGEST_TOKEN}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    console.log(`Collected ${validActivity.length}/${projects.length} project(s), ${statusItems.length} status item(s). Ingest ok.`);
  } catch (e) {
    console.error(`Ingest failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const obsidian = await syncObsidianInbox().catch((e) => {
    console.error(`Obsidian sync failed: ${e instanceof Error ? e.message : e}`);
    return { imported: 0 };
  });
  console.log(`Obsidian: ${obsidian.imported} imported`);
}

await main();
