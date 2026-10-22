import { MOODS, TOPICS, type CreatePostInput } from './types';

export function text(value: string, label: string, min: number, max: number): string {
  const result = value.trim();
  if (result.length < min || result.length > max)
    throw new Error(`${label} must be ${min}–${max} characters.`);
  return result;
}
export function validatePost(input: CreatePostInput): CreatePostInput {
  const body = text(input.body, 'Your post', 10, 3000);
  if (!TOPICS.includes(input.topic)) throw new Error('Choose a topic.');
  if (!MOODS.includes(input.mood)) throw new Error('Choose how you are feeling.');
  if (!['global', 'regional'].includes(input.scope)) throw new Error('Choose an audience.');
  const region = input.scope === 'regional' ? text(input.region ?? '', 'Region', 2, 80) : null;
  return { ...input, body, region };
}
