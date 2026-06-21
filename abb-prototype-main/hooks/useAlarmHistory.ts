'use client';

// ----------------------------------------------------------------------
// useAlarmHistory — a SESSION-SCOPED, frontend-only alarm accumulator.
//
// The backend hooks (useLiveData) expose only the latest state per machine
// plus a rolling ~10 alarm list; there is no historical alarm log served by
// the API (and we must not add one). To drive the 24h / 7d analytics widgets
// on the Plant dashboard we therefore DERIVE a timeline ENTIRELY on the
// frontend from the same live `machines` snapshot useLiveData already
// produces — exactly the pattern the existing LiveMetrics accumulator uses.
//
// Honest framing: this is NOT backfilled history. It records a discrete
// alarm EVENT on the rising edge of each machine entering an alarm state
// (perf < 80, CRITICAL, or EARLY) as frames stream in. It starts empty and
// fills over the session. No mock data, no backend change, no extra socket
// (it consumes the array useLiveData already returns).
// ----------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import type { Machine } from '@/types/telemetry';

// Event severities (NOMINAL never occurs — events are only recorded for alarms).
export type AlarmSeverity = 'CRITICAL' | 'WARNING' | 'EARLY';

export interface AlarmEvent {
  ts: number; // ms epoch when the alarm onset was first observed this session
  machine: string;
  zone: string; // 'Zone A' .. 'Zone D'
  fault: string; // faultCategory, or 'general' when the backend left it null
  severity: AlarmSeverity;
  dispatched: boolean; // an engineer was auto-assigned to this fault
}

// Keep the buffer bounded so a long-running session can't grow without limit.
const MAX_EVENTS = 4000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// The same at-risk line the Plant dashboard already uses for "ACTIVE ALARMS"
// (perf < 80), widened to always include CRITICAL and EARLY catches.
function isAlarming(m: Machine): boolean {
  return m.perf < 80 || m.nexopsRisk === 'CRITICAL' || m.isEarly;
}

function severityOf(m: Machine): AlarmSeverity {
  if (m.nexopsRisk === 'CRITICAL') return 'CRITICAL';
  if (m.isEarly) return 'EARLY';
  return 'WARNING'; // HIGH / MEDIUM gateway alarms surface as WARNING
}

export function useAlarmHistory(machines: Machine[]): AlarmEvent[] {
  const [events, setEvents] = useState<AlarmEvent[]>([]);
  // Per-machine "was alarming last tick" flag for rising-edge detection so we
  // record ONE event per alarm onset rather than one per frame.
  const alarming = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (machines.length === 0) return;
    const now = Date.now();
    const fresh: AlarmEvent[] = [];

    for (const m of machines) {
      const was = alarming.current.get(m.name) ?? false;
      const is = isAlarming(m);
      if (is && !was) {
        fresh.push({
          ts: m.timestamp || now,
          machine: m.name,
          zone: m.zone,
          fault: (m.faultCategory && m.faultCategory.trim()) || 'general',
          severity: severityOf(m),
          dispatched: !!m.assignedEngineer && m.assignedEngineer !== 'Unassigned',
        });
      }
      alarming.current.set(m.name, is);
    }

    if (fresh.length === 0) return;
    setEvents((prev) => {
      const merged = [...prev, ...fresh].filter((e) => now - e.ts <= SEVEN_DAYS_MS);
      return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
    });
  }, [machines]);

  return events;
}
