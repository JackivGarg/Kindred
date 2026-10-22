import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from '../src/lib/live-repository';

const user = '11111111-1111-4111-8111-111111111111';
const item = '22222222-2222-4222-8222-222222222222';
function mockClient(results: { data: unknown; error: unknown }[], uid: string | null = user) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [
    'select',
    'eq',
    'or',
    'order',
    'range',
    'insert',
    'update',
    'delete',
    'upsert',
    'match',
    'in',
    'ilike',
    'limit',
  ])
    chain[name] = vi.fn(() => chain);
  for (const name of ['maybeSingle', 'single', 'returns'])
    chain[name] = vi.fn(async () => results.shift() ?? { data: null, error: null });
  chain.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve),
  );
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: uid ? { id: uid } : null }, error: null })),
    },
    from: vi.fn(() => chain),
    rpc: vi.fn(),
  };
  return { repo: new SupabaseRepository(client as unknown as SupabaseClient), client, chain };
}
describe('live repository boundaries', () => {
  it('requires a verified signed-in identity before querying community content', async () => {
    const { repo, client } = mockClient([], null);
    await expect(repo.listPosts()).rejects.toThrow('sign in');
    expect(client.from).not.toHaveBeenCalled();
  });
  it('distinguishes a missing session from a profile-network outage', async () => {
    const signedOut = mockClient([], null);
    await expect(signedOut.repo.getProfile()).resolves.toBeNull();
    expect(signedOut.client.from).not.toHaveBeenCalled();
    const outage = mockClient([{ data: null, error: { message: 'Network unavailable' } }]);
    await expect(outage.repo.getProfile()).rejects.toThrow(
      'Load your profile: Network unavailable',
    );
  });
  it('pins deletion to the current author and reports an unavailable row', async () => {
    const { repo, chain } = mockClient([{ data: [], error: null }]);
    await expect(repo.deletePost(item)).rejects.toThrow('does not belong to you');
    expect(chain.eq).toHaveBeenCalledWith('author_id', user);
  });
  it('does not write messages until an accepted conversation is visible', async () => {
    const { repo, client, chain } = mockClient([
      { data: { id: item, status: 'pending' }, error: null },
    ]);
    await expect(repo.sendMessage(item, 'Here to listen.')).rejects.toThrow('must accept');
    expect(client.from).not.toHaveBeenCalledWith('messages');
    expect(chain.insert).not.toHaveBeenCalled();
  });
  it('denies messages when a conversation is inaccessible (third party or blocked)', async () => {
    const { repo, client } = mockClient([{ data: null, error: null }]);
    await expect(repo.listMessages(item)).rejects.toThrow('must accept');
    expect(client.from).not.toHaveBeenCalledWith('messages');
  });
  it('surfaces database permission rejection after acceptance, including a new block', async () => {
    const { repo } = mockClient([
      { data: { id: item, status: 'accepted' }, error: null },
      { data: null, error: { code: '42501', message: 'RLS' } },
    ]);
    await expect(repo.sendMessage(item, 'Here to listen.')).rejects.toThrow(
      'do not have permission',
    );
  });
  it('limits request acceptance to the recipient and a pending request', async () => {
    const { repo, chain } = mockClient([{ data: [], error: null }]);
    await expect(repo.respondConversation(item, true)).rejects.toThrow('unavailable');
    expect(chain.eq).toHaveBeenCalledWith('recipient_id', user);
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
  });
  it('uses idempotent support writes', async () => {
    const { repo, chain } = mockClient([{ data: null, error: null }]);
    await repo.toggleSupport(item, true);
    expect(chain.upsert).toHaveBeenCalledWith(
      { post_id: item, user_id: user },
      { onConflict: 'user_id,post_id', ignoreDuplicates: true },
    );
  });
  it('paginates deterministically and escapes literal search wildcards', async () => {
    const { repo, chain } = mockClient([{ data: [], error: null }]);
    await repo.listPosts({ offset: 20, search: '100%_done' });
    expect(chain.range).toHaveBeenCalledWith(20, 39);
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(chain.ilike).toHaveBeenCalledWith('body', '%100\\%\\_done%');
    await expect(repo.listPosts({ offset: -1 })).rejects.toThrow('Invalid feed page');
  });
  it('rejects ambiguous report targets and invalid identifiers', async () => {
    const { repo } = mockClient([]);
    await expect(repo.report({ post_id: item, message_id: item, reason: 'Spam' })).rejects.toThrow(
      'Choose one',
    );
    await expect(repo.deletePost('bad-id')).rejects.toThrow('invalid identifier');
  });
  it('does not load report data when the database denies moderator membership', async () => {
    const { repo, client } = mockClient([]);
    client.rpc.mockResolvedValue({ data: false, error: null });
    await expect(repo.listReports()).rejects.toThrow('Moderator access is required');
    expect(client.from).not.toHaveBeenCalledWith('reports');
    await expect(repo.reviewReport(item, true)).rejects.toThrow('Moderator access is required');
    expect(client.rpc).not.toHaveBeenCalledWith('review_report', expect.anything());
  });
  it('rechecks permission through the database when reviewing a report', async () => {
    const { repo, client } = mockClient([]);
    client.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Moderator access revoked' },
    });
    await expect(repo.reviewReport(item, true)).rejects.toThrow('do not have permission');
    expect(client.rpc).toHaveBeenCalledWith('review_report', {
      report_id: item,
      remove_post: true,
    });
  });
  it('bounds message history and presents the latest batch in chronological order', async () => {
    const newest = { id: 'newest', body: 'New message' };
    const oldest = { id: 'oldest', body: 'Old message' };
    const { repo, chain } = mockClient([
      { data: { id: item, status: 'accepted' }, error: null },
      { data: [newest, oldest], error: null },
    ]);
    expect(await repo.listMessages(item)).toEqual([oldest, newest]);
    expect(chain.limit).toHaveBeenCalledWith(200);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
  it('rejects invalid feed offsets before accessing the posts table', async () => {
    const { repo, client } = mockClient([]);
    for (const offset of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(repo.listPosts({ offset })).rejects.toThrow('Invalid feed page');
    expect(client.from).not.toHaveBeenCalled();
  });
  it('bounds inbox polling to the latest 100 conversations with a stable order', async () => {
    const { repo, chain } = mockClient([{ data: [], error: null }]);
    expect(await repo.listConversations()).toEqual([]);
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(chain.or).toHaveBeenCalledWith(`requester_id.eq.${user},recipient_id.eq.${user}`);
  });
  it('bounds blocked-member management without weakening database block enforcement', async () => {
    const { repo, chain } = mockClient([{ data: [], error: null }]);
    expect(await repo.listBlocked()).toEqual([]);
    expect(chain.eq).toHaveBeenCalledWith('blocker_id', user);
    expect(chain.limit).toHaveBeenCalledWith(500);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.order).toHaveBeenCalledWith('blocked_id', { ascending: false });
  });
});
