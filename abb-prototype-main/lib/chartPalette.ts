// Chart colour palette — concrete hex values for recharts SVG fills/strokes.
//
// These mirror the ABB ISA-101 design tokens in globals.css (so charts stay
// visually consistent with the rest of the HMI) and the spec's per-series
// colour intent. RED (--abb-alarm #c1121f) stays reserved for critical/alarm
// and safety (a genuinely critical category) only — categorical fault colours
// otherwise use blue/violet/cyan/teal/amber, never red.

// Semantic state tokens (resolved to hex for recharts).
export const STATE = {
  nominal: '#6c7480', // grey — LOW / nominal
  warning: '#b07313', // amber/ochre — WARNING / MEDIUM
  high: '#c04a1b', // deep orange — HIGH
  early: '#4338ca', // indigo — EARLY / predictive
  critical: '#c1121f', // red — CRITICAL / alarm ONLY
} as const;

export const GRID_LINE = 'var(--abb-line-faint)';
export const AXIS_TEXT = 'var(--abb-ink-3)';
export const SURFACE = 'var(--abb-surface-1)';
export const INK0 = 'var(--abb-ink-0)';

// Fault-type categorical palette (1C donut + breakdown bars). Keys are the
// backend `fault_category` values (lower-cased); unknown types fall back to grey.
export const FAULT_COLORS: Record<string, string> = {
  thermal: '#b07313', // amber
  mechanical: '#2563eb', // blue-600
  electrical: '#7c3aed', // violet-500/600
  general: '#8b94a3', // grey
  pressure: '#0891b2', // cyan
  flow: '#0d9488', // teal
  hydraulic: '#0e7490', // deep cyan (backend also emits 'hydraulic')
  process: '#1d4ed8', // blue
  safety: '#c1121f', // red — safety is a critical category
};

export function faultColor(type: string): string {
  return FAULT_COLORS[type.toLowerCase()] ?? STATE.nominal;
}

// Anomaly-score colour scale (Section 2B/2D): grey < 0.3, amber 0.3–0.6, red > 0.6.
export function anomalyColor(a: number | null | undefined): string {
  if (a == null) return STATE.nominal;
  if (a > 0.6) return STATE.critical;
  if (a >= 0.3) return STATE.warning;
  return STATE.nominal;
}

// Capacity donut slices (Section 2C): available nominal-grey, at-capacity amber.
// Amber (not red) because "at-capacity" is a resource state, not a safety alarm.
export const CAPACITY_AVAILABLE = '#6c7480'; // matches STATE.nominal
export const CAPACITY_ATCAP = '#b07313';     // matches STATE.warning

// EEMUA 191 long-term target: <= 1 alarm per 10 minutes per operator => 6/hr.
export const EEMUA_PER_HOUR = 6;

// Shared recharts tooltip style so every chart's tooltip matches the HMI.
export const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--abb-surface-1)',
  border: '1px solid var(--abb-line)',
  borderRadius: 4,
  fontFamily: 'var(--abb-font-data)',
  fontSize: 11,
  color: 'var(--abb-ink-0)',
  boxShadow: 'var(--abb-shadow-1)',
};
