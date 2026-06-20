'use client';

// FilterBar — the sticky global toolbar that drives EVERY chart and table on
// /admin simultaneously (Section 1B). Controlled component: the page owns the
// AdminFilters state and recomputes all widget data from it.

import React, { useState } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';

export type DateRangeKey = '1h' | '6h' | '24h' | '7d' | 'custom';
export type SortKey = 'risk' | 'alarms' | 'perf' | 'zone';
// Severity pills (Section 1B). NOMINAL only affects the live machine list —
// alarm events are by definition non-nominal.
export type SeverityFilter = 'NOMINAL' | 'WARNING' | 'EARLY' | 'CRITICAL';

export interface AdminFilters {
  range: DateRangeKey;
  customFrom: string; // datetime-local value, used only when range === 'custom'
  customTo: string;
  zones: string[]; // subset of ['A','B','C','D']
  severities: SeverityFilter[];
  sort: SortKey;
}

export const ALL_ZONES = ['A', 'B', 'C', 'D'];
export const ALL_SEVERITIES: SeverityFilter[] = ['NOMINAL', 'WARNING', 'EARLY', 'CRITICAL'];

export const DEFAULT_FILTERS: AdminFilters = {
  range: '24h',
  customFrom: '',
  customTo: '',
  zones: [...ALL_ZONES],
  severities: [...ALL_SEVERITIES],
  sort: 'risk',
};

const RANGE_OPTIONS: { key: DateRangeKey; label: string }[] = [
  { key: '1h', label: 'Last 1h' },
  { key: '6h', label: 'Last 6h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7d' },
  { key: 'custom', label: 'Custom' },
];

const RANGE_MS: Record<Exclude<DateRangeKey, 'custom'>, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

// Resolve the active [from, to] window (epoch ms) from the filter state.
export function resolveWindow(f: AdminFilters): { from: number; to: number } {
  if (f.range === 'custom') {
    const from = f.customFrom ? new Date(f.customFrom).getTime() : 0;
    const to = f.customTo ? new Date(f.customTo).getTime() : Date.now();
    return { from: Number.isFinite(from) ? from : 0, to: Number.isFinite(to) ? to : Date.now() };
  }
  const now = Date.now();
  return { from: now - RANGE_MS[f.range], to: now };
}


