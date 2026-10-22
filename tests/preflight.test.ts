import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_ORIGIN,
  deploymentOrigin,
  validateDeploymentConfig,
  checkPublicAuth,
  checkBuiltAssets,
  runPreflight,
} from '../scripts/preflight.mjs';

const key = 'sb_publishable_fictionaltestkey12345';
const origin = 'https://kindred-example.azurestaticapps.net';
const environment = {
  VITE_SUPABASE_URL: PROJECT_ORIGIN,
  VITE_SUPABASE_PUBLISHABLE_KEY: key,
  VITE_APP_URL: origin,
};
const hosting = {
  navigationFallback: { rewrite: '/index.html' },
  globalHeaders: {
    'Content-Security-Policy': `default-src 'self'; connect-src 'self' ${PROJECT_ORIGIN} ${PROJECT_ORIGIN.replace('https:', 'wss:')}; object-src 'none'`,
  },
};
const enabledAuth = () =>
  new Response(
    JSON.stringify({ external: { email: true }, disable_signup: false, mailer_autoconfirm: false }),
    {
      status: 200,
    },
  );

describe('production deployment preflight', () => {
  it('rejects demo configuration, unrelated projects and privileged keys', () => {
    expect(() => validateDeploymentConfig({}, hosting)).toThrow('demo builds cannot deploy');
    expect(() =>
      validateDeploymentConfig(
        { ...environment, VITE_SUPABASE_URL: 'https://another-project.supabase.co' },
        hosting,
      ),
    ).toThrow('dedicated');
    for (const invalid of [
      '',
      'sb_secret_doNotExposeThisSecret123',
      'eyJhbGciOiJIUzI1NiJ9.service_role.signature',
    ]) {
      expect(() =>
        validateDeploymentConfig(
          { ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: invalid },
          hosting,
        ),
      ).toThrow('public publishable key');
    }
  });
  it('allows hostname preparation without allowing an originless production upload', () => {
    const withoutOrigin = { ...environment, VITE_APP_URL: '' };
    expect(() => validateDeploymentConfig(withoutOrigin, hosting)).toThrow(
      'final Azure HTTPS origin',
    );
    expect(
      validateDeploymentConfig(withoutOrigin, hosting, { prepare: true }).appOrigin,
    ).toBeNull();
    expect(validateDeploymentConfig(environment, hosting).appOrigin).toBe(origin);
  });
  it('rejects redirect-shaped origins and normalizes one trailing slash', () => {
    for (const invalid of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com/path',
      'https://example.com/?next=https://evil.test',
      'https://example.com/#token',
      'https://localhost',
      'https://127.0.0.1',
      '//evil.test',
      'https://example.com:8443',
    ]) {
      expect(() => deploymentOrigin(invalid), invalid).toThrow();
    }
    expect(deploymentOrigin(`${origin}/`)).toBe(origin);
  });
  it('requires exact dedicated-project CSP connections and SPA routing', () => {
    const openCsp = {
      ...hosting,
      globalHeaders: { 'Content-Security-Policy': `connect-src * ${PROJECT_ORIGIN}` },
    };
    expect(() => validateDeploymentConfig(environment, openCsp)).toThrow('CSP');
    expect(() =>
      validateDeploymentConfig(environment, { ...hosting, navigationFallback: {} }),
    ).toThrow('SPA');
  });
  it('checks public email availability while honestly leaving SMTP and redirects unchecked', async () => {
    const fetcher = vi.fn(async () => enabledAuth());
    expect(await checkPublicAuth({ projectOrigin: PROJECT_ORIGIN }, key, fetcher)).toEqual({
      emailProvider: 'enabled',
      smtpDelivery: 'unchecked',
      authRedirects: 'unchecked',
    });
    expect(fetcher).toHaveBeenCalledWith(
      `${PROJECT_ORIGIN}/auth/v1/settings`,
      expect.objectContaining({ headers: { apikey: key }, redirect: 'error' }),
    );
    await expect(
      checkPublicAuth(
        { projectOrigin: PROJECT_ORIGIN },
        key,
        async () => new Response('{}', { status: 401 }),
      ),
    ).rejects.toThrow('HTTP 401');
    await expect(
      checkPublicAuth(
        { projectOrigin: PROJECT_ORIGIN },
        key,
        async () => new Response('{"external":{"email":false}}'),
      ),
    ).rejects.toThrow('Enable the email');
    await expect(
      checkPublicAuth(
        { projectOrigin: PROJECT_ORIGIN },
        key,
        async () =>
          new Response(
            '{"external":{"email":true},"mailer_autoconfirm":false,"disable_signup":true}',
          ),
      ),
    ).rejects.toThrow('signup is disabled');
  });
  it('rejects stale/demo builds and leaked secrets, then checks the matching artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kindred-preflight-'));
    try {
      await mkdir(join(root, 'dist/assets'), { recursive: true });
      await mkdir(join(root, 'public'), { recursive: true });
      await writeFile(join(root, 'dist/staticwebapp.config.json'), JSON.stringify(hosting));
      await writeFile(join(root, 'public/staticwebapp.config.json'), JSON.stringify(hosting));
      const bundle = join(root, 'dist/assets/app.js');
      await writeFile(bundle, 'demo-only');
      await expect(checkBuiltAssets(root, key, origin)).rejects.toThrow('expected live Supabase');
      await writeFile(bundle, `${PROJECT_ORIGIN} ${key}`);
      await expect(checkBuiltAssets(root, key, origin)).rejects.toThrow('VITE_APP_URL');
      await writeFile(bundle, `${PROJECT_ORIGIN} ${key} ${origin} sb_secret_fictionalLeakedKey123`);
      await expect(checkBuiltAssets(root, key, origin)).rejects.toThrow('secret Supabase key');
      const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature`;
      await writeFile(bundle, `${PROJECT_ORIGIN} ${key} ${origin} ${jwt}`);
      await expect(checkBuiltAssets(root, key, origin)).rejects.toThrow('service-role token');
      await writeFile(bundle, `${PROJECT_ORIGIN} ${key} ${origin}`);
      const result = await runPreflight({
        root,
        env: environment,
        args: ['--built'],
        fetcher: async () => enabledAuth(),
      });
      expect(result).toMatchObject({
        buildChecked: true,
        appOrigin: origin,
        smtpDelivery: 'unchecked',
      });
      expect(JSON.stringify(result)).not.toContain(key);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
