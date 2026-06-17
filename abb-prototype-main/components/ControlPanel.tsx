'use client';

import { Dot } from './Shared';
import { useLiveData } from '@/hooks/useLiveData';
import type { ControlPanelAlarm } from '@/types/telemetry';

const UNIT_GRID = [
  [1, 0, 0, 0, 0, 0],
  [0, 2, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 2],
  [0, 0, 0, 1, 0, 0],
  [1, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 0, 0],
];

// Restyled to ABB light tokens (Stage UI-1). Nominal units are QUIET grey; only
// warning (amber) and critical (red) carry colour.
const UNIT_COLORS = {
  unitDefault: 'var(--abb-surface-3)',
  unitAmber: 'var(--abb-warning)',
  unitRed: 'var(--abb-alarm)',
};

const ALARM_COLORS = {
  dotRed: 'var(--abb-alarm)',
  dotAmber: 'var(--abb-warning)',
  dotGreen: 'var(--abb-nominal)',
};

// Shown before the first live record arrives so the public landing page
// never renders an empty panel.
const FALLBACK_ALARMS: ControlPanelAlarm[] = [
  { dot: ALARM_COLORS.dotRed, code: 'M-07', text: "Bearing temp +14°C · ARIA: lubrication failure pattern", isEarly: false, reasoning: '', siteAlert: false, emergencyType: null, isNuisance: false },
  { dot: ALARM_COLORS.dotAmber, code: 'M-12', text: 'Pressure trending high · loop PT-204', isEarly: false, reasoning: '', siteAlert: false, emergencyType: null, isNuisance: false },
  { dot: ALARM_COLORS.dotGreen, code: 'M-03', text: 'Calibration window passed · within tolerance', isEarly: false, reasoning: '', siteAlert: false, emergencyType: null, isNuisance: false },
];

export default function ControlPanel() {
  // Consume the data seam directly (smaller diff than threading a prop
  // through Landing). controlAlarms is the ControlPanelAlarm[] projection.
  const { controlAlarms } = useLiveData();
  const alarms = controlAlarms.length > 0 ? controlAlarms : FALLBACK_ALARMS;

  return (
    <div className="abb-card" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--abb-line)',
          background: 'var(--abb-surface-2)',
        }}
      >
        <div
          className="abb-data"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            color: 'var(--abb-ink-1)',
            letterSpacing: '0.12em',
          }}
        >
          <Dot color="var(--abb-nominal)" size={7} cls="pulse-fast" />
          LIVE · CONTROL ROOM
        </div>
        <div className="abb-micro">12 UNITS · 5 ZONES</div>
      </div>

      {/* Unit grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 5, padding: 14 }}>
        {UNIT_GRID.flat().map((s, i) => (
          <div
            key={i}
            style={{
              aspectRatio: '1',
              borderRadius: 'var(--abb-radius-sm)',
              background: s === 2 ? UNIT_COLORS.unitRed : s === 1 ? UNIT_COLORS.unitAmber : UNIT_COLORS.unitDefault,
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>

      {/* Alarm list */}
      <div style={{ borderTop: '1px solid var(--abb-line)' }}>
        {alarms.map((a, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              fontSize: 10.5,
              color: 'var(--abb-ink-2)',
              // SITE EMERGENCY gets the strongest treatment; nuisance is greyed.
              background: a.siteAlert ? 'var(--abb-alarm-soft)' : 'transparent',
              opacity: a.isNuisance ? 0.55 : 1,
              borderBottom: i < alarms.length - 1 ? '1px solid var(--abb-line-faint)' : 'none',
            }}
          >
            <Dot color={a.siteAlert ? 'var(--abb-alarm)' : a.dot} size={6} cls={a.siteAlert || a.isEarly ? 'pulse-fast' : ''} />
            <span className="abb-data" style={{ color: 'var(--abb-ink-0)', fontWeight: 600, marginRight: 2 }}>
              {a.code}
            </span>
            {a.isNuisance ? (
              <span className="abb-badge abb-badge--nuisance" style={{ marginRight: 4 }}>⊘ NUISANCE — FILTERED</span>
            ) : a.siteAlert ? (
              <span className="abb-badge abb-badge--alarm" style={{ marginRight: 4 }}>■ SITE</span>
            ) : a.isEarly ? (
              <span className="abb-badge abb-badge--early" style={{ marginRight: 4 }} title={a.reasoning}>⚠ EARLY</span>
            ) : null}
            {a.text}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderTop: '1px solid var(--abb-line)',
          background: 'var(--abb-surface-2)',
        }}
      >
        <span className="abb-micro">ARIA · ADAPTIVE REASONING</span>
        <span className="abb-micro">3 ACTIVE · 1 CRITICAL</span>
      </div>
    </div>
  );
}
