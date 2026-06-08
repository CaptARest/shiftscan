bash

cat /home/claude/shiftscan/src/App.js
Output

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';
import { db } from './supabaseClient';
import QRCode from 'qrcode';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MANAGER_PIN = '0000';

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(iso) { if (!iso) return '—'; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }
function minutesToHHMM(mins) { if (!mins || mins <= 0) return '0:00'; const h = Math.floor(mins/60), m = mins%60; return `${h}:${pad(m)}`; }
function parseTimeMins(str) { if (!str) return null; const [h,m] = str.split(':').map(Number); return h*60+m; }

function getPayPeriodDates(offsetWeeks = 0) {
  const anchor = new Date(2026, 4, 31);
  anchor.setHours(0,0,0,0);
  const start = new Date(anchor.getTime() + offsetWeeks * 14 * 86400000);
  const end = new Date(start.getTime() + 13 * 86400000);
  end.setHours(23,59,59,999);
  return { start, end };
}

function calcPunchMinutes(punch) {
  if (!punch.clock_out) return 0;
  const inn = new Date(punch.effective_in || punch.clock_in);
  const out = new Date(punch.effective_out || punch.clock_out);
  return Math.max(0, Math.round((out - inn) / 60000));
}

function exportCSV(punches, employees, payPeriod) {
  const header = ['Employee','Phone','Date','Clock In','Effective In','Clock Out','Effective Out','Hours','Adjusted'];
  const rows = punches.map(p => {
    const emp = employees.find(e => e.id === p.employee_id);
    return [emp?.name||'', emp?.phone||'', fmtDate(p.clock_in), fmtTime(p.clock_in), fmtTime(p.effective_in),
      fmtTime(p.clock_out), fmtTime(p.effective_out),
      p.clock_out ? minutesToHHMM(calcPunchMinutes(p)) : '', p.adjusted ? 'Yes' : 'No'];
  });
  const csv = [header,...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shiftscan_${fmtDate(payPeriod.start).replace(/\//g,'-')}_to_${fmtDate(payPeriod.end).replace(/\//g,'-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function QRDisplay({ url, size=180 }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current && url) QRCode.toCanvas(ref.current, url, {width:size, margin:1, color:{dark:'#085041',light:'#ffffff'}});
  }, [url, size]);
  return <canvas ref={ref} style={{borderRadius:8}} />;
}

function ManagerPinGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  function check() { if (pin === MANAGER_PIN) onUnlock(); else { setErr('Incorrect manager PIN.'); setPin(''); } }
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--gray-bg)'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2rem',width:320,boxShadow:'0 4px 24px rgba(0,0,0,0.08)',textAlign:'center'}}>
        <div style={{width:52,height:52,borderRadius:14,background:'var(--teal)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 1rem'}}>
          <i className="ti ti-lock" style={{color:'#fff',fontSize:24}} />
        </div>
        <h2 style={{fontSize:18,fontWeight:600,marginBottom:4}}>ShiftScan</h2>
        <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:'1.5rem'}}>Enter manager PIN to access the dashboard</p>
        <input type="password" maxLength={6} value={pin} autoFocus placeholder="••••"
          style={{textAlign:'center',fontSize:20,letterSpacing:6,marginBottom:12}}
          onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==='Enter'&&check()} />
        {err && <p style={{color:'var(--red)',fontSize:12,marginBottom:8}}>{err}</p>}
        <button className="btn-primary" style={{width:'100%'}} onClick={check}>Unlock →</button>
        <div style={{marginTop:'1.5rem',paddingTop:'1.5rem',borderTop:'0.5px solid var(--border)'}}>
          <p style={{fontSize:12,color:'var(--text-muted)'}}>Employee? Use your QR code to clock in.</p>
        </div>
      </div>
    </div>
  );
}

