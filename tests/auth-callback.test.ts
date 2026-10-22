// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { completeAuthCallback, readAuthCallback } from '../src/lib/auth-callback';

const session = { user: { id: 'member-a' } } as Session;
const url =
  '/auth/callback?campaign=welcome#access_token=SECRET_ACCESS&refresh_token=SECRET_REFRESH&type=recovery&expires_in=3600';
beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

it('captures callback intent without retaining token values', () => {
  const snapshot = readAuthCallback(`https://kindred.example${url}`);
  expect(snapshot).toEqual({ kind: 'recovery' });
  expect(JSON.stringify(snapshot)).not.toContain('SECRET');
  expect(
    readAuthCallback('https://kindred.example/#access_token=a&refresh_token=b&type=signup'),
  ).toEqual({ kind: 'confirmation' });
});

it('waits for SDK initialization before cleaning the URL and returns recovery only with a real SDK session', async () => {
  window.history.replaceState({}, '', url);
  let finish!: (value: { error: null }) => void;
  const initialize = vi.fn(
    () =>
      new Promise<{ error: null }>((resolve) => {
        finish = resolve;
      }),
  );
  const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
  const pending = completeAuthCallback(
    { auth: { initialize, getSession } },
    readAuthCallback(window.location.href),
  );
  expect(window.location.hash).toContain('SECRET_ACCESS');
  expect(getSession).not.toHaveBeenCalled();
  finish({ error: null });
  await expect(pending).resolves.toMatchObject({ kind: 'recovery', session });
  expect(window.location.pathname).toBe('/');
  expect(window.location.search).toBe('?campaign=welcome');
  expect(window.location.hash).toBe('');
});

it('handles expired or used links with safe instructions and cleans untrusted error descriptions', async () => {
  window.history.replaceState(
    {},
    '',
    '/auth/callback?error=access_denied&error_code=otp_expired&error_description=SECRET_TOKEN',
  );
  const auth = { initialize: vi.fn().mockResolvedValue({ error: null }), getSession: vi.fn() };
  const result = await completeAuthCallback({ auth }, readAuthCallback(window.location.href));
  expect(result).toMatchObject({ kind: 'error', session: null, error: { code: 'link_expired' } });
  expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
  expect(auth.getSession).not.toHaveBeenCalled();
  expect(window.location.href).not.toContain('error_description');
});

it('does not treat an existing browser session as proof that an invalid incoming link succeeded', async () => {
  window.history.replaceState({}, '', url);
  const auth = {
    initialize: vi.fn().mockResolvedValue({ error: { code: 'otp_expired', message: 'SECRET' } }),
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
  };
  const result = await completeAuthCallback({ auth }, readAuthCallback(window.location.href));
  expect(result.kind).toBe('error');
  expect(result.session).toBeNull();
  expect(auth.getSession).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
});

it('rejects missing, unsupported PKCE, and partial-token links without exposing their contents', () => {
  for (const value of [
    '/auth/callback',
    '/auth/callback?code=SECRET',
    '/auth/callback#access_token=SECRET',
  ]) {
    const result = readAuthCallback(`https://kindred.example${value}`);
    expect(result.kind).toBe('error');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  }
});

it('handles failed initialization without displaying raw SDK errors', async () => {
  window.history.replaceState({}, '', url);
  const auth = {
    initialize: vi.fn().mockRejectedValue(new Error('SECRET_REFRESH')),
    getSession: vi.fn(),
  };
  const result = await completeAuthCallback({ auth }, readAuthCallback(window.location.href));
  expect(result.error?.code).toBe('callback_unavailable');
  expect(JSON.stringify(result)).not.toContain('SECRET_REFRESH');
  expect(window.location.hash).toBe('');
});

it('leaves regular navigation untouched and performs no auth request', async () => {
  window.history.replaceState({}, '', '/?topic=anxiety#community');
  const auth = { initialize: vi.fn(), getSession: vi.fn() };
  await expect(
    completeAuthCallback({ auth }, readAuthCallback(window.location.href)),
  ).resolves.toEqual({ kind: 'none', session: null });
  expect(auth.initialize).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('#community');
});
