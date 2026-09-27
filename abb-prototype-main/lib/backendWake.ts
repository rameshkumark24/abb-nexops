// Cold-start handling for a backend that sleeps when idle (e.g. Render's free
// tier spins the service down after ~15 min and needs ~30-60 s to wake). While
// it wakes, requests through the /api proxy fail with 502/503/504 or a network
// error. We ping the cheap /healthz endpoint as early as possible (landing and
// login pages) so the backend is usually awake before the user clicks sign in,
// and login retries until it answers.

import { BASE_URL } from '@/lib/tasksApi';

// Statuses a sleeping/waking backend (or the proxy in front of it) returns.
const WAKING_STATUSES = new Set([502, 503, 504]);

// True when a response means "backend not reachable yet" rather than a real
// answer. Vercel's proxy answers 502/503/504; the Next server's own proxy
// answers a plain-text 500 on connection refused. The backend's genuine errors
// are JSON, so a JSON 500 is NOT treated as waking.
export function isWakingResponse(res: Response): boolean {
  if (WAKING_STATUSES.has(res.status)) return true;
  if (res.status === 500) {
    return !(res.headers.get('content-type') || '').includes('application/json');
  }
  return false;
}

// Give up after this long; a real outage then surfaces as an error.
export const WAKE_TIMEOUT_MS = 90_000;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let inflight: Promise<boolean> | null = null;

// Resolves true once /healthz answers 2xx, false on timeout. Concurrent callers
// share one wake loop.
export function wakeBackend(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (inflight) return inflight;
  inflight = (async () => {
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${BASE_URL}/healthz`, { cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        /* still waking — retry */
      }
      await sleep(RETRY_DELAY_MS);
    }
    return false;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
