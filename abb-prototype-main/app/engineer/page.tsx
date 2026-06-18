'use client';

import { useEffect, useState } from 'react';
import { NavBar, Dot, Panel, Badge, MicroLabel, RISK_TOKEN, STATE_TOKEN, type BadgeVariant } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import AriaPanel from '@/components/AriaPanel';
import { useLiveData } from '@/hooks/useLiveData';
import { useTasks } from '@/hooks/useTasks';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import { getEngineers, assignTask, type Engineer } from '@/lib/tasksApi';
import type { Machine, LifecycleTask } from '@/types/telemetry';

// NexOps risk -> badge variant (LOW grey / MEDIUM amber / HIGH orange / CRITICAL
// red). Red reserved for CRITICAL only. (Same mapping as the Plant dashboard.)
const RISK_BADGE: Record<string, BadgeVariant> = {
  LOW: 'nominal',
  MEDIUM: 'warning',
  HIGH: 'high',
  CRITICAL: 'alarm',
};

// Lifecycle status -> badge variant (no new colours: amber=assigned,
// indigo=in_progress(active), grey=resolved).
const STATUS_BADGE: Record<string, BadgeVariant> = {
  assigned: 'warning',
  in_progress: 'early',
  resolved: 'nominal',
};

// Visual configurations matching requirements: Gray for LOW, Amber for MEDIUM, Orange for HIGH, pulsing red glow for CRITICAL
const RISK_STYLE: Record<string, { bg: string; border: string; accent: string; cls?: string }> = {
  LOW: {
    bg: 'rgba(148, 163, 184, 0.03)',
    border: 'rgba(148, 163, 184, 0.15)',
    accent: '#94a3b8',
  },
  MEDIUM: {
    bg: 'rgba(245, 158, 11, 0.05)',
    border: 'rgba(245, 158, 11, 0.2)',
    accent: '#f59e0b',
  },
  HIGH: {
    bg: 'rgba(249, 115, 22, 0.06)',
    border: 'rgba(249, 115, 22, 0.25)',
    accent: '#f97316',
  },
  CRITICAL: {
    bg: 'rgba(239, 68, 68, 0.08)',
    border: 'rgba(239, 68, 68, 0.35)',
    accent: '#ef4444',
    cls: 'glow-critical',
  },
};

