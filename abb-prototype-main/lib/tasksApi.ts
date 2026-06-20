// HTTP client for the backend task-lifecycle endpoints.
//
// The technician console uses these to advance a task through its lifecycle
// (assigned -> in_progress -> resolved). This is the visible counterpart to the
// backend lifecycle; the WebSocket telemetry stream (useLiveData) is untouched.
//
// EVERY call is wrapped so a network error / backend-down NEVER throws into the
// UI - callers always receive a discriminated { ok } result and can render an
// error state instead of crashing the page.

import type { LifecycleTask, ResolvedTask, TelemetryRecord } from '@/types/telemetry';
import { getCsrfToken, clearSession } from '@/lib/authStorage';

// SAME-ORIGIN base: calls go to /api/* on this origin, which Next proxies to the
// backend (see next.config rewrites). This keeps the httpOnly auth cookie
// first-party so the browser sends it automatically. Override with
// NEXT_PUBLIC_API_BASE only if you intentionally bypass the proxy.
export const BASE_URL = process.env.NEXT_PUBLIC_API_BASE || '/api';

// Methods that mutate state require the double-submit CSRF header.
const _UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Discriminated result: success carries data, failure carries a message.
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// On a 401 (expired/invalid token) we auto-logout and bounce to /login so an
// expired session never leaves a broken, half-rendered page. Hard redirect keeps
// this module React-free (AuthProvider rehydrates as empty on /login).
function handleUnauthorized(): void {
  clearSession();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    // Auth rides in the httpOnly cookie sent automatically with credentials:
    // 'include'. For unsafe methods we add the double-submit CSRF header (read
    // from the readable CSRF cookie) so the server accepts the cookie-authed
    // mutation. No JWT is read or attached by JS.
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };
    if (_UNSAFE.has(method)) {
      const csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (res.status === 401) {
      handleUnauthorized();
      return { ok: false, error: 'Session expired — please sign in again' };
    }

    // The endpoints return JSON on success AND on handled errors
    // ({ "error": ... } with a 403/404/409/500). Parse defensively.
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      const msg =
        body && typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: unknown }).error)
          : `request failed (${res.status})`;
      return { ok: false, error: msg };
    }

    return { ok: true, data: body as T };
  } catch {
    // fetch rejected -> backend unreachable. Surface a calm, fixed message.
    return { ok: false, error: 'Cannot reach task service' };
  }
}

// GET /tasks -> open queue (or all tasks when includeResolved is true).
export function fetchTasks(includeResolved = false): Promise<ApiResult<LifecycleTask[]>> {
  const q = includeResolved ? '?include_resolved=true' : '';
  return request<LifecycleTask[]>(`/tasks${q}`, { method: 'GET' });
}

// POST /tasks/{id}/start -> assigned -> in_progress, returns updated summary.
export function startTask(id: number): Promise<ApiResult<LifecycleTask>> {
  return request<LifecycleTask>(`/tasks/${id}/start`, { method: 'POST' });
}

// POST /tasks/{id}/resolve -> resolved, frees engineer capacity, returns the
// POST /tasks/{id}/resolve -> resolved, frees engineer capacity, returns the
// summary incl. resolution_minutes + engineer_active_tasks.
export function resolveTask(id: number): Promise<ApiResult<ResolvedTask>> {
  return request<ResolvedTask>(`/tasks/${id}/resolve`, { method: 'POST' });
}

export interface EngineerStats {
  engineer_id: number;
  name: string;
  zone: string | null;
  resolved_count: number;
  active_count: number;
  avg_resolution_minutes: number | null;
}

export function fetchEngineerStats(id: number): Promise<ApiResult<EngineerStats>> {
  return request<EngineerStats>(`/engineers/${id}/stats`, { method: 'GET' });
}

// ----------------------------------------------------------------------
// Workforce / engineers (Stage 3d UI helpers)
// Mirrors the same token-attaching + 401 auto-logout behaviour as above.
// Endpoints expected:
//   GET  /engineers
//   POST /engineers                 -> body: { name, zone, skills, username, password, role }
//   POST /engineers/{id}/deactivate
//   POST /engineers/{id}/activate
// ----------------------------------------------------------------------

export interface Engineer {
  id: number;
  name: string;
  username?: string;
  zone: string;
  skills: string[];
  active: boolean;
  stats?: { assigned_tasks?: number; resolved_tasks?: number };
  max_capacity?: number;
  active_tasks?: number;
}

export function getEngineers(): Promise<ApiResult<Engineer[]>> {
  return request<Engineer[]>('/engineers', { method: 'GET' });
}

export function createEngineer(body: {
  name: string;
  zone: string;
  skills: string[];
  username: string;
  password: string;
  role?: string;
}): Promise<ApiResult<Engineer>> {
  return request<Engineer>('/engineers', { method: 'POST', body: JSON.stringify(body) });
}

export function deactivateEngineer(id: number): Promise<ApiResult<Engineer>> {
  return request<Engineer>(`/engineers/${id}/deactivate`, { method: 'POST' });
}

export function activateEngineer(id: number): Promise<ApiResult<Engineer>> {
  return request<Engineer>(`/engineers/${id}/activate`, { method: 'POST' });
}

export function deleteEngineer(id: number): Promise<ApiResult<{ deleted: boolean; engineer_id: number }>> {
  return request<{ deleted: boolean; engineer_id: number }>(`/engineers/${id}`, { method: 'DELETE' });
}

export function assignTask(taskId: number, engineerId: number): Promise<ApiResult<LifecycleTask>> {
  return request<LifecycleTask>(`/tasks/${taskId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ engineer_id: engineerId }),
  });
}

export function fetchTelemetrySnapshot(): Promise<ApiResult<TelemetryRecord[]>> {
  return request<TelemetryRecord[]>('/telemetry/snapshot', { method: 'GET' });
}

export interface AriaEvidence {
  focus_machine: string | null;
  nexops_risk: string;
  anomaly_status: string | null;
  time_to_threshold: {
    sensor: string;
    eta_minutes_low: number;
    eta_minutes_high: number;
  } | null;
  assigned_engineer: string;
  assignment_reason: string | null;
  incident_matches: number;
}

export interface AriaResponse {
  answer: string;
  source: 'llm' | 'fallback_template' | 'unavailable';
  evidence: AriaEvidence;
}

export function askAria(query: string): Promise<ApiResult<AriaResponse>> {
  return request<AriaResponse>('/aria/ask', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}


