'use client';

import { useEffect, useMemo, useState } from 'react';
import { NavBar, Dot, Panel, Badge, MicroLabel, STATE_TOKEN, type BadgeVariant } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import AriaPanel from '@/components/AriaPanel';
import { MachineHealthCard } from '@/components/MachineHealthCard';
import { CapacityDonut } from '@/components/charts/CapacityDonut';
import { ZoneTrendChart, type TrendBin } from '@/components/charts/ZoneTrendChart';
import { useLiveData } from '@/hooks/useLiveData';
import { useTasks } from '@/hooks/useTasks';
import { useAlarmHistory } from '@/hooks/useAlarmHistory';
import { useMachineSignals } from '@/hooks/useMachineSignals';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import { getEngineers, assignTask, type Engineer } from '@/lib/tasksApi';
import { anomalyColor } from '@/lib/chartPalette';

// Lifecycle status -> badge variant.
const STATUS_BADGE: Record<string, BadgeVariant> = {
  assigned: 'warning',
  in_progress: 'early',
  resolved: 'nominal',
};

type TeamFilter = 'all' | 'available' | 'atcap' | 'offshift';
const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (ts: number) => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function engStatus(e: Engineer): Exclude<TeamFilter, 'all'> {
  if (!e.active) return 'offshift';
  const active = e.active_tasks ?? 0;
  const max = e.max_capacity ?? 3;
  return active >= max ? 'atcap' : 'available';
}

