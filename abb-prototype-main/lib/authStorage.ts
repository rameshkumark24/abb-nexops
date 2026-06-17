// Auth token + user persistence (Stage 3c).
//
// This is a REAL Next.js app (not a sandboxed artifact), so localStorage is the
// correct place to persist the JWT + user so a page refresh keeps the session.
// Every accessor is SSR-safe (guards `typeof window`) and never throws, so a
// blocked/again-unavailable storage can never white-screen the app.
//
// Kept as a tiny standalone module (no React) so BOTH the AuthContext and the
// non-React fetch helper (tasksApi) can read/clear the session without a cycle.

export const TOKEN_KEY = 'nexops_token';
export const USER_KEY = 'nexops_user';

// The compact user the backend returns from /auth/login and /auth/me.
export interface AuthUser {
  username: string;
  role: string; // 'plant_manager' | 'field_manager' | 'technician'
  zone: string | null; // null for plant_manager, 'A'-'D' otherwise
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable — session just won't persist; never crash */
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

// Best-effort JWT expiry check (no signature verification — that's the server's
// job; this only avoids rehydrating an obviously-expired token on load). A
// malformed token reads as expired so we fail safe to the login page.
export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
    if (!payload || typeof payload.exp !== 'number') return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}
