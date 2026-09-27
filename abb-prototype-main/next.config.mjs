/** @type {import('next').NextConfig} */

// Security headers applied to EVERY route. These harden the app shell itself —
// the deepest defence against an XSS is to stop injected markup from doing
// damage in the first place.
//
// Because the browser now talks ONLY to this origin (REST via /api/* and the
// live feed via /api/ws, both proxied below), the CSP can lock script and
// connect targets to 'self'. 'unsafe-inline' stays for scripts/styles because
// Next's hydration bootstrap and the app's inline styles need it; 'unsafe-eval'
// is only added in `next dev` (React Refresh needs it). If NEXT_PUBLIC_WS_URL
// points the live feed at ANOTHER origin, that origin is allowed in connect-src.
const isDev = process.env.NODE_ENV !== 'production';

// Same-origin API proxy: the browser calls /api/* on THIS origin and Next
// forwards to the backend. This is what makes the httpOnly auth cookie work —
// a cookie the backend sets on a /api/* response is first-party to the frontend
// origin (so the SPA sends it automatically and the Next proxy can read it),
// instead of being a cross-origin cookie the browser would block. The same
// rewrite also proxies the WebSocket upgrade for /api/ws.
//
// NOTE: rewrites are resolved at BUILD time — set BACKEND_ORIGIN when running
// `next build` (the Dockerfile takes it as a build arg; on Vercel, set it as a
// project env var). The value is normalized because a bare host
// ("api.example.com") makes `next build` abort with "Invalid rewrite found",
// and a trailing slash would produce `//path` URLs.
function normalizeOrigin(raw) {
  let origin = (raw || '').trim() || 'http://localhost:8000';
  if (!/^https?:\/\//i.test(origin)) origin = `https://${origin}`;
  return origin.replace(/\/+$/, '');
}
const BACKEND_ORIGIN = normalizeOrigin(process.env.BACKEND_ORIGIN);

// Live-feed WebSocket URL baked into the client bundle. Vercel's rewrites do not
// carry WebSocket upgrades, so on a Vercel build (with a real backend origin)
// the browser connects straight to the backend's /ws instead of /api/ws — no
// separate NEXT_PUBLIC_WS_URL needed. The WS is ticket-authenticated, so
// cross-origin is fine. An explicit NEXT_PUBLIC_WS_URL always wins.
function resolveWsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const localBackend = /\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(BACKEND_ORIGIN);
  if (process.env.VERCEL === '1' && !localBackend) {
    return `${BACKEND_ORIGIN.replace(/^http/i, 'ws')}/ws`;
  }
  return '';
}
const WS_URL = resolveWsUrl();


function externalWsOrigin() {
  const url = WS_URL;
  if (!url || !/^wss?:\/\//i.test(url)) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''} ${externalWsOrigin()}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
  { key: 'Content-Security-Policy', value: csp },
];



const nextConfig = {
  // Self-contained server bundle (server.js + minimal node_modules) for a small
  // production container image.
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
  env: WS_URL ? { NEXT_PUBLIC_WS_URL: WS_URL } : {},
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_ORIGIN}/:path*` }];
  },
};

export default nextConfig
