'use client';

import { Dot, COLORS } from './Shared';
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

const UNIT_COLORS = {
  unitDefault: '#1a2035',
  unitAmber: '#78350f',
  unitRed: '#7f1d1d',
};

const ALARM_COLORS = {
  dotRed: '#ef4444',
  dotAmber: '#f59e0b',
  dotGreen: '#22c55e',
};

// Shown before the first live record arrives so the public landing page
// never renders an empty panel.
const FALLBACK_ALARMS: ControlPanelAlarm[] = [
  { dot: ALARM_COLORS.dotRed, code: 'M-07', text: "Bearing temp +14°C · ARIA: lubrication failure pattern", isEarly: false, reasoning: '' },
  { dot: ALARM_COLORS.dotAmber, code: 'M-12', text: 'Pressure trending high · loop PT-204', isEarly: false, reasoning: '' },
  { dot: ALARM_COLORS.dotGreen, code: 'M-03', text: 'Calibration window passed · within tolerance', isEarly: false, reasoning: '' },
];

export default function ControlPanel() {
  // Consume the data seam directly (smaller diff than threading a prop
  // through Landing). controlAlarms is the ControlPanelAlarm[] projection.
  const { controlAlarms } = useLiveData();
  const alarms = controlAlarms.length > 0 ? controlAlarms : FALLBACK_ALARMS;

  return (
    <div style={{ background: COLORS.panelBg, border: `1px solid ${COLORS.borderFaint}`, borderRadius: 6, overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: `1px solid ${COLORS.borderFaint}`,
        }}
      >
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            color: COLORS.textSec,
            letterSpacing: '0.12em',
          }}
        >
          <Dot color="#ef4444" size={7} cls="pulse-fast" />
          LIVE · CONTROL ROOM
        </div>
        <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.1em' }}>
          12 UNITS · 5 ZONES
        </div>
      </div>

      {/* Unit grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 5, padding: 14 }}>
        {UNIT_GRID.flat().map((s, i) => (
          <div
            key={i}
            style={{
              aspectRatio: '1',
              borderRadius: 3,
              background: s === 2 ? UNIT_COLORS.unitRed : s === 1 ? UNIT_COLORS.unitAmber : UNIT_COLORS.unitDefault,
              transition: 'background 0.3s',
            }}
          />
        ))}
      </div>

      {/* Alarm list */}
      <div style={{ borderTop: `1px solid ${COLORS.borderFaint}` }}>
        {alarms.map((a, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 16px',
              fontSize: 10.5,
              color: COLORS.textMuted,
              borderBottom: i < alarms.length - 1 ? `1px solid ${COLORS.borderFaint}` : 'none',
            }}
          >
            <Dot color={a.dot} size={6} cls={a.isEarly ? 'pulse-fast' : ''} />
            <span className="mono" style={{ color: COLORS.textSec, fontWeight: 500, marginRight: 2 }}>
              {a.code}
            </span>
            {a.isEarly && (
              <span className="mono blink-critical" style={{ color: '#f59e0b', fontWeight: 600, marginRight: 4 }} title={a.reasoning}>
                ⚠ EARLY
              </span>
            )}
            {a.text}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="mono"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '7px 16px',
          borderTop: `1px solid ${COLORS.borderFaint}`,
          fontSize: 9,
          color: COLORS.textFaint,
          letterSpacing: '0.08em',
        }}
      >
        <span>ARIA · ADAPTIVE REASONING</span>
        <span>3 ACTIVE · 1 CRITICAL</span>
      </div>
    </div>
  );
}
