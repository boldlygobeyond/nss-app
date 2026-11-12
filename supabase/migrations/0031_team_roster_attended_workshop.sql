-- Launch prerequisite for the pilot: a team member must have attended
-- "See the Signals" (the workshop/training) before they're eligible for
-- any NSS or NRS invite send, real or resend. Nullable timestamp, not a
-- plain boolean, so it reads consistently with invited_at/completed_at
-- elsewhere on this table — checked = now(), unchecked = null. Defaults
-- to null (not attended) so every existing roster row starts ineligible,
-- which is the safe default until each person is confirmed.
alter table public.team_roster
  add column attended_see_the_signals_at timestamptz;
