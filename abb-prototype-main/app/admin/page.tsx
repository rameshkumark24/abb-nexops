'use client';

import { NavBar, Dot, Panel, Badge, MicroLabel, RISK_TOKEN, STATE_TOKEN, type BadgeVariant } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import { useLiveData } from '@/hooks/useLiveData';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import React, { useEffect, useState } from 'react';
import { getEngineers, createEngineer, deactivateEngineer, activateEngineer, deleteEngineer, type Engineer } from '@/lib/tasksApi';
import { Field, Button } from '@/components/Shared';
import type { Machine } from '@/types/telemetry';

// The four plant zones the adapter assigns machines to (machine.zone === 'Zone X').
const ZONES = ['Zone A', 'Zone B', 'Zone C', 'Zone D'] as const;

// mm:ss formatter for lead-time seconds (display only — metrics math unchanged).
const fmtLead = (totalSeconds: number): string => {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// NexOps risk -> badge variant (LOW quiet grey / MEDIUM amber / HIGH orange /
// CRITICAL red). Red reserved for CRITICAL only.
const RISK_BADGE: Record<string, BadgeVariant> = {
  LOW: 'nominal',
  MEDIUM: 'warning',
  HIGH: 'high',
  CRITICAL: 'alarm',
};

// A machine's accent token: critical=red, else early=indigo, else by risk.
function accentFor(m: Machine): string {
  if (m.nexopsRisk === 'CRITICAL') return STATE_TOKEN.critical;
  if (m.isEarly) return STATE_TOKEN.early;
  return RISK_TOKEN[m.nexopsRisk] ?? STATE_TOKEN.nominal;
}

function AdminConsole() {
  // Single live seam — all-zones machine state, the site emergency, and the
  // session metrics. (Plant manager is unscoped: sees the WHOLE plant.)
  const { machines, siteAlert, metrics } = useLiveData();
  const { logout } = useAuth();

  // Workforce state (Stage 3d) — fetch via token-attached helpers in lib/tasksApi
  const [engineers, setEngineers] = useState<Engineer[] | null>(null);
  const [wfLoading, setWfLoading] = useState(false);

  const fetchEngineers = async () => {
    setWfLoading(true);
    const res = await getEngineers();
    if (res.ok) setEngineers(res.data);
    else setEngineers([]);
    setWfLoading(false);
  };

  useEffect(() => {
    // fetch once on mount
    fetchEngineers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time rolling anomaly history for the site-wide analytics trend chart
  const [anomalyHistory, setAnomalyHistory] = useState<number[]>(Array(24).fill(0.12));
  useEffect(() => {
    if (machines.length === 0) return;
    const total = machines.reduce((acc, m) => acc + (m.anomalyScore ?? 0), 0);
    const avg = total / machines.length;
    setAnomalyHistory((prev) => [...prev.slice(1), avg]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines]);

  // Toggle active/inactive
  const toggleActive = async (id: number, currentlyActive: boolean) => {
    setWfLoading(true);
    const res = currentlyActive ? await deactivateEngineer(id) : await activateEngineer(id);
    if (res.ok) {
      await fetchEngineers();
    } else {
      // no crash: console log and keep existing list
      // caller UI surfaces errors inline where relevant
      // eslint-disable-next-line no-console
      console.warn('workforce toggle failed', res.error);
    }
    setWfLoading(false);
  };

  // Hard-delete an engineer permanently from the DB
  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Permanently remove "${name}" from the system?\n\nThis will delete all their data and assignment history. This action cannot be undone.\n\nUse DEACTIVATE instead if the absence is temporary.`)) return;
    setWfLoading(true);
    const res = await deleteEngineer(id);
    if (res.ok) {
      await fetchEngineers();
    } else {
      console.warn('workforce delete failed', res.error);
    }
    setWfLoading(false);
  };

  // EngineersRoster and AddTechnicianForm are defined OUTSIDE AdminConsole
  // (below) so React does NOT re-create them on every live-data render tick.
  // See EngineersRoster / AddTechnicianForm definitions after AdminConsole.

  // ---- Real headline counts, derived from the live machine state ----------
  const total = machines.length;
  const criticals = machines.filter((m) => m.nexopsRisk === 'CRITICAL').length;
  const earlyCount = machines.filter((m) => m.isEarly).length;
  const activeAlarms = machines.filter((m) => m.perf < 80).length; // at-risk line
  const avgPerf = total ? Math.round(machines.reduce((a, m) => a + m.perf, 0) / total) : null;
  const dispatched = new Set(
    machines.filter((m) => m.assignedEngineer && m.assignedEngineer !== 'Unassigned').map((m) => m.assignedEngineer),
  ).size;

  // ---- Per-zone rollup, grouped by machine zone ---------------------------
  const zoneRollup = ZONES.map((z) => {
    const inZone = machines.filter((m) => m.zone === z);
    const sorted = [...inZone].sort((a, b) => a.perf - b.perf);
    return {
      zone: z,
      label: z.toUpperCase(),
      count: inZone.length,
      criticals: inZone.filter((m) => m.nexopsRisk === 'CRITICAL').length,
      alarms: inZone.filter((m) => m.perf < 80).length,
      early: inZone.filter((m) => m.isEarly).length,
      worst: sorted[0] ?? null,
      best: sorted[sorted.length - 1] ?? null,
    };
  });

  // ---- Risk distribution for the analytics charts -----------------------
  const riskDist = {
    LOW: machines.filter((m) => m.nexopsRisk === 'LOW').length,
    MEDIUM: machines.filter((m) => m.nexopsRisk === 'MEDIUM').length,
    HIGH: machines.filter((m) => m.nexopsRisk === 'HIGH').length,
    CRITICAL: machines.filter((m) => m.nexopsRisk === 'CRITICAL').length,
  };
  const riskTotal = riskDist.LOW + riskDist.MEDIUM + riskDist.HIGH + riskDist.CRITICAL || 1;

  // Headline strip cells — every value is REAL/derived (or '—' before stream).
  const stat = (v: number | null, unit = '') => (v == null ? '—' : `${v}${unit}`);
  const STRIP: { value: string; label: string; tone?: string }[] = [
    { value: stat(total), label: 'MACHINES LIVE' },
    { value: stat(avgPerf, '%'), label: 'AVG PERFORMANCE' },
    { value: stat(activeAlarms), label: 'ACTIVE ALARMS', tone: activeAlarms > 0 ? STATE_TOKEN.warning : undefined },
    { value: stat(criticals), label: 'CRITICAL', tone: criticals > 0 ? STATE_TOKEN.critical : undefined },
    { value: stat(earlyCount), label: 'EARLY CATCHES', tone: earlyCount > 0 ? STATE_TOKEN.early : undefined },
    { value: stat(dispatched), label: 'ENGINEERS DISPATCHED' },
  ];

  const sectionLabel = (t: string) => <MicroLabel style={{ marginBottom: 16 }}>{t}</MicroLabel>;

  return (
    <div className="abb-page fade-in-up" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* 2 — SITE EMERGENCY BANNER (red only when a real site alert is live) */}
      <SiteAlertBanner alert={siteAlert} />

      {/* 7 — NavBar with logout (wiring unchanged) */}
      <NavBar onBack={() => (window.location.href = '/')} onLogout={logout} />

      <div className="abb-shell" style={{ paddingTop: 'clamp(28px,4vw,40px)', paddingBottom: 56, display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(24px,3vw,32px)', fontWeight: 800, color: 'var(--abb-ink-0)', letterSpacing: '-0.02em', textTransform: 'uppercase', marginBottom: 6 }}>
              Plant Manager <span style={{ color: 'var(--abb-red)' }}>— All Zones</span>
            </h1>
            <p style={{ fontSize: 13, color: 'var(--abb-ink-2)' }}>Site-wide live machine health, zone rollup, and prediction metrics.</p>
          </div>
          <div className="abb-data" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.08em' }}>
            <Dot color={metrics.samples > 0 ? STATE_TOKEN.nominal : 'var(--abb-ink-3)'} size={6} cls={metrics.samples > 0 ? '' : 'pulse'} />
            {metrics.samples > 0 ? `${metrics.samples} LIVE FRAMES` : 'AWAITING STREAM'}
          </div>
        </div>

        {/* 3 — PLANT OVERVIEW STRIP (real derived counts) */}
        <Panel className="section-enter" style={{ padding: 22, borderTop: '3px solid var(--abb-red)', animationDelay: '0.1s' }}>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {STRIP.map((s) => (
              <div key={s.label}>
                <div className="abb-data" style={{ fontSize: 32, fontWeight: 700, color: s.tone ?? 'var(--abb-ink-0)', letterSpacing: '-0.02em' }}>
                  {s.value}
                </div>
                <MicroLabel style={{ marginTop: 4 }}>{s.label}</MicroLabel>
              </div>
            ))}
          </div>
        </Panel>

        {/* 4 — LIVE MACHINE ANALYTICS (all zones) */}
        <Panel className="section-enter" style={{ padding: 22, borderTop: '3px solid var(--abb-red)', animationDelay: '0.2s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <MicroLabel>LIVE MACHINE ANALYTICS · ALL ZONES</MicroLabel>
            <div className="abb-data" style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.nominal} size={6} cls="" />NOMINAL</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.warning} size={6} cls="" />WARNING</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.early} size={6} cls="" />EARLY</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Dot color={STATE_TOKEN.critical} size={6} cls="" />CRITICAL</span>
            </div>
          </div>

          {total === 0 ? (
            <div className="abb-data" style={{ padding: '28px 0', textAlign: 'center', fontSize: 12, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
              AWAITING LIVE STREAM…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 380, overflowY: 'auto', paddingRight: 6 }}>
              {machines.map((m, i) => {
                const accent = accentFor(m);
                const isCrit = m.nexopsRisk === 'CRITICAL';
                return (
                  <div
                    key={`${m.name}-${i}`}
                    style={{
                      padding: '11px 14px',
                      background: isCrit ? 'var(--abb-alarm-soft)' : 'var(--abb-surface-1)',
                      border: `1px solid ${isCrit ? 'var(--abb-alarm-line)' : 'var(--abb-line-faint)'}`,
                      borderLeft: `3px solid ${accent}`,
                      borderRadius: 'var(--abb-radius-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <Dot color={accent} size={7} cls={isCrit ? 'pulse-fast' : ''} />
                        <span className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-0)', fontWeight: 600 }}>{m.name}</span>
                        <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>{m.zone.toUpperCase()}</span>
                        {m.isEarly && <Badge variant="early" title={m.reasoning}>⚠ EARLY</Badge>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {m.anomalyScore != null && (
                          <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>a={m.anomalyScore.toFixed(2)}</span>
                        )}
                        <Badge variant={RISK_BADGE[m.nexopsRisk] ?? 'nominal'} title={m.reasoning}>NEXOPS {m.nexopsRisk}</Badge>
                        <span className="abb-data" style={{ fontSize: 13, color: accent, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>{m.perf}%</span>
                      </div>
                    </div>
                    {/* Perf bar — fill coloured by state accent */}
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

        {/* 5 — ZONE ROLLUP (per-zone summary, grouped by machine zone) */}
        <Panel className="section-enter" style={{ padding: 22, animationDelay: '0.3s' }}>
          {sectionLabel('ZONE ROLLUP · A / B / C / D')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {zoneRollup.map((z) => (
              <div key={z.zone} style={{ border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14, background: 'var(--abb-surface-1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span className="abb-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--abb-ink-0)', letterSpacing: '0.04em' }}>{z.label}</span>
                  <span className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-2)' }}>{z.count} <span style={{ color: 'var(--abb-ink-3)', fontSize: 9 }}>MACHINES</span></span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, minHeight: 18 }}>
                  {z.criticals > 0 && <Badge variant="alarm">{z.criticals} CRIT</Badge>}
                  {z.alarms > 0 && <Badge variant="warning">{z.alarms} ALARM</Badge>}
                  {z.early > 0 && <Badge variant="early">{z.early} EARLY</Badge>}
                  {z.criticals === 0 && z.alarms === 0 && z.early === 0 && z.count > 0 && <Badge variant="nominal">NOMINAL</Badge>}
                  {z.count === 0 && <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>AWAITING…</span>}
                </div>
                {z.worst && (
                  <div className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-2)', lineHeight: 1.7 }}>
                    <div>WORST <span style={{ color: accentFor(z.worst), fontWeight: 600 }}>{z.worst.name} {z.worst.perf}%</span></div>
                    {z.best && z.best !== z.worst && (
                      <div style={{ color: 'var(--abb-ink-3)' }}>BEST {z.best.name} {z.best.perf}%</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        {/* 5a — ADVANCED ANALYTICS — CHARTS & GRAPHS */}
        <Panel className="section-enter" style={{ padding: 22, animationDelay: '0.4s' }}>
          {sectionLabel('ADVANCED ANALYTICS — CONTROL SYSTEM PERFORMANCE')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>

            {/* ── Chart 1: Site-Wide Anomaly Trend ── */}
            <div style={{
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              borderRadius: 'var(--abb-radius-sm)',
              padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Site-Wide Anomaly Trend
                </span>
                <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>Live · All Zones</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 64, position: 'relative' }}>
                  <svg width="100%" height="100%" viewBox="0 0 400 64" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                    {/* Threshold line */}
                    <line x1="0" y1="14" x2="400" y2="14" stroke="rgba(193, 18, 31, 0.2)" strokeDasharray="3,3" />
                    <line x1="0" y1="38" x2="400" y2="38" stroke="rgba(255, 255, 255, 0.04)" strokeDasharray="2,2" />
                    {/* Shaded area */}
                    <polygon
                      points={`0,64 ${anomalyHistory.map((val, idx) => `${(idx / (anomalyHistory.length - 1)) * 400},${64 - (val * 56)}`).join(' ')} 400,64`}
                      fill="var(--abb-early)"
                      opacity={0.12}
                    />
                    {/* Trend line */}
                    <polyline
                      points={anomalyHistory.map((val, idx) => `${(idx / (anomalyHistory.length - 1)) * 400},${64 - (val * 56)}`).join(' ')}
                      fill="none"
                      stroke="var(--abb-early)"
                      strokeWidth={1.8}
                    />
                    {/* Current value dot */}
                    <circle cx={400} cy={64 - (anomalyHistory[anomalyHistory.length - 1] * 56)} r={3} fill="var(--abb-early)" />
                  </svg>
                </div>
                <div style={{ textAlign: 'right', minWidth: 54 }}>
                  <div className="abb-data" style={{ fontSize: 22, fontWeight: 700, color: anomalyHistory[anomalyHistory.length - 1] > 0.45 ? 'var(--abb-warning)' : 'var(--abb-nominal)' }}>
                    {anomalyHistory[anomalyHistory.length - 1].toFixed(2)}
                  </div>
                  <div style={{ fontSize: 8, color: 'var(--abb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Avg Score</div>
                </div>
              </div>
            </div>

            {/* ── Chart 2: Risk Level Distribution ── */}
            <div style={{
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              borderRadius: 'var(--abb-radius-sm)',
              padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Risk Level Distribution
                </span>
                <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>{total} machines</span>
              </div>
              {/* Segmented risk bar */}
              <div style={{ height: 18, borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 12, background: 'var(--abb-surface-3)' }}>
                {riskDist.LOW > 0 && <div style={{ width: `${(riskDist.LOW / riskTotal) * 100}%`, background: STATE_TOKEN.nominal, transition: 'width 0.6s ease' }} />}
                {riskDist.MEDIUM > 0 && <div style={{ width: `${(riskDist.MEDIUM / riskTotal) * 100}%`, background: STATE_TOKEN.warning, transition: 'width 0.6s ease' }} />}
                {riskDist.HIGH > 0 && <div style={{ width: `${(riskDist.HIGH / riskTotal) * 100}%`, background: '#f97316', transition: 'width 0.6s ease' }} />}
                {riskDist.CRITICAL > 0 && <div style={{ width: `${(riskDist.CRITICAL / riskTotal) * 100}%`, background: STATE_TOKEN.critical, transition: 'width 0.6s ease' }} />}
              </div>
              {/* Legend row */}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {[
                  { label: 'LOW', count: riskDist.LOW, color: STATE_TOKEN.nominal },
                  { label: 'MEDIUM', count: riskDist.MEDIUM, color: STATE_TOKEN.warning },
                  { label: 'HIGH', count: riskDist.HIGH, color: '#f97316' },
                  { label: 'CRITICAL', count: riskDist.CRITICAL, color: STATE_TOKEN.critical },
                ].map((r) => (
                  <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Dot color={r.color} size={6} cls="" />
                    <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-2)', letterSpacing: '0.04em' }}>
                      {r.label} <span style={{ fontWeight: 700, color: r.count > 0 ? r.color : 'var(--abb-ink-3)' }}>{r.count}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Chart 3: Zone Performance Comparison (full-width) ── */}
            <div style={{
              gridColumn: '1 / -1',
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              borderRadius: 'var(--abb-radius-sm)',
              padding: 16,
            }}>
              <div style={{ marginBottom: 12 }}>
                <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Zone Performance Comparison
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {zoneRollup.map((z) => {
                  const inZone = machines.filter((m) => m.zone === z.zone);
                  const avgP = inZone.length ? Math.round(inZone.reduce((a, m) => a + m.perf, 0) / inZone.length) : 0;
                  const barColor = avgP >= 90 ? STATE_TOKEN.nominal : avgP >= 70 ? STATE_TOKEN.warning : avgP >= 50 ? '#f97316' : STATE_TOKEN.critical;
                  return (
                    <div key={z.zone} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="abb-data" style={{ fontSize: 10, fontWeight: 700, color: 'var(--abb-ink-1)', width: 52, letterSpacing: '0.04em' }}>
                        {z.label}
                      </span>
                      <div style={{ flex: 1, height: 12, background: 'var(--abb-surface-3)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ width: `${avgP}%`, height: '100%', background: barColor, borderRadius: 6, transition: 'width 0.5s ease' }} />
                      </div>
                      <span className="abb-data" style={{ fontSize: 12, fontWeight: 700, color: barColor, width: 38, textAlign: 'right' }}>
                        {avgP}%
                      </span>
                      <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', width: 80 }}>
                        {z.count} machines
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Chart 4: Alarm Pipeline Analysis ── */}
            <div style={{
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              borderRadius: 'var(--abb-radius-sm)',
              padding: 16,
            }}>
              <div style={{ marginBottom: 12 }}>
                <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Alarm Pipeline · 10 min Window
                </span>
              </div>
              {(() => {
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
                          <div style={{ width: `${(bar.val / maxVal) * 100}%`, height: '100%', background: bar.color, borderRadius: 5, transition: 'width 0.5s ease', opacity: 0.7 }} />
                        </div>
                      </div>
                    ))}
                    {metrics.reductionPct != null && (
                      <div className="abb-data" style={{ fontSize: 9, color: metrics.reductionPct > 30 ? '#22c55e' : 'var(--abb-ink-3)', textAlign: 'right', marginTop: 2, fontWeight: 600 }}>
                        ▸ {metrics.reductionPct}% alarm reduction rate
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* ── Chart 5: Early Detection Lead Times ── */}
            <div style={{
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              borderRadius: 'var(--abb-radius-sm)',
              padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  Lead Time Distribution
                </span>
                {metrics.avgLeadSeconds != null && (
                  <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-warning)' }}>
                    avg {fmtLead(metrics.avgLeadSeconds)}
                  </span>
                )}
              </div>
              {metrics.leadRing.length === 0 ? (
                <div className="abb-data" style={{ padding: '16px 0', textAlign: 'center', fontSize: 10, color: 'var(--abb-ink-3)', letterSpacing: '0.04em' }}>
                  Collecting lead time data…
                </div>
              ) : (
                <div style={{ height: 64 }}>
                  <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(metrics.leadRing.length * 18, 36)} 64`} preserveAspectRatio="none" style={{ display: 'block' }}>
                    {(() => {
                      const maxLead = Math.max(...metrics.leadRing, 1);
                      return metrics.leadRing.map((lead, idx) => {
                        const h = (lead / maxLead) * 54;
                        const barColor = lead > (metrics.avgLeadSeconds ?? 0) ? 'var(--abb-warning)' : 'var(--abb-nominal)';
                        return (
                          <rect key={idx} x={idx * 18 + 2} y={64 - h} width={14} height={h} rx={2} fill={barColor} opacity={0.65} />
                        );
                      });
                    })()}
                  </svg>
                </div>
              )}
              {metrics.leadRing.length > 0 && metrics.maxLeadSeconds != null && (
                <div className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', textAlign: 'right', marginTop: 4 }}>
                  best {fmtLead(metrics.maxLeadSeconds)} · {metrics.completedLeads} resolved
                </div>
              )}
            </div>

          </div>
        </Panel>

        {/* 6 — LIVE METRICS PANEL (restyled to tokens; computation UNCHANGED) */}
        <Panel className="section-enter" style={{ padding: 22, animationDelay: '0.5s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
            <MicroLabel>PREDICTION &amp; SEGREGATION — LIVE METRICS</MicroLabel>
            <div className="abb-data" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.08em' }}>
              <Dot color={metrics.samples > 0 ? STATE_TOKEN.nominal : 'var(--abb-ink-3)'} size={6} cls={metrics.samples > 0 ? '' : 'pulse'} />
              {metrics.samples > 0 ? `${metrics.samples} LIVE FRAMES` : 'AWAITING STREAM'}
            </div>
          </div>

          {/* Headline: average lead time over the static gateway */}
          {metrics.avgLeadSeconds != null ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <div className="abb-data" style={{ fontSize: 40, fontWeight: 600, color: 'var(--abb-warning)' }}>⏱ {fmtLead(metrics.avgLeadSeconds)}</div>
              <div className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-2)', letterSpacing: '0.04em' }}>
                avg early warning over static gateway
                {metrics.maxLeadSeconds != null ? ` · best ${fmtLead(metrics.maxLeadSeconds)}` : ''}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div className="abb-data" style={{ fontSize: 18, fontWeight: 400, color: 'var(--abb-ink-2)' }}>⏱ Collecting live metrics…</div>
              <div className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)', letterSpacing: '0.04em' }}>
                {metrics.openEarly > 0 ? `${metrics.openEarly} fault(s) flagged EARLY — awaiting static trip` : 'awaiting first early-vs-gateway lead'}
              </div>
            </div>
          )}

          {/* Sub-stats: caught early · nuisance filtered · alarm reduction · corroboration */}
          <div style={{ display: 'flex', gap: 40, marginTop: 22, flexWrap: 'wrap' }}>
            <div>
              <div className="abb-data" style={{ fontSize: 22, fontWeight: 600, color: 'var(--abb-ink-0)' }}>{metrics.samples > 0 ? metrics.earlyCatches : '—'}</div>
              <MicroLabel style={{ marginTop: 4 }}>
                {metrics.samples > 0 ? `caught early${metrics.openEarly > 0 ? ` · ${metrics.openEarly} still early` : ''}` : 'Collecting…'}
              </MicroLabel>
            </div>
            <div>
              <div className="abb-data" style={{ fontSize: 22, fontWeight: 600, color: 'var(--abb-ink-0)' }}>{metrics.samples > 0 ? metrics.nuisanceFiltered : '—'}</div>
              <MicroLabel style={{ marginTop: 4 }}>{metrics.samples > 0 ? 'nuisance filtered · 0 queued' : 'Collecting…'}</MicroLabel>
            </div>
            <div>
              <div className="abb-data" style={{ fontSize: 22, fontWeight: 600, color: metrics.reductionPct != null ? 'var(--abb-ink-0)' : 'var(--abb-ink-2)' }}>
                {metrics.reductionPct != null ? `${metrics.reductionPct}%` : '—'}
              </div>
              <MicroLabel style={{ marginTop: 4 }}>
                {metrics.reductionPct != null ? `alarm reduction · ${metrics.rawAlarms10m}→${metrics.actionableAlarms10m}/10m` : 'Collecting…'}
              </MicroLabel>
            </div>
            <div>
              <div className="abb-data" style={{ fontSize: 22, fontWeight: 600, color: 'var(--abb-ink-0)' }}>
                {metrics.earlyCatches === 0 ? '—' : metrics.anomalyWarming ? 'collecting' : `${metrics.corroborationRate}%`}
              </div>
              <MicroLabel style={{ marginTop: 4 }}>
                {metrics.earlyCatches === 0 ? 'Collecting…' : metrics.anomalyWarming ? 'corroboration — model warming up' : 'detection corroboration (heuristic + ML)'}
              </MicroLabel>
            </div>
          </div>

          {/* Honest methodology footnote */}
          <div className="abb-data" style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--abb-line-faint)', fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.04em', lineHeight: 1.6 }}>
            Lead time measured vs the static gateway on the same events; corroboration = independent ML agreement. No grading against synthetic labels.
          </div>
        </Panel>

        {/* 7 — WORKFORCE (engineers & technicians) — moved after analytics */}
        <Panel className="section-enter" style={{ padding: 22, borderTop: '3px solid var(--abb-red)', animationDelay: '0.6s' }}>
          {sectionLabel('WORKFORCE · ENGINEERS & TECHNICIANS')}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 420px', minWidth: 320 }}>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-3)', marginBottom: 8 }}>ROSTER</div>
              <EngineersRoster engineers={engineers} wfLoading={wfLoading} onToggle={toggleActive} onDelete={handleDelete} />
            </div>

            <div style={{ width: 360, minWidth: 260 }}>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-3)', marginBottom: 8 }}>ADD TECHNICIAN</div>
              <AddTechnicianForm onCreated={fetchEngineers} />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// EngineersRoster — standalone component (no re-mount on parent re-render).
