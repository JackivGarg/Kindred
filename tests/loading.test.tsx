// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityRepository, Conversation, Message, Post, Profile } from '../src/lib/types';

const state = vi.hoisted(() => ({
  current: {} as {
    repository: CommunityRepository;
    profile: Profile | null;
    mode: 'live' | 'demo';
  },
}));
vi.mock('../src/lib/community', () => ({
  useCommunity: () => state.current,
  errorMessage: (cause: unknown) => (cause instanceof Error ? cause.message : 'Request failed'),
}));
vi.mock('../src/components/PostComposer', () => ({
  default: ({ onCreated }: { onCreated: () => void }) => (
    <button onClick={onCreated}>Publish fixture</button>
  ),
}));
import Feed from '../src/components/Feed';
import Inbox from '../src/components/Inbox';

const member: Profile = {
  id: 'member-a',
  nickname: 'Alex',
  region: 'India',
  bio: '',
  created_at: '2026-10-22T00:00:00Z',
};
const other: Profile = { ...member, id: 'member-b', nickname: 'River' };
const story: Post = {
  id: 'post-a',
  author_id: other.id,
  body: 'Taking one small step today.',
  topic: 'Everyday life',
  mood: 'Hopeful',
  scope: 'global',
  region: null,
  created_at: member.created_at,
  author: other,
  support_count: 2,
  supported: false,
  comment_count: 0,
};
const conversation: Conversation = {
  id: 'thread-a',
  requester_id: member.id,
  recipient_id: other.id,
  status: 'accepted',
  created_at: member.created_at,
  other,
};
const firstMessage: Message = {
  id: 'message-a',
  conversation_id: conversation.id,
  sender_id: other.id,
  body: 'A gentle hello.',
  created_at: member.created_at,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function repository() {
  return {
    listPosts: vi.fn().mockResolvedValue([story]),
    toggleSupport: vi.fn().mockResolvedValue(undefined),
    listComments: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue({
      id: 'comment-a',
      post_id: story.id,
      author_id: member.id,
      author: member,
      body: 'I hear you.',
      created_at: member.created_at,
    }),
    deleteComment: vi.fn().mockResolvedValue(undefined),
    listConversations: vi.fn().mockResolvedValue([conversation]),
    listMessages: vi.fn().mockResolvedValue([firstMessage]),
    sendMessage: vi.fn(),
    report: vi.fn().mockResolvedValue(undefined),
    blockUser: vi.fn().mockResolvedValue(undefined),
  };
}
let repo: ReturnType<typeof repository>;
beforeEach(() => {
  repo = repository();
  state.current = {
    repository: repo as unknown as CommunityRepository,
    profile: member,
    mode: 'live',
  };
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('feed requests', () => {
  it('updates support and replies without refetching the feed or comments', async () => {
    render(<Feed onMessage={vi.fn()} onNotice={vi.fn()} />);
    await screen.findByText(story.body);
    fireEvent.click(screen.getByRole('button', { name: /Here for you/ }));
    await screen.findByRole('button', { name: /With you/ });
    expect(repo.listPosts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /0 replies/ }));
    await screen.findByText('A kind word can make a difference. Be the first to reply.');
    fireEvent.change(screen.getByLabelText('Write a supportive reply'), {
      target: { value: 'I hear you.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByText('I hear you.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete your reply' }));
    await waitFor(() => expect(screen.queryByText('I hear you.')).toBeNull());
    expect(repo.listPosts).toHaveBeenCalledTimes(1);
    expect(repo.listComments).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /0 replies/ }));
    fireEvent.click(screen.getByRole('button', { name: /0 replies/ }));
    expect(repo.listComments).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good feed during refresh and suppresses a stale filter response', async () => {
    const { rerender } = render(<Feed onMessage={vi.fn()} onNotice={vi.fn()} />);
    await screen.findByText(story.body);
    const refresh = deferred<Post[]>();
    repo.listPosts.mockReturnValueOnce(refresh.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Publish fixture' }));
    expect(screen.getByText(story.body)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Updating stories…');
    repo.listPosts.mockResolvedValueOnce([
      { ...story, id: 'new-result', body: 'The current search result.' },
    ]);
    rerender(<Feed search="current" onMessage={vi.fn()} onNotice={vi.fn()} />);
    await screen.findByText('The current search result.');
    await act(async () => refresh.resolve([{ ...story, body: 'Old response must be ignored.' }]));
    expect(screen.queryByText('Old response must be ignored.')).toBeNull();
    expect(screen.getByText('The current search result.')).toBeTruthy();
  });
});

describe('inbox requests', () => {
  it('uses a cursor after the initial snapshot and stops polling after unmount', async () => {
    repo.listMessages.mockResolvedValueOnce([firstMessage]).mockResolvedValue([]);
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<Inbox initialConversationId={conversation.id} onNotice={vi.fn()} />);
    });
    expect(screen.getByText(firstMessage.body)).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    expect(repo.listMessages).toHaveBeenLastCalledWith(conversation.id, {
      created_at: firstMessage.created_at,
      id: firstMessage.id,
    });
    const messageCalls = repo.listMessages.mock.calls.length;
    const listCalls = repo.listConversations.mock.calls.length;
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(120000));
    expect(repo.listMessages).toHaveBeenCalledTimes(messageCalls);
    expect(repo.listConversations).toHaveBeenCalledTimes(listCalls);
  });

  it('backs off quiet inbox requests instead of reading both endpoints every eight seconds', async () => {
    vi.useFakeTimers();
    repo.listMessages.mockImplementation((_id: string, after: unknown) =>
      Promise.resolve(after ? [] : [firstMessage]),
    );
    await act(async () => {
      render(<Inbox initialConversationId={conversation.id} onNotice={vi.fn()} />);
    });
    await act(async () => vi.advanceTimersByTimeAsync(120000));
    // Previous fixed polling read each endpoint 16 times over this period.
    expect(repo.listConversations.mock.calls.length).toBeLessThanOrEqual(4);
    expect(repo.listMessages.mock.calls.length).toBeLessThanOrEqual(8);
    expect(repo.listMessages.mock.calls.some((call) => call[1] !== undefined)).toBe(true);
  });

  it('pauses both polls when hidden or offline and refreshes on return', async () => {
    render(<Inbox initialConversationId={conversation.id} onNotice={vi.fn()} />);
    await screen.findByText(firstMessage.body);
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    const before = repo.listMessages.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(120000));
    expect(repo.listMessages).toHaveBeenCalledTimes(before);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    act(() => window.dispatchEvent(new Event('offline')));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(120000));
    expect(repo.listMessages).toHaveBeenCalledTimes(before);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(repo.listMessages).toHaveBeenCalledTimes(before + 1);
  });

  it('does not overlap slow message requests and ignores the old thread result', async () => {
    const otherThread = {
      ...conversation,
      id: 'thread-b',
      other: { ...other, id: 'member-c', nickname: 'Sky' },
    };
    repo.listConversations.mockResolvedValue([conversation, otherThread]);
    const pending = deferred<Message[]>();
    repo.listMessages.mockReturnValueOnce(pending.promise).mockResolvedValue([]);
    const view = render(<Inbox initialConversationId={conversation.id} onNotice={vi.fn()} />);
    await waitFor(() => expect(repo.listMessages).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(repo.listMessages).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Sky/ }));
    await waitFor(() => expect(repo.listMessages).toHaveBeenCalledTimes(2));
    await act(async () => pending.resolve([firstMessage]));
    expect(screen.queryByText(firstMessage.body)).toBeNull();
    view.unmount();
  });
});
