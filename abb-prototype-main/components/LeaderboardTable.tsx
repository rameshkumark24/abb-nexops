'use client';

// LeaderboardTable — Engineer leaderboard (Section 1G). Points are computed
// CLIENT-SIDE from real data only: the engineer roster (getEngineers) + the
// lifecycle task history (fetchTasks include_resolved). No hardcoded names or
// scores.
//
// Points formula (from available fields):
//   +10  per completed (resolved) task
//   +5   speed bonus when resolution_minutes <= 30
//   +2   per on-duty hour  — NO source on the API → omitted, noted in tooltip
//   +15  early-catch assist — LifecycleTask carries no is_early → omitted, noted
//
// Period badge cycles 1D ↔ 7D, re-filtering the same computation by resolved_at.

import { useMemo, useState } from 'react';
import type { Engineer } from '@/lib/tasksApi';
import type { LifecycleTask } from '@/types/telemetry';

interface Row {
  id: number;
  name: string;
  zone: string;
  points: number;
  tasksDone: number;
  avgMttr: number | null;
  earlyAssists: number | null; // null = data pending
}

const MEDAL = ['🥇', '🥈', '🥉'];
// Token-mapped so borders adapt in dark mode: gold → warning, silver → ink-3, bronze → high
const RANK_BORDER = ['var(--abb-warning)', 'var(--abb-ink-3)', 'var(--abb-high)'];

function withinDays(iso: string | null, days: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= days * 24 * 60 * 60 * 1000;
}

export function LeaderboardTable({
  engineers,
  tasks,
  mobile = false,
}: {
  engineers: Engineer[];
  tasks: LifecycleTask[];
  mobile?: boolean;
}) {
  const [periodDays, setPeriodDays] = useState<1 | 7>(1);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map<number, Row>();
    // Seed from the roster so engineers with zero completions still appear.
    for (const e of engineers) {
      byId.set(e.id, {
        id: e.id,
        name: e.name,
        zone: e.zone,
        points: 0,
        tasksDone: 0,
        avgMttr: null,
        earlyAssists: null,
      });
    }
    const mttrAcc = new Map<number, { sum: number; n: number }>();

    for (const t of tasks) {
      if (t.status !== 'resolved' || t.engineer_id == null) continue;
      if (!withinDays(t.resolved_at, periodDays)) continue;
      let row = byId.get(t.engineer_id);
      if (!row) {
        // Resolver no longer on the active roster — still credit them.
        row = {
          id: t.engineer_id,
          name: t.engineer_name ?? `Engineer ${t.engineer_id}`,
          zone: t.zone ?? '—',
          points: 0,
          tasksDone: 0,
          avgMttr: null,
          earlyAssists: null,
        };
        byId.set(t.engineer_id, row);
      }
      row.tasksDone += 1;
      row.points += 10;
      if (t.resolution_minutes != null && t.resolution_minutes <= 30) row.points += 5;
      if (t.resolution_minutes != null) {
        const acc = mttrAcc.get(t.engineer_id) ?? { sum: 0, n: 0 };
        acc.sum += t.resolution_minutes;
        acc.n += 1;
        mttrAcc.set(t.engineer_id, acc);
      }
    }

    for (const [id, acc] of mttrAcc) {
      const row = byId.get(id);
      if (row && acc.n > 0) row.avgMttr = acc.sum / acc.n;
    }

    return Array.from(byId.values()).sort((a, b) => b.points - a.points);
  }, [engineers, tasks, periodDays]);

  const ranked = rows.slice(0, 10);
  const limit = mobile && !showAll ? 5 : ranked.length;
  const visible = ranked.slice(0, limit);

  // Top-quartile points threshold for the green highlight.
  const q75 = useMemo(() => {
    const pts = ranked.map((r) => r.points).filter((p) => p > 0);
    if (pts.length === 0) return Infinity;
    const sorted = [...pts].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.75)] ?? sorted[sorted.length - 1];
  }, [ranked]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => setPeriodDays((p) => (p === 1 ? 7 : 1))}
          className="abb-badge abb-badge--early"
          style={{ cursor: 'pointer' }}
          title="Click to switch period"
        >
          {periodDays}D
        </button>
      </div>

      {ranked.length === 0 ? (
        <div className="abb-data" style={{ padding: '20px 0', textAlign: 'center', fontSize: 11, color: 'var(--abb-ink-3)', letterSpacing: '0.06em' }}>
          NO RESOLVED TASKS IN THE LAST {periodDays === 1 ? '24 HOURS' : `${periodDays} DAYS`}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="abb-table" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>Rank</th>
                <th>Name</th>
                <th>Zone</th>
                <th style={{ textAlign: 'right' }}>Points</th>
                <th style={{ textAlign: 'right' }}>Tasks</th>
                <th style={{ textAlign: 'right' }}>Avg MTTR</th>
                <th style={{ textAlign: 'right' }}>Early</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const topQuartile = r.points > 0 && r.points >= q75;
                return (
                  <tr key={r.id} style={{ borderLeft: i < 3 ? `3px solid ${RANK_BORDER[i]}` : '3px solid transparent' }}>
                    <td style={{ fontWeight: 700 }}>
                      {i < 3
                        ? <span aria-label={['1st place', '2nd place', '3rd place'][i]}>{MEDAL[i]}</span>
                        : i + 1}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--abb-ink-0)' }}>{r.name}</td>
                    <td>
                      <span className="abb-data" style={{ fontSize: 11, color: 'var(--abb-ink-2)' }}>
                        {r.zone?.replace('Zone ', '') || '—'}
                      </span>
                    </td>
                    <td className="abb-data" style={{ textAlign: 'right', fontWeight: 700, color: topQuartile ? 'var(--abb-nominal)' : 'var(--abb-ink-1)' }}>
                      {r.points}
                    </td>
                    <td className="abb-data" style={{ textAlign: 'right' }}>{r.tasksDone}</td>
                    <td className="abb-data" style={{ textAlign: 'right', color: 'var(--abb-ink-2)' }}>
                      {r.avgMttr != null ? `${r.avgMttr.toFixed(0)}m` : '—'}
                    </td>
                    <td
                      className="abb-data"
                      style={{ textAlign: 'right', color: 'var(--abb-ink-3)' }}
                      title="Early-catch assists require an is_early flag the task API does not expose — data pending"
                    >
                      —
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {mobile && ranked.length > 5 && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="abb-btn abb-btn--ghost"
            style={{ fontSize: 10, padding: '5px 12px' }}
          >
            {showAll ? 'Show less' : 'Show all'}
          </button>
        </div>
      )}

      <div className="abb-data" style={{ marginTop: 10, fontSize: 8.5, color: 'var(--abb-ink-3)', letterSpacing: '0.03em', lineHeight: 1.6 }}>
        Points = +10 / completion, +5 speed bonus (≤30m). Availability (+2/hr) &amp; early-catch (+15) omitted — not exposed by the task API.
      </div>
    </div>
  );
}
