import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth } }));
import { signUp, signIn, signOut, getSession, updatePassword } from '../src/lib/auth';

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
        emailRedirectTo: 'http://localhost:5173',
      },
    });
  });
  it('surfaces provider errors without treating them as successful sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') });
    await expect(signIn('person@example.com', 'incorrect')).rejects.toThrow('Invalid credentials');
  });
  it('ends the local session and surfaces session retrieval errors', async () => {
    auth.signOut.mockResolvedValue({ error: null });
    await signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Session expired'),
    });
    await expect(getSession()).rejects.toThrow('Session expired');
  });
  it('rejects short replacement passwords before calling the provider', async () => {
    await expect(updatePassword('short')).rejects.toThrow('10 characters');
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
