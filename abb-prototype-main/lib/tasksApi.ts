// HTTP client for the backend task-lifecycle endpoints.
//
// The technician console uses these to advance a task through its lifecycle
// (assigned -> in_progress -> resolved). This is the visible counterpart to the
// backend lifecycle; the WebSocket telemetry stream (useLiveData) is untouched.
//
// EVERY call is wrapped so a network error / backend-down NEVER throws into the
// UI - callers always receive a discriminated { ok } result and can render an
// error state instead of crashing the page.

import type { LifecycleTask, ResolvedTask } from '@/types/telemetry';
import { getToken, clearSession } from '@/lib/authStorage';

// Same host as the WS bridge, overridable per-environment. Mirrors the
// NEXT_PUBLIC_WS_URL convention already used by useLiveData.
export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
    // Attach Authorization: Bearer <token> automatically so the Stage 3b-gated
    // endpoints (/tasks, start, resolve) receive the JWT on every call.
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
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
// summary incl. resolution_minutes + engineer_active_tasks.
export function resolveTask(id: number): Promise<ApiResult<ResolvedTask>> {
  return request<ResolvedTask>(`/tasks/${id}/resolve`, { method: 'POST' });
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
