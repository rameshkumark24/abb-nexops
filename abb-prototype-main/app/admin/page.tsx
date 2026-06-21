'use client';

import { NavBar, Dot, Panel, Badge, MicroLabel, RISK_TOKEN, STATE_TOKEN, type BadgeVariant } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import { useLiveData } from '@/hooks/useLiveData';
import { useAlarmHistory } from '@/hooks/useAlarmHistory';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getEngineers,
  createEngineer,
  deactivateEngineer,
  activateEngineer,
  deleteEngineer,
  fetchTasks,
  type Engineer,
} from '@/lib/tasksApi';
import { Field, Button } from '@/components/Shared';
import type { Machine, LifecycleTask } from '@/types/telemetry';
import { DashboardCard } from '@/components/DashboardCard';
import { DashboardSearch } from '@/components/DashboardSearch';
import { FilterBar, DEFAULT_FILTERS, resolveWindow, type AdminFilters, type SeverityFilter } from '@/components/FilterBar';
import { HeatmapGrid } from '@/components/HeatmapGrid';
import { LeaderboardTable } from '@/components/LeaderboardTable';
import { FaultDonut } from '@/components/charts/FaultDonut';
import { AlarmsPerHourChart, type HourBin } from '@/components/charts/AlarmsPerHourChart';
import { TopMachinesChart } from '@/components/charts/TopMachinesChart';
import { ADMIN_WIDGETS, defaultLayout, loadLayout, saveLayout, type AdminLayout, type WidgetDef } from '@/lib/adminLayout';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  KeyboardSensor,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';

const ZONES = ['Zone A', 'Zone B', 'Zone C', 'Zone D'] as const;

