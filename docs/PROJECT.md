# Kindred project record

Local project: `C:\Users\JACKIV\OneDrive\Desktop\Kindred`

Dedicated Supabase project: `Kindred Community` (`uhaklwcvscsdsrfgniee`).
Region: Mumbai (`ap-south-1`). This project is separate from all existing projects.
Dashboard: https://supabase.com/dashboard/project/uhaklwcvscsdsrfgniee

The `initial_community_schema` migration was installed on 22 October 2026.
The `automatic_signup_profiles` and
`reported_content_evidence_and_conversation_returning` migrations are also applied.
All eight public tables have row-level security enabled. Private moderator roles
and rate counters intentionally have no client-access policies.

The SQL permission suite ran successfully against this dedicated database inside
a transaction that rolled back its test users and content. Local tests also run
the same schema and suite against PostgreSQL through PGlite.

The ignored `.env.local` contains only the new project's public URL and publishable
API key. No secret or service-role key is used by the browser application.

Local development uses http://localhost:3000. Verify this origin is allowed in
Supabase Authentication URL Configuration before testing email confirmation and
password recovery. Cloud email delivery and real-user signup need a final check.

Azure deployment is deferred at the user's request. No Azure resources have been
created for this project.
