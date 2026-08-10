-- The landing page's lead-capture modal collects a last name too (the
-- existing /login magic-link flow never did), so handle_new_user() needs
-- to read it off signup metadata alongside first_name and lead_source.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, first_name, last_name, lead_source)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'lead_source'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