function Pill({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="abb-data"
      style={{
        fontSize: 10,
        letterSpacing: '0.06em',
        fontWeight: 600,
        padding: '5px 11px',
        borderRadius: 'var(--abb-radius-pill)',
        cursor: 'pointer',
        border: `1px solid ${active ? color ?? 'var(--abb-ink-2)' : 'var(--abb-line)'}`,
        background: active ? (color ? `${color}14` : 'var(--abb-surface-2)') : 'var(--abb-surface-1)',
        color: active ? color ?? 'var(--abb-ink-0)' : 'var(--abb-ink-3)',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

export function FilterBar({
  value,
  onChange,
  onSearchOpen,
}: {
  value: AdminFilters;
  onChange: (next: AdminFilters) => void;
  onSearchOpen?: () => void;
}) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleZone = (z: string) => {
    const isOnlySelected = value.zones.length === 1 && value.zones[0] === z;
    const zones = isOnlySelected ? [...ALL_ZONES] : [z];
    onChange({ ...value, zones });
  };

  // The control strip — shared between desktop bar and mobile sheet.
  // WINDOW + ZONES only; severity and sort are always at their operational defaults.
  const controls = (
    <>
      {/* Date range */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="abb-micro" style={{ fontSize: 9 }}>WINDOW</span>
        {RANGE_OPTIONS.map((r) => (
          <Pill key={r.key} active={value.range === r.key} onClick={() => onChange({ ...value, range: r.key })}>
            {r.label}
          </Pill>
        ))}
        {value.range === 'custom' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="datetime-local" className="abb-input" value={value.customFrom} onChange={(e) => onChange({ ...value, customFrom: e.currentTarget.value })} style={{ padding: '5px 8px', fontSize: 11, width: 'auto' }} />
            <span className="abb-micro" style={{ fontSize: 9 }}>→</span>
            <input type="datetime-local" className="abb-input" value={value.customTo} onChange={(e) => onChange({ ...value, customTo: e.currentTarget.value })} style={{ padding: '5px 8px', fontSize: 11, width: 'auto' }} />
          </span>
        )}
      </div>

      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--abb-line-faint)' }} />

      {/* Zone multi-select */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="abb-micro" style={{ fontSize: 9 }}>ZONES</span>
        {ALL_ZONES.map((z) => (
          <Pill key={z} active={value.zones.includes(z)} onClick={() => toggleZone(z)}>{z}</Pill>
        ))}
      </div>
    </>
  );

  // Mobile: single "Filters ▾" button + bottom-sheet drawer
  if (isMobile) {
    const activeCount =
      (value.zones.length < ALL_ZONES.length ? 1 : 0) +
      (value.range !== '24h' ? 1 : 0);

    return (
      <>
        <div style={{ position: 'sticky', top: 56, zIndex: 40, background: 'var(--abb-surface-1)', borderBottom: '1px solid var(--abb-line)', display: 'flex', alignItems: 'center', padding: '8px 16px', gap: 10 }}>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="abb-btn abb-data"
            style={{ fontSize: 11, fontWeight: 600, padding: '7px 16px', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            Filters {activeCount > 0 && <span style={{ background: 'var(--abb-early)', color: '#fff', borderRadius: 10, fontSize: 9, padding: '1px 6px', fontWeight: 700 }}>{activeCount}</span>} ▾
          </button>
          <span className="abb-micro" style={{ fontSize: 9, flex: 1 }}>{value.range.toUpperCase()} · ZONES {value.zones.join(',')}</span>
          {onSearchOpen && (
            <button
              type="button"
              onClick={onSearchOpen}
              aria-label="Search widgets"
              style={{ background: 'none', border: '1px solid var(--abb-line)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--abb-ink-2)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          )}
        </div>

        {sheetOpen && (
          <>
            <div onClick={() => setSheetOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(13,17,23,0.4)', zIndex: 80 }} />
            <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 90, background: 'var(--abb-surface-1)', borderTop: '3px solid var(--abb-red)', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '80vh', overflowY: 'auto', boxShadow: 'var(--abb-shadow-2)', animation: 'ariaSlideUp 0.22s cubic-bezier(0.22,1,0.36,1) both' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span className="abb-data" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>FILTERS</span>
                <button type="button" onClick={() => setSheetOpen(false)} style={{ background: 'none', border: '1px solid var(--abb-line)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--abb-ink-2)' }}>Done</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {controls}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div
      className="filter-bar"
      style={{
        position: 'sticky',
        top: 56,
        zIndex: 40,
        background: 'var(--abb-surface-1)',
        borderBottom: '1px solid var(--abb-line)',
        boxShadow: 'var(--abb-shadow-1)',
      }}
    >
      <div
        className="abb-shell"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          paddingTop: 10,
          paddingBottom: 10,
          minHeight: 48,
        }}
      >
        {controls}
        {onSearchOpen && (
          <button
            type="button"
            onClick={onSearchOpen}
            aria-label="Press Ctrl+K or click here to search for specific sections"
            title="Press Ctrl+K or click here to search for specific sections"
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7,
              background: 'none', border: '1px solid var(--abb-line)',
              borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
              color: 'var(--abb-ink-2)', transition: 'border-color 0.15s ease, color 0.15s ease',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--abb-ink-2)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--abb-ink-0)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--abb-line)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--abb-ink-2)'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="abb-micro" style={{ fontSize: 10, letterSpacing: '0.06em' }}>SEARCH</span>
            <kbd style={{ fontFamily: 'var(--abb-font-mono)', fontSize: 9, color: 'var(--abb-ink-3)', border: '1px solid var(--abb-line)', borderRadius: 3, padding: '1px 5px' }}>⌃K</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
