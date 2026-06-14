'use client';

import { useState } from 'react';
import { NavBar, COLORS, Dot } from '@/components/Shared';
import { IconAlertTriangle, IconWrench } from '@/components/Icons';

export default function TechnicianConsole() {
  const [taskStatus, setTaskStatus] = useState<'pending' | 'in-progress' | 'completed'>('pending');
  const [techNotes, setTechNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState<string[]>([]);

  const handleStart = () => setTaskStatus('in-progress');
  
  const handleSaveNote = () => {
    if (techNotes.trim()) {
      setSavedNotes([...savedNotes, techNotes]);
      setTechNotes('');
    }
  };

  const handleComplete = () => setTaskStatus('completed');

  const cardStyle = {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.borderFaint}`,
    borderRadius: 8,
    padding: 36,
    maxWidth: 640,
    margin: '0 auto',
  };

  const btnStyle = (variant: 'primary' | 'secondary' | 'success') => ({
    background: variant === 'primary' ? COLORS.textPrimary : variant === 'success' ? '#22c55e' : 'transparent',
    color: variant === 'secondary' ? COLORS.textPrimary : '#0a0b0d',
    border: variant === 'secondary' ? `1px solid ${COLORS.borderSub}` : 'none',
    padding: '14px 24px',
    borderRadius: 6,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    letterSpacing: '0.06em',
    transition: 'all 0.2s ease',
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavBar onBack={() => window.location.href = '/'} />
      
      <div className="fade-in-up" style={{ padding: '40px 56px', flex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 300, color: COLORS.textPrimary, marginBottom: 8 }}>Technician Console</h1>
          <p style={{ color: COLORS.textMuted, fontSize: 13 }}>Single-screen workflow for diagnostics and resolution.</p>
        </div>

        {taskStatus === 'completed' ? (
          <div className="glow-success fade-in-up" style={{ ...cardStyle, textAlign: 'center', padding: '64px 36px' }}>
            <div style={{ width: 72, height: 72, background: 'rgba(34,197,94,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 28px', border: '1px solid rgba(34,197,94,0.2)' }}>
              <IconWrench size={32} color="#22c55e" />
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 300, color: COLORS.textPrimary, marginBottom: 12 }}>Task Resolved</h2>
            <p style={{ color: COLORS.textMuted, marginBottom: 36, lineHeight: 1.7, fontSize: 13 }}>
              Equipment serviced successfully. Logs updated and synced with ARIA monitoring.
            </p>

            {savedNotes.length > 0 && (
              <div style={{ textAlign: 'left', marginBottom: 32 }}>
                <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 12 }}>
                  DIAGNOSTIC LOG ({savedNotes.length} ENTRIES)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {savedNotes.map((note, idx) => (
                    <div key={idx} style={{ background: '#090b10', padding: '10px 14px', borderRadius: 4, fontSize: 12, color: COLORS.textSec, borderLeft: '3px solid #22c55e', lineHeight: 1.5 }}>
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { setTaskStatus('pending'); setSavedNotes([]); }} style={btnStyle('secondary')}>
              RETURN TO QUEUE
            </button>
          </div>
        ) : (
          <div className={`card-hover ${taskStatus === 'pending' ? 'glow-critical' : ''}`} style={cardStyle}>
            {/* Task Notification Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
              <div>
                <div className={`mono ${taskStatus === 'pending' ? 'blink-critical' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: taskStatus === 'pending' ? '#ef4444' : '#f59e0b', letterSpacing: '0.12em', marginBottom: 14 }}>
                  <Dot color={taskStatus === 'pending' ? '#ef4444' : '#f59e0b'} size={7} cls="pulse-fast" />
                  {taskStatus === 'pending' ? '⚠ NEW TASK — IMMEDIATE ACTION REQUIRED' : 'TASK IN PROGRESS'}
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 400, color: COLORS.textPrimary, marginBottom: 8 }}>Coolant Flow Valve Inspection</h2>
                <div className="mono" style={{ fontSize: 11, color: COLORS.textMuted }}>
                  UNIT T-21 · BOILER-A · ZONE A
                </div>
              </div>
              <div className={taskStatus === 'pending' ? 'blink-critical' : ''}>
                <IconAlertTriangle size={28} color={taskStatus === 'pending' ? '#ef4444' : '#f59e0b'} />
              </div>
            </div>

            {/* Task Details */}
            <div style={{ background: '#090b10', padding: 18, borderRadius: 6, border: `1px solid ${COLORS.borderSub}`, marginBottom: 28 }}>
              <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 10 }}>
                ARIA DIAGNOSTIC SUMMARY
              </div>
              <p style={{ fontSize: 13, color: COLORS.textSec, lineHeight: 1.7, margin: 0 }}>
                Secondary valve is possibly stuck or blocked. Inspect physical valve, clear debris, and verify flow returns above 70% threshold. Risk index currently at 88%.
              </p>
            </div>

            {/* Risk bar */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.1em' }}>RISK INDEX</span>
                <span className={`mono ${taskStatus === 'pending' ? 'blink-critical' : ''}`} style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>88%</span>
              </div>
              <div style={{ height: 8, background: '#1a1d27', borderRadius: 4, overflow: 'hidden' }}>
                <div className={`grow-bar ${taskStatus === 'pending' ? 'blink-critical' : ''}`} style={{ width: '88%', height: '100%', background: 'linear-gradient(90deg, #ef4444, #b91c1c, #ef4444)', borderRadius: 4 }} />
              </div>
            </div>

            {taskStatus === 'pending' ? (
              <button onClick={handleStart} style={btnStyle('primary')}>
                START TASK
              </button>
            ) : (
              <div className="fade-in-up" style={{ borderTop: `1px solid ${COLORS.borderFaint}`, paddingTop: 28 }}>
                {/* Saved Notes */}
                <div style={{ marginBottom: 24 }}>
                  <label className="mono" style={{ display: 'block', fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 14 }}>
                    DIAGNOSTIC NOTES
                  </label>
                  
                  {savedNotes.length > 0 && (
                    <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                      {savedNotes.map((note, idx) => (
                        <div key={idx} className="fade-in-up" style={{ background: '#13161e', padding: '12px 14px', borderRadius: 6, fontSize: 13, color: COLORS.textSec, borderLeft: '3px solid #22c55e', lineHeight: 1.5 }}>
                          {note}
                        </div>
                      ))}
                    </div>
                  )}

                  <textarea
                    value={techNotes}
                    onChange={(e) => setTechNotes(e.target.value)}
                    placeholder="Describe the issue found, parts replaced, actions taken..."
                    style={{
                      width: '100%',
                      background: '#090b10',
                      border: `1px solid ${COLORS.borderSub}`,
                      borderRadius: 6,
                      padding: 14,
                      fontFamily: 'inherit',
                      fontSize: 13,
                      color: COLORS.textPrimary,
                      outline: 'none',
                      minHeight: 110,
                      resize: 'vertical',
                      marginBottom: 12,
                      lineHeight: 1.5,
                      transition: 'border-color 0.2s'
                    }}
                  />
                  <button onClick={handleSaveNote} style={{...btnStyle('secondary'), opacity: techNotes.trim() ? 1 : 0.4}} disabled={!techNotes.trim()}>
                    SAVE NOTE
                  </button>
                </div>

                {/* Complete */}
                <button onClick={handleComplete} style={btnStyle('success')}>
                  ✓ MARK TASK COMPLETED
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
