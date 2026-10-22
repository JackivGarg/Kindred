import { describe, expect, it } from 'vitest';
import { validateSupabaseConfig, validateAppOrigin } from '../src/lib/supabase';

const key = 'sb_publishable_abcdefghijk123456';
describe('Supabase browser configuration', () => {
  it('enables demo only when both settings are absent', () => {
    expect(validateSupabaseConfig()).toBeNull();
    expect(validateSupabaseConfig(' ', ' ')).toBeNull();
  });
  it('does not silently switch partially configured projects into demo', () => {
    expect(() => validateSupabaseConfig('https://example.supabase.co')).toThrow('incomplete');
    expect(() => validateSupabaseConfig(undefined, key)).toThrow('incomplete');
  });
  it('accepts public publishable keys and normalizes the origin', () => {
    expect(validateSupabaseConfig(' https://example.supabase.co/ ', key)).toEqual({
      url: 'https://example.supabase.co',
      key,
    });
    expect(validateSupabaseConfig('http://localhost:54321', key)?.url).toBe(
      'http://localhost:54321',
    );
  });
  it.each(['sb_secret_abcdefghijk123456', 'service_role', 'eyJhbGciOiJIUzI1NiJ9.fake.jwt'])(
    'rejects unsafe or unrecognized browser key %s',
    (unsafe) => {
      expect(() => validateSupabaseConfig('https://example.supabase.co', unsafe)).toThrow(
        'public sb_publishable_',
      );
    },
  );
  it.each([
    'http://example.supabase.co',
    'https://u:p@example.supabase.co',
    'https://example.supabase.co/rest/v1',
    'https://example.supabase.co?key=x',
    'https://example.supabase.co#x',
    'not a url',
  ])('rejects invalid project URL %s', (url) => {
    expect(() => validateSupabaseConfig(url, key)).toThrow();
  });
});

describe('application redirect origin', () => {
  it('defaults to the current origin and supports local development and HTTPS deployment', () => {
    expect(validateAppOrigin()).toBeNull();
    expect(validateAppOrigin('https://kindred.example/')).toBe('https://kindred.example');
    expect(validateAppOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });
  it.each([
    'http://kindred.example',
    'https://kindred.example/path',
    'https://user:password@kindred.example',
    'https://kindred.example?next=evil',
    '//evil.example',
    'javascript:alert(1)',
  ])('rejects unsafe redirect origin %s', (value) => {
    expect(() => validateAppOrigin(value)).toThrow('VITE_APP_URL');
  });
});
