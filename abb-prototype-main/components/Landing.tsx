'use client';

import { useState } from 'react';
import { NavBar, MicroLabel } from './Shared';
import { SiteAlertBanner } from './SiteAlertBanner';
import ControlPanel from './ControlPanel';
import { useLiveData } from '@/hooks/useLiveData';
import { IconActivity, IconLayout, IconWrench, IconArrowRight, IconCpu, IconWifi, IconServer } from './Icons';

const ROLE_CARDS = [
  {
    key: 'admin' as const,
    tag: 'ADMIN',
    title: 'Plant Manager',
    desc: 'System-wide health, alarm trends, engineer utilization heatmap, audit trail.',
    icon: <IconActivity size={20} />,
  },
  {
    key: 'engineer' as const,
    tag: 'ENGINEER',
    title: 'Field Engineer',
    desc: 'Priority task queue, sensor history, ARIA conversational diagnostics, resolution updates.',
    icon: <IconLayout size={20} />,
  },
  {
    key: 'technician' as const,
    tag: 'TECHNICIAN',
    title: 'Technician',
    desc: 'Single-screen workflow: one machine, step-by-step fix, photo & note capture on resolve.',
    icon: <IconWrench size={20} />,
  },
];

export default function Landing({ onEnter }: { onEnter: (role: 'admin' | 'engineer' | 'technician') => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  // Wire the site-wide EMERGENCY banner to the REAL live source (same seam the
  // dashboards use). Absent/calm when no critical site alert is active; red only
  // when a fire/gas/emergency record is live. No fabricated alerts.
  const { siteAlert } = useLiveData();

  const stats = [
    { num: '3,500', label: 'Alarms / shift' },
    { num: '10×', label: 'Over EEMUA 191' },
    { num: '60%', label: 'Response time cut' },
  ];

  const techItems = [
    { icon: <IconCpu size={13} color="var(--abb-ink-3)" />, text: 'Raspberry Pi ready' },
    { icon: <IconWifi size={13} color="var(--abb-ink-3)" />, text: 'MQTT · WebSocket' },
    { icon: <IconServer size={13} color="var(--abb-ink-3)" />, text: 'Edge · No cloud' },
  ];

  return (
    <div className="abb-page fade-in-up">
      {/* SITE-WIDE EMERGENCY ALERT — red only when active, nothing otherwise. */}
      <SiteAlertBanner alert={siteAlert} />

      <NavBar />

      {/* HERO */}
      <div className="abb-shell abb-hero">
        {/* Left */}
        <div>
          <h1
            style={{
              fontFamily: 'var(--abb-font-ui)',
              fontSize: 'clamp(28px, 4.4vw, 40px)',
              fontWeight: 300,
              lineHeight: 1.16,
              color: 'var(--abb-ink-0)',
              letterSpacing: '-0.01em',
              marginBottom: 22,
            }}
          >
            The control room today
            <br />
            is a room of noise.
          </h1>
          <p
            style={{
              fontSize: 13.5,
              color: 'var(--abb-ink-2)',
              lineHeight: 1.82,
              maxWidth: 460,
              marginBottom: 36,
            }}
          >
            NexOps is the intelligence layer between machine data and human action. AI-prioritized alarms, automated engineer
            dispatch, and institutional memory that never retires — in a grey-first interface where colour only means criticality.
          </p>

          {/* Stats — figures read as instrument data (monospace). */}
          <div style={{ display: 'flex', gap: 40, marginBottom: 32, flexWrap: 'wrap' }}>
            {stats.map((s) => (
              <div key={s.label}>
                <div
                  className="abb-data"
                  style={{ fontSize: 26, fontWeight: 600, color: 'var(--abb-ink-0)', letterSpacing: '-0.01em' }}
                >
                  {s.num}
                </div>
                <MicroLabel style={{ marginTop: 4 }}>{s.label}</MicroLabel>
              </div>
            ))}
          </div>

          {/* Tech row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            {techItems.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {t.icon}
                <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-3)', letterSpacing: '0.1em' }}>
                  {t.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Control Panel */}
        <ControlPanel />
      </div>

      {/* ROLES SECTION — master-login entry point. */}
      <div className="abb-shell" style={{ paddingTop: 16, paddingBottom: 'clamp(40px, 6vw, 64px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <h2 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 18, fontWeight: 500, color: 'var(--abb-ink-0)' }}>
            Three Roles. Three Views. One Platform.
          </h2>
          <MicroLabel>SELECT OPERATOR ROLE TO ENTER</MicroLabel>
        </div>

        <div className="abb-roles-grid">
          {ROLE_CARDS.map((r) => (
            <div
              key={r.key}
              className="abb-card abb-card--interactive"
              onClick={() => onEnter(r.key)}
              onMouseEnter={() => setHovered(r.key)}
              onMouseLeave={() => setHovered(null)}
              style={{ padding: '22px 22px 20px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div style={{ color: hovered === r.key ? 'var(--abb-ink-0)' : 'var(--abb-ink-2)', transition: 'color 0.16s' }}>{r.icon}</div>
                <MicroLabel style={{ letterSpacing: '0.14em' }}>{r.tag}</MicroLabel>
              </div>
              <div style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 17, fontWeight: 500, color: 'var(--abb-ink-0)', marginBottom: 8 }}>
                {r.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-2)', lineHeight: 1.72, marginBottom: 20 }}>
                {r.desc}
              </div>
              <div
                className="abb-data"
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--abb-ink-3)', letterSpacing: '0.09em' }}
              >
                SIGN IN TO ENTER <IconArrowRight size={13} color="var(--abb-ink-3)" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
