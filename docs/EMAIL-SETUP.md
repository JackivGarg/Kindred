# Activate signup and recovery email

The app handles signup, confirmation, resend, sign-in and password recovery.
Actual email delivery requires a mail provider. No SMTP password or provider key
belongs in this repository, frontend variables or chat.

## Default production path: Brevo SMTP

1. Create a Brevo account and authenticate your sending domain using the DNS
   records Brevo supplies. Create and verify the sender you want to use.
2. In Brevo **SMTP & API → SMTP**, generate an SMTP key and note the displayed
   SMTP username. Use the SMTP key, not an API key or your account password.
3. Open [Kindred's Supabase SMTP settings](https://supabase.com/dashboard/project/uhaklwcvscsdsrfgniee/auth/smtp)
   and enable custom SMTP. Enter:

   | Setting          | Value                            |
   | ---------------- | -------------------------------- |
   | Sender name      | Kindred                          |
   | Sender address   | Your verified sender             |
   | Host             | `smtp-relay.brevo.com`           |
   | Port             | `587` (STARTTLS)                 |
   | Username         | The SMTP username shown by Brevo |
   | Password         | Your Brevo SMTP key              |
   | Minimum interval | 60 seconds                       |

4. Keep **Confirm email** enabled in Supabase. Set Auth Site URL to the final app
   origin and allow exactly `https://YOUR_HOST/auth/callback`. For local testing,
   allow `http://localhost:3000/auth/callback` as well. Do not use a wildcard
   production redirect.
5. Check the Supabase email rate limit and Brevo daily allowance. The free Brevo
   plan currently allows 300 sends/day, shared between confirmation, resend and
   reset emails. That is not headroom for 300 new registrations plus retries on
   the same day. Stagger invitations or select adequate mail volume.
6. Install the optional templates from `supabase/templates/` in Supabase Email
   Templates. Preserve `{{ .ConfirmationURL }}`; it carries Supabase's verified
   action link. Subjects: **Confirm your Kindred account** and **Reset your Kindred
   password**. Disable provider link tracking for auth emails if available.

## Acceptance check

Use an inbox you control to create a real test account. Confirm that the email
arrives, the confirmation opens the correct app, and sign-in works. Request a
password reset, open the email, set a new password, sign out and sign in with it.
Verify an expired link shows a useful retry path and resend does not submit twice.
Repeat on the deployed origin. Never test using another person's email address.

The public Auth settings endpoint cannot reveal whether custom SMTP is configured
correctly. A passing API smoke check does not prove inbox delivery.

Sources checked 22 October 2026:
[Brevo's Supabase guide](https://developers.brevo.com/docs/supabase-smtp-integration),
[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Brevo free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan).