function FieldManagerConsole() {
  const { user, logout } = useAuth();
  const zoneLetter = user?.zone ?? '—';
  const zoneFull = user?.zone ? `Zone ${user.zone}` : null;

  // Scoped live feed (machines) + site-wide emergency + scoped metrics
  const { machines, siteAlert, metrics } = useLiveData(zoneLetter !== '—' ? zoneLetter : undefined);
  // Zone-scoped task lifecycle: the /tasks endpoint already returns ONLY this
  // field_manager's zone (server-side scoping) — we just render it.
  const { tasks: zoneTasks, loading: tasksLoading, refresh: refreshTasks } = useTasks();

  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [engLoading, setEngLoading] = useState(true);
  const [selectedEngineers, setSelectedEngineers] = useState<Record<number, number>>({});
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Load team engineers scoped to this manager's zone
  useEffect(() => {
    getEngineers().then((res) => {
      setEngLoading(false);
      if (res.ok) {
        setEngineers(res.data);
      }
    });
  }, [zoneTasks]);

  const zoneMachines = machines;

  // Real-time scrolling anomaly history of the zone
  const [history, setHistory] = useState<number[]>(Array(15).fill(0.12));
  useEffect(() => {
    if (zoneMachines.length === 0) return;
    const total = zoneMachines.reduce((acc, m) => acc + (m.anomalyScore ?? 0), 0);
    const avg = total / zoneMachines.length;
    setHistory((prev) => [...prev.slice(1), avg]);
  }, [machines, zoneMachines.length]);

  // ---- Zone health summary (single-zone version of UI-2's rollup) ---------
  const count = zoneMachines.length;
  const criticals = zoneMachines.filter((m) => m.nexopsRisk === 'CRITICAL').length;
  const activeAlarms = zoneMachines.filter((m) => m.perf < 80).length;
  const earlyCount = zoneMachines.filter((m) => m.isEarly).length;

  const stat = (v: number | null) => (v == null ? '—' : `${v}`);
  const SUMMARY: { value: string; label: string; tone?: string }[] = [
    { value: stat(count), label: 'MACHINES' },
    { value: stat(activeAlarms), label: 'ACTIVE ALARMS', tone: activeAlarms > 0 ? STATE_TOKEN.warning : undefined },
    { value: stat(criticals), label: 'CRITICAL', tone: criticals > 0 ? STATE_TOKEN.critical : undefined },
    { value: stat(earlyCount), label: 'EARLY CATCHES', tone: earlyCount > 0 ? STATE_TOKEN.early : undefined },
  ];

  // ---- Field team derived from REAL data (no faked roster) ----------------
  // Primary: distinct engineers on this zone's tasks; supplemented by engineers
  // currently dispatched to this zone's machines. We do NOT invent names.
  const team = new Map<string, { tasks: LifecycleTask[]; focus: Set<string> }>();
  zoneTasks.forEach((t) => {
    const name = t.engineer_name || 'Unassigned';
    if (!team.has(name)) team.set(name, { tasks: [], focus: new Set() });
    const entry = team.get(name)!;
    entry.tasks.push(t);
    if (t.fault_category) entry.focus.add(t.fault_category);
  });
  zoneMachines.forEach((m) => {
    if (m.assignedEngineer && m.assignedEngineer !== 'Unassigned' && !team.has(m.assignedEngineer)) {
      const focus = new Set<string>();
      if (m.faultCategory) focus.add(m.faultCategory);
      team.set(m.assignedEngineer, { tasks: [], focus });
    }
  });
  const teamRows = Array.from(team.entries());

  return (
    <div className="abb-page fade-in-up" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* 1 — SITE EMERGENCY BANNER (site-wide; shown to everyone) */}
      <SiteAlertBanner alert={siteAlert} />

      {/* 6 — NavBar + logout (wiring unchanged) */}
      <NavBar onBack={() => (window.location.href = '/')} onLogout={logout} />

      <div className="abb-shell" style={{ paddingTop: 'clamp(28px,4vw,40px)', paddingBottom: 56, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* 2 — ZONE HEADER + health summary */}
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

        <Panel className="section-enter" style={{ padding: 22, borderTop: '3px solid var(--abb-red)', animationDelay: '0.1s' }}>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {SUMMARY.map((s) => (
              <div key={s.label}>
                <div className="abb-data" style={{ fontSize: 32, fontWeight: 700, color: s.tone ?? 'var(--abb-ink-0)', letterSpacing: '-0.02em' }}>
                  {s.value}
                </div>
                <MicroLabel style={{ marginTop: 4 }}>{s.label}</MicroLabel>
              </div>
            ))}
          </div>
        </Panel>

        {/* 3 — ZONE MACHINE HEALTH (filtered to user.zone) */}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto', paddingRight: 6 }}>
              {zoneMachines.map((m, i) => {
                const style = RISK_STYLE[m.nexopsRisk] ?? RISK_STYLE.LOW;
                const accent = style.accent;
                return (
                  <div
                    key={`${m.name}-${i}`}
                    className={style.cls ?? ''}
                    style={{
                      padding: '11px 14px',
                      background: style.bg,
                      border: `1px solid ${style.border}`,
                      borderLeft: `3px solid ${accent}`,
                      borderRadius: 'var(--abb-radius-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <Dot color={accent} size={7} cls={m.nexopsRisk === 'CRITICAL' ? 'pulse-fast' : ''} />
                        <span className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-0)', fontWeight: 600 }}>{m.name}</span>
                        {m.isEarly && <Badge variant="early" title={m.reasoning}>EARLY</Badge>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {m.anomalyScore != null && (
                          <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>a={m.anomalyScore.toFixed(2)}</span>
                        )}
                        <Badge variant={RISK_BADGE[m.nexopsRisk] ?? 'nominal'} title={m.reasoning}>NEXOPS {m.nexopsRisk}</Badge>
                        <span className="abb-data" style={{ fontSize: 13, color: accent, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>{m.perf}%</span>
                      </div>
                    </div>
                    <div style={{ height: 6, background: 'var(--abb-surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${m.perf}%`, height: '100%', background: accent, borderRadius: 3, transition: 'width 0.4s ease' }} />
                    </div>
                    {m.assignedEngineer && m.assignedEngineer !== 'Unassigned' && (
                      <div className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-2)', marginTop: 6 }}>
                        ▸ {m.assignedEngineer}{m.faultCategory ? ` · ${m.faultCategory}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* 4 (team+tasks) + 5 (analytics) + 6 (ARIA) — 3-panel grid layout on wide screens */}
        <div className="section-enter" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 28, alignItems: 'start', animationDelay: '0.3s' }}>
          {/* 4 — ZONE FIELD TEAM + TASK ASSIGNMENTS */}
          <Panel style={{ padding: 22 }}>
            <MicroLabel style={{ marginBottom: 16 }}>ZONE {zoneLetter} · FIELD TEAM &amp; CAPACITY</MicroLabel>
            {engLoading && engineers.length === 0 ? (
              <div className="abb-data" style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
                LOADING ZONE ENGINEERS…
              </div>
            ) : engineers.length === 0 ? (
              <div className="abb-data" style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
                NO ACTIVE ENGINEERS REGISTERED IN ZONE {zoneLetter}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                
                {/* Render Unassigned Zone Tasks if any */}
                {(() => {
                  const unassignedTasks = zoneTasks.filter(t => !t.engineer_name || t.engineer_name === 'Unassigned');
                  if (unassignedTasks.length > 0) {
                    return (
                      <div style={{ border: '1px dashed #ef4444', borderRadius: 'var(--abb-radius-sm)', padding: 14, background: 'rgba(239, 68, 68, 0.03)' }}>
                        <div className="abb-data" style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 8, letterSpacing: '0.05em' }}>
                          UNASSIGNED ALERTS IN QUEUE
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {unassignedTasks.map((t) => {
                            const activeEngs = engineers.filter(e => e.active);
                            const selectedId = selectedEngineers[t.id] || 0;
                            const isAssigning = assigningId === t.id;

                            return (
                              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 10, borderBottom: '1px solid rgba(239, 68, 68, 0.15)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <span className="abb-data" style={{ fontSize: 10.5, color: 'var(--abb-ink-1)' }}>
                                    <span style={{ color: '#ef4444' }}>T-{t.id} ·</span> {t.fault_category ?? 'general'} <span style={{ color: 'var(--abb-ink-3)' }}>· {t.machine}</span>
                                  </span>
                                  <Badge variant="alarm">Pending Assign</Badge>
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <select
                                    value={selectedId}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10);
                                      setSelectedEngineers(prev => ({ ...prev, [t.id]: val }));
                                    }}
                                    className="abb-input"
                                    style={{
                                      padding: '6px 8px',
                                      fontSize: '11px',
                                      flex: 1,
                                    }}
                                    disabled={isAssigning}
                                  >
                                    <option value={0}>Select Engineer...</option>
                                    {activeEngs.map((eng) => (
                                      <option key={eng.id} value={eng.id}>
                                        {eng.name} ({eng.active_tasks ?? 0}/{eng.max_capacity ?? 3} active)
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    className="abb-btn abb-btn--primary"
                                    onClick={async () => {
                                      if (!selectedId) return;
                                      setAssigningId(t.id);
                                      setAssignError(null);
                                      const res = await assignTask(t.id, selectedId);
                                      setAssigningId(null);
                                      if (res.ok) {
                                        setSelectedEngineers(prev => {
                                          const next = { ...prev };
                                          delete next[t.id];
                                          return next;
                                        });
                                        refreshTasks();
                                      } else {
                                        setAssignError(res.error);
                                      }
                                    }}
                                    disabled={!selectedId || isAssigning}
                                    style={{
                                      padding: '6px 12px',
                                      fontSize: '11px',
                                      height: '30px',
                                    }}
                                  >
                                    {isAssigning ? '...' : 'Assign'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                          {assignError && (
                            <div style={{ color: '#ef4444', fontSize: '10px', marginTop: 4 }}>
                              Error: {assignError}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Render Engineers with Capacity Progress Bar */}
                {engineers.map((eng) => {
                  const activeCount = eng.active_tasks ?? 0;
                  const maxCap = eng.max_capacity ?? 3;
                  const percent = Math.min((activeCount / maxCap) * 100, 100);
                  
                  let barColor = '#22c55e'; // Green
                  if (percent >= 100) barColor = '#ef4444'; // Red
                  else if (percent >= 50) barColor = '#f59e0b'; // Amber

                  const engTasks = zoneTasks.filter(t => t.engineer_name === eng.name);

                  return (
                    <div key={eng.id} style={{ border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14, background: 'var(--abb-surface-1)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span className="abb-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--abb-ink-0)' }}>
                          {eng.name}
                        </span>
                        {eng.skills && eng.skills.length > 0 && (
                          <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.04em' }}>
                            FOCUS · {eng.skills.join(' · ')}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-2)' }}>
                          Workload: {activeCount} / {maxCap} Active Tasks
                        </span>
                        <span className="abb-data" style={{ fontSize: 10, fontWeight: 600, color: barColor }}>
                          {percent.toFixed(0)}%
                        </span>
                      </div>

                      <div style={{ height: 6, background: 'var(--abb-surface-3)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{ width: `${percent}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
                      </div>

                      {engTasks.length === 0 ? (
                        <div className="abb-data" style={{ fontSize: 9.5, color: 'var(--abb-ink-3)' }}>
                          No lifecycle tasks open
                        </div>
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
                })}
              </div>
            )}
          </Panel>

          {/* 5 — ADVANCED ANALYTICS */}
          <Panel style={{ padding: 22 }}>
            <MicroLabel style={{ marginBottom: 16 }}>ZONE {zoneLetter} · ADVANCED ANALYTICS</MicroLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              
              {/* Real-time scrolling anomaly trend graph */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                    Zone Anomaly Trend
                  </span>
                  <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>
                    Live MQTT Feed
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, height: 48, position: 'relative' }}>
                    <svg width="100%" height="100%" viewBox="0 0 300 48" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                      <defs>
                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--abb-early)" />
                          <stop offset="100%" stopColor="transparent" />
                        </linearGradient>
                      </defs>

                      {/* Grid lines */}
                      <line x1="0" y1="24" x2="300" y2="24" stroke="rgba(28, 34, 48, 0.05)" strokeDasharray="2,2" />
                      <line x1="0" y1="10" x2="300" y2="10" stroke="rgba(193, 18, 31, 0.15)" strokeDasharray="2,2" />
                      
                      {/* Shaded Area */}
                      <polygon 
                        points={`0,48 ${history.map((val, idx) => `${(idx / (history.length - 1)) * 300},${48 - (val * 40)}`).join(' ')} 300,48`} 
                        fill="url(#chartGrad)" 
                        opacity={0.15} 
                      />
                      
                      {/* Trend Line */}
                      <polyline 
                        points={history.map((val, idx) => `${(idx / (history.length - 1)) * 300},${48 - (val * 40)}`).join(' ')} 
                        fill="none" 
                        stroke="var(--abb-early)" 
                        strokeWidth={1.5} 
                      />
                    </svg>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 50 }}>
                    <div className="abb-data" style={{ fontSize: 18, fontWeight: 700, color: history[history.length - 1] > 0.45 ? 'var(--abb-warning)' : 'var(--abb-nominal)' }}>
                      {history[history.length - 1].toFixed(2)}
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--abb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Avg Score</div>
                  </div>
                </div>
              </div>

              {/* Nuisance alarms filtered */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div className="abb-data" style={{ fontSize: 24, fontWeight: 600, color: 'var(--abb-ink-0)' }}>
                  {metrics.nuisanceFiltered}
                </div>
                <div style={{ fontSize: 10, color: 'var(--abb-ink-2)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Nuisance Alarms Filtered
                </div>
                <div style={{ fontSize: 9, color: 'var(--abb-ink-3)', marginTop: 2 }}>
                  Chattering and transient alarms suppressed at source
                </div>
              </div>

              {/* Alarm reduction rate */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div className="abb-data" style={{ fontSize: 24, fontWeight: 600, color: metrics.reductionPct != null && metrics.reductionPct > 50 ? '#22c55e' : 'var(--abb-ink-0)' }}>
                  {metrics.reductionPct != null ? `${metrics.reductionPct}%` : '—'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--abb-ink-2)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Alarm Reduction Rate
                </div>
                <div style={{ fontSize: 9, color: 'var(--abb-ink-3)', marginTop: 2 }}>
                  Ratio of raw gateway alarms vs. dispatched actions
                </div>
              </div>

              {/* Early Catch Lead Time */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div className="abb-data" style={{ fontSize: 24, fontWeight: 600, color: 'var(--abb-ink-0)' }}>
                  {metrics.avgLeadSeconds != null ? `${metrics.avgLeadSeconds.toFixed(1)}s` : '—'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--abb-ink-2)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Early Catch Lead Time
                </div>
                <div style={{ fontSize: 9, color: 'var(--abb-ink-3)', marginTop: 2 }}>
                  Average interval between predictive flag and static trip
                </div>
              </div>

              {/* ML Corroboration Rate */}
              <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14 }}>
                <div className="abb-data" style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--abb-ink-0)' }}>
                    {metrics.corroborationRate != null ? `${metrics.corroborationRate}%` : '—'}
                  </span>
                  {metrics.corroboratedEarly > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--abb-ink-3)' }}>
                      ({metrics.corroboratedEarly} corroborated)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--abb-ink-2)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  ML Corroboration Rate
                </div>
                <div style={{ fontSize: 9, color: 'var(--abb-ink-3)', marginTop: 2 }}>
                  Agreement rate of predictive alerts with ML models
                </div>
              </div>

            </div>
          </Panel>

          {/* 6 — ARIA HELPER (docked, zone-scoped, canned with swap-seam) */}
          <AriaPanel zone={zoneLetter} />
        </div>
      </div>
    </div>
  );
}

// Route guard: this is the Field Manager / zone console. Only a field_manager
// renders it; others are redirected (no token -> /login, wrong role -> their own
// dashboard). Server-side scoping still enforces; this is defense in depth.
export default function EngineerPage() {
  return (
    <RoleGuard role="field_manager">
      <FieldManagerConsole />
    </RoleGuard>
  );
}
