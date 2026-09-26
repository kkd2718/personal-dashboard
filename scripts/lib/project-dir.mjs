// Plain JS, Node >=18. Pure functions, unit-tested from vitest.

/** True for WSL-side paths: '/home/...' or '~/...'. Windows drive paths are false. */
export function isWslPath(p) {
  return p.startsWith('/') || p.startsWith('~');
}

/** Converts a Windows path (C:\...) to its WSL /mnt/c/... form. No-op if already a WSL path. */
export function toWslPath(p) {
  if (isWslPath(p)) return p;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  const [, drive, rest] = m;
  return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
}

/**
 * Encodes a project path the same way Claude Code names its ~/.claude/projects/<encoded>
 * transcript directory: every character that isn't [A-Za-z0-9] becomes '-'.
 * e.g. 'D:\Work\my-app' -> 'D--Work-my-app'; non-ASCII chars also become '-'.
 */
export function encodeProjectDir(p) {
  return p.replace(/[^A-Za-z0-9]/g, '-');
}