const fmtLead = (totalSeconds: number): string => {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const RISK_BADGE: Record<string, BadgeVariant> = {
  LOW: 'nominal',
  MEDIUM: 'warning',
  HIGH: 'high',
  CRITICAL: 'alarm',
};

const RISK_RANK: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

function accentFor(m: Machine): string {
  if (m.nexopsRisk === 'CRITICAL') return STATE_TOKEN.critical;
  if (m.isEarly) return STATE_TOKEN.early;
  return RISK_TOKEN[m.nexopsRisk] ?? STATE_TOKEN.nominal;
}

function machineSeverity(m: Machine): SeverityFilter {
  if (m.nexopsRisk === 'CRITICAL') return 'CRITICAL';
  if (m.isEarly) return 'EARLY';
  if (m.perf < 80) return 'WARNING';
  return 'NOMINAL';
}

const WIDGET_BY_ID: Record<string, WidgetDef> = Object.fromEntries(ADMIN_WIDGETS.map((w) => [w.id, w]));
const pad2 = (n: number) => String(n).padStart(2, '0');

function AdminConsole() {
  const { machines, siteAlert, metrics } = useLiveData();
  const { logout } = useAuth();
  const events = useAlarmHistory(machines);
  const isMobile = useIsMobile();

  // ---- Global filters (drive every widget) --------------------------------
  const [filters, setFilters] = useState<AdminFilters>(DEFAULT_FILTERS);

  // ---- Draggable layout (persisted to localStorage) -----------------------
  const [layout, setLayout] = useState<AdminLayout>(() => defaultLayout());
  useEffect(() => {
    setLayout(loadLayout()); // hydrate from storage after mount (SSR-safe)
  }, []);
  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setLayout((l) => {
      const oldI = l.order.indexOf(String(active.id));
      const newI = l.order.indexOf(String(over.id));
      if (oldI < 0 || newI < 0) return l;
      return { ...l, order: arrayMove(l.order, oldI, newI) };
    });
  };

  // Group widgets into sections dynamically based on their `sectionLabel` in ADMIN_WIDGETS
  const widgetSections = useMemo(() => {
    const list: { label: string; widgetIds: string[] }[] = [];
    let currentSection: { label: string; widgetIds: string[] } | null = null;
    for (const w of ADMIN_WIDGETS) {
      if (w.sectionLabel) {
        currentSection = { label: w.sectionLabel, widgetIds: [] };
        list.push(currentSection);
      }
      if (currentSection) {
        currentSection.widgetIds.push(w.id);
      }
    }
    return list;
  }, []);

  // Sort each section's widgets according to their position in layout.order
  const sectionWidgets = useMemo(() => {
    return widgetSections.map((sec) => {
      const sortedIds = [...sec.widgetIds].sort((a, b) => {
        return layout.order.indexOf(a) - layout.order.indexOf(b);
      });
      return { ...sec, widgetIds: sortedIds };
    });
  }, [layout.order, widgetSections]);
  const toggleCollapse = (id: string) =>
    setLayout((l) => ({ ...l, collapsed: { ...l.collapsed, [id]: !l.collapsed[id] } }));
  const resetLayout = () => setLayout(defaultLayout());

  // ---- Search palette ------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Ctrl+K / Cmd+K opens search from anywhere on the page.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const navigateToWidget = useCallback((id: string) => {
    // Expand the widget if it was collapsed so the content is visible.
    // Do NOT call saveLayout here — the useEffect([layout]) watcher handles persistence.
    setLayout((prev) => {
      if (!prev.collapsed[id]) return prev;
      return { ...prev, collapsed: { ...prev.collapsed, [id]: false } };
    });
    // Scroll + highlight after the DOM updates from the expand.
    setTimeout(() => {
      document.getElementById(`widget-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setHighlightId(id);
      setTimeout(() => setHighlightId(null), 2700);
    }, 120);
  }, []);

  // ---- Workforce roster ----------------------------------------------------
  const [engineers, setEngineers] = useState<Engineer[] | null>(null);
  const [wfLoading, setWfLoading] = useState(false);
  const [leaderboardTasks, setLeaderboardTasks] = useState<LifecycleTask[]>([]);

  const fetchEngineers = async () => {
    setWfLoading(true);
    const res = await getEngineers();
    if (res.ok) setEngineers(res.data);
    else setEngineers([]);
    setWfLoading(false);
  };

  useEffect(() => {
    fetchEngineers();
    // Resolved-task history powers the leaderboard (real data, existing endpoint).
    fetchTasks(true).then((res) => {
      if (res.ok) setLeaderboardTasks(res.data);
    });
    const id = setInterval(() => {
      fetchTasks(true).then((res) => {
        if (res.ok) setLeaderboardTasks(res.data);
      });
    }, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Site-wide anomaly trend history ------------------------------------
  const [anomalyHistory, setAnomalyHistory] = useState<number[]>(Array(24).fill(0.12));
  useEffect(() => {
    if (machines.length === 0) return;
    const total = machines.reduce((acc, m) => acc + (m.anomalyScore ?? 0), 0);
    setAnomalyHistory((prev) => [...prev.slice(1), total / machines.length]);
  }, [machines]);

  const toggleActive = async (id: number, currentlyActive: boolean) => {
    setWfLoading(true);
    const res = currentlyActive ? await deactivateEngineer(id) : await activateEngineer(id);
    if (res.ok) await fetchEngineers();
    else console.warn('workforce toggle failed', res.error);
    setWfLoading(false);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Permanently remove "${name}" from the system?\n\nThis will delete all their data and assignment history. This action cannot be undone.\n\nUse DEACTIVATE instead if the absence is temporary.`)) return;
    setWfLoading(true);
    const res = await deleteEngineer(id);
    if (res.ok) await fetchEngineers();
    else console.warn('workforce delete failed', res.error);
    setWfLoading(false);
  };

  // ---- Highlight-on-click (Top 5 → Live Machine Analytics) -----------------
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusMachine = (name: string) => {
    setHighlight(name);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 3000);
    requestAnimationFrame(() => {
      document.getElementById(`adm-machine-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  // Per-machine perf history (sparkline) and previous-tick snapshot (trend arrow).
  const perfHistRef = useRef<Map<string, number[]>>(new Map());
  const prevPerfRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    for (const m of machines) {
      const hist = perfHistRef.current.get(m.name) ?? [];
      if (hist.length === 0 || hist[hist.length - 1] !== m.perf) {
        perfHistRef.current.set(m.name, [...hist, m.perf].slice(-12));
      }
      prevPerfRef.current.set(m.name, m.perf);
    }
  }, [machines]);

  // ======================================================================
  // DERIVED DATA — everything below reacts to `filters`
  // ======================================================================
  const zonesSel = filters.zones;
  const sevSel = filters.severities;
  const filteredEvents = useMemo(
    () => {
      const { from: activeFrom, to: activeTo } = resolveWindow(filters);
      console.log("[DEBUG HEATMAP] events count:", events.length);
      if (events.length > 0) {
        console.log("[DEBUG HEATMAP] sample event:", events[0]);
        console.log("[DEBUG HEATMAP] from:", activeFrom, "to:", activeTo, "now:", Date.now());
        console.log("[DEBUG HEATMAP] zonesSel:", zonesSel, "sevSel:", sevSel);
      }
      return events.filter(
        (e) => {
          const zClean = e.zone.replace('Zone ', '').trim();
          const matchTime = e.ts >= activeFrom && (filters.range === 'custom' ? e.ts <= activeTo : true);
          const matchZone = zonesSel.includes(zClean);
          const matchSev = sevSel.includes(e.severity);
          return matchTime && matchZone && matchSev;
        },
      );
    },
    [events, filters, zonesSel, sevSel],
  );

  // Per-machine alarm counts within the window (drives Top 5 + 'alarms' sort).
  const machineCounts = useMemo(() => {
    const m = new Map<string, { name: string; zone: string; count: number }>();
    for (const e of filteredEvents) {
      const cur = m.get(e.machine) ?? { name: e.machine, zone: e.zone, count: 0 };
      cur.count += 1;
      m.set(e.machine, cur);
    }
    return m;
  }, [filteredEvents]);

  const topMachines = useMemo(() => {
    // Rank all machines by their current problem status.
    const sorted = [...machines].sort((a, b) => {
      const riskRank: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
      const rA = riskRank[a.nexopsRisk] ?? 0;
      const rB = riskRank[b.nexopsRisk] ?? 0;
      if (rB !== rA) return rB - rA;

      const scoreA = a.anomalyScore ?? 0;
      const scoreB = b.anomalyScore ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;

      return a.perf - b.perf; // lower performance = more problematic
    });

    return sorted.slice(0, 5).map((m) => ({
      name: m.name,
      zone: m.zone,
      count: Math.round((m.anomalyScore ?? 0) * 100),
    }));
  }, [machines]);

  const topEarlyCatches = useMemo(() => {
    // Rank early catches by their current problem status.
    const sorted = machines.filter((m) => m.isEarly).sort((a, b) => {
      const riskRank: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
      const rA = riskRank[a.nexopsRisk] ?? 0;
      const rB = riskRank[b.nexopsRisk] ?? 0;
      if (rB !== rA) return rB - rA;

      const scoreA = a.anomalyScore ?? 0;
      const scoreB = b.anomalyScore ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;

      return a.perf - b.perf; // lower performance = more problematic
    });

    return sorted.slice(0, 5).map((m) => ({
      name: m.name,
      zone: m.zone,
      count: Math.round((m.anomalyScore ?? 0) * 100),
    }));
  }, [machines]);

  // Filtered + sorted machine list (zone + severity from the global filter).
  const filteredMachines = useMemo(
    () =>
      machines.filter(
        (m) => zonesSel.includes(m.zone.replace('Zone ', '').trim()) && sevSel.includes(machineSeverity(m)),
      ),
    [machines, zonesSel, sevSel],
  );

  const sortedMachines = useMemo(() => {
    const arr = [...filteredMachines];
    switch (filters.sort) {
      case 'alarms':
        return arr.sort((a, b) => (machineCounts.get(b.name)?.count ?? 0) - (machineCounts.get(a.name)?.count ?? 0));
      case 'perf':
        return arr.sort((a, b) => a.perf - b.perf);
      case 'zone':
        return arr.sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name));
      case 'risk':
      default:
        return arr.sort((a, b) => (RISK_RANK[b.nexopsRisk] ?? 0) - (RISK_RANK[a.nexopsRisk] ?? 0) || a.perf - b.perf);
    }
  }, [filteredMachines, filters.sort, machineCounts]);

  // KPI headline (reflects the zone/severity filter).
  const kTotal = filteredMachines.length;
  const kCrit = filteredMachines.filter((m) => m.nexopsRisk === 'CRITICAL').length;
  const kEarly = filteredMachines.filter((m) => m.isEarly).length;
  const kAlarms = filteredMachines.filter((m) => m.perf < 80).length;
  const kAvgPerf = kTotal ? Math.round(filteredMachines.reduce((a, m) => a + m.perf, 0) / kTotal) : null;
  const kDispatched = new Set(
    filteredMachines.filter((m) => m.assignedEngineer && m.assignedEngineer !== 'Unassigned').map((m) => m.assignedEngineer),
  ).size;
  const stat = (v: number | null, unit = '') => (v == null ? '—' : `${v}${unit}`);
  const STRIP = [
    { value: stat(kTotal), label: 'MACHINES LIVE' },
    { value: stat(kAvgPerf, '%'), label: 'AVG PERFORMANCE' },
    { value: stat(kAlarms), label: 'ACTIVE ALARMS', tone: kAlarms > 0 ? STATE_TOKEN.warning : undefined },
    { value: stat(kCrit), label: 'CRITICAL', tone: kCrit > 0 ? STATE_TOKEN.critical : undefined },
    { value: stat(kEarly), label: 'EARLY CATCHES', tone: kEarly > 0 ? STATE_TOKEN.early : undefined },
    { value: stat(kDispatched), label: 'ENGINEERS DISPATCHED' },
  ];

  // Zone rollup (unfiltered by severity).
  const zoneRollup = ZONES.filter((z) => zonesSel.includes(z.replace('Zone ', ''))).map((z) => {
    const inZone = machines.filter((m) => m.zone === z);
    const sorted = [...inZone].sort((a, b) => a.perf - b.perf);
    return {
      zone: z,
      label: z.toUpperCase(),
      count: inZone.length,
      criticals: inZone.filter((m) => m.nexopsRisk === 'CRITICAL').length,
      alarms: inZone.filter((m) => m.perf < 80).length,
      early: inZone.filter((m) => m.isEarly).length,
      avgPerf: inZone.length ? Math.round(inZone.reduce((a, m) => a + m.perf, 0) / inZone.length) : 0,
      worst: sorted[0] ?? null,
      best: sorted[sorted.length - 1] ?? null,
    };
  });

  // Risk distribution (filtered).
  const riskDist = {
    LOW: filteredMachines.filter((m) => m.nexopsRisk === 'LOW').length,
    MEDIUM: filteredMachines.filter((m) => m.nexopsRisk === 'MEDIUM').length,
    HIGH: filteredMachines.filter((m) => m.nexopsRisk === 'HIGH').length,
    CRITICAL: filteredMachines.filter((m) => m.nexopsRisk === 'CRITICAL').length,
  };
  const riskTotal = riskDist.LOW + riskDist.MEDIUM + riskDist.HIGH + riskDist.CRITICAL || 1;

  // Fault breakdown (current active machines, by fault category).
  const faultData = useMemo(() => {
    const m = new Map<string, number>();
    filteredMachines
      .filter((mm) => mm.perf < 80 || mm.nexopsRisk === 'CRITICAL' || mm.isEarly)
      .forEach((mm) => {
        const f = (mm.faultCategory && mm.faultCategory.trim().toLowerCase()) || 'general';
        m.set(f, (m.get(f) ?? 0) + 1);
      });
    return [...m.entries()].map(([type, count]) => ({ type, count }));
  }, [filteredMachines]);

  // Hourly alarm bins (24h trend).
  const hourBins: HourBin[] = useMemo(() => {
    const bins: HourBin[] = Array.from({ length: 24 }, (_, h) => ({ label: `${pad2(h)}:00`, raw: 0, dispatched: 0 }));
    for (const e of filteredEvents) {
      const h = new Date(e.ts).getHours();
      bins[h].raw += 1;
      if (e.dispatched) bins[h].dispatched += 1;
    }
    return bins;
  }, [filteredEvents]);

  // ======================================================================
  // WIDGET BODIES
  // ======================================================================
  function renderWidget(id: string): React.ReactNode {
    switch (id) {
      case 'zoneRollup':
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {zoneRollup.length === 0 && <EmptyNote>NO ZONES SELECTED</EmptyNote>}
            {zoneRollup.map((z) => (
              <div key={z.zone} style={{ border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14, background: 'var(--abb-surface-1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span className="abb-data" style={{ fontSize: 15, fontWeight: 700, color: 'var(--abb-ink-0)', letterSpacing: '0.04em' }}>{z.label}</span>
                  <span className="abb-data" style={{ fontSize: 13, color: 'var(--abb-ink-2)' }}>{z.count} <span style={{ color: 'var(--abb-ink-3)', fontSize: 11 }}>MACHINES</span></span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, minHeight: 18 }}>
                  {z.criticals > 0 && <Badge variant="alarm">{z.criticals} CRIT</Badge>}
                  {z.alarms > 0 && <Badge variant="warning">{z.alarms} ALARM</Badge>}
                  {z.early > 0 && <Badge variant="early">{z.early} EARLY</Badge>}
                  {z.criticals === 0 && z.alarms === 0 && z.early === 0 && z.count > 0 && <Badge variant="nominal">NOMINAL</Badge>}
                  {z.count === 0 && <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>AWAITING…</span>}
                </div>
                {z.worst && (
                  <div className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-2)', lineHeight: 1.7 }}>
                    <div>WORST <span style={{ color: accentFor(z.worst), fontWeight: 600 }}>{z.worst.name} {z.worst.perf}%</span></div>
                    {z.best && z.best !== z.worst && <div style={{ color: 'var(--abb-ink-3)' }}>BEST {z.best.name} {z.best.perf}%</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        );

      case 'machineAnalytics':
        return kTotal === 0 ? (
          <EmptyNote>{machines.length === 0 ? 'AWAITING LIVE STREAM…' : 'NO MACHINES MATCH FILTERS'}</EmptyNote>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto', paddingRight: 6 }}>
            {sortedMachines.map((m, i) => {
              const accent = accentFor(m);
              const isCrit = m.nexopsRisk === 'CRITICAL';
              const isHi = highlight === m.name;

              // Trend: compare current perf with the value stored by the last effect run.
              const prevPerf = prevPerfRef.current.get(m.name);
              const delta = prevPerf != null ? m.perf - prevPerf : null;
              const trendDown = delta != null && delta < -0.5;
              const trendUp = delta != null && delta > 0.5;
              const trendIcon = trendDown ? '▼' : trendUp ? '▲' : delta != null ? '→' : '';
              const trendColor = trendDown ? 'var(--abb-alarm)' : trendUp ? '#15803d' : 'var(--abb-ink-3)';

              // Sparkline history.
              const history = perfHistRef.current.get(m.name) ?? [];

              // Risk horizon — derived from live anomaly score + nexopsRisk.
              let horizon: string | null = null;
              if (isCrit) horizon = 'Immediate';
              else if (m.anomalyScore != null) {
                if (m.anomalyScore >= 0.75) horizon = '< 4h';
                else if (m.anomalyScore >= 0.55) horizon = '6–24h';
                else if (m.anomalyScore >= 0.35) horizon = '1–3d';
              }

              return (
                <div
                  key={`${m.name}-${i}`}
                  id={`adm-machine-${m.name}`}
                  className={isHi ? 'admin-highlight' : ''}
                  style={{
                    background: isCrit ? 'var(--abb-alarm-soft)' : 'var(--abb-surface-1)',
                    border: `1px solid ${isCrit ? 'var(--abb-alarm-line)' : 'var(--abb-line-faint)'}`,
                    borderLeft: `4px solid ${accent}`,
                    borderRadius: 'var(--abb-radius-sm)',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* ── Row 1: identity · risk badge · perf% · trend ── */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Dot color={accent} size={9} cls={isCrit ? 'pulse-fast' : m.isEarly ? 'pulse' : ''} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="abb-data" style={{ fontSize: 15, color: 'var(--abb-ink-0)', fontWeight: 700 }}>{m.name}</span>
                      <span className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em', marginLeft: 10 }}>{m.zone.toUpperCase()}</span>
                      {m.isEarly && <span style={{ marginLeft: 8 }}><Badge variant="early" title={m.reasoning}>⚠ EARLY</Badge></span>}
                    </div>
                    <Badge variant={RISK_BADGE[m.nexopsRisk] ?? 'nominal'} title={m.reasoning}>NEXOPS {m.nexopsRisk}</Badge>
                    <div style={{ textAlign: 'right', minWidth: 70 }}>
                      <div className="abb-data" style={{ fontSize: 22, color: accent, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1 }}>{m.perf}%</div>
                      {trendIcon && (
                        <div className="abb-data" style={{ fontSize: 11, color: trendColor, fontWeight: 600, marginTop: 3 }}>
                          {trendIcon}{delta != null && Math.abs(delta) >= 1 ? ` ${delta > 0 ? '+' : ''}${Math.round(delta)}%` : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Row 2: health bar · anomaly score · sparkline ── */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <span className="abb-micro" style={{ fontSize: 10 }}>HEALTH</span>
                        {m.anomalyScore != null && (
                          <span className="abb-data" style={{ fontSize: 10, color: m.anomalyScore > 0.6 ? 'var(--abb-warning)' : 'var(--abb-ink-3)' }}>
                            anomaly {m.anomalyScore.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div style={{ height: 8, background: 'var(--abb-surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${m.perf}%`, height: '100%', background: accent, borderRadius: 4, transition: 'width 0.5s ease', opacity: 0.9 }} />
                      </div>
                    </div>
                    {history.length > 2 && (
                      <svg width={56} height={28} viewBox="0 0 56 28" style={{ flexShrink: 0, overflow: 'visible' }}>
                        <polyline
                          points={history.map((v, idx) =>
                            `${(idx / (history.length - 1)) * 54},${26 - (v / 100) * 24}`
                          ).join(' ')}
                          fill="none"
                          stroke={accent}
                          strokeWidth={1.6}
                          opacity={0.6}
                        />
                        <circle
                          cx={54}
                          cy={26 - (history[history.length - 1] / 100) * 24}
                          r={2.5}
                          fill={accent}
                        />
                      </svg>
                    )}
                  </div>

                  {/* ── Row 3: owner · fault · risk horizon pill ── */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-2)' }}>
                      {m.assignedEngineer && m.assignedEngineer !== 'Unassigned'
                        ? `▸ ${m.assignedEngineer}${m.faultCategory ? ` · ${m.faultCategory}` : ''}`
                        : m.faultCategory ?? '—'}
                    </span>
                    {horizon && (
                      <span className="abb-data" style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: isCrit ? 'var(--abb-alarm)' : 'var(--abb-warning)',
                        background: isCrit ? 'var(--abb-alarm-soft)' : 'var(--abb-warning-soft)',
                        border: `1px solid ${isCrit ? 'var(--abb-alarm-line)' : 'var(--abb-warning-line)'}`,
                        padding: '2px 8px',
                        borderRadius: 10,
                        letterSpacing: '0.04em',
                      }}>
                        <span aria-hidden="true">⏱</span> {horizon}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );

      case 'riskLevel':
        return (
          <div>
            <div style={{ height: 18, borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 12, background: 'var(--abb-surface-3)' }}>
              {riskDist.LOW > 0 && <div style={{ width: `${(riskDist.LOW / riskTotal) * 100}%`, background: STATE_TOKEN.nominal }} />}
              {riskDist.MEDIUM > 0 && <div style={{ width: `${(riskDist.MEDIUM / riskTotal) * 100}%`, background: STATE_TOKEN.warning }} />}
              {riskDist.HIGH > 0 && <div style={{ width: `${(riskDist.HIGH / riskTotal) * 100}%`, background: STATE_TOKEN.high }} />}
              {riskDist.CRITICAL > 0 && <div style={{ width: `${(riskDist.CRITICAL / riskTotal) * 100}%`, background: STATE_TOKEN.critical }} />}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'LOW', count: riskDist.LOW, color: STATE_TOKEN.nominal },
                { label: 'MEDIUM', count: riskDist.MEDIUM, color: STATE_TOKEN.warning },
                { label: 'HIGH', count: riskDist.HIGH, color: STATE_TOKEN.high },
                { label: 'CRITICAL', count: riskDist.CRITICAL, color: STATE_TOKEN.critical },
              ].map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Dot color={r.color} size={6} cls="" />
                  <span className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-2)', letterSpacing: '0.04em' }}>
                    {r.label} <span style={{ fontWeight: 700, color: r.count > 0 ? r.color : 'var(--abb-ink-3)' }}>{r.count}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );

      case 'faultDonut':
        return <FaultDonut data={faultData} />;

      case 'topMachines':
        return <TopMachinesChart data={topMachines} onSelect={focusMachine} />;

      case 'earlyCatches':
        return <TopMachinesChart data={topEarlyCatches} onSelect={focusMachine} />;

      case 'leaderboard':
        return <LeaderboardTable engineers={engineers ?? []} tasks={leaderboardTasks} mobile={isMobile} />;

      case 'alarmsPerHour':
        return <AlarmsPerHourChart data={hourBins} />;

      case 'alarmPipeline': {
        const rawA = metrics.rawAlarms10m;
        const nuisance = metrics.nuisanceFiltered;
        const actionable = metrics.actionableAlarms10m;
        const maxVal = Math.max(rawA, 1);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Raw Gateway Alarms', val: rawA, color: 'var(--abb-ink-2)' },
              { label: 'Nuisance Filtered', val: nuisance, color: STATE_TOKEN.warning },
              { label: 'Actionable Dispatched', val: actionable, color: STATE_TOKEN.nominal },
            ].map((bar) => (
              <div key={bar.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.03em' }}>{bar.label}</span>
                  <span className="abb-data" style={{ fontSize: 11, fontWeight: 700, color: bar.color }}>{bar.val}</span>
                </div>
                <div style={{ height: 10, background: 'var(--abb-surface-3)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${(bar.val / maxVal) * 100}%`, height: '100%', background: bar.color, borderRadius: 5, transition: 'width 0.5s ease', opacity: 0.75 }} />
                </div>
              </div>
            ))}
            {metrics.reductionPct != null && (
              <div className="abb-data" style={{ fontSize: 9, color: metrics.reductionPct > 30 ? 'var(--abb-nominal)' : 'var(--abb-ink-3)', textAlign: 'right', marginTop: 2, fontWeight: 600 }}>
                ▸ {metrics.reductionPct}% alarm reduction rate
              </div>
            )}
          </div>
        );
      }

      case 'leadTime':
        return metrics.leadRing.length === 0 ? (
          <EmptyNote>Collecting lead time data…</EmptyNote>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              {metrics.avgLeadSeconds != null && (
                <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-warning)' }}>avg {fmtLead(metrics.avgLeadSeconds)}</span>
              )}
            </div>
            <div style={{ height: 72 }}>
              <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(metrics.leadRing.length * 18, 36)} 72`} preserveAspectRatio="none" style={{ display: 'block' }}>
                {(() => {
                  const maxLead = Math.max(...metrics.leadRing, 1);
                  return metrics.leadRing.map((lead, idx) => {
                    const h = (lead / maxLead) * 60;
                    const barColor = lead > (metrics.avgLeadSeconds ?? 0) ? 'var(--abb-warning)' : 'var(--abb-nominal)';
                    return <rect key={idx} x={idx * 18 + 2} y={72 - h} width={14} height={h} rx={2} fill={barColor} opacity={0.65} />;
                  });
                })()}
              </svg>
            </div>
            {metrics.maxLeadSeconds != null && (
              <div className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', textAlign: 'right', marginTop: 4 }}>
                best {fmtLead(metrics.maxLeadSeconds)} · {metrics.completedLeads} resolved
              </div>
            )}
          </div>
        );

      case 'anomalyTrend': {
        const last = anomalyHistory[anomalyHistory.length - 1];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, height: 64, position: 'relative' }}>
              <svg width="100%" height="100%" viewBox="0 0 400 64" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                <line x1="0" y1="14" x2="400" y2="14" stroke="var(--abb-alarm-line)" strokeDasharray="3,3" />
                <polygon points={`0,64 ${anomalyHistory.map((v, i) => `${(i / (anomalyHistory.length - 1)) * 400},${64 - v * 56}`).join(' ')} 400,64`} fill="var(--abb-early)" opacity={0.12} />
                <polyline points={anomalyHistory.map((v, i) => `${(i / (anomalyHistory.length - 1)) * 400},${64 - v * 56}`).join(' ')} fill="none" stroke="var(--abb-early)" strokeWidth={1.8} />
                <circle cx={400} cy={64 - last * 56} r={3} fill="var(--abb-early)" />
              </svg>
            </div>
            <div style={{ textAlign: 'right', minWidth: 54 }}>
              <div className="abb-data" style={{ fontSize: 22, fontWeight: 700, color: last > 0.45 ? 'var(--abb-warning)' : 'var(--abb-nominal)' }}>{last.toFixed(2)}</div>
              <div style={{ fontSize: 8, color: 'var(--abb-ink-3)', textTransform: 'uppercase' }}>Avg Score</div>
            </div>
          </div>
        );
      }

      case 'zonePerf':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {zoneRollup.length === 0 && <EmptyNote>NO ZONES SELECTED</EmptyNote>}
            {zoneRollup.map((z) => {
              const avgP = z.avgPerf;
              const barColor = avgP >= 90 ? STATE_TOKEN.nominal : avgP >= 70 ? STATE_TOKEN.warning : avgP >= 50 ? STATE_TOKEN.high : STATE_TOKEN.critical;
              return (
                <div key={z.zone} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="abb-data" style={{ fontSize: 13, fontWeight: 700, color: 'var(--abb-ink-1)', width: 60, letterSpacing: '0.04em' }}>{z.label}</span>
                  <div style={{ flex: 1, height: 12, background: 'var(--abb-surface-3)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${avgP}%`, height: '100%', background: barColor, borderRadius: 6, transition: 'width 0.5s ease' }} />
                  </div>
                  <span className="abb-data" style={{ fontSize: 14, fontWeight: 700, color: barColor, width: 44, textAlign: 'right' }}>{avgP}%</span>
                  <span className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-3)', width: 90 }}>{z.count} machines</span>
                </div>
              );
            })}
          </div>
        );

      case 'heatmap':
        return <HeatmapGrid events={filteredEvents} />;

      case 'predictionMetrics':
        return (
          <div>
            {metrics.avgLeadSeconds != null ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                <div className="abb-data" style={{ fontSize: 40, fontWeight: 600, color: 'var(--abb-warning)' }}><span aria-hidden="true">⏱</span> {fmtLead(metrics.avgLeadSeconds)}</div>
                <div className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-2)', letterSpacing: '0.04em' }}>
                  avg early warning over static gateway{metrics.maxLeadSeconds != null ? ` · best ${fmtLead(metrics.maxLeadSeconds)}` : ''}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <div className="abb-data" style={{ fontSize: 18, color: 'var(--abb-ink-2)' }}><span aria-hidden="true">⏱</span> Collecting live metrics…</div>
                <div className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)' }}>
                  {metrics.openEarly > 0 ? `${metrics.openEarly} fault(s) flagged EARLY — awaiting static trip` : 'awaiting first early-vs-gateway lead'}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 40, marginTop: 22, flexWrap: 'wrap' }}>
              <Metric value={metrics.samples > 0 ? `${metrics.earlyCatches}` : '—'} label={metrics.samples > 0 ? `caught early${metrics.openEarly > 0 ? ` · ${metrics.openEarly} still early` : ''}` : 'Collecting…'} />
              <Metric value={metrics.samples > 0 ? `${metrics.nuisanceFiltered}` : '—'} label={metrics.samples > 0 ? 'nuisance filtered · 0 queued' : 'Collecting…'} />
              <Metric value={metrics.reductionPct != null ? `${metrics.reductionPct}%` : '—'} label={metrics.reductionPct != null ? `alarm reduction · ${metrics.rawAlarms10m}→${metrics.actionableAlarms10m}/10m` : 'Collecting…'} />
              <Metric value={metrics.earlyCatches === 0 ? '—' : metrics.anomalyWarming ? 'collecting' : `${metrics.corroborationRate}%`} label={metrics.earlyCatches === 0 ? 'Collecting…' : metrics.anomalyWarming ? 'corroboration — model warming up' : 'detection corroboration (heuristic + ML)'} />
            </div>
            <div className="abb-data" style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--abb-line-faint)', fontSize: 9, color: 'var(--abb-ink-3)', lineHeight: 1.6 }}>
              Lead time measured vs the static gateway on the same events; corroboration = independent ML agreement. No grading against synthetic labels.
            </div>
          </div>
        );

      case 'workforce':
        return (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 420px', minWidth: 300 }}>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-3)', marginBottom: 8 }}>ROSTER</div>
              <EngineersRoster engineers={engineers} wfLoading={wfLoading} onToggle={toggleActive} onDelete={handleDelete} />
            </div>
            <div style={{ width: 360, minWidth: 260, flex: '1 1 260px' }}>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-3)', marginBottom: 8 }}>ADD TECHNICIAN</div>
              <AddTechnicianForm onCreated={fetchEngineers} />
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="abb-page fade-in-up" style={{ display: 'flex', flexDirection: 'column' }}>
      <SiteAlertBanner alert={siteAlert} />
      <NavBar onBack={() => (window.location.href = '/')} onLogout={logout} />

      {/* Page header + reset */}
      <div className="abb-shell" style={{ paddingTop: 'clamp(20px,3vw,32px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(24px,3vw,32px)', fontWeight: 800, color: 'var(--abb-ink-0)', letterSpacing: '-0.02em', textTransform: 'uppercase', marginBottom: 6 }}>
              Plant Manager <span style={{ color: 'var(--abb-red)' }}>— All Zones</span>
            </h1>
            <p style={{ fontSize: 13, color: 'var(--abb-ink-2)' }}>Site-wide live machine health, zone rollup, and prediction metrics.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div className="abb-data" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.08em' }}>
              <Dot color={metrics.samples > 0 ? STATE_TOKEN.nominal : 'var(--abb-ink-3)'} size={6} cls={metrics.samples > 0 ? '' : 'pulse'} />
              {metrics.samples > 0 ? `${metrics.samples} LIVE FRAMES` : 'AWAITING STREAM'}
            </div>
            <Button variant="ghost" onClick={resetLayout} style={{ fontSize: 10, padding: '7px 12px' }}>↺ RESET LAYOUT</Button>
          </div>
        </div>
      </div>

      {/* KPI bar — locked, full width, not draggable */}
      <div className="abb-shell" style={{ marginTop: 16 }}>
        <Panel style={{ padding: 22, borderTop: '3px solid var(--abb-red)' }}>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {STRIP.map((s) => (
              <div key={s.label}>
                <div className="abb-data" style={{ fontSize: 36, fontWeight: 700, color: s.tone ?? 'var(--abb-ink-0)', letterSpacing: '-0.02em' }}>{s.value}</div>
                <MicroLabel style={{ marginTop: 4 }}>{s.label}</MicroLabel>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Sticky global filter bar */}
      <div style={{ marginTop: 14 }}>
        <FilterBar value={filters} onChange={setFilters} onSearchOpen={() => setSearchOpen(true)} />
      </div>

      {/* Command-palette widget search */}
      <DashboardSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        widgets={ADMIN_WIDGETS}
        layout={layout}
        onNavigate={navigateToWidget}
      />

      {/* Draggable widget grid */}
      <div className="abb-shell" style={{ paddingTop: 20, paddingBottom: 56 }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={layout.order} strategy={rectSortingStrategy}>
            <div>
              {sectionWidgets.map((sec) => (
                <div key={sec.label} style={{ marginBottom: 28 }}>
                  {/* Section Label Divider */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      paddingTop: 14,
                      paddingBottom: 12,
                    }}
                  >
                    <span
                      className="abb-micro"
                      style={{ fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.16em', whiteSpace: 'nowrap' }}
                    >
                      {sec.label}
                    </span>
                    <div style={{ flex: 1, height: 1, background: 'var(--abb-line-faint)' }} />
                  </div>

                  {/* Section Grid Container */}
                  <div className="admin-grid">
                    {sec.widgetIds.map((id) => {
                      const def = WIDGET_BY_ID[id];
                      if (!def) return null;
                      const tierAccent =
                        id === 'zoneRollup' ? 'var(--abb-ink-1)' :
                          id === 'machineAnalytics' || id === 'faultDonut' ? 'var(--abb-red)' :
                            id === 'alarmsPerHour' || id === 'alarmPipeline' ? 'var(--abb-warning)' :
                              id === 'topMachines' || id === 'earlyCatches' || id === 'leaderboard' ? 'var(--abb-early)' :
                                id === 'heatmap' ? 'var(--abb-early)' :
                                  id === 'predictionMetrics' ? 'var(--abb-nominal)' :
                                    id === 'workforce' ? 'var(--abb-red)' :
                                      undefined;
                      return (
                        <DashboardCard
                          key={id}
                          id={id}
                          title={def.title}
                          subtitle={def.subtitle}
                          span={def.span}
                          fullWidth={def.fullWidth}
                          draggable={!isMobile}
                          collapsed={!!layout.collapsed[id]}
                          onToggleCollapse={toggleCollapse}
                          accent={tierAccent}
                          highlight={highlightId === id}
                        >
                          {renderWidget(id)}
                        </DashboardCard>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="abb-data" style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
      {children}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="abb-data" style={{ fontSize: 22, fontWeight: 600, color: 'var(--abb-ink-0)' }}>{value}</div>
      <MicroLabel style={{ marginTop: 4 }}>{label}</MicroLabel>
    </div>
  );
}

// --------------------------------------------------------------------------
// EngineersRoster — standalone (no re-mount on parent live-data render).
// --------------------------------------------------------------------------
function EngineersRoster({
  engineers,
  wfLoading,
  onToggle,
  onDelete,
}: {
  engineers: Engineer[] | null;
  wfLoading: boolean;
  onToggle: (id: number, currentlyActive: boolean) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterZone, setFilterZone] = useState<string>('ALL');
  const [filterRole, setFilterRole] = useState<string>('ALL');

  if (wfLoading && engineers == null) {
    return <div className="abb-data" style={{ padding: 12 }}>Loading…</div>;
  }
  const raw = engineers ?? [];
  const list = raw.filter((e) => {
    if (searchTerm && !e.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterZone !== 'ALL' && e.zone !== filterZone) return false;
    if (filterRole === 'ACTIVE' && !e.active) return false;
    if (filterRole === 'INACTIVE' && e.active) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'block', flex: '1 1 160px', minWidth: 140 }}>
          <span className="abb-micro" style={{ display: 'block', marginBottom: 5 }}>Search by Name</span>
          <input className="abb-input" value={searchTerm} onChange={(e) => setSearchTerm(e.currentTarget.value)} placeholder="Type a name…" style={{ padding: '8px 10px', fontSize: 12 }} />
        </label>
        <label style={{ display: 'block', flex: '0 1 120px', minWidth: 100 }}>
          <span className="abb-micro" style={{ display: 'block', marginBottom: 5 }}>Zone</span>
          <select className="abb-input" value={filterZone} onChange={(e) => setFilterZone(e.currentTarget.value)} style={{ padding: '8px 10px', fontSize: 12 }}>
            <option value="ALL">All Zones</option>
            <option value="A">Zone A</option>
            <option value="B">Zone B</option>
            <option value="C">Zone C</option>
            <option value="D">Zone D</option>
          </select>
        </label>
        <label style={{ display: 'block', flex: '0 1 120px', minWidth: 100 }}>
          <span className="abb-micro" style={{ display: 'block', marginBottom: 5 }}>Status</span>
          <select className="abb-input" value={filterRole} onChange={(e) => setFilterRole(e.currentTarget.value)} style={{ padding: '8px 10px', fontSize: 12 }}>
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
      </div>
      <div className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)', letterSpacing: '0.04em' }}>
        {list.length} of {raw.length} engineer{raw.length !== 1 ? 's' : ''}
        {(searchTerm || filterZone !== 'ALL' || filterRole !== 'ALL') ? ' (filtered)' : ''}
      </div>
      {list.length === 0 ? (
        <div className="abb-data" style={{ padding: 12, color: 'var(--abb-ink-3)', fontSize: 12 }}>
          {raw.length === 0 ? 'No engineers found.' : 'No results match your filters.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 6 }}>
          {list.map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 10, borderRadius: 'var(--abb-radius-sm)', background: e.active ? 'var(--abb-surface-1)' : 'var(--abb-nuisance-soft)', border: '1px solid var(--abb-line)', opacity: e.active ? 1 : 0.6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--abb-ink-0)' }}>{e.name}</div>
                <div className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-3)' }}>{e.zone} · {e.skills.join(', ')}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Badge variant={e.active ? 'nominal' : 'nuisance'}>{e.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
                <Button variant="ghost" onClick={() => onToggle(e.id, e.active)}>{e.active ? 'DEACTIVATE' : 'ACTIVATE'}</Button>
                <Button variant="ghost" onClick={() => onDelete(e.id, e.name)} style={{ color: 'var(--abb-alarm)', borderColor: 'var(--abb-alarm-line)', fontSize: 10, padding: '6px 10px' }}>DELETE</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// AddTechnicianForm — standalone so live-data ticks don't wipe input state.
// --------------------------------------------------------------------------
function AddTechnicianForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [zone, setZone] = useState('Zone A');
  const [skills, setSkills] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    const body = {
      name: name.trim(),
      zone: zone.replace('Zone ', ''),
      skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
      username: username.trim(),
      password,
      role: 'technician',
    };
    const res = await createEngineer(body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Create failed');
      return;
    }
    setSuccess('Technician added');
    setName('');
    setZone('Zone A');
    setSkills('');
    setUsername('');
    setPassword('');
    await onCreated();
    setTimeout(() => setSuccess(null), 3000);
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field label="Full name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <label style={{ display: 'block' }}>
        <span className="abb-micro" style={{ display: 'block', marginBottom: 7 }}>Zone</span>
        <select className="abb-input" value={zone} onChange={(e) => setZone(e.currentTarget.value)}>
          <option>Zone A</option>
          <option>Zone B</option>
          <option>Zone C</option>
          <option>Zone D</option>
        </select>
      </label>
      <label style={{ display: 'block' }}>
        <span className="abb-micro" style={{ display: 'block', marginBottom: 7 }}>Skills (comma separated)</span>
        {/* <input className="abb-input" value={skills} onChange={(e) => setSkills(e.currentTarget.value)} placeholder="mechanical, electrical" /> */}
        <select className="abb-input" value={skills} onChange={(e) => setSkills(e.currentTarget.value)}>
          <option value="" disabled>Select skill focus...</option>
          <option value="general">General</option>
          <option value="mechanical">Mechanical</option>
          <option value="electrical">Electrical</option>
          <option value="instrumentation">Instrumentation</option>
          <option value="thermal">Thermal</option>
        </select>
      </label>
      <Field label="Username" value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
      {error && <div className="abb-data" style={{ color: 'var(--abb-high)', fontSize: 12 }}>{error}</div>}
      {success && <div className="abb-data" style={{ color: 'var(--abb-early)', fontSize: 12 }}>{success}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'ADDING…' : 'Add Technician'}</Button>
      </div>
    </form>
  );
}

export default function AdminPage() {
  return (
    <RoleGuard role="plant_manager">
      <AdminConsole />
    </RoleGuard>
  );
}
