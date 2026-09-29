import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post, session, setUnauthorizedHandler, type User } from './api';
import { syncClock } from './clock';

interface AuthCtx { user: User | null; signIn: (b: { email?: string; password?: string; pin?: string; depot?: string }) => Promise<User>; signOut: () => void }
const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (session.token() ? session.user() : null));
  const qc = useQueryClient();
  const signOut = useCallback(() => { session.clear(); qc.clear(); setUser(null); }, [qc]);
  useEffect(() => { setUnauthorizedHandler(signOut); }, [signOut]);
  useEffect(() => { if (user) void syncClock(); }, [user]);
  const signIn = useCallback(async (b: any) => {
    const r = await post<{ token: string; user: User }>('/auth/login', b);
    session.save(r.token, r.user); qc.clear(); setUser(r.user); await syncClock();
    return r.user;
  }, [qc]);
  return <Ctx.Provider value={{ user, signIn, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

export const HOME: Record<User['role'], string> = { dispatcher: '/d', loader: '/l', driver: '/r', store_manager: '/s' };
