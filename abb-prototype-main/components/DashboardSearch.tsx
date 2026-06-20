'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminLayout, WidgetDef } from '@/lib/adminLayout';

export interface DashboardSearchProps {
  open: boolean;
  onClose: () => void;
  widgets: WidgetDef[];
  layout: AdminLayout;
  onNavigate: (id: string) => void;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[·—\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

const SECTION_ACCENT: Record<string, string> = {
  'ZONE OVERVIEW':               'var(--abb-ink-1)',
  'MACHINE HEALTH':              'var(--abb-red)',
  'ALARM ANALYSIS':              'var(--abb-warning)',
  'PRIORITY & TEAM PERFORMANCE': 'var(--abb-early)',
  'SPATIAL INTELLIGENCE':        'var(--abb-early)',
  'NEXOPS PREDICTION ROI':       'var(--abb-nominal)',
  'WORKFORCE':                   'var(--abb-red)',
  'ANALYTICAL EXTRAS':           'var(--abb-ink-3)',
};

export function DashboardSearch({ open, onClose, widgets, layout, onNavigate }: DashboardSearchProps) {
  const [query, setQuery]         = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => widgets.filter((w) => {
    if (!query.trim()) return true;
    const q = normalize(query);
    return (
      normalize(w.title).includes(q) ||
      (w.subtitle    && normalize(w.subtitle).includes(q)) ||
      (w.sectionLabel && normalize(w.sectionLabel).includes(q))
    );
  }).slice(0, 8), [widgets, query]);

  const handleSelect = (id: string) => {
    onClose();
    onNavigate(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) handleSelect(results[selectedIndex].id);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(20,26,38,0.30)',
          zIndex: 200,
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Palette panel */}
      <div
        style={{
          position: 'fixed',
          top: '18%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(540px, 92vw)',
          background: 'var(--abb-surface-1)',
          borderRadius: 10,
          border: '1px solid var(--abb-line)',
          boxShadow: '0 28px 72px rgba(20,26,38,0.24)',
          zIndex: 201,
          overflow: 'hidden',
        }}
        role="dialog"
        aria-label="Widget search"
        aria-modal="true"
      >
        {/* Input row */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid var(--abb-line)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--abb-ink-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Jump to widget…"
            className="abb-data"
            aria-label="Search widgets"
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 14, color: 'var(--abb-ink-0)', outline: 'none',
              letterSpacing: '0.02em',
            }}
          />
          <kbd
            style={{
              fontFamily: 'var(--abb-font-mono)', fontSize: 10,
              color: 'var(--abb-ink-3)', border: '1px solid var(--abb-line)',
              borderRadius: 4, padding: '2px 7px', letterSpacing: 0,
            }}
          >
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div role="menu" aria-label="Widget results" style={{ maxHeight: 380, overflowY: 'auto' }}>
          {results.length === 0 ? (
            <div
              className="abb-data"
              style={{
                padding: '24px 18px', textAlign: 'center',
                fontSize: 12, color: 'var(--abb-ink-3)', letterSpacing: '0.06em',
              }}
            >
              NO MATCHING WIDGETS
            </div>
          ) : (
            results.map((w, i) => {
              const isSelected  = i === selectedIndex;
              const isCollapsed = !!layout.collapsed[w.id];
              const accent      = w.sectionLabel ? (SECTION_ACCENT[w.sectionLabel] ?? 'var(--abb-ink-3)') : undefined;

              return (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  aria-current={isSelected ? true : undefined}
                  onClick={() => handleSelect(w.id)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    width: '100%', padding: '10px 18px',
                    background: isSelected ? 'var(--abb-surface-2)' : 'transparent',
                    border: 'none',
                    borderLeft: `3px solid ${isSelected && accent ? accent : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.1s ease',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {w.sectionLabel && (
                      <div
                        className="abb-micro"
                        style={{
                          fontSize: 9, color: accent ?? 'var(--abb-ink-3)',
                          letterSpacing: '0.12em', marginBottom: 2,
                        }}
                      >
                        {w.sectionLabel}
                      </div>
                    )}
                    <div
                      className="abb-data"
                      style={{
                        fontSize: 12, fontWeight: 600,
                        color: isSelected ? 'var(--abb-ink-0)' : 'var(--abb-ink-1)',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {w.title}
                    </div>
                    {w.subtitle && (
                      <div
                        className="abb-data"
                        style={{
                          fontSize: 10, color: 'var(--abb-ink-3)', marginTop: 2,
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >
                        {w.subtitle}
                      </div>
                    )}
                  </div>

                  {isCollapsed && (
                    <span
                      className="abb-micro"
                      style={{
                        fontSize: 9, color: 'var(--abb-ink-3)',
                        border: '1px solid var(--abb-line)',
                        borderRadius: 4, padding: '2px 6px',
                        flexShrink: 0, alignSelf: 'center',
                      }}
                    >
                      COLLAPSED
                    </span>
                  )}

                  <svg
                    width="12" height="12" viewBox="0 0 24 24"
                    fill="none" stroke="var(--abb-ink-3)" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ alignSelf: 'center', flexShrink: 0, opacity: isSelected ? 1 : 0 }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div
          style={{
            display: 'flex', gap: 18, padding: '8px 18px',
            borderTop: '1px solid var(--abb-line-faint)',
            background: 'var(--abb-surface-2)',
          }}
        >
          {([['↑↓', 'navigate'], ['↵', 'jump to'], ['Esc', 'close']] as const).map(([key, label]) => (
            <span
              key={key}
              className="abb-data"
              style={{ fontSize: 10, color: 'var(--abb-ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <kbd
                style={{
                  fontFamily: 'var(--abb-font-mono)',
                  border: '1px solid var(--abb-line)',
                  borderRadius: 4, padding: '1px 5px', fontSize: 9,
                }}
              >
                {key}
              </kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
