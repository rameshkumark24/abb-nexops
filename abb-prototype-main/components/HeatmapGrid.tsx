'use client';

// HeatmapGrid — Zone × Hour alarm-density heatmap (Section 1E). Custom CSS-grid
// build (no chart lib). 4 zone rows × 24 hour columns; cell colour scales from
// quiet grey → amber → red by alarm count. Horizontally scrollable on mobile.

import React, { useMemo, useState } from 'react';
import type { AlarmEvent } from '@/hooks/useAlarmHistory';

const ZONE_ROWS = ['A', 'B', 'C', 'D'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// 4 density stops for non-zero cells: amber-200 → amber-400 → orange → red-600
// (ABB: red only at top; zero cells use the CSS surface token so dark mode works).
const SCALE_NONZERO = ['#fef3c7', '#fcd34d', '#f59e0b', '#c1121f'];

function colorFor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return 'var(--abb-surface-3)';
  const t = value / max; // 0..1
  const idx = Math.min(SCALE_NONZERO.length - 1, Math.floor(t * SCALE_NONZERO.length));
  return SCALE_NONZERO[idx];
}

export function HeatmapGrid({ events }: { events: AlarmEvent[] }) {
  const currentHour = new Date().getHours();
  const [hover, setHover] = useState<{ zone: string; hour: number; count: number } | null>(null);

  const { matrix, max } = useMemo(() => {
    const m: Record<string, number[]> = {};
    ZONE_ROWS.forEach((z) => (m[z] = Array(24).fill(0)));
    let mx = 0;
    for (const e of events) {
      const z = e.zone.replace('Zone ', '').trim();
      if (!m[z]) continue;
      const h = new Date(e.ts).getHours();
      m[z][h] += 1;
      if (m[z][h] > mx) mx = m[z][h];
    }
    return { matrix: m, max: mx };
  }, [events]);

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 600 }}>
          {/* Hour header */}
          <div style={{ display: 'grid', gridTemplateColumns: `44px repeat(24, 1fr)`, gap: 2, marginBottom: 2 }}>
            <span />
            {HOURS.map((h) => (
              <span
                key={h}
                className="abb-data"
                style={{
                  fontSize: 8,
                  textAlign: 'center',
                  color: h === currentHour ? 'var(--abb-early)' : 'var(--abb-ink-3)',
                  fontWeight: h === currentHour ? 700 : 400,
                }}
              >
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>
          {/* Zone rows */}
          {ZONE_ROWS.map((z) => (
            <div key={z} style={{ display: 'grid', gridTemplateColumns: `44px repeat(24, 1fr)`, gap: 2, marginBottom: 2 }}>
              <span
                className="abb-data"
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--abb-ink-1)', display: 'flex', alignItems: 'center' }}
              >
                ZONE {z}
              </span>
              {HOURS.map((h) => {
                const count = matrix[z][h];
                return (
                  <div
                    key={h}
                    onMouseEnter={() => setHover({ zone: z, hour: h, count })}
                    onMouseLeave={() => setHover(null)}
                    title={`Zone ${z} · ${String(h).padStart(2, '0')}:00 — ${count} alarm${count === 1 ? '' : 's'}`}
                    style={{
                      height: 22,
                      borderRadius: 2,
                      background: colorFor(count, max),
                      borderLeft: h === currentHour ? '2px solid var(--abb-early-line)' : '2px solid transparent',
                      cursor: count > 0 ? 'pointer' : 'default',
                      transition: 'outline 0.1s ease',
                      outline:
                        hover && hover.zone === z && hover.hour === h ? '1.5px solid var(--abb-ink-2)' : 'none',
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend + live readout */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>0 alarms</span>
          <span
            style={{
              width: 120,
              height: 10,
              borderRadius: 5,
              background: `linear-gradient(to right, var(--abb-surface-3), ${SCALE_NONZERO.join(', ')})`,
              border: '1px solid var(--abb-line-faint)',
            }}
          />
          <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>
            {max > 0 ? `${max} (max)` : 'max'}
          </span>
        </div>
        <span className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>
          {hover
            ? `Zone ${hover.zone} · ${String(hover.hour).padStart(2, '0')}:00 — ${hover.count} alarm${hover.count === 1 ? '' : 's'}`
            : events.length === 0
            ? 'Collecting alarm density…'
            : `${events.length} events this session`}
        </span>
      </div>
    </div>
  );
}
