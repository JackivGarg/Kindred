// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { Profile } from '../src/lib/types';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthChange: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => ({ supabase: {}, isConfigured: true }));
vi.mock('../src/lib/auth', () => ({
  getSession: mocks.getSession,
  onAuthChange: mocks.onAuthChange,
  signOut: vi.fn(),
}));
vi.mock('../src/lib/live-repository', () => ({
  SupabaseRepository: class {
    getProfile() {
      return mocks.getProfile();
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
const profile: Profile = {
  id: 'member-a',
  nickname: 'Alex',
  region: 'India',
  bio: '',
  created_at: '2026-10-22T00:00:00Z',
};
const session = { user: { id: profile.id, user_metadata: {} } } as Session;
function Harness() {
  latest = useCommunity();
  return <output>{latest.profile?.nickname}</output>;
}
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/');
  mocks.getSession.mockResolvedValue(session);
  mocks.getProfile.mockResolvedValue(profile);
  mocks.onAuthChange.mockImplementation((listener) => {
    emit = listener;
    return vi.fn();
  });
});
afterEach(cleanup);

it('does not refetch the profile or hide the app for a refreshed token belonging to the same member', async () => {
  render(
    <CommunityProvider>
      <Harness />
    </CommunityProvider>,
  );
  await waitFor(() => expect(latest.profile?.id).toBe(profile.id));
  await act(async () => emit({ ...session, access_token: 'new-token' }, 'TOKEN_REFRESHED'));
  expect(mocks.getProfile).toHaveBeenCalledTimes(1);
  expect(latest.loading).toBe(false);
  expect(latest.profile).toEqual(profile);
});

it('coalesces overlapping explicit profile refreshes and preserves the current profile while waiting', async () => {
  render(
    <CommunityProvider>
      <Harness />
    </CommunityProvider>,
  );
  await waitFor(() => expect(latest.profile?.id).toBe(profile.id));
  let resolve!: (profile: Profile) => void;
  const pending = new Promise<Profile>((done) => {
    resolve = done;
  });
  mocks.getProfile.mockReturnValue(pending);
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = latest.refreshProfile();
    second = latest.refreshProfile();
  });
  expect(latest.loading).toBe(false);
  expect(latest.profile).toEqual(profile);
  expect(mocks.getProfile).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolve({ ...profile, nickname: 'Alex updated' });
    await Promise.all([first, second]);
  });
  expect(latest.profile?.nickname).toBe('Alex updated');
  expect(latest.loading).toBe(false);
});
