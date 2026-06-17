'use client';

import { NavBar, Dot, Panel, Badge, MicroLabel, RISK_TOKEN, STATE_TOKEN, type BadgeVariant } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import AriaPanel from '@/components/AriaPanel';
import { useLiveData } from '@/hooks/useLiveData';
import { useTasks } from '@/hooks/useTasks';
import { useAuth, RoleGuard } from '@/context/AuthContext';
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

// A machine's accent token: critical=red, else early=indigo, else by risk.
function accentFor(m: Machine): string {
  if (m.nexopsRisk === 'CRITICAL') return STATE_TOKEN.critical;
  if (m.isEarly) return STATE_TOKEN.early;
  return RISK_TOKEN[m.nexopsRisk] ?? STATE_TOKEN.nominal;
}

function FieldManagerConsole() {
  // All-zones live feed (machines) + the site-wide emergency. We FILTER machines
  // to the field manager's OWN zone below (the server also scopes /tasks).
  const { machines, siteAlert } = useLiveData();
  // Zone-scoped task lifecycle: the /tasks endpoint already returns ONLY this
  // field_manager's zone (server-side scoping) — we just render it.
  const { tasks: zoneTasks, loading: tasksLoading } = useTasks();
  const { user, logout } = useAuth();

  const zoneLetter = user?.zone ?? '—';
  const zoneFull = user?.zone ? `Zone ${user.zone}` : null; // machine.zone is 'Zone X'
  const zoneMachines = zoneFull ? machines.filter((m) => m.zone === zoneFull) : [];

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

      <div className="abb-shell" style={{ paddingTop: 'clamp(28px,4vw,40px)', paddingBottom: 56, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 2 — ZONE HEADER + health summary */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(22px,3vw,28px)', fontWeight: 300, color: 'var(--abb-ink-0)', marginBottom: 6 }}>
              Zone {zoneLetter} — Field Manager
            </h1>
            <p className="abb-data" style={{ fontSize: 12, color: 'var(--abb-ink-2)' }}>
              FIELD MANAGER · {user?.username ?? '—'} · scoped to Zone {zoneLetter}
            </p>
          </div>
        </div>

        <Panel style={{ padding: 22 }}>
          <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {SUMMARY.map((s) => (
              <div key={s.label}>
                <div className="abb-data" style={{ fontSize: 30, fontWeight: 600, color: s.tone ?? 'var(--abb-ink-0)', letterSpacing: '-0.01em' }}>
                  {s.value}
                </div>
                <MicroLabel style={{ marginTop: 4 }}>{s.label}</MicroLabel>
              </div>
            ))}
          </div>
        </Panel>

        {/* 3 — ZONE MACHINE HEALTH (filtered to user.zone) */}
        <Panel style={{ padding: 22 }}>
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

        {/* 4 (team+tasks) + 5 (ARIA) — side by side on wide, stacked on narrow */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
          {/* 4 — ZONE FIELD TEAM + TASK ASSIGNMENTS (from zone-scoped useTasks) */}
          <Panel style={{ padding: 22 }}>
            <MicroLabel style={{ marginBottom: 16 }}>ZONE {zoneLetter} · FIELD TEAM &amp; TASKS</MicroLabel>
            {tasksLoading && teamRows.length === 0 ? (
              <div className="abb-data" style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>LOADING ZONE TASKS…</div>
            ) : teamRows.length === 0 ? (
              <div className="abb-data" style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>NO ACTIVE TASKS IN THIS ZONE</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {teamRows.map(([name, info]) => (
                  <div key={name} style={{ border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 14, background: 'var(--abb-surface-1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span className="abb-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--abb-ink-0)' }}>{name}</span>
                      {info.focus.size > 0 && (
                        <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', letterSpacing: '0.04em' }}>
                          FOCUS · {Array.from(info.focus).join(' · ')}
                        </span>
                      )}
                    </div>
                    {info.tasks.length === 0 ? (
                      <div className="abb-data" style={{ fontSize: 9.5, color: 'var(--abb-ink-3)' }}>dispatched to a zone machine · no lifecycle task open</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {info.tasks.map((t) => (
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
                ))}
              </div>
            )}
          </Panel>

          {/* 5 — ARIA HELPER (docked, zone-scoped, canned with swap-seam) */}
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
