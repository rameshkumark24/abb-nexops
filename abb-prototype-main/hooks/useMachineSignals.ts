'use client';

// useMachineSignals — keeps the last 5 live-derived readings per machine for the
// Field Manager's machine-health drawer (Section 2B).
//
// The backend hooks expose only the latest Machine state (no raw Temp/Pressure
// history and no per-machine time series), so — like useAlarmHistory — we
// accumulate a small in-session ring from the `machines` snapshots useLiveData
// already produces. The "key signal values" we can honestly surface are the
// live-derived ones: health %, anomaly score, and the NexOps risk verdict.

import { useEffect, useRef, useState } from 'react';
import type { Machine } from '@/types/telemetry';

export interface Reading {
  ts: number;
  perf: number;
  anomaly: number | null;
  risk: string;
}

const RING = 5;

export function useMachineSignals(machines: Machine[]): Record<string, Reading[]> {
  const [readings, setReadings] = useState<Record<string, Reading[]>>({});
  const lastSig = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (machines.length === 0) return;
    const now = Date.now();
    const updates: Record<string, Reading> = {};
    for (const m of machines) {
      const sig = `${m.perf}|${m.anomalyScore ?? 'n'}|${m.nexopsRisk}`;
      if (lastSig.current.get(m.name) === sig) continue; // unchanged tick
      lastSig.current.set(m.name, sig);
      updates[m.name] = { ts: now, perf: m.perf, anomaly: m.anomalyScore ?? null, risk: m.nexopsRisk };
    }
    if (Object.keys(updates).length === 0) return;
    setReadings((prev) => {
      const next = { ...prev };
      for (const [name, r] of Object.entries(updates)) {
        next[name] = [...(next[name] ?? []), r].slice(-RING);
      }
      return next;
    });
  }, [machines]);

  return readings;
}
