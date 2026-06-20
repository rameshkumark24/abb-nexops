// Server-side route guard (runs on the edge BEFORE a page is rendered or sent).
//
// WHY: the in-app <RoleGuard> is client-side only — the browser downloads the
// page first and JS then redirects, so typing a role URL while logged out still
// "opened" the page shell. This middleware makes the role routes a REAL
// server-side boundary: an unauthenticated request to /admin is redirected to
// /login before any page is served, and a wrong-role request is bounced to that
// user's own dashboard.
//
// SCOPE OF TRUST: this is a soft gate (it reads the token's `exp` + `role` from
// the cookie set at login; it does NOT verify the signature here). That is
// deliberate — the cryptographic boundary is the backend API, which rejects any
// forged/unsigned token, so a forged cookie only ever reaches an EMPTY page
// shell (no data). To make this gate itself cryptographic, verify the JWT here
// with the shared NEXOPS_JWT_SECRET (e.g. via `jose`); see the security notes.

import { NextRequest, NextResponse } from 'next/server';

const TOKEN_COOKIE = 'nexops_token';

// Which role each guarded route requires, and where each role's home is. These
// MUST stay in sync with ROLE_ROUTE in context/AuthContext.tsx.
const ROUTE_ROLE: Record<string, string> = {
  '/admin': 'plant_manager',
  '/engineer': 'field_manager',
  '/technician': 'technician',
};
const ROLE_HOME: Record<string, string> = {
  plant_manager: '/admin',
  field_manager: '/engineer',
  technician: '/technician',
};

interface JwtClaims {
  role?: string;
  exp?: number;
}

// Decode (NOT verify) the JWT payload. `atob` is available in the edge runtime.
function decodeClaims(token: string): JwtClaims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)) as JwtClaims;
  } catch {
    return null;
  }
}

function redirectTo(req: NextRequest, pathname: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest): NextResponse {
  const required = ROUTE_ROLE[req.nextUrl.pathname];
  if (!required) return NextResponse.next();

  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const claims = token ? decodeClaims(token) : null;

  // FAIL CLOSED: no token, unparseable, or no/expired `exp` -> /login.
  const valid =
    !!claims && typeof claims.exp === 'number' && Date.now() < claims.exp * 1000;
  if (!valid) return redirectTo(req, '/login');

  // Logged in but wrong role -> bounce to that user's own dashboard.
  if (claims!.role !== required) {
    return redirectTo(req, ROLE_HOME[claims!.role ?? ''] ?? '/login');
  }

  return NextResponse.next();
}

// Only run on the guarded role routes (keeps the edge function off every asset).
export const config = {
  matcher: ['/admin', '/engineer', '/technician'],
};
