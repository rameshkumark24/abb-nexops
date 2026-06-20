/** @type {import('next').NextConfig} */

// Security headers applied to EVERY route. These harden the app shell itself —
// the deepest defence against an XSS that would try to read the auth token from
// localStorage is to stop injected markup from doing damage in the first place.
//
// The CSP here is a DELIBERATELY SAFE SUBSET: it restricts framing, the <base>
// tag, plugins, and form targets — none of which touch script/style/connect, so
// it cannot break Next's inline hydration scripts, Tailwind's injected styles,
// or the cross-origin API/WebSocket calls. A full script-src/connect-src CSP is
// the real XSS lockdown but is env-specific (it must whitelist the backend
// origin) and needs browser testing, so it is tracked as a follow-up rather than
// shipped blind.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
];

// Same-origin API proxy: the browser calls /api/* on THIS origin and Next
// forwards to the backend. This is what makes the httpOnly auth cookie work —
// a cookie the backend sets on a /api/* response is first-party to the frontend
// origin (so the SPA sends it automatically and the Next middleware can read it),
// instead of being a cross-origin cookie the browser would block. Override the
// target with BACKEND_ORIGIN in other environments.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || 'http://localhost:8000';

const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_ORIGIN}/:path*` }];
  },
};

export default nextConfig
