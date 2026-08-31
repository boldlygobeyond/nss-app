-- The manager dashboard shows respondent_name (first name only, per the
-- survey's own "what's your first name" prompt) — showing full names means
-- reading last_name off user_profiles too. A non-admin manager can't do
-- that with a plain filtered select (user_profiles RLS is "own row or
-- admin" only, same gap fixed for is_manager() in 0011), so this is a
-- dedicated security-definer read scoped to exactly what the dashboard
-- needs, kept separate from get_subordinate_emails (0005) so the
-- RLS-critical function that powers nss_submissions access stays untouched.

create function public.get_team_profiles(root_email text)
returns table(email text, first_name text, last_name text)
language sql
security definer
stable
set search_path = public
as $$
  with recursive downline as (
    select up.email, up.first_name, up.last_name, array[lower(trim(up.email))] as visited
    from public.user_profiles up
    where lower(trim(up.manager_email)) = lower(trim(root_email))

    union all

    select up.email, up.first_name, up.last_name, d.visited || lower(trim(up.email))
    from public.user_profiles up
    join downline d on lower(trim(up.manager_email)) = lower(trim(d.email))
    where not (lower(trim(up.email)) = any(d.visited))
  )
  select downline.email, downline.first_name, downline.last_name from downline;
$$;
