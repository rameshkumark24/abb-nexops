'use client';

// DashboardCard — the draggable, collapsible widget shell used by the Plant
// dashboard grid (Section 1A). Wraps any widget body in:
//   • a drag handle (⠿) top-left  (only when draggable)
//   • an all-caps micro title       (11px, tracking-widest, ink-3 grey)
//   • a collapse/expand chevron     top-right
// Built on @dnd-kit/sortable so widgets snap into the 12-col CSS grid on drop.

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface DashboardCardProps {
  id: string;
  title: string;
  subtitle?: string;
  /** Desktop grid column span (1–12). */
  span?: number;
  /** Locked widgets (e.g. KPI bar) render without a drag handle. */
  draggable?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: (id: string) => void;
  /** Optional left accent bar colour (e.g. ABB red for headline widgets). */
  accent?: string;
  /** Marks full-width widgets so the tablet breakpoint keeps them at span 12. */
  fullWidth?: boolean;
  headerRight?: React.ReactNode;
  /** Triggers a brief highlight ring — used after search-navigation jumps here. */
  highlight?: boolean;
  children: React.ReactNode;
}

export function DashboardCard({
  id,
  title,
  subtitle,
  span = 12,
  draggable = true,
  collapsed = false,
  onToggleCollapse,
  accent,
  fullWidth,
  headerRight,
  highlight = false,
  children,
}: DashboardCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });

  const style: React.CSSProperties = {
    gridColumn: `span ${span} / span ${span}`,
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    zIndex: isDragging ? 50 : undefined,
    boxShadow: isDragging ? '0 12px 32px rgba(20,26,38,0.18)' : undefined,
    borderTop: accent ? `3px solid ${accent}` : undefined,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  };

  return (
    <div
      ref={setNodeRef}
      id={`widget-${id}`}
      style={style}
      className={`abb-card dashboard-card${highlight ? ' dashboard-card--highlight' : ''}`}
      data-span={span}
      data-fullspan={fullWidth ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: collapsed ? 'none' : '1px solid var(--abb-line-faint)',
        }}
      >
        {draggable && (
          <button
            type="button"
            aria-label="Drag to reorder"
            className="dashboard-card__handle"
            style={{
              cursor: 'grab',
              background: 'none',
              border: 'none',
              color: 'var(--abb-ink-3)',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
              touchAction: 'none',
              flexShrink: 0,
            }}
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="abb-micro"
            style={{
              fontSize: 13,
              letterSpacing: '0.10em',
              color: 'var(--abb-ink-2)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              className="abb-data"
              style={{ fontSize: 11, color: 'var(--abb-ink-3)', marginTop: 2, letterSpacing: '0.02em' }}
            >
              {subtitle}
            </div>
          )}
        </div>
        {headerRight}
        {onToggleCollapse && (
          <button
            type="button"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!collapsed}
            aria-controls={`widget-body-${id}`}
            onClick={() => onToggleCollapse(id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--abb-ink-2)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>
      {!collapsed && <div id={`widget-body-${id}`} style={{ padding: 16, flex: 1, minWidth: 0 }}>{children}</div>}
    </div>
  );
}
