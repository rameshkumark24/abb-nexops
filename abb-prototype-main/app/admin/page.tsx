'use client';

import { NavBar, Dot, Panel, Badge, MicroLabel, RISK_TOKEN, STATE_TOKEN, type BadgeVariant } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import { useLiveData } from '@/hooks/useLiveData';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import React, { useEffect, useState } from 'react';
import { getEngineers, createEngineer, deactivateEngineer, activateEngineer, type Engineer } from '@/lib/tasksApi';
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

  // Add technician form handler lives in nested component below; it calls
  // createEngineer() and then calls fetchEngineers() on success.
  function EngineersRoster() {
    if (wfLoading && engineers == null) {
      return <div className="abb-data" style={{ padding: 12 }}>Loading…</div>;
    }
    const list = engineers ?? [];
    if (list.length === 0) {
      return <div className="abb-data" style={{ padding: 12, color: 'var(--abb-ink-3)' }}>No engineers found.</div>;
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 6 }}>
        {list.map((e) => (
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: 10, borderRadius: 'var(--abb-radius-sm)', background: e.active ? 'var(--abb-surface-1)' : 'var(--abb-nuisance-soft)', border: '1px solid var(--abb-line)', opacity: e.active ? 1 : 0.6 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--abb-ink-0)' }}>{e.name}</div>
              <div className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-3)' }}>{e.zone} · {e.skills.join(', ')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge variant={e.active ? 'nominal' : 'nuisance'}>{e.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
              <Button variant="ghost" onClick={() => toggleActive(e.id, e.active)}>{e.active ? 'DEACTIVATE' : 'ACTIVATE'}</Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function AddTechnicianForm() {
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
        zone,
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
      await fetchEngineers();
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

      <div className="abb-shell" style={{ paddingTop: 'clamp(28px,4vw,40px)', paddingBottom: 56, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(22px,3vw,28px)', fontWeight: 300, color: 'var(--abb-ink-0)', marginBottom: 6 }}>
              Plant Manager — All Zones
            </h1>
            <p style={{ fontSize: 13, color: 'var(--abb-ink-2)' }}>Site-wide live machine health, zone rollup, and prediction metrics.</p>
          </div>
          <div className="abb-data" style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.08em' }}>
            <Dot color={metrics.samples > 0 ? STATE_TOKEN.nominal : 'var(--abb-ink-3)'} size={6} cls={metrics.samples > 0 ? '' : 'pulse'} />
            {metrics.samples > 0 ? `${metrics.samples} LIVE FRAMES` : 'AWAITING STREAM'}
          </div>
        </div>

        {/* 3 — PLANT OVERVIEW STRIP (real derived counts) */}
        <Panel style={{ padding: 22 }}>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {STRIP.map((s) => (
              <div key={s.label}>
                <div className="abb-data" style={{ fontSize: 30, fontWeight: 600, color: s.tone ?? 'var(--abb-ink-0)', letterSpacing: '-0.01em' }}>
                  {s.value}
                </div>
                <MicroLabel style={{ marginTop: 4 }}>{s.label}</MicroLabel>
              </div>
            ))}
          </div>
        </Panel>

        {/* 4 — LIVE MACHINE ANALYTICS (all zones) */}
        <Panel style={{ padding: 22 }}>
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
        <Panel style={{ padding: 22 }}>
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

        {/* 5a — WORKFORCE (engineers & technicians) — Stage 3d UI */}
        <Panel style={{ padding: 22 }}>
          {sectionLabel('WORKFORCE · ENGINEERS & TECHNICIANS')}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 420px', minWidth: 320 }}>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-3)', marginBottom: 8 }}>ROSTER</div>
              <EngineersRoster />
            </div>

            <div style={{ width: 360, minWidth: 260 }}>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-3)', marginBottom: 8 }}>ADD TECHNICIAN</div>
              <AddTechnicianForm />
            </div>
          </div>
        </Panel>

        {/* 6 — LIVE METRICS PANEL (restyled to tokens; computation UNCHANGED) */}
        <Panel style={{ padding: 22 }}>
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
      </div>
    </div>
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
