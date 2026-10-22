import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Subplan Name'?: string;
  'Actual Rows'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}
interface Explained {
  Plan: PlanNode;
  'Execution Time': number;
}
function nodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}

test('composite indexes remove page sorts while preserving database permissions', async () => {
  const db = new PGlite();
  const reader = '82000000-0000-4000-8000-000000000001';
  const writer = '82000000-0000-4000-8000-000000000002';
  const outsider = '82000000-0000-4000-8000-000000000003';
  const moderator = '82000000-0000-4000-8000-000000000004';
  const conversation = '83000000-0000-4000-8000-000000000001';
  const post = '84000000-0000-4000-8000-000000000001';
  async function actor(uid: string) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
    await db.exec('set role authenticated');
  }
  async function explain(sql: string, params: unknown[] = []): Promise<Explained> {
    const result = await db.query<{ 'QUERY PLAN': Explained[] }>(
      `explain (analyze,format json) ${sql}`,
      params,
    );
    return result.rows[0]['QUERY PLAN'][0];
  }
  try {
    await db.exec(`
      set timezone = 'UTC';
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth,public to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
    `);
    for (const file of ['schema.sql', 'profile-trigger.sql', 'moderation-evidence.sql'])
      await db.exec(await readFile(resolve('supabase', file), 'utf8'));
    await db.query('insert into auth.users(id) values ($1),($2),($3),($4)', [
      reader,
      writer,
      outsider,
      moderator,
    ]);
    await db.exec(
      "insert into auth.users(id) select md5('member-'||g)::uuid from generate_series(1,296) g",
    );
    await db.query('insert into private.moderators(user_id) values ($1)', [moderator]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [writer]);
    // Bulk fixtures bypass only write-rate triggers under the trusted owner.
    // Every measured query below runs as authenticated with the real RLS.
    await db.exec(
      'alter table public.posts disable trigger posts_rate; alter table public.messages disable trigger messages_rate; alter table public.comments disable trigger comments_rate',
    );
    await db.query(
      `insert into public.posts(id,author_id,body,topic,mood,scope,region,created_at)
      select md5('post-'||g)::uuid, case when g%297=0 then $1::uuid else md5('member-'||(g%297))::uuid end, 'Synthetic community post '||g,'Everyday life','Okay',
      case when g%2=0 then 'regional' else 'global' end,
      case when g%2=0 then 'India' else null end,
      '2026-01-01'::timestamptz+(g/30)*interval '1 second'
      from generate_series(1,12000) g`,
      [writer],
    );
    await db.query(
      "insert into public.posts(id,author_id,body,topic,mood,scope) values($1,$2,'Replies fixture','Everyday life','Okay','global')",
      [post, writer],
    );
    await db.query(
      "insert into public.conversations(id,requester_id,recipient_id,status) values($1,$2,$3,'accepted')",
      [conversation, writer, reader],
    );
    await db.query(
      `insert into public.messages(id,conversation_id,sender_id,body,created_at)
      select md5('message-'||g)::uuid,$1,$2,'Synthetic message '||g,
      '2026-01-01'::timestamptz+(g/30)*interval '1 second'
      from generate_series(1,12000) g`,
      [conversation, writer],
    );
    await db.query(
      `insert into public.comments(id,post_id,author_id,body,created_at)
      select md5('comment-'||g)::uuid,$1,$2,'Synthetic reply '||g,
      '2026-01-01'::timestamptz+(g/30)*interval '1 second'
      from generate_series(1,12000) g`,
      [post, writer],
    );
    await db.exec('alter table public.reports disable trigger all');
    await db.query(
      `insert into public.reports(id,reporter_id,post_id,reason,status,created_at)
      select md5('report-'||g)::uuid,$1,$2,'Synthetic report',case when g%2=0 then 'open' else 'reviewed' end,
      '2026-01-01'::timestamptz+(g/30)*interval '1 second'
      from generate_series(1,12000) g`,
      [writer, post],
    );
    await db.exec('alter table public.reports enable trigger all; analyze public.reports');
    await db.exec(
      'alter table public.posts enable trigger posts_rate; alter table public.messages enable trigger messages_rate; alter table public.comments enable trigger comments_rate; analyze public.posts; analyze public.messages; analyze public.comments',
    );
    await actor(reader);
    const queries = [
      {
        name: 'feed',
        index: 'posts_feed_page',
        sql: 'select id,body from public.posts where not hidden order by created_at desc,id desc limit 20',
        params: [],
      },
      {
        name: 'regional',
        index: 'posts_region_page',
        sql: "select id,body from public.posts where not hidden and scope='regional' and region='India' order by created_at desc,id desc limit 20",
        params: [],
      },
      {
        name: 'messages',
        index: 'messages_conversation_page',
        sql: 'select id,body from public.messages where conversation_id=$1 order by created_at desc,id desc limit 200',
        params: [conversation],
      },
      {
        name: 'new messages',
        index: 'messages_conversation_page',
        sql: "select id,body from public.messages where conversation_id=$1 and created_at >= '2026-01-01T00:06:00Z' and (created_at > '2026-01-01T00:06:00Z' or (created_at = '2026-01-01T00:06:00Z' and id > '00000000-0000-0000-0000-000000000000')) order by created_at,id limit 200",
        params: [conversation],
      },
      {
        name: 'reports',
        index: 'reports_queue_page',
        sql: 'select id,reason from public.reports order by status,created_at desc limit 200',
        params: [],
      },
    ];
    const before: Explained[] = [];
    for (const query of queries) {
      await actor(query.name === 'reports' ? moderator : reader);
      before.push(await explain(query.sql, query.params));
    }
    const migration = await readFile(resolve('supabase/performance.sql'), 'utf8');
    await db.exec('reset role');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec('analyze public.posts; analyze public.messages; analyze public.comments');
    await actor(reader);
    const measurements: Record<string, unknown>[] = [];
    for (const [position, query] of queries.entries()) {
      await actor(query.name === 'reports' ? moderator : reader);
      const after = await explain(query.sql, query.params);
      const oldNodes = nodes(before[position].Plan);
      const newNodes = nodes(after.Plan);
      expect(after.Plan['Actual Rows']).toBe(
        query.name === 'feed' || query.name === 'regional' ? 20 : 200,
      );
      if (query.name === 'new messages') {
        // With a selective lower bound the planner can prefer the existing
        // timestamp index plus a small sort. It must still seek past old history.
        expect(newNodes.some((node) => /created_at.*>=/.test(node['Index Cond'] ?? ''))).toBe(true);
      } else {
        expect(
          newNodes.some((node) => node['Index Name'] === query.index),
          query.name,
        ).toBe(true);
        expect(
          newNodes.some((node) => /Sort/.test(node['Node Type'])),
          query.name,
        ).toBe(false);
        expect(
          oldNodes.some((node) => /Sort/.test(node['Node Type'])),
          `${query.name} baseline`,
        ).toBe(true);
      }
      measurements.push({
        query: query.name,
        beforeSort: oldNodes.find((node) => /Sort/.test(node['Node Type']))?.['Node Type'],
        afterIndex: newNodes.find((node) => node['Index Name'])?.['Index Name'],
        beforeMs: before[position]['Execution Time'],
        afterMs: after['Execution Time'],
      });
    }
    console.info(
      'PGlite synthetic query plans (300 profiles; 12000 rows/table; timings are local only)',
      measurements,
    );

    // The UID a browser sends is an untrusted hint. SQL checks the actual actor.
    await actor(reader);
    await expect(
      db.query(
        "insert into public.posts(author_id,body,topic,mood,scope) values($1,'Forged browser UID','Everyday life','Okay','global')",
        [writer],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query('update public.messages set hidden=false where conversation_id=$1', [conversation]),
    ).rejects.toMatchObject({ code: '42501' });
    await actor(outsider);
    expect(
      (await db.query('select id from public.messages where conversation_id=$1', [conversation]))
        .rows,
    ).toHaveLength(0);
    expect((await db.query('select public.is_moderator() as allowed')).rows[0]).toEqual({
      allowed: false,
    });
    await expect(db.query('select public.review_report($1,true)', [post])).rejects.toMatchObject({
      code: '42501',
    });
    await actor(reader);
    await db.query('insert into public.blocks(blocker_id,blocked_id) values($1,$2)', [
      reader,
      writer,
    ]);
    expect(
      (await db.query('select id from public.posts where author_id=$1', [writer])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query('select id from public.messages where conversation_id=$1', [conversation]))
        .rows,
    ).toHaveLength(0);
    await db.query('delete from public.blocks where blocker_id=$1 and blocked_id=$2', [
      reader,
      writer,
    ]);
    expect(
      (
        await db.query('select id from public.messages where conversation_id=$1 limit 1', [
          conversation,
        ])
      ).rows,
    ).toHaveLength(1);
    await actor(moderator);
    const reportPlan = await explain(
      'select id from public.reports order by status,created_at desc limit 200',
    );
    expect(
      nodes(reportPlan.Plan).some((node) => node['Subplan Name']?.startsWith('InitPlan')),
    ).toBe(true);
    expect(
      (await db.query('select id from public.messages where conversation_id=$1', [conversation]))
        .rows,
    ).toHaveLength(0);
  } finally {
    await db.close();
  }
}, 30_000);
