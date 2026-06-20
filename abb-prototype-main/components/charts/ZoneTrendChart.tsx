'use client';

// ZoneTrendChart — ZONE ALARM TREND · 6H (Section 2D, tile 1). recharts line of
// the zone's alarm count in 10-minute buckets over the last 6 hours, with the
// EEMUA 191 reference line (1 alarm / 10 min = 1 per bucket). Bins are derived
// by the page from the live session alarm history.

import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { AXIS_TEXT, GRID_LINE, STATE, TOOLTIP_STYLE } from '@/lib/chartPalette';

export interface TrendBin {
  label: string; // "HH:MM"
  count: number;
}

// EEMUA: <= 1 alarm per 10 minutes; each bucket is 10 minutes, so target = 1.
const EEMUA_PER_BUCKET = 1;

export function ZoneTrendChart({ data }: { data: TrendBin[] }) {
  const hasData = data.some((d) => d.count > 0);
  return (
    <div style={{ width: '100%', height: 150 }}>
      {!hasData && (
        <div className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', marginBottom: 2 }}>Collecting 10-min buckets this session…</div>
      )}
      <ResponsiveContainer width="100%" height={hasData ? '100%' : 128} minWidth={0}>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_LINE} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 8, fill: AXIS_TEXT, fontFamily: 'var(--abb-font-data)' }} interval={5} tickLine={false} axisLine={{ stroke: GRID_LINE }} />
          <YAxis tick={{ fontSize: 9, fill: AXIS_TEXT, fontFamily: 'var(--abb-font-data)' }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${Number(v) || 0} alarms`, 'Zone']} />
          <ReferenceLine y={EEMUA_PER_BUCKET} stroke={STATE.critical} strokeDasharray="4 3" label={{ value: 'EEMUA', position: 'insideTopRight', fontSize: 8, fill: STATE.critical }} />
          <Line type="monotone" dataKey="count" stroke={STATE.early} strokeWidth={1.6} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
