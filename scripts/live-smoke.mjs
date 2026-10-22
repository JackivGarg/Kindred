import assert from 'node:assert/strict';

// Read-only checks. No accounts, posts, messages or other records are created.
const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert(url && key?.startsWith('sb_publishable_'), 'Configure the public Supabase settings first.');
const headers = { apikey: key };
const settingsResponse = await fetch(`${url}/auth/v1/settings`, { headers });
assert(settingsResponse.ok, `Authentication endpoint failed: ${settingsResponse.status}`);
const settings = await settingsResponse.json();
assert(settings.external?.email === true, 'Email authentication must be enabled.');
assert(settings.mailer_autoconfirm === false, 'Public signup must require email confirmation.');
console.log('PASS: authentication reachable; email verification required.');

for (const table of ['profiles', 'posts', 'comments', 'conversations', 'messages', 'reports']) {
  const response = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, { headers });
  assert(
    [401, 403].includes(response.status),
    `Signed-out ${table} read was not denied: ${response.status}`,
  );
  console.log(`PASS: signed-out ${table} reads denied.`);
}
console.log(
  'Read-only live checks complete. Real-user email delivery and multi-account browser flows still require verification.',
);
