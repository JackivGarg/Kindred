import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, EyeOff, LogOut, MailCheck, ShieldCheck, UserRound } from 'lucide-react';
import { errorMessage, useCommunity } from '../lib/community';
import {
  authErrorMessage,
  resendConfirmation,
  sendPasswordReset,
  signIn,
  signUp,
  updatePassword,
  validateNewPassword,
} from '../lib/auth';
import { REGIONS, type Profile } from '../lib/types';
import Avatar from './Avatar';
import Modal from './Modal';
import './panels.css';

type Screen = 'signin' | 'signup' | 'reset' | 'confirmation';
type Fields = Partial<Record<'email' | 'password' | 'confirm' | 'nickname' | 'adult', string>>;
function PasswordField({
  label,
  value,
  onChange,
  error,
  fresh = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  fresh?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(false), [label, fresh]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="account-password">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={fresh ? 'new-password' : 'current-password'}
          required
          value={value}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="account-password-toggle"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {error && (
        <span id={`${id}-error`} className="account-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export default function AccountPanel({
  onClose,
  onNotice,
  initialScreen = 'signin',
}: {
  onClose: () => void;
  onNotice: (message: string) => void;
  initialScreen?: 'signin' | 'signup';
}) {
  const context = useCommunity();
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
  } = context;
  // Callback status is optional so this panel also works with isolated embedding/test contexts.
  const { authLinkError, authLinkNotice, clearAuthLinkStatus } = context as typeof context & {
    authLinkError?: string;
    authLinkNotice?: string;
    clearAuthLinkStatus?: () => void;
  };
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [email, setEmail] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [region, setRegion] = useState(profile?.region ?? 'India');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Fields>({});
  const [success, setSuccess] = useState('');
  const [recovered, setRecovered] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [blockedError, setBlockedError] = useState('');
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blockedRefresh, setBlockedRefresh] = useState(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  const revision = useRef(0);
  const identity = `${mode}-${session?.user.id ?? profile?.id ?? 'guest'}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const seconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);
  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname);
      setRegion(profile.region);
      setBio(profile.bio);
    }
  }, [profile]);
  useEffect(() => {
    let active = true;
    if (!profile) return;
    setBlockedLoading(true);
    setBlockedError('');
    repository
      .listBlocked()
      .then((value) => {
        if (active) setBlocked(value);
      })
      .catch((cause) => {
        if (active) setBlockedError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setBlockedLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repository, profile?.id, blockedRefresh]);
  async function run<T>(action: () => Promise<T>, done?: (value: T) => void) {
    if (locked.current) return;
    locked.current = true;
    const ticket = ++revision.current;
    const owner = identity;
    const current = () =>
      mounted.current && ticket === revision.current && owner === currentIdentity.current;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const value = await action();
      if (current()) done?.(value);
    } catch (cause) {
      if (current()) {
        setError(authErrorMessage(cause));
        setUnconfirmed(
          typeof cause === 'object' &&
            cause !== null &&
            'code' in cause &&
            cause.code === 'email_not_confirmed',
        );
      }
    } finally {
      locked.current = false;
      if (current()) setBusy(false);
    }
  }
  function switchScreen(next: Screen) {
    if (locked.current) return;
    revision.current++;
    clearAuthLinkStatus?.();
    setScreen(next);
    setFields({});
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
    setUnconfirmed(false);
  }
  function validate(): boolean {
    const next: Fields = {};
    if (!recovery && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    if (recovery || screen === 'signup') {
      try {
        validateNewPassword(password);
      } catch (cause) {
        next.password = authErrorMessage(cause);
      }
      if (password !== confirmPassword) next.confirm = 'The passwords do not match.';
    } else if (screen === 'signin' && !password) next.password = 'Enter your password.';
    if (!recovery && screen === 'signup') {
      if (nickname.trim().length < 2 || nickname.trim().length > 40)
        next.nickname = 'Choose a nickname between 2 and 40 characters.';
      if (!adult) next.adult = 'You must be 18 or older to join this community.';
    }
    setFields(next);
    setError(Object.keys(next).length ? 'Please check the highlighted fields below.' : '');
    return Object.keys(next).length === 0;
  }
  function submitAuth(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !validate()) return;
    if (recovery) {
      void run(
        () => updatePassword(password),
        () => {
          setRecovered(true);
          setPassword('');
          setConfirmPassword('');
          onNotice('Your password has been updated.');
        },
      );
      return;
    }
    if (screen === 'reset') {
      void run(
        () => sendPasswordReset(email),
        () =>
          setSuccess(
            'If an account matches this email, a reset link will arrive shortly. Check your inbox and spam folder.',
          ),
      );
      return;
    }
    if (screen === 'signup') {
      void run(
        () => signUp(email, password, nickname, region),
        (result) => {
          setPassword('');
          setConfirmPassword('');
          if (result.needsConfirmation) {
            setConfirmationEmail(email.trim());
            setScreen('confirmation');
            setCooldownUntil(Date.now() + 60_000);
            setNow(Date.now());
          } else {
            onNotice('Welcome to Kindred. Your space to be heard.');
            onClose();
          }
        },
      );
      return;
    }
    void run(
      () => signIn(email, password),
      () => {
        setPassword('');
        onNotice('Welcome back.');
        onClose();
      },
    );
  }
  function resend() {
    if (locked.current || Date.now() < cooldownUntil) return;
    const address = screen === 'confirmation' ? confirmationEmail : email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setFields({ email: 'Enter a valid email address.' });
      return;
    }
    setCooldownUntil(Date.now() + 60_000);
    setNow(Date.now());
    void run(
      () => resendConfirmation(address),
      () =>
        setSuccess(
          'If this address needs confirmation, a new link will arrive shortly. Check your inbox and spam folder.',
        ),
    );
  }
  function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (nickname.trim().length < 2 || nickname.trim().length > 40) {
      setFields({ nickname: 'Choose a nickname between 2 and 40 characters.' });
      return;
    }
    void run(
      async () => {
        await repository.saveProfile({ nickname, region, bio });
        await refreshProfile();
      },
      () => {
        setSuccess('Your profile has been saved.');
        onNotice('Profile updated.');
      },
    );
  }
  const emailField = (
    <label className="field">
      Email
      <input
        type="email"
        autoComplete="email"
        required
        value={email}
        disabled={busy}
        aria-invalid={!!fields.email}
        aria-describedby={fields.email ? 'account-email-error' : undefined}
        onChange={(event) => setEmail(event.target.value)}
      />
      {fields.email && (
        <span id="account-email-error" className="account-field-error">
          {fields.email}
        </span>
      )}
    </label>
  );
  const nicknameField = (
    <label className="field">
      Nickname
      <input
        autoComplete="nickname"
        value={nickname}
        onChange={(event) => setNickname(event.target.value)}
        minLength={2}
        maxLength={40}
        required
        disabled={busy}
        aria-invalid={!!fields.nickname}
      />
      {fields.nickname && <span className="account-field-error">{fields.nickname}</span>}
    </label>
  );
  const regionField = (
    <label className="field">
      Your region
      <select value={region} disabled={busy} onChange={(event) => setRegion(event.target.value)}>
        {REGIONS.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </label>
  );
  return (
    <Modal
      title={
        recovery
          ? 'Choose a new password'
          : profile
            ? 'Your little corner'
            : screen === 'confirmation'
              ? 'Check your inbox'
              : screen === 'reset'
                ? 'Let’s get you back in'
                : 'Welcome to Kindred'
      }
      onClose={onClose}
    >
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {authLinkError && (
        <p className="error-message" role="alert">
          {authLinkError} You can sign in, request a fresh confirmation email, or reset your
          password below.
        </p>
      )}
      {authLinkNotice && (
        <p className="panel-success" role="status">
          {authLinkNotice}
        </p>
      )}
      {contextError && (
        <p className="error-message" role="alert">
          {contextError}{' '}
          <button
            className="panel-text-button"
            disabled={busy}
            onClick={() => void run(refreshProfile)}
          >
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
        recovered ? (
          <div className="account-complete">
            <CheckCircle2 size={42} />
            <h3>A fresh start.</h3>
            <p>Your password is updated. You can return to your community.</p>
            <button
              className="button primary"
              onClick={() => {
                clearRecovery();
                onClose();
              }}
            >
              Continue to Kindred
            </button>
          </div>
        ) : (
          <form className="form-stack" noValidate onSubmit={submitAuth}>
            <p className="muted">Choose a password you haven’t used elsewhere.</p>
            <PasswordField
              label="New password"
              value={password}
              onChange={setPassword}
              error={fields.password}
              fresh
              disabled={busy}
            />
            <PasswordField
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              error={fields.confirm}
              fresh
              disabled={busy}
            />
            <p className="panel-help">
              Use at least 10 characters. A unique phrase can be easier to remember.
            </p>
            <button className="button primary" disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )
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
                <button className="panel-text-button" disabled={busy} onClick={enterLive}>
                  Use a real account
                </button>
              )}
            </div>
          )}
          <form className="form-stack" noValidate onSubmit={saveProfile}>
            {nicknameField}
            {regionField}
            <p className="panel-help">
              Your nickname, region, and bio are visible to signed-in members. Share only what feels
              comfortable.
            </p>
            <label className="field">
              A little about you <span className="muted">(optional)</span>
              <textarea
                value={bio}
                disabled={busy}
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
              <ShieldCheck size={18} />
              Your boundaries
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
                        void run(
                          () => repository.unblockUser(member.id),
                          () => {
                            setBlockedRefresh((value) => value + 1);
                            onNotice('Member unblocked.');
                          },
                        )
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
                void run(logout, () => {
                  onNotice('You have signed out.');
                  onClose();
                })
              }
            >
              <LogOut size={17} />
              Sign out
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
          <button className="button ghost" disabled={busy} onClick={() => void run(logout)}>
            Sign out
          </button>
        </div>
      ) : !configured ? (
        <div className="panel-note">
          Real accounts will be available when this project is connected to its database. You can
          explore the fictional local community now.
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
      ) : screen === 'confirmation' ? (
        <div className="account-complete">
          <MailCheck size={44} />
          <h3>One small step to your community.</h3>
          <p>
            If this address is eligible, a confirmation link has been sent to{' '}
            <strong>{confirmationEmail}</strong>. Open it to finish joining, then sign in.
          </p>
          <p className="panel-help">
            Check spam or promotions, too. For your privacy, this message does not confirm whether
            an account already exists.
          </p>
          <button className="button primary" disabled={busy || seconds > 0} onClick={resend}>
            {seconds > 0
              ? `Resend available in ${seconds}s`
              : busy
                ? 'Sending…'
                : 'Resend confirmation email'}
          </button>
          <button
            className="panel-text-button"
            disabled={busy}
            onClick={() => switchScreen('signin')}
          >
            Back to sign in
          </button>
          <button
            className="panel-text-button"
            disabled={busy}
            onClick={() => switchScreen('signup')}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <>
          <div className="account-welcome">
            <UserRound size={29} />
            <p>A place to share what’s on your mind, and find people who listen.</p>
          </div>
          <div className="panel-tabs" aria-label="Account options">
            <button
              type="button"
              disabled={busy}
              className={screen === 'signin' ? 'active' : ''}
              aria-current={screen === 'signin' ? 'page' : undefined}
              onClick={() => switchScreen('signin')}
            >
              Sign in
            </button>
            <button
              type="button"
              disabled={busy}
              className={screen === 'signup' ? 'active' : ''}
              aria-current={screen === 'signup' ? 'page' : undefined}
              onClick={() => switchScreen('signup')}
            >
              Join the community
            </button>
          </div>
          <form className="form-stack" noValidate onSubmit={submitAuth}>
            {screen === 'reset' && (
              <p className="muted">We’ll email you a link to choose a new password.</p>
            )}
            {emailField}
            {screen !== 'reset' && (
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                error={fields.password}
                fresh={screen === 'signup'}
                disabled={busy}
              />
            )}
            {screen === 'signup' && (
              <>
                <PasswordField
                  label="Confirm password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  error={fields.confirm}
                  fresh
                  disabled={busy}
                />
                <p className="panel-help">Use a unique password with at least 10 characters.</p>
                {nicknameField}
                <p className="panel-help">
                  Choose any nickname. Your real name is not required, and your email stays private.
                </p>
                {regionField}
                <label className="panel-checkbox">
                  <input
                    type="checkbox"
                    checked={adult}
                    onChange={(event) => setAdult(event.target.checked)}
                    disabled={busy}
                    aria-invalid={!!fields.adult}
                    required
                  />
                  <span>
                    I’m 18 or older and agree to treat people with kindness and respect their
                    boundaries.
                  </span>
                </label>
                {fields.adult && <span className="account-field-error">{fields.adult}</span>}
                <p className="panel-help">
                  Kindred is a peer-support community. Members are not providing professional care.
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
          {(unconfirmed || authLinkError) && (
            <button
              className="panel-text-button account-forgot"
              disabled={busy || seconds > 0}
              onClick={resend}
            >
              {seconds > 0 ? `Resend available in ${seconds}s` : 'Resend confirmation email'}
            </button>
          )}
          {screen === 'signin' ? (
            <button
              className="panel-text-button account-forgot"
              disabled={busy}
              onClick={() => switchScreen('reset')}
            >
              Forgot your password?
            </button>
          ) : (
            screen === 'reset' && (
              <button
                className="panel-text-button account-forgot"
                disabled={busy}
                onClick={() => switchScreen('signin')}
              >
                Back to sign in
              </button>
            )
          )}
          <button
            className="panel-text-button account-forgot"
            disabled={busy}
            onClick={() => {
              enterDemo();
              onClose();
            }}
          >
            Explore the demo
          </button>
        </>
      )}
    </Modal>
  );
}
