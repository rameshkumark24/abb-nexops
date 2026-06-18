'use client';

import { useEffect, useRef, useState } from 'react';
import { Dot, MicroLabel } from './Shared';

// ===========================================================================
// ARIA — RESPONSE SWAP SEAM
// ---------------------------------------------------------------------------
// ALL response logic lives behind this ONE function. A teammate later replaces
// ONLY this function body with the real ARIA RAG call; the signature, the
// AriaPanel props, and the whole UI stay identical.
//
//   async function getAriaResponse(message: string, zone: string): Promise<string>
//
// CANNED — replace this function body with the real ARIA RAG call. UI/props
// stay the same.
// ===========================================================================
const CANNED: ((zone: string) => string)[] = [
  (z) =>
    `Zone ${z}: I'm watching every unit in your zone in real time. Ask about the highest-risk machine, open EARLY warnings, or a recommended next action.`,
  (z) =>
    `In Zone ${z}, prioritise the unit with the lowest performance and an elevated NexOps risk — confirm the anomaly against the gateway reading before dispatching.`,
  (z) =>
    `Zone ${z}: EARLY-flagged units are pre-threshold — the gateway still reads nominal. A quick inspection now banks the lead time before the static limit trips.`,
  (z) =>
    `Zone ${z} tip: nuisance chatter is already filtered out of your queue. Action the corroborated EARLY catches first — those have independent ML agreement.`,
];

let _ariaTurn = 0;

// CANNED — replace this function body with the real ARIA RAG call. UI/props stay the same.
export async function getAriaResponse(message: string, zone: string): Promise<string> {
  const reply = CANNED[_ariaTurn % CANNED.length](zone);
  _ariaTurn += 1;
  // Simulated latency so swapping in a real awaited RAG call is seamless.
  await new Promise((r) => setTimeout(r, 550));
  return reply;
}

interface Msg {
  role: 'aria' | 'user';
  text: string;
}

const SUGGESTED = ['Highest risk in my zone?', 'Any EARLY warnings?', 'Recommended next action?'];

// Docked control-room helper card (NOT a floating/open chatbot): a collapsible
// assistant with a few suggested questions, a message list, and an input.
export default function AriaPanel({ zone }: { zone: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'aria', text: `ARIA online for Zone ${zone}. Ask about your zone's machines, EARLY warnings, or next actions.` },
  ]);
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
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    const reply = await getAriaResponse(q, zone); // <-- the only swap point
    setMessages((m) => [...m, { role: 'aria', text: reply }]);
    setBusy(false);
  }

  return (
    <div className="abb-card" style={{ display: 'flex', flexDirection: 'column', alignSelf: 'start', maxHeight: collapsed ? undefined : 560, borderTop: '3px solid var(--abb-red)' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: collapsed ? 'none' : '1px solid var(--abb-line)',
          background: 'var(--abb-surface-2)',
          borderTopLeftRadius: 'var(--abb-radius)',
          borderTopRightRadius: 'var(--abb-radius)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Dot color="var(--abb-early)" size={7} cls="pulse" />
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
          {collapsed ? 'OPEN' : 'HIDE'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Suggested questions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 16px 4px' }}>
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
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
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
                  {m.text}
                </div>
                <MicroLabel style={{ marginTop: 4, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  {m.role === 'user' ? 'FIELD MANAGER' : 'ARIA'}
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
            style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--abb-line)' }}
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
      )}
    </div>
  );
}
