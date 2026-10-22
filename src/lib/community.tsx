import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { DemoRepository } from './demo-repository';
import { SupabaseRepository } from './live-repository';
import { supabase, isConfigured } from './supabase';
import { getSession, onAuthChange, signOut as endSession } from './auth';
import { type CommunityRepository, type Profile } from './types';

interface CommunityContextValue {
  repository: CommunityRepository;
  profile: Profile | null;
  session: Session | null;
  mode: 'demo' | 'live';
  configured: boolean;
  loading: boolean;
  error: string;
  recovery: boolean;
  clearRecovery(): void;
  refreshProfile(): Promise<void>;
  enterDemo(): void;
  enterLive(): void;
  logout(): Promise<void>;
}
const CommunityContext = createContext<CommunityContextValue | null>(null);
export function CommunityProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'demo' | 'live'>(() =>
    !isConfigured || new URLSearchParams(window.location.search).get('demo') === '1'
      ? 'demo'
      : 'live',
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isConfigured);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const live = useMemo(() => (supabase ? new SupabaseRepository(supabase) : null), []);
  const demo = useMemo(() => new DemoRepository(), []);
  const repository = mode === 'live' && live ? live : demo;
  const generation = useRef(0);
  const sessionIdentity = useRef<string | null>(null);
  const authRevision = useRef(0);
  const profileRequest = useRef<{
    repository: typeof repository;
    uid: string | null;
    promise: Promise<Profile | null>;
  } | null>(null);
  const profileSnapshot = useRef(profile);
  profileSnapshot.current = profile;
  const userId = session?.user.id ?? null;
  const applySession = useCallback((value: Session | null) => {
    const identity = value?.user.id ?? null;
    if (sessionIdentity.current !== identity) {
      generation.current++;
      setProfile(null);
      setLoading(true);
    }
    sessionIdentity.current = identity;
    setSession(value);
  }, []);
  useEffect(() => {
    let current = true;
    const startupRevision = authRevision.current;
    const unsubscribe = onAuthChange((value, event) => {
      if (!current) return;
      authRevision.current++;
      applySession(value);
      setAuthError('');
      setAuthReady(true);
      if (!value || event === 'SIGNED_OUT') setRecovery(false);
      if (event === 'PASSWORD_RECOVERY' && value) {
        setRecovery(true);
        setMode('live');
      }
    });
    // Any event after subscription is newer than the startup snapshot.
    getSession()
      .then((value) => {
        if (current && authRevision.current === startupRevision) applySession(value);
      })
      .catch((err) => {
        if (current && authRevision.current === startupRevision) setAuthError(errorMessage(err));
      })
      .finally(() => {
        if (current) setAuthReady(true);
      });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [applySession]);
  const loadProfile = useCallback(async () => {
    const ticket = ++generation.current;
    if (!profileSnapshot.current || (mode === 'live' && profileSnapshot.current.id !== userId))
      setLoading(true);
    setError('');
    try {
      if (mode === 'live' && !authReady) return;
      if (mode === 'live' && !userId) {
        setProfile(null);
        return;
      }
      let pending = profileRequest.current;
      if (!pending || pending.repository !== repository || pending.uid !== userId) {
        pending = { repository, uid: userId, promise: repository.getProfile() };
        profileRequest.current = pending;
      }
      const next = await pending.promise.finally(() => {
        if (profileRequest.current === pending) profileRequest.current = null;
      });
      if (ticket === generation.current) {
        setProfile(next);
        if (!next && mode === 'live')
          setError(
            'Your account profile is not ready. Retry, or contact the community administrator to check profile setup.',
          );
      }
    } catch (err) {
      if (ticket === generation.current) {
        setError(errorMessage(err));
        setProfile(null);
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [repository, mode, userId, authReady]);
  useEffect(() => {
    void loadProfile();
    return () => {
      generation.current++;
    };
  }, [loadProfile]);
  const refreshProfile = useCallback(async () => {
    if (!authError || mode !== 'live') {
      await loadProfile();
      return;
    }
    // Auth bootstrap failures persist until an explicit retry or newer auth event.
    // This callback is deliberately separate from the automatic profile effect.
    const revision = authRevision.current;
    setLoading(true);
    try {
      const next = await getSession();
      if (revision !== authRevision.current) return;
      setAuthError('');
      applySession(next);
      setAuthReady(true);
      if ((next?.user.id ?? null) === (session?.user.id ?? null)) await loadProfile();
    } catch (cause) {
      if (revision === authRevision.current) setAuthError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [authError, mode, loadProfile, applySession, session]);
  const enterDemo = () => {
    if (mode === 'demo') return;
    generation.current++;
    setLoading(true);
    setProfile(null);
    setMode('demo');
    setError('');
    setRecovery(false);
  };
  const enterLive = () => {
    if (!isConfigured) throw new Error('Connect your Supabase project to create an account.');
    if (mode === 'live') return;
    generation.current++;
    setLoading(true);
    setProfile(null);
    setMode('live');
    setError('');
  };
  const logout = async () => {
    if (mode === 'live') await endSession();
    setSession(null);
    setProfile(null);
    setRecovery(false);
  };
  const visibleProfile =
    mode === 'demo' ? profile : session && profile?.id === session.user.id ? profile : null;
  const identityLoading = mode === 'live' && !!session && !visibleProfile && !error;
  return (
    <CommunityContext.Provider
      value={{
        repository,
        profile: visibleProfile,
        session,
        mode,
        configured: isConfigured,
        loading: loading || identityLoading || (mode === 'live' && !authReady),
        error: mode === 'live' ? authError || error : error,
        recovery,
        clearRecovery: () => setRecovery(false),
        refreshProfile,
        enterDemo,
        enterLive,
        logout,
      }}
    >
      {children}
    </CommunityContext.Provider>
  );
}
export function useCommunity() {
  const value = useContext(CommunityContext);
  if (!value) throw new Error('CommunityProvider is missing.');
  return value;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
