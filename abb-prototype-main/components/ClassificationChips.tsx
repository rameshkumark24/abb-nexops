'use client';

// ClassificationChips — reusable fault-classification filter chip row
// (Section 3A on the technician console; also available to /admin). ALL +
// per-classification chips with live count badges and OR-logic multi-select.

import React from 'react';

export interface ChipCategory {
  key: string; // e.g. 'mechanical'
  label: string; // e.g. 'MECHANICAL'
  count: number;
}

// Classification → ABB-token colour scheme (matches the task-card left border).
export const CLASSIFICATION_COLOR: Record<string, { fg: string; bg: string; border: string }> = {
  mechanical: { fg: '#2563eb', bg: '#dbeafe', border: '#2563eb' },
  electrical: { fg: '#7c3aed', bg: '#ede9fe', border: '#7c3aed' },
  thermal: { fg: 'var(--abb-warning)', bg: 'var(--abb-warning-soft)', border: 'var(--abb-warning-line)' },
  hydraulic: { fg: '#0e7490', bg: '#cffafe', border: '#0e7490' },
  general: { fg: 'var(--abb-ink-2)', bg: 'var(--abb-surface-2)', border: 'var(--abb-line)' },
};

export function classColor(key: string) {
  return CLASSIFICATION_COLOR[key.toLowerCase()] ?? CLASSIFICATION_COLOR.general;
}

export function ClassificationChips({
  categories,
  active,
  onChange,
}: {
  categories: ChipCategory[];
  active: string[]; // empty array == ALL
  onChange: (next: string[]) => void;
}) {
  const allActive = active.length === 0;

  const toggle = (key: string) => {
    if (active.includes(key)) {
      onChange(active.filter((k) => k !== key));
    } else {
      onChange([...active, key]);
    }
  };

  const totalCount = categories.reduce((a, c) => a + c.count, 0);

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => onChange([])}
        className="abb-data"
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          padding: '6px 12px',
          borderRadius: 'var(--abb-radius-pill)',
          cursor: 'pointer',
          border: `1px solid ${allActive ? 'var(--abb-ink-2)' : 'var(--abb-line)'}`,
          background: allActive ? 'var(--abb-surface-2)' : 'var(--abb-surface-1)',
          color: allActive ? 'var(--abb-ink-0)' : 'var(--abb-ink-3)',
        }}
      >
        ALL ({totalCount})
      </button>
      {categories.map((c) => {
        const on = !allActive && active.includes(c.key);
        const col = classColor(c.key);
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            className="abb-data"
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              padding: '6px 12px',
              borderRadius: 'var(--abb-radius-pill)',
              cursor: 'pointer',
              border: `1px solid ${on ? col.border : 'var(--abb-line)'}`,
              background: on ? col.bg : 'var(--abb-surface-1)',
              color: on ? col.fg : 'var(--abb-ink-3)',
              transition: 'all 0.15s ease',
            }}
          >
            {c.label} ({c.count})
          </button>
        );
      })}
    </div>
  );
}
