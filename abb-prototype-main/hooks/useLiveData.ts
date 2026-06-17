'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  TelemetryRecord,
  Machine,
  Alarm,
  Task,
  ControlPanelAlarm,
  Status,
  AlarmType,
  AlarmPriority,
  AlarmState,
  NexopsRisk,
  SiteAlert,
} from '@/types/telemetry';
import {
  mapToMachine,
  mapToAlarm,
  mapToTask,
  mapToControlPanelAlarm,
  mapToSiteAlert,
  isEarlyWarning,
} from '@/lib/adapter';

// ======================================================================
// SWAPPABLE DATA SOURCE
// `subscribe` is the single seam between the UI and the data source. The
// hook below knows nothing about WHERE records come from - only that
// subscribe(onRecord) delivers TelemetryRecord values and returns an
// unsubscribe function.
// ======================================================================

const MOCK_MACHINES = [
  'Compressor',
  'Pump',
  'Heat Exchanger',
  'Boiler',
  'Motor',
  'Distillation Column',
  'Reactor',
  'Cooling Tower',
];

function formatNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function r1(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

// Build one record in the REAL telemetry shape. We cycle machines and, on a
// rotating schedule, emit predictive / high / critical variants so the UI
// shows variety (most ticks are Normal).
function makeMockRecord(seq: number): TelemetryRecord {
  const machine = MOCK_MACHINES[seq % MOCK_MACHINES.length];
  const roll = seq % 7;

  let status: Status;
  let priority: AlarmPriority;
  let type: AlarmType;
  let state: AlarmState;
  let predictive: boolean;
  let alert: string;
  let message: string;

  if (roll === 2) {
    // predictive early-warning (below static limit) - the demo centrepiece
    status = 'Warning';
    priority = 'Medium';
    type = 'Predictive';
    state = 'ACT';
    predictive = true;
    alert = 'Cooling Efficiency Trend';
    message = `${machine} Fouling developing - trending up (static limit 105.0 C not yet reached)`;
  } else if (roll === 4) {
    // tripped critical
    status = 'Critical';
    priority = 'Critical';
    type = 'Process';
    state = 'ACT';
    predictive = false;
    alert = 'High Pressure';
    message = `${machine} - static limit exceeded, immediate attention required`;
  } else if (roll === 5) {
    // high warning
    status = 'Warning';
    priority = 'High';
    type = 'Process';
    state = 'ACT';
    predictive = false;
    alert = 'Rising Load Trend';
    message = `${machine} load rising - approaching limit`;
  } else {
    // normal
    status = 'Normal';
    priority = 'Low';
    type = 'Process';
    state = 'RTN';
    predictive = false;
    alert = 'None';
    message = 'All parameters within normal operating range';
  }

  const priorityLevel =
    priority === 'Critical' ? 1 : priority === 'High' ? 2 : priority === 'Medium' ? 3 : 4;

  // Mock NexOps anomaly view: mirror gateway severity, but let a predictive
  // (incubating) fault read as elevated so the fallback still exercises the
  // "caught early" path the real backend produces.
  const nexopsRisk: NexopsRisk =
    priority === 'Critical'
      ? 'CRITICAL'
      : priority === 'High' || predictive
      ? 'HIGH'
      : priority === 'Medium'
      ? 'MEDIUM'
      : 'LOW';
  const anomalyScore =
    nexopsRisk === 'CRITICAL' ? 0.9 : nexopsRisk === 'HIGH' ? 0.78 : nexopsRisk === 'MEDIUM' ? 0.55 : 0.12;

  return {
    Machine: machine,
    Timestamp: formatNow(),
    Temp: r1(45, 90),
    Pressure: r1(2, 8),
    Level: seq % 2 === 0 ? r1(40, 85) : null,
    Flow: r1(80, 115),
    Status: status,
    Alert: alert,
    features: { primary: r1(45, 90), secondary: r1(2, 8) },
    alarm_id: 1000 + seq,
    alarm_type: type,
    alarm_priority: priority,
    priority_level: priorityLevel,
    alarm_state: state,
    ack_state: state === 'ACT' ? 'Unacknowledged' : 'Acknowledged',
    is_predictive: predictive,
    object_name: `TAG-${machine.slice(0, 3).toUpperCase()}${(seq % 9) + 1}`,
    object_description: machine,
    message,
    anomaly_score: anomalyScore,
    anomaly_status: 'scored',
    nexops_risk: nexopsRisk,
    nexops_reasoning: predictive
      ? 'anomaly_score 0.78 high while gateway calm — predicted issue before static threshold'
      : `gateway ${priority}`,
    // Assignment + emergency layer (mock): the tripped-critical roll doubles as a
    // site-wide FIRE emergency so the fallback also exercises the RED ZONE banner.
    assigned_engineer: status === 'Normal' ? 'Unassigned' : 'Ravi Kumar',
    assigned_engineer_id: status === 'Normal' ? null : 1,
    assignment_reason:
      status === 'Normal' ? null : 'Ravi Kumar: mechanical skill match, low load, fastest MTTR',
    fault_category: status === 'Normal' ? null : 'mechanical',
    site_alert: roll === 4,
    alert_scope: roll === 4 ? 'site' : 'normal',
    emergency_type: roll === 4 ? 'fire' : null,
    is_nuisance: false,
    nuisance_type: null,
  };
}

// Backend WebSocket bridge. Override per-environment with NEXT_PUBLIC_WS_URL.
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws';

function subscribe(
  onRecord: (record: TelemetryRecord) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  // ===== STAGE 2 SWAP POINT: LIVE WebSocket client =====
  // Records arrive already in the TelemetryRecord shape, so nothing else in
  // this file (or any component) changes - only this body.
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false; // set by unsubscribe so we never reconnect after unmount

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      if (!stopped) onStatus?.(true);
    };

    ws.onmessage = (event) => {
      try {
        const record = JSON.parse(event.data) as TelemetryRecord;
        onRecord(record);
      } catch (err) {
        // One malformed message must not kill the stream - log and continue.
        console.error('[useLiveData] skipping malformed WS message:', err);
      }
    };

    // On an unexpected close, mark disconnected and retry after a short delay
    // so a backend restart doesn't permanently break the UI.
    ws.onclose = () => {
      onStatus?.(false);
      if (stopped || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 2000);
    };

    // onerror is typically followed by onclose; route through the close path.
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  };

  connect();

  // unsubscribe: stop reconnecting and close the socket cleanly.
  return () => {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws !== null) {
      ws.onclose = null; // prevent the close handler from scheduling a reconnect
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    onStatus?.(false);
  };
  // ===== END STAGE 2 SWAP POINT =====

  // ----------------------------------------------------------------------
  // FALLBACK: local mock source (instant demo fallback if the backend is
  // down). The generator helpers above (makeMockRecord/MOCK_MACHINES/...)
  // are kept for exactly this. To use it, comment out the WebSocket body
  // above and uncomment this block:
  //
  //   let seq = 0;
  //   onStatus?.(true);
  //   const intervalId = setInterval(() => {
  //     onRecord(makeMockRecord(seq));
  //     seq += 1;
  //   }, 2000);
  //   return () => { clearInterval(intervalId); onStatus?.(false); };
  // ----------------------------------------------------------------------
}

