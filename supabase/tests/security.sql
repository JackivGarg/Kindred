-- Run as postgres AFTER schema.sql against a disposable/local database.
-- Uses real authenticated/anon roles and JWT identity. Everything rolls back.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end;
$$;
create function pg_temp.expect_error(statement text, message text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin execute statement; exception when others then failed := true; end;
  if not failed then raise exception 'EXPECTED DENIAL: %',message; end if;
end;
$$;
insert into auth.users(id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003');
insert into public.profiles(id,nickname,region) values
 ('10000000-0000-0000-0000-000000000001','Alice','India'),
 ('10000000-0000-0000-0000-000000000002','Bob','Canada'),
 ('10000000-0000-0000-0000-000000000003','Cara','India')
on conflict(id) do update set nickname=excluded.nickname,region=excluded.region;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
insert into public.posts(id,author_id,body,topic,mood,scope,region) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A regional update','Everyday life','Okay','regional','India');
insert into public.conversations(id,requester_id,recipient_id) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');

set local role anon;
select pg_temp.expect_error('select * from public.posts','signed-out feed denied');
select pg_temp.expect_error('select * from public.messages','signed-out messages denied');
select pg_temp.expect_error('select public.is_moderator()','anonymous RPC denied');

set local role authenticated;
select pg_temp.assert_true((select count(*)=1 from public.posts),'signed-in regional content discoverable');
select pg_temp.expect_error($q$insert into public.posts(author_id,body,topic,mood,scope) values ('10000000-0000-0000-0000-000000000002','Spoof','Everyday life','Okay','global')$q$,'cannot impersonate post author');
select pg_temp.expect_error($q$insert into public.posts(author_id,body,topic,mood,scope,hidden) values ('10000000-0000-0000-0000-000000000001','Hidden spoof','Everyday life','Okay','global',true)$q$,'moderation flag cannot be client-written');
select pg_temp.expect_error($q$insert into public.messages(conversation_id,sender_id,body) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Before consent')$q$,'pending conversation cannot send');
update public.conversations set status='accepted' where id='30000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select status='pending' from public.conversations limit 1),'requester cannot accept own request');
select pg_temp.expect_error($q$update public.conversations set recipient_id='10000000-0000-0000-0000-000000000003'$q$,'participant identities immutable');
select pg_temp.expect_error($q$insert into private.moderators values ('10000000-0000-0000-0000-000000000001')$q$,'cannot self-promote moderator');
select pg_temp.expect_error($q$select public.review_report('40000000-0000-0000-0000-000000000001',true)$q$,'nonmoderator cannot review');
-- Profile upsert works but never grants access to another identity.
insert into public.profiles(id,nickname,region,bio) values ('10000000-0000-0000-0000-000000000001','Alice updated','India','Hello')
on conflict(id) do update set id=excluded.id,nickname=excluded.nickname,region=excluded.region,bio=excluded.bio;
select pg_temp.expect_error($q$update public.profiles set id='10000000-0000-0000-0000-000000000003' where id='10000000-0000-0000-0000-000000000001'$q$,'profile ownership pinned');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.conversations),'third party cannot read requests');
select pg_temp.expect_error($q$insert into public.messages(conversation_id,sender_id,body) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','Intrusion')$q$,'third party cannot send');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true((select count(*)=1 from public.posts),'different region can see regional posts');
update public.conversations set status='accepted' where id='30000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select status='accepted' from public.conversations limit 1),'recipient can accept');
insert into public.messages(conversation_id,sender_id,body) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Here to listen');
select pg_temp.expect_error($q$insert into public.messages(conversation_id,sender_id,body) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Impersonation')$q$,'message sender pinned');
insert into public.comments(post_id,author_id,body) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Listening');
insert into public.supports(post_id,user_id) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
insert into public.blocks(blocker_id,blocked_id) values ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
select pg_temp.assert_true((select count(*)=0 from public.posts),'block hides other author posts');
select pg_temp.assert_true((select count(*)=0 from public.comments),'block hides children of hidden posts');
select pg_temp.assert_true((select count(*)=0 from public.supports),'block hides support on hidden posts');
select pg_temp.assert_true((select count(*)=0 from public.messages),'block hides existing messages');
select pg_temp.expect_error($q$insert into public.comments(post_id,author_id,body) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Orphan')$q$,'cannot comment on blocked posts');
select pg_temp.expect_error($q$insert into public.messages(conversation_id,sender_id,body) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','After block')$q$,'cannot message after block');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true((select count(*)=0 from public.conversations),'block applies in reverse direction');
select pg_temp.assert_true((select count(*)=0 from public.messages),'reverse block hides messages');
select pg_temp.assert_true((select count(*)=0 from public.comments),'reverse block hides blocked commenter');
select pg_temp.expect_error($q$insert into public.conversations(requester_id,recipient_id) values ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')$q$,'reverse block prevents new request');
select pg_temp.assert_true((select count(*)=0 from public.blocks),'cannot inspect who blocked you');

-- A participant can report a message after unblocking, but outsiders cannot.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
delete from public.blocks;
insert into public.reports(reporter_id,message_id,reason) select '10000000-0000-0000-0000-000000000002',id,'Harassment' from public.messages;
select set_config('test.message_id',(select id::text from public.messages limit 1),true);
select pg_temp.assert_true((select count(*)=1 from public.reports),'participant message report accepted');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true((select count(*)=0 from public.messages),'third party cannot read accepted messages');
select pg_temp.assert_true((select count(*)=0 from public.reports),'third party cannot read reports');
select pg_temp.expect_error($q$insert into public.reports(reporter_id,message_id,reason) values ('10000000-0000-0000-0000-000000000003',current_setting('test.message_id')::uuid,'Guess')$q$,'cannot report private messages by guessing ID');

-- A successful transaction consumes quota; rejected sixth post is rolled back.
insert into public.posts(author_id,body,topic,mood,scope) select '10000000-0000-0000-0000-000000000003','Rate test '||n,'Everyday life','Okay','global' from generate_series(1,5) n;
select pg_temp.expect_error($q$insert into public.posts(author_id,body,topic,mood,scope) values ('10000000-0000-0000-0000-000000000003','Too many','Everyday life','Okay','global')$q$,'sixth post in one minute limited');

reset role;
insert into private.moderators(user_id) values ('10000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.assert_true(public.is_moderator(),'trusted SQL can appoint moderator');
select pg_temp.assert_true((select count(*)=1 from public.reports),'moderator can read review queue');
insert into public.reports(reporter_id,post_id,reason) values ('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','Review test');
select public.review_report(id,true) from public.reports where post_id='20000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select count(*)=0 from public.posts where id='20000000-0000-0000-0000-000000000001'),'moderator removal hides post');
select pg_temp.assert_true((select status='reviewed' from public.reports where post_id='20000000-0000-0000-0000-000000000001'),'review recorded');
rollback;
