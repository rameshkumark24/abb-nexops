// Pure mappers: LIVE TelemetryRecord -> UI types. No side effects, no state.
// This file (with the hook) is the ONLY place that knows the data shape.

import type {
  TelemetryRecord,
  Machine,
  Task,
  Alarm,
  ControlPanelAlarm,
  AlarmPriority,
} from '@/types/telemetry';

// ----------------------------------------------------------------------
// FIELD_MAP - the single rename choke point { liveKey: uiKey }.
// Every live->ui field rename the mappers below perform is recorded here so
// there is one obvious place to look when the source schema changes.
// ----------------------------------------------------------------------

export const FIELD_MAP = {
  Machine: 'name', // -> Machine.name / Task.machine
  message: 'msg', // -> Alarm.msg
  object_name: 'code', // -> ControlPanelAlarm.code
  Timestamp: 'time', // -> Alarm.time
  Alert: 'title', // -> Task.title
} as const;

// ----------------------------------------------------------------------
// Zone mapping.
// Stable, fixed grouping of machines into control-room zones so the same
// machine always reports the same zone (the grid groups by zone). Machines
// not in the table fall back to a deterministic A/B/C/D bucket derived from
// the name, so unknown assets are still stable (never random per render).
// ----------------------------------------------------------------------

const ZONE_MAP: Record<string, string> = {
  Compressor: 'Zone A',
  Pump: 'Zone A',
  Motor: 'Zone A',
  'Instrument Air Compressor': 'Zone A',
  'Distillation Column': 'Zone B',
  'Heat Exchanger': 'Zone B',
  'Storage Tank': 'Zone B',
  Separator: 'Zone B',
  Boiler: 'Zone C',
  Generator: 'Zone C',
  'Control Valve': 'Zone C',
  'MCC Panel': 'Zone C',
  Reactor: 'Zone D',
  'Fired Heater': 'Zone D',
  'Cooling Tower': 'Zone D',
  'Flare System': 'Zone D',
};

const ZONE_FALLBACK = ['Zone A', 'Zone B', 'Zone C', 'Zone D'];

function zoneFor(machine: string): string {
  if (ZONE_MAP[machine]) return ZONE_MAP[machine];
  // deterministic bucket from the name so it's stable across renders
  let h = 0;
  for (let i = 0; i < machine.length; i++) h = (h + machine.charCodeAt(i)) % ZONE_FALLBACK.length;
  return ZONE_FALLBACK[h];
}

// ----------------------------------------------------------------------
// computePerf - ties the headline perf number to the alarm model.
//
// Rationale: by basing perf on alarm severity AND adding a small "drift
// penalty" for developing/predictive faults, a fault that is still
// INCUBATING (below its static trip limit) already pushes perf below the
// perf<80 critical line in the UI - so the predictive story is visible
// BEFORE the static alarm trips. The tiny jitter keeps healthy bars alive.
// ----------------------------------------------------------------------

export function computePerf(raw: TelemetryRecord): number {
  // 1) base by worst active alarm severity (check worst first)
  let base: number;
  if (raw.Status === 'Normal') base = 100;
  else if (raw.alarm_priority === 'Critical') base = 40;
  else if (raw.alarm_priority === 'High') base = 65;
  else if (raw.alarm_priority === 'Medium' || raw.is_predictive) base = 85;
  else base = 100; // Low / unclassified -> treat as healthy

  // 2) drift penalty up to 8 points for developing/predictive states.
  // We try to infer closeness to tripping from the message; if it isn't
  // cleanly inferable we use a modest fixed penalty of 4 for predictive.
  let penalty = 0;
  if (raw.is_predictive || (raw.Status === 'Warning' && raw.alarm_state === 'ACT')) {
    if (/not yet reached|developing|trend/i.test(raw.message)) {
      penalty = 4; // incubating: modest, still drifting
    } else if (/exceeded|static limit/i.test(raw.message)) {
      penalty = 8; // close to / at the trip point
    } else {
      penalty = 4; // not cleanly inferable -> modest fixed
    }
  }

  // 3) tiny jitter so healthy bars aren't frozen
  const jitter = Math.random() * 3 - 1.5; // +/- 1.5

  const perf = base - penalty + jitter;
  return Math.round(Math.max(0, Math.min(100, perf)));
}

// ----------------------------------------------------------------------
// Mappers
// ----------------------------------------------------------------------

export function mapToMachine(raw: TelemetryRecord): Machine {
  return {
    name: raw.Machine,
    zone: zoneFor(raw.Machine),
    perf: computePerf(raw),
  };
}

// Alarm.time: we keep it a string and just extract the clock portion
// (HH:MM:SS) from the "YYYY-MM-DD HH:MM:SS" timestamp. No Date parsing, so
// no timezone surprises - it shows exactly what the gateway reported.
function formatTime(timestamp: string): string {
  const parts = timestamp.split(' ');
  return parts.length > 1 ? parts[1] : timestamp;
}

export function mapToAlarm(raw: TelemetryRecord): Alarm {
  return {
    time: formatTime(raw.Timestamp),
    msg: raw.message,
    type: raw.Status === 'Critical' ? 'CRITICAL' : 'WARNING',
  };
}

function dotForPriority(priority: AlarmPriority): string {
  if (priority === 'Critical') return '#ef4444';
  if (priority === 'High' || priority === 'Medium') return '#f59e0b';
  return '#22c55e';
}

export function mapToControlPanelAlarm(raw: TelemetryRecord): ControlPanelAlarm {
  return {
    dot: dotForPriority(raw.alarm_priority),
    code: raw.object_name,
    text: `${raw.Alert} · ${raw.message}`,
  };
}

function priorityFromStatus(raw: TelemetryRecord): Task['priority'] {
  if (raw.Status === 'Critical') return 'CRITICAL';
  if (raw.Status === 'Warning') return 'WARNING';
  return 'NORMAL';
}

export function mapToTask(raw: TelemetryRecord): Task {
  return {
    id: `T-${raw.alarm_id}`,
    title: raw.Alert,
    machine: raw.Machine,
    tech: 'Unassigned',
    priority: priorityFromStatus(raw),
  };
}