// ======================================================================
// useLiveData - runs every incoming record through the adapter and exposes
// ready-to-render UI state. Components stay dumb.
//
// NOTE on the return shape: in addition to the documented
// { machines, alarms, tasks, connected } it also exposes `controlAlarms`
// (ControlPanelAlarm[]). ControlPanelAlarm needs raw fields (object_name,
// priority) that the plain Alarm type does not carry, so it cannot be
// derived downstream from `alarms` - the hook (which holds the raw records)
// must project it. This keeps shape knowledge in the hook/adapter only.
// ======================================================================

// How long a RED ZONE site alert persists after the last site_alert record, so
// the banner doesn't flicker between ticks while an emergency is ongoing.
// Set to 30s (> the simulator's ~16s per-machine revisit gap) so the banner
// stays SOLID across the gap; it still clears ~30s after the last site_alert
// record, so a resolved emergency stops showing. Tune here if the revisit
// cadence changes.
const SITE_ALERT_PERSIST_MS = 30000;

// ======================================================================
// LIVE METRICS (additive) - session-scoped prediction/segregation metrics
// derived ENTIRELY on the frontend from the same WebSocket frames the UI
// already consumes. No backend, no endpoints, no schema changes. All math is
// wrapped in try/catch at the call site so a malformed frame can never break
// the live feed or the panel.
//
// Honest framing: lead time is measured vs the static gateway on the SAME
// events (when NexOps flagged EARLY vs when the gateway's static threshold
// tripped); corroboration is independent ML agreement. Nothing is graded
// against synthetic labels.
// ======================================================================

