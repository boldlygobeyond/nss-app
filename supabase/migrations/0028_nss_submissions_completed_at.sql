-- nss_submissions.updated_at isn't trustworthy as "when they took the
-- survey" — it bumps on every write to the row, including PDF caching,
-- Drive archival, download-link clicks, and report regeneration, any of
-- which can happen days or weeks after the respondent actually finished.
-- Several admin views already worked around this by computing
-- max(answered_at) from nss_responses client-side on every load; this adds
-- a real column instead, set once at the moment of actual completion and
-- never touched again — same pattern nrs_submissions.completed_at already
-- uses.
alter table public.nss_submissions add column completed_at timestamptz;

-- Backfill every already-completed submission from its own response
-- history — the exact computation the admin pages were already doing
-- client-side, just done once here instead of on every page load.
update public.nss_submissions s
set completed_at = r.last_answered_at
from (
  select submission_id, max(answered_at) as last_answered_at
  from public.nss_responses
  group by submission_id
) r
where r.submission_id = s.id
  and s.status in ('completed', 'report_generated')
  and s.completed_at is null;
