// Auth persistence (httpOnly-cookie session model).
//
// The session JWT is NO LONGER stored in JS-readable storage. It lives ONLY in an
// httpOnly cookie set by the backend at login (sent automatically with every
// same-origin /api request, and readable by the Next middleware server-side, but
// invisible to JavaScript — so an XSS cannot exfiltrate it).
//
// localStorage here holds ONLY the NON-sensitive user object, for instant UI
// rehydration on refresh. The CSRF token lives in a JS-readable cookie that the
// fetch helper echoes back in a header (double-submit). This module stays a tiny
// standalone (no React) so AuthContext and the non-React fetch helper share it.

export const USER_KEY = 'nexops_user';
export const CSRF_COOKIE = 'nexops_csrf';

// The compact user the backend returns from /auth/login and /auth/me.
export interface AuthUser {
  username: string;
  role: string; // 'plant_manager' | 'field_manager' | 'technician'
  zone: string | null; // null for plant_manager, 'A'-'D' otherwise
  engineer_id: number | null;
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

// Read the double-submit CSRF token from its (readable) cookie, to echo in the
// X-CSRF-Token header on unsafe requests. Returns null if absent.
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.match(
      new RegExp('(?:^|; )' + CSRF_COOKIE + '=([^;]*)'),
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function setSession(user: AuthUser): void {
  // The token cookie is set by the SERVER (httpOnly); we only persist the user.
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable — session just won't persist; never crash */
  }
}

export function clearSession(): void {
  // Drop the cached user. The httpOnly token cookie is cleared by the server on
  // /auth/logout; we also best-effort clear the readable CSRF cookie here so a
  // client-side 401 cleanup doesn't leave a stale CSRF value around.
  //
  // Additionally, clear all cached data, stale state, and outdated dashboard
  // information from localStorage, sessionStorage, and the Cache API.
  if (typeof window === 'undefined') return;

  try {
    // Preserve the theme setting
    const theme = window.localStorage.getItem('nexops_theme');
    window.localStorage.clear();
    if (theme) {
      window.localStorage.setItem('nexops_theme', theme);
    }
  } catch {
    /* ignore */
  }

  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }

  if ('caches' in window) {
    try {
      caches.keys().then((names) => {
        for (const name of names) caches.delete(name);
      });
    } catch {
      /* ignore */
    }
  }

  try {
    document.cookie = `${CSRF_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}
