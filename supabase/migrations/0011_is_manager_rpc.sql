-- isManager() (src/lib/nss/userProfiles.ts) queries user_profiles filtered
-- by manager_email, but the only SELECT policy on that table is "own row or
-- admin" (0001_init_schema.sql) — so for any real, non-admin manager this
-- check silently returned zero rows and always evaluated to false, even
-- with manager_email correctly set. The homepage never showed the Manager
-- Dashboard card for them as a result, even though the manager-chain
-- report access itself (get_subordinate_emails, already security definer)
-- worked fine — this was the one broken link. Same fix pattern as is_admin().

create function public.is_manager(check_email text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where lower(trim(manager_email)) = lower(trim(check_email))
  );
$$;
