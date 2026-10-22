# Deploy Kindred to Azure Static Web Apps

This project uses Azure Static Web Apps **Free** for the frontend and the separate Kindred Supabase project `uhaklwcvscsdsrfgniee` for authentication and PostgreSQL. The scripts never provision a paid Azure tier, change another project, or deploy automatically on a push. An Azure subscription and access to the Supabase project's Auth settings are required.

## Recommended path: prepare, configure email, deploy

Use PowerShell in the project folder with Node.js 22.12+ or 24+, npm and [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli). Authenticate yourself with `az login`. Never paste Azure or SMTP credentials into chat or commit them.

1. Copy `.env.example` to `.env.local` if it does not already exist. Set these values using the dedicated project's **public** settings:

   ```dotenv
   VITE_SUPABASE_URL=https://uhaklwcvscsdsrfgniee.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<the project's sb_publishable_ key>
   ```

   Leave `VITE_APP_URL` empty until preparation returns the actual hostname. These `VITE_` values are included in browser assets; never use `sb_secret_`, `service_role`, an SMTP password or an Azure token here.

2. Prepare the dedicated Free Azure site. Replace the subscription placeholder with your enabled Azure for Students subscription ID. The names below are dedicated resource names; choose different `kindred-...` names if either conflicts with an existing resource.

   ```powershell
   .\scripts\deploy-azure.ps1 -PrepareOnly `
     -SubscriptionId '<your-subscription-id>' `
     -ResourceGroup 'kindred-community-rg' `
     -SiteName 'kindred-community'
   ```

   This installs locked project dependencies, runs formatting/tests, checks the production configuration and build, and creates only a tagged resource group and a **Free** Static Web App. It uploads no application content. Existing resources are reused only if they carry this project's ownership tag; an untagged resource or a non-Free site is refused. No unrelated resource is retagged, overwritten, deleted or upgraded.

   The command prints the real application origin returned by Azure. No hostname is assumed or invented.

3. Complete the email setup in the Kindred Supabase dashboard before uploading:

   - Set **Authentication → URL Configuration → Site URL** to the exact printed HTTPS origin.
   - Add `<the exact printed HTTPS origin>/auth/callback` to **Redirect URLs** for confirmation and password recovery. The script prints this exact URL too. Avoid wildcard redirects. Add local development callback URLs separately only when needed.
   - Enable the email provider and signup, and enable email confirmation.
   - Configure **custom SMTP** using your email provider's host, port, username, password and a verified sender address/domain. Provider credentials belong in Supabase's SMTP settings, never in `VITE_` settings or this public repository. Follow your provider's sender/domain verification instructions.
   - Put `VITE_APP_URL=<the exact printed HTTPS origin>` into `.env.local`.

   Supabase's public settings endpoint can show that email sign-in is enabled. It cannot prove custom SMTP configuration, allowed recipients, sender verification, deliverability or the private redirect allowlist. The preflight therefore reports SMTP and redirects as **unchecked**. No email-service account or credentials have been supplied by this repository.

4. Deploy to the same prepared site by rerunning without `-PrepareOnly`:

   ```powershell
   .\scripts\deploy-azure.ps1 `
     -SubscriptionId '<your-subscription-id>' `
     -ResourceGroup 'kindred-community-rg' `
     -SiteName 'kindred-community'
   ```

   The script verifies the site's ownership and Free tier, derives its hostname from Azure, rejects a conflicting `VITE_APP_URL`, rebuilds with that exact origin and runs preflight against the built assets. Upload uses the pinned official `@azure/static-web-apps-cli@2.1.0` and the site's deployment token held only in a temporary process environment variable. The token is not printed, written to a file, or passed as a command-line argument.

5. At the deployed origin, verify a real signup and confirmation email, sign-in, password recovery, and posting/replies/direct-message consent using two accounts. Confirm links return to this site. Email delivery and post-deployment behavior need this actual final-origin check; a successful static upload does not establish them.

If preparation or deployment fails, the script stops. Fix the reported issue and rerun the same command; tagged Free resources can be reused. The script does not automatically delete resources after a failure.

## Optional: manually deploy from GitHub later

After preparing the same Azure site, configure a GitHub **production** environment. Add its exact public values as environment variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_URL`, matching the Azure site's real HTTPS origin

Add `AZURE_STATIC_WEB_APPS_API_TOKEN` as a **production environment secret**, copied from **that prepared site's** Azure deployment-token screen. Check that the hostname and token belong to the same site. Never put the token in a repository variable or commit it. Configure environment reviewers if desired.

From the `main` branch, run **Actions → Deploy Kindred to Azure → Run workflow**. It runs checks, preflight, builds the site and uploads the verified `dist` directory with the official `Azure/static-web-apps-deploy@v1` action. There is no Azure Functions API folder: the application uses Supabase. No push or pull request deploys by itself.

Build variables are compile-time values; setting Azure runtime app settings after a build does not change a Vite bundle. Rebuild after changing them. The hosting configuration includes the SPA fallback, no-cache HTML, immutable hashed assets and a CSP restricted to this Supabase project.

## Checks without deploying

```powershell
node --env-file-if-exists=.env.local scripts/preflight.mjs
npm test -- tests/preflight.test.ts
```

Missing backend settings fail production preflight; an empty configuration cannot silently publish a demo. Preflight also rejects stale built configuration, mismatched CSP origins and privileged keys found in browser JavaScript. None of these read-only checks deploy or create Azure resources.

The Free Azure tier and Supabase's plan still have service limits. Configure service monitoring and community moderation before inviting a public audience; the repository's tests are not an uptime or concurrency guarantee.

References: [Azure CLI Static Web Apps commands](https://learn.microsoft.com/en-us/cli/azure/staticwebapp), [SWA CLI deployment](https://learn.microsoft.com/en-us/azure/static-web-apps/static-web-apps-cli#swa-deploy), [Azure build configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration), [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
