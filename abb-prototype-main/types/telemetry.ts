// Single source of truth for data shapes in the app.
//
// Two families of types live here:
//   1. The LIVE telemetry contract (TelemetryRecord) - the EXACT shape our
//      data source emits. The local mock and (later) the WebSocket feed both
//      produce this shape. Components NEVER see this shape directly.
//   2. The UI-facing types the components actually render. lib/adapter.ts is
//      the only place that converts (1) -> (2).

// ----------------------------------------------------------------------
// LIVE telemetry contract (exact emitted shape)
// ----------------------------------------------------------------------

export type Status = 'Normal' | 'Warning' | 'Critical';
export type AlarmType = 'Process' | 'Predictive' | 'Safety' | 'Electrical' | 'System';
export type AlarmPriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type AlarmState = 'ACT' | 'ACK' | 'RTN';
export type AckState = 'Unacknowledged' | 'Acknowledged';

// NexOps anomaly layer (added upstream by the backend bridge).
export type NexopsRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AnomalyStatus = 'warming_up' | 'scored' | 'error';

export interface TelemetryRecord {
  Machine: string;
  Timestamp: string; // "YYYY-MM-DD HH:MM:SS"
  Temp: number | null;
  Pressure: number | null;
  Level: number | null;
  Flow: number | null;
  Status: Status;
  Alert: string;
  features: { [key: string]: number };
  alarm_id: number;
  alarm_type: AlarmType;
  alarm_priority: AlarmPriority;
  priority_level: number;
  alarm_state: AlarmState;
  ack_state: AckState;
  is_predictive: boolean;
  object_name: string; // ABB tag, e.g. "TIC-HEX01"
  object_description: string;
  message: string;

  // --- NexOps anomaly layer (added by the backend, independent of gateway) ---
  anomaly_score: number | null; // 0..1, higher = more anomalous; null while warming up
  anomaly_status: AnomalyStatus; // 'warming_up' | 'scored' | 'error'
  nexops_risk: NexopsRisk; // NexOps's own risk verdict
  nexops_reasoning: string; // short human explanation of the verdict
}

// ----------------------------------------------------------------------
// UI-facing types (the contract the components render)
// ----------------------------------------------------------------------

export interface Machine {
  name: string;
  perf: number;
  zone: string;
  // NexOps intelligence surfaced into the UI:
  nexopsRisk: NexopsRisk;
  anomalyScore: number | null;
  isEarly: boolean; // gateway calm (Normal/Low) but NexOps risk elevated
  reasoning: string;
}

export interface Task {
  id: string;
  title: string;
  machine: string;
  tech: string;
  priority: 'CRITICAL' | 'WARNING' | 'NORMAL';
}

export interface Alarm {
  time: string;
  msg: string;
  type: 'CRITICAL' | 'WARNING';
  // NexOps view carried through so feeds can show the EARLY tag + reasoning.
  nexopsRisk: NexopsRisk;
  anomalyScore: number | null;
  isEarly: boolean;
  reasoning: string;
}

export interface ControlPanelAlarm {
  dot: string;
  code: string;
  text: string;
  isEarly: boolean;
  reasoning: string;
}
