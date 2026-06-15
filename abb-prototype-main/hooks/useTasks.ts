'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTasks, resolveTask, startTask, type ApiResult } from '@/lib/tasksApi';
import type { LifecycleTask, ResolvedTask } from '@/types/telemetry';

// Poll cadence for the open queue. The BACKEND is the source of truth - faults
// are assigned server-side as telemetry flows - so we re-read on a short timer
// to keep the technician's queue current without any WebSocket coupling.
const POLL_MS = 3500;

export function useTasks() {
  const [tasks, setTasks] = useState<LifecycleTask[]>([]);
  const [loading, setLoading] = useState(true); // true only until the first read lands
  const [error, setError] = useState<string | null>(null);

  // Guard against setState after unmount (a slow fetch resolving late).
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const res = await fetchTasks(false);
    if (!mounted.current) return;
    if (res.ok) {
      setTasks(res.data);
      setError(null);
    } else {
      // Keep the last-known list on screen; just record the reachability error.
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh(); // initial load
    const id = setInterval(refresh, POLL_MS); // keep the queue current
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  // start/resolve hit the endpoint then immediately refresh so the UI reflects
  // the new server state (resolved tasks drop out of the open queue on refresh).
  const start = useCallback(
    async (id: number): Promise<ApiResult<LifecycleTask>> => {
      const res = await startTask(id);
      await refresh();
      return res;
    },
    [refresh],
  );

  const resolve = useCallback(
    async (id: number): Promise<ApiResult<ResolvedTask>> => {
      const res = await resolveTask(id);
      await refresh();
      return res;
    },
    [refresh],
  );

  return { tasks, loading, error, refresh, start, resolve };
}
