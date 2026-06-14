'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { NavBar, COLORS, Dot } from '@/components/Shared';
import { IconAlertTriangle } from '@/components/Icons';
import { useLiveData } from '@/hooks/useLiveData';

const AVAILABLE_TECHS = ['Alice Smith', 'Bob Johnson', 'Charlie Davis', 'Unassigned'];

const ARIA_RESPONSES = [
  'Based on vibration RMS data from M-12 Conveyor, the bearing on shaft #2 is showing early-stage degradation. I recommend scheduling a replacement within the next 48 hours to avoid unplanned downtime.',
  'Coolant flow on T-21 Boiler-A dropped 8% in the last hour. Historical data suggests a valve blockage pattern. Dispatching a technician for physical inspection is the recommended action.',
  'Cross-referencing alarm patterns: the B-14 Turbine bearing temp spike correlates with M-12 Conveyor vibration increase. Both units share the same coolant loop — the root cause is likely upstream.',
  'Current risk assessment: 3 machines require attention within the next 2 hours. I suggest prioritizing C-09 Chiller (45% performance) as the highest-impact fix.',
];

export default function EngineerConsole() {
  // Live task queue + high-risk buzz come from the single data seam.
  const { tasks, alarms } = useLiveData();
  // Tech reassignment is a UI-local concern, keyed by machine so a choice
  // sticks across live ticks (task ids change as new records arrive).
  const [techOverrides, setTechOverrides] = useState<Record<string, string>>({});
  const [chatHistory, setChatHistory] = useState([
    { role: 'aria', text: 'ARIA Diagnostics active. I am monitoring all plant units in real-time. Current status: 3 active alerts, 1 critical. How can I assist?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const responseIdx = useRef(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isTyping]);

  const reallocateTask = (machine: string, newTech: string) => {
    setTechOverrides(prev => ({ ...prev, [machine]: newTech }));
  };

  const handleChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    const newHistory = [...chatHistory, { role: 'user', text: chatInput }];
    setChatHistory(newHistory);
    setChatInput('');
    setIsTyping(true);
    
    setTimeout(() => {
      const response = ARIA_RESPONSES[responseIdx.current % ARIA_RESPONSES.length];
      responseIdx.current++;
      setChatHistory([...newHistory, { role: 'aria', text: response }]);
      setIsTyping(false);
    }, 1200);
  };

  const cardStyle = {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.borderFaint}`,
    borderRadius: 6,
    padding: 24,
    display: 'flex',
    flexDirection: 'column' as const,
  };

  const selectStyle = {
    background: '#090b10',
    border: `1px solid ${COLORS.borderSub}`,
    borderRadius: 4,
    padding: '6px 10px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: COLORS.textSec,
    outline: 'none',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavBar onBack={() => window.location.href = '/'} />
      
      <div className="fade-in-up" style={{ padding: '40px 56px', maxWidth: 1400, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 300, color: COLORS.textPrimary, marginBottom: 8 }}>Field Engineer Console</h1>
          <p style={{ color: COLORS.textMuted, fontSize: 13 }}>Priority task queue, high-risk buzz, and ARIA conversational diagnostics.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1.1fr', gap: 24, flex: 1 }}>
          {/* High Risk Buzz */}
          <div className="card-hover" style={cardStyle}>
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#ef4444', letterSpacing: '0.12em', marginBottom: 20 }}>
              <Dot color="#ef4444" size={7} cls="pulse-fast" />
              HIGH RISK BUZZ
            </div>

            <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {alarms.map((buzz, i) => (
                <div
                  key={i}
                  className={`fade-in-up ${buzz.type === 'CRITICAL' ? 'glow-critical' : ''}`}
                  style={{ background: buzz.type === 'CRITICAL' ? '#0f0808' : '#0f0d08', border: `1px solid ${buzz.isEarly ? '#f59e0b' : buzz.type === 'CRITICAL' ? '#3b1515' : '#3b2e15'}`, padding: 16, borderRadius: 6 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`mono ${buzz.type === 'CRITICAL' ? 'blink-critical' : ''}`} style={{ fontSize: 10, color: buzz.type === 'CRITICAL' ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                        ⚠ {buzz.type}
                      </span>
                      {buzz.isEarly && (
                        <span className="mono blink-critical" style={{ fontSize: 9, color: '#f59e0b', background: '#1a1408', border: '1px solid #3b2e15', padding: '1px 6px', borderRadius: 3, letterSpacing: '0.08em', fontWeight: 600 }}>
                          ⚠ EARLY · NEXOPS {buzz.nexopsRisk}
                        </span>
                      )}
                    </span>
                    <span className="mono" style={{ fontSize: 9, color: COLORS.textFaint }}>{buzz.time}</span>
                  </div>
                  <div style={{ fontSize: 13, color: COLORS.textPrimary, display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 }}>
                    <IconAlertTriangle size={16} color={buzz.type === 'CRITICAL' ? '#ef4444' : '#f59e0b'} style={{ flexShrink: 0, marginTop: 2 }} />
                    {/* EARLY items lead with NexOps's angle - the gateway message is
                        "all parameters normal", which is the whole point and must NOT
                        be the headline. Non-early items keep the gateway message. */}
                    {buzz.isEarly
                      ? buzz.reasoning || 'NexOps early warning — anomaly detected before the static threshold'
                      : buzz.msg}
                  </div>
                  {buzz.isEarly && (
                    <div className="mono" style={{ fontSize: 9.5, color: COLORS.textFaint, marginTop: 8, lineHeight: 1.5 }}>
                      gateway: nominal
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Technician Task View */}
          <div className="card-hover" style={cardStyle}>
            <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 20 }}>
              TECHNICIAN TASK VIEW & ALLOCATION
            </div>

            <div style={{ border: `1px solid ${COLORS.borderFaint}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 2fr 1.2fr 0.8fr 1.5fr', background: '#090b10', padding: '12px 16px', borderBottom: `1px solid ${COLORS.borderFaint}`, fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.1em' }} className="mono">
                <span>TASK</span>
                <span>DESCRIPTION</span>
                <span>MACHINE</span>
                <span>PRI</span>
                <span>ASSIGNED TO</span>
              </div>
              
              {tasks.map(t => (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '0.8fr 2fr 1.2fr 0.8fr 1.5fr', padding: '14px 16px', borderBottom: `1px solid ${COLORS.borderFaint}`, fontSize: 12, color: COLORS.textSec, alignItems: 'center' }}>
                  <span className="mono" style={{ color: COLORS.textPrimary, fontWeight: 500 }}>{t.id}</span>
                  <span style={{ paddingRight: 12 }}>{t.title}</span>
                  <span className="mono" style={{ fontSize: 10 }}>{t.machine}</span>
                  <span className={`mono ${t.priority === 'CRITICAL' ? 'blink-critical' : ''}`} style={{ fontSize: 9, color: t.priority === 'CRITICAL' ? '#ef4444' : t.priority === 'WARNING' ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>
                    {t.priority}
                  </span>
                  <select
                    value={techOverrides[t.machine] ?? t.tech}
                    onChange={e => reallocateTask(t.machine, e.target.value)}
                    style={selectStyle}
                  >
                    {AVAILABLE_TECHS.map(tech => (
                      <option key={tech} value={tech}>{tech}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 16, lineHeight: 1.6 }}>
              Reallocate tasks via dropdown if a technician is unavailable.
            </p>
          </div>

          {/* ARIA Chatbot */}
          <div className="glow-blue card-hover" style={cardStyle}>
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: '#3b82f6', letterSpacing: '0.12em', marginBottom: 16 }}>
              <Dot color="#3b82f6" size={7} cls="pulse" />
              ARIA · ADAPTIVE REASONING
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', marginBottom: 16, paddingRight: 6, maxHeight: 360 }}>
              {chatHistory.map((msg, i) => (
                <div key={i} className="fade-in-up" style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }}>
                  <div style={{ 
                    background: msg.role === 'user' ? '#1e293b' : '#0c0e14', 
                    border: `1px solid ${msg.role === 'user' ? '#334155' : COLORS.borderSub}`,
                    padding: '12px 14px', 
                    borderRadius: 8, 
                    borderBottomRightRadius: msg.role === 'user' ? 2 : 8,
                    borderTopLeftRadius: msg.role === 'aria' ? 2 : 8,
                    fontSize: 12, 
                    color: msg.role === 'user' ? '#f8fafc' : COLORS.textSec,
                    lineHeight: 1.6
                  }}>
                    {msg.text}
                  </div>
                  <div className="mono" style={{ fontSize: 8, color: COLORS.textFaint, marginTop: 5, textAlign: msg.role === 'user' ? 'right' : 'left', letterSpacing: '0.08em' }}>
                    {msg.role === 'user' ? 'FIELD ENGINEER' : 'ARIA · ADAPTIVE REASONING'}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="fade-in-up" style={{ alignSelf: 'flex-start' }}>
                  <div style={{ background: '#0c0e14', border: `1px solid ${COLORS.borderSub}`, padding: '12px 14px', borderRadius: 8, borderTopLeftRadius: 2, display: 'flex', gap: 4 }}>
                    <Dot color="#3b82f6" size={6} cls="pulse" />
                    <Dot color="#3b82f6" size={6} cls="pulse-fast" />
                    <Dot color="#3b82f6" size={6} cls="pulse" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: 8, borderTop: `1px solid ${COLORS.borderFaint}`, paddingTop: 14 }}>
              <input 
                type="text" 
                placeholder="Ask ARIA..." 
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                style={{
                  flex: 1,
                  background: '#090b10',
                  border: `1px solid ${COLORS.borderSub}`,
                  borderRadius: 6,
                  padding: '10px 14px',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  color: COLORS.textPrimary,
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
              <button 
                type="submit"
                style={{
                  background: '#3b82f6',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0 20px',
                  borderRadius: 6,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '0.05em',
                  transition: 'background 0.2s'
                }}
              >
                SEND
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
