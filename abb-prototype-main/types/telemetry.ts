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

// NexOps assignment + emergency layer (added upstream by the backend bridge).
export type EmergencyType = 'fire' | 'gas_leak' | 'emergency_stop' | null;
export type NuisanceType = 'chatter' | 'transient' | null;

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

  // --- NexOps assignment + site-emergency layer (added by the backend) ---
  assigned_engineer: string; // "Unassigned" if none
  assigned_engineer_id: number | null;
  assignment_reason: string | null; // why this engineer was chosen
  fault_category: string | null; // e.g. "mechanical" | "electrical" | "thermal"
  site_alert: boolean; // true = site-wide emergency (fire/gas/emergency)
  alert_scope: 'site' | 'normal';
  emergency_type: EmergencyType; // 'fire' | 'gas_leak' | 'emergency_stop' | null
  is_nuisance: boolean; // true = filterable noise, not a real fault
  nuisance_type: NuisanceType; // 'chatter' | 'transient' | null
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
  // Real auto-assignment for the active fault (or "Unassigned").
  assignedEngineer: string;
  faultCategory: string | null;
}

export interface Task {
  id: string;
  title: string;
  machine: string;
  tech: string; // defaults to the REAL auto-assigned engineer
  priority: 'CRITICAL' | 'WARNING' | 'NORMAL';
  // Real auto-assignment surfaced into the queue:
  assignedEngineer: string;
  assignmentReason: string | null; // why this engineer was chosen
  faultCategory: string | null;
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
  // Emergency + nuisance segregation:
  siteAlert: boolean;
  emergencyType: EmergencyType;
  isNuisance: boolean; // true = filterable noise, render de-emphasized
}

export interface ControlPanelAlarm {
  dot: string;
  code: string;
  text: string;
  isEarly: boolean;
  reasoning: string;
  siteAlert: boolean;
  emergencyType: EmergencyType;
  isNuisance: boolean;
}

// The active site-wide emergency the banner renders (or null when clear).
export interface SiteAlert {
  machine: string;
  emergencyType: EmergencyType;
  engineer: string; // dispatched engineer, or "Unassigned"
  time: string;
  label: string; // human label, e.g. "FIRE DETECTED"
}

// ----------------------------------------------------------------------
// Task lifecycle (HTTP) - the shapes the backend task endpoints return
// (GET /tasks, POST /tasks/{id}/start, POST /tasks/{id}/resolve). These are
// SEPARATE from the WebSocket TelemetryRecord stream: the technician console
// drives them via lib/tasksApi.ts + hooks/useTasks.ts, while useLiveData keeps
// handling the live telemetry feed untouched.
// ----------------------------------------------------------------------

export type TaskStatus = 'assigned' | 'in_progress' | 'resolved';

// One persisted assignment as returned by the backend (db.Assignment summary).
export interface LifecycleTask {
  id: number;
  alarm_id: number | null;
  machine: string | null;
  fault_category: string | null;
  engineer_id: number | null;
  engineer_name: string | null;
  status: TaskStatus;
  score: number | null;
  assigned_at: string | null; // ISO
  started_at: string | null; // ISO, set on -> in_progress
  resolved_at: string | null; // ISO, set on -> resolved
  resolution_minutes: number | null; // computed on resolve
}

// The /resolve endpoint returns the task summary PLUS the engineer's freed
// capacity (new active_tasks) and whether the dedupe entry was cleared.
export interface ResolvedTask extends LifecycleTask {
  engineer_active_tasks: number | null;
  dedupe_cleared?: boolean;
}
