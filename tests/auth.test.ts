import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  resend: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => ({
  supabase: { auth },
  getAuthRedirectUrl: () => 'http://localhost:5173/auth/callback',
  initialAuthCallback: { kind: 'none' },
}));
import {
  signUp,
  signIn,
  signOut,
  getSession,
  updatePassword,
  resendConfirmation,
  sendPasswordReset,
  authErrorMessage,
  validateNewPassword,
} from '../src/lib/auth';

describe('account operations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });
  });
  it('validates signup before contacting authentication', async () => {
    await expect(signUp('person@example.com', 'short', 'Alex', 'India')).rejects.toThrow(
      '10 characters',
    );
    await expect(signUp('person@example.com', 'long-password', 'A', 'India')).rejects.toThrow(
      'nickname',
    );
    await expect(signUp('person@example.com', 'long-password', 'Alex', 'Unknown')).rejects.toThrow(
      'region',
    );
    await expect(signUp('not-email', 'long-password', 'Alex', 'India')).rejects.toThrow(
      'valid email',
    );
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it('passes nickname and region metadata and reports confirmation requirements', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(
      signUp(' person@example.com ', 'long-password', ' Alex ', 'India'),
    ).resolves.toEqual({ needsConfirmation: true });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'person@example.com',
      password: 'long-password',
      options: {
        data: { nickname: 'Alex', region: 'India' },
        emailRedirectTo: 'http://localhost:5173/auth/callback',
      },
    });
  });
  it('surfaces provider errors without treating them as successful sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') });
    await expect(signIn('person@example.com', 'incorrect')).rejects.toThrow(
      'email or password is incorrect',
    );
  });
  it('ends the local session and surfaces session retrieval errors', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Session expired'),
    });
    await expect(getSession()).rejects.toThrow('session expired');
  });
  it('rejects short replacement passwords before calling the provider', async () => {
    await expect(updatePassword('short')).rejects.toThrow('10 characters');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it('uses callback URLs consistently for confirmation resend and password recovery', async () => {
    auth.resend.mockResolvedValue({ error: null });
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await resendConfirmation(' person@example.com ');
    await sendPasswordReset('person@example.com');
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'person@example.com',
      options: { emailRedirectTo: 'http://localhost:5173/auth/callback' },
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', {
      redirectTo: 'http://localhost:5173/auth/callback',
    });
  });
  it('returns neutral confirmation results for an existing account', async () => {
    auth.signUp.mockResolvedValue({
      data: {},
      error: { code: 'user_already_exists', message: 'Existing user' },
    });
    await expect(signUp('person@example.com', 'long-password', 'Alex', 'India')).resolves.toEqual({
      needsConfirmation: true,
    });
    auth.resend.mockResolvedValue({ error: { code: 'user_not_found' } });
    await expect(resendConfirmation('person@example.com')).resolves.toBeUndefined();
  });
  it('maps email limits and email configuration failures to actionable safe errors', async () => {
    auth.resend.mockResolvedValue({
      error: { code: 'over_email_send_rate_limit', message: 'internal secret details' },
    });
    await expect(resendConfirmation('person@example.com')).rejects.toMatchObject({
      code: 'email_rate_limited',
    });
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { status: 500, message: 'SMTP password=secret' },
    });
    await expect(sendPasswordReset('person@example.com')).rejects.toMatchObject({
      code: 'email_unavailable',
    });
    expect(
      authErrorMessage({ code: 'unknown', message: 'access_token=DO_NOT_RENDER' }),
    ).not.toContain('DO_NOT_RENDER');
    auth.getSession.mockRejectedValue(new Error('refresh_token=DO_NOT_RENDER'));
    await expect(getSession()).rejects.toThrow('could not complete this account action');
  });
  it('rejects oversized Unicode passwords instead of silently truncating them', () => {
    expect(() => validateNewPassword('😀'.repeat(19))).toThrow('72 UTF-8 bytes');
    expect(() => validateNewPassword('x'.repeat(72))).not.toThrow();
  });
});