function ClockModal({ onClose }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [emp, setEmp] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [todayPunch, setTodayPunch] = useState(null);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function findEmp() {
    setLoading(true);
    const clean = phone.replace(/\D/g,'');
    const rows = await db.findByPhone(clean);
    if (!rows.length) { setMsg('Phone number not found.'); setLoading(false); return; }
    const found = rows[0];
    setEmp(found);
    const sched = await db.getScheduleForEmployee(found.id);
    setSchedule(sched);
    const today = new Date().toISOString().split('T')[0];
    const punches = await db.getTodayPunch(found.id, today);
    setTodayPunch(punches[0] || null);
    setLoading(false); setStep('pin'); setMsg('');
  }

  async function verifyPin() {
    if (pin !== emp.pin) { setMsg('Incorrect PIN.'); setPin(''); return; }
    setStep('action'); setMsg('');
  }

  async function doClock() {
    setLoading(true);
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const dow = now.getDay();
    const sched = schedule.find(s => s.day_of_week === dow);
    const nowMins = now.getHours()*60+now.getMinutes();

    if (!todayPunch) {
      let effectiveIn = now.toISOString(), note = '';
      if (sched) {
        const schedStart = parseTimeMins(sched.start_time);
        if (nowMins < schedStart) {
          const eff = new Date(now); eff.setHours(Math.floor(schedStart/60), schedStart%60, 0, 0);
          effectiveIn = eff.toISOString();
          note = ` (paid hours begin at ${sched.start_time})`;
        }
      }
      await db.addPunch({ employee_id:emp.id, punch_date:today, clock_in:now.toISOString(),
        effective_in:effectiveIn, scheduled_start:sched?.start_time||null, scheduled_end:sched?.end_time||null });
      setMsg(`✓ Clocked in at ${fmtTime(now.toISOString())}${note}`);
    } else if (!todayPunch.clock_out) {
      let effectiveOut = now.toISOString(), note = '';
      if (sched) {
        const schedEnd = parseTimeMins(sched.end_time);
        if (nowMins > schedEnd) {
          const eff = new Date(now); eff.setHours(Math.floor(schedEnd/60), schedEnd%60, 0, 0);
          effectiveOut = eff.toISOString();
          note = ` (paid hours end at ${sched.end_time})`;
        }
      }
      await db.clockOut(todayPunch.id, now.toISOString(), effectiveOut);
      setMsg(`✓ Clocked out at ${fmtTime(now.toISOString())}${note}`);
    }
    setDone(true); setLoading(false);
  }

  const now = new Date();
  const sched = schedule.find(s => s.day_of_week === now.getDay());
  const nowMins = now.getHours()*60+now.getMinutes();

  return (
    <div className="modal-bg" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem'}}>
          <h2 style={{fontSize:18,fontWeight:500}}>Employee Time Clock</h2>
          <button className="btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>
        {done ? (
          <div style={{textAlign:'center',padding:'2rem 0'}}>
            <div style={{fontSize:48,marginBottom:12,color:'var(--teal)'}}>✓</div>
            <p style={{fontSize:15,color:msg.startsWith('✓')?'var(--teal)':'var(--red)'}}>{msg}</p>
            <button className="btn-primary" style={{marginTop:20}} onClick={onClose}>Done</button>
          </div>
        ) : step==='phone' ? (
          <div>
            <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:'1rem'}}>Enter your registered phone number.</p>
            <label className="label">Phone number</label>
            <input type="tel" placeholder="8505550000" value={phone} onChange={e=>setPhone(e.target.value)} onKeyDown={e=>e.key==='Enter'&&findEmp()} autoFocus />
            {msg && <p style={{color:'var(--red)',fontSize:12,marginTop:4}}>{msg}</p>}
            <button className="btn-primary" style={{marginTop:12,width:'100%'}} onClick={findEmp} disabled={loading}>{loading?'Looking up…':'Continue →'}</button>
          </div>
        ) : step==='pin' ? (
          <div>
            <p style={{fontSize:13,marginBottom:'1rem'}}>Welcome, <strong>{emp.name}</strong>. Enter your PIN.</p>
            <label className="label">PIN</label>
            <input type="password" maxLength={6} value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==='Enter'&&verifyPin()} autoFocus />
            {msg && <p style={{color:'var(--red)',fontSize:12,marginTop:4}}>{msg}</p>}
            <button className="btn-primary" style={{marginTop:12,width:'100%'}} onClick={verifyPin}>Verify →</button>
          </div>
        ) : (
          <div>
            <div style={{textAlign:'center',marginBottom:'1.25rem'}}>
              <p style={{fontSize:13,color:'var(--text-muted)'}}>Logged in as</p>
              <p style={{fontSize:18,fontWeight:500}}>{emp.name}</p>
              {sched && <p style={{fontSize:12,color:'var(--teal)',marginTop:4}}>Scheduled today: {sched.start_time} – {sched.end_time}</p>}
            </div>
            {!sched && <div style={{background:'var(--amber-light)',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:13,color:'var(--amber)'}}>⚠ You are not scheduled today. This punch will be recorded but no paid hours will accumulate.</div>}
            {!todayPunch && sched && nowMins<parseTimeMins(sched.start_time) && <div style={{background:'var(--teal-light)',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12,color:'var(--teal-dark)'}}>Your shift starts at {sched.start_time}. Clocking in now means paid hours begin at {sched.start_time}.</div>}
            {todayPunch && !todayPunch.clock_out && sched && nowMins>parseTimeMins(sched.end_time) && <div style={{background:'var(--amber-light)',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12,color:'var(--amber)'}}>Your shift ended at {sched.end_time}. Paid hours will cap at your scheduled end time.</div>}
            <button className="btn-primary" style={{width:'100%',padding:'13px',fontSize:16}} onClick={doClock} disabled={loading||(todayPunch&&todayPunch.clock_out)}>
              {loading?'Processing…':todayPunch&&todayPunch.clock_out?'Already clocked out today':todayPunch?'Clock Out':'Clock In'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EditEmployeeModal({ emp, schedules, onClose, onSaved }) {
  const [form, setForm] = useState({name:emp.name,phone:emp.phone,pin:emp.pin});
  const [sched, setSched] = useState(schedules.map(s=>({...s})));
  const [saving, setSaving] = useState(false);
  function toggleDay(i) { const exists=sched.find(s=>s.day_of_week===i); if(exists) setSched(prev=>prev.filter(s=>s.day_of_week!==i)); else setSched(prev=>[...prev,{day_of_week:i,start_time:'09:00',end_time:'17:00'}].sort((a,b)=>a.day_of_week-b.day_of_week)); }
  function updateDay(i,field,val) { setSched(prev=>prev.map(s=>s.day_of_week===i?{...s,[field]:val}:s)); }
  async function save() {
    setSaving(true);
    await db.updateEmployee({...form, id:emp.id});
    await db.setSchedules(emp.id, sched);
    setSaving(false); onSaved(); onClose();
  }
  return (
    <div className="modal-bg"><div className="modal">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem'}}>
        <h2 style={{fontSize:18,fontWeight:500}}>Edit employee</h2>
        <button className="btn-secondary btn-sm" onClick={onClose}>✕</button>
      </div>
      <div className="grid2" style={{marginBottom:12}}>
        <div><label className="label">Name</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
        <div><label className="label">Phone</label><input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} /></div>
      </div>
      <div style={{marginBottom:'1rem'}}><label className="label">PIN</label><input value={form.pin} maxLength={6} onChange={e=>setForm(f=>({...f,pin:e.target.value}))} /></div>
      <p className="label" style={{marginBottom:8}}>Schedule</p>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {DAYS.map((d,i)=>{const active=sched.find(s=>s.day_of_week===i);return(<div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
          <button style={{width:44,height:30,borderRadius:6,fontSize:12,fontWeight:500,border:'0.5px solid var(--border)',cursor:'pointer',background:active?'var(--teal)':'transparent',color:active?'#fff':'inherit'}} onClick={()=>toggleDay(i)}>{d}</button>
          {active&&<><input type="time" value={active.start_time} onChange={e=>updateDay(i,'start_time',e.target.value)} style={{width:120}} /><span style={{fontSize:12,color:'var(--text-muted)'}}>to</span><input type="time" value={active.end_time} onChange={e=>updateDay(i,'end_time',e.target.value)} style={{width:120}} /></>}
        </div>);})}
      </div>
      <div style={{display:'flex',gap:8,marginTop:'1.25rem',justifyContent:'flex-end'}}>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save changes'}</button>
      </div>
    </div></div>
  );
}

function AddEmployeeModal({ onClose, onSaved }) {
  const [form, setForm] = useState({name:'',phone:'',pin:''});
  const [sched, setSched] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function toggleDay(i) { const exists=sched.find(s=>s.day_of_week===i); if(exists) setSched(prev=>prev.filter(s=>s.day_of_week!==i)); else setSched(prev=>[...prev,{day_of_week:i,start_time:'09:00',end_time:'17:00'}].sort((a,b)=>a.day_of_week-b.day_of_week)); }
  function updateDay(i,field,val) { setSched(prev=>prev.map(s=>s.day_of_week===i?{...s,[field]:val}:s)); }
  async function save() {
    if(!form.name||!form.phone||!form.pin){setErr('Name, phone, and PIN are required.');return;}
    setSaving(true);
    const rows = await db.addEmployee({name:form.name,phone:form.phone.replace(/\D/g,''),pin:form.pin});
    if(!rows.length){setErr('Phone may already be in use.');setSaving(false);return;}
    await db.setSchedules(rows[0].id, sched);
    setSaving(false); onSaved(); onClose();
  }
  return (
    <div className="modal-bg"><div className="modal">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem'}}>
        <h2 style={{fontSize:18,fontWeight:500}}>Add employee</h2>
        <button className="btn-secondary btn-sm" onClick={onClose}>✕</button>
      </div>
      <div className="grid2" style={{marginBottom:12}}>
        <div><label className="label">Full name</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} autoFocus /></div>
        <div><label className="label">Phone (digits only)</label><input value={form.phone} placeholder="8505550000" onChange={e=>setForm(f=>({...f,phone:e.target.value}))} /></div>
      </div>
      <div style={{marginBottom:'1rem'}}><label className="label">PIN (4–6 digits)</label><input value={form.pin} maxLength={6} onChange={e=>setForm(f=>({...f,pin:e.target.value}))} /></div>
      {err && <p style={{color:'var(--red)',fontSize:12,marginBottom:8}}>{err}</p>}
      <p className="label" style={{marginBottom:8}}>Schedule</p>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {DAYS.map((d,i)=>{const active=sched.find(s=>s.day_of_week===i);return(<div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
          <button style={{width:44,height:30,borderRadius:6,fontSize:12,fontWeight:500,border:'0.5px solid var(--border)',cursor:'pointer',background:active?'var(--teal)':'transparent',color:active?'#fff':'inherit'}} onClick={()=>toggleDay(i)}>{d}</button>
          {active&&<><input type="time" value={active.start_time} onChange={e=>updateDay(i,'start_time',e.target.value)} style={{width:120}} /><span style={{fontSize:12,color:'var(--text-muted)'}}>to</span><input type="time" value={active.end_time} onChange={e=>updateDay(i,'end_time',e.target.value)} style={{width:120}} /></>}
        </div>);})}
      </div>
      <div style={{display:'flex',gap:8,marginTop:'1.25rem',justifyContent:'flex-end'}}>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving?'Adding…':'Add employee'}</button>
      </div>
    </div></div>
  );
}

