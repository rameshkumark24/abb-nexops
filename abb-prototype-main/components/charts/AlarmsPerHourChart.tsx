'use client';

// AlarmsPerHourChart — ALARMS PER HOUR · 24H TREND (Section 1D). Two non-stacked
// areas (Raw Gateway vs Dispatched) over 24 hourly bins, with the EEMUA 191
// reference line. Input bins are derived by the page from the live session
// alarm history (useAlarmHistory).

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { AXIS_TEXT, GRID_LINE, STATE, EEMUA_PER_HOUR, TOOLTIP_STYLE } from '@/lib/chartPalette';

export interface HourBin {
  label: string; // "00:00" .. "23:00"
  raw: number;
  dispatched: number;
}

export function AlarmsPerHourChart({ data }: { data: HourBin[] }) {
  const hasData = data.some((d) => d.raw > 0);

  return (
    <div style={{ width: '100%', height: 220 }}>
      {!hasData && (
        <div className="abb-data" style={{ fontSize: 9, color: 'var(--abb-ink-3)', marginBottom: 4, letterSpacing: '0.04em' }}>
          Collecting hourly alarms this session…
        </div>
      )}
      <ResponsiveContainer width="100%" height={hasData ? '100%' : 196} minWidth={0}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="rawGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#cbd2da" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#cbd2da" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="dispGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_LINE} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 8, fill: AXIS_TEXT, fontFamily: 'var(--abb-font-data)' }}
            interval={3}
            tickLine={false}
            axisLine={{ stroke: GRID_LINE }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: AXIS_TEXT, fontFamily: 'var(--abb-font-data)' }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            width={32}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(l) => `${l}`}
            formatter={(value, name, item) => {
              const v = Number(value) || 0;
              if (name === 'Raw Gateway') {
                const p = (item as { payload?: HourBin })?.payload;
                const filtered = p ? p.raw - p.dispatched : 0;
                return [`${v} (filtered ${filtered})`, 'Raw'];
              }
              return [`${v}`, 'Dispatched'];
            }}
          />
          <ReferenceLine
            y={EEMUA_PER_HOUR}
            stroke={STATE.critical}
            strokeDasharray="4 3"
            label={{ value: 'EEMUA limit', position: 'insideTopRight', fontSize: 8, fill: STATE.critical }}
          />
          <Area type="monotone" dataKey="raw" name="Raw Gateway" stroke="#6c7480" strokeWidth={1.5} fill="url(#rawGrad)" />
          <Area type="monotone" dataKey="dispatched" name="Dispatched" stroke="#2563eb" strokeWidth={1.5} fill="url(#dispGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
