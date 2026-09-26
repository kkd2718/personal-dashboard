-- Phase 3 Addendum A: 'revision' review-candidate kind (editorial decision letters
-- asking for major/minor revision, forwarded from the amc account). Additive,
-- idempotent: safe to re-run (scripts/migrate.mjs also tracks applied files).

alter table review_candidates add column if not exists revision_type text;
