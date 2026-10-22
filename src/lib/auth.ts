import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { REGIONS } from './types';

function client() {
  if (!supabase)
    throw new Error(
      'Account access needs a configured Supabase project. The local demo does not create accounts.',
    );
  return supabase;
}

function normalizedEmail(email: string) {
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
  return value;
}

function validatePassword(password: string) {
  if (password.length < 10) throw new Error('Use a password with at least 10 characters.');
}

export async function signUp(
  email: string,
  password: string,
  nickname: string,
  region: string,
): Promise<{ needsConfirmation: boolean }> {
  validatePassword(password);
  const name = nickname.trim();
  if (name.length < 2 || name.length > 40)
    throw new Error('Choose a nickname between 2 and 40 characters.');
  if (!(REGIONS as readonly string[]).includes(region))
    throw new Error('Choose a region from the list.');
  const { data, error } = await client().auth.signUp({
    email: normalizedEmail(email),
    password,
    options: { data: { nickname: name, region }, emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({
    email: normalizedEmail(email),
    password,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut({ scope: 'local' });
  if (error) throw error;
}

/** Used only to render client UI; database policies enforce all authorization. */
export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/** Keep listeners synchronous; load profile data in a separate React effect. */
export function onAuthChange(
  listener: (session: Session | null, event: AuthChangeEvent) => void,
): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => listener(session, event));
  return () => data.subscription.unsubscribe();
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(normalizedEmail(email), {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  validatePassword(password);
  const { error } = await client().auth.updateUser({ password });
  if (error) throw error;
}
