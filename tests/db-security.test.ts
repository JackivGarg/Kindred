import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('PostgreSQL enforces consent, identity, blocks, moderation and rate limits', async () => {
  const db = new PGlite();
  try {
    // Only the Supabase-owned auth boundary is stubbed. All application tables,
    // roles, grants, triggers and RLS policies execute inside real PostgreSQL.
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth,public to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
    `);
    await db.exec(await readFile(resolve('supabase/schema.sql'), 'utf8'));
    await db.exec(await readFile(resolve('supabase/moderation-evidence.sql'), 'utf8'));
    await db.exec(await readFile(resolve('supabase/performance.sql'), 'utf8'));
    // The incremental installation is also safe after the complete fresh schema.
    await db.exec(await readFile(resolve('supabase/profile-trigger.sql'), 'utf8'));
    await db.exec('begin');
    await db.exec(`insert into auth.users(id,raw_user_meta_data) values
      ('90000000-0000-0000-0000-000000000001','{"nickname":"  River  ","region":"India","role":"moderator","is_admin":true}'),
      ('90000000-0000-0000-0000-000000000002','{"nickname":{"bad":"value"},"region":"Unknown"}'),
      ('90000000-0000-0000-0000-000000000003','{"nickname":"x","region":7}'),
      ('90000000-0000-0000-0000-000000000004',null);`);
    const profiles = await db.query<{ nickname: string; region: string }>(
      'select nickname,region from public.profiles order by id',
    );
    expect(profiles.rows).toEqual([
      { nickname: 'River', region: 'India' },
      { nickname: 'New member', region: 'Other' },
      { nickname: 'New member', region: 'Other' },
      { nickname: 'New member', region: 'Other' },
    ]);
    expect((await db.query('select * from private.moderators')).rows).toHaveLength(0);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('authenticated','private.handle_new_user()','execute') as allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    await db.exec('rollback');
    await db.exec(await readFile(resolve('supabase/tests/security.sql'), 'utf8'));
    // The security suite rolls back all fixtures after its assertions pass.
    const { rows } = await db.query<{ count: number }>(
      'select count(*)::integer as count from public.profiles',
    );
    expect(rows[0].count).toBe(0);
  } finally {
    await db.close();
  }
}, 30_000);
