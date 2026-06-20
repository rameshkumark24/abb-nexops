'use client';

import { useEffect, useRef, useState } from 'react';
import { NavBar, Dot } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import { IconAlertTriangle, IconWrench } from '@/components/Icons';
import { useLiveData } from '@/hooks/useLiveData';
import { useTasks } from '@/hooks/useTasks';
import { useAuth, RoleGuard } from '@/context/AuthContext';
import { fetchEngineerStats, getEngineers, askAria, type EngineerStats } from '@/lib/tasksApi';
import AriaPanel from '@/components/AriaPanel';
import type { TaskStatus } from '@/types/telemetry';

const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  assigned: { label: 'Assigned', color: 'var(--abb-warning)' },
  in_progress: { label: 'In Progress', color: 'var(--abb-early)' },
  resolved: { label: 'Resolved', color: 'var(--abb-nominal)' },
};

// 3B — classification-based left border colors (mirror chartPalette FAULT_COLORS)
const CLASS_COLOR: Record<string, string> = {
  mechanical: 'var(--abb-early)',
  electrical: '#7c3aed',
  thermal: 'var(--abb-warning)',
  general: 'var(--abb-ink-3)',
  hydraulic: '#0891b2',
};
function classColor(cat: string | null | undefined): string {
  return CLASS_COLOR[(cat ?? 'general').toLowerCase()] ?? '#9ca3af';
}

// 3A — chip visual config (token-based so they adapt to dark mode)
const CHIP_CONFIG: Record<string, { bg: string; border: string; label: string }> = {
  all: { bg: 'var(--abb-surface-2)', border: 'var(--abb-ink-2)', label: 'ALL' },
  mechanical: { bg: 'var(--abb-early-soft)', border: 'var(--abb-early)', label: 'MECHANICAL' },
  electrical: { bg: 'var(--abb-surface-2)', border: '#7c3aed', label: 'ELECTRICAL' },
  thermal: { bg: 'var(--abb-warning-soft)', border: 'var(--abb-warning)', label: 'THERMAL' },
  general: { bg: 'var(--abb-surface-2)', border: 'var(--abb-ink-3)', label: 'GENERAL' },
  hydraulic: { bg: 'var(--abb-surface-2)', border: '#0891b2', label: 'HYDRAULIC' },
};

// 3B — match score pill
function MatchPill({ score }: { score: number | null | undefined }) {
  if (score == null) return <span style={{ fontSize: 10, color: 'var(--abb-ink-3)' }}>—</span>;
  const isStrong = score >= 1.0;
  const isGood = score >= 0.6;
  const color = isStrong ? 'var(--abb-nominal)' : isGood ? 'var(--abb-warning)' : 'var(--abb-ink-2)';
  const bg    = isStrong ? 'var(--abb-nominal-soft)' : isGood ? 'var(--abb-warning-soft)' : 'var(--abb-surface-2)';
  const bdr   = isStrong ? 'var(--abb-line)'         : isGood ? 'var(--abb-warning-line)' : 'var(--abb-line)';
  const label = isStrong ? 'STRONG MATCH' : isGood ? 'GOOD MATCH' : 'PARTIAL';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color, padding: '2px 8px', border: `1px solid ${bdr}`, background: bg, borderRadius: 10 }}>
        {label}
      </span>
      <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>{score.toFixed(3)}</span>
    </span>
  );
}

function clockOf(iso: string | null): string {
  if (!iso) return '—';
  const t = iso.split('T')[1];
  return t ? t.slice(0, 8) : iso;
}

