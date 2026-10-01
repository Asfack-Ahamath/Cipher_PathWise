import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post, session, setPasswordRequiredHandler, setUnauthorizedHandler, type User } from './api';
import { syncClock } from './clock';

type SignInBody = { email: string; password: string } | { pin: string; depot: string };
interface AuthCtx {
  user: User | null;
  /** Why the last session ended (expired, revoked, disabled) — shown on the sign-in screen. */
  endedReason: string | null;
  signIn: (b: SignInBody) => Promise<User>;
  /** Store a fresh session (after a password change or recovery). */
  adopt: (token: string, user: User) => void;
  signOut: (opts?: { everywhere?: boolean }) => Promise<void>;
}
const Ctx = createContext<AuthCtx>(null as any);

const REASONS: Record<string, string> = {
  session_expired: 'Your session expired. Sign in again.',
  session_revoked: 'You were signed out (your password or access changed). Sign in again.',
  account_disabled: 'Your account was disabled. Ask your administrator.',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (session.token() ? session.user() : null));
  const [endedReason, setEnded] = useState<string | null>(null);
  const qc = useQueryClient();
  const drop = useCallback((reason?: string) => { session.clear(); qc.clear(); setUser(null); setEnded(reason ? REASONS[reason] ?? null : null); }, [qc]);
  const adopt = useCallback((token: string, u: User) => { session.save(token, u); setUser(u); setEnded(null); }, []);
  useEffect(() => {
    setUnauthorizedHandler(code => drop(code));
    setPasswordRequiredHandler(() => { const u = session.user(); if (u && !u.mustChangePassword) { const nu = { ...u, mustChangePassword: true }; session.save(session.token()!, nu); setUser(nu); } });
  }, [drop]);
  // keep the business clock in step (the demo clock can be moved; phones drift)
  useEffect(() => { if (!user) return; void syncClock(); const id = setInterval(() => void syncClock(), 120_000); return () => clearInterval(id); }, [user]);
  const signIn = useCallback(async (b: SignInBody) => {
    const r = await post<{ token: string; user: User }>('pin' in b ? '/auth/pin' : '/auth/login', b);
    qc.clear(); adopt(r.token, r.user); await syncClock();
    return r.user;
  }, [qc, adopt]);
  const signOut = useCallback(async (opts: { everywhere?: boolean } = {}) => {
    try { await post('/auth/logout', { everywhere: !!opts.everywhere }); } catch { /* offline: still sign out here */ }
    drop();
  }, [drop]);
  return <Ctx.Provider value={{ user, endedReason, signIn, adopt, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

export const HOME: Record<User['role'], string> = { admin: '/a', dispatcher: '/d', loader: '/l', driver: '/r', store_manager: '/s' };
