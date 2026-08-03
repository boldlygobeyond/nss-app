-- Manager hierarchy support — lets a manager see nss_submissions belonging to
-- their full recursive downline (direct reports, their reports, etc.),
-- mirroring Base44's getSubordinateEmails helper but enforced at the RLS
-- layer instead of a service-role bypass in application code.

-- Drop first: CREATE OR REPLACE can't change a function's return type, and
-- an earlier failed run of this migration may have already created this
-- function with the old `returns setof text` signature.
drop function if exists public.get_subordinate_emails(text);

create function public.get_subordinate_emails(root_email text)
returns table(email text)
language sql
security definer
stable
set search_path = public
as $$
  with recursive downline as (
    select up.email, array[lower(trim(up.email))] as visited
    from public.user_profiles up
    where lower(trim(up.manager_email)) = lower(trim(root_email))

    union all

    select up.email, d.visited || lower(trim(up.email))
    from public.user_profiles up
    join downline d on lower(trim(up.manager_email)) = lower(trim(d.email))
    where not (lower(trim(up.email)) = any(d.visited))
  )
  select downline.email from downline;
$$;

-- A manager can read (but not write) submissions belonging to anyone in
-- their recursive downline. Ownership-based read/write policies from
-- 0001_init_schema.sql are unaffected — this is purely additive.
create policy "nss_submissions_select_via_manager_chain" on public.nss_submissions
  for select using (
    lower(trim(user_email)) in (
      select lower(trim(email))
      from public.get_subordinate_emails(auth.jwt() ->> 'email')
    )
  );
