import { expect, it } from 'vitest';
import { checkPublicAuth } from '../scripts/preflight.mjs';

it('blocks a public release if email confirmation has been bypassed', async () => {
  const fetcher = async () =>
    new Response(JSON.stringify({ external: { email: true }, mailer_autoconfirm: true }), {
      status: 200,
    });
  await expect(
    checkPublicAuth({ projectOrigin: 'https://example.supabase.co' }, 'public-key', fetcher),
  ).rejects.toThrow('email confirmation');
});
