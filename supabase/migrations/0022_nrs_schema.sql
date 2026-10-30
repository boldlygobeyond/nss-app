-- Needs Resonance Scan (NRS) — a sibling diagnostic to NSS, not a
-- replacement or a parallel participant system. It reuses team_roster as
-- the sole source of who's eligible (see nrs_submissions below); its own
-- tables hold only NRS-specific invitation/response/scoring state, kept
-- fully separate from nss_submissions/nss_responses.

-- ── nrs_clusters ──────────────────────────────────────────────────────────
-- One row per the 7 ClusterKey values already defined in
-- src/lib/nss/clusters.ts (CLUSTERS/CLUSTER_LABELS) — referenced here only
-- by string value, never by a DB FK into any NSS table. `configured` lets
-- the admin cluster selector list all 7 while only Core Stability
-- actually has seeded questions (see 0023).
create table public.nrs_clusters (
  cluster_key text primary key check (
    cluster_key in ('Agency', 'Belonging', 'Stability', 'Ecosystem', 'Connections', 'Purpose', 'Recognition')
  ),
  name text not null,
  description text not null,
  configured boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── nrs_questions ─────────────────────────────────────────────────────────
-- The 10 scenarios per cluster. need_label is internal-only — the
-- participant-facing API (src/app/api/nrs/[token]/route.ts) never
-- includes it in what it returns to the browser; this is enforced at the
-- application layer, not by RLS, since RLS can't selectively hide one
-- column from a row a client can otherwise read.
create table public.nrs_questions (
  id smallint primary key,
  cluster_key text not null references public.nrs_clusters (cluster_key),
  display_order smallint not null,
  need_label text not null,
  scenario_text text not null,
  created_at timestamptz not null default now(),
  unique (cluster_key, display_order)
);

-- ── nrs_submissions ───────────────────────────────────────────────────────
-- One row per existing team_roster member per cluster. team_roster is the
-- required, single source of truth for NRS participants — there is no
-- separate NRS roster, and no participant name/email duplicated here.
-- Every read (admin table, email send, drill-down) resolves identity by
-- joining through roster_id to team_roster at that moment, so a roster
-- edit or resync is reflected in NRS automatically with nothing to go
-- stale. "Which team" is likewise derived via roster_id -> team_roster
-- .team_id (indexed by the existing team_roster_team_id_idx), not
-- denormalized here either.
--
-- on delete restrict (not cascade, not nullable): removing someone from
-- the roster is blocked while they have NRS history, rather than
-- silently deleting that history. The roster-removal route
-- (src/app/api/nss/teams/[slug]/roster/[rosterId]/route.ts) catches the
-- resulting 23503 FK-violation and turns it into a clear admin-facing
-- error instead of surfacing a raw DB error.
create table public.nrs_submissions (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.team_roster (id) on delete restrict,
  cluster_key text not null references public.nrs_clusters (cluster_key),
  access_token text not null unique,
  status text not null default 'invited' check (status in ('invited', 'in_progress', 'completed')),
  invited_at timestamptz not null default now(),
  last_reminder_at timestamptz,
  completed_at timestamptz,
  resonance_score numeric(3, 1),
  results_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The duplicate-submission guard: one NRS submission per team member
  -- per cluster, enforced at the DB level.
  unique (roster_id, cluster_key)
);

create index nrs_submissions_roster_id_idx on public.nrs_submissions (roster_id);
create index nrs_submissions_cluster_key_idx on public.nrs_submissions (cluster_key);

create trigger set_updated_at
  before update on public.nrs_submissions
  for each row execute function public.set_updated_at();

-- ── nrs_responses ─────────────────────────────────────────────────────────
-- One row per answered scenario. Unlike nss_responses, this table starts
-- empty with no historical dirty data to work around, so a plain unique
-- constraint (not a partial-index-plus-cutoff workaround) is correct —
-- upsert_nrs_response() (0024) does a real ON CONFLICT DO UPDATE against it.
create table public.nrs_responses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.nrs_submissions (id) on delete cascade,
  question_id smallint not null references public.nrs_questions (id),
  rating smallint not null check (rating between 1 and 5),
  answered_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create index nrs_responses_submission_id_idx on public.nrs_responses (submission_id);

-- ── nrs_send_log ──────────────────────────────────────────────────────────
-- Audit trail of every email send attempt (not just the latest touch) —
-- no equivalent exists in NSS today; designed fresh to satisfy "log all
-- email attempts and timestamps."
create table public.nrs_send_log (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.nrs_submissions (id) on delete cascade,
  email_type text not null check (email_type in ('invitation', 'reminder', 'results')),
  outcome text not null check (outcome in ('sent', 'mocked', 'failed')),
  error_message text,
  resend_message_id text,
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index nrs_send_log_submission_id_idx on public.nrs_send_log (submission_id, email_type);

-- ── row level security ────────────────────────────────────────────────────
alter table public.nrs_clusters enable row level security;
alter table public.nrs_questions enable row level security;
alter table public.nrs_submissions enable row level security;
alter table public.nrs_responses enable row level security;
alter table public.nrs_send_log enable row level security;

-- Content tables: readable by any authenticated user, no client writes —
-- same model as nss_questions. Content is migration-managed only.
create policy "nrs_clusters_select_authenticated" on public.nrs_clusters
  for select to authenticated using (true);

create policy "nrs_questions_select_authenticated" on public.nrs_questions
  for select to authenticated using (true);

-- nrs_submissions / nrs_responses / nrs_send_log: admin-only, same model
-- as teams/team_roster. Deliberately no owner-or-admin policy here (unlike
-- nss_submissions) — an NRS participant never gets a Supabase session at
-- all (see access_token above), so auth.uid() is always null for them;
-- every participant-facing read/write instead goes through a token-gated
-- API route using the service-role client, which performs its own
-- explicit token-equality check in application code. RLS here exists to
-- keep an ordinary authenticated-but-non-admin user (e.g. any NSS
-- respondent with an account) from reading another participant's NRS
-- data directly, not to grant participant access.
create policy "nrs_submissions_admin_only" on public.nrs_submissions
  for all using (public.is_admin()) with check (public.is_admin());

create policy "nrs_responses_admin_only" on public.nrs_responses
  for all using (public.is_admin()) with check (public.is_admin());

create policy "nrs_send_log_admin_only" on public.nrs_send_log
  for all using (public.is_admin()) with check (public.is_admin());
