import type React from 'react';
import { ReactNode } from 'react';
import { IconLock } from './Icons';

const COLORS = {
  textPrimary: 'var(--abb-ink-0, #1c2230)',
  textSec: 'var(--abb-ink-1, #39414f)',
  textMuted: 'var(--abb-ink-2, #5a6473)',
  textFaint: 'var(--abb-ink-3, #8b94a3)',
  borderFaint: 'var(--abb-line-faint, #e6e8ec)',
  borderSub: 'var(--abb-line, #d3d8df)',
  green: '#22c55e',
  greenBg: 'rgba(34,197,94,0.08)',
  greenBorder: 'rgba(34,197,94,0.2)',
  navBg: 'rgba(255,255,255,0.92)',
  cardBg: 'var(--abb-surface-1, #ffffff)',
  cardBgHov: 'var(--abb-surface-2, #e9ebef)',
  panelBg: 'var(--abb-surface-0, #f3f4f6)',
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

// NavBar — restyled to the ABB control-system LIGHT tokens (Stage UI-1). Props
// are UNCHANGED ({ onBack?, onLogout? }); only presentation moved to tokens, so
// every page that already renders <NavBar …/> inherits the new look untouched.
export const NavBar = ({ onBack, onLogout }: { onBack?: () => void; onLogout?: () => void }) => (
  <nav
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '14px clamp(16px, 4vw, 32px)',
      borderBottom: '1px solid var(--abb-line)',
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--abb-ink-1)',
            fontFamily: 'var(--abb-font-ui)',
            fontSize: 12,
            letterSpacing: '0.04em',
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
          <span style={{ fontWeight: 700 }}>NEX<span style={{ color: 'var(--abb-red)' }}>OPS</span></span>
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 24,
              height: 24,
              background: 'var(--abb-red)',
              borderRadius: 'var(--abb-radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: '#ffffff',
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4.5 19.5c1-3.5 3-6.5 5.5-9L17.5 3c1.5-1.5 3.5-1 4 0s1.5 2.5 0 4L14 14.5c-2.5 2.5-5.5 4.5-9 5.5z" />
              <path d="M9.5 14.5L5 20l-1-4M14.5 9.5L20 5l-4-1" />
              <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
              <line x1="2" y1="22" x2="5" y2="19" />
              <line x1="0" y1="18" x2="2" y2="16" />
              <line x1="6" y1="24" x2="8" y2="22" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--abb-font-ui)', fontSize: 14, fontWeight: 700, color: 'var(--abb-ink-0)', letterSpacing: '-0.02em' }}>
              NEX<span style={{ color: 'var(--abb-red)' }}>OPS</span>
            </div>
            <div className="abb-micro" style={{ fontSize: 8.5, letterSpacing: '0.08em' }}>
              PENGUINS · ABB ACCELERATOR 2026
            </div>
          </div>
        </div>
      )}
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      {/* Logout (Stage 3c): rendered only when a page passes onLogout. */}
      {onLogout && (
        <button type="button" onClick={onLogout} className="abb-btn abb-btn--ghost" style={{ padding: '6px 12px', fontSize: 10, letterSpacing: '0.1em' }}>
          <IconLock size={12} color="var(--abb-ink-3)" /> LOG OUT
        </button>
      )}
      {onBack ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--abb-surface-2)',
            border: '1px solid var(--abb-line)',
            padding: '6px 12px',
            borderRadius: 'var(--abb-radius-sm)',
            fontFamily: 'var(--abb-font-data)',
            fontSize: 10,
            color: 'var(--abb-ink-2)',
            letterSpacing: '0.1em',
          }}
        >
          <IconLock size={12} color="var(--abb-ink-3)" /> SECURE OPERATOR LOGIN
        </div>
      ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: 'var(--abb-surface-1)',
              border: '1px solid var(--abb-line)',
              padding: '5px 12px',
              borderRadius: 'var(--abb-radius-sm)',
              fontFamily: 'var(--abb-font-data)',
              fontSize: 10,
              color: 'var(--abb-ink-2)',
              letterSpacing: '0.12em',
            }}
          >
            <Dot color="var(--abb-nominal)" size={6} cls="" />
            PROTOTYPE LIVE
          </div>
      )}
    </div>
  </nav>
);

// ----------------------------------------------------------------------
// ABB control-system PRIMITIVES (Stage UI-1, additive). Token-driven light
// HMI building blocks the restyled Home/Login use and later pages can adopt.
// Pure presentational; no data/logic.
// ----------------------------------------------------------------------

// Risk ladder -> token (used for risk tags / dots). LOW=quiet grey, MEDIUM=amber,
// HIGH=deep-orange, CRITICAL=red. RED is reserved for CRITICAL only.
export const RISK_TOKEN: Record<string, string> = {
  LOW: 'var(--abb-nominal)',
  MEDIUM: 'var(--abb-warning)',
  HIGH: 'var(--abb-high)',
  CRITICAL: 'var(--abb-alarm)',
};

// Semantic state -> token (nominal/warning/early/critical/nuisance).
export const STATE_TOKEN = {
  nominal: 'var(--abb-nominal)',
  warning: 'var(--abb-warning)',
  early: 'var(--abb-early)',
  critical: 'var(--abb-alarm)',
  nuisance: 'var(--abb-nuisance)',
} as const;

// Uppercase micro field-label (control-panel convention).
export const MicroLabel = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => (
  <div className="abb-micro" style={style}>{children}</div>
);

// Card / panel surface.
export const Panel = ({
  children,
  interactive = false,
  className = '',
  style,
  ...rest
}: {
  children: ReactNode;
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`abb-card${interactive ? ' abb-card--interactive' : ''} ${className}`} style={style} {...rest}>
    {children}
  </div>
);

// Badge — EARLY / NUISANCE-FILTERED / WARNING / HIGH / ALARM / NOMINAL.
export type BadgeVariant = 'nominal' | 'warning' | 'high' | 'early' | 'alarm' | 'nuisance';
export const Badge = ({
  variant = 'nominal',
  children,
  title,
  style,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  title?: string;
  style?: React.CSSProperties;
}) => (
  <span className={`abb-badge abb-badge--${variant}`} title={title} style={style}>{children}</span>
);

// Button (presentational). type defaults to 'button' so it never submits a form
// unexpectedly; callers wire onClick as before.
export const Button = ({
  variant = 'primary',
  children,
  className = '',
  style,
  type = 'button',
  ...rest
}: {
  variant?: 'primary' | 'ghost';
  children: ReactNode;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button type={type} className={`abb-btn abb-btn--${variant} ${className}`} style={{ fontWeight: 600, ...style }} {...rest}>
    {children}
  </button>
);

// Labelled form field (login). Spreads native input props (value/onChange/type…).
export const Field = ({
  label,
  style,
  ...inputProps
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label style={{ display: 'block', ...style }}>
    <span className="abb-micro" style={{ display: 'block', marginBottom: 7 }}>{label}</span>
    <input className="abb-input" {...inputProps} />
  </label>
);

export { COLORS };