const TEN_MIN_MS = 600000;     // rolling window for the alarm-reduction metric
const LEAD_RING_MAX = 20;      // keep the last ~20 completed fault leads
const CORROB_ANOM_MIN = 0.45;  // MEDIUM anomaly cutoff (mirrors backend risk.py)

// Published, render-ready snapshot the panel consumes (components stay dumb).
export interface LiveMetrics {
  earlyCatches: number;             // distinct (machine,fault) flagged EARLY before the gateway tripped
  completedLeads: number;           // faults with a positive completed lead
  openEarly: number;                // flagged EARLY, gateway not yet tripped ("still early")
  avgLeadSeconds: number | null;    // rolling avg over the last ~20 leads
  maxLeadSeconds: number | null;    // best lead so far
  leadRing: number[];               // last ~20 lead times (seconds)
  nuisanceFiltered: number;         // is_nuisance records suppressed (never queued)
  rawAlarms10m: number;             // gateway Warning/Critical incl. nuisance, last 10 min
  actionableAlarms10m: number;      // real, non-nuisance, assigned, last 10 min
  reductionPct: number | null;      // (1 - actionable/raw) * 100
  corroboratedEarly: number;        // EARLY faults the ML model independently agreed with
  corroborationRate: number | null; // corroboratedEarly / earlyCatches * 100
  anomalyWarming: boolean;          // no anomaly_status==='scored' frame seen yet
  samples: number;                  // frames processed (drives the empty state)
}

// Mutable accumulator (kept in a ref; never rendered directly).
interface MetricsAcc {
  earlyCatches: number;
  completedLeads: number;
  corroboratedEarly: number;
  nuisanceFiltered: number;
  leadRing: number[];
  maxLeadSeconds: number;
  rawAlarmTimes: number[];   // arrival ms of raw gateway alarms (incl. nuisance)
  actionableTimes: number[]; // arrival ms of actionable alarms
  scoredSeen: boolean;
  samples: number;
}

// Per-machine fault lifecycle used to compute lead time. One "fault" runs from
// the first non-Normal frame until the machine returns to Normal.
interface FaultLC {
  earlyAt: number | null;   // ms when isEarlyWarning first became true
  trippedAt: number | null; // ms when the static threshold first tripped
  earlyCounted: boolean;    // counted once into earlyCatches
  leadRecorded: boolean;    // lead resolved once per fault
  corroborated: boolean;    // ML agreed at/after the EARLY flag
}

function freshMetricsAcc(): MetricsAcc {
  return {
    earlyCatches: 0, completedLeads: 0, corroboratedEarly: 0, nuisanceFiltered: 0,
    leadRing: [], maxLeadSeconds: 0, rawAlarmTimes: [], actionableTimes: [],
    scoredSeen: false, samples: 0,
  };
}

function freshLC(): FaultLC {
  return { earlyAt: null, trippedAt: null, earlyCounted: false, leadRecorded: false, corroborated: false };
}

const EMPTY_METRICS: LiveMetrics = {
  earlyCatches: 0, completedLeads: 0, openEarly: 0, avgLeadSeconds: null,
  maxLeadSeconds: null, leadRing: [], nuisanceFiltered: 0, rawAlarms10m: 0,
  actionableAlarms10m: 0, reductionPct: null, corroboratedEarly: 0,
  corroborationRate: null, anomalyWarming: true, samples: 0,
};

// Drop timestamps older than the rolling 10-min window (front of the array).
function pruneWindow(times: number[], now: number): void {
  while (times.length && now - times[0] > TEN_MIN_MS) times.shift();
}

