# Verification record — 22 October 2026

## Automated checks

- 129 tests passed across 19 files (Vitest), with bounded worker concurrency.
- The SQL permission suite runs the actual tables, policies, grants and triggers
  in PostgreSQL via PGlite, including the database upgrades and query optimization.
- The same permission suite passed against the dedicated Supabase project in a
  transaction that rolled back all test fixtures.
- Read-only live smoke checks passed: auth endpoint reachable, email
  verification required, and signed-out access denied for profiles, posts,
  replies, conversations, messages and reports.
- TypeScript and the optimized production build passed.
- Dependency audit: zero reported vulnerabilities at verification time.
- Measured query-plan checks cover 300 synthetic profiles and 12,000 rows per
  tested table. Local timings do not establish hosted capacity; see `PERFORMANCE.md`.
- Request-count regressions verify local feed updates, bounded incremental inbox
  reads, offline/hidden polling suspension and account-isolated state.
- Account checks cover signup validation, duplicate-submission protection,
  confirmation resend, recovery, sanitized callback errors and session races.
- Deployment preflight checks enforce the dedicated project, public keys,
  verified-email signup, exact production origin and matching built assets.
  SMTP delivery and redirect allowlists remain explicitly unchecked.

## Browser checks

The local demo was checked in the in-app browser at desktop and 390px mobile
widths. Verified publishing, support reactions, replies, regional filtering,
profile saving, accepting a message request and sending a message. Verified a
single account dialog, working mobile navigation, signed-out live gating and
the live signup screen. No real user emails or messages were submitted.

The production bundle was served separately and checked for feed rendering,
working search, local fonts and lazy-loaded account/inbox panels. The fictional
demo is explicitly labeled and is separate from live data.

The production signup dialog opens directly from Join community. Empty signup
submissions show field errors. An expired confirmation callback returns to a
clean URL with a safe retry message; provider diagnostic text is not displayed.

## Verification limits

Email confirmation and recovery **delivery** have not been verified with actual
recipient inboxes. Auth UI, session/recovery behavior and permission boundaries
have automated coverage, but final-domain multi-account browser checks remain.
The project has not been load-tested or deployed to Azure. See `LAUNCH.md` for
operational requirements before inviting a public community.
