# Before inviting a public community

This repository is a working pilot, not a declaration of operational readiness.
Azure deployment tooling is available in [DEPLOY.md](DEPLOY.md); no site has been
published yet. Recheck this document against the final
deployment and account settings before marketing the application.

## What is implemented

- PostgreSQL row-level policies enforce authentication, ownership, bilateral
  blocking, conversation participation and recipient consent before messaging.
- Column grants prevent client changes to timestamps, identities and moderator
  flags. Moderator membership lives in a private schema.
- Atomic per-user database counters constrain posts, replies, message requests,
  messages and reports, including concurrent requests.
- Feed queries paginate 20 posts; message history is bounded. The initial
  interface does not promise unlimited historical browsing or instant delivery.
- The live inbox loads the newest 100 conversations by creation time; blocked
  member management loads the newest 500 blocks. Older entries are not browsable
  through these initial screens. All database blocks still enforce access rules,
  including blocks outside the loaded management list.
- The app uses public Supabase keys, never a browser service-role key. Errors
  remain visible; live failures do not silently become a fictional demo.
- Automated checks run the actual schema/policies in PostgreSQL (PGlite),
  repository tests, TypeScript and a production bundle build.
- Azure hosting configuration includes restrictive response headers. Those
  headers take effect only when served by Azure Static Web Apps.

## Release verification

1. Verify signup, email confirmation, sign-in, sign-out, and recovery with two
   real test accounts on the final domain. Set Supabase site URL and allowed
   redirects to that domain. Configure SMTP and check email rate limits.
2. Confirm email verification is required; disable anonymous authentication.
   Enable provider-supported abuse protection/CAPTCHA if public signup attracts
   bots. Database write limits do not stop signup abuse or all denial of service.
3. Repeat two-account browser checks: request/accept/decline, block both ways,
   inaccessible messages from a third account, reporting, moderation and deletion.
4. Appoint actual moderators with trusted SQL, define coverage and review times,
   and test escalation. Reports are not monitored by an automated emergency team.
   The app cannot promise immediate intervention.
   The queue displays report reasons, optional details and a database-captured
   snapshot of the reported post or message. Moderators can hide that content;
   they do not receive an interface to unrelated private conversations.
5. Publish reviewed privacy/community terms, a support contact, data retention
   periods and a workable deletion/export request process. The current UI does
   not automate account deletion or data export. Adults-only access is currently
   an attestation, not identity verification.
6. Establish database backups and a tested restore procedure, incident handling,
   service health monitoring and a private error reporting destination that
   redacts message bodies, email addresses and tokens.
7. Load-test realistic feeds, blocking and messaging volumes in a separate test
   project; inspect query plans and database capacity. Free plan limits are not
   an unlimited capacity guarantee. Check subscription spending and resource
   limits before enabling any paid service.
8. Verify final host headers, HTTPS, authentication redirects, mobile layout,
   keyboard navigation and dependency audit. Keep lockfiles and CI checks.

## Privacy boundaries

Global and regional posts are visible to signed-in members. Regional settings
filter discovery; they do not restrict access to people in that region. No GPS
location is collected. Profiles expose nickname, broad region and optional bio,
not email addresses. Public profile identities are pseudonymous, not guaranteed
anonymous.

DMs require acceptance and database access control. They are not end-to-end
encrypted; privileged operators can access stored content. Blocking hides the
other person's content and stops direct access through normal member accounts;
it does not erase copies someone has already seen or saved.

Demo people/content are fictional. Demo messages never reach another person.
Local demo state uses browser session storage and is separate from live data.

## Future scaling

Measure before adding infrastructure. Larger communities will need cursor
pagination, indexed search, event delivery/realtime design, retention jobs,
stronger abuse controls, account-wide suspension and operational dashboards.
Keep database authorization authoritative while adding those capabilities.
