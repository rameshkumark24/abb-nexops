'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NavBar, MicroLabel, Field, Button } from './Shared';
import { IconShield } from './Icons';
import { useAuth, ROLE_ROUTE } from '@/context/AuthContext';

// Each tab PREFILLS a real backend demo username (all share password
// 'nexops123'). The actual destination is decided by the role the SERVER returns
// from /auth/login (via ROLE_ROUTE), not by the tab — so typing any valid user
// routes correctly regardless of the tab selected.
const ROLE_LOGIN = {
  admin: { tab: 'Plant', btnLabel: 'Enter Plant Manager Console', id: 'plant', pw: 'nexops123' },
  engineer: { tab: 'Field', btnLabel: 'Enter Field Manager Console', id: 'fieldA', pw: 'nexops123' },
  technician: { tab: 'Technician', btnLabel: 'Enter Technician Console', id: 'ravi', pw: 'nexops123' },
};

const ROLE_KEYS = ['admin', 'engineer', 'technician'] as const;

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

  // Authenticate against POST /auth/login, then AUTO-ROUTE on the role the SERVER
  // returns (not the selected tab). On 401 show an inline error.
  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const res = await login(opId.trim(), opPw);
    setSubmitting(false);
    if (res.ok) {
      router.push(ROLE_ROUTE[res.user.role] ?? '/');
    } else {
      setError(res.error);
    }
  }

  const meta = ROLE_LOGIN[selectedRole];

  return (
    <div className="abb-page fade-in-up" style={{ display: 'flex', flexDirection: 'column' }}>
      <NavBar onBack={onBack} />

      {/* Body */}
      <div className="abb-shell abb-login-grid" style={{ flex: 1, paddingTop: 'clamp(32px, 5vw, 56px)', paddingBottom: 60 }}>
        {/* LEFT — intro + demo credentials */}
        <div>
          <div
            className="abb-data"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              padding: '5px 12px',
              borderRadius: 'var(--abb-radius-sm)',
              fontSize: 9,
              color: 'var(--abb-ink-3)',
              letterSpacing: '0.1em',
              marginBottom: 26,
            }}
          >
            <IconShield size={12} color="var(--abb-ink-3)" /> ROLE-BASED ACCESS
          </div>

          <h1 style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 'clamp(24px, 3.4vw, 30px)', fontWeight: 300, color: 'var(--abb-ink-0)', lineHeight: 1.18, marginBottom: 14 }}>
            Sign in to your console.
          </h1>
          <p style={{ fontSize: 13, color: 'var(--abb-ink-2)', lineHeight: 1.82, marginBottom: 28, maxWidth: 380 }}>
            Each operator role has its own view, alerts, and tools. Select your role and authenticate to enter the live control surface.
          </p>

          {/* Demo credentials — DEMO ONLY */}
          <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', padding: '16px 18px' }}>
            <MicroLabel style={{ marginBottom: 12 }}>DEMO CREDENTIALS · DEMO ONLY</MicroLabel>
            {[
              ['plant', 'nexops123', 'plant manager'],
              ['fieldA / fieldB / fieldC / fieldD', 'nexops123', 'field manager (zone)'],
              ['ravi / boris / yuki / …', 'nexops123', 'technician (first name)'],
            ].map(([u, p, note]) => (
              <div key={u} className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-2)', margin: '6px 0' }}>
                <span style={{ color: 'var(--abb-ink-0)' }}>{u}</span>
                {' / '}
                {p}
                <span style={{ color: 'var(--abb-ink-3)' }}>{`  — ${note}`}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — FORM */}
        <div style={{ background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius)', boxShadow: 'var(--abb-shadow-1)', padding: 26 }}>
          {/* Role tabs (prefill only — routing is server-driven) */}
          <div style={{ display: 'flex', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', overflow: 'hidden', marginBottom: 26 }}>
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
                    letterSpacing: '0.1em',
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

          {/* Operator ID + Passcode (primitives; same state wiring) */}
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
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            style={{ marginBottom: 20 }}
          />

          {/* Inline auth error (wrong password / backend down) */}
          {error && (
            <div
              className="abb-data"
              style={{
                marginBottom: 14,
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

          {/* Submit -> POST /auth/login, then auto-route by the returned role. */}
          <Button variant="primary" onClick={handleSubmit} disabled={submitting} style={{ width: '100%' }}>
            {submitting ? 'AUTHENTICATING…' : meta.btnLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