// Fold ONE frame into the accumulator + per-machine lifecycle map. Mutates in
// place; the caller wraps it in try/catch so a malformed frame is safely skipped.
function accumulateMetrics(
  raw: TelemetryRecord,
  acc: MetricsAcc,
  lcMap: Map<string, FaultLC>,
  now: number,
): void {
  acc.samples += 1;
  if (raw.anomaly_status === 'scored') acc.scoredSeen = true;

  const nuisance = raw.is_nuisance === true;
  const isGatewayAlarm = raw.Status === 'Warning' || raw.Status === 'Critical';
  const assigned = !!raw.assigned_engineer && raw.assigned_engineer !== 'Unassigned';

  // (4) ALARM REDUCTION: raw = every gateway alarm (incl. nuisance); actionable
  // = the real, non-nuisance, dispatched subset. Rolling 10-min window.
  if (isGatewayAlarm) acc.rawAlarmTimes.push(now);
  if (isGatewayAlarm && !nuisance && assigned) acc.actionableTimes.push(now);
  pruneWindow(acc.rawAlarmTimes, now);
  pruneWindow(acc.actionableTimes, now);

  // (3) NUISANCE SUPPRESSION: count it, and STOP - noise never drives a fault
  // lifecycle (and the backend already keeps it out of the task queue).
  if (nuisance) {
    acc.nuisanceFiltered += 1;
    return;
  }

  // Fault lifecycle is per machine. A return to Normal closes the current fault.
  const machine = raw.Machine;
  if (raw.Status === 'Normal') {
    lcMap.delete(machine);
    return;
  }

  const lc = lcMap.get(machine) ?? freshLC();
  const early = isEarlyWarning(raw);
  // (1) STATIC THRESHOLD TRIP: the gateway's REAL static alarm - a non-predictive
  // Warning(>Low)/Critical. The incubation window is is_predictive=true (a low
  // Warning), so excluding it is what makes the early-vs-gateway lead meaningful.
  const tripped =
    raw.is_predictive !== true &&
    ((raw.Status === 'Warning' && raw.alarm_priority !== 'Low') || raw.Status === 'Critical');

  // (2) EARLY first-seen -> count once.
  if (early && lc.earlyAt === null) {
    lc.earlyAt = now;
    if (!lc.earlyCounted) {
      acc.earlyCatches += 1;
      lc.earlyCounted = true;
    }
  }
  if (tripped && lc.trippedAt === null) lc.trippedAt = now;

  // (1) Completed LEAD: NexOps flagged EARLY before the gateway tripped. Resolve
  // once per fault; only positive leads count. A fault that never trips stays an
  // "open early" (see openEarly) rather than a completed lead.
  if (lc.earlyAt !== null && lc.trippedAt !== null && !lc.leadRecorded) {
    lc.leadRecorded = true;
    const lead = (lc.trippedAt - lc.earlyAt) / 1000;
    if (lead > 0) {
      acc.leadRing.push(lead);
      if (acc.leadRing.length > LEAD_RING_MAX) acc.leadRing.shift();
      acc.completedLeads += 1;
      if (lead > acc.maxLeadSeconds) acc.maxLeadSeconds = lead;
    }
  }

  // (5) CORROBORATION: of EARLY faults, those the independent ML model agreed
  // with (scored + anomaly_score >= MEDIUM cutoff) at/after the EARLY flag.
  if (
    lc.earlyAt !== null &&
    !lc.corroborated &&
    raw.anomaly_status === 'scored' &&
    (raw.anomaly_score ?? 0) >= CORROB_ANOM_MIN
  ) {
    lc.corroborated = true;
    acc.corroboratedEarly += 1;
  }

  lcMap.set(machine, lc);
}

// Build the render-ready snapshot from the accumulator + live lifecycle map.
function buildMetricsSnapshot(acc: MetricsAcc, lcMap: Map<string, FaultLC>): LiveMetrics {
  const ring = acc.leadRing;
  const avg = ring.length ? ring.reduce((a, b) => a + b, 0) / ring.length : null;

  let openEarly = 0;
  lcMap.forEach((lc) => {
    if (lc.earlyAt !== null && lc.trippedAt === null) openEarly += 1;
  });

  const raw = acc.rawAlarmTimes.length;
  const act = acc.actionableTimes.length;

  return {
    earlyCatches: acc.earlyCatches,
    completedLeads: acc.completedLeads,
    openEarly,
    avgLeadSeconds: avg,
    maxLeadSeconds: acc.maxLeadSeconds > 0 ? acc.maxLeadSeconds : null,
    leadRing: [...ring],
    nuisanceFiltered: acc.nuisanceFiltered,
    rawAlarms10m: raw,
    actionableAlarms10m: act,
    reductionPct: raw > 0 ? Math.round((1 - act / raw) * 100) : null,
    corroboratedEarly: acc.corroboratedEarly,
    corroborationRate: acc.earlyCatches > 0 ? Math.round((acc.corroboratedEarly / acc.earlyCatches) * 100) : null,
    anomalyWarming: !acc.scoredSeen,
    samples: acc.samples,
  };
}

