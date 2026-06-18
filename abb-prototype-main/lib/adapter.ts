// Pure mappers: LIVE TelemetryRecord -> UI types. No side effects, no state.
// This file (with the hook) is the ONLY place that knows the data shape.

import type {
  TelemetryRecord,
  Machine,
  Task,
  Alarm,
  ControlPanelAlarm,
  AlarmPriority,
  NexopsRisk,
  SiteAlert,
  EmergencyType,
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

export function zoneFor(machine: string): string {
  const lower = machine.toLowerCase();
  for (const key of Object.keys(ZONE_MAP)) {
    if (lower.includes(key.toLowerCase())) {
      return ZONE_MAP[key];
    }
  }
  if (ZONE_MAP[machine]) return ZONE_MAP[machine];
  // deterministic bucket from the name so it's stable across renders
  let h = 0;
  for (let i = 0; i < machine.length; i++) h = (h + machine.charCodeAt(i)) % ZONE_FALLBACK.length;
  return ZONE_FALLBACK[h];
}

// ----------------------------------------------------------------------
// NexOps risk -> perf, and the "caught it early" flag.
//
// NEXOPS_PERF maps NexOps's OWN verdict to a perf number. Higher risk = lower
// perf, with the LOW->100 .. CRITICAL->40 ladder requested for the demo.
// MEDIUM sits right on the perf<80 at-risk line (~80) by design.
//
// isEarly is the headline feature, now a DIVERGENCE catch: while a fault is
// still pre-threshold (is_predictive) and is NOT nuisance, NexOps rates it
// STRICTLY HIGHER than the gateway's own severity. The gateway under-rates the
// developing fault as a low Warning; NexOps escalates it higher and EARLIER,
// before the static limit trips. It fires immediately from is_predictive (no
// dependency on a warm anomaly score); the anomaly score corroborates later.
// ----------------------------------------------------------------------

const NEXOPS_PERF: Record<NexopsRisk, number> = {
  CRITICAL: 40,
  HIGH: 62,
  MEDIUM: 80,
  LOW: 100,
};

// Gateway alarm_priority -> 0..3 severity index (Low/Normal -> 0 LOW, Medium ->
// 1, High -> 2, Critical -> 3). Mirrors the backend risk._gateway_level mapping;
// anything missing/unrecognized defaults SAFELY to LOW (0).
const GATEWAY_SEVERITY_INDEX: Record<string, number> = {
  Critical: 3,
  High: 2,
  Medium: 1,
  Low: 0,
  Normal: 0,
};

// NexOps risk -> 0..3 index on the same ladder.
const RISK_INDEX: Record<NexopsRisk, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function gatewaySeverityIndex(raw: TelemetryRecord): number {
  return GATEWAY_SEVERITY_INDEX[raw.alarm_priority as string] ?? 0;
}

function gatewayIsCalm(raw: TelemetryRecord): boolean {
  // Calm = the gateway itself sees nothing: Status Normal/absent AND priority
  // Low/absent. FAIL-SAFE: MISSING fields read as calm, so an uncertain reading
  // is treated as anomaly-only and gets CAPPED (the safe direction).
  const status = String(raw.Status ?? '').toLowerCase();
  const prio = String(raw.alarm_priority ?? '').toLowerCase();
  return (status === '' || status === 'normal') && (prio === '' || prio === 'low');
}

// ANOMALY-ONLY CAP (mirrors backend risk.py): a pure-anomaly signal
// (is_predictive !== true) on a CALM gateway can never DISPLAY above MEDIUM, no
// matter how high nexops_risk is. Predictive trends and real gateway
// Warning/Critical events are returned UNCAPPED (headline early-catch intact).
// FAIL-SAFE: missing is_predictive -> treated as not predictive (caps).
export function cappedRisk(raw: TelemetryRecord): NexopsRisk {
  const risk: NexopsRisk = raw.nexops_risk ?? 'LOW';
  const anomalyOnly = raw.is_predictive !== true && gatewayIsCalm(raw);
  if (anomalyOnly && (RISK_INDEX[risk] ?? 0) > RISK_INDEX.MEDIUM) return 'MEDIUM';
  return risk;
}

// EARLY = NexOps flags what the gateway does not (never on nuisance). Two cases:
//   - PREDICTIVE divergence (is_predictive === true): NexOps risk strictly ABOVE
//     the gateway severity - full strength, may be HIGH/CRITICAL (headline).
//   - ANOMALY-ONLY on a calm gateway: NexOps elevated to MEDIUM+ while the gateway
//     is calm - still an EARLY catch, but capped at MEDIUM (see cappedRisk).
export function isEarlyWarning(raw: TelemetryRecord): boolean {
  // PREFER the backend's single-source-of-truth flag. The backend now stamps
  // is_early on the wire (computed from this exact rule), so all views agree.
  // Fall back to the client-side computation only for OLD records that predate
  // the field (backward-compat) — do NOT remove the fallback.
  if (typeof raw.is_early === 'boolean') return raw.is_early;
  if (raw.is_nuisance === true) return false; // noise is never EARLY
  const riskIdx = RISK_INDEX[cappedRisk(raw)] ?? 0; // cappedRisk re-cap is idempotent here
  if (raw.is_predictive === true) {
    return riskIdx > gatewaySeverityIndex(raw); // predictive divergence
  }
  return gatewayIsCalm(raw) && riskIdx >= RISK_INDEX.MEDIUM; // anomaly-only catch
}

// ----------------------------------------------------------------------
// computePerf - ties the headline perf number to the risk model.
//
// RULE: NexOps risk takes precedence for the visual state, but can only ever
// ESCALATE (never mask) the gateway's own view. We compute two perf numbers -
// one from NexOps's verdict, one from the existing gateway-severity logic -
// and take the WORST (lowest). So a gateway-Normal machine that NexOps rates
// HIGH still drops below the perf<80 at-risk line (the "caught it early"
// moment), while a gateway-Critical machine stays critical even if NexOps is
// quiet. The tiny jitter keeps healthy bars alive.
// ----------------------------------------------------------------------

export function computePerf(raw: TelemetryRecord): number {
  // --- gateway-severity base (kept as the floor) ---
  let base: number;
  if (raw.Status === 'Normal') base = 100;
  else if (raw.alarm_priority === 'Critical') base = 40;
  else if (raw.alarm_priority === 'High') base = 65;
  else if (raw.alarm_priority === 'Medium' || raw.is_predictive) base = 85;
  else base = 100; // Low / unclassified -> treat as healthy

  // drift penalty up to 8 points for developing/predictive states.
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
  const gatewayPerf = base - penalty;

  // --- NexOps verdict (PRIMARY driver) --- capped for anomaly-only calm reads so
  // a residual high anomaly score can't drag perf to HIGH/CRITICAL territory.
  const nexopsPerf = NEXOPS_PERF[cappedRisk(raw)];

  // tiny jitter so healthy bars aren't frozen
  const jitter = Math.random() * 3 - 1.5; // +/- 1.5

  const perf = Math.min(nexopsPerf, gatewayPerf) + jitter;
  return Math.round(Math.max(0, Math.min(100, perf)));
}

// ----------------------------------------------------------------------
// Mappers
// ----------------------------------------------------------------------

export function mapToMachine(raw: TelemetryRecord): Machine {
  const rawZone = raw.zone ? `Zone ${raw.zone}` : null;
  return {
    name: raw.Machine,
    zone: rawZone || zoneFor(raw.Machine),
    perf: computePerf(raw),
    nexopsRisk: cappedRisk(raw),
    anomalyScore: raw.anomaly_score ?? null,
    isEarly: isEarlyWarning(raw),
    reasoning: raw.nexops_reasoning ?? '',
    assignedEngineer: raw.assigned_engineer ?? 'Unassigned',
    faultCategory: raw.fault_category ?? null,
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
    nexopsRisk: cappedRisk(raw),
    anomalyScore: raw.anomaly_score ?? null,
    isEarly: isEarlyWarning(raw),
    reasoning: raw.nexops_reasoning ?? '',
    siteAlert: raw.site_alert === true,
    emergencyType: raw.emergency_type ?? null,
    isNuisance: raw.is_nuisance === true,
  };
}

// Human labels for the site-emergency banner.
const EMERGENCY_LABELS: Record<string, string> = {
  fire: 'FIRE DETECTED',
  gas_leak: 'GAS LEAK',
  emergency_stop: 'EMERGENCY STOP',
};

// Project a raw record into the banner's SiteAlert shape. Call ONLY when
// raw.site_alert is true (the hook decides that + handles persistence).
export function mapToSiteAlert(raw: TelemetryRecord): SiteAlert {
  const et: EmergencyType = raw.emergency_type ?? null;
  const label = (et && EMERGENCY_LABELS[et]) || raw.Alert || 'SITE EMERGENCY';
  return {
    machine: raw.Machine,
    emergencyType: et,
    engineer: raw.assigned_engineer ?? 'Unassigned',
    time: formatTime(raw.Timestamp),
    label,
  };
}

function dotForPriority(priority: AlarmPriority): string {
  if (priority === 'Critical') return '#ef4444';
  if (priority === 'High' || priority === 'Medium') return '#f59e0b';
  return '#22c55e';
}

export function mapToControlPanelAlarm(raw: TelemetryRecord): ControlPanelAlarm {
  const early = isEarlyWarning(raw);
  const risk: NexopsRisk = cappedRisk(raw);
  // On an early catch the gateway priority is still Low (a green dot), which
  // understates the risk - colour the dot by NexOps's verdict instead so the
  // control panel reflects what NexOps sees, not just the static threshold.
  const dot = early
    ? risk === 'CRITICAL'
      ? '#ef4444'
      : '#f59e0b'
    : dotForPriority(raw.alarm_priority);
  return {
    dot,
    code: raw.object_name,
    text: `${raw.Alert} · ${raw.message}`,
    isEarly: early,
    reasoning: raw.nexops_reasoning ?? '',
    siteAlert: raw.site_alert === true,
    emergencyType: raw.emergency_type ?? null,
    isNuisance: raw.is_nuisance === true,
  };
}

function priorityFromStatus(raw: TelemetryRecord): Task['priority'] {
  if (raw.Status === 'Critical') return 'CRITICAL';
  if (raw.Status === 'Warning') return 'WARNING';
  return 'NORMAL';
}

export function mapToTask(raw: TelemetryRecord): Task {
  const assignedEngineer = raw.assigned_engineer ?? 'Unassigned';
  return {
    id: `T-${raw.alarm_id}`,
    title: raw.Alert,
    machine: raw.Machine,
    // The dropdown DEFAULT is now the REAL auto-assigned engineer, not a static
    // "Unassigned" placeholder. Manual override still works in the UI.
    tech: assignedEngineer,
    priority: priorityFromStatus(raw),
    assignedEngineer,
    assignmentReason: raw.assignment_reason ?? null,
    faultCategory: raw.fault_category ?? null,
  };
}
