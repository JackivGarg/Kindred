# Local and Supabase setup

## 1. Start with the fictional demo

Run `npm install`, then `npm run dev`. The terminal prints the local application address. With both Supabase variables absent, the application uses fictional sample posts and conversations, with mutations stored in browser session storage. No accounts are created and no messages are delivered to people. A blocked or unavailable browser storage API falls back to in-memory state.

## 2. Use a new database project

The initial Kindred workspace has a newly provisioned, dedicated Supabase project with the schema applied. Its local configuration is kept in `.env.local`. The steps below reproduce that setup for a separate environment; do not rerun the initial schema against the provisioned database.

Create a new Supabase project dedicated to Kindred. Do not reuse an unrelated existing project. Keep its database password and any secret or service-role credentials outside the frontend and source control.

Run the complete contents of `supabase/schema.sql` **once** in that new project's SQL Editor. This initial schema is not an incremental migration and will fail if its tables already exist. It creates profiles, posts, replies, supports, blocks, conversation requests, messages, reports, row-level policies and supporting functions.

Then run `supabase/moderation-evidence.sql`. It installs report evidence capture,
moderator hiding for reported messages, and the conversation return policy fix.
Finally run `supabase/performance.sql` for the matching query indexes and moderation
policy optimization. See `supabase/README.md` for the installation and upgrade
order. All of these changes are already installed in the dedicated Kindred project.

Copy `.env.example` to `.env.local` and set both values:

```dotenv
VITE_SUPABASE_URL=https://YOUR_NEW_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

Use the project's public publishable key. A secret key, service-role key or database password must never appear in any `VITE_` variable. Browser environment variables are included in the frontend bundle. Restart Vite after changing the environment.

Both variables must be empty for demo mode or valid for live mode. Partial or invalid configuration produces an error rather than silently entering the demo.

## 3. Configure authentication

Enable email authentication in Supabase. Set Auth Site URL to the exact local app origin printed by Vite and add `<that origin>/auth/callback` to allowed redirect URLs. Preserve email confirmation for public registration; confirm your test account using the email link before signing in. Configure [custom SMTP](EMAIL-SETUP.md) for public recipients. For deployment, use the exact final origin and callback URL from [Azure deployment](DEPLOY.md), and verify confirmation and password-reset flows there.

The signup flow collects a nickname and chosen region. The schema creates a corresponding profile for new accounts. Test with two separately registered accounts to exercise request acceptance, replies and blocks. A third account is useful for checking conversation isolation.

## 4. Assign a moderator explicitly

After registering the intended moderator account, obtain its user UUID from Supabase Authentication. Run the following only through trusted administrative SQL, substituting the real UUID:

```sql
insert into private.moderators(user_id)
values ('YOUR_MODERATOR_USER_UUID')
on conflict do nothing;
```

Moderator membership is stored in a private table. Signing up or editing a profile does not grant moderation. Remove access using administrative SQL when a moderator leaves. The demo does not grant moderator access.

## 5. Verify before inviting users

Run `npm test` and `npm run build`. With the connected database, verify two-account posting and replies, support reactions, owner-only deletion, DM acceptance before sending, blocking, and reporting. Confirm a third user cannot read the conversation. Check that an ordinary user cannot open reports while the designated moderator can review them.

Decide who handles reports and how often, publish understandable community rules, and establish account/data deletion procedures before a wider launch. Regional posts are discoverable by region, not confidential regional rooms. DMs are not end-to-end encrypted.

Follow [Azure deployment](DEPLOY.md) when ready to publish. This setup guide does not provision or publish an Azure resource.

The Azure Static Web Apps response-header template is `public/staticwebapp.config.json`.
Its `connect-src` policy currently names the dedicated Kindred Supabase project.
If you connect a different project, update both HTTPS and WSS host entries before
deployment; otherwise the browser will block its requests. Verify the response
headers on the final host, since Vite's local server does not apply Azure headers.