function TechnicianConsole() {
  const { user, logout } = useAuth();
  const { siteAlert } = useLiveData(user?.zone || undefined);
  const { tasks, loading, error, start, resolve } = useTasks();

  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [stats, setStats] = useState<EngineerStats | null>(null);
  const [active, setActive] = useState<boolean | null>(null);

  // 3A — classification filter (empty = ALL)
  const [classFilter, setClassFilter] = useState<string[]>([]);

  // 3B — expand state + ARIA quick guides per task
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [ariaGuides, setAriaGuides] = useState<Record<number, { loading: boolean; text: string | null }>>({});
  const fetchedGuides = useRef<Set<number>>(new Set());

  const refreshProfile = () => {
    if (!user || user.engineer_id == null) return;
    fetchEngineerStats(user.engineer_id).then((res) => {
      if (res.ok) setStats(res.data);
    });
    getEngineers().then((res) => {
      if (res.ok) {
        const selfEng = res.data.find((e) => e.id === user!.engineer_id);
        if (selfEng) setActive(selfEng.active);
      }
    });
  };

  useEffect(() => {
    refreshProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 6000);
    return () => clearTimeout(t);
  }, [confirmation]);

  // Fetch ARIA quick guide when a task card is expanded
  useEffect(() => {
    if (expandedId == null) return;
    if (fetchedGuides.current.has(expandedId)) return;
    const task = tasks.find((t) => t.id === expandedId);
    if (!task) return;
    fetchedGuides.current.add(expandedId);
    setAriaGuides((prev) => ({ ...prev, [expandedId]: { loading: true, text: null } }));
    const query = `What are the key inspection steps for a ${task.fault_category ?? 'general'} fault on ${task.machine ?? 'this machine'}?`;
    askAria(query).then((res) => {
      setAriaGuides((prev) => ({
        ...prev,
        [expandedId]: { loading: false, text: res.ok ? res.data.answer : 'ARIA guidance unavailable.' },
      }));
    });
  }, [expandedId, tasks]);

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
      setExpandedId(null);
      refreshProfile();
    } else {
      setConfirmation(`Could not resolve task #${id}: ${res.error}`);
    }
  };

  // 3A — derive classification counts from live task list
  const allCats = Array.from(new Set(tasks.map((t) => (t.fault_category ?? 'general').toLowerCase())));
  const catCounts = Object.fromEntries(allCats.map((c) => [c, tasks.filter((t) => (t.fault_category ?? 'general').toLowerCase() === c).length]));

  // 3A — filter tasks
  const filteredTasks = classFilter.length === 0
    ? tasks
    : tasks.filter((t) => classFilter.includes((t.fault_category ?? 'general').toLowerCase()));

  const pill = (status: TaskStatus) => {
    const m = STATUS_META[status] ?? STATUS_META.assigned;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: m.color, border: `1px solid ${m.color}44`, background: `${m.color}0f`, padding: '4px 12px', borderRadius: 20 }}>
        <Dot color={m.color} size={6} cls={status === 'assigned' ? 'pulse-fast' : 'pulse'} />
        {m.label}
      </span>
    );
  };

  const containerStyle = { maxWidth: 720, margin: '0 auto' } as const;

  let body: React.ReactNode;
  if (loading && tasks.length === 0) {
    body = (
      <div style={{ ...containerStyle, background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', textAlign: 'center', padding: '56px 36px', boxShadow: 'var(--abb-shadow-1)' }}>
        <div className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.1em' }}>LOADING ASSIGNED TASKS...</div>
      </div>
    );
  } else if (error && tasks.length === 0) {
    body = (
      <div style={{ ...containerStyle, background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', textAlign: 'center', padding: '56px 36px', boxShadow: 'var(--abb-shadow-1)' }}>
        <div style={{ width: 64, height: 64, background: 'var(--abb-alarm-soft)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid var(--abb-alarm-line)' }}>
          <IconAlertTriangle size={28} color="var(--abb-alarm)" />
        </div>
        <h2 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 20, fontWeight: 800, color: 'var(--abb-ink-0)', textTransform: 'uppercase', marginBottom: 10 }}>Cannot reach task service</h2>
        <p style={{ color: 'var(--abb-ink-2)', fontSize: 13, lineHeight: 1.7, margin: 0 }}>The NexOps task endpoint isn't responding. The queue will refresh automatically once it's back.</p>
      </div>
    );
  } else if (filteredTasks.length === 0) {
    body = (
      <div className="glow-success" style={{ ...containerStyle, background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', textAlign: 'center', padding: '56px 36px', boxShadow: 'var(--abb-shadow-1)' }}>
        <div style={{ width: 64, height: 64, background: 'var(--abb-nominal-soft)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', border: '1px solid var(--abb-nominal-line)' }}>
          <IconWrench size={28} color="var(--abb-nominal)" />
        </div>
        <h2 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 22, fontWeight: 800, color: 'var(--abb-ink-0)', textTransform: 'uppercase', marginBottom: 10 }}>
          {tasks.length === 0 ? 'All Clear — No Open Tasks' : 'No Tasks Match Filter'}
        </h2>
        <p style={{ color: 'var(--abb-ink-2)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
          {tasks.length === 0 ? 'New assignments will appear here automatically.' : 'Try selecting All or a different classification.'}
        </p>
      </div>
    );
  } else {
    body = (
      <div style={{ ...containerStyle, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {filteredTasks.map((t) => {
          const busy = busyId === t.id;
          const cat = (t.fault_category ?? 'general').toLowerCase();
          const leftBorder = classColor(cat);
          const isCritical = (t.score != null && t.score >= 1.10) || t.fault_category === 'hydraulic';
          const isExpanded = expandedId === t.id;
          const guide = ariaGuides[t.id];

          return (
            <div
              key={t.id}
              className={`fade-in-up ${isCritical ? 'glow-critical' : ''}`}
              style={{
                background: 'var(--abb-surface-1)',
                borderTop: `1px solid ${isCritical ? 'var(--abb-alarm-line)' : t.status === 'in_progress' ? 'var(--abb-early-line)' : 'var(--abb-line)'}`,
                borderRight: `1px solid ${isCritical ? 'var(--abb-alarm-line)' : t.status === 'in_progress' ? 'var(--abb-early-line)' : 'var(--abb-line)'}`,
                borderBottom: `1px solid ${isCritical ? 'var(--abb-alarm-line)' : t.status === 'in_progress' ? 'var(--abb-early-line)' : 'var(--abb-line)'}`,
                // 3B: classification-based left border
                borderLeft: `4px solid ${leftBorder}`,
                borderRadius: 'var(--abb-radius)',
                padding: '24px',
                boxShadow: 'var(--abb-shadow-1)',
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
                position: 'relative',
                overflow: 'hidden',
                transition: 'all 0.25s ease',
              }}
            >
              {/* Card Header & Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {pill(t.status)}

                    {/* 3B: CRITICAL pulsing red dot */}
                    {isCritical && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: '#ef4444', padding: '3px 8px', border: '1px solid #ef444433', background: '#ef44440f', borderRadius: 10 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                        CRITICAL
                      </span>
                    )}

                    {t.zone && (
                      <span style={{ fontSize: 11, color: 'var(--abb-early)', background: 'var(--abb-early-soft)', border: '1px solid var(--abb-early-line)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                        Zone {t.zone}
                      </span>
                    )}

                    {/* 3B: classification badge */}
                    {cat !== 'general' && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: leftBorder, background: `${leftBorder}12`, border: `1px solid ${leftBorder}44`, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {cat}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--abb-font-ui)', color: 'var(--abb-ink-0)', margin: '0 0 4px 0', letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
                    {t.machine ?? 'Unknown Unit'}
                  </h2>
                </div>

                <div style={{ flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {t.status === 'assigned' && (
                    <button onClick={() => handleStart(t.id)} disabled={busy} className="abb-btn abb-btn--primary" style={{ padding: '10px 20px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
                      {busy ? 'Starting...' : 'START WORK'}
                    </button>
                  )}
                  {t.status === 'in_progress' && (
                    <button onClick={() => handleResolve(t.id)} disabled={busy} className="abb-btn" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none', padding: '10px 20px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
                      {busy ? 'Resolving...' : '✓ COMPLETE WORK'}
                    </button>
                  )}

                  {/* 3B: expand/collapse chevron */}
                  <button
                    type="button"
                    onClick={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
                    style={{ background: 'none', border: '1px solid var(--abb-line)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 14, color: 'var(--abb-ink-2)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}
                    aria-label={isExpanded ? 'Collapse task details' : 'Expand task details'}
                  >
                    ⌄
                  </button>
                </div>
              </div>

              {/* Instruction line */}
              <div style={{ fontSize: 13, color: 'var(--abb-ink-1)', padding: '12px 16px', background: 'var(--abb-surface-2)', borderRadius: 'var(--abb-radius-sm)', borderLeft: `3px solid ${leftBorder}` }}>
                <strong>Instruction:</strong> Go to the machine location and update task status above.
              </div>

              {/* Task specifications */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--abb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Task Specifications</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, background: 'var(--abb-surface-2)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: 16 }}>
                  {[
                    ['Task ID', `#${t.id}`],
                    ['Alarm ID', `#${t.alarm_id ?? '—'}`],
                    ['Location Zone', `Zone ${t.zone ?? '—'}`],
                    ['Classification', t.fault_category ?? 'general'],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, borderBottom: '1px solid var(--abb-line-faint)' }}>
                      <span style={{ color: 'var(--abb-ink-2)' }}>{label}</span>
                      <span className="abb-data" style={{ color: 'var(--abb-ink-0)', fontWeight: 600, textTransform: 'capitalize' }}>{val}</span>
                    </div>
                  ))}

                  {/* 3B: color-coded match score pill */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, paddingBottom: 6, borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Dispatch Match</span>
                    <MatchPill score={t.score} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, borderBottom: '1px solid var(--abb-line-faint)' }}>
                    <span style={{ color: 'var(--abb-ink-2)' }}>Assigned At</span>
                    <span className="abb-data" style={{ color: 'var(--abb-ink-0)' }}>{clockOf(t.assigned_at)}</span>
                  </div>
                  {t.started_at && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, borderBottom: '1px solid var(--abb-line-faint)' }}>
                      <span style={{ color: 'var(--abb-ink-2)' }}>Work Started</span>
                      <span className="abb-data" style={{ color: 'var(--abb-ink-0)' }}>{clockOf(t.started_at)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 3B — Expandable inline drawer with ARIA QUICK GUIDE */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--abb-line-faint)', paddingTop: 16 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--abb-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    ARIA QUICK GUIDE
                  </div>
                  <div style={{ background: '#f9fafb', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: '14px 16px', fontSize: 12.5, color: 'var(--abb-ink-1)', lineHeight: 1.7, minHeight: 60, position: 'relative' }}>
                    {guide == null || guide.loading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--abb-ink-3)', fontSize: 11 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--abb-early)', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                        ARIA is preparing guidance…
                      </div>
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{guide.text}</div>
                    )}
                  </div>
                </div>
              )}
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

      <div className="fade-in-up" style={{ padding: '40px max(16px,4vw)', flex: 1, paddingRight: 'max(16px,4vw)' }}>
        <div style={{ ...containerStyle }}>

          {/* Header & Stats Banner */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(24px,3vw,32px)', fontWeight: 800, color: 'var(--abb-ink-0)', letterSpacing: '-0.02em', textTransform: 'uppercase', margin: '0 0 6px 0' }}>
                Technician Console <span style={{ color: 'var(--abb-red)' }}>— My Tasks</span>
              </h1>
              <p style={{ color: 'var(--abb-ink-2)', fontSize: 13, margin: 0 }}>
                Welcome back, <strong style={{ color: 'var(--abb-ink-0)' }}>{user ? user.username.charAt(0).toUpperCase() + user.username.slice(1) : 'Operator'}</strong>
                {' '}• Status: <span style={{ color: active === false ? 'var(--abb-alarm)' : '#22c55e', fontWeight: 600 }}>{active === false ? 'Off Duty (Deactivated)' : 'On Duty'}</span>
                {user?.zone ? ` • Zone ${user.zone}` : ''}
              </p>
            </div>

            {/* KPI tiles */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                { val: tasks.filter((t) => t.status === 'assigned').length, label: 'To Do', color: '#f59e0b' },
                { val: tasks.filter((t) => t.status === 'in_progress').length, label: 'Active', color: 'var(--abb-early)' },
                ...(stats ? [{ val: stats.resolved_count, label: 'Resolved', color: '#22c55e' }] : []),
                ...(stats?.avg_resolution_minutes != null ? [{ val: `${stats.avg_resolution_minutes.toFixed(1)}m`, label: 'Avg Speed', color: 'var(--abb-early)' }] : []),
              ].map(({ val, label, color }) => (
                <div key={label} style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', boxShadow: 'var(--abb-shadow-1)', padding: '10px 16px', textAlign: 'center', minWidth: 90 }}>
                  <div className="abb-data" style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: 'var(--abb-ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 3A — Classification filter chips */}
          {tasks.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
              {/* ALL chip */}
              {(() => {
                const isAll = classFilter.length === 0;
                const cfg = CHIP_CONFIG.all;
                return (
                  <button
                    key="all"
                    type="button"
                    onClick={() => setClassFilter([])}
                    className="abb-data"
                    style={{ fontSize: 10, fontWeight: 700, padding: '5px 13px', borderRadius: 20, cursor: 'pointer', border: `1.5px solid ${isAll ? cfg.border : 'var(--abb-line)'}`, background: isAll ? cfg.bg : 'var(--abb-surface-1)', color: isAll ? 'var(--abb-ink-0)' : 'var(--abb-ink-3)', letterSpacing: '0.05em', transition: 'all 0.15s' }}
                  >
                    ALL ({tasks.length})
                  </button>
                );
              })()}

              {/* Per-classification chips (only categories present in tasks) */}
              {allCats.map((cat) => {
                const cfg = CHIP_CONFIG[cat] ?? CHIP_CONFIG.general;
                const isOn = classFilter.includes(cat);
                const count = catCounts[cat] ?? 0;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() =>
                      setClassFilter((prev) =>
                        prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
                      )
                    }
                    className="abb-data"
                    style={{ fontSize: 10, fontWeight: 700, padding: '5px 13px', borderRadius: 20, cursor: 'pointer', border: `1.5px solid ${isOn ? cfg.border : 'var(--abb-line)'}`, background: isOn ? cfg.bg : 'var(--abb-surface-1)', color: isOn ? cfg.border : 'var(--abb-ink-3)', letterSpacing: '0.05em', transition: 'all 0.15s' }}
                  >
                    {cfg.label ?? cat.toUpperCase()} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Confirmation banner */}
          {confirmation && (
            <div style={{ marginBottom: 18 }}>
              <div className="mono fade-in-up" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--abb-radius)', padding: '12px 16px', fontSize: 12, color: '#10b981', letterSpacing: '0.02em', fontWeight: 500 }}>
                Task resolution completed: {confirmation}
              </div>
            </div>
          )}

          {error && tasks.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div className="mono" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--abb-radius)', padding: '12px 16px', fontSize: 12, color: '#f59e0b', letterSpacing: '0.02em', fontWeight: 500 }}>
                Cannot reach task service — showing last known queue
              </div>
            </div>
          )}

          {body}
        </div>
      </div>

      {/* 3C — ARIA floating right drawer (swap-seam unchanged, getAriaResponse() intact) */}
      {user?.zone && <AriaPanel zone={user.zone} floating online />}
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