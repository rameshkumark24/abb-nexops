import { ReactNode } from 'react';
import { IconLock } from './Icons';

const COLORS = {
  textPrimary: '#f1f5f9',
  textSec: '#94a3b8',
  textMuted: '#64748b',
  textFaint: '#475569',
  borderFaint: '#1a1d27',
  borderSub: '#222636',
  green: '#22c55e',
  greenBg: 'rgba(20,83,45,0.5)',
  greenBorder: '#166534',
  navBg: 'rgba(10,11,13,0.92)',
  cardBg: '#0f1117',
  cardBgHov: '#13161e',
  panelBg: '#0c0e14',
};

export const Dot = ({ color, cls = 'pulse', size = 7 }: { color: string; cls?: string; size?: number }) => (
  <span
    className={cls}
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
    }}
  />
);

export const NavBar = ({ onBack }: { onBack?: () => void }) => (
  <nav
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 32px',
      borderBottom: `1px solid ${COLORS.borderFaint}`,
      background: COLORS.navBg,
      backdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {onBack ? (
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: COLORS.textSec,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          NEXOPS
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 20,
              height: 20,
              background: '#13161e',
              border: `1px solid ${COLORS.borderSub}`,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ width: 8, height: 8, background: COLORS.textPrimary, borderRadius: '50%' }} />
          </div>
          <div>
            <div
              className="mono"
              style={{ fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, letterSpacing: '0.05em' }}
            >
              NexOps
            </div>
            <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.12em' }}>
              PENGUINS · ABB ACCELERATOR 2026
            </div>
          </div>
        </div>
      )}
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {onBack ? (
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#0c0e14',
            border: `1px solid ${COLORS.borderSub}`,
            padding: '6px 12px',
            borderRadius: 4,
            fontSize: 10,
            color: COLORS.textMuted,
            letterSpacing: '0.1em',
          }}
        >
          <IconLock size={12} color={COLORS.textFaint} /> SECURE OPERATOR LOGIN
        </div>
      ) : (
        <>
          <div
            className="mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: COLORS.greenBg,
              border: `1px solid ${COLORS.greenBorder}`,
              padding: '5px 12px',
              borderRadius: 4,
              fontSize: 10,
              color: COLORS.green,
              letterSpacing: '0.12em',
            }}
          >
            <Dot color={COLORS.green} size={6} />
            PROTOTYPE LIVE
          </div>
          <div
            className="mono"
            style={{
              background: 'transparent',
              border: `1px solid ${COLORS.borderFaint}`,
              padding: '5px 12px',
              borderRadius: 4,
              fontSize: 10,
              color: COLORS.textFaint,
              letterSpacing: '0.1em',
            }}
          >
            V0.9 · HUSH DEMO
          </div>
        </>
      )}
    </div>
  </nav>
);

export { COLORS };
