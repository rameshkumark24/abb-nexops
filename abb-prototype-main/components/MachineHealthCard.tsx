'use client';

// MachineHealthCard — Zone Machine Health card (Section 2B). Card-grid tile with
// an expandable inline drawer showing the last 5 live readings + a CSS alarm-type
// breakdown. All data is live-derived (no chart lib in the drawer).

import React, { useMemo } from 'react';
import { Dot, Badge, type BadgeVariant } from '@/components/Shared';
import { anomalyColor, faultColor } from '@/lib/chartPalette';
import type { Machine } from '@/types/telemetry';
import type { Reading } from '@/hooks/useMachineSignals';
import type { AlarmEvent } from '@/hooks/useAlarmHistory';

const RISK_BADGE: Record<string, BadgeVariant> = { LOW: 'nominal', MEDIUM: 'warning', HIGH: 'high', CRITICAL: 'alarm' };

function accentFor(m: Machine): string {
  if (m.nexopsRisk === 'CRITICAL') return 'var(--abb-alarm)';
  if (m.isEarly) return 'var(--abb-early)';
  if (m.nexopsRisk === 'HIGH') return 'var(--abb-high)';
  if (m.nexopsRisk === 'MEDIUM') return 'var(--abb-warning)';
  return 'var(--abb-nominal)';
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false });

export function MachineHealthCard({
  machine,
  signals,
  events,
  expanded,
  onToggle,
}: {
  machine: Machine;
  signals: Reading[];
  events: AlarmEvent[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const m = machine;
  const accent = accentFor(m);
  const isCrit = m.nexopsRisk === 'CRITICAL';

  // Alarm-type breakdown for THIS machine from the session history (CSS bars).
  const { breakdown, maxFault } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.fault, (counts.get(e.fault) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { breakdown: sorted, maxFault: sorted.length ? sorted[0][1] : 1 };
  }, [events]);

  return (
    <div
      id={`eng-machine-${m.name}`}
      className={isCrit ? 'glow-critical' : ''}
      style={{
        background: isCrit ? 'var(--abb-alarm-soft)' : 'var(--abb-surface-1)',
        border: `1px solid ${isCrit ? 'var(--abb-alarm-line)' : 'var(--abb-line)'}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--abb-radius-sm)',
        padding: 14,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Dot color={accent} size={7} cls={isCrit ? 'pulse-fast' : ''} />
          <span className="abb-data" style={{ fontSize: 12, fontWeight: 700, color: 'var(--abb-ink-0)', textTransform: 'uppercase' }}>{m.name}</span>
          <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>{m.zone.toUpperCase()}</span>
          {m.isEarly && <Badge variant="early" title={m.reasoning}>⚠ EARLY</Badge>}
        </div>
        <button type="button" onClick={onToggle} aria-label={expanded ? 'Collapse' : 'Expand'} aria-expanded={expanded} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--abb-ink-2)', display: 'flex', padding: 2 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Pills row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span
          className="abb-data"
          style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--abb-radius-pill)', color: anomalyColor(m.anomalyScore), background: `${anomalyColor(m.anomalyScore)}1a`, border: `1px solid ${anomalyColor(m.anomalyScore)}55` }}
        >
          a={m.anomalyScore != null ? m.anomalyScore.toFixed(2) : '—'}
        </span>
        <Badge variant={RISK_BADGE[m.nexopsRisk] ?? 'nominal'} title={m.reasoning}>NEXOPS {m.nexopsRisk}</Badge>
        <span className="abb-data" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: accent }}>{m.perf}%</span>
      </div>

      {/* Health bar */}
      <div style={{ height: 6, background: 'var(--abb-surface-3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${m.perf}%`, height: '100%', background: accent, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>

      {/* Assigned engineer + specialty */}
      {m.assignedEngineer && m.assignedEngineer !== 'Unassigned' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-1)' }}>▸ {m.assignedEngineer}</span>
          {m.faultCategory && (
            <span className="abb-data" style={{ fontSize: 8.5, color: faultColor(m.faultCategory), background: `${faultColor(m.faultCategory)}14`, border: `1px solid ${faultColor(m.faultCategory)}44`, padding: '1px 6px', borderRadius: 'var(--abb-radius-pill)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {m.faultCategory}
            </span>
          )}
        </div>
      )}

      {/* Drawer */}
      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--abb-line-faint)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Last 5 readings */}
          <div>
            <div className="abb-micro" style={{ marginBottom: 6 }}>LAST 5 READINGS · LIVE SIGNALS</div>
            {signals.length === 0 ? (
              <div className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)' }}>Collecting telemetry…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {[...signals].reverse().map((s, i) => (
                  <div key={`${s.ts}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10 }} className="abb-data">
                    <span style={{ color: 'var(--abb-ink-3)' }}>{clock(s.ts)}</span>
                    <span style={{ color: 'var(--abb-ink-2)' }}>health <strong style={{ color: 'var(--abb-ink-0)' }}>{s.perf}%</strong></span>
                    <span style={{ color: 'var(--abb-ink-2)' }}>a=<strong style={{ color: anomalyColor(s.anomaly) }}>{s.anomaly != null ? s.anomaly.toFixed(2) : '—'}</strong></span>
                    <span style={{ color: 'var(--abb-ink-3)' }}>{s.risk}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="abb-data" style={{ fontSize: 8, color: 'var(--abb-ink-3)', marginTop: 4 }}>
              Raw Temp/Pressure not exposed by the live hook — showing derived health &amp; anomaly signals.
            </div>
          </div>

          {/* Alarm-type breakdown (CSS bars) */}
          <div>
            <div className="abb-micro" style={{ marginBottom: 6 }}>ALARM TYPE BREAKDOWN · SESSION</div>
            {breakdown.length === 0 ? (
              <div className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)' }}>No alarm events recorded yet this session.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {breakdown.map(([fault, n]) => (
                  <div key={fault}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-2)', textTransform: 'capitalize' }}>{fault}</span>
                      <span className="abb-data" style={{ fontSize: 9, fontWeight: 700, color: 'var(--abb-ink-1)' }}>{n}</span>
                    </div>
                    <div style={{ height: 7, background: 'var(--abb-surface-3)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${(n / maxFault) * 100}%`, height: '100%', background: faultColor(fault), borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
