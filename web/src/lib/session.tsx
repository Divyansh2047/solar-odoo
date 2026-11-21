import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Capability, Role } from '@arka/shared';
import { api, setSignedOutHandler } from './api';

export interface Me {
  id: number;
  companyId: number;
  name: string;
  email: string;
  role: Role;
  companyName: string;
  companyKind: 'real' | 'demo';
  timezone: string;
  capabilities: Capability[];
}

interface SessionValue {
  me: Me | null;
  loading: boolean;
  can: (c: Capability) => boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({ me: null, loading: true, can: () => false, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<{ user: Me | null }>('/api/auth/session'),
    staleTime: 60_000,
  });
  useEffect(() => {
    setSignedOutHandler(() => qc.setQueryData(['session'], { user: null }));
  }, [qc]);
  const me = q.data?.user ?? null;
  const value: SessionValue = {
    me,
    loading: q.isLoading,
    can: (c) => !!me?.capabilities.includes(c),
    refresh: async () => {
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      await qc.invalidateQueries({ queryKey: ['session'] });
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
