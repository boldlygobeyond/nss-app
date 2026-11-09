-- nrs_questions currently grants select to any authenticated user
-- ("to authenticated using (true)", set in 0022), including need_label —
-- the internal need name behind each scenario, meant to stay invisible to
-- participants. The app layer already never returns need_label to a
-- participant (the token-gated /api/nrs/[token] route excludes it and
-- reads via the service-role client, which bypasses RLS entirely), but
-- nothing stops any OTHER authenticated user (e.g. an ordinary NSS
-- respondent with a normal account) from querying nrs_questions directly
-- with their own session and getting need_label for every configured
-- cluster. RLS can't hide one column on an otherwise-readable row — the
-- real fix is to require admin for the whole table, matching the model
-- already used for nrs_submissions/nrs_responses/nrs_send_log in 0022.
--
-- Safe: every current caller of this table (the three admin-only UI
-- components in src/components/admin/nrs/ and
-- src/app/admin/teams/[slug]/nrs/.../page.tsx) is already rendered only
-- behind an admin-role page gate, so is_admin() evaluates true for all of
-- them exactly as `true` did. No participant-facing code reads this table
-- via the plain (session) client — the one route that serves
-- participants reads it through the admin/service-role client, which
-- isn't subject to RLS at all. No application code change required.
drop policy "nrs_questions_select_authenticated" on public.nrs_questions;

create policy "nrs_questions_select_admin" on public.nrs_questions
  for select to authenticated using (public.is_admin());
