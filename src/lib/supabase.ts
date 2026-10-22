import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readAuthCallback } from './auth-callback';

export interface SupabaseConfig {
  url: string;
  key: string;
}

export function validateAppOrigin(rawOrigin?: string): string | null {
  if (!rawOrigin?.trim()) return null;
  let url: URL;
  try {
    url = new URL(rawOrigin.trim());
  } catch {
    throw new Error('VITE_APP_URL must be a valid application origin.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error(
      'VITE_APP_URL must be an HTTPS origin without a path (HTTP is allowed for localhost).',
    );
  return url.origin;
}
const appOrigin = validateAppOrigin(import.meta.env.VITE_APP_URL);
export function getAuthRedirectUrl(): string {
  return `${appOrigin ?? window.location.origin}/auth/callback`;
}
// Capture safe intent before createClient begins consuming the location hash.
export const initialAuthCallback =
  typeof window === 'undefined'
    ? { kind: 'none' as const }
    : readAuthCallback(window.location.href);

/** Missing settings enable the local demo; invalid settings must never hide an outage. */
export function validateSupabaseConfig(rawUrl?: string, rawKey?: string): SupabaseConfig | null {
  const url = rawUrl?.trim() ?? '';
  const key = rawKey?.trim() ?? '';
  if (!url && !key) return null;
  if (!url || !key)
    throw new Error(
      'Supabase configuration is incomplete. Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, or leave both empty for demo mode.',
    );

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a valid Supabase project URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !['', '/'].includes(parsed.pathname)
  ) {
    throw new Error(
      'VITE_SUPABASE_URL must use HTTPS and contain only the project origin (HTTP is allowed for localhost).',
    );
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a public sb_publishable_ key. Never put a secret or service-role key in browser settings.',
    );
  }
  return { url: parsed.origin, key };
}

const config = validateSupabaseConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
export const isConfigured = config !== null;
export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    })
  : null;
