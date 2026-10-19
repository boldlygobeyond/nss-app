-- Team workspace: a real "team" entity (so an admin has something to list
-- and click into), plus a roster staging table. A person can't get a real
-- user_profiles row until they've actually clicked an invite link (that
-- row is FK'd to auth.users, which only exists post-signup) — but a
-- spreadsheet upload needs to land *before* anyone's been invited. Rows
-- here hold that gap: loaded from the sheet, displayed in the roster tab,
-- and used to drive each invite send. Once someone's actually invited and
-- logs in, they get a real user_profiles row (team/manager_email copied in
-- by the existing handle_new_user trigger from 0017) independent of this
-- table, which just keeps tracking invited_at for display.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.team_roster (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  manager_email text not null,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  unique (team_id, email)
);

create index team_roster_team_id_idx on public.team_roster (team_id);

alter table public.teams enable row level security;
alter table public.team_roster enable row level security;

create policy "teams_admin_only" on public.teams
  for all using (public.is_admin()) with check (public.is_admin());

create policy "team_roster_admin_only" on public.team_roster
  for all using (public.is_admin()) with check (public.is_admin());
