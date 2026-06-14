'use client';

import { useState } from 'react';
import { NavBar, COLORS } from './Shared';
import ControlPanel from './ControlPanel';
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

  const stats = [
    { num: '3,500', label: 'Alarms / shift' },
    { num: '10×', label: 'Over EEMUA 191' },
    { num: '60%', label: 'Response time cut' },
  ];

  const techItems = [
    { icon: <IconCpu size={13} color={COLORS.textFaint} />, text: 'Raspberry Pi ready' },
    { icon: <IconWifi size={13} color={COLORS.textFaint} />, text: 'MQTT · WebSocket' },
    { icon: <IconServer size={13} color={COLORS.textFaint} />, text: 'Edge · No cloud' },
  ];

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
      <NavBar />

      {/* HERO */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 56,
          padding: '64px 56px 48px',
          alignItems: 'center',
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        {/* Left */}
        <div>
          <h1
            style={{
              fontSize: 40,
              fontWeight: 300,
              lineHeight: 1.16,
              color: COLORS.textPrimary,
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
              fontSize: 13,
              color: COLORS.textMuted,
              lineHeight: 1.82,
              maxWidth: 440,
              marginBottom: 36,
              letterSpacing: '0.005em',
            }}
          >
            NexOps is the intelligence layer between machine data and human action. AI-prioritized alarms, automated engineer
            dispatch, and institutional memory that never retires — in a gray-first interface where color only means criticality.
          </p>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 40, marginBottom: 32 }}>
            {stats.map((s) => (
              <div key={s.label}>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    color: COLORS.textPrimary,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {s.num}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 9,
                    color: COLORS.textFaint,
                    letterSpacing: '0.12em',
                    marginTop: 3,
                    textTransform: 'uppercase',
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Tech row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {techItems.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {t.icon}
                <span className="mono" style={{ fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.1em' }}>
                  {t.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right – Control Panel */}
        <ControlPanel />
      </div>

      {/* ROLES SECTION */}
      <div style={{ padding: '32px 56px 64px', maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 400, color: COLORS.textPrimary }}>
            Three Roles. Three Views. One Platform.
          </h2>
          <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.13em' }}>
            SELECT OPERATOR ROLE TO ENTER
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {ROLE_CARDS.map((r) => (
            <div
              key={r.key}
              onClick={() => onEnter(r.key)}
              onMouseEnter={() => setHovered(r.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: hovered === r.key ? COLORS.cardBgHov : COLORS.cardBg,
                border: `1px solid ${hovered === r.key ? COLORS.borderSub : COLORS.borderFaint}`,
                borderRadius: 6,
                padding: '22px 22px 20px',
                cursor: 'pointer',
                transition: 'background 0.18s, border-color 0.18s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div style={{ color: COLORS.textMuted }}>{r.icon}</div>
                <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.14em' }}>
                  {r.tag}
                </div>
              </div>
              <div style={{ fontSize: 17, fontWeight: 400, color: COLORS.textPrimary, marginBottom: 8 }}>
                {r.title}
              </div>
              <div style={{ fontSize: 11.5, color: COLORS.textMuted, lineHeight: 1.72, marginBottom: 20 }}>
                {r.desc}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 10,
                  color: COLORS.textFaint,
                  letterSpacing: '0.09em',
                }}
              >
                Sign in to enter <IconArrowRight size={13} color={COLORS.textFaint} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
