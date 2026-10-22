import type { Session } from '@supabase/supabase-js';

export interface CallbackProblem {
  code: 'link_expired' | 'invalid_link' | 'unsupported_link' | 'callback_unavailable';
  message: string;
}
export interface AuthCallbackInfo {
  kind: 'none' | 'confirmation' | 'recovery' | 'error';
  error?: CallbackProblem;
}
export interface AuthCallbackResult extends AuthCallbackInfo {
  session: Session | null;
}

const invalidLink = (): CallbackProblem => ({
  code: 'invalid_link',
  message:
    'This email link is incomplete or invalid. Request a new confirmation or password reset email.',
});
function linkProblem(code?: string | null): CallbackProblem {
  return ['otp_expired', 'access_denied', 'expired_token', 'flow_state_expired'].includes(
    code ?? '',
  )
    ? {
        code: 'link_expired',
        message:
          'This email link has expired or has already been used. Request a fresh link and open the newest email.',
      }
    : invalidLink();
}

/** Read only callback intent. Never retain, decode, log, or render URL tokens. */
export function readAuthCallback(rawUrl: string): AuthCallbackInfo {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'none' };
  }
  const query = url.searchParams;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const value = (key: string) => fragment.get(key) ?? query.get(key);
  if (value('error') || value('error_code') || value('error_description'))
    return { kind: 'error', error: linkProblem(value('error_code') ?? value('error')) };
  if (value('code') || value('token_hash'))
    return {
      kind: 'error',
      error: {
        code: 'unsupported_link',
        message:
          'This sign-in link cannot be completed here. Request a new email link from this application.',
      },
    };
  const hasToken = !!value('access_token') || !!value('refresh_token');
  if (hasToken) {
    if (!value('access_token') || !value('refresh_token'))
      return { kind: 'error', error: invalidLink() };
    return { kind: value('type') === 'recovery' ? 'recovery' : 'confirmation' };
  }
  if (url.pathname.replace(/\/$/, '') === '/auth/callback')
    return { kind: 'error', error: invalidLink() };
  return { kind: 'none' };
}

const callbackKeys = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'expires_at',
  'expires_in',
  'token_type',
  'type',
  'error',
  'error_code',
  'error_description',
  'code',
  'token_hash',
];
export function cleanAuthCallbackUrl(browser: Pick<Window, 'location' | 'history'> = window): void {
  const url = new URL(browser.location.href);
  for (const key of callbackKeys) url.searchParams.delete(key);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasAuthFragment = callbackKeys.some((key) => fragment.has(key));
  if (hasAuthFragment) {
    for (const key of callbackKeys) fragment.delete(key);
    url.hash = fragment.toString();
  }
  if (url.pathname.replace(/\/$/, '') === '/auth/callback') url.pathname = '/';
  browser.history.replaceState(
    browser.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

interface CallbackClient {
  auth: {
    initialize(): Promise<{ error: unknown }>;
    getSession(): Promise<{ data: { session: Session | null }; error: unknown }>;
  };
}

/** The SDK must finish consuming the original URL before any cleanup occurs. */
export async function completeAuthCallback(
  client: CallbackClient,
  snapshot: AuthCallbackInfo,
  browser: Pick<Window, 'location' | 'history'> = window,
): Promise<AuthCallbackResult> {
  if (snapshot.kind === 'none') return { kind: 'none', session: null };
  try {
    const initialized = await client.auth.initialize();
    if (snapshot.error) return { ...snapshot, session: null };
    if (initialized.error) {
      const code =
        typeof initialized.error === 'object' &&
        initialized.error !== null &&
        'code' in initialized.error
          ? String(initialized.error.code)
          : '';
      return { kind: 'error', session: null, error: linkProblem(code) };
    }
    const { data, error } = await client.auth.getSession();
    if (error || !data.session)
      return { kind: 'error', session: null, error: linkProblem('otp_expired') };
    return { kind: snapshot.kind, session: data.session };
  } catch {
    return {
      kind: 'error',
      session: null,
      error: {
        code: 'callback_unavailable',
        message:
          'We could not finish checking this email link. Check your connection and request a fresh link if needed.',
      },
    };
  } finally {
    cleanAuthCallbackUrl(browser);
  }
}
