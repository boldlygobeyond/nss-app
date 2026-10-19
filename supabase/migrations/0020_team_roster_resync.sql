-- The actual spreadsheet file (not just its parent folder, already captured
-- in 0019) — needed so "resync" can re-fetch the live sheet later without
-- making the admin pick it again.
alter table public.teams add column drive_spreadsheet_id text;

-- Set on a roster row when the most recent resync no longer found that
-- email in the sheet. Never auto-deleted — an admin might have already
-- invited that person (a real account independent of this row), so the
-- row just gets flagged for a human to look at rather than silently
-- vanishing.
alter table public.team_roster add column missing_from_sheet boolean not null default false;
