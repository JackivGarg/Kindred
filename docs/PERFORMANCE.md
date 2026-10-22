# Performance changes

These changes reduce unnecessary browser requests and improve query plans. They do not establish a supported user capacity or production latency guarantee. The intended initial community is roughly 300 members over a day, not 300 simultaneous sessions.

## Browser requests

- Repository operations read the current Supabase SDK session for an untrusted user-ID query hint rather than fetching the Auth user over HTTP on every operation. Profile startup still calls `getUser()` for current server-confirmed identity. There is no separate user-ID or token cache.
- The attached access token and database row-level security authorize every operation. Changing a browser-side user-ID hint cannot grant another member's permissions. Moderator membership continues to come from the database.
- Message reads query the RLS-protected messages table directly. They no longer fetch the conversation before every message poll. Pending, unrelated, blocked, and hidden messages remain unavailable through SQL policies.
- `listMessages(conversationId, after?)` accepts a timestamp/ID cursor. Initial reads return the latest 200 messages in chronological order; incremental reads return at most 200 later messages in ascending timestamp/ID order. Equal timestamps use the ID as a deterministic tie-breaker. PostgreSQL timestamp microseconds are preserved.
- Cursor reads include a timestamp lower bound so the index can skip older history, together with the strict timestamp/ID condition. The inbox periodically replaces local messages with a complete latest-page snapshot so moderator-hidden messages can disappear from the open view.

## Database migration

Apply `supabase/performance.sql` after the base schema and the profile and moderation migrations. It is additive and safe to apply repeatedly.

| Index                                                                                          | Query served                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `posts_feed_page (created_at DESC, id DESC) WHERE NOT hidden`                                  | Latest community posts                             |
| `posts_region_page (region, created_at DESC, id DESC) WHERE NOT hidden AND scope = 'regional'` | Latest posts in a selected region                  |
| `messages_conversation_page (conversation_id, created_at DESC, id DESC) WHERE NOT hidden`      | Latest messages in a conversation                  |
| `reports_queue_page (status, created_at DESC, id DESC)`                                        | Open reports before reviewed reports, newest first |

The reports SELECT policy evaluates row-independent moderator membership through an initplan once per SQL statement. Reporter ownership and moderator access rules remain the same. No table privileges, role assignments, message visibility, or function exposure are broadened. Existing indexes are retained.

Author and comment index candidates were checked but omitted: PostgreSQL's natural plans did not show a useful sorting improvement for those candidates in this fixture. There is no feed pagination API change or external message cache.

## Reproducible local measurements

Run:

```powershell
npm test -- tests/db-performance.test.ts --silent=false --reporter=verbose
```

The test uses PGlite's PostgreSQL engine with 300 synthetic profiles, 12,000 posts plus one reply fixture, and 12,000 messages, replies, and reports. Bulk fixture writes use a trusted owner with rate triggers temporarily disabled; all measured reads use the authenticated role with the actual application RLS policies. Tests set UTC explicitly and use repeated timestamps to exercise stable page ordering.

`EXPLAIN (ANALYZE, FORMAT JSON)` verifies that PostgreSQL naturally chooses the four new indexes and removes the corresponding incremental sort steps. The incremental cursor test verifies an indexed timestamp bound and a nonempty 200-message result; the planner may prefer the existing timestamp index plus a small sort for that selective range. It is not forced to use an index by disabling sequential scans or bitmap scans.

One local run on October 22, 2026 produced the following diagnostic execution times:

| Query                            | Before, ms | After, ms | Verified plan change                          |
| -------------------------------- | ---------: | --------: | --------------------------------------------- |
| Latest 20 posts                  |      4.887 |     1.067 | Incremental sort removed                      |
| Latest 20 regional posts         |      1.030 |     0.759 | Incremental sort removed                      |
| Latest 200 conversation messages |     14.246 |    12.404 | Incremental sort removed                      |
| Latest 200 moderation reports    |     76.719 |     0.589 | Incremental sort removed; membership initplan |

These are single local diagnostic samples with different cache states, not a controlled benchmark or a forecast of Supabase or Azure response times. Structural plan assertions and permission checks are the regression criteria; elapsed-time thresholds are deliberately absent.

The same database test checks forged user-ID writes, unauthorized moderator actions, unrelated message reads, and blocking after the migration. Existing permission and moderation suites remain required. Production capacity depends on actual traffic, query distributions, database limits, and deployment measurements.

## Documentation checked

- [Supabase authentication method guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client#choosing-an-auth-method)
- [Supabase row-level security performance recommendations](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations)
- [Supabase indexes](https://supabase.com/docs/guides/database/postgres/indexes)
- [PostgreSQL multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)

The browser session hint is intentionally not treated as server-verified identity. This is a browser Data API client; SQL remains the security boundary.