function FieldManagerConsole() {
  const { user, logout } = useAuth();
  const zoneLetter = user?.zone ?? '—';
  const zoneFull = user?.zone ? `Zone ${user.zone}` : null;

  const { machines, siteAlert, metrics, connected } = useLiveData(zoneLetter !== '—' ? zoneLetter : undefined);
  const { tasks: zoneTasks, refresh: refreshTasks } = useTasks();
  const events = useAlarmHistory(machines);
  const signals = useMachineSignals(machines);

  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [engLoading, setEngLoading] = useState(true);
  const [selectedEngineers, setSelectedEngineers] = useState<Record<number, number>>({});
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [expandedMachine, setExpandedMachine] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('all');

  const refreshEngineers = () => {
    getEngineers().then((res) => {
      setEngLoading(false);
      if (res.ok) setEngineers(res.data);
    });
  };

  useEffect(() => {
    refreshEngineers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoneMachines = machines;

  // Real-time scrolling anomaly history of the zone (existing sparkline).
  const [history, setHistory] = useState<number[]>(Array(15).fill(0.12));
  useEffect(() => {
    if (zoneMachines.length === 0) return;
    const avg = zoneMachines.reduce((acc, m) => acc + (m.anomalyScore ?? 0), 0) / zoneMachines.length;
    setHistory((prev) => [...prev.slice(1), avg]);
  }, [machines]);

  // ---- KPI summary (Section 2A) -------------------------------------------
  const count = zoneMachines.length;
  const criticals = zoneMachines.filter((m) => m.nexopsRisk === 'CRITICAL').length;
  const activeAlarms = zoneMachines.filter((m) => m.perf < 80).length;
  const earlyCount = zoneMachines.filter((m) => m.isEarly).length;
  const zoneHealth = count ? Math.round(zoneMachines.reduce((a, m) => a + m.perf, 0) / count) : null;

  // AVG RESPONSE TIME = mean(assigned_at -> started_at) over zone tasks that have started.
  const avgRespMin = useMemo(() => {
    const t = zoneTasks.filter((x) => x.assigned_at && x.started_at);
    if (t.length === 0) return null;
    const sum = t.reduce((a, x) => a + (new Date(x.started_at as string).getTime() - new Date(x.assigned_at as string).getTime()) / 60000, 0);
    return sum / t.length;
  }, [zoneTasks]);

  const healthTone = zoneHealth == null ? undefined : zoneHealth >= 90 ? STATE_TOKEN.nominal : zoneHealth >= 70 ? STATE_TOKEN.warning : STATE_TOKEN.critical;
  const SUMMARY: { value: string; label: string; tone?: string }[] = [
    { value: count ? `${count}` : '—', label: 'MACHINES' },
    { value: `${activeAlarms}`, label: 'ACTIVE ALARMS', tone: activeAlarms > 0 ? STATE_TOKEN.warning : undefined },
    { value: `${criticals}`, label: 'CRITICAL', tone: criticals > 0 ? STATE_TOKEN.critical : undefined },
    { value: `${earlyCount}`, label: 'EARLY CATCHES', tone: earlyCount > 0 ? STATE_TOKEN.early : undefined },
    { value: avgRespMin != null ? `${avgRespMin.toFixed(1)}m` : '—', label: 'AVG RESPONSE TIME' },
    { value: metrics.samples > 0 ? `${metrics.nuisanceFiltered}` : '—', label: 'NUISANCE FILTERED' },
    { value: zoneHealth != null ? `${zoneHealth}%` : '—', label: 'ZONE HEALTH', tone: healthTone },
  ];

  // ---- Zone engineers (team scoped to this manager's zone) ----------------
  const zoneEngineers = useMemo(
    () => engineers.filter((e) => (e.zone || '').replace('Zone ', '').trim() === zoneLetter),
    [engineers, zoneLetter],
  );
  const capTotal = zoneEngineers.reduce((a, e) => a + (e.max_capacity ?? 3), 0);
  const capOccupied = zoneEngineers.reduce((a, e) => a + (e.active_tasks ?? 0), 0);
  const capFree = Math.max(0, capTotal - capOccupied);
  const teamFiltered = zoneEngineers.filter((e) => teamFilter === 'all' || engStatus(e) === teamFilter);
  const teamCounts = {
    all: zoneEngineers.length,
    available: zoneEngineers.filter((e) => engStatus(e) === 'available').length,
    atcap: zoneEngineers.filter((e) => engStatus(e) === 'atcap').length,
    offshift: zoneEngineers.filter((e) => engStatus(e) === 'offshift').length,
  };

  // ---- Per-machine alarm events + top-3 at-risk + 6h trend ----------------
  const eventsByMachine = useMemo(() => {
    const m: Record<string, typeof events> = {};
    for (const e of events) (m[e.machine] ??= []).push(e);
    return m;
  }, [events]);

  const top3 = useMemo(
    () => [...zoneMachines].sort((a, b) => (b.anomalyScore ?? 0) - (a.anomalyScore ?? 0)).slice(0, 3),
    [zoneMachines],
  );

  const trendBins: TrendBin[] = useMemo(() => {
    const N = 36, BUCKET = 600000, now = Date.now(), start = now - N * BUCKET;
    const bins: TrendBin[] = Array.from({ length: N }, (_, i) => ({ label: hhmm(start + i * BUCKET), count: 0 }));
    for (const e of events) {
      if (e.ts < start) continue;
      const idx = Math.min(N - 1, Math.floor((e.ts - start) / BUCKET));
      bins[idx].count += 1;
    }
    return bins;
  }, [events]);

  const focusMachine = (name: string) => {
    setExpandedMachine(name);
    requestAnimationFrame(() => document.getElementById(`eng-machine-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const analyticTile = (value: string, label: string, sub: string, valueColor?: string) => (
    <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
      <div className="abb-data" style={{ fontSize: 24, fontWeight: 600, color: valueColor ?? 'var(--abb-ink-0)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--abb-ink-2)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 9, color: 'var(--abb-ink-3)', marginTop: 2 }}>{sub}</div>
    </div>
  );

  return (
    <div className="abb-page fade-in-up" style={{ display: 'flex', flexDirection: 'column' }}>
      <SiteAlertBanner alert={siteAlert} />
      <NavBar onBack={() => (window.location.href = '/')} onLogout={logout} />

      <div className="abb-shell" style={{ paddingTop: 'clamp(28px,4vw,40px)', paddingBottom: 56, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(24px,3vw,32px)', fontWeight: 800, color: 'var(--abb-ink-0)', letterSpacing: '-0.02em', textTransform: 'uppercase', marginBottom: 6 }}>
              Zone {zoneLetter} <span style={{ color: 'var(--abb-red)' }}>— Field Manager</span>
            </h1>
            <p className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-2)' }}>
              FIELD MANAGER · {user?.username ?? '—'} · scoped to Zone {zoneLetter}
            </p>
          </div>
        </div>

        {/* 2A — KPI SUMMARY (7 tiles) */}
        <Panel className="section-enter" style={{ padding: 22, borderTop: '3px solid var(--abb-red)', animationDelay: '0.1s' }}>
          <div style={{ display: 'flex', gap: 'clamp(20px,3vw,40px)', flexWrap: 'wrap' }}>
            {SUMMARY.map((s) => (
              <div key={s.label}>
                <div className="abb-data" style={{ fontSize: 30, fontWeight: 700, color: s.tone ?? 'var(--abb-ink-0)', letterSpacing: '-0.02em' }}>{s.value}</div>
                <MicroLabel style={{ marginTop: 4 }}>{s.label}</MicroLabel>
              </div>
            ))}
          </div>
        </Panel>

        {/* 2B — ZONE MACHINE HEALTH GRID */}
        <Panel className="section-enter" style={{ padding: 22, borderTop: '3px solid var(--abb-red)', animationDelay: '0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <MicroLabel>ZONE {zoneLetter} · MACHINE HEALTH &amp; PREDICTION</MicroLabel>
            <div className="abb-data" style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.nominal} size={6} cls="" />NOMINAL</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.warning} size={6} cls="" />WARNING</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.early} size={6} cls="" />EARLY</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.critical} size={6} cls="" />CRITICAL</span>
            </div>
          </div>
          {count === 0 ? (
            <div className="abb-data" style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
              {zoneFull ? `AWAITING LIVE STREAM FOR ZONE ${zoneLetter}…` : 'NO ZONE ASSIGNED'}
            </div>
          ) : (
            <div className="machine-health-grid">
              {zoneMachines.map((m) => (
                <MachineHealthCard
                  key={m.name}
                  machine={m}
                  signals={signals[m.name] ?? []}
                  events={eventsByMachine[m.name] ?? []}
                  expanded={expandedMachine === m.name}
                  onToggle={() => setExpandedMachine((cur) => (cur === m.name ? null : m.name))}
                />
              ))}
            </div>
          )}
        </Panel>

        {/* 2C + 2D — Field Team & Analytics */}
        <div className="section-enter" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 28, alignItems: 'start', animationDelay: '0.3s' }}>
          {/* 2C — FIELD TEAM & CAPACITY */}
          <Panel style={{ padding: 22 }}>
            <MicroLabel style={{ marginBottom: 16 }}>ZONE {zoneLetter} · FIELD TEAM &amp; CAPACITY</MicroLabel>

            {/* Capacity overview donut */}
            <div style={{ border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14, marginBottom: 14, background: 'var(--abb-surface-1)' }}>
              <div className="abb-micro" style={{ marginBottom: 10 }}>CAPACITY OVERVIEW</div>
              <CapacityDonut free={capFree} occupied={capOccupied} total={capTotal} />
            </div>

            {/* Filter row */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {([
                ['all', 'All'],
                ['available', 'Available'],
                ['atcap', 'At Capacity'],
                ['offshift', 'Off Shift'],
              ] as [TeamFilter, string][]).map(([key, label]) => {
                const on = teamFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTeamFilter(key)}
                    className="abb-data"
                    style={{ fontSize: 10, fontWeight: 600, padding: '5px 11px', borderRadius: 'var(--abb-radius-pill)', cursor: 'pointer', border: `1px solid ${on ? 'var(--abb-ink-2)' : 'var(--abb-line)'}`, background: on ? 'var(--abb-surface-2)' : 'var(--abb-surface-1)', color: on ? 'var(--abb-ink-0)' : 'var(--abb-ink-3)' }}
                  >
                    {label} ({teamCounts[key]})
                  </button>
                );
              })}
            </div>

            {engLoading && engineers.length === 0 ? (
              <div className="abb-data" style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>LOADING ZONE ENGINEERS…</div>
            ) : zoneEngineers.length === 0 ? (
              <div className="abb-data" style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>NO ACTIVE ENGINEERS REGISTERED IN ZONE {zoneLetter}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Unassigned tasks queue */}
                {(() => {
                  const unassignedTasks = zoneTasks.filter((t) => !t.engineer_name || t.engineer_name === 'Unassigned');
                  if (unassignedTasks.length === 0) return null;
                  return (
                    <div style={{ border: '1px dashed var(--abb-alarm-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14, background: 'var(--abb-alarm-soft)' }}>
                      <div className="abb-data" style={{ fontSize: 11, fontWeight: 700, color: 'var(--abb-alarm)', marginBottom: 8, letterSpacing: '0.05em' }}>UNASSIGNED ALERTS IN QUEUE</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {unassignedTasks.map((t) => {
                          const activeEngs = zoneEngineers.filter((e) => e.active);
                          const selectedId = selectedEngineers[t.id] || 0;
                          const isAssigning = assigningId === t.id;
                          return (
                            <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--abb-alarm-line)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span className="abb-data" style={{ fontSize: 10.5, color: 'var(--abb-ink-1)' }}>
                                  <span style={{ color: 'var(--abb-alarm)' }}>T-{t.id} ·</span> {t.fault_category ?? 'general'} <span style={{ color: 'var(--abb-ink-3)' }}>· {t.machine}</span>
                                </span>
                                <Badge variant="alarm">Pending Assign</Badge>
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <select
                                  value={selectedId}
                                  onChange={(e) => setSelectedEngineers((prev) => ({ ...prev, [t.id]: parseInt(e.target.value, 10) }))}
                                  className="abb-input"
                                  style={{ padding: '6px 8px', fontSize: 11, flex: 1 }}
                                  disabled={isAssigning}
                                >
                                  <option value={0}>Select Engineer...</option>
                                  {activeEngs.map((eng) => (
                                    <option key={eng.id} value={eng.id}>{eng.name} ({eng.active_tasks ?? 0}/{eng.max_capacity ?? 3} active)</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="abb-btn abb-btn--primary"
                                  onClick={async () => {
                                    if (!selectedId) return;
                                    setAssigningId(t.id);
                                    setAssignError(null);
                                    const res = await assignTask(t.id, selectedId);
                                    setAssigningId(null);
                                    if (res.ok) {
                                      setSelectedEngineers((prev) => { const next = { ...prev }; delete next[t.id]; return next; });
                                      refreshTasks();
                                      refreshEngineers();
                                    } else {
                                      setAssignError(res.error);
                                    }
                                  }}
                                  disabled={!selectedId || isAssigning}
                                  style={{ padding: '6px 12px', fontSize: 11, height: 30 }}
                                >
                                  {isAssigning ? '...' : 'Assign'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {assignError && <div style={{ color: 'var(--abb-alarm)', fontSize: 10, marginTop: 4 }}>Error: {assignError}</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* Engineer workload cards (filtered) */}
                {teamFiltered.length === 0 ? (
                  <div className="abb-data" style={{ padding: '16px 0', textAlign: 'center', fontSize: 10, color: 'var(--abb-ink-3)' }}>No engineers match this filter.</div>
                ) : (
                  teamFiltered.map((eng) => {
                    const activeCount = eng.active_tasks ?? 0;
                    const maxCap = eng.max_capacity ?? 3;
                    const percent = Math.min((activeCount / maxCap) * 100, 100);
                    let barColor = '#22c55e';
                    if (percent >= 100) barColor = '#ef4444';
                    else if (percent >= 50) barColor = 'var(--abb-warning)';
                    const engTasks = zoneTasks.filter((t) => t.engineer_name === eng.name);
                    return (
                      <div key={eng.id} style={{ border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14, background: 'var(--abb-surface-1)', opacity: eng.active ? 1 : 0.6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                          <span className="abb-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--abb-ink-0)' }}>{eng.name}{!eng.active && <span style={{ color: 'var(--abb-ink-3)', fontWeight: 400 }}> · off shift</span>}</span>
                          {eng.skills && eng.skills.length > 0 && (
                            <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.04em' }}>FOCUS · {eng.skills.join(' · ')}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-2)' }}>Workload: {activeCount} / {maxCap} Active Tasks</span>
                          <span className="abb-data" style={{ fontSize: 10, fontWeight: 600, color: barColor }}>{percent.toFixed(0)}%</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--abb-surface-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
                          <div style={{ width: `${percent}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
                        </div>
                        {engTasks.length === 0 ? (
                          <div className="abb-data" style={{ fontSize: 9.5, color: 'var(--abb-ink-3)' }}>No lifecycle tasks open</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--abb-line-faint)', paddingTop: 8 }}>
                            {engTasks.map((t) => (
                              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span className="abb-data" style={{ fontSize: 10.5, color: 'var(--abb-ink-1)' }}>
                                  <span style={{ color: 'var(--abb-ink-3)' }}>T-{t.id} ·</span> {t.fault_category ?? 'general'} <span style={{ color: 'var(--abb-ink-3)' }}>· {t.machine}</span>
                                </span>
                                <Badge variant={STATUS_BADGE[t.status] ?? 'nominal'}>{t.status.replace('_', ' ')}</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </Panel>

          {/* 2D — ADVANCED ANALYTICS */}
          <Panel style={{ padding: 22 }}>
            <MicroLabel style={{ marginBottom: 16 }}>ZONE {zoneLetter} · ADVANCED ANALYTICS</MicroLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Anomaly trend sparkline (existing) */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Zone Anomaly Trend</span>
                  <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>Live MQTT Feed</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, height: 48, position: 'relative' }}>
                    <svg width="100%" height="100%" viewBox="0 0 300 48" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                      <line x1="0" y1="10" x2="300" y2="10" stroke="rgba(193, 18, 31, 0.15)" strokeDasharray="2,2" />
                      <polygon points={`0,48 ${history.map((v, i) => `${(i / (history.length - 1)) * 300},${48 - v * 40}`).join(' ')} 300,48`} fill="var(--abb-early)" opacity={0.12} />
                      <polyline points={history.map((v, i) => `${(i / (history.length - 1)) * 300},${48 - v * 40}`).join(' ')} fill="none" stroke="var(--abb-early)" strokeWidth={1.5} />
                    </svg>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 50 }}>
                    <div className="abb-data" style={{ fontSize: 18, fontWeight: 700, color: history[history.length - 1] > 0.45 ? 'var(--abb-warning)' : 'var(--abb-nominal)' }}>{history[history.length - 1].toFixed(2)}</div>
                    <div style={{ fontSize: 8, color: 'var(--abb-ink-3)', textTransform: 'uppercase' }}>Avg Score</div>
                  </div>
                </div>
              </div>

              {/* NEW · Zone Alarm Trend 6h */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Zone Alarm Trend · 6H</span>
                </div>
                <ZoneTrendChart data={trendBins} />
              </div>

              {/* NEW · Top 3 at-risk machines */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>Top 3 At-Risk Machines (Zone)</span>
                </div>
                {top3.length === 0 ? (
                  <div className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)' }}>Awaiting live stream…</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {top3.map((m) => {
                      const a = m.anomalyScore ?? 0;
                      const col = anomalyColor(a);
                      return (
                        <button key={m.name} type="button" onClick={() => focusMachine(m.name)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                          <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-1)', width: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                          <div style={{ flex: 1, height: 10, background: 'var(--abb-surface-3)', borderRadius: 5, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, a * 100)}%`, height: '100%', background: col, borderRadius: 5, transition: 'width 0.4s ease' }} />
                          </div>
                          <span className="abb-data" style={{ fontSize: 11, fontWeight: 700, color: col, width: 38, textAlign: 'right' }}>{a.toFixed(2)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {analyticTile(`${metrics.nuisanceFiltered}`, 'Nuisance Alarms Filtered', 'Chattering and transient alarms suppressed at source')}
              {analyticTile(metrics.reductionPct != null ? `${metrics.reductionPct}%` : '—', 'Alarm Reduction Rate', 'Ratio of raw gateway alarms vs. dispatched actions', metrics.reductionPct != null && metrics.reductionPct > 50 ? '#15803d' : undefined)}
              {analyticTile(metrics.avgLeadSeconds != null ? `${metrics.avgLeadSeconds.toFixed(1)}s` : '—', 'Early Catch Lead Time', 'Average interval between predictive flag and static trip')}
              {analyticTile(metrics.corroborationRate != null ? `${metrics.corroborationRate}%` : '—', 'ML Corroboration Rate', 'Agreement rate of predictive alerts with ML models')}
            </div>
          </Panel>
        </div>
      </div>

      {/* 2E — ARIA floating right-side drawer (swap-seam untouched) */}
      <AriaPanel zone={zoneLetter} floating online={connected} />
    </div>
  );
}

export default function EngineerPage() {
  return (
    <RoleGuard role="field_manager">
      <FieldManagerConsole />
    </RoleGuard>
  );
}
