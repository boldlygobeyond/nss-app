-- First-touch lead source attribution — captured from a `?source=` query
-- param on the /login link the person clicked, passed through as signup
-- metadata (not the redirect URL, which must match Supabase's configured
-- allow-list and shouldn't be mutated per-request) and read by
-- handle_new_user() at account-creation time only, giving first-touch
-- semantics for free — the trigger never fires again for that person.

alter table public.user_profiles
  add column if not exists lead_source text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, first_name, lead_source)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'lead_source'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
