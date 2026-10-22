// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DemoRepository } from '../src/lib/demo-repository';
import type { CommunityRepository, Profile } from '../src/lib/types';
import Inbox from '../src/components/Inbox';
import Feed from '../src/components/Feed';

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

describe('loading privacy boundaries', () => {
  it('removes blocked authors from already-loaded replies on another member’s post', async () => {
    const posts = await context.value.repository.listPosts();
    const maya = posts.find((post) => post.author_id === 'demo-maya')!.author;
    const samsPost = posts.find((post) => post.author_id === 'demo-sam')!;
    const list = vi.spyOn(context.value.repository, 'listPosts');
    vi.spyOn(context.value.repository, 'listComments').mockResolvedValue([
      {
        id: 'cached-reply',
        post_id: samsPost.id,
        author_id: maya.id,
        author: maya,
        body: 'A cached reply from the blocked author.',
        created_at: maya.created_at,
      },
    ]);
    render(<Feed onMessage={vi.fn()} onNotice={vi.fn()} />);
    const samCard = (await screen.findByText(samsPost.body)).closest('article')!;
    fireEvent.click(within(samCard).getByRole('button', { name: /repl/ }));
    await screen.findByText('A cached reply from the blocked author.');
    fireEvent.click(screen.getAllByRole('button', { name: "Options for Maya's post" })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Block member' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Block Maya?' })).getByRole('button', {
        name: 'Block member',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('A cached reply from the blocked author.')).toBeNull(),
    );
    expect(screen.getByText(samsPost.body)).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('discards the prior inbox immediately on repository identity changes and can load the new inbox', async () => {
    const { rerender } = render(
      <Inbox initialConversationId="demo-conversation-1" onNotice={vi.fn()} />,
    );
    await screen.findByRole('button', { name: /^Maya/ });
    await screen.findByLabelText('Messages with Maya');
    const next = new DemoRepository({ storage: null });
    const original = next.listConversations.bind(next);
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(next, 'listConversations').mockImplementation(async () => {
      await blocked;
      return (await original()).map((item) => ({
        ...item,
        other: { ...item.other, nickname: `New ${item.other.nickname}` },
      }));
    });
    context.value = { ...context.value, repository: next };
    rerender(<Inbox initialConversationId="demo-conversation-1" onNotice={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Maya/ })).toBeNull();
    expect(screen.queryByLabelText('Messages with Maya')).toBeNull();
    await act(async () => {
      finish();
      await blocked;
    });
    expect(await screen.findByRole('button', { name: /^New Maya/ })).toBeTruthy();
  });

  it('removes cached messages when authoritative history reconciliation no longer returns them', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const original = context.value.repository.listMessages.bind(context.value.repository);
    const initial = await original('demo-conversation-1');
    const load = vi
      .spyOn(context.value.repository, 'listMessages')
      .mockResolvedValueOnce(initial)
      .mockResolvedValue([]);
    render(<Inbox initialConversationId="demo-conversation-1" onNotice={vi.fn()} />);
    await screen.findByLabelText('Messages with Maya');
    await waitFor(() =>
      expect(screen.getByLabelText('Messages with Maya').textContent).toContain(initial[0].body),
    );
    now += 61000;
    fireEvent.focus(window);
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() =>
      expect(screen.getByLabelText('Messages with Maya').textContent).not.toContain(
        initial[0].body,
      ),
    );
  });

  it('discards cached messages after conversation access is lost during a poll', async () => {
    const initial = await context.value.repository.listMessages('demo-conversation-1');
    vi.spyOn(context.value.repository, 'listMessages')
      .mockResolvedValueOnce(initial)
      .mockRejectedValue(new Error('Conversation access removed.'));
    render(<Inbox initialConversationId="demo-conversation-1" onNotice={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Messages with Maya').textContent).toContain(initial[0].body),
    );
    fireEvent.focus(window);
    await screen.findByText(/Conversation access removed/);
    expect(screen.getByLabelText('Messages with Maya').textContent).not.toContain(initial[0].body);
  });
});
