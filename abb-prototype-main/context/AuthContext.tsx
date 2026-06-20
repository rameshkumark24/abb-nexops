'use client';

// AuthContext (Stage 3c): holds { user, token, login, logout }, persists the
// JWT in localStorage, rehydrates on load, and exposes a <RoleGuard> that mirrors
// the server-side role+zone scoping on the client (defense in depth — the server
// still enforces). The WebSocket feed is intentionally left token-free (3b); the
// frontend still filters the live feed per role client-side.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

import { BASE_URL } from '@/lib/tasksApi';
import {
  clearSession,
  getCsrfToken,
  getUser,
  setSession,
  type AuthUser,
} from '@/lib/authStorage';

// Backend role -> existing dashboard route. The login page and the guards both
// route through THIS one map so they can never disagree.
//   plant_manager -> Plant Manager dashboard (admin page)
//   field_manager -> Field Manager / zone page (engineer page)
//   technician    -> Technician page
export const ROLE_ROUTE: Record<string, string> = {
  plant_manager: '/admin',
  field_manager: '/engineer',
  technician: '/technician',
};

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; error: string };

interface AuthState {
  user: AuthUser | null;
  ready: boolean; // rehydration finished (avoids guard flicker on first paint)
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  // Rehydrate the cached user on mount (client only). The token itself lives in
  // an httpOnly cookie we can't read here; if the cookie has expired, the first
  // /api call returns 401 and tasksApi clears + bounces to /login.
  useEffect(() => {
    setUser(getUser());
    setReady(true);
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      try {
        const res = await fetch(`${BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          credentials: 'include', // receive + store the httpOnly session cookie
        });
        if (res.status === 401) {
          return { ok: false, error: 'Invalid username or password' };
        }
        if (res.status === 429) {
          let msg = 'Too many failed attempts. Please wait before trying again.';
          try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
          return { ok: false, error: msg };
        }
        if (!res.ok) {
          return { ok: false, error: `Login failed (${res.status})` };
        }
        const data = await res.json();
        const u: AuthUser = {
          username: data?.user?.username ?? username,
          role: data?.user?.role ?? '',
          zone: data?.user?.zone ?? null,
          engineer_id: data?.user?.engineer_id ?? null,
        };
        setSession(u); // persist ONLY the user; the token is in the cookie
        setUser(u);
        return { ok: true, user: u };
      } catch {
        return { ok: false, error: 'Cannot reach the auth service' };
      }
    },
    [],
  );

  const logout = useCallback(() => {
    // Best-effort SERVER-SIDE revocation + cookie clear. Cookie-authed, so it
    // carries the CSRF header; fire-and-forget so logout never hangs, and we
    // clear local state + redirect regardless.
    try {
      const csrf = getCsrfToken();
      fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: csrf ? { 'X-CSRF-Token': csrf } : {},
        credentials: 'include',
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignore — local cleanup below still runs */
    }
    clearSession();
    setUser(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

// Minimal full-screen placeholder while the guard authorizes / redirects, so a
// guarded page never flashes a white screen or its content to the wrong role.
function GuardSplash() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        letterSpacing: '0.12em',
        color: '#475569',
      }}
    >
      AUTHORIZING…
    </div>
  );
}

// Client-side route guard. No valid token -> /login. Logged-in but WRONG role ->
// bounced to that user's OWN dashboard (a technician can't open the plant page by
// typing the URL). The server still enforces scoping; this is defense in depth.
// The guarded children mount ONLY when authorized, so their hooks (useLiveData /
// useTasks) never run for an unauthorized user.
export function RoleGuard({
  role,
  children,
}: {
  role: string;
  children: ReactNode;
}) {
  const { user, ready } = useAuth();
  const router = useRouter();

  const authorized = ready && !!user && user.role === role;

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role !== role) {
      router.replace(ROLE_ROUTE[user.role] ?? '/login');
    }
  }, [ready, user, role, router]);

  if (!authorized) return <GuardSplash />;
  return <>{children}</>;
}
