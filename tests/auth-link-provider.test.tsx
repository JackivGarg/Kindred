// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { AuthCallbackResult } from '../src/lib/auth-callback';

const mocks = vi.hoisted(() => ({
  finish: vi.fn(),
  session: vi.fn(),
  onChange: vi.fn(),
  profile: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => ({ supabase: {}, isConfigured: true }));
vi.mock('../src/lib/auth', () => ({
  finishAuthCallback: mocks.finish,
  getSession: mocks.session,
  onAuthChange: mocks.onChange,
  signOut: vi.fn(),
}));
vi.mock('../src/lib/live-repository', () => ({
  SupabaseRepository: class {
    getProfile() {
      return mocks.profile();
    }
  },
}));
vi.mock('../src/lib/demo-repository', () => ({
  DemoRepository: class {
    getProfile() {
      return Promise.resolve(null);
    }
  },
}));
import { CommunityProvider, useCommunity } from '../src/lib/community';

let latest: ReturnType<typeof useCommunity>;
let emit: (session: Session | null, event: AuthChangeEvent) => void;
const member = {
  id: 'confirmed-member',
  nickname: 'Alex',
  region: 'India',
  bio: '',
  created_at: '2026-10-22T00:00:00Z',
};
const session = { user: { id: member.id, user_metadata: {} } } as Session;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness() {
  latest = useCommunity();
  return <output>{latest.profile?.nickname}</output>;
}
const start = () =>
  render(
    <CommunityProvider>
      <Harness />
    </CommunityProvider>,
  );
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/auth/callback');
  mocks.finish.mockResolvedValue({ kind: 'none', session: null });
  mocks.session.mockResolvedValue(null);
  mocks.profile.mockResolvedValue(member);
  mocks.onChange.mockImplementation((listener) => {
    emit = listener;
    return vi.fn();
  });
});
afterEach(cleanup);

describe('email links at application startup', () => {
  it('recovers a verified reset session even if the SDK recovery event occurred before mount', async () => {
    mocks.finish.mockResolvedValue({ kind: 'recovery', session });
    start();
    await waitFor(() => expect(latest.recovery).toBe(true));
    await waitFor(() => expect(latest.profile?.id).toBe(member.id));
    expect(latest.session?.user.id).toBe(member.id);
  });
  it('recovers reset intent after the initial session notification', async () => {
    const callback = deferred<AuthCallbackResult>();
    mocks.finish.mockReturnValue(callback.promise);
    mocks.session.mockResolvedValue(session);
    start();
    await waitFor(() => expect(latest.profile?.id).toBe(member.id));
    await act(async () => {
      emit(session, 'INITIAL_SESSION');
      callback.resolve({ kind: 'recovery', session });
    });
    await waitFor(() => expect(latest.recovery).toBe(true));
  });
  it('surfaces expired-link instructions separately from normal sign-in state', async () => {
    mocks.finish.mockResolvedValue({
      kind: 'error',
      session: null,
      error: { code: 'link_expired', message: 'Request a fresh email link.' },
    });
    start();
    await waitFor(() => expect(latest.authLinkError).toBe('Request a fresh email link.'));
    expect(latest.session).toBeNull();
    expect(latest.recovery).toBe(false);
    act(() => latest.clearAuthLinkStatus());
    expect(latest.authLinkError).toBe('');
  });
  it('never restores a callback session after a newer sign-out', async () => {
    const callback = deferred<AuthCallbackResult>();
    mocks.finish.mockReturnValue(callback.promise);
    mocks.session.mockResolvedValue(session);
    start();
    await waitFor(() => expect(latest.profile?.id).toBe(member.id));
    await act(async () => {
      emit(null, 'SIGNED_OUT');
      callback.resolve({ kind: 'recovery', session });
    });
    expect(latest.session).toBeNull();
    expect(latest.profile).toBeNull();
    expect(latest.recovery).toBe(false);
  });
  it('does not reopen an old reset flow after a new ordinary sign-in by the same user', async () => {
    const callback = deferred<AuthCallbackResult>();
    mocks.finish.mockReturnValue(callback.promise);
    mocks.session.mockResolvedValue(session);
    start();
    await waitFor(() => expect(latest.profile?.id).toBe(member.id));
    await act(async () => {
      emit(null, 'SIGNED_OUT');
      emit(session, 'SIGNED_IN');
      callback.resolve({ kind: 'recovery', session });
    });
    expect(latest.recovery).toBe(false);
    expect(latest.session?.user.id).toBe(member.id);
  });
  it('does not show stale confirmation success after a newer sign-out', async () => {
    const callback = deferred<AuthCallbackResult>();
    mocks.finish.mockReturnValue(callback.promise);
    mocks.session.mockResolvedValue(session);
    start();
    await waitFor(() => expect(latest.profile?.id).toBe(member.id));
    await act(async () => {
      emit(null, 'SIGNED_OUT');
      callback.resolve({ kind: 'confirmation', session });
    });
    expect(latest.authLinkNotice).toBe('');
    expect(latest.session).toBeNull();
  });
});
