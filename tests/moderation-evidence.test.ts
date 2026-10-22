import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('reported-content snapshots preserve message privacy and authorize moderator removal', async () => {
  const db = new PGlite();
  const a = '81000000-0000-4000-8000-000000000001';
  const b = '81000000-0000-4000-8000-000000000002';
  const c = '81000000-0000-4000-8000-000000000003';
  const d = '81000000-0000-4000-8000-000000000004';
  const moderator = '81000000-0000-4000-8000-000000000005';
  async function actor(uid: string) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    await db.exec('set role authenticated');
  }
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth,public to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
    `);
    await db.exec(await readFile(resolve('supabase/schema.sql'), 'utf8'));
    await db.query('insert into auth.users(id) values ($1),($2),($3),($4),($5)', [
      a,
      b,
      c,
      d,
      moderator,
    ]);
    await db.query('insert into private.moderators(user_id) values ($1)', [moderator]);

    await actor(a);
    const post = (
      await db.query<{ id: string }>(
        "insert into public.posts(author_id,body,topic,mood,scope) values ($1,'A public post being reported','Everyday life','Okay','global') returning id",
        [a],
      )
    ).rows[0].id;
    // A pre-migration report remains readable and reviewable without invented evidence.
    const oldReport = (
      await db.query<{ id: string }>(
        "insert into public.reports(reporter_id,post_id,reason) values ($1,$2,'Original report') returning id",
        [a, post],
      )
    ).rows[0].id;
    await db.exec('reset role');
    const migration = await readFile(resolve('supabase/moderation-evidence.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await actor(a);
    const conversation = (
      await db.query<{ id: string }>(
        'insert into public.conversations(requester_id,recipient_id) values ($1,$2) returning id',
        [a, b],
      )
    ).rows[0].id;
    await actor(b);
    await db.query("update public.conversations set status='accepted' where id=$1", [conversation]);
    await actor(a);
    const reportedMessage = (
      await db.query<{ id: string }>(
        "insert into public.messages(conversation_id,sender_id,body) values ($1,$2,'Exact reported message <script>plain text</script>') returning id",
        [conversation, a],
      )
    ).rows[0].id;
    const innocentMessage = (
      await db.query<{ id: string }>(
        "insert into public.messages(conversation_id,sender_id,body) values ($1,$2,'Other private message must stay private') returning id",
        [conversation, a],
      )
    ).rows[0].id;
    await actor(c);
    const unrelatedConversation = (
      await db.query<{ id: string }>(
        'insert into public.conversations(requester_id,recipient_id) values ($1,$2) returning id',
        [c, d],
      )
    ).rows[0].id;
    await actor(d);
    await db.query("update public.conversations set status='accepted' where id=$1", [
      unrelatedConversation,
    ]);
    await actor(c);
    const secret = (
      await db.query<{ id: string }>(
        "insert into public.messages(conversation_id,sender_id,body) values ($1,$2,'Secret from an unrelated conversation') returning id",
        [unrelatedConversation, c],
      )
    ).rows[0].id;
    await actor(b);
    await expect(
      db.query(
        "insert into public.reports(reporter_id,message_id,reason) values ($1,$2,'Attempted exfiltration')",
        [b, secret],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query(
        "insert into public.reports(reporter_id,message_id,reason,evidence) values ($1,$2,'Spoof evidence','Forged evidence')",
        [b, reportedMessage],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query(
        "insert into public.reports(reporter_id,message_id,reason) values ($1,$2,'Wrong reporter')",
        [a, reportedMessage],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const report = (
      await db.query<{ id: string; evidence: string }>(
        "insert into public.reports(reporter_id,message_id,reason,details) values ($1,$2,'Abusive message','Please review') returning id,evidence",
        [b, reportedMessage],
      )
    ).rows[0];
    expect(report.evidence).toBe('Exact reported message <script>plain text</script>');
    await expect(
      db.query('select public.review_report($1,true)', [report.id]),
    ).rejects.toMatchObject({ code: '42501' });
    // Direct hidden/evidence modifications are unavailable to normal clients.
    await expect(
      db.query('update public.messages set hidden=true where id=$1', [reportedMessage]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query(
        "insert into public.messages(conversation_id,sender_id,body,hidden) values ($1,$2,'Hidden spoof',false)",
        [conversation, b],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query("update public.reports set evidence='Forged' where id=$1", [report.id]),
    ).rejects.toMatchObject({ code: '42501' });
    // SDK ignoreDuplicates maps to DO NOTHING; grants intentionally omit UPDATE.
    for (let attempt = 0; attempt < 2; attempt++) {
      await db.query(
        'insert into public.supports(post_id,user_id) values ($1,$2) on conflict(user_id,post_id) do nothing',
        [post, b],
      );
      await db.query(
        'insert into public.blocks(blocker_id,blocked_id) values ($1,$2) on conflict(blocker_id,blocked_id) do nothing',
        [b, c],
      );
    }
    expect(
      (await db.query('select * from public.supports where post_id=$1 and user_id=$2', [post, b]))
        .rows,
    ).toHaveLength(1);
    expect(
      (await db.query('select * from public.blocks where blocker_id=$1 and blocked_id=$2', [b, c]))
        .rows,
    ).toHaveLength(1);
    for (let attempt = 0; attempt < 2; attempt++) {
      await db.query('delete from public.supports where post_id=$1 and user_id=$2', [post, b]);
      await db.query('delete from public.blocks where blocker_id=$1 and blocked_id=$2', [b, c]);
    }
    expect(
      (await db.query('select * from public.supports where post_id=$1 and user_id=$2', [post, b]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await db.query('select * from public.blocks where blocker_id=$1 and blocked_id=$2', [b, c]))
        .rows,
    ).toHaveLength(0);
    await actor(c);
    expect(
      (await db.query('select evidence from public.reports where id=$1', [report.id])).rows,
    ).toHaveLength(0);

    // Even a privileged insertion cannot make the trigger accept caller-supplied evidence.
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    const overwritten = (
      await db.query<{ evidence: string }>(
        "insert into public.reports(reporter_id,message_id,reason,evidence) values ($1,$2,'Trusted import','Forged') returning evidence",
        [b, reportedMessage],
      )
    ).rows[0];
    expect(overwritten.evidence).toBe(report.evidence);

    await actor(moderator);
    const old = (
      await db.query<{ reason: string; evidence: string }>(
        'select reason,evidence from public.reports where id=$1',
        [oldReport],
      )
    ).rows[0];
    expect(old).toEqual({ reason: 'Original report', evidence: '' });
    expect((await db.query('select * from public.messages')).rows).toHaveLength(0);
    expect(
      (
        await db.query<{ evidence: string }>('select evidence from public.reports where id=$1', [
          report.id,
        ])
      ).rows[0].evidence,
    ).toBe(report.evidence);
    await db.query('select public.review_report($1,true)', [report.id]);
    expect(
      (
        await db.query<{ status: string }>('select status from public.reports where id=$1', [
          report.id,
        ])
      ).rows[0].status,
    ).toBe('reviewed');
    await db.query('select public.review_report($1,true)', [oldReport]);

    await actor(b);
    expect(
      (await db.query('select * from public.messages where id=$1', [reportedMessage])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('select * from public.messages where id=$1', [innocentMessage])).rows,
    ).toHaveLength(1);
    await expect(
      db.query(
        "insert into public.reports(reporter_id,message_id,reason) values ($1,$2,'Hidden message')",
        [b, reportedMessage],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select * from public.posts where id=$1', [post])).rows).toHaveLength(0);
    // The original submitted snapshot survives hiding and cannot expand to a conversation.
    expect(
      (
        await db.query<{ evidence: string }>('select evidence from public.reports where id=$1', [
          report.id,
        ])
      ).rows[0].evidence,
    ).toBe(report.evidence);
  } finally {
    await db.close();
  }
}, 30_000);
