-- Atomic, validated, ownership-checked per-scenario response write for
-- NRS. Modeled on upsert_nss_response (0021), with two differences that
-- follow directly from NRS having no participant session at all:
--   - ownership is checked against the submission's own access_token
--     (passed in by the token-gated API route, which already verified it
--     against the URL), not auth.uid()
--   - the table starts empty with no historical-duplicate problem to work
--     around, so this uses a real ON CONFLICT DO UPDATE instead of
--     0021's explicit delete-then-insert-under-partial-index approach
create function public.upsert_nrs_response(
  p_submission_id uuid,
  p_access_token text,
  p_question_id smallint,
  p_rating smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.nrs_submissions
    where id = p_submission_id and access_token = p_access_token
  ) then
    raise exception 'not authorized to write a response for this submission';
  end if;

  if p_rating < 1 or p_rating > 5 then
    raise exception 'invalid rating: %', p_rating;
  end if;

  -- A completed submission's answers are immutable from here on — this is
  -- the actual enforcement point for "never overwrite a completed
  -- assessment," not just a UI convention (the participant client never
  -- offers editing after submit, but this is what actually blocks it).
  if exists (
    select 1 from public.nrs_submissions
    where id = p_submission_id and status = 'completed'
  ) then
    raise exception 'submission already completed';
  end if;

  -- The existing nrs_questions FK on question_id already rejects a
  -- nonexistent question. This additionally confirms the question
  -- actually belongs to THIS submission's cluster, so a client can't
  -- write an answer for a different cluster's scenario onto this
  -- submission.
  if not exists (
    select 1
    from public.nrs_questions q
    join public.nrs_submissions s on s.cluster_key = q.cluster_key
    where q.id = p_question_id and s.id = p_submission_id
  ) then
    raise exception 'question % does not belong to this submission''s cluster', p_question_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_submission_id::text), p_question_id::int);

  insert into public.nrs_responses (submission_id, question_id, rating, answered_at)
  values (p_submission_id, p_question_id, p_rating, now())
  on conflict (submission_id, question_id)
  do update set rating = excluded.rating, answered_at = excluded.answered_at;

  update public.nrs_submissions
  set status = 'in_progress'
  where id = p_submission_id and status = 'invited';
end;
$$;

-- anon, not just authenticated: the participant calling this has no
-- Supabase session at all (see the NRS access-token design), so their
-- Postgres role is anon. The function's own token-equality check above
-- is what stands in for auth, the same way report-pdf-download's token
-- check stands in for auth on an unauthenticated route.
revoke execute on function public.upsert_nrs_response(uuid, text, smallint, smallint) from public;
grant execute on function public.upsert_nrs_response(uuid, text, smallint, smallint) to anon, authenticated;
