-- Apply after schema.sql, profile-trigger.sql and moderation-evidence.sql.
-- Additive and repeatable: no table rewrites, permission broadening or caches.
begin;

-- Match the repository's deterministic (created_at,id) ordering. The visible
-- partial predicates also match RLS and keep hidden content out of hot indexes.
create index if not exists posts_feed_page
  on public.posts (created_at desc,id desc) where not hidden;
create index if not exists posts_region_page
  on public.posts (region,created_at desc,id desc) where not hidden and scope = 'regional';
create index if not exists messages_conversation_page
  on public.messages (conversation_id,created_at desc,id desc) where not hidden;
create index if not exists reports_queue_page
  on public.reports (status,created_at desc,id desc);

-- Moderator membership is independent of the report row. An initplan evaluates
-- it once per statement instead of checking the role table for every report.
alter policy reports_read on public.reports
  using (reporter_id = (select auth.uid()) or (select private.is_moderator()));

commit;
