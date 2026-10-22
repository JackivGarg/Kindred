import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase, getAuthRedirectUrl, initialAuthCallback } from './supabase';
import { REGIONS } from './types';
import { completeAuthCallback, type AuthCallbackResult } from './auth-callback';

export class AuthActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthActionError';
  }
}
function mappedAuthError(error: unknown, action = 'account'): AuthActionError {
  if (error instanceof AuthActionError) return error;
  const record =
    typeof error === 'object' && error !== null
      ? (error as { code?: string; status?: number; name?: string; message?: string })
      : {};
  const code = record.code ?? '';
  if (code === 'email_not_confirmed')
    return new AuthActionError(
      code,
      'Confirm your email before signing in. Check your inbox and spam folder, or request a new confirmation email.',
    );
  if (code === 'invalid_credentials' || /invalid.*credentials/i.test(record.message ?? ''))
    return new AuthActionError(
      'invalid_credentials',
      'The email or password is incorrect. Check your details or reset your password.',
    );
  if (code === 'over_email_send_rate_limit')
    return new AuthActionError(
      'email_rate_limited',
      'Too many emails were requested. Wait a few minutes before trying again, and check your inbox and spam folder.',
    );
  if (code === 'over_request_rate_limit' || record.status === 429)
    return new AuthActionError(
      'rate_limited',
      'Too many attempts. Please wait a few minutes before trying again.',
    );
  if (['weak_password', 'password_too_short', 'validation_failed'].includes(code))
    return new AuthActionError(
      'weak_password',
      'Choose a stronger password with at least 10 characters, using a mix of letters, numbers, and symbols.',
    );
  if (code === 'same_password')
    return new AuthActionError(
      code,
      'Choose a new password that differs from your current password.',
    );
  if (
    [
      'session_not_found',
      'refresh_token_not_found',
      'refresh_token_already_used',
      'bad_jwt',
    ].includes(code) ||
    record.name === 'AuthSessionMissingError' ||
    /session.*expired/i.test(record.message ?? '')
  )
    return new AuthActionError(
      'session_expired',
      'Your session expired. Sign in again, or request a fresh password reset link.',
    );
  if (code === 'email_address_invalid')
    return new AuthActionError('invalid_email', 'Enter a valid email address.');
  if (code === 'email_address_not_authorized')
    return new AuthActionError(
      'email_unavailable',
      'Email delivery is not available for this address yet. Contact the community administrator to check email settings.',
    );
  if (record.status && record.status >= 500 && ['signup', 'reset', 'resend'].includes(action))
    return new AuthActionError(
      'email_unavailable',
      'Account setup or email delivery is temporarily unavailable. Try again later; the community administrator may need to check email settings.',
    );
  if (
    record.name === 'AuthRetryableFetchError' ||
    record.name === 'TypeError' ||
    (record.status && record.status >= 500)
  )
    return new AuthActionError(
      'service_unavailable',
      'We could not reach the account service. Check your connection and try again shortly.',
    );
  return new AuthActionError(
    'account_error',
    'We could not complete this account action. Please try again shortly.',
  );
}
export function authErrorMessage(error: unknown): string {
  return mappedAuthError(error).message;
}
async function safeAuthCall<T>(operation: Promise<T>, action = 'account'): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw mappedAuthError(error, action);
  }
}

function client() {
  if (!supabase)
    throw new AuthActionError(
      'not_configured',
      'Account access needs a configured Supabase project. The local demo does not create accounts.',
    );
  return supabase;
}

function normalizedEmail(email: string) {
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new AuthActionError('invalid_email', 'Enter a valid email address.');
  return value;
}

export function validateNewPassword(password: string) {
  if (password.length < 10)
    throw new AuthActionError('weak_password', 'Use a password with at least 10 characters.');
  if (new TextEncoder().encode(password).length > 72)
    throw new AuthActionError(
      'password_too_long',
      'Use a password no longer than 72 UTF-8 bytes. Emoji and some characters use more than one byte.',
    );
}

export async function signUp(
  email: string,
  password: string,
  nickname: string,
  region: string,
): Promise<{ needsConfirmation: boolean }> {
  validateNewPassword(password);
  const name = nickname.trim();
  if (name.length < 2 || name.length > 40)
    throw new AuthActionError('invalid_nickname', 'Choose a nickname between 2 and 40 characters.');
  if (!(REGIONS as readonly string[]).includes(region))
    throw new AuthActionError('invalid_region', 'Choose a region from the list.');
  const { data, error } = await safeAuthCall(
    client().auth.signUp({
      email: normalizedEmail(email),
      password,
      options: { data: { nickname: name, region }, emailRedirectTo: getAuthRedirectUrl() },
    }),
    'signup',
  );
  if (error) {
    if (['user_already_exists', 'email_exists'].includes(error.code ?? ''))
      return { needsConfirmation: true };
    throw mappedAuthError(error, 'signup');
  }
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await safeAuthCall(
    client().auth.signInWithPassword({
      email: normalizedEmail(email),
      password,
    }),
  );
  if (error) throw mappedAuthError(error);
}

export async function signOut(): Promise<void> {
  const { error } = await safeAuthCall(client().auth.signOut({ scope: 'local' }));
  if (error) throw mappedAuthError(error);
}

/** Used only to render client UI; database policies enforce all authorization. */
export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await safeAuthCall(supabase.auth.getSession());
  if (error) throw mappedAuthError(error);
  return data.session;
}

/** Keep listeners synchronous; load profile data in a separate React effect. */
export function onAuthChange(
  listener: (session: Session | null, event: AuthChangeEvent) => void,
): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => listener(session, event));
  return () => data.subscription.unsubscribe();
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await safeAuthCall(
    client().auth.resetPasswordForEmail(normalizedEmail(email), {
      redirectTo: getAuthRedirectUrl(),
    }),
    'reset',
  );
  if (error) throw mappedAuthError(error, 'reset');
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await safeAuthCall(
    client().auth.resend({
      type: 'signup',
      email: normalizedEmail(email),
      options: { emailRedirectTo: getAuthRedirectUrl() },
    }),
    'resend',
  );
  if (
    error &&
    !['user_already_exists', 'email_exists', 'user_not_found'].includes(error.code ?? '')
  )
    throw mappedAuthError(error, 'resend');
}

export async function updatePassword(password: string): Promise<void> {
  validateNewPassword(password);
  const { error } = await safeAuthCall(client().auth.updateUser({ password }));
  if (error) throw mappedAuthError(error);
}

let callbackCompletion: Promise<AuthCallbackResult> | undefined;
/** Idempotent across Strict Mode mounts. Subscribe to auth changes before calling. */
export function finishAuthCallback(): Promise<AuthCallbackResult> {
  if (!supabase) return Promise.resolve({ kind: 'none', session: null });
  callbackCompletion ??= completeAuthCallback(supabase, initialAuthCallback);
  return callbackCompletion;
}
