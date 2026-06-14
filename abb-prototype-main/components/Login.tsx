'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { NavBar, Dot, COLORS } from './Shared';
import { IconAlertTriangle, IconShield } from './Icons';

const ROLE_LOGIN = {
  admin: { tab: 'Plant', btnLabel: 'Enter Plant Manager Console', id: 'admin', pw: 'admin123' },
  engineer: { tab: 'Field', btnLabel: 'Enter Field Engineer Console', id: 'engineer', pw: 'engineer123' },
  technician: { tab: 'Technician', btnLabel: 'Enter Technician Console', id: 'tech', pw: 'tech123' },
};

const ROLE_KEYS = ['admin', 'engineer', 'technician'] as const;

function AlarmBanner() {
  const [barW, setBarW] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setBarW(88), 400);
    return () => clearTimeout(t);
  }, []);

  const units = [
    { code: 'T-21', name: 'Coolant Flow', val: '99%' },
    { code: 'M-12', name: 'Vibration RMS', val: '87%' },
    { code: 'B-14', name: 'Bearing Temp', val: '93%' },
    { code: 'M-07', name: 'Vibration RMS', val: '73%' },
  ];

  const redBannerBg = '#0f0808';
  const redBannerBdr = '#3b1515';
  const red = '#ef4444';
  const redBright = '#f87171';
  const textPrimary = '#f1f5f9';
  const textSec = '#94a3b8';
  const textMuted = '#64748b';
  const textFaint = '#475569';
  const amber = '#f59e0b';

  return (
    <div
      style={{
        background: redBannerBg,
        borderBottom: `1px solid ${redBannerBdr}`,
        padding: '14px 32px',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: red, letterSpacing: '0.12em' }}>
          <Dot color={red} size={6} cls="pulse-fast" />⚠ HIGH-RISK ALARM ACTIVE
        </div>
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#1a0808',
            border: `1px solid #5c1a1a`,
            padding: '4px 10px',
            borderRadius: 3,
            fontSize: 9,
            color: '#cc4444',
            letterSpacing: '0.12em',
          }}
        >
          <Dot color={red} size={5} cls="pulse-fast" />
          LIVE - 4 EVENTS
        </div>
      </div>

      {/* Content grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'start' }}>
        <div>
          <div className="mono" style={{ fontSize: 9, color: textFaint, letterSpacing: '0.1em', marginBottom: 5 }}>
            TOP THREAT · UNIT T-21 · BOILER-A
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 22,
              fontWeight: 300,
              color: textPrimary,
              marginBottom: 4,
            }}
          >
            <IconAlertTriangle size={18} color={amber} />
            Coolant Flow
          </div>
          <div className="mono" style={{ fontSize: 11, color: textMuted, marginBottom: 10 }}>
            62.6 %<span style={{ color: textFaint }}> / limit 70 %</span>
            <span style={{ color: textFaint, margin: '0 6px' }}>·</span>
            1s ago
          </div>

          {/* Risk bar */}
          <div style={{ height: 3, background: '#1e2030', borderRadius: 2, marginBottom: 5, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                background: 'linear-gradient(90deg, #b45309, #dc2626)',
                width: `${barW}%`,
                transition: 'width 1.2s ease',
              }}
            />
          </div>
          <div
            className="mono"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 9,
              color: textFaint,
              letterSpacing: '0.1em',
              marginBottom: 6,
            }}
          >
            <span>RISK INDEX</span>
            <span style={{ color: redBright }}>88%</span>
          </div>
          <div className="mono" style={{ fontSize: 9, color: '#374151', letterSpacing: '0.09em' }}>
            AUTHENTICATE TO ACKNOWLEDGE · ARIA MONITORING · T+13S
          </div>
        </div>

        {/* Unit list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 }}>
          {units.map((u) => (
            <div key={u.code} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: textMuted, whiteSpace: 'nowrap' }}>
              <Dot color={red} size={6} cls="" />
              <span style={{ color: textSec }}>{u.code}</span>
              <span>{u.name}</span>
              <span style={{ color: redBright, marginLeft: 8, fontWeight: 500 }}>{u.val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Login({
  role,
  onBack,
}: {
  role: 'admin' | 'engineer' | 'technician' | null;
  onBack: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<'admin' | 'engineer' | 'technician'>(role || 'admin');
  const [opId, setOpId] = useState(ROLE_LOGIN[selectedRole].id);
  const [opPw, setOpPw] = useState(ROLE_LOGIN[selectedRole].pw);
  const [hovBtn, setHovBtn] = useState(false);
  const router = useRouter();

  function switchRole(r: 'admin' | 'engineer' | 'technician') {
    setSelectedRole(r);
    setOpId(ROLE_LOGIN[r].id);
    setOpPw(ROLE_LOGIN[r].pw);
  }

  const meta = ROLE_LOGIN[selectedRole];

  const inputBg = '#090b10';
  const demoBg = '#0c0d12';

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavBar onBack={onBack} />
      <AlarmBanner />

      {/* Body */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1.05fr',
          gap: 0,
          padding: '52px 56px 60px',
          alignItems: 'start',
          maxWidth: 1280,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* LEFT */}
        <div style={{ paddingRight: 52 }}>
          {/* Role-based badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#0c0e14',
              border: `1px solid ${COLORS.borderFaint}`,
              padding: '5px 12px',
              borderRadius: 4,
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              color: COLORS.textFaint,
              letterSpacing: '0.1em',
              marginBottom: 26,
            }}
          >
            <IconShield size={12} color={COLORS.textFaint} /> ROLE-BASED ACCESS
          </div>

          <h1 style={{ fontSize: 30, fontWeight: 300, color: COLORS.textPrimary, lineHeight: 1.18, marginBottom: 14 }}>
            Sign in to your console.
          </h1>
          <p style={{ fontSize: 12.5, color: COLORS.textMuted, lineHeight: 1.82, marginBottom: 28, maxWidth: 360 }}>
            Each operator role has its own view, alerts, and tools. Select your role and authenticate to enter the live control surface.
          </p>

          {/* Demo credentials */}
          <div
            style={{
              background: demoBg,
              border: `1px solid ${COLORS.borderFaint}`,
              padding: '16px 18px',
              borderRadius: 4,
            }}
          >
            <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.13em', marginBottom: 12 }}>
              DEMO CREDENTIALS
            </div>
            {[
              ['admin', 'admin123'],
              ['engineer', 'engineer123'],
              ['tech', 'tech123'],
            ].map(([u, p]) => (
              <div key={u} className="mono" style={{ fontSize: 11, color: COLORS.textMuted, margin: '5px 0' }}>
                <span style={{ color: COLORS.textSec }}>{u}</span>
                {' / '}
                {p}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT – FORM */}
        <div
          style={{
            background: COLORS.cardBg,
            border: `1px solid ${COLORS.borderFaint}`,
            borderRadius: 6,
            padding: 26,
          }}
        >
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              border: `1px solid ${COLORS.borderFaint}`,
              borderRadius: 4,
              overflow: 'hidden',
              marginBottom: 26,
            }}
          >
            {ROLE_KEYS.map((k) => {
              const active = k === selectedRole;
              return (
                <button
                  key={k}
                  onClick={() => switchRole(k)}
                  style={{
                    flex: 1,
                    background: active ? tabActiveBg : 'transparent',
                    border: 'none',
                    color: active ? tabActiveText : tabText,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10.5,
                    letterSpacing: '0.1em',
                    padding: '10px 8px',
                    cursor: 'pointer',
                    transition: 'background 0.14s, color 0.14s',
                    borderRight: k !== 'technician' ? `1px solid ${COLORS.borderFaint}` : 'none',
                  }}
                >
                  {ROLE_LOGIN[k].tab.toUpperCase()}
                </button>
              );
            })}
          </div>

          {/* Operator ID */}
          <div style={{ marginBottom: 16 }}>
            <label className="mono" style={{ display: 'block', fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.13em', marginBottom: 7 }}>
              OPERATOR ID
            </label>
            <input
              type="text"
              value={opId}
              onChange={(e) => setOpId(e.target.value)}
              style={{
                width: '100%',
                background: inputBg,
                border: `1px solid ${COLORS.borderSub}`,
                borderRadius: 4,
                padding: '11px 14px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                color: COLORS.textSec,
                outline: 'none',
              }}
            />
          </div>

          {/* Passcode */}
          <div style={{ marginBottom: 20 }}>
            <label className="mono" style={{ display: 'block', fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.13em', marginBottom: 7 }}>
              PASSCODE
            </label>
            <input
              type="password"
              value={opPw}
              onChange={(e) => setOpPw(e.target.value)}
              style={{
                width: '100%',
                background: inputBg,
                border: `1px solid ${COLORS.borderSub}`,
                borderRadius: 4,
                padding: '11px 14px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                color: COLORS.textSec,
                outline: 'none',
              }}
            />
          </div>

          {/* Submit */}
          <button
            onClick={() => router.push(`/${selectedRole}`)}
            onMouseEnter={() => setHovBtn(true)}
            onMouseLeave={() => setHovBtn(false)}
            style={{
              width: '100%',
              background: hovBtn ? '#e2e8f0' : COLORS.textPrimary,
              color: '#0a0b0d',
              border: 'none',
              padding: '13px 16px',
              borderRadius: 4,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {meta.btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const tabActiveBg = '#ffffff';
const tabActiveText = '#0a0b0d';
const tabText = '#64748b';
