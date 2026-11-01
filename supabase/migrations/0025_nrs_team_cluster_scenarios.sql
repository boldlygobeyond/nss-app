-- NRS scenario selection: lets an admin choose which 10 of a cluster's 30
-- scenarios a given team's participants are asked (0026 imports the full
-- 210-scenario bank this selects from). One row per (team, cluster) — the
-- team's current selection for that cluster, never a second "catalog" of
-- selections to keep in sync.
--
-- Locking is deliberately NOT a stored column here. "Has this team/cluster
-- already sent an invitation" is fully derivable from whether any
-- nrs_submissions row exists for that team+cluster (submissions are only
-- ever created by the invite-sending flow), so that's the single source of
-- truth the application layer checks — a separate locked_at flag could
-- drift out of sync with the thing it's supposed to describe.
create table public.nrs_team_cluster_scenarios (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  cluster_key text not null references public.nrs_clusters (cluster_key),
  question_ids smallint[] not null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, cluster_key),
  check (array_length(question_ids, 1) = 10)
);

create index nrs_team_cluster_scenarios_team_id_idx on public.nrs_team_cluster_scenarios (team_id);

create trigger set_updated_at
  before update on public.nrs_team_cluster_scenarios
  for each row execute function public.set_updated_at();

-- The array-length check above only catches the wrong *count*. This
-- catches the two things a count check can't: duplicate ids within the
-- array, and an id that doesn't actually belong to this row's cluster_key
-- (e.g. a stray Belonging scenario id saved onto a Stability selection).
-- Both are checked here rather than left to the admin API route alone, so
-- the invariant holds even against a future route that forgets to.
create function public.validate_nrs_team_cluster_scenarios()
returns trigger
language plpgsql
as $$
declare
  distinct_count int;
  mismatched_count int;
begin
  select count(distinct x) into distinct_count from unnest(new.question_ids) as x;
  if distinct_count <> 10 then
    raise exception 'question_ids must contain exactly 10 distinct values';
  end if;

  select count(*) into mismatched_count
  from unnest(new.question_ids) as qid
  left join public.nrs_questions q on q.id = qid and q.cluster_key = new.cluster_key
  where q.id is null;
  if mismatched_count > 0 then
    raise exception 'all question_ids must belong to cluster %', new.cluster_key;
  end if;

  return new;
end;
$$;

create trigger validate_nrs_team_cluster_scenarios_trigger
  before insert or update on public.nrs_team_cluster_scenarios
  for each row execute function public.validate_nrs_team_cluster_scenarios();

alter table public.nrs_team_cluster_scenarios enable row level security;

-- Admin-only, same model as nrs_submissions/nrs_responses — an admin
-- session is the only way this table is ever written (see
-- src/app/api/nrs/team-scenarios/route.ts), and the only way it's ever
-- read (the participant-facing routes resolve a team's selected question
-- ids via the service-role client, same as every other participant-facing
-- NRS read).
create policy "nrs_team_cluster_scenarios_admin_only" on public.nrs_team_cluster_scenarios
  for all using (public.is_admin()) with check (public.is_admin());
