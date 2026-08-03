-- Lets a user delete their own in-progress submission — needed so "start
-- from the beginning" on the Welcome page can actually discard an
-- abandoned attempt server-side, not just clear the local copy.

create policy "nss_submissions_delete_own" on public.nss_submissions
  for delete using (auth.uid() = user_id);
