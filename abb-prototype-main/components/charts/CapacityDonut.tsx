'use client';

// CapacityDonut — Field Manager capacity overview (Section 2C). recharts donut
// (innerRadius=30) over two slices: available vs at-capacity task slots across
// the zone's engineers. Centre label shows free / total slots.

import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { CAPACITY_AVAILABLE, CAPACITY_ATCAP, TOOLTIP_STYLE } from '@/lib/chartPalette';

export function CapacityDonut({ free, occupied, total }: { free: number; occupied: number; total: number }) {
  const data = [
    { name: 'Available', value: Math.max(0, free) },
    { name: 'At capacity', value: Math.max(0, occupied) },
  ];
  const hasData = total > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie
              data={hasData ? data : [{ name: 'none', value: 1 }]}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={30}
              outerRadius={46}
              startAngle={90}
              endAngle={-270}
              stroke="var(--abb-surface-1)"
              strokeWidth={2}
            >
              {hasData ? (
                <>
                  <Cell fill={CAPACITY_AVAILABLE} />
                  <Cell fill={CAPACITY_ATCAP} />
                </>
              ) : (
                <Cell fill="var(--abb-surface-3)" />
              )}
            </Pie>
            {hasData && <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [`${v} slot(s)`, String(n)]} />}
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div className="abb-data" style={{ fontSize: 15, fontWeight: 700, color: 'var(--abb-ink-0)' }}>{free}</div>
          <div className="abb-micro" style={{ fontSize: 7.5 }}>/ {total} free</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: CAPACITY_AVAILABLE }} />
          <span className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-2)' }}>Available <strong style={{ color: 'var(--abb-ink-0)' }}>{free}</strong></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: CAPACITY_ATCAP }} />
          <span className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-2)' }}>At capacity <strong style={{ color: 'var(--abb-ink-0)' }}>{occupied}</strong></span>
        </div>
        <div className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)' }}>
          {total > 0 ? `${Math.round((free / total) * 100)}% free across zone` : 'no engineers'}
        </div>
      </div>
    </div>
  );
}
