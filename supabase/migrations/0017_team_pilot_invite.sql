-- Team/pilot invites (e.g. the WI LGBT Chamber of Commerce pilot) reuse the
-- same account-creation trigger the public lead-signup flow already relies
-- on, just with two more optional metadata keys. Neither key is ever set by
-- the existing lead-signup path, so this is a no-op there — every existing
-- signup keeps inserting team = null, manager_email = null exactly as
-- before.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, first_name, last_name, lead_source, team, manager_email)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'lead_source',
    new.raw_user_meta_data ->> 'team',
    new.raw_user_meta_data ->> 'manager_email'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Denormalized onto the submission at creation time, same reasoning as the
-- existing user_email/respondent_name columns: every downstream check
-- (CRM suppression, admin filtering) reads this one column instead of
-- joining back to user_profiles every time.
alter table public.nss_submissions add column team text;
