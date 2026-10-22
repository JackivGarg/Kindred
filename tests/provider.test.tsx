// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { Profile } from '../src/lib/types';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthChange: vi.fn(),
  signOut: vi.fn(),
  liveProfile: vi.fn(),
  demoProfile: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => ({ supabase: {}, isConfigured: true }));
vi.mock('../src/lib/auth', () => ({
  finishAuthCallback: async () => ({ kind: 'none', session: null }),
  getSession: mocks.getSession,
  onAuthChange: mocks.onAuthChange,
  signOut: mocks.signOut,
}));
vi.mock('../src/lib/live-repository', () => ({
  SupabaseRepository: class {
    getProfile() {
      return mocks.liveProfile();
    }
  },
}));
vi.mock('../src/lib/demo-repository', () => ({
  DemoRepository: class {
    getProfile() {
      return mocks.demoProfile();
    }
  },
}));
import { CommunityProvider, useCommunity } from '../src/lib/community';

let latest: ReturnType<typeof useCommunity>;
let emit: (session: Session | null, event: AuthChangeEvent) => void;
const profile = (id: string): Profile => ({
  id,
  nickname: id,
  region: 'India',
  bio: '',
  created_at: '2026-10-22T00:00:00Z',
});
const session = (id: string) => ({ user: { id, user_metadata: {} } }) as Session;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness() {
  latest = useCommunity();
  return (
    <>
      <output data-testid="loading">{String(latest.loading)}</output>
      <button onClick={latest.enterLive}>Live</button>
      <button onClick={latest.enterDemo}>Demo</button>
    </>
  );
}
const start = () =>
  render(
    <CommunityProvider>
      <Harness />
    </CommunityProvider>,
  );
const ready = () => waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

describe('community provider lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/');
    mocks.getSession.mockResolvedValue(null);
    mocks.signOut.mockResolvedValue(undefined);
    mocks.liveProfile.mockResolvedValue(profile('live-member'));
    mocks.demoProfile.mockResolvedValue(profile('demo-member'));
    mocks.onAuthChange.mockImplementation((listener) => {
      emit = listener;
      return vi.fn();
    });
  });
  afterEach(cleanup);

  it('keeps repeated signed-out live entry ready for the join form', async () => {
    start();
    await ready();
    fireEvent.click(screen.getByText('Live'));
    fireEvent.click(screen.getByText('Live'));
    expect(latest.mode).toBe('live');
    expect(latest.loading).toBe(false);
    expect(latest.session).toBeNull();
    expect(mocks.liveProfile).not.toHaveBeenCalled();
  });

  it('preserves the demo profile and readiness on repeated demo entry', async () => {
    start();
    await ready();
    fireEvent.click(screen.getByText('Demo'));
    await ready();
    const currentProfile = latest.profile;
    expect(currentProfile?.id).toBe('demo-member');
    fireEvent.click(screen.getByText('Demo'));
    fireEvent.click(screen.getByText('Demo'));
    expect(latest.profile).toBe(currentProfile);
    expect(latest.loading).toBe(false);
    expect(mocks.demoProfile).toHaveBeenCalledTimes(1);
  });

  it('clears the previous profile while a different mode loads', async () => {
    mocks.getSession.mockResolvedValue(session('live-member'));
    const demo = deferred<Profile>();
    mocks.demoProfile.mockReturnValue(demo.promise);
    start();
    await ready();
    expect(latest.profile?.id).toBe('live-member');
    fireEvent.click(screen.getByText('Demo'));
    expect(latest.mode).toBe('demo');
    expect(latest.profile).toBeNull();
    expect(latest.loading).toBe(true);
    await act(async () => demo.resolve(profile('demo-member')));
    await ready();
    expect(latest.profile?.id).toBe('demo-member');
    fireEvent.click(screen.getByText('Live'));
    await ready();
    expect(latest.profile?.id).toBe('live-member');
  });

  it('does not let a late startup snapshot restore a signed-out account', async () => {
    const bootstrap = deferred<Session | null>();
    mocks.getSession.mockReturnValue(bootstrap.promise);
    start();
    expect(latest.loading).toBe(true);
    act(() => emit(null, 'SIGNED_OUT'));
    await ready();
    await act(async () => bootstrap.resolve(session('stale-member')));
    expect(latest.session).toBeNull();
    expect(latest.profile).toBeNull();
    expect(latest.loading).toBe(false);
    expect(mocks.liveProfile).not.toHaveBeenCalled();
  });

  it('does not invalidate an in-flight profile load for a repeated identical session event', async () => {
    const current = session('live-member');
    mocks.getSession.mockResolvedValue(current);
    const pending = deferred<Profile>();
    mocks.liveProfile.mockReturnValue(pending.promise);
    start();
    await waitFor(() => expect(mocks.liveProfile).toHaveBeenCalled());
    act(() => emit(current, 'SIGNED_IN'));
    await act(async () => pending.resolve(profile('live-member')));
    await ready();
    expect(latest.profile?.id).toBe('live-member');
  });

  it('clears password recovery when the recovery session expires', async () => {
    start();
    await ready();
    act(() => emit(session('live-member'), 'PASSWORD_RECOVERY'));
    await ready();
    expect(latest.recovery).toBe(true);
    act(() => emit(null, 'SIGNED_OUT'));
    await ready();
    expect(latest.recovery).toBe(false);
    expect(latest.session).toBeNull();
  });

  it('preserves a startup failure without automatic retries, then explicitly retries auth', async () => {
    mocks.getSession.mockRejectedValue(new Error('Authentication is unavailable'));
    start();
    await ready();
    expect(latest.error).toBe('Authentication is unavailable');
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    await act(async () => latest.refreshProfile());
    expect(latest.error).toBe('Authentication is unavailable');
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    mocks.getSession.mockResolvedValue(session('live-member'));
    await act(async () => latest.refreshProfile());
    await ready();
    expect(latest.error).toBe('');
    expect(latest.profile?.id).toBe('live-member');
    expect(mocks.getSession).toHaveBeenCalledTimes(3);
  });
});
