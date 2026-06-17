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

  // Restyled to the ABB alarm token (Stage UI-1): flat industrial red — the ONE
  // place red is allowed to dominate — instead of the old gradient. Prop + data
  // shape unchanged. A soft pulse keeps the eye without consumer flourish.
  return (
    <div role="alert" className="abb-banner-alarm pulse-fast">
      <span style={{ fontSize: 15 }}>■ SITE EMERGENCY: {alert.label}</span>
      <span style={{ opacity: 0.9, fontWeight: 600 }}>— {alert.machine} —</span>
      <span style={{ fontWeight: 600 }}>{dispatched}</span>
      <span className="abb-data" style={{ opacity: 0.8, fontWeight: 500, fontSize: 11 }}>{alert.time}</span>
    </div>
  );
}
