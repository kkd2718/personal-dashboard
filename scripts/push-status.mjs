#!/usr/bin/env node
// Manual run (Task Scheduler wiring is phase 2): fetches the local status probes
// from this machine's own dev/prod server and pushes them to the cloud deploy's
// /api/ingest so the status panel has fresh data when LOCAL_PROBES is off there.
//
// Usage: node --env-file=.env.local scripts/push-status.mjs
// Requires CLOUD_URL and INGEST_TOKEN in the environment.
const LOCAL_URL = process.env.LOCAL_STATUS_URL ?? 'http://localhost:3100/api/status';
const CLOUD_URL = process.env.CLOUD_URL;
const INGEST_TOKEN = process.env.INGEST_TOKEN;

if (!CLOUD_URL || !INGEST_TOKEN) {
  console.error('CLOUD_URL / INGEST_TOKEN not set. See .env.example.');
  process.exit(1);
}

const localRes = await fetch(LOCAL_URL);
if (!localRes.ok) {
  console.error(`Local status fetch failed: ${localRes.status} (${LOCAL_URL}). Is \`npm run dev\` running?`);
  process.exit(1);
}
const { items } = await localRes.json();

const ingestRes = await fetch(`${CLOUD_URL.replace(/\/$/, '')}/api/ingest`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${INGEST_TOKEN}` },
  body: JSON.stringify({ statusItems: items }),
});

if (!ingestRes.ok) {
  console.error(`Ingest failed: ${ingestRes.status} ${await ingestRes.text()}`);
  process.exit(1);
}

console.log(`Pushed ${items.length} status item(s) to ${CLOUD_URL}.`);
