-- Kindred initial schema. Run once in a NEW Supabase project's SQL editor.
-- Region controls discovery, not confidentiality. All community content requires sign-in.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 40),
  region text not null check (region in ('India','United Kingdom','United States','Canada','Australia','Europe','Other')),
  bio text not null default '' check (char_length(bio) <= 500),
  created_at timestamptz not null default now()
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  topic text not null check (topic in ('Everyday life','Anxiety','Feeling low','Relationships','Work & study','Small wins')),
  mood text not null check (mood in ('Hopeful','Okay','Low','Anxious','Overwhelmed')),
  scope text not null check (scope in ('global','regional')),
  region text check (region in ('India','United Kingdom','United States','Canada','Australia','Europe','Other')),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check ((scope = 'global' and region is null) or (scope = 'regional' and region is not null))
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table public.supports (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (post_id,user_id)
);
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id,blocked_id), check (blocker_id <> blocked_id)
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);
create unique index conversations_pair on public.conversations (least(requester_id,recipient_id),greatest(requester_id,recipient_id));
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 100),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','reviewed')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id,message_id) = 1)
);
-- Roles and rate counters are never exposed through the Data API.
create table private.moderators (user_id uuid primary key references auth.users(id) on delete cascade);
create table private.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null, window_start timestamptz not null, amount integer not null,
  primary key (user_id, action)
);
alter table private.moderators enable row level security;
alter table private.rate_limits enable row level security;

create index posts_feed on public.posts (created_at desc);
create index posts_region on public.posts (region, created_at desc) where scope = 'regional';
create index posts_author on public.posts (author_id, created_at desc);
create index comments_post on public.comments (post_id, created_at);
create index comments_author on public.comments (author_id);
create index supports_user on public.supports (user_id);
create index blocks_reverse on public.blocks (blocked_id,blocker_id);
create index conversations_requester on public.conversations (requester_id);
create index conversations_recipient on public.conversations (recipient_id);
create index messages_conversation on public.messages (conversation_id,created_at);
create index messages_sender on public.messages (sender_id);
create index reports_reporter on public.reports (reporter_id);
create index reports_post on public.reports (post_id);
create index reports_message on public.reports (message_id);
create index reports_queue on public.reports (status,created_at);

-- These helpers are outside exposed schemas and have pinned search paths.
-- They bypass recursive RLS only for checks tied to the authenticated caller.
create function private.blocked(other_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is null or exists (
    select 1 from public.blocks b where
    (b.blocker_id = auth.uid() and b.blocked_id = other_user) or
    (b.blocked_id = auth.uid() and b.blocker_id = other_user)
  );
$$;
create function private.post_visible(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.posts p where p.id = target and not p.hidden and not private.blocked(p.author_id)
  );
$$;
create function private.conversation_visible(target uuid, must_accept boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.conversations c where c.id = target
      and auth.uid() in (c.requester_id,c.recipient_id)
      and (not must_accept or c.status = 'accepted')
      and not private.blocked(case when c.requester_id = auth.uid() then c.recipient_id else c.requester_id end)
  );
$$;
create function private.is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from private.moderators where user_id = auth.uid());
$$;

-- A single row per user/action is locked by ON CONFLICT: concurrent writes cannot
-- bypass the limit. Counters stay bounded rather than accumulating forever.
create function private.limit_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare current_amount integer; max_amount integer; actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  max_amount := case tg_table_name when 'posts' then 5 when 'comments' then 20
    when 'conversations' then 5 when 'messages' then 40 when 'reports' then 10 else 30 end;
  insert into private.rate_limits as r (user_id,action,window_start,amount)
  values (actor,tg_table_name,clock_timestamp(),1)
  on conflict (user_id,action) do update set
    amount = case when r.window_start < clock_timestamp() - interval '1 minute' then 1 else r.amount + 1 end,
    window_start = case when r.window_start < clock_timestamp() - interval '1 minute' then clock_timestamp() else r.window_start end
  returning amount into current_amount;
  if current_amount > max_amount then raise exception 'Please slow down and try again in a minute' using errcode = 'P0001'; end if;
  return new;
end;
$$;
create function private.guard_conversation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.requester_id is distinct from new.requester_id or old.recipient_id is distinct from new.recipient_id
     or old.id is distinct from new.id or old.created_at is distinct from new.created_at
     or old.status <> 'pending' or new.status not in ('accepted','declined')
     or auth.uid() is distinct from old.recipient_id then
    raise exception 'Only the recipient can respond to a pending request' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger conversation_response before update on public.conversations for each row execute function private.guard_conversation();
create trigger posts_rate before insert on public.posts for each row execute function private.limit_write();
create trigger comments_rate before insert on public.comments for each row execute function private.limit_write();
create trigger conversations_rate before insert on public.conversations for each row execute function private.limit_write();
create trigger messages_rate before insert on public.messages for each row execute function private.limit_write();
create trigger reports_rate before insert on public.reports for each row execute function private.limit_write();
create trigger supports_rate before insert on public.supports for each row execute function private.limit_write();
create trigger blocks_rate before insert on public.blocks for each row execute function private.limit_write();

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.supports enable row level security;
alter table public.blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;

