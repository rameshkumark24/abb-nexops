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

// Same host as the WS bridge, overridable per-environment. Mirrors the
// NEXT_PUBLIC_WS_URL convention already used by useLiveData.
export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Discriminated result: success carries data, failure carries a message.
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });

    // The endpoints return JSON on success AND on handled errors
    // ({ "error": ... } with a 404/409/500). Parse defensively.
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
