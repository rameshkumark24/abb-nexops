'use client';

import { useEffect, useRef, useState } from 'react';
import { Dot, MicroLabel } from './Shared';
import { askAria, type AriaEvidence } from '@/lib/tasksApi';
import { useAuth } from '@/context/AuthContext';
import { useIsMobile } from '@/hooks/useMediaQuery';

function EvidenceGrounding({ evidence, source }: { evidence: AriaEvidence; source?: string }) {
  if (!evidence.focus_machine) {
    return (
      <div style={{ marginTop: 8, padding: 8, background: 'var(--abb-surface-1)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', fontSize: 10, color: 'var(--abb-ink-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--abb-ink-1)', marginBottom: 4 }}>
          <span>GROUNDING EVIDENCE</span>
          {source && (
            <span style={{ marginLeft: 'auto', fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'var(--abb-surface-2)', border: '1px solid var(--abb-line)' }}>
              Source: {source.toUpperCase()}
            </span>
          )}
        </div>
        <div>No single focus unit resolved. Answering from general zone states.</div>
      </div>
    );
  }

  const { focus_machine, nexops_risk, anomaly_status, time_to_threshold, assigned_engineer, assignment_reason, incident_matches } = evidence;

  const riskColor = nexops_risk === 'CRITICAL' ? 'var(--abb-alarm)' : nexops_risk === 'HIGH' ? 'var(--abb-high)' : nexops_risk === 'MEDIUM' ? 'var(--abb-warning)' : 'var(--abb-ink-3)';

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Projection Pill */}
      {time_to_threshold && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: 'var(--abb-high-soft)',
          border: '1px solid var(--abb-high-line)',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--abb-high)',
          alignSelf: 'flex-start',
        }}>
          <span aria-hidden="true">⏱️</span>
          <span>Projected failure in {time_to_threshold.eta_minutes_low.toFixed(0)}-{time_to_threshold.eta_minutes_high.toFixed(0)} mins ({time_to_threshold.sensor})</span>
        </div>
      )}

      {/* Grounding Footer */}
      <div style={{
        padding: '8px 12px',
        background: 'var(--abb-surface-3, var(--abb-surface-1))',
        border: '1px solid var(--abb-line)',
        borderRadius: 'var(--abb-radius-sm)',
        fontSize: '10.5px',
        color: 'var(--abb-ink-2)',
        lineHeight: 1.4
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--abb-ink-1)', marginBottom: 6, borderBottom: '1px solid var(--abb-line)', paddingBottom: 4 }}>
          <span><span aria-hidden="true">🎯</span> SYSTEM TELEMETRY CORROBORATION</span>
          {source && (
            <span style={{ marginLeft: 'auto', fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'var(--abb-surface-2)', border: '1px solid var(--abb-line)' }}>
              Source: {source.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '6px 12px' }}>
          <div>
            <span style={{ color: 'var(--abb-ink-3)' }}>Unit: </span>
            <strong style={{ color: 'var(--abb-ink-0)' }}>{focus_machine}</strong>
          </div>
          <div>
            <span style={{ color: 'var(--abb-ink-3)' }}>Risk: </span>
            <span style={{ color: riskColor, fontWeight: 700 }}>{nexops_risk}</span>
          </div>
          <div>
            <span style={{ color: 'var(--abb-ink-3)' }}>ML Status: </span>
            <span style={{ textTransform: 'capitalize' }}>{anomaly_status ?? 'No score'}</span>
          </div>
          <div>
            <span style={{ color: 'var(--abb-ink-3)' }}>Staff: </span>
            <span>{assigned_engineer}</span>
          </div>
          {assignment_reason && (
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{ color: 'var(--abb-ink-3)' }}>Dispatch: </span>
              <span style={{ fontStyle: 'italic' }}>{assignment_reason}</span>
            </div>
          )}
          <div>
            <span style={{ color: 'var(--abb-ink-3)' }}>History: </span>
            <span>{incident_matches} matching incident(s)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Msg {
  id: number;
  role: 'aria' | 'user';
  text: string;
  evidence?: AriaEvidence;
  source?: 'llm' | 'fallback_template' | 'unavailable';
}

const SUGGESTED = ['Highest risk in my zone?', 'Any EARLY warnings?', 'Recommended next action?'];

export default function AriaPanel({
  zone,
  floating = false,
  online = true,
}: {
  zone: string;
  // When true, render as a fixed right-side drawer (desktop) / bottom sheet
  // (mobile) with a collapsed launcher tab, instead of an inline card. Pure
  // presentation — the chat logic + askAria swap-seam are unchanged.
  floating?: boolean;
  online?: boolean;
}) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  // Floating mode starts collapsed (tab) so it doesn't cover the page on load;
  // inline mode keeps its previous open-by-default behaviour.
  const [collapsed, setCollapsed] = useState(floating);
  const [messages, setMessages] = useState<Msg[]>([
    { id: 0, role: 'aria', text: `ARIA online for Zone ${zone}. Ask about your zone's machines, EARLY warnings, or next actions.` },
  ]);
  const msgIdRef = useRef(1);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { id: msgIdRef.current++, role: 'user', text: q }]);
    setBusy(true);

    const res = await askAria(q);
    if (res.ok) {
      setMessages((m) => [
        ...m,
        {
          id: msgIdRef.current++,
          role: 'aria',
          text: res.data.answer,
          evidence: res.data.evidence,
          source: res.data.source,
        },
      ]);
    } else {
      setMessages((m) => [
        ...m,
        {
          id: msgIdRef.current++,
          role: 'aria',
          text: `Unable to process request: ${res.error}`,
          source: 'unavailable',
        },
      ]);
    }
    setBusy(false);
  }

  const header = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: collapsed && !floating ? 'none' : '1px solid var(--abb-line)',
        background: 'var(--abb-surface-2)',
        borderTopLeftRadius: floating ? 0 : 'var(--abb-radius)',
        borderTopRightRadius: floating ? 0 : 'var(--abb-radius)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot color={online ? 'var(--abb-early)' : 'var(--abb-ink-3)'} size={7} cls={online ? 'pulse' : ''} />
        <span className="abb-data" style={{ fontSize: 10, color: 'var(--abb-ink-1)', letterSpacing: '0.12em', fontWeight: 600 }}>
          ARIA · ZONE {zone} HELPER
        </span>
      </div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="abb-data"
        style={{ background: 'transparent', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-sm)', padding: '2px 8px', fontSize: 9, color: 'var(--abb-ink-2)', letterSpacing: '0.08em', cursor: 'pointer' }}
      >
        {collapsed ? 'OPEN' : floating ? 'CLOSE' : 'HIDE'}
      </button>
    </div>
  );

  const chatBody = (
    <>
      {/* Suggested questions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 16px 4px', flexShrink: 0 }}>
        {SUGGESTED.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => send(q)}
            disabled={busy}
            className="abb-data"
            style={{ background: 'var(--abb-surface-2)', border: '1px solid var(--abb-line)', borderRadius: 'var(--abb-radius-pill)', padding: '4px 10px', fontSize: 9.5, color: 'var(--abb-ink-2)', cursor: busy ? 'default' : 'pointer', letterSpacing: '0.03em' }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', padding: '12px 16px', minHeight: 160 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
            <div
              style={{
                background: m.role === 'user' ? 'var(--abb-ink-0)' : 'var(--abb-surface-2)',
                color: m.role === 'user' ? '#ffffff' : 'var(--abb-ink-1)',
                border: m.role === 'user' ? 'none' : '1px solid var(--abb-line)',
                padding: '9px 12px',
                borderRadius: 'var(--abb-radius)',
                fontSize: 12,
                lineHeight: 1.55,
              }}
            >
              <div 
                style={{ whiteSpace: 'pre-wrap' }} 
                dangerouslySetInnerHTML={{ __html: m.text }}
              />
            </div>
            <MicroLabel style={{ marginTop: 4, textAlign: m.role === 'user' ? 'right' : 'left' }}>
              {m.role === 'user'
                ? user?.role === 'field_manager'
                  ? 'FIELD MANAGER'
                  : user?.role === 'technician'
                  ? 'TECHNICIAN'
                  : 'USER'
                : 'ARIA'}
            </MicroLabel>
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '6px 4px' }}>
            <Dot color="var(--abb-early)" size={6} cls="pulse" />
            <Dot color="var(--abb-early)" size={6} cls="pulse-fast" />
            <Dot color="var(--abb-early)" size={6} cls="pulse" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--abb-line)', flexShrink: 0 }}
      >
        <input
          className="abb-input"
          type="text"
          placeholder={`Ask ARIA about Zone ${zone}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ flex: 1, fontSize: 12 }}
        />
        <button type="submit" disabled={busy} className="abb-btn abb-btn--primary" style={{ fontSize: 10, padding: '0 16px' }}>
          SEND
        </button>
      </form>
    </>
  );

  // ---- Floating drawer mode (Section 2E / 3C) ----------------------------
  if (floating) {
    if (collapsed) {
      return (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="aria-tab"
          aria-label="Open ARIA assistant"
        >
          <Dot color={online ? 'var(--abb-nominal)' : 'var(--abb-ink-3)'} size={7} cls={online ? 'pulse' : ''} />
          <span className="aria-tab__label">ARIA</span>
        </button>
      );
    }
    return (
      <>
        <div className="aria-backdrop" onClick={() => setCollapsed(true)} />
        <aside className={`aria-drawer${isMobile ? ' aria-drawer--mobile' : ''}`}>
          {header}
          {chatBody}
        </aside>
      </>
    );
  }

  // ---- Inline card mode (original behaviour) -----------------------------
  return (
    <div className="abb-card" style={{ display: 'flex', flexDirection: 'column', alignSelf: 'start', maxHeight: collapsed ? undefined : 560, borderTop: '3px solid var(--abb-red)' }}>
      {header}
      {!collapsed && chatBody}
    </div>
  );
}