create policy profiles_read on public.profiles for select to authenticated using ((select auth.uid()) is not null);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy posts_read on public.posts for select to authenticated using (not hidden and not private.blocked(author_id));
create policy posts_insert on public.posts for insert to authenticated with check (author_id = (select auth.uid()) and not hidden);
create policy posts_delete on public.posts for delete to authenticated using (author_id = (select auth.uid()));
create policy comments_read on public.comments for select to authenticated using (private.post_visible(post_id) and not private.blocked(author_id));
create policy comments_insert on public.comments for insert to authenticated with check (author_id = (select auth.uid()) and private.post_visible(post_id));
create policy comments_delete on public.comments for delete to authenticated using (author_id = (select auth.uid()));
create policy supports_read on public.supports for select to authenticated using (private.post_visible(post_id) and not private.blocked(user_id));
create policy supports_insert on public.supports for insert to authenticated with check (user_id = (select auth.uid()) and private.post_visible(post_id));
create policy supports_delete on public.supports for delete to authenticated using (user_id = (select auth.uid()));
create policy blocks_read on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy blocks_insert on public.blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy blocks_delete on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));
create policy conversations_read on public.conversations for select to authenticated using (private.conversation_visible(id));
create policy conversations_insert on public.conversations for insert to authenticated with check (requester_id = (select auth.uid()) and status = 'pending' and not private.blocked(recipient_id));
create policy conversations_update on public.conversations for update to authenticated using (recipient_id = (select auth.uid()) and status = 'pending' and private.conversation_visible(id)) with check (recipient_id = (select auth.uid()) and status in ('accepted','declined') and not private.blocked(requester_id));
create policy messages_read on public.messages for select to authenticated using (private.conversation_visible(conversation_id,true));
create policy messages_insert on public.messages for insert to authenticated with check (sender_id = (select auth.uid()) and private.conversation_visible(conversation_id,true));
create policy reports_read on public.reports for select to authenticated using (reporter_id = (select auth.uid()) or private.is_moderator());
create policy reports_insert on public.reports for insert to authenticated with check (
  reporter_id = (select auth.uid()) and status = 'open' and
  ((post_id is not null and private.post_visible(post_id)) or
   (message_id is not null and exists (select 1 from public.messages m where m.id = message_id)))
);

-- Revoke Supabase default grants, then expose only intended operations/columns.
revoke all on public.profiles,public.posts,public.comments,public.supports,public.blocks,public.conversations,public.messages,public.reports from anon,authenticated;
grant select on public.profiles,public.posts,public.comments,public.supports,public.blocks,public.conversations,public.messages,public.reports to authenticated;
grant insert (id,nickname,region,bio) on public.profiles to authenticated;
-- Upsert includes the conflict key; RLS still pins id to the caller.
grant update (id,nickname,region,bio) on public.profiles to authenticated;
grant insert (author_id,body,topic,mood,scope,region) on public.posts to authenticated;
grant insert (post_id,author_id,body) on public.comments to authenticated;
grant insert (post_id,user_id) on public.supports to authenticated;
grant insert (blocker_id,blocked_id) on public.blocks to authenticated;
grant insert (requester_id,recipient_id,status) on public.conversations to authenticated;
grant update (status) on public.conversations to authenticated;
grant insert (conversation_id,sender_id,body) on public.messages to authenticated;
grant insert (reporter_id,post_id,message_id,reason,details) on public.reports to authenticated;
grant delete on public.posts,public.comments,public.supports,public.blocks to authenticated;

create function public.is_moderator() returns boolean language sql stable security invoker set search_path = '' as $$ select private.is_moderator(); $$;
create function private.review_report(report_id uuid, remove_post boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare target_post uuid;
begin
  if not private.is_moderator() then raise exception 'Moderator access required' using errcode = '42501'; end if;
  select post_id into target_post from public.reports where id = report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if remove_post and target_post is not null then update public.posts set hidden = true where id = target_post; end if;
  update public.reports set status = 'reviewed' where id = report_id;
end;
$$;
create function public.review_report(report_id uuid, remove_post boolean) returns void
language sql security invoker set search_path = '' as $$ select private.review_report(report_id,remove_post); $$;

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.blocked(uuid),private.post_visible(uuid),private.conversation_visible(uuid,boolean),private.is_moderator(),private.review_report(uuid,boolean) to authenticated;
revoke all on function public.is_moderator(),public.review_report(uuid,boolean) from public,anon;
grant execute on function public.is_moderator(),public.review_report(uuid,boolean) to authenticated;
-- Add moderators only through trusted SQL: insert into private.moderators(user_id) values ('USER_UUID');
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

commit;
