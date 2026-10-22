# Readiness for 300 people over a day

Planning target: **300 daily visitors**, with an assumed modest peak of **30
simultaneous active users**. These are planning assumptions, not measured service
capacity. A local synthetic PostgreSQL benchmark does not establish hosted
Supabase throughput, network latency, email delivery or Azure capacity.

## Illustrative request budget

Assume 300 members each open four feed pages and 60 members each spend 15 minutes
in an accepted DM thread. Ignore background tabs because polling pauses when
hidden/offline. Recheck these figures when the implementation or usage changes.

| Activity          | Calculation                                                                           | Approximate daily API calls |
| ----------------- | ------------------------------------------------------------------------------------- | --------------------------- |
| Feed pages        | 300 × 4 pages × 2 reads (posts and own support state)                                 | 2,400                       |
| DM inbox lists    | 900 active minutes × 1–4 polls/minute                                                 | 900–3,600                   |
| Open DM histories | 900 minutes × 1.875–7.5 polls/minute × 2 reads (conversation permission and messages) | 3,375–13,500                |

This example totals about **6,675–19,500 read requests/day**, before profile reads,
explicit refreshes, write acknowledgements, authentication traffic, message
catch-up batches and authoritative history reconciliation. It is an estimate,
not a quota promise. Empty support-state reads are skipped for empty feeds.

At a hypothetical peak where all 30 users have accepted threads open, current
base polling intervals imply roughly `30 × (1/15 + 2/8) = 9.5` read requests/second.
With unchanged-data backoff to 60 seconds for lists and 32 seconds for messages,
that falls to about `30 × (1/60 + 2/32) = 2.375` requests/second. Full reconciliation,
focus events, sends and backlogs add work; actual rates depend on user activity.

Using the SDK's local session identity avoids an extra Auth network request per normal
repository operation. This remains a query hint: the database still authenticates
the attached token and applies row-level policies. Never replace server policies
with client identity checks.

## Signup email is a launch dependency

As checked on **22 October 2026**, Supabase's built-in mail service restricts
delivery to organization team addresses and currently allows only two messages
per hour. That does not support inviting 300 public users. Configure custom SMTP,
verify the sender/domain, and test confirmation and recovery delivery. Newly
configured custom SMTP has a documented initial Auth limit of 30 messages/hour;
confirm the project's setting and provider allowance before a signup surge.
Do not bypass confirmation to work around email delivery. Sources:
[Supabase SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp),
[Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

For 300 new accounts across 12 hours, average confirmation demand alone is 25
emails/hour; retries and password recovery need headroom. Thirty registrations
within a few minutes are a different burst requirement. Choose an invitation
cadence that fits verified provider quotas. Existing confirmed accounts do not
need a confirmation email on each password sign-in.

## Checks before inviting people tomorrow

- Verify the deployed domain, HTTPS, response headers and exact Auth redirects.
  Run two-account signup/confirmation/reset and a third-account privacy check.
- Confirm public signup email delivery through custom SMTP; examine actual Auth
  and mail-provider limits. Credentials and provider setup remain operator work.
- Verify posting, replies, consent, block/unblock and moderator hiding on the
  deployed database. Incremental message polling must reconcile authoritative
  history periodically so hidden messages leave already-open threads.
- Exercise 30 realistic simultaneous test sessions in a separate environment:
  mix feeds, posts, messages and reports, and measure p50/p95 response times,
  errors, database CPU and request volume. Target p95 under one second for normal
  reads as an initial acceptance goal; this is not an observed result or SLA.
- Check current database/storage/egress usage and free-plan quotas in the actual
  account. Set monitoring and spending controls before enabling paid resources.
- Have moderators and a support contact available, with privacy/retention terms,
  deletion handling, incident procedures and a tested backup/restore approach.

Local regression tests, query-plan tests and browser smoke checks provide useful
evidence for a beta. They do not establish production readiness or guarantee a
particular concurrent user count. Azure deployment remains a separate step.

## Upstash decision

Upstash is not needed for this first 300-daily-member beta. Direct database access
with row-level policies, fewer network round trips, bounded queries and indexed
access paths address the current request-cost concerns without another service.
This does not imply that hosted throughput has been proved.

If signup abuse later needs shared per-IP limits, consider a server-side limiter
behind an Azure API endpoint. Keep Redis credentials on that server; never put
them in browser settings. Avoid a shared cache of private DM content, which
would require its own authorization, eviction and deletion guarantees.
