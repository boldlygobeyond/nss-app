-- NSS (Needs Signal Survey) core schema.
-- Ported from the Base44 entities (User, User_Profiles, SurveyResult) plus a
-- normalized nss_questions/nss_responses split (Base44 stored per-question
-- answers as a JSON blob on SurveyResult; here they're their own table).

create extension if not exists "pgcrypto";

-- ── user_profiles ────────────────────────────────────────────────────────────
-- One row per app user, keyed to auth.users. Mirrors Base44's User + User_Profiles.

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  first_name text,
  last_name text,
  manager_email text,
  company text,
  team text,
  role text not null default 'user' check (role in ('user', 'admin')),
  nrs_enabled boolean not null default false,
  nss_enabled boolean not null default true,
  is_genome_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_profiles_manager_email_idx on public.user_profiles (manager_email);

-- ── nss_questions ─────────────────────────────────────────────────────────────
-- The 50-question bank. Each question has a standard A/B version and a
-- "sharpened" A/B follow-up, and maps to two of the seven need clusters.

create table public.nss_questions (
  id smallint primary key,
  topic text not null,
  cluster_a text not null check (
    cluster_a in ('Agency', 'Belonging', 'Stability', 'Ecosystem', 'Connections', 'Purpose', 'Recognition')
  ),
  cluster_b text not null check (
    cluster_b in ('Agency', 'Belonging', 'Stability', 'Ecosystem', 'Connections', 'Purpose', 'Recognition')
  ),
  standard_question text not null,
  standard_option_a text not null,
  standard_option_b text not null,
  sharpened_question text not null,
  sharpened_option_a text not null,
  sharpened_option_b text not null
);

-- ── nss_submissions ───────────────────────────────────────────────────────────
-- One row per survey attempt. Mirrors Base44's SurveyResult entity.

create table public.nss_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  user_email text,
  respondent_name text not null,
  pronouns text,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed', 'report_generated')
  ),
  win_loss_tally jsonb not null default '{}'::jsonb,
  question_sequence smallint[] not null default '{}',
  questions_answered integer not null default 0,
  top_needs jsonb,
  scores jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nss_submissions_user_id_idx on public.nss_submissions (user_id);
create index nss_submissions_status_idx on public.nss_submissions (status);

-- ── nss_responses ─────────────────────────────────────────────────────────────
-- One row per answered question. Normalized out of Base44's
-- answered_questions_details JSON array for queryability.

create table public.nss_responses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.nss_submissions (id) on delete cascade,
  question_id smallint not null references public.nss_questions (id),
  original_question_id smallint references public.nss_questions (id),
  is_sharpened boolean not null default false,
  selection text not null check (selection in ('A', 'B')),
  chosen_clusters text[] not null,
  rejected_clusters text[] not null,
  answered_at timestamptz not null default now()
);

create index nss_responses_submission_id_idx on public.nss_responses (submission_id);

-- ── updated_at triggers ───────────────────────────────────────────────────────

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

create trigger set_updated_at
  before update on public.nss_submissions
  for each row execute function public.set_updated_at();

-- ── auto-create profile on signup ─────────────────────────────────────────────

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, first_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── row level security ────────────────────────────────────────────────────────

alter table public.user_profiles enable row level security;
alter table public.nss_questions enable row level security;
alter table public.nss_submissions enable row level security;
alter table public.nss_responses enable row level security;

-- SECURITY DEFINER helper so admin-check policies don't recurse into their own table's RLS.
create function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- user_profiles: read/update own row; admins can read/update everyone.
create policy "user_profiles_select_own_or_admin" on public.user_profiles
  for select using (auth.uid() = id or public.is_admin());

create policy "user_profiles_update_own_or_admin" on public.user_profiles
  for update using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- nss_questions: readable by any authenticated user, no client writes.
create policy "nss_questions_select_authenticated" on public.nss_questions
  for select to authenticated using (true);

-- nss_submissions: owner can read/write their own; admins can read all.
create policy "nss_submissions_select_own_or_admin" on public.nss_submissions
  for select using (auth.uid() = user_id or public.is_admin());

create policy "nss_submissions_insert_own" on public.nss_submissions
  for insert with check (auth.uid() = user_id);

create policy "nss_submissions_update_own" on public.nss_submissions
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- nss_responses: access follows the parent submission's ownership.
create policy "nss_responses_select_via_submission" on public.nss_responses
  for select using (
    exists (
      select 1 from public.nss_submissions s
      where s.id = submission_id and (s.user_id = auth.uid() or public.is_admin())
    )
  );

create policy "nss_responses_insert_via_submission" on public.nss_responses
  for insert with check (
    exists (
      select 1 from public.nss_submissions s
      where s.id = submission_id and s.user_id = auth.uid()
    )
  );
