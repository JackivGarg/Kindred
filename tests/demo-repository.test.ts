import { describe, expect, it } from 'vitest';
import { DemoRepository, DEMO_STORAGE_KEY, type StorageLike } from '../src/lib/demo-repository';
import { createSeed } from '../src/lib/seed';
import type { CreatePostInput } from '../src/lib/types';

const draft: CreatePostInput = {
  body: 'Today I am taking one small step.',
  topic: 'Small wins',
  mood: 'Hopeful',
  scope: 'global',
  region: null,
};
function storage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
describe('fictional demo repository', () => {
  it('persists changes in supplied session storage and keeps returned profiles detached', async () => {
    const saved = storage();
    const repo = new DemoRepository({ storage: saved });
    const created = await repo.createPost(draft);
    const reloaded = new DemoRepository({ storage: saved });
    expect((await reloaded.listPosts()).some((post) => post.id === created.id)).toBe(true);
    const profile = await repo.getProfile();
    profile.nickname = 'Changed outside repository';
    expect((await repo.getProfile()).nickname).toBe('Alex');
  });
  it('remains usable with corrupt or denied browser storage', async () => {
    for (const saved of [
      { getItem: () => '{broken', setItem: () => {} },
      {
        getItem: () => {
          throw Error('denied');
        },
        setItem: () => {
          throw Error('denied');
        },
      },
    ]) {
      const repo = new DemoRepository({ storage: saved });
      await expect(repo.createPost(draft)).resolves.toMatchObject({ body: draft.body });
    }
  });
  it('allows only the recipient to accept a pending request before exchanging messages', async () => {
    const repo = new DemoRepository({ storage: null });
    const outgoing = await repo.requestConversation('demo-sam');
    await expect(repo.sendMessage(outgoing.id, 'Hello')).rejects.toThrow('must accept');
    await expect(repo.respondConversation(outgoing.id, true)).rejects.toThrow('Only the recipient');
    await repo.respondConversation('demo-conversation-2', true);
    await expect(
      repo.sendMessage('demo-conversation-2', 'Thank you for reaching out.'),
    ).resolves.toMatchObject({ sender_id: 'demo-you' });
  });
  it('hides blocked content and stops existing and new messages', async () => {
    const repo = new DemoRepository({ storage: null });
    await repo.blockUser('demo-maya');
    expect((await repo.listPosts()).some((post) => post.author_id === 'demo-maya')).toBe(false);
    await expect(repo.sendMessage('demo-conversation-1', 'Hello')).rejects.toThrow('unavailable');
    await expect(repo.requestConversation('demo-maya')).rejects.toThrow('unavailable');
    await repo.unblockUser('demo-maya');
    expect((await repo.listPosts()).some((post) => post.author_id === 'demo-maya')).toBe(true);
  });
  it('denies third-party conversation and message access', async () => {
    const saved = storage();
    const seed = createSeed();
    seed.conversations.push({
      id: 'third-party',
      requester_id: 'demo-maya',
      recipient_id: 'demo-sam',
      status: 'accepted',
      created_at: new Date().toISOString(),
    });
    saved.setItem(DEMO_STORAGE_KEY, JSON.stringify(seed));
    const repo = new DemoRepository({ storage: saved });
    expect((await repo.listConversations()).some((c) => c.id === 'third-party')).toBe(false);
    await expect(repo.listMessages('third-party')).rejects.toThrow('unavailable');
    await expect(repo.sendMessage('third-party', 'Hello')).rejects.toThrow('unavailable');
  });
  it('protects ownership and removes dependent replies when deleting an owned post', async () => {
    const repo = new DemoRepository({ storage: null });
    await expect(repo.deletePost('demo-post-1')).rejects.toThrow('own posts');
    const post = await repo.createPost(draft);
    await repo.addComment(post.id, 'A reply');
    await repo.deletePost(post.id);
    await expect(repo.listComments(post.id)).rejects.toThrow('unavailable');
  });
  it('makes repeated support changes idempotent', async () => {
    const repo = new DemoRepository({ storage: null });
    await repo.toggleSupport('demo-post-1', false);
    const initial = (await repo.listPosts()).find((p) => p.id === 'demo-post-1')!.support_count;
    await repo.toggleSupport('demo-post-1', true);
    await repo.toggleSupport('demo-post-1', true);
    expect((await repo.listPosts()).find((p) => p.id === 'demo-post-1')!.support_count).toBe(
      initial + 1,
    );
    await repo.toggleSupport('demo-post-1', false);
    await repo.toggleSupport('demo-post-1', false);
    expect((await repo.listPosts()).find((p) => p.id === 'demo-post-1')!.support_count).toBe(
      initial,
    );
  });
  it('paginates the feed without losing or duplicating created posts', async () => {
    const repo = new DemoRepository({ storage: null });
    for (let i = 0; i < 25; i++) await repo.createPost({ ...draft, body: `${draft.body} ${i}` });
    const first = await repo.listPosts();
    const second = await repo.listPosts({ offset: 20 });
    expect(first).toHaveLength(20);
    expect(second).toHaveLength(14);
    expect(new Set([...first, ...second].map((p) => p.id)).size).toBe(34);
  });
  it('rejects empty messages, malformed reports and moderator access', async () => {
    const repo = new DemoRepository({ storage: null });
    await expect(repo.sendMessage('demo-conversation-1', '  ')).rejects.toThrow();
    await expect(repo.report({ reason: 'Spam' })).rejects.toThrow('Choose one');
    await expect(repo.listReports()).rejects.toThrow('Moderator');
  });
});