// Search by name, filter by zone and active/inactive status.
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
  const [filterRole, setFilterRole] = useState<string>('ALL'); // ALL | ACTIVE | INACTIVE

  if (wfLoading && engineers == null) {
    return <div className="abb-data" style={{ padding: 12 }}>Loading…</div>;
  }
  const raw = engineers ?? [];

  // Apply filters
  const list = raw.filter((e) => {
    // Name search (case insensitive)
    if (searchTerm && !e.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    // Zone filter
    if (filterZone !== 'ALL' && e.zone !== filterZone) return false;
    // Active status filter
    if (filterRole === 'ACTIVE' && !e.active) return false;
    if (filterRole === 'INACTIVE' && e.active) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Search & Filter Bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Name search */}
        <label style={{ display: 'block', flex: '1 1 160px', minWidth: 140 }}>
          <span className="abb-micro" style={{ display: 'block', marginBottom: 5 }}>Search by Name</span>
          <input
            className="abb-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.currentTarget.value)}
            placeholder="Type a name…"
            style={{ padding: '8px 10px', fontSize: 12 }}
          />
        </label>
        {/* Zone filter */}
        <label style={{ display: 'block', flex: '0 1 120px', minWidth: 100 }}>
          <span className="abb-micro" style={{ display: 'block', marginBottom: 5 }}>Zone</span>
          <select
            className="abb-input"
            value={filterZone}
            onChange={(e) => setFilterZone(e.currentTarget.value)}
            style={{ padding: '8px 10px', fontSize: 12 }}
          >
            <option value="ALL">All Zones</option>
            <option value="A">Zone A</option>
            <option value="B">Zone B</option>
            <option value="C">Zone C</option>
            <option value="D">Zone D</option>
          </select>
        </label>
        {/* Role / status filter */}
        <label style={{ display: 'block', flex: '0 1 120px', minWidth: 100 }}>
          <span className="abb-micro" style={{ display: 'block', marginBottom: 5 }}>Status</span>
          <select
            className="abb-input"
            value={filterRole}
            onChange={(e) => setFilterRole(e.currentTarget.value)}
            style={{ padding: '8px 10px', fontSize: 12 }}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
      </div>

      {/* Result count */}
      <div className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)', letterSpacing: '0.04em' }}>
        {list.length} of {raw.length} engineer{raw.length !== 1 ? 's' : ''}
        {(searchTerm || filterZone !== 'ALL' || filterRole !== 'ALL') ? ' (filtered)' : ''}
      </div>

      {/* List */}
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
// AddTechnicianForm — standalone component so live-data ticks don't wipe
// input state. Calls createEngineer and notifies parent to refresh roster.
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
    // refresh roster
    await onCreated();
    // clear success after short delay
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
        <input className="abb-input" value={skills} onChange={(e) => setSkills(e.currentTarget.value)} placeholder="mechanical, electrical" />
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

// Route guard: only a plant_manager renders the plant dashboard; anyone else is
// redirected (no token -> /login, wrong role -> their own dashboard). The server
// still enforces scoping — this is client-side defense in depth.
export default function AdminPage() {
  return (
    <RoleGuard role="plant_manager">
      <AdminConsole />
    </RoleGuard>
  );
}
