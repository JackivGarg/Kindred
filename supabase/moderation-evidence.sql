-- Run after schema.sql. Safe to reapply to existing installations.
-- Moderators receive only the exact content a participant reported, never inbox access.
begin;
alter table public.reports add column if not exists evidence text not null default '';
alter table public.messages add column if not exists hidden boolean not null default false;

-- Read the policy's row directly: a STABLE helper that re-queries this table
-- cannot see a newly inserted row during INSERT ... RETURNING.
drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated
using (
  (select auth.uid()) in (requester_id,recipient_id)
  and not private.blocked(case when requester_id = (select auth.uid()) then recipient_id else requester_id end)
);

create or replace function private.capture_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare captured text;
begin
  if auth.uid() is null or new.reporter_id is distinct from auth.uid() then
    raise exception 'You can only submit your own reports' using errcode = '42501';
  end if;
  if num_nonnulls(new.post_id,new.message_id) <> 1 then
    raise exception 'Choose exactly one report target' using errcode = '23514';
  end if;
  if new.post_id is not null then
    if not private.post_visible(new.post_id) then
      raise exception 'This post is unavailable to report' using errcode = '42501';
    end if;
    select p.body into captured from public.posts p where p.id = new.post_id and not p.hidden;
  else
    select m.body into captured from public.messages m
      where m.id = new.message_id and not m.hidden
        and private.conversation_visible(m.conversation_id,true);
  end if;
  if captured is null then
    raise exception 'This content is unavailable to report' using errcode = '42501';
  end if;
  -- Always overwrite any supplied value; the database alone supplies evidence.
  new.evidence := captured;
  return new;
end;
$$;
revoke all on function private.capture_report() from public,anon,authenticated;
drop trigger if exists capture_report_evidence on public.reports;
create trigger capture_report_evidence before insert on public.reports
for each row execute function private.capture_report();

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
using (not hidden and private.conversation_visible(conversation_id,true));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
with check (not hidden and sender_id = (select auth.uid()) and private.conversation_visible(conversation_id,true));

create or replace function private.review_report(report_id uuid, remove_post boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare target_post uuid; target_message uuid;
begin
  if not private.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  select post_id,message_id into target_post,target_message
    from public.reports where id = report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if remove_post then
    if target_post is not null then
      update public.posts set hidden = true where id = target_post;
    elsif target_message is not null then
      update public.messages set hidden = true where id = target_message;
    end if;
  end if;
  update public.reports set status = 'reviewed' where id = report_id;
end;
$$;
revoke all on function private.review_report(uuid,boolean) from public,anon;
grant execute on function private.review_report(uuid,boolean) to authenticated;
-- Existing column-specific INSERT grants deliberately omit evidence and hidden.
-- Existing report SELECT RLS remains reporter-or-moderator only.
commit;
