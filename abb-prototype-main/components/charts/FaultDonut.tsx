'use client';

// FaultDonut — FAULT TYPE BREAKDOWN (Section 1C). Groups the currently-active
// alarms by fault category (live, derived from machine state) into a recharts
// donut. No mock data: input is computed by the page from live `machines`.

import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { faultColor, TOOLTIP_STYLE } from '@/lib/chartPalette';

export interface FaultSlice {
  type: string; // fault category, lower-case
  count: number;
}

export function FaultDonut({ data }: { data: FaultSlice[] }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  const top = data.length ? [...data].sort((a, b) => b.count - a.count)[0] : null;
  const topPct = top && total > 0 ? Math.round((top.count / total) * 100) : 0;

  if (total === 0) {
    return (
      <div className="abb-data" style={{ padding: '36px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
        NO ACTIVE ALARMS — ALL NOMINAL
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* Donut + centre label */}
        <div style={{ position: 'relative', width: 180, height: 180, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="type"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={84}
                paddingAngle={2}
                stroke="var(--abb-surface-1)"
                strokeWidth={2}
              >
                {data.map((d) => (
                  <Cell key={d.type} fill={faultColor(d.type)} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name) => {
                  const v = Number(value) || 0;
                  return [`${v} alarms (${total > 0 ? Math.round((v / total) * 100) : 0}%)`, String(name)];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div className="abb-data" style={{ fontSize: 22, fontWeight: 700, color: 'var(--abb-ink-0)' }}>
              {top?.count ?? 0}
            </div>
            <div className="abb-micro" style={{ fontSize: 9, textTransform: 'capitalize' }}>
              {top?.type ?? '—'}
            </div>
          </div>
        </div>

        {/* Vertical legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 120, flex: 1 }}>
          {[...data]
            .sort((a, b) => b.count - a.count)
            .map((d) => (
              <div key={d.type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: faultColor(d.type), flexShrink: 0 }} />
                <span className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-1)', textTransform: 'capitalize', flex: 1 }}>
                  {d.type}
                </span>
                <span className="abb-data" style={{ fontSize: 11, fontWeight: 700, color: 'var(--abb-ink-0)' }}>{d.count}</span>
              </div>
            ))}
        </div>
      </div>

      {top && (
        <div
          style={{
            marginTop: 12,
            background: 'var(--abb-surface-2)',
            borderRadius: 'var(--abb-radius-pill)',
            padding: '6px 12px',
            fontSize: 10,
            color: 'var(--abb-ink-2)',
            display: 'inline-block',
          }}
        >
          <span aria-hidden="true">📍</span> <span style={{ textTransform: 'capitalize', fontWeight: 600, color: 'var(--abb-ink-0)' }}>{top.type}</span> is driving{' '}
          <span style={{ fontWeight: 700, color: faultColor(top.type) }}>{topPct}%</span> of active alarms
        </div>
      )}
    </div>
  );
}
