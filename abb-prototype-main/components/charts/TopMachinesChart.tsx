'use client';

// TopMachinesChart — TOP 5 PROBLEM MACHINES (Section 1F). Horizontal recharts
// bar chart, bar colour scaled amber→red by count relative to max. Clicking a
// bar calls onSelect(machine) so the page can scroll/highlight the machine in
// the Live Machine Analytics list.

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { AXIS_TEXT, GRID_LINE, TOOLTIP_STYLE } from '@/lib/chartPalette';

export interface MachineCount {
  name: string;
  zone: string; // e.g. 'Zone A'
  count: number;
}

// amber-400 (#fbbf24) → red-600 (#c1121f) by intensity.
function barColor(count: number, max: number): string {
  if (max <= 0) return '#fbbf24';
  const t = count / max;
  if (t > 0.8) return '#c1121f';
  if (t > 0.6) return '#ea580c';
  if (t > 0.4) return '#f59e0b';
  return '#fbbf24';
}

export function TopMachinesChart({
  data,
  onSelect,
}: {
  data: MachineCount[];
  onSelect?: (machine: string) => void;
}) {
  if (data.length === 0) {
    return (
      <div className="abb-data" style={{ padding: '28px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
        Collecting per-machine alarm counts…
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div style={{ width: '100%', height: Math.max(data.length * 42, 160) }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            width={108}
            tick={{ fontSize: 10, fill: AXIS_TEXT, fontFamily: 'var(--abb-font-data)' }}
            tickLine={false}
            axisLine={{ stroke: GRID_LINE }}
          />
          <Tooltip
            cursor={{ fill: 'rgba(20,26,38,0.04)' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, _n, item) => {
              const p = (item as { payload?: MachineCount })?.payload;
              return [`${Number(value) || 0} alarms · ${p?.zone ?? ''}`, p?.name ?? ''];
            }}
          />
          <Bar
            dataKey="count"
            radius={[0, 3, 3, 0]}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={(d: { payload?: MachineCount }) => d?.payload && onSelect?.(d.payload.name)}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={barColor(d.count, max)} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              content={(props: {
                x?: number | string;
                y?: number | string;
                width?: number | string;
                height?: number | string;
                index?: number;
              }) => {
                const x = Number(props.x ?? 0);
                const y = Number(props.y ?? 0);
                const width = Number(props.width ?? 0);
                const height = Number(props.height ?? 0);
                const row = data[props.index ?? 0];
                if (!row) return null;
                return (
                  <text
                    x={x + width + 6}
                    y={y + height / 2}
                    dominantBaseline="central"
                    fontSize={10}
                    fontFamily="var(--abb-font-data)"
                    fill="var(--abb-ink-2)"
                  >
                    {row.count} · {row.zone.replace('Zone ', 'Z')}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
