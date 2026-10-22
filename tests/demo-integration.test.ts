import { describe, expect, it } from 'vitest';
import { DEMO_STORAGE_KEY, DemoRepository } from '../src/lib/demo-repository';
import { createSeed } from '../src/lib/seed';
import type { CreatePostInput } from '../src/lib/types';

const regional: CreatePostInput = {
  body: 'Taking a small step in my community today.',
  topic: 'Small wins',
  mood: 'Hopeful',
  scope: 'regional',
  region: 'India',
};

describe('demo and live repository integration contracts', () => {
  it('accepts the live profile nickname limit and rejects unsupported regions without saving', async () => {
    const repo = new DemoRepository({ storage: null });
    const nickname = 'A'.repeat(40);
    await expect(repo.saveProfile({ nickname, region: 'India', bio: '' })).resolves.toMatchObject({
      nickname,
    });
    await expect(
      repo.saveProfile({ nickname: 'Changed', region: 'Unknown place', bio: '' }),
    ).rejects.toThrow('Choose a region');
    expect((await repo.getProfile()).nickname).toBe(nickname);
    await expect(
      repo.saveProfile({ nickname: 'A'.repeat(41), region: 'India', bio: '' }),
    ).rejects.toThrow();
  });

  it('uses only supported regions for regional posts and clears a global post region', async () => {
    const repo = new DemoRepository({ storage: null });
    await expect(repo.createPost({ ...regional, region: 'Unknown place' })).rejects.toThrow(
      'Choose a region',
    );
    await expect(repo.createPost(regional)).resolves.toMatchObject({
      scope: 'regional',
      region: 'India',
    });
    await expect(
      repo.createPost({ ...regional, scope: 'global', region: 'Unknown place' }),
    ).resolves.toMatchObject({ region: null });
  });

  it.each(['outgoing', 'incoming'])(
    'excludes %s blocked members from support totals',
    async (direction) => {
      const seed = createSeed();
      seed.supports = [
        { post_id: 'demo-post-9', user_id: 'demo-maya' },
        { post_id: 'demo-post-9', user_id: 'demo-you' },
      ];
      seed.blocks = [
        direction === 'outgoing'
          ? { blocker_id: 'demo-you', blocked_id: 'demo-maya' }
          : { blocker_id: 'demo-maya', blocked_id: 'demo-you' },
      ];
      const repo = new DemoRepository({
        storage: {
          getItem: (key) => (key === DEMO_STORAGE_KEY ? JSON.stringify(seed) : null),
          setItem: () => {},
        },
      });
      const post = (await repo.listPosts()).find((p) => p.id === 'demo-post-9');
      expect(post).toMatchObject({ support_count: 1, supported: true });
    },
  );

  it('rejects invalid pages and searches literal post body text consistently with live', async () => {
    const repo = new DemoRepository({ storage: null });
    for (const offset of [-1, 0.5, NaN, Infinity])
      await expect(repo.listPosts({ offset })).rejects.toThrow('Invalid feed page');
    expect(await repo.listPosts({ search: 'Maya' })).toHaveLength(0);
    const post = await repo.createPost({
      ...regional,
      body: 'My energy is at 20% today, and I am resting.',
    });
    expect((await repo.listPosts({ search: '20%' })).map((p) => p.id)).toEqual([post.id]);
    await expect(repo.listPosts({ search: 'a'.repeat(201) })).rejects.toThrow();
  });
});
