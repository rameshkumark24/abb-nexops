// Plant-dashboard layout config + persistence (Section 1A).
//
// The draggable widget ORDER and per-widget COLLAPSED state survive refresh via
// localStorage under "nexops_admin_layout_v2". The KPI bar and the sticky
// filter bar are NOT part of this — they are locked above the sortable grid.
//
// Layout v2: widgets grouped into operational tiers (Zone → Machine → Alarm →
// Priority → Spatial → Prediction → Workforce). Low-value analytical extras
// (riskLevel, zonePerf, anomalyTrend, leadTime) are collapsed by default but
// remain draggable and expandable.

export const ADMIN_LAYOUT_KEY = 'nexops_admin_layout_v2';

// Every draggable widget on /admin, with its default desktop column span.
// `fullWidth` widgets stay span-12 on tablet; the rest collapse to span-6.
// `sectionLabel` triggers a full-width divider row above the widget.
export interface WidgetDef {
  id: string;
  title: string;
  subtitle?: string;
  span: number;
  fullWidth?: boolean;
  sectionLabel?: string;
}

export const ADMIN_WIDGETS: WidgetDef[] = [
  // ── TIER 1: ZONE OVERVIEW ────────────────────────────────────────────────
  { id: 'zoneRollup',        title: 'ZONE ROLLUP · A / B / C / D',                                                              span: 12, fullWidth: true, sectionLabel: 'ZONE OVERVIEW' },

  // ── TIER 2: MACHINE HEALTH ───────────────────────────────────────────────
  { id: 'machineAnalytics',  title: 'LIVE MACHINE ANALYTICS · ALL ZONES',                                                        span: 8,               sectionLabel: 'MACHINE HEALTH' },
  { id: 'faultDonut',        title: 'FAULT TYPE BREAKDOWN',        subtitle: 'Active alarm root signals · live',                 span: 4 },

  // ── TIER 3: ALARM ANALYSIS ───────────────────────────────────────────────
  { id: 'alarmsPerHour',     title: 'ALARMS PER HOUR · 24H TREND', subtitle: 'Raw gateway alarms vs NexOps dispatched actions', span: 6,               sectionLabel: 'ALARM ANALYSIS' },
  { id: 'alarmPipeline',     title: 'ALARM PIPELINE · 10 MIN WINDOW',                                                           span: 6 },

  // ── TIER 4: PRIORITY & TEAM PERFORMANCE ─────────────────────────────────
  { id: 'topMachines',       title: 'TOP 5 PROBLEM MACHINES · LIVE', subtitle: 'Ranked by current live anomaly score', span: 6,              sectionLabel: 'PRIORITY & TEAM PERFORMANCE' },
  { id: 'earlyCatches',      title: 'TOP 5 EARLY CATCHES · LIVE', subtitle: 'Highest-priority predictive anomalies', span: 6 },
  { id: 'leaderboard',       title: 'ENGINEER LEADERBOARD · 24H',   subtitle: 'Points based on performance across all zones',    span: 12 },

  // ── TIER 5: SPATIAL INTELLIGENCE ────────────────────────────────────────
  { id: 'heatmap',           title: 'ZONE ALARM HEATMAP · LAST 24H', subtitle: 'Alarm density by zone and hour — find bad shifts instantly', span: 12, fullWidth: true, sectionLabel: 'SPATIAL INTELLIGENCE' },

  // ── TIER 6: NEXOPS PREDICTION ROI ───────────────────────────────────────
  { id: 'predictionMetrics', title: 'PREDICTION & SEGREGATION — LIVE METRICS',                                                  span: 12, fullWidth: true, sectionLabel: 'NEXOPS PREDICTION ROI' },

  // ── TIER 7: WORKFORCE (collapsed by default) ─────────────────────────────
  { id: 'workforce',         title: 'WORKFORCE · ENGINEERS & TECHNICIANS',                                                       span: 12, fullWidth: true, sectionLabel: 'WORKFORCE' },

  // ── ANALYTICAL EXTRAS (collapsed by default) ─────────────────────────────
  { id: 'riskLevel',         title: 'RISK LEVEL DISTRIBUTION',                                                                   span: 4,               sectionLabel: 'ANALYTICAL EXTRAS' },
  { id: 'zonePerf',          title: 'ZONE PERFORMANCE COMPARISON',                                                               span: 8 },
  { id: 'anomalyTrend',      title: 'SITE-WIDE ANOMALY TREND',                                                                   span: 4 },
  { id: 'leadTime',          title: 'LEAD TIME DISTRIBUTION',                                                                    span: 6 },
];

export const DEFAULT_ORDER: string[] = ADMIN_WIDGETS.map((w) => w.id);

export interface AdminLayout {
  order: string[];
  collapsed: Record<string, boolean>;
}

export function defaultLayout(): AdminLayout {
  return {
    order: [...DEFAULT_ORDER],
    collapsed: {
      workforce: true,
      riskLevel: true,
      zonePerf: true,
      anomalyTrend: true,
      leadTime: true,
    },
  };
}

export function loadLayout(): AdminLayout {
  if (typeof window === 'undefined') return defaultLayout();
  try {
    const raw = window.localStorage.getItem(ADMIN_LAYOUT_KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as Partial<AdminLayout>;
    const known = new Set(DEFAULT_ORDER);
    // Keep only known ids, then append any new widgets added since the layout
    // was saved (so a code update never hides a widget).
    const saved = (parsed.order ?? []).filter((id) => known.has(id));
    const missing = DEFAULT_ORDER.filter((id) => !saved.includes(id));
    return {
      order: [...saved, ...missing],
      collapsed: {
        ...defaultLayout().collapsed,
        ...(parsed.collapsed ?? {}),
      },
    };
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: AdminLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ADMIN_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* storage full / disabled — layout simply won't persist */
  }
}
