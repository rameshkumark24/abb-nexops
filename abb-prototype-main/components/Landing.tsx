'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NavBar, MicroLabel, Field, Button } from './Shared';
import { IconShield } from './Icons';
import { useAuth, ROLE_ROUTE } from '@/context/AuthContext';

const ROLE_LOGIN = {
  admin: { tab: 'Plant', btnLabel: 'Enter Plant Manager Console', id: 'plant', pw: 'nexops123' },
  engineer: { tab: 'Field', btnLabel: 'Enter Field Manager Console', id: 'fieldA', pw: 'nexops123' },
  technician: { tab: 'Technician', btnLabel: 'Enter Technician Console', id: 'ravi', pw: 'nexops123' },
};

const ROLE_KEYS = ['admin', 'engineer', 'technician'] as const;

export default function Landing() {
  const [selectedRole, setSelectedRole] = useState<'admin' | 'engineer' | 'technician'>('admin');
  const [opId, setOpId] = useState(ROLE_LOGIN.admin.id);
  const [opPw, setOpPw] = useState(ROLE_LOGIN.admin.pw);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const { login } = useAuth();

  function switchRole(r: 'admin' | 'engineer' | 'technician') {
    setSelectedRole(r);
    setOpId(ROLE_LOGIN[r].id);
    setOpPw(ROLE_LOGIN[r].pw);
    setError(null);
  }

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const res = await login(opId.trim().toLowerCase(), opPw);
    setSubmitting(false);
    if (res.ok) {
      router.push(ROLE_ROUTE[res.user.role] ?? '/');
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="abb-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <NavBar />

      <div className="abb-shell abb-hero" style={{ flex: 1 }}>
        {/* Left Column: Branding and Description */}
        <div className="fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div
            className="abb-data"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--abb-surface-2)',
              border: '1px solid var(--abb-line)',
              padding: '5px 12px',
              borderRadius: 'var(--abb-radius-sm)',
              fontSize: 9,
              color: 'var(--abb-ink-1)',
              letterSpacing: '0.1em',
              marginBottom: 26,
            }}
          >
            <IconShield size={12} color="var(--abb-red)" /> <span style={{ fontWeight: 600 }}>CONTROL SYSTEM ACCESS</span>
          </div>

          <h1
            style={{
              fontFamily: 'var(--abb-font-ui)',
              fontSize: 'clamp(40px, 6vw, 64px)',
              fontWeight: 800,
              lineHeight: 1.05,
              color: 'var(--abb-ink-0)',
              letterSpacing: '-0.03em',
              marginBottom: 12,
              textTransform: 'uppercase',
            }}
          >
            NEX<span style={{ color: 'var(--abb-red)' }}>OPS</span>
          </h1>

          <h2
            style={{
              fontFamily: 'var(--abb-font-ui)',
              fontSize: 'clamp(16px, 2vw, 20px)',
              fontWeight: 400,
              lineHeight: 1.3,
              color: 'var(--abb-ink-1)',
              marginBottom: 24,
            }}
          >
            AI-Powered Industrial Control Room Platform
          </h2>

          <p
            style={{
              fontSize: 13.5,
              color: 'var(--abb-ink-2)',
              lineHeight: 1.82,
              maxWidth: 480,
              marginBottom: 0,
            }}
          >
            NexOps is the intelligence layer between machine data and human action. AI-prioritized alarms, automated engineer
            dispatch, and institutional memory that never retires — in a grey-first interface where colour only means criticality.
          </p>
        </div>

        {/* Right Column: Direct Sign In Form */}
        <div className="fade-in-up" style={{ display: 'flex', justifyContent: 'flex-start', width: '100%', animationDelay: '0.25s' }}>
          <div
            style={{
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              borderTop: '3px solid var(--abb-red)',
              borderRadius: 'var(--abb-radius)',
              boxShadow: '0 8px 32px rgba(20,26,38,0.08), 0 2px 8px rgba(20,26,38,0.04)',
              padding: 30,
              width: '100%',
              maxWidth: 420,
            }}
          >
            <div style={{ marginBottom: 20 }}>
              <MicroLabel style={{ marginBottom: 6 }}>SYSTEM AUTHENTICATION</MicroLabel>
              <div style={{ fontSize: 12, color: 'var(--abb-ink-2)' }}>
                Select your operator role to populate credentials
              </div>
            </div>

            {/* Role Tab Switcher */}
            <div
              style={{
                display: 'flex',
                border: '1px solid var(--abb-line)',
                borderRadius: 'var(--abb-radius-sm)',
                overflow: 'hidden',
                marginBottom: 24,
                background: 'var(--abb-surface-2)',
              }}
            >
              {ROLE_KEYS.map((k) => {
                const active = k === selectedRole;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => switchRole(k)}
                    style={{
                      flex: 1,
                      background: active ? 'var(--abb-ink-0)' : 'transparent',
                      border: 'none',
                      color: active ? '#ffffff' : 'var(--abb-ink-2)',
                      fontFamily: 'var(--abb-font-data)',
                      fontSize: 10.5,
                      letterSpacing: '0.08em',
                      padding: '10px 8px',
                      cursor: 'pointer',
                      transition: 'background 0.14s, color 0.14s',
                      borderRight: k !== 'technician' ? '1px solid var(--abb-line)' : 'none',
                    }}
                  >
                    {ROLE_LOGIN[k].tab.toUpperCase()}
                  </button>
                );
              })}
            </div>

            {/* Fields */}
            <Field
              label="OPERATOR ID"
              type="text"
              value={opId}
              onChange={(e) => setOpId(e.target.value)}
              style={{ marginBottom: 16 }}
            />
            <Field
              label="PASSCODE"
              type="password"
              value={opPw}
              onChange={(e) => setOpPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              style={{ marginBottom: 20 }}
            />

            {/* Error Message */}
            {error && (
              <div
                className="abb-data"
                style={{
                  marginBottom: 16,
                  padding: '10px 12px',
                  background: 'var(--abb-alarm-soft)',
                  border: '1px solid var(--abb-alarm-line)',
                  borderRadius: 'var(--abb-radius-sm)',
                  fontSize: 11,
                  color: 'var(--abb-alarm-strong)',
                  letterSpacing: '0.02em',
                }}
              >
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={submitting}
              style={{ width: '100%', padding: '12px 16px' }}
            >
              {submitting ? 'AUTHENTICATING…' : ROLE_LOGIN[selectedRole].btnLabel.toUpperCase()}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
