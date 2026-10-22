// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoRepository } from '../src/lib/demo-repository';
import type { CommunityRepository, Profile } from '../src/lib/types';
import PostComposer from '../src/components/PostComposer';
import Feed from '../src/components/Feed';
import Inbox from '../src/components/Inbox';
import Modal from '../src/components/Modal';

const context = vi.hoisted(() => ({
  value: {} as { repository: CommunityRepository; profile: Profile | null; mode: 'demo' },
}));
vi.mock('../src/lib/community', () => ({
  useCommunity: () => context.value,
  errorMessage: (cause: unknown) =>
    cause instanceof Error ? cause.message : 'Something went wrong.',
}));

beforeEach(async () => {
  const repository = new DemoRepository({ storage: null });
  context.value = { repository, profile: await repository.getProfile(), mode: 'demo' };
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('community UI regressions', () => {
  it('prevents too-short posts and publishes the allowed 3000-character boundary', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const create = vi.spyOn(context.value.repository, 'createPost');
    render(<PostComposer onCreated={onCreated} onNotice={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Your update' });
    fireEvent.change(input, { target: { value: 'short' } });
    const share = screen.getByRole('button', { name: /Share your thoughts/ }) as HTMLButtonElement;
    expect(share.disabled).toBe(true);
    await user.click(share);
    expect(create).not.toHaveBeenCalled();
    expect(input.getAttribute('maxlength')).toBe('3000');
    fireEvent.change(input, { target: { value: 'x'.repeat(3000) } });
    await user.click(share);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ body: 'x'.repeat(3000) }));
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('locks a pending publication against duplicate clicks', async () => {
    let finish!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const actual = context.value.repository.createPost.bind(context.value.repository);
    const create = vi
      .spyOn(context.value.repository, 'createPost')
      .mockImplementation(async (input) => {
        await barrier;
        return actual(input);
      });
    render(<PostComposer onCreated={vi.fn()} onNotice={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Your update' }), {
      target: { value: 'Today I am sharing a little win.' },
    });
    const button = screen.getByRole('button', { name: /Share your thoughts/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(create).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: /Sharing/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    finish();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: /Share your thoughts/ }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it('keeps support actions usable after the StrictMode effect cleanup cycle', async () => {
    const user = userEvent.setup();
    const support = vi.spyOn(context.value.repository, 'toggleSupport');
    render(
      <StrictMode>
        <Feed onMessage={vi.fn()} onNotice={vi.fn()} />
      </StrictMode>,
    );
    const original = (await screen.findAllByRole('button', { name: /Here for you|With you/ }))[0];
    const post = original.closest('article')!;
    await user.click(original);
    await waitFor(() =>
      expect(
        (within(post).getByRole('button', { name: /Here for you|With you/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(within(post).getByRole('button', { name: /Here for you|With you/ }));
    await waitFor(() => expect(support).toHaveBeenCalledTimes(2));
  });

  it('requires incoming request acceptance before rendering a send form', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(context.value.repository, 'sendMessage');
    render(<Inbox initialConversationId="demo-conversation-2" onNotice={vi.fn()} />);
    const accept = await screen.findByRole('button', { name: 'Accept request' });
    expect(screen.queryByRole('textbox', { name: 'Your message' })).toBeNull();
    await user.click(accept);
    const input = await screen.findByRole('textbox', { name: 'Your message' });
    await user.type(input, 'Thank you for reaching out.');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(
      await within(screen.getByLabelText('Messages with Jules')).findByText(
        'Thank you for reaching out.',
      ),
    ).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not offer self-acceptance or sending for an outgoing request', async () => {
    const conversation = await context.value.repository.requestConversation('demo-sam');
    render(<Inbox initialConversationId={conversation.id} onNotice={vi.fn()} />);
    await screen.findByText('Your invitation is on its way');
    expect(screen.queryByRole('button', { name: 'Accept request' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Your message' })).toBeNull();
  });

  it('removes the open thread and send form after blocking a connection', async () => {
    const user = userEvent.setup();
    render(<Inbox initialConversationId="demo-conversation-1" onNotice={vi.fn()} />);
    await screen.findByRole('textbox', { name: 'Your message' });
    await user.click(screen.getByRole('button', { name: 'Block Maya' }));
    await user.click(screen.getByRole('button', { name: /^Block member$/ }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Your message' })).toBeNull());
    expect(
      (await context.value.repository.listBlocked()).map((person) => person.nickname),
    ).toContain('Maya');
    expect(screen.queryByLabelText('Messages with Maya')).toBeNull();
  });

  it('closes an accessible dialog through Escape and restores prior focus', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Open dialog';
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <Modal title="Your boundaries" onClose={close}>
        <button>Confirm</button>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Your boundaries' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
