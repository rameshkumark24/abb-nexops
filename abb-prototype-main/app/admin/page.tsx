'use client';

import { useState } from 'react';
import { NavBar, COLORS, Dot } from '@/components/Shared';
import { SiteAlertBanner } from '@/components/SiteAlertBanner';
import { useLiveData } from '@/hooks/useLiveData';

const INIT_EMPLOYEES = [
  { id: 'E101', name: 'Alice Smith', tasks: 12, avgTime: '45m' },
  { id: 'E102', name: 'Bob Johnson', tasks: 8, avgTime: '1h 15m' },
  { id: 'E103', name: 'Charlie Davis', tasks: 15, avgTime: '30m' },
];

// NexOps risk -> colour, reusing the existing palette tokens.
const riskColor = (risk: string): string =>
  risk === 'CRITICAL' ? '#ef4444' : risk === 'HIGH' ? '#f97316' : risk === 'MEDIUM' ? '#f59e0b' : '#22c55e';

export default function AdminConsole() {
  // Live machine performance comes from the single data seam.
  const { machines, siteAlert } = useLiveData();
  // NexOps "caught it early" count: machines the gateway still calls calm but
  // NexOps has flagged as elevated.
  const earlyCount = machines.filter((m) => m.isEarly).length;
  const [employees, setEmployees] = useState(INIT_EMPLOYEES);
  const [searchId, setSearchId] = useState('');
  const [newEmp, setNewEmp] = useState({ id: '', name: '', tasks: 0, avgTime: '' });
  const [activeTab, setActiveTab] = useState<'overview' | 'employees' | 'machines'>('overview');

  const handleDelete = (id: string) => {
    setEmployees(employees.filter(e => e.id !== id));
  };

  const handleAdd = () => {
    if (newEmp.id && newEmp.name) {
      setEmployees([...employees, newEmp]);
      setNewEmp({ id: '', name: '', tasks: 0, avgTime: '' });
    }
  };

  const filteredEmployees = searchId 
    ? employees.filter(e => e.id.toLowerCase().includes(searchId.toLowerCase()))
    : employees;

  const cardStyle = {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.borderFaint}`,
    borderRadius: 6,
    padding: 24,
  };

  const inputStyle = {
    background: '#090b10',
    border: `1px solid ${COLORS.borderSub}`,
    borderRadius: 4,
    padding: '8px 12px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: COLORS.textSec,
    outline: 'none',
  };

  const btnStyle = {
    background: COLORS.textPrimary,
    color: '#0a0b0d',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 4,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavBar onBack={() => window.location.href = '/'} />
      <SiteAlertBanner alert={siteAlert} />

      <div className="fade-in-up" style={{ padding: '40px 56px', maxWidth: 1280, margin: '0 auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 300, color: COLORS.textPrimary, marginBottom: 8 }}>Plant Manager Dashboard</h1>
            <p style={{ color: COLORS.textMuted, fontSize: 13 }}>System-wide health, alarm trends, and workforce management.</p>
          </div>
          <div style={{ display: 'flex', gap: 4, background: '#090b10', padding: 4, borderRadius: 6, border: `1px solid ${COLORS.borderFaint}` }}>
            {[
              { id: 'overview', label: 'OVERVIEW' },
              { id: 'machines', label: 'MACHINES' },
              { id: 'employees', label: 'EMPLOYEES' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className="mono"
                style={{
                  background: activeTab === tab.id ? COLORS.cardBgHov : 'transparent',
                  color: activeTab === tab.id ? COLORS.textPrimary : COLORS.textMuted,
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 4,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: activeTab === 'overview' ? '1fr 1fr' : '1fr', gap: 24 }}>
          {/* Machine Analytics */}
          {(activeTab === 'overview' || activeTab === 'machines') && (
            <div className="card-hover" style={cardStyle}>
              <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 20 }}>
                MACHINE ANALYTICS
              </div>
              <div style={{ display: 'flex', gap: 40 }}>
                <div>
                  <div style={{ fontSize: 40, fontWeight: 300, color: COLORS.textPrimary }}>42</div>
                  <div className="mono" style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 4 }}>TOTAL MACHINES</div>
                </div>
                <div>
                  <div style={{ fontSize: 40, fontWeight: 300, color: '#22c55e' }}>98.2%</div>
                  <div className="mono" style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 4 }}>AVG PERFORMANCE</div>
                </div>
                <div>
                  <div style={{ fontSize: 40, fontWeight: 300, color: earlyCount > 0 ? '#f59e0b' : '#22c55e' }}>{earlyCount}</div>
                  <div className="mono" style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 4 }}>EARLY WARNINGS</div>
                </div>
                {activeTab === 'machines' && (
                  <div>
                    <div style={{ fontSize: 40, fontWeight: 300, color: '#ef4444' }}>3</div>
                    <div className="mono" style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 4 }}>CRITICAL ALERTS</div>
                  </div>
                )}
              </div>
              
              <div style={{ marginTop: 24, padding: '20px', background: '#090b10', borderRadius: 6, border: `1px solid ${COLORS.borderSub}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.12em' }}>
                    MACHINE PERFORMANCE OVERVIEW
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.08em' }}>
                    <span style={{ color: '#e2e8f0' }}>●</span> HEALTHY &nbsp;&nbsp; <span style={{ color: '#ef4444' }}>●</span> CRITICAL
                  </div>
                </div>
                <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxHeight: 320, overflowY: 'auto', paddingRight: 8 }}>
                  {machines.map((m, i) => {
                    const isCritical = m.perf < 80;
                    return (
                      <div 
                        key={i} 
                        className={`fade-in-up ${isCritical ? 'glow-critical' : 'card-hover'}`}
                        style={{ 
                          padding: '12px 14px', 
                          background: isCritical ? 'rgba(239,68,68,0.05)' : 'rgba(226,232,240,0.02)', 
                          border: `1px solid ${isCritical ? 'rgba(239,68,68,0.2)' : COLORS.borderFaint}`,
                          borderRadius: 6
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Dot color={isCritical ? '#ef4444' : '#e2e8f0'} size={7} cls={isCritical ? 'pulse-fast' : ''} />
                            <span className="mono" style={{ fontSize: 12, color: isCritical ? '#ef4444' : '#e2e8f0', fontWeight: 500 }}>{m.name}</span>
                            <span className="mono" style={{ fontSize: 9, color: COLORS.textFaint, marginLeft: 4 }}>{m.zone}</span>
                            {m.isEarly && (
                              <span
                                className="mono blink-critical"
                                title={m.reasoning}
                                style={{ fontSize: 8.5, color: '#f59e0b', background: '#1a1408', border: '1px solid #3b2e15', padding: '1px 6px', borderRadius: 3, letterSpacing: '0.08em', marginLeft: 2 }}
                              >
                                ⚠ EARLY
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="mono" title={m.reasoning} style={{ fontSize: 9, color: riskColor(m.nexopsRisk), letterSpacing: '0.06em' }}>
                              NEXOPS {m.nexopsRisk}
                            </span>
                            <span className={`mono ${isCritical ? 'blink-critical' : ''}`} style={{ fontSize: 14, color: isCritical ? '#ef4444' : '#e2e8f0', fontWeight: 600 }}>{m.perf}%</span>
                          </div>
                        </div>
                        <div style={{ height: 10, background: '#1a1d27', borderRadius: 5, overflow: 'hidden' }}>
                          <div
                            className={`grow-bar ${isCritical ? 'blink-critical' : 'shimmer-bar'}`}
                            style={{
                              width: `${m.perf}%`,
                              height: '100%',
                              background: isCritical
                                ? 'linear-gradient(90deg, #ef4444, #b91c1c, #ef4444)'
                                : 'linear-gradient(90deg, #94a3b8, #f1f5f9, #94a3b8)',
                              borderRadius: 5
                            }}
                          />
                        </div>
                        {/* Assigned engineer for the active fault (only when one is dispatched). */}
                        {m.assignedEngineer && m.assignedEngineer !== 'Unassigned' && (
                          <div className="mono" style={{ fontSize: 9, color: COLORS.textMuted, marginTop: 6 }}>
                            👤 {m.assignedEngineer}
                            {m.faultCategory ? ` · ${m.faultCategory}` : ''}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div style={{ marginTop: 32 }}>
                <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 12 }}>
                  LIVE OBSERVATION
                </div>
                {[
                  { name: 'T-21 Boiler-A', status: 'Running Optimal', color: '#22c55e' },
                  { name: 'M-12 Conveyor', status: 'Warning: Vibration', color: '#f59e0b' },
                  { name: 'B-14 Turbine', status: 'Running Optimal', color: '#22c55e' },
                  ...(activeTab === 'machines' ? [{ name: 'C-09 Chiller', status: 'Offline', color: '#ef4444' }] : [])
                ].map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${COLORS.borderFaint}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Dot color={m.color} size={6} cls={m.color === '#22c55e' ? '' : 'pulse-fast'} />
                      <span className="mono" style={{ fontSize: 11, color: COLORS.textSec }}>{m.name}</span>
                    </div>
                    <span className="mono" style={{ fontSize: 10, color: m.color }}>{m.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Employee Analytics & Management */}
          {(activeTab === 'overview' || activeTab === 'employees') && (
            <div className="card-hover" style={cardStyle}>
              <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 20 }}>
                WORKFORCE MANAGEMENT
              </div>
              
              {/* Search */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
                <input 
                  placeholder="Search User ID..." 
                  value={searchId}
                  onChange={e => setSearchId(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
              </div>

              {/* List */}
              <div style={{ border: `1px solid ${COLORS.borderFaint}`, borderRadius: 4, overflow: 'hidden', marginBottom: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr auto', background: '#090b10', padding: '10px 16px', borderBottom: `1px solid ${COLORS.borderFaint}`, fontSize: 9, color: COLORS.textFaint, letterSpacing: '0.1em' }} className="mono">
                  <span>ID</span>
                  <span>NAME</span>
                  <span>TASKS</span>
                  <span>AVG TIME</span>
                  <span>ACTION</span>
                </div>
                {filteredEmployees.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: COLORS.textMuted, fontSize: 12 }}>No employees found.</div>
                ) : (
                  filteredEmployees.map(e => (
                    <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr auto', padding: '12px 16px', borderBottom: `1px solid ${COLORS.borderFaint}`, fontSize: 12, color: COLORS.textSec, alignItems: 'center' }}>
                      <span className="mono">{e.id}</span>
                      <span>{e.name}</span>
                      <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 40, height: 4, background: '#1a1d27', borderRadius: 2 }}>
                          <div style={{ width: `${Math.min(e.tasks * 5, 100)}%`, height: '100%', background: e.tasks > 12 ? '#f59e0b' : '#3b82f6', borderRadius: 2 }} />
                        </div>
                        {e.tasks}
                      </span>
                      <span className="mono">{e.avgTime}</span>
                      <button onClick={() => handleDelete(e.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11 }} className="mono hover:opacity-80">Delete</button>
                    </div>
                  ))
                )}
              </div>

              {/* Add Employee */}
              <div className="mono" style={{ fontSize: 10, color: COLORS.textFaint, letterSpacing: '0.1em', marginBottom: 12 }}>
                ADD EMPLOYEE
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input placeholder="ID (e.g. E104)" value={newEmp.id} onChange={e => setNewEmp({...newEmp, id: e.target.value})} style={{ ...inputStyle, width: '100px' }} />
                <input placeholder="Full Name" value={newEmp.name} onChange={e => setNewEmp({...newEmp, name: e.target.value})} style={{ ...inputStyle, flex: 1 }} />
                <button onClick={handleAdd} style={{...btnStyle, opacity: (!newEmp.id || !newEmp.name) ? 0.5 : 1}} disabled={!newEmp.id || !newEmp.name}>Add New</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
