@AGENTS.md

# Command Center — personal dashboard

Memo inbox + command center for projects/papers/reviews/deadlines. Full spec: `docs/PLAN.md`.

## Stack
Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, npm (no pnpm on Windows), Node 24.
dnd-kit (kanban), date-fns, zod, lucide-react, Vitest. Korean UI. Dark mode via `.dark` class
(`components/theme-toggle.tsx`), Tailwind `@custom-variant dark` in `app/globals.css`.

## Commands
- `npm run dev` — dev server on **:3100** (3000 is used by other local apps)
- `npm run build` / `npm start` (also :3100)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — `vitest run`

## Data access — Repo adapter rule
All reads/writes go through `getRepo()` (`lib/repo/index.ts`), which returns a `Repo` interface
implementation. Never import `lib/repo/local.ts` or `node:fs` directly from a client component —
`Repo` must stay adapter-agnostic (LocalRepo now, SupabaseRepo in phase 1b).
- `LocalRepo` (`lib/repo/local.ts`): JSON file `.data/db.json` (gitignored), serialized through an
  in-process mutex, atomic writes (temp file + rename), seeded from `lib/seed.ts` on first read.
- Mutations happen via Server Actions in `app/actions/*.ts` (zod-validated input, `revalidatePath`
  after writes — see `app/actions/revalidate.ts`).
- Pure logic (D-day math, kanban reorder, share parsing, project grouping) lives in `lib/logic/*.ts`
  with matching `*.test.ts`. Keep these framework-free so they stay easy to unit test.

## Phase status
- **1a (done)**: LocalRepo, seed data, all screens (홈/인박스/프로젝트/논문/마감/공유), PWA manifest,
  logic + tests, dark mode, mobile bottom nav + desktop sidebar.
- **1b (next)**: Supabase migration + SupabaseRepo, magic-link auth, Vercel deploy, cron heartbeat.
- **2**: Collector script (git/memory/trading status → `/api/ingest`), note→project inbox dispatch.
- **3**: Google Calendar, Telegram bot, Gmail review-deadline extraction, Obsidian sync.

## Conventions
- Opus plans (`docs/PLAN.md`), Sonnet implements. Don't redesign a plan's data model/signatures
  silently — flag mismatches instead of quietly deviating.
- Dates are `'YYYY-MM-DD'` strings in Asia/Seoul; use `lib/logic/dates.ts` helpers, never raw
  `Date` arithmetic, to avoid UTC/KST off-by-one.