function EditPunchModal({ punch, empName, onClose, onSaved }) {
  function isoToTime(iso) { if(!iso) return ''; const d=new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  const [inT, setInT] = useState(isoToTime(punch.effective_in||punch.clock_in));
  const [outT, setOutT] = useState(isoToTime(punch.clock_out));
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const base=new Date(punch.clock_in); base.setHours(0,0,0,0);
    const [ih,im]=inT.split(':').map(Number); const newIn=new Date(base); newIn.setHours(ih,im,0,0);
    let newOut=null,newEffOut=null;
    if(outT){const [oh,om]=outT.split(':').map(Number);newOut=new Date(base);newOut.setHours(oh,om,0,0);newEffOut=newOut.toISOString();}
    await db.updatePunch({id:punch.id,effective_in:newIn.toISOString(),clock_out:newOut?newOut.toISOString():punch.clock_out,effective_out:newEffOut||punch.effective_out});
    setSaving(false); onSaved(); onClose();
  }
  return (
    <div className="modal-bg"><div className="modal" style={{maxWidth:380}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1.25rem'}}>
        <h2 style={{fontSize:18,fontWeight:500}}>Adjust punch</h2>
        <button className="btn-secondary btn-sm" onClick={onClose}>✕</button>
      </div>
      <p style={{fontSize:13,marginBottom:'1rem',color:'var(--text-muted)'}}>{empName} · {fmtDate(punch.clock_in)}</p>
      <div className="grid2">
        <div><label className="label">Effective clock-in</label><input type="time" value={inT} onChange={e=>setInT(e.target.value)} /></div>
        <div><label className="label">Effective clock-out</label><input type="time" value={outT} onChange={e=>setOutT(e.target.value)} /></div>
      </div>
      <p style={{fontSize:11,color:'var(--text-muted)',marginTop:8}}>Original punch times are preserved.</p>
      <div style={{display:'flex',gap:8,marginTop:'1.25rem',justifyContent:'flex-end'}}>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save adjustment'}</button>
      </div>
    </div></div>
  );
}

function PayPeriodNav({ offset, setOffset }) {
  const pp = getPayPeriodDates(offset);
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,background:'#fff',border:'0.5px solid var(--border)',borderRadius:10,padding:'8px 14px'}}>
      <button className="btn-secondary btn-sm" onClick={()=>setOffset(o=>o-1)}>‹ Prev</button>
      <div style={{textAlign:'center',minWidth:180}}>
        <p style={{fontSize:12,color:'var(--text-muted)',lineHeight:1}}>Pay Period</p>
        <p style={{fontSize:13,fontWeight:500,marginTop:2}}>{fmtDate(pp.start)} – {fmtDate(pp.end)}</p>
      </div>
      <button className="btn-secondary btn-sm" onClick={()=>setOffset(o=>o+1)} disabled={offset===0} style={{opacity:offset===0?0.4:1}}>Next ›</button>
      {offset!==0 && <button className="btn-primary btn-sm" onClick={()=>setOffset(0)}>Today</button>}
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [employees, setEmployees] = useState([]);
  const [scheduleMap, setScheduleMap] = useState({});
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(new Date());
  const [periodOffset, setPeriodOffset] = useState(0);
  const [showClock, setShowClock] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [addEmpOpen, setAddEmpOpen] = useState(false);
  const [editPunch, setEditPunch] = useState(null);
  const [error, setError] = useState(null);

  const payPeriod = getPayPeriodDates(periodOffset);
  const appUrl = window.location.origin;

  useEffect(()=>{const t=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(t);},[]);

  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [emps, scheds, pnch] = await Promise.all([
        db.getEmployees(),
        db.getSchedules(),
        db.getPunches(payPeriod.start.toISOString().split('T')[0], payPeriod.end.toISOString().split('T')[0]),
      ]);
      setEmployees(emps);
      const sm = {};
      scheds.forEach(s => { if(!sm[s.employee_id]) sm[s.employee_id]=[]; sm[s.employee_id].push(s); });
      setScheduleMap(sm);
      setPunches(pnch);
    } catch(e) {
      setError(e.message);
    }
    setLoading(false);
  }, [payPeriod.start, payPeriod.end]);

  useEffect(()=>{ if(unlocked) loadAll(); },[loadAll, unlocked]);

  function empHours(empId) { return punches.filter(p=>p.employee_id===empId).reduce((sum,p)=>sum+calcPunchMinutes(p),0); }

  const todayStr = new Date().toDateString();
  const todayPunches = punches.filter(p=>new Date(p.clock_in).toDateString()===todayStr);

  if (!unlocked) return <ManagerPinGate onUnlock={()=>setUnlocked(true)} />;

  function Dashboard() {
    const clocked = todayPunches.filter(p=>!p.clock_out).map(p=>employees.find(e=>e.id===p.employee_id)).filter(Boolean);
    const totalMins = employees.reduce((s,e)=>s+empHours(e.id),0);
    return (
      <div>
        <div className="grid3" style={{marginBottom:'1.25rem'}}>
          <div className="stat-card">
            <p className="label">Live clock</p>
            <div style={{fontSize:38,fontWeight:300,color:'var(--teal)',letterSpacing:-1,margin:'8px 0'}}>{pad(clock.getHours())}:{pad(clock.getMinutes())}:{pad(clock.getSeconds())}</div>
            <p style={{fontSize:12,color:'var(--text-muted)'}}>{clock.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p>
          </div>
          <div className="stat-card">
            <p className="label">Currently clocked in</p>
            <div style={{fontSize:32,fontWeight:500,color:'var(--teal)',margin:'8px 0'}}>{clocked.length}</div>
            {clocked.map(emp=><p key={emp.id} style={{fontSize:12,color:'var(--text-muted)'}}>• {emp.name}</p>)}
          </div>
          <div className="stat-card">
            <p className="label">Pay period hours</p>
            <div style={{fontSize:32,fontWeight:500,color:'var(--teal)',margin:'8px 0'}}>{minutesToHHMM(totalMins)}</div>
            <p style={{fontSize:12,color:'var(--text-muted)'}}>{fmtDate(payPeriod.start)} – {fmtDate(payPeriod.end)}</p>
          </div>
        </div>
        <div className="card" style={{marginBottom:'1.25rem'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem'}}>
            <h3 style={{fontSize:15,fontWeight:500}}>QR Code — Employee Check-in</h3>
            <button className="btn-primary" onClick={()=>setShowClock(true)}>Test clock-in ↗</button>
          </div>
          <div style={{display:'flex',gap:'2rem',alignItems:'flex-start',flexWrap:'wrap'}}>
            <QRDisplay url={appUrl} size={160} />
            <div style={{flex:1,minWidth:220}}>
              <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:8}}>Employees scan this QR with their phone camera. They enter their phone number and PIN — no app needed.</p>
              <ul style={{fontSize:12,color:'var(--text-muted)',paddingLeft:16,lineHeight:2.2}}>
                <li>Early clock-in → hours begin at scheduled start</li>
                <li>Late clock-out → hours cap at scheduled end</li>
                <li>Unscheduled day → recorded but no paid hours</li>
              </ul>
              <div style={{marginTop:10,padding:'7px 12px',background:'var(--gray-light)',borderRadius:8,fontSize:11,color:'var(--text-muted)',wordBreak:'break-all'}}>{appUrl}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:500,marginBottom:'1rem'}}>Today's activity</h3>
          {todayPunches.length===0
            ? <p style={{fontSize:13,color:'var(--text-muted)',textAlign:'center',padding:'1.5rem'}}>No punches today yet.</p>
            : <table><thead><tr><th>Employee</th><th>Clock In</th><th>Effective In</th><th>Clock Out</th><th>Hours</th></tr></thead>
              <tbody>{todayPunches.map(p=>{const emp=employees.find(e=>e.id===p.employee_id);return(
                <tr key={p.id}><td style={{fontWeight:500}}>{emp?.name||'?'}</td><td>{fmtTime(p.clock_in)}</td><td>{fmtTime(p.effective_in)}</td><td>{fmtTime(p.clock_out)}</td>
                <td>{!p.clock_out?<span className="badge badge-warning">⏱ In progress</span>:<span className="badge badge-success">{minutesToHHMM(calcPunchMinutes(p))} hrs</span>}</td></tr>
              );})}</tbody></table>}
        </div>
      </div>
    );
  }

  function EmployeesTab() {
    return (
      <div>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'1rem'}}>
          <button className="btn-primary" onClick={()=>setAddEmpOpen(true)}>+ Add employee</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {employees.map(emp=>{
            const hrs=empHours(emp.id); const sched=scheduleMap[emp.id]||[];
            const todayP=todayPunches.find(p=>p.employee_id===emp.id);
            return(
              <div key={emp.id} className="card">
                <div style={{display:'flex',alignItems:'center',gap:'1rem'}}>
                  <div style={{width:44,height:44,borderRadius:'50%',background:'var(--teal-light)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:500,color:'var(--teal-dark)',flexShrink:0}}>
                    {emp.name.split(' ').map(n=>n[0]).join('').toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <p style={{fontWeight:500,fontSize:15}}>{emp.name}</p>
                    <p style={{fontSize:12,color:'var(--text-muted)'}}>📱 {emp.phone} · PIN: {emp.pin}</p>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <p style={{fontWeight:500,color:'var(--teal)',fontSize:16}}>{minutesToHHMM(hrs)}</p>
                    <p style={{fontSize:11,color:'var(--text-muted)'}}>this pay period</p>
                    {todayP&&!todayP.clock_out&&<span className="badge badge-success" style={{marginTop:4}}>⏱ In</span>}
                  </div>
                  <button className="btn-secondary btn-sm" style={{marginLeft:8}} onClick={()=>setEditEmp({emp,schedules:sched})}>
                    <i className="ti ti-edit" aria-hidden="true" /> Edit
                  </button>
                </div>
                <div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:'0.5px solid var(--border)'}}>
                  <p className="label">Weekly schedule</p>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
                    {DAYS.map((d,i)=>{const s=sched.find(sc=>sc.day_of_week===i);return(
                      <div key={i} style={{padding:'4px 8px',borderRadius:6,fontSize:11,fontWeight:500,background:s?'var(--teal-light)':'var(--gray-light)',color:s?'var(--teal-dark)':'var(--text-muted)'}}>
                        {s?`${d} ${s.start_time}–${s.end_time}`:d}
                      </div>
                    );})}
                  </div>
                </div>
              </div>
            );
          })}
          {employees.length===0&&!loading&&<div className="card" style={{textAlign:'center',padding:'2rem',color:'var(--text-muted)',fontSize:13}}>No employees yet. Click "Add employee" to get started.</div>}
        </div>
      </div>
    );
  }

  function TimesheetsTab() {
    const [selEmp, setSelEmp] = useState('all');
    const filtered = punches.filter(p=>selEmp==='all'||p.employee_id===selEmp);
    return (
      <div>
        <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:'1rem',flexWrap:'wrap'}}>
          <PayPeriodNav offset={periodOffset} setOffset={setPeriodOffset} />
          <select value={selEmp} onChange={e=>setSelEmp(e.target.value)} style={{width:'auto'}}>
            <option value="all">All employees</option>
            {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {selEmp!=='all'&&<div style={{fontWeight:500,color:'var(--teal)'}}>Period total: {minutesToHHMM(empHours(selEmp))} hrs</div>}
          <button className="btn-secondary" style={{marginLeft:'auto'}} onClick={()=>exportCSV(filtered,employees,payPeriod)}>⬇ Export CSV</button>
        </div>
        <div className="card">
          <table>
            <thead><tr><th>Employee</th><th>Date</th><th>Clock In</th><th>Eff. In</th><th>Clock Out</th><th>Eff. Out</th><th>Hours</th><th></th></tr></thead>
            <tbody>{filtered.map(p=>{const emp=employees.find(e=>e.id===p.employee_id);return(
              <tr key={p.id} style={p.adjusted?{background:'rgba(250,238,218,0.25)'}:{}}>
                <td style={{fontWeight:500}}>{emp?.name||'?'}</td><td>{fmtDate(p.clock_in)}</td>
                <td style={{color:p.effective_in&&new Date(p.effective_in)>new Date(p.clock_in)?'var(--amber)':undefined}}>{fmtTime(p.clock_in)}</td>
                <td>{fmtTime(p.effective_in)}</td><td>{fmtTime(p.clock_out)}</td><td>{fmtTime(p.effective_out)}</td>
                <td style={{fontWeight:500,color:'var(--teal)'}}>{p.clock_out?minutesToHHMM(calcPunchMinutes(p)):'—'}</td>
                <td><button className="btn-secondary btn-sm" onClick={()=>setEditPunch({punch:p,empName:emp?.name})}>Edit</button></td>
              </tr>
            );})}</tbody>
          </table>
          {filtered.length===0&&<p style={{textAlign:'center',padding:'1.5rem',fontSize:13,color:'var(--text-muted)'}}>No records for this pay period.</p>}
        </div>
      </div>
    );
  }

  function ReportsTab() {
    return (
      <div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'1rem',flexWrap:'wrap',gap:12}}>
          <PayPeriodNav offset={periodOffset} setOffset={setPeriodOffset} />
          <button className="btn-secondary" onClick={()=>exportCSV(punches,employees,payPeriod)}>⬇ Export CSV</button>
        </div>
        <div className="card">
          <table>
            <thead><tr><th>Employee</th><th>Phone</th><th>Days worked</th><th>Total hours</th><th>vs Schedule</th></tr></thead>
            <tbody>{employees.map(emp=>{
              const empP=punches.filter(p=>p.employee_id===emp.id&&p.clock_out);
              const mins=empHours(emp.id);
              const sched=scheduleMap[emp.id]||[];
              const schedMins=sched.reduce((sum,s)=>sum+(parseTimeMins(s.end_time)-parseTimeMins(s.start_time)),0)*2;
              const diff=mins-schedMins;
              return(<tr key={emp.id}>
                <td style={{fontWeight:500}}>{emp.name}</td><td style={{color:'var(--text-muted)'}}>{emp.phone}</td>
                <td>{empP.length}</td><td style={{fontWeight:500,color:'var(--teal)'}}>{minutesToHHMM(mins)}</td>
                <td><span style={{fontSize:12,color:Math.abs(diff)<30?'var(--text-muted)':diff>0?'var(--amber)':'var(--teal)'}}>
                  {diff===0?'On target':diff>0?`+${minutesToHHMM(diff)} over`:`${minutesToHHMM(Math.abs(diff))} under`}
                </span></td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      </div>
    );
  }

  const TABS=[{id:'dashboard',label:'Dashboard',icon:'ti-layout-dashboard'},{id:'employees',label:'Employees',icon:'ti-users'},{id:'timesheets',label:'Timesheets',icon:'ti-clock'},{id:'reports',label:'Reports',icon:'ti-chart-bar'}];

  return (
    <div style={{maxWidth:900,margin:'0 auto',padding:'0 1rem 3rem'}}>
      <div style={{padding:'1.25rem 0 0',marginBottom:'1rem'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:'1rem'}}>
          <div style={{width:38,height:38,borderRadius:10,background:'var(--teal)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <i className="ti ti-clock" style={{color:'#fff',fontSize:20}} aria-hidden="true" />
          </div>
          <div style={{flex:1}}>
            <h1 style={{fontSize:20,fontWeight:600,lineHeight:1}}>ShiftScan</h1>
            <p style={{fontSize:12,color:'var(--text-muted)'}}>QR time clock & scheduling</p>
          </div>
          <button className="btn-secondary btn-sm" onClick={()=>setUnlocked(false)}><i className="ti ti-lock" aria-hidden="true" /> Lock</button>
        </div>
        <div style={{display:'flex',borderBottom:'0.5px solid var(--border)'}}>
          {TABS.map(t=>(
            <button key={t.id} className={`tab${tab===t.id?' active':''}`} onClick={()=>setTab(t.id)}>
              <i className={`ti ${t.icon}`} style={{marginRight:6,fontSize:14}} aria-hidden="true" /><span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <div style={{background:'var(--red-light)',color:'var(--red)',padding:'12px 16px',borderRadius:8,marginBottom:'1rem',fontSize:13}}>⚠ Database error: {error}</div>}
      {loading
        ? <div style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)',fontSize:14}}>Loading…</div>
        : <>{tab==='dashboard'&&<Dashboard />}{tab==='employees'&&<EmployeesTab />}{tab==='timesheets'&&<TimesheetsTab />}{tab==='reports'&&<ReportsTab />}</>}
      {showClock&&<ClockModal onClose={()=>{setShowClock(false);loadAll();}} />}
      {editEmp&&<EditEmployeeModal emp={editEmp.emp} schedules={editEmp.schedules} onClose={()=>setEditEmp(null)} onSaved={loadAll} />}
      {addEmpOpen&&<AddEmployeeModal onClose={()=>setAddEmpOpen(false)} onSaved={loadAll} />}
      {editPunch&&<EditPunchModal punch={editPunch.punch} empName={editPunch.empName} onClose={()=>setEditPunch(null)} onSaved={loadAll} />}
    </div>
  );
}
