-- Apply after schema.sql for existing installations. Safe to reapply.
-- Signup metadata supplies display preferences only, never permissions or roles.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  display_name text;
  display_region text;
begin
  if jsonb_typeof(new.raw_user_meta_data -> 'nickname') = 'string' then
    display_name := left(btrim(new.raw_user_meta_data ->> 'nickname'),40);
  end if;
  if display_name is null or char_length(display_name) < 2 then
    display_name := 'New member';
  end if;
  if jsonb_typeof(new.raw_user_meta_data -> 'region') = 'string' then
    display_region := new.raw_user_meta_data ->> 'region';
  end if;
  if display_region is null or display_region not in ('India','United Kingdom','United States','Canada','Australia','Europe','Other') then
    display_region := 'Other';
  end if;
  insert into public.profiles(id,nickname,region,bio)
  values (new.id,display_name,display_region,'')
  on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public,anon,authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();