export function useLiveData() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [controlAlarms, setControlAlarms] = useState<ControlPanelAlarm[]>([]);
  const [connected, setConnected] = useState(false);
  // The active site-wide emergency (or null). Persisted ~30s after the last
  // site_alert record so it doesn't flicker; clears when none arrive.
  const [siteAlert, setSiteAlert] = useState<SiteAlert | null>(null);
  // Session-scoped live prediction/segregation metrics (rendered snapshot).
  const [metrics, setMetrics] = useState<LiveMetrics>(EMPTY_METRICS);

  // Keyed by machine name so each grid/task entry reflects the machine's
  // latest state instead of growing without bound.
  const machineMap = useRef<Map<string, Machine>>(new Map());
  const taskMap = useRef<Map<string, Task>>(new Map());
  const siteAlertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mutable metrics accumulator + per-machine fault lifecycles (no re-render);
  // the published snapshot lives in `metrics` state above. Reset on reload.
  const metricsAcc = useRef<MetricsAcc>(freshMetricsAcc());
  const faultLC = useRef<Map<string, FaultLC>>(new Map());

  useEffect(() => {
    // `connected` is now driven by the socket lifecycle (onopen/onclose),
    // reported via the second subscribe() argument.
    const unsubscribe = subscribe((raw) => {
      // machines: newest state per machine
      machineMap.current.set(raw.Machine, mapToMachine(raw));
      setMachines(Array.from(machineMap.current.values()));

      // Feeds surface anything the gateway alarmed on OR anything NexOps caught
      // early (gateway still calm but NexOps risk elevated) - otherwise the
      // headline "caught it early" records (Status Normal) would never reach the
      // buzz/alarm/task feeds.
      const early = isEarlyWarning(raw);
      // NUISANCE = filterable noise. We DO carry it into the alarm/control feeds
      // (so the UI can show it greyed + "nuisance - filtered"), but we NEVER
      // create a task for it (don't dispatch an engineer to noise) and it never
      // triggers the site alert.
      const nuisance = raw.is_nuisance === true;

      if (raw.Status !== 'Normal' || early || nuisance) {
        // alarms: rolling list, most recent first (~10)
        setAlarms((prev) => [mapToAlarm(raw), ...prev].slice(0, 10));
        // controlAlarms: compact rolling list for the landing control panel (~3)
        setControlAlarms((prev) => [mapToControlPanelAlarm(raw), ...prev].slice(0, 3));
      }

      if (!nuisance && (raw.Status !== 'Normal' || early)) {
        // tasks: one active task per affected REAL fault (small, stable list)
        taskMap.current.set(raw.Machine, mapToTask(raw));
        setTasks(Array.from(taskMap.current.values()).slice(-5));
      } else if (!nuisance && raw.Status === 'Normal' && !early && taskMap.current.has(raw.Machine)) {
        // machine returned to normal -> retire its active task (a nuisance
        // reading must not retire a real, ongoing task)
        taskMap.current.delete(raw.Machine);
        setTasks(Array.from(taskMap.current.values()).slice(-5));
      }

      // SITE-WIDE RED ZONE: a real (non-nuisance) site emergency latches the
      // banner and (re)arms a ~30s persistence timer; when no site_alert record
      // arrives for that window, the banner clears on its own.
      if (raw.site_alert === true && !nuisance) {
        setSiteAlert(mapToSiteAlert(raw));
        if (siteAlertTimer.current) clearTimeout(siteAlertTimer.current);
        siteAlertTimer.current = setTimeout(() => {
          setSiteAlert(null);
          siteAlertTimer.current = null;
        }, SITE_ALERT_PERSIST_MS);
      }

      // ---- LIVE METRICS (additive, fail-safe) ----------------------------
      // Fold this frame into the session metrics, then publish a snapshot.
      // Wrapped so a malformed frame can never break the feed or the panel.
      try {
        accumulateMetrics(raw, metricsAcc.current, faultLC.current, Date.now());
        setMetrics(buildMetricsSnapshot(metricsAcc.current, faultLC.current));
      } catch (err) {
        console.error('[useLiveData] metrics accumulation skipped:', err);
      }
    }, setConnected);

    return () => {
      unsubscribe();
      if (siteAlertTimer.current) {
        clearTimeout(siteAlertTimer.current);
        siteAlertTimer.current = null;
      }
    };
  }, []);

  return { machines, alarms, tasks, connected, controlAlarms, siteAlert, metrics };
}
