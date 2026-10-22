import { useEffect, useState, type FormEvent } from 'react';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { errorMessage, useCommunity } from '../lib/community';
import { sendPasswordReset, signIn, signUp, updatePassword } from '../lib/auth';
import { REGIONS, type Profile } from '../lib/types';
import Avatar from './Avatar';
import Modal from './Modal';
import './panels.css';

export default function AccountPanel({
  onClose,
  onNotice,
}: {
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const {
    repository,
    profile,
    session,
    mode,
    configured,
    recovery,
    clearRecovery,
    refreshProfile,
    enterLive,
    enterDemo,
    logout,
    loading,
    error: contextError,
  } = useCommunity();
  const [screen, setScreen] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [region, setRegion] = useState(profile?.region ?? 'India');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [blockedError, setBlockedError] = useState('');
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blockedRefresh, setBlockedRefresh] = useState(0);
  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname);
      setRegion(profile.region);
      setBio(profile.bio);
    }
  }, [profile]);
  useEffect(() => {
    let current = true;
    if (!profile) return;
    setBlockedLoading(true);
    setBlockedError('');
    repository
      .listBlocked()
      .then((value) => {
        if (current) setBlocked(value);
      })
      .catch((cause) => {
        if (current) setBlockedError(errorMessage(cause));
      })
      .finally(() => {
        if (current) setBlockedLoading(false);
      });
    return () => {
      current = false;
    };
  }, [repository, profile?.id, blockedRefresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const submitAuth = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (recovery) {
        await updatePassword(password);
        clearRecovery();
        setPassword('');
        setSuccess('Your password has been updated.');
        onNotice('Password updated.');
        return;
      }
      if (screen === 'reset') {
        await sendPasswordReset(email);
        setSuccess('If an account matches this email, a reset link will arrive shortly.');
        return;
      }
      if (screen === 'signup') {
        if (!adult) throw new Error('You must be at least 18 to join this community.');
        const result = await signUp(email, password, nickname, region);
        setPassword('');
        if (result.needsConfirmation)
          setSuccess('Check your email to confirm your account, then come back to sign in.');
        else onNotice('Welcome to Kindred. Your space to be heard.');
      } else {
        await signIn(email, password);
        setPassword('');
        onNotice('Welcome back.');
      }
    });
  };
  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await repository.saveProfile({ nickname, region, bio });
      await refreshProfile();
      setSuccess('Your profile has been saved.');
      onNotice('Profile updated.');
    });
  };
  const switchScreen = (next: typeof screen) => {
    setScreen(next);
    setError('');
    setSuccess('');
    setPassword('');
  };

  return (
    <Modal
      title={
        recovery ? 'Choose a new password' : profile ? 'Your little corner' : 'Welcome to Kindred'
      }
      onClose={onClose}
    >
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {contextError && (
        <p className="error-message" role="alert">
          {contextError}{' '}
          <button className="panel-text-button" onClick={() => void refreshProfile()}>
            Retry
          </button>
        </p>
      )}
      {success && (
        <p className="panel-success" role="status">
          {success}
        </p>
      )}
      {recovery ? (
        <form className="form-stack" onSubmit={submitAuth}>
          <p className="muted">Set a new password for your account.</p>
          <label className="field">
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <small className="muted">At least 10 characters.</small>
          <button className="button primary" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      ) : profile ? (
        <>
          <div className="account-intro">
            <Avatar profile={profile} size="lg" />
            <div>
              <h3>{profile.nickname}</h3>
              <p className="muted">
                {mode === 'demo'
                  ? 'Local demo profile · fictional community'
                  : 'A nickname is all you need to be known here.'}
              </p>
            </div>
          </div>
          {mode === 'demo' && (
            <div className="panel-note">
              You are exploring sample content. Demo changes stay in this browser; no real messages
              are sent.{' '}
              {configured && (
                <button
                  className="panel-text-button"
                  onClick={() => {
                    setError('');
                    enterLive();
                  }}
                >
                  Use a real account
                </button>
              )}
            </div>
          )}
          <form className="form-stack" onSubmit={saveProfile}>
            <label className="field">
              Nickname
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                minLength={2}
                maxLength={40}
                required
                autoComplete="nickname"
              />
            </label>
            <label className="field">
              Your region
              <select value={region} onChange={(event) => setRegion(event.target.value)}>
                {REGIONS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <p className="panel-help">
              Your nickname, region, and bio are visible to signed-in members. Share only what feels
              comfortable.
            </p>
            <label className="field">
              A little about you <span className="muted">(optional)</span>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                maxLength={300}
                rows={3}
                placeholder="Something you enjoy, or what brings you here…"
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
          </form>
          <section className="account-section">
            <h3>
              <ShieldCheck size={18} /> Your boundaries
            </h3>
            <p className="muted">
              Blocked members cannot interact with you. Unblocking lets them connect again.
            </p>
            {blockedLoading ? (
              <p role="status">Loading blocked members…</p>
            ) : blockedError ? (
              <p className="error-message" role="alert">
                {blockedError}{' '}
                <button
                  className="panel-text-button"
                  onClick={() => setBlockedRefresh((value) => value + 1)}
                >
                  Retry
                </button>
              </p>
            ) : !blocked.length ? (
              <p className="panel-help">You haven’t blocked anyone.</p>
            ) : (
              <ul className="blocked-list">
                {blocked.map((member) => (
                  <li key={member.id}>
                    <Avatar profile={member} size="sm" />
                    <span>{member.nickname}</span>
                    <button
                      className="button ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await repository.unblockUser(member.id);
                          setBlockedRefresh((value) => value + 1);
                          onNotice('Member unblocked.');
                        })
                      }
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {mode === 'live' && (
            <button
              className="button ghost account-signout"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await logout();
                  onNotice('You have signed out.');
                  onClose();
                })
              }
            >
              <LogOut size={17} /> Sign out
            </button>
          )}
        </>
      ) : loading ? (
        <p role="status">Getting your account ready…</p>
      ) : session && mode === 'live' ? (
        <div className="form-stack">
          <p>
            Your sign-in succeeded, but your community profile needs to finish setting up. Please
            retry or contact the administrator if this continues.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void run(refreshProfile)}
          >
            Retry profile setup
          </button>
          <button
            className="button ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await logout();
                onNotice('You have signed out.');
              })
            }
          >
            Sign out
          </button>
        </div>
      ) : (
        <>
          <div className="account-welcome">
            <UserRound size={29} />
            <p>A place to share what’s on your mind, and find people who listen.</p>
          </div>
          {!configured ? (
            <div className="panel-note">
              Real accounts will be available when this project is connected to its database. You
              can explore the fictional local community now.
              <button
                className="button primary"
                onClick={() => {
                  enterDemo();
                  onClose();
                }}
              >
                Explore the demo
              </button>
            </div>
          ) : (
            <>
              <div className="panel-tabs" aria-label="Account options">
                <button
                  type="button"
                  className={screen === 'signin' ? 'active' : ''}
                  onClick={() => switchScreen('signin')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={screen === 'signup' ? 'active' : ''}
                  onClick={() => switchScreen('signup')}
                >
                  Join the community
                </button>
              </div>
              <form className="form-stack" onSubmit={submitAuth}>
                {screen === 'reset' && (
                  <p className="muted">We’ll email you a link to choose a new password.</p>
                )}
                <label className="field">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                {screen !== 'reset' && (
                  <label className="field">
                    Password
                    <input
                      type="password"
                      autoComplete={screen === 'signup' ? 'new-password' : 'current-password'}
                      minLength={screen === 'signup' ? 10 : undefined}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    {screen === 'signup' && (
                      <small className="muted">At least 10 characters.</small>
                    )}
                  </label>
                )}
                {screen === 'signup' && (
                  <>
                    <label className="field">
                      Nickname
                      <input
                        autoComplete="nickname"
                        value={nickname}
                        onChange={(event) => setNickname(event.target.value)}
                        minLength={2}
                        maxLength={40}
                        required
                      />
                    </label>
                    <label className="field">
                      Your region
                      <select value={region} onChange={(event) => setRegion(event.target.value)}>
                        {REGIONS.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="panel-checkbox">
                      <input
                        type="checkbox"
                        checked={adult}
                        onChange={(event) => setAdult(event.target.checked)}
                        required
                      />
                      <span>
                        I’m 18 or older and agree to treat people with kindness and respect their
                        boundaries.
                      </span>
                    </label>
                    <p className="panel-help">
                      Kindred is a peer-support community. Members are not providing professional
                      care.
                    </p>
                  </>
                )}
                <button className="button primary" disabled={busy}>
                  {busy
                    ? 'One moment…'
                    : screen === 'signup'
                      ? 'Create account'
                      : screen === 'reset'
                        ? 'Send reset link'
                        : 'Sign in'}
                </button>
              </form>
              {screen === 'signin' && (
                <button
                  className="panel-text-button account-forgot"
                  onClick={() => switchScreen('reset')}
                >
                  Forgot your password?
                </button>
              )}
              <button
                className="panel-text-button account-forgot"
                onClick={() => {
                  enterDemo();
                  onClose();
                }}
              >
                Explore the demo
              </button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
