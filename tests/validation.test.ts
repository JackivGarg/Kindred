import { describe, expect, it } from 'vitest';
import { text, validatePost } from '../src/lib/validation';
import type { CreatePostInput } from '../src/lib/types';

const post: CreatePostInput = {
  body: '  Today I took a small step.  ',
  topic: 'Small wins',
  mood: 'Hopeful',
  scope: 'global',
  region: 'India',
};
describe('post validation', () => {
  it('trims content and removes location from a global post', () => {
    expect(validatePost(post)).toEqual({
      ...post,
      body: 'Today I took a small step.',
      region: null,
    });
  });
  it('requires an explicit region for regional discovery', () => {
    expect(() => validatePost({ ...post, scope: 'regional', region: null })).toThrow('Region');
    expect(validatePost({ ...post, scope: 'regional', region: ' India ' }).region).toBe('India');
  });
  it.each([
    { body: '    ' },
    { body: 'x'.repeat(3001) },
    { topic: 'Made up' },
    { mood: 'Made up' },
    { scope: 'private' },
  ])('rejects malformed input %j', (invalid) => {
    expect(() => validatePost({ ...post, ...invalid } as CreatePostInput)).toThrow();
  });
  it('accepts exact text boundaries and rejects whitespace-only replies', () => {
    expect(text(' x ', 'Reply', 1, 1)).toBe('x');
    expect(() => text('   ', 'Reply', 1, 100)).toThrow('Reply');
  });
});
