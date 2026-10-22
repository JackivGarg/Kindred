// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountPanel from '../src/components/AccountPanel';

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  resendConfirmation: vi.fn(),
}));
vi.mock('../src/lib/community', () => ({
  useCommunity: () => state.value,
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Something went wrong.',
}));
vi.mock('../src/lib/auth', () => ({
  ...auth,
  authErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Account action failed.',
  validateNewPassword: (password: string) => {
    if (password.length < 10) throw Error('Use a password with at least 10 characters.');
    if (new TextEncoder().encode(password).length > 72) throw Error('This password is too long.');
  },
}));
const close = vi.fn();
const notice = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(auth)) mock.mockResolvedValue(undefined);
  auth.signUp.mockResolvedValue({ needsConfirmation: true });
  state.value = {
    repository: { listBlocked: vi.fn().mockResolvedValue([]) },
    profile: null,
    session: null,
    mode: 'live',
    configured: true,
    loading: false,
    error: '',
    recovery: false,
    clearRecovery: vi.fn(),
    clearAuthLinkStatus: vi.fn(),
    refreshProfile: vi.fn(),
    enterDemo: vi.fn(),
    enterLive: vi.fn(),
    logout: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function mount() {
  return render(
    <StrictMode>
      <AccountPanel onClose={close} onNotice={notice} />
    </StrictMode>,
  );
}
function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function signup(confirm = 'a thoughtful password') {
  fireEvent.click(screen.getByRole('button', { name: 'Join the community' }));
  change('Email', 'listener@example.com');
  change('Password', 'a thoughtful password');
  change('Confirm password', confirm);
  change('Nickname', 'Listener');
  fireEvent.click(screen.getByRole('checkbox'));
}
describe('complete account journeys', () => {
  it('opens directly on registration when a visitor chooses Join', () => {
    render(<AccountPanel initialScreen="signup" onClose={close} onNotice={notice} />);
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.getByLabelText('Confirm password')).toBeTruthy();
  });
  it('checks matching passwords inline before creating an account and then explains confirmation', async () => {
    mount();
    signup('different password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('The passwords do not match.')).toBeTruthy();
    expect(auth.signUp).not.toHaveBeenCalled();
    change('Confirm password', 'a thoughtful password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Check your inbox' });
    expect(auth.signUp).toHaveBeenCalledWith(
      'listener@example.com',
      'a thoughtful password',
      'Listener',
      'India',
    );
    expect(screen.getByText('listener@example.com')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
  it('locks repeated submissions synchronously, including in StrictMode', async () => {
    let finish!: () => void;
    auth.signIn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    change('Email', 'listener@example.com');
    change('Password', 'a thoughtful password');
    const form = screen.getByLabelText('Email').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(close).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith('Welcome back.');
  });
  it('enforces a confirmation resend cooldown and sends a neutral result', async () => {
    vi.useFakeTimers();
    mount();
    signup();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create account' })));
    expect(
      (screen.getByRole('button', { name: /Resend available in 60s/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(auth.resendConfirmation).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(60_000));
    await act(async () => {
      const button = screen.getByRole('button', { name: 'Resend confirmation email' });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(auth.resendConfirmation).toHaveBeenCalledTimes(1);
    expect(auth.resendConfirmation).toHaveBeenCalledWith('listener@example.com');
    expect(screen.getByText(/If this address needs confirmation/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Resend available in 60s/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it('offers reset instructions without revealing account existence and returns to sign in', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    change('Email', 'listener@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByText(/If an account matches this email/);
    expect(auth.sendPasswordReset).toHaveBeenCalledWith('listener@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('listener@example.com');
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
  it('requires recovery confirmation and preserves the success screen until Continue', async () => {
    state.value.recovery = true;
    mount();
    change('New password', 'another thoughtful password');
    change('Confirm new password', 'does not match');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(auth.updatePassword).not.toHaveBeenCalled();
    expect(screen.getByText('The passwords do not match.')).toBeTruthy();
    change('Confirm new password', 'another thoughtful password');
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await screen.findByText('A fresh start.');
    expect(auth.updatePassword).toHaveBeenCalledWith('another thoughtful password');
    expect(state.value.clearRecovery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Kindred' }));
    expect(state.value.clearRecovery).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('makes password visibility an explicit accessible button', () => {
    mount();
    change('Password', 'a thoughtful password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    expect(auth.signIn).not.toHaveBeenCalled();
  });
  it('surfaces email delivery failure and preserves the form for retry', async () => {
    auth.signUp.mockRejectedValue(Error('Email delivery is temporarily unavailable.'));
    mount();
    signup();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Email delivery is temporarily unavailable.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Check your inbox' })).toBeNull();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('listener@example.com');
  });
  it('offers resend after an unconfirmed sign-in and ignores callbacks after unmount', async () => {
    auth.signIn.mockRejectedValue(
      Object.assign(Error('Confirm your email before signing in.'), {
        code: 'email_not_confirmed',
      }),
    );
    const view = mount();
    change('Email', 'listener@example.com');
    change('Password', 'a thoughtful password');
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
    await screen.findByRole('button', { name: 'Resend confirmation email' });
    let finish!: () => void;
    auth.resendConfirmation.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
    view.unmount();
    await act(async () => finish());
    expect(close).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });
  it('discards a pending signup result after a mode change', async () => {
    let finish!: (value: { needsConfirmation: boolean }) => void;
    auth.signUp.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount();
    signup();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    state.value = { ...state.value, mode: 'demo' };
    view.rerender(<AccountPanel onClose={close} onNotice={notice} />);
    await act(async () => finish({ needsConfirmation: true }));
    expect(screen.queryByRole('heading', { name: 'Check your inbox' })).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
  it('shows expired callback guidance and clears it on account navigation', () => {
    state.value.authLinkError = 'This email link expired.';
    mount();
    expect(screen.getByRole('alert').textContent).toContain('This email link expired.');
    expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    expect(state.value.clearAuthLinkStatus).toHaveBeenCalledTimes(1);
  });
});
