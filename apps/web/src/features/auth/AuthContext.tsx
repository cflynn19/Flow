import type { PublicUser } from '@flow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { ApiRequestError, api } from '@/lib/api';
import { keys } from '@/lib/queries';

interface AuthValue {
  user: PublicUser | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (error) {
        // A missing session is the normal anonymous case, not an error to surface.
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user } = await api.login({ email, password });
      client.setQueryData(keys.me, user);
      await client.invalidateQueries();
    },
    [client],
  );

  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      const { user } = await api.register({ email, password, name });
      client.setQueryData(keys.me, user);
      await client.invalidateQueries();
    },
    [client],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    client.setQueryData(keys.me, null);
    client.clear();
  }, [client]);

  const value = useMemo<AuthValue>(
    () => ({ user: data ?? null, isLoading, signIn, signUp, signOut }),
    [data, isLoading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
