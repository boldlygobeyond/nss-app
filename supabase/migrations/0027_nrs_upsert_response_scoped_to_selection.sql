-- Now that a cluster can have up to 30 scenarios while a team is only ever
-- asked its own saved 10 (nrs_team_cluster_scenarios, 0025), the old
-- "question belongs to this submission's cluster" check is no longer
-- enough — it would still accept a write for one of the cluster's other
-- 20 unselected scenarios. Replaces that check with "question is in this
-- submission's team's saved selection for this cluster." Everything else
-- about the function is unchanged from 0024.
create or replace function public.upsert_nrs_response(
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

  if exists (
    select 1 from public.nrs_submissions
    where id = p_submission_id and status = 'completed'
  ) then
    raise exception 'submission already completed';
  end if;

  if not exists (
    select 1
    from public.nrs_submissions s
    join public.team_roster r on r.id = s.roster_id
    join public.nrs_team_cluster_scenarios sel on sel.team_id = r.team_id and sel.cluster_key = s.cluster_key
    where s.id = p_submission_id and p_question_id = any (sel.question_ids)
  ) then
    raise exception 'question % is not part of this team''s selected scenarios', p_question_id;
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
