'use client';

import { useEffect, useState } from 'react';
import { NavBar, COLORS, Dot } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import { IconAlertTriangle, IconWrench } from '@/components/Icons';
import { useLiveData } from '@/hooks/useLiveData';
import { useTasks } from '@/hooks/useTasks';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import type { TaskStatus } from '@/types/telemetry';

// Visual treatment per lifecycle status (drives the small status pill).
const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  assigned: { label: 'ASSIGNED', color: '#f59e0b' },
  in_progress: { label: 'IN PROGRESS', color: '#3b82f6' },
  resolved: { label: 'RESOLVED', color: '#22c55e' },
};

// Extract the HH:MM:SS clock from an ISO timestamp without Date parsing, so
// there are no timezone surprises (shows exactly what the backend recorded).
function clockOf(iso: string | null): string {
  if (!iso) return '—';
  const t = iso.split('T')[1];
  return t ? t.slice(0, 8) : iso;
}

function TechnicianConsole() {
  // Same live seam as the other roles so the site-wide RED ZONE banner reaches
  // the technician too. The task QUEUE itself is driven by the HTTP lifecycle
  // endpoints via useTasks (separate from the WebSocket telemetry stream).
  const { siteAlert } = useLiveData();
  const { tasks, loading, error, start, resolve } = useTasks();
  const { logout } = useAuth();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Auto-dismiss the "capacity freed" confirmation after a few seconds.
  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 6000);
    return () => clearTimeout(t);
  }, [confirmation]);

  const handleStart = async (id: number) => {
    setBusyId(id);
    await start(id);
    setBusyId(null);
  };

  const handleResolve = async (id: number) => {
    setBusyId(id);
    const res = await resolve(id);
    setBusyId(null);
    if (res.ok) {
      const { resolution_minutes: mins, engineer_active_tasks: freed, engineer_name } = res.data;
      const who = engineer_name ?? 'engineer';
      const parts = [`Task #${id} resolved`];
      if (mins != null) parts.push(`${mins} min to resolve`);
      if (freed != null) parts.push(`${who} now at ${freed} active task(s) — capacity freed`);
      setConfirmation(parts.join('  ·  '));
    } else {
      setConfirmation(`Could not resolve task #${id}: ${res.error}`);
    }
  };

  const containerStyle = { maxWidth: 720, margin: '0 auto' } as const;

  const cardStyle = {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.borderFaint}`,
    borderRadius: 8,
    padding: 22,
  };

  const actionBtn = (variant: 'primary' | 'success', disabled: boolean) => ({
    background: variant === 'success' ? '#22c55e' : COLORS.textPrimary,
    color: '#0a0b0d',
    border: 'none',
    padding: '10px 18px',
    borderRadius: 6,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    letterSpacing: '0.06em',
    opacity: disabled ? 0.5 : 1,
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.2s ease',
  });

  const pill = (status: TaskStatus) => {
    const m = STATUS_META[status] ?? STATUS_META.assigned;
    return (
      <span
        className="mono"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 9,
          letterSpacing: '0.1em',
          color: m.color,
          border: `1px solid ${m.color}55`,
          background: `${m.color}14`,
          padding: '4px 10px',
          borderRadius: 999,
        }}
      >
        <Dot color={m.color} size={6} cls={status === 'assigned' ? 'pulse-fast' : 'pulse'} />
        {m.label}
      </span>
    );
  };

  // The main panel: loading -> error (no data) -> empty -> the live list.
  let body: React.ReactNode;
  if (loading && tasks.length === 0) {
    body = (
      <div style={{ ...containerStyle, ...cardStyle, textAlign: 'center', padding: '56px 36px' }}>
        <div className="mono" style={{ fontSize: 11, color: COLORS.textMuted, letterSpacing: '0.1em' }}>
          LOADING TASK QUEUE…
        </div>
      </div>
    );
  } else if (error && tasks.length === 0) {
    body = (
      <div style={{ ...containerStyle, ...cardStyle, textAlign: 'center', padding: '56px 36px' }}>
        <div
          style={{
            width: 64,
            height: 64,
            background: 'rgba(239,68,68,0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <IconAlertTriangle size={28} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 300, color: COLORS.textPrimary, marginBottom: 10 }}>
          Cannot reach task service
        </h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          The NexOps task endpoint isn’t responding. The queue will refresh automatically once it’s back.
        </p>
      </div>
    );
  } else if (tasks.length === 0) {
    body = (
      <div
        className="glow-success"
        style={{ ...containerStyle, ...cardStyle, textAlign: 'center', padding: '56px 36px' }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            background: 'rgba(34,197,94,0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
            border: '1px solid rgba(34,197,94,0.2)',
          }}
        >
          <IconWrench size={28} color="#22c55e" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 300, color: COLORS.textPrimary, marginBottom: 10 }}>
          No open tasks — all clear
        </h2>
        <p style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          Every assignment is resolved. New tasks appear here automatically as NexOps dispatches them.
        </p>
      </div>
    );
  } else {
    body = (
      <div style={{ ...containerStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {tasks.map((t) => {
          const busy = busyId === t.id;
          return (
            <div key={t.id} className="card-hover fade-in-up" style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 18,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    {pill(t.status)}
                    <span className="mono" style={{ fontSize: 10, color: COLORS.textFaint }}>
                      #{t.id} · {clockOf(t.assigned_at)}
                    </span>
                  </div>
                  <h2 style={{ fontSize: 18, fontWeight: 400, color: COLORS.textPrimary, margin: '0 0 6px' }}>
                    {t.machine ?? 'Unknown unit'}
                  </h2>
                  <div className="mono" style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>
                    FAULT · {(t.fault_category ?? 'uncategorized').toUpperCase()}
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: COLORS.textSec }}>
                    ENGINEER · {t.engineer_name ?? 'Unassigned'}
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {t.status === 'assigned' && (
                    <button onClick={() => handleStart(t.id)} disabled={busy} style={actionBtn('primary', busy)}>
                      {busy ? 'STARTING…' : 'START'}
                    </button>
                  )}
                  {t.status === 'in_progress' && (
                    <button onClick={() => handleResolve(t.id)} disabled={busy} style={actionBtn('success', busy)}>
                      {busy ? 'RESOLVING…' : '✓ MARK RESOLVED'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    // Keeps its own DARK body styling on the now-light root layout (UI-2). This
    // page is restyled to the light tokens in its own pass; the explicit dark
    // background here just prevents white-on-white until then.
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0b0d', color: '#e2e8f0' }}>
      <NavBar onBack={() => (window.location.href = '/')} onLogout={logout} />
      <SiteAlertBanner alert={siteAlert} />

      <div className="fade-in-up" style={{ padding: '40px 56px', flex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 300, color: COLORS.textPrimary, marginBottom: 8 }}>
            Technician Console
          </h1>
          <p style={{ color: COLORS.textMuted, fontSize: 13 }}>
            Live task queue — start and resolve assignments as NexOps dispatches them.
          </p>
        </div>

        {/* Resolve confirmation (capacity freed) — auto-dismisses. */}
        {confirmation && (
          <div style={{ ...containerStyle, marginBottom: 16 }}>
            <div
              className="mono fade-in-up"
              style={{
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 11,
                color: '#22c55e',
                letterSpacing: '0.04em',
              }}
            >
              ✓ {confirmation}
            </div>
          </div>
        )}

        {/* Backend unreachable but we still have a last-known queue: warn softly. */}
        {error && tasks.length > 0 && (
          <div style={{ ...containerStyle, marginBottom: 16 }}>
            <div
              className="mono"
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 11,
                color: '#f59e0b',
                letterSpacing: '0.04em',
              }}
            >
              ⚠ Cannot reach task service — showing last known queue
            </div>
          </div>
        )}

        {body}
      </div>
    </div>
  );
}

// Route guard: only a technician renders the technician console; others are
// redirected (no token -> /login, wrong role -> their own dashboard). The server
// still scopes /tasks to the technician's own assignments — this is defense in depth.
export default function TechnicianPage() {
  return (
    <RoleGuard role="technician">
      <TechnicianConsole />
    </RoleGuard>
  );
}
