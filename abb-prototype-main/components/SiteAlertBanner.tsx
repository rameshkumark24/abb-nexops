'use client';

import type { SiteAlert } from '@/types/telemetry';

// SITE-WIDE RED ZONE banner. Dumb/presentational: it renders whatever the hook
// hands it and nothing when there's no active emergency. The SAME banner is
// dropped at the top of admin, engineer, and technician pages, so a fire alarm
// lights up red across every role view with the dispatched engineer named.
export function SiteAlertBanner({ alert }: { alert: SiteAlert | null }) {
  if (!alert) return null;

  const dispatched =
    alert.engineer && alert.engineer !== 'Unassigned'
      ? `Engineer ${alert.engineer} dispatched`
      : 'Dispatching engineer…';

  return (
    <div
      role="alert"
      className="glow-critical blink-critical"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: 'linear-gradient(90deg, #7f1d1d, #ef4444, #7f1d1d)',
        color: '#ffffff',
        padding: '14px 24px',
        borderBottom: '2px solid #ef4444',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textAlign: 'center',
      }}
    >
      <span>🚨 SITE EMERGENCY: {alert.label}</span>
      <span style={{ opacity: 0.85, fontWeight: 600 }}>— {alert.machine} —</span>
      <span>{dispatched}</span>
      <span style={{ opacity: 0.7, fontWeight: 500, fontSize: 11 }}>{alert.time}</span>
    </div>
  );
}
