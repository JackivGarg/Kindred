# Database setup and upgrades

Use a dedicated Supabase project. Never install this application into an unrelated
project.

## Fresh installation

Run these SQL files in order using the SQL editor or your migration runner:

1. `schema.sql` — tables, indexes, access rules, posting limits and automatic
   signup profiles.
2. `moderation-evidence.sql` — database-captured report snapshots, moderator
   hiding of messages, and the conversation INSERT RETURNING policy fix.
3. `performance.sql` — measured feed/message/queue indexes and a once-per-query
   moderator membership check.

The initial schema is a one-time installation and is intentionally not an
idempotent reset script. Do not rerun it over an existing installation.

## Already provisioned Kindred project

Project `uhaklwcvscsdsrfgniee` has all of these changes applied. Migration names:

- `initial_community_schema`
- `automatic_signup_profiles`
- `reported_content_evidence_and_conversation_returning`
- `indexed_feed_and_message_loading`

`profile-trigger.sql` is the standalone upgrade for installations created before
the signup trigger was included in the base schema. Both upgrade SQL files are
safe to reapply and do not reset stored community content.

Run `npm test` for the PostgreSQL permission tests and application checks. Test
fixtures in `tests/security.sql` roll back their transaction. Never use real
community messages as automated test data.
