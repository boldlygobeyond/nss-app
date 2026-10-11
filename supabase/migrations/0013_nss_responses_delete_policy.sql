-- A respondent can use Back to return to an already-answered question and
-- choose again. The client replaces the prior response (delete, then
-- re-insert) rather than leaving both as independent, contradictory data
-- points — so the final answer is the one that counts, and so the
-- correction doesn't spend an extra slot from the fixed 50-question budget.
--
-- nss_responses had SELECT and INSERT policies (0001_init_schema.sql) but
-- no DELETE policy. With RLS enabled and no matching policy, the delete
-- silently affects zero rows under the authenticated client — no error, it
-- just does nothing — which is exactly the failure mode that motivated this
-- migration: the correction's delete-then-insert looked like it worked
-- (no error surfaced) but left both the original and corrected answer in
-- place, double-counting a trade-off the respondent explicitly changed
-- their mind on.
create policy "nss_responses_delete_via_submission" on public.nss_responses
  for delete using (
    exists (
      select 1 from public.nss_submissions s
      where s.id = submission_id and s.user_id = auth.uid()
    )
  );
