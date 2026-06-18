'use client';

import { useEffect, useState } from 'react';
import { NavBar, Dot } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import { IconAlertTriangle, IconWrench } from '@/components/Icons';
import { useLiveData } from '@/hooks/useLiveData';
import { useTasks } from '@/hooks/useTasks';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import { fetchEngineerStats, getEngineers, type EngineerStats } from '@/lib/tasksApi';
import type { TaskStatus } from '@/types/telemetry';

// Visual configuration for each status
const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  assigned: { label: 'Assigned', color: 'var(--abb-warning, #f59e0b)' },
  in_progress: { label: 'In Progress', color: 'var(--abb-early, #4338ca)' },
  resolved: { label: 'Resolved', color: '#22c55e' },
};

function clockOf(iso: string | null): string {
  if (!iso) return '—';
  const t = iso.split('T')[1];
  return t ? t.slice(0, 8) : iso;
}

function getSeverityColor(t: { score?: number | null; fault_category?: string | null; status: string }): string {
  if (t.status === 'resolved') return '#10b981'; // Green
  if ((t.score != null && t.score >= 1.10) || t.fault_category === 'hydraulic') return '#ef4444'; // Red
  return '#f59e0b'; // Amber
}

function getSeverityLabel(t: { score?: number | null; fault_category?: string | null; status: string }): string {
  if (t.status === 'resolved') return 'Low';
  if ((t.score != null && t.score >= 1.10) || t.fault_category === 'hydraulic') return 'Critical';
  return 'Medium';
}

