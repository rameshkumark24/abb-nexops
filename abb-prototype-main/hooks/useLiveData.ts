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
} from '@/types/telemetry';
import {
  mapToMachine,
  mapToAlarm,
  mapToTask,
  mapToControlPanelAlarm,
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

export function useLiveData() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [controlAlarms, setControlAlarms] = useState<ControlPanelAlarm[]>([]);
  const [connected, setConnected] = useState(false);

  // Keyed by machine name so each grid/task entry reflects the machine's
  // latest state instead of growing without bound.
  const machineMap = useRef<Map<string, Machine>>(new Map());
  const taskMap = useRef<Map<string, Task>>(new Map());

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

      if (raw.Status !== 'Normal' || early) {
        // alarms: rolling list, most recent first (~10)
        setAlarms((prev) => [mapToAlarm(raw), ...prev].slice(0, 10));
        // controlAlarms: compact rolling list for the landing control panel (~3)
        setControlAlarms((prev) => [mapToControlPanelAlarm(raw), ...prev].slice(0, 3));
        // tasks: one active task per affected machine (small, stable list)
        taskMap.current.set(raw.Machine, mapToTask(raw));
        setTasks(Array.from(taskMap.current.values()).slice(-5));
      } else if (taskMap.current.has(raw.Machine)) {
        // machine returned to normal -> retire its active task
        taskMap.current.delete(raw.Machine);
        setTasks(Array.from(taskMap.current.values()).slice(-5));
      }
    }, setConnected);

    return () => {
      unsubscribe();
    };
  }, []);

  return { machines, alarms, tasks, connected, controlAlarms };
}