function TechnicianConsole() {
  const { user, logout } = useAuth();
  const { siteAlert } = useLiveData(user?.zone || undefined);
  const { tasks, loading, error, start, resolve } = useTasks();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [stats, setStats] = useState<EngineerStats | null>(null);
  const [active, setActive] = useState<boolean | null>(null);

  // Load engineer stats (resolved count, average resolution time) from the backend
  useEffect(() => {
    if (user && user.engineer_id != null) {
      fetchEngineerStats(user.engineer_id).then((res) => {
        if (res.ok) {
          setStats(res.data);
        }
      });
    }
  }, [user, tasks]);

  // Load engineer details to find active status
  useEffect(() => {
    if (user && user.engineer_id != null) {
      getEngineers().then((res) => {
        if (res.ok) {
          const selfEng = res.data.find((e) => e.id === user.engineer_id);
          if (selfEng) {
            setActive(selfEng.active);
          }
        }
      });
    }
  }, [user, tasks]);

  // Auto-dismiss confirmation banner
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

  const pill = (status: TaskStatus) => {
    const m = STATUS_META[status] ?? STATUS_META.assigned;
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: '11px',
          fontWeight: 600,
          color: m.color,
          border: `1px solid ${m.color}44`,
          background: `${m.color}0f`,
          padding: '4px 12px',
          borderRadius: '20px',
        }}
      >
        <Dot color={m.color} size={6} cls={status === 'assigned' ? 'pulse-fast' : 'pulse'} />
        {m.label}
      </span>
    );
  };

  let body: React.ReactNode;
  if (loading && tasks.length === 0) {
    body = (
      <div style={{ ...containerStyle, background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', textAlign: 'center', padding: '56px 36px', boxShadow: 'var(--abb-shadow-1)' }}>
        <div className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.1em' }}>
          LOADING ASSIGNED TASKS...
        </div>
      </div>
    );
  } else if (error && tasks.length === 0) {
    body = (
      <div style={{ ...containerStyle, background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', textAlign: 'center', padding: '56px 36px', boxShadow: 'var(--abb-shadow-1)' }}>
        <div
          style={{
            width: 64,
            height: 64,
            background: 'var(--abb-alarm-soft)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
            border: '1px solid var(--abb-alarm-line)',
          }}
        >
          <IconAlertTriangle size={28} color="var(--abb-alarm)" />
        </div>
        <h2 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 20, fontWeight: 800, color: 'var(--abb-ink-0)', textTransform: 'uppercase', marginBottom: 10 }}>
          Cannot reach task service
        </h2>
        <p style={{ color: 'var(--abb-ink-2)', fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          The NexOps task endpoint isn’t responding. The queue will refresh automatically once it’s back.
        </p>
      </div>
    );
  } else if (tasks.length === 0) {
    body = (
      <div
        className="glow-success"
        style={{ ...containerStyle, background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', textAlign: 'center', padding: '56px 36px', boxShadow: 'var(--abb-shadow-1)' }}
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
        <h2 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 22, fontWeight: 800, color: 'var(--abb-ink-0)', textTransform: 'uppercase', marginBottom: 10 }}>
          All Clear — No Open Tasks
        </h2>
        <p style={{ color: 'var(--abb-ink-2)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          You have no tasks assigned to you right now. New assignments will appear here automatically.
        </p>
      </div>
    );
  } else {
    body = (
      <div style={{ ...containerStyle, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {tasks.map((t) => {
          const busy = busyId === t.id;
          const sevColor = getSeverityColor(t);
          const sevLabel = getSeverityLabel(t);
          const isCritical = sevLabel === 'Critical';

          return (
            <div key={t.id} className={`fade-in-up ${isCritical ? 'glow-critical' : ''}`} style={{
              background: 'var(--abb-surface-1)',
              borderTop: `1px solid ${isCritical ? 'var(--abb-alarm-line)' : t.status === 'in_progress' ? 'var(--abb-early-line)' : 'var(--abb-line)'}`,
              borderRight: `1px solid ${isCritical ? 'var(--abb-alarm-line)' : t.status === 'in_progress' ? 'var(--abb-early-line)' : 'var(--abb-line)'}`,
              borderBottom: `1px solid ${isCritical ? 'var(--abb-alarm-line)' : t.status === 'in_progress' ? 'var(--abb-early-line)' : 'var(--abb-line)'}`,
              borderLeft: `3px solid ${sevColor}`,
              borderRadius: 'var(--abb-radius)',
              padding: '24px',
              boxShadow: 'var(--abb-shadow-1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              position: 'relative',
              overflow: 'hidden',
              transition: 'all 0.25s ease'
            }}>
              {/* Card Header & Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {pill(t.status)}
                    {t.zone && (
                      <span style={{
                        fontSize: '11px',
                        color: 'var(--abb-early)',
                        background: 'var(--abb-early-soft)',
                        border: '1px solid var(--abb-early-line)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 600
                      }}>
                        Zone {t.zone}
                      </span>
                    )}
                    <span style={{
                      fontSize: '11px',
                      color: sevColor,
                      background: `${sevColor}0f`,
                      border: `1px solid ${sevColor}44`,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 600
                    }}>
                      {sevLabel}
                    </span>
                  </div>
                  <h2 style={{ fontSize: '24px', fontWeight: 800, fontFamily: 'var(--abb-font-ui)', color: 'var(--abb-ink-0)', margin: '0 0 4px 0', letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
                    {t.machine ?? 'Unknown Unit'}
                  </h2>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {t.status === 'assigned' && (
                    <button 
                      onClick={() => handleStart(t.id)} 
                      disabled={busy} 
                      className="abb-btn abb-btn--primary"
                      style={{
                        padding: '10px 20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: busy ? 'default' : 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {busy ? 'Starting...' : 'START WORK'}
                    </button>
                  )}
                  {t.status === 'in_progress' && (
                    <button 
                      onClick={() => handleResolve(t.id)} 
                      disabled={busy} 
                      className="abb-btn"
                      style={{
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '10px 20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: busy ? 'default' : 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {busy ? 'Resolving...' : '✓ COMPLETE WORK'}
                    </button>
                  )}
                </div>
              </div>

              {/* Simplified Professional Instruction */}
              <div style={{
                fontSize: '13px',
                color: 'var(--abb-ink-1)',
                padding: '12px 16px',
                background: 'var(--abb-surface-2)',
                borderRadius: 'var(--abb-radius-sm)',
                borderLeft: `3px solid ${sevColor}`
              }}>
                <strong>Instruction:</strong> Go to the machine location and update task status above.
              </div>

              {/* Backend Data Surfaced (Clean Table Layout) */}
              <div>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--abb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                  Task Specifications
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '12px',
                  background: 'var(--abb-surface-2)',
                  border: '1px solid var(--abb-line)',
                  borderRadius: 'var(--abb-radius-sm)',
                  padding: '16px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Task ID</span>
                    <span className="abb-data" style={{ color: 'var(--abb-ink-0)', fontWeight: 600 }}>#{t.id}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Alarm ID</span>
                    <span className="abb-data" style={{ color: 'var(--abb-ink-0)', fontWeight: 600 }}>#{t.alarm_id ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Location Zone</span>
                    <span style={{ color: 'var(--abb-ink-0)', fontWeight: 600 }}>Zone {t.zone ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Classification</span>
                    <span style={{ color: 'var(--abb-ink-0)', fontWeight: 600, textTransform: 'capitalize' }}>{t.fault_category ?? 'general'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Dispatch Match Score</span>
                    <span className="abb-data" style={{ color: 'var(--abb-early)', fontWeight: 700 }}>{t.score != null ? t.score.toFixed(3) : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Assigned At</span>
                    <span className="abb-data" style={{ color: 'var(--abb-ink-0)' }}>{clockOf(t.assigned_at)}</span>
                  </div>
                  {t.started_at && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', paddingBottom: '6px', borderBottom: '1px solid var(--abb-line-faint)' }}>
                      <span style={{ color: 'var(--abb-ink-2)' }}>Work Started</span>
                      <span className="abb-data" style={{ color: 'var(--abb-ink-0)' }}>{clockOf(t.started_at)}</span>
                    </div>
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
    <div className="abb-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <NavBar onBack={() => (window.location.href = '/')} onLogout={logout} />
      <SiteAlertBanner alert={siteAlert} />

      <div className="fade-in-up" style={{ padding: '40px max(16px, 4vw)', flex: 1 }}>
        <div style={{ ...containerStyle }}>
          
          {/* Header & Stats Banner */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '32px',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <div>
              <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(24px,3vw,32px)', fontWeight: 800, color: 'var(--abb-ink-0)', letterSpacing: '-0.02em', textTransform: 'uppercase', margin: '0 0 6px 0' }}>
                Technician Console <span style={{ color: 'var(--abb-red)' }}>— My Tasks</span>
              </h1>
              <p style={{ color: 'var(--abb-ink-2)', fontSize: '13px', margin: 0 }}>
                Welcome back, <strong style={{ color: 'var(--abb-ink-0)' }}>{user ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : 'Operator'}</strong> • Status: <span style={{ color: active === false ? 'var(--abb-alarm)' : '#22c55e', fontWeight: 600 }}>{active === false ? 'Off Duty (Deactivated)' : 'On Duty'}</span> {user?.zone ? `• Zone ${user.zone}` : ''}
              </p>
            </div>

            {/* Backend-driven stats panels */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{
                background: 'var(--abb-surface-1)',
                border: '1px solid var(--abb-line)',
                borderRadius: 'var(--abb-radius-sm)',
                boxShadow: 'var(--abb-shadow-1)',
                padding: '10px 16px',
                textAlign: 'center',
                minWidth: '90px'
              }}>
                <div className="abb-data" style={{ fontSize: '18px', fontWeight: 700, color: '#f59e0b' }}>
                  {tasks.filter((t) => t.status === 'assigned').length}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>To Do</div>
              </div>
              <div style={{
                background: 'var(--abb-surface-1)',
                border: '1px solid var(--abb-line)',
                borderRadius: 'var(--abb-radius-sm)',
                boxShadow: 'var(--abb-shadow-1)',
                padding: '10px 16px',
                textAlign: 'center',
                minWidth: '90px'
              }}>
                <div className="abb-data" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--abb-early)' }}>
                  {tasks.filter((t) => t.status === 'in_progress').length}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Active</div>
              </div>
              {stats && (
                <>
                  <div style={{
                    background: 'var(--abb-surface-1)',
                    border: '1px solid var(--abb-line)',
                    borderRadius: 'var(--abb-radius-sm)',
                    boxShadow: 'var(--abb-shadow-1)',
                    padding: '10px 16px',
                    textAlign: 'center',
                    minWidth: '90px'
                  }}>
                    <div className="abb-data" style={{ fontSize: '18px', fontWeight: 700, color: '#22c55e' }}>
                      {stats.resolved_count}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Resolved</div>
                  </div>
                  {stats.avg_resolution_minutes != null && (
                    <div style={{
                      background: 'var(--abb-surface-1)',
                      border: '1px solid var(--abb-line)',
                      borderRadius: 'var(--abb-radius-sm)',
                      boxShadow: 'var(--abb-shadow-1)',
                      padding: '10px 16px',
                      textAlign: 'center',
                      minWidth: '90px'
                    }}>
                      <div className="abb-data" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--abb-early)' }}>
                        {stats.avg_resolution_minutes.toFixed(1)}m
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Avg Speed</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Confirmation banner */}
        {confirmation && (
          <div style={{ ...containerStyle, marginBottom: 18 }}>
            <div
              className="mono fade-in-up"
              style={{
                background: 'rgba(16,185,129,0.06)',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 'var(--abb-radius)',
                padding: '12px 16px',
                fontSize: 12,
                color: '#10b981',
                letterSpacing: '0.02em',
                fontWeight: 500
              }}
            >
              Task resolution completed: {confirmation}
            </div>
          </div>
        )}

        {/* Error notification */}
        {error && tasks.length > 0 && (
          <div style={{ ...containerStyle, marginBottom: 18 }}>
            <div
              className="mono"
              style={{
                background: 'rgba(245,158,11,0.06)',
                border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: 'var(--abb-radius)',
                padding: '12px 16px',
                fontSize: 12,
                color: '#f59e0b',
                letterSpacing: '0.02em',
                fontWeight: 500
              }}
            >
              Cannot reach task service — showing last known queue
            </div>
          </div>
        )}

        {body}
      </div>
    </div>
  );
}

export default function TechnicianPage() {
  return (
    <RoleGuard role="technician">
      <TechnicianConsole />
    </RoleGuard>
  );
}
