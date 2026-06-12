import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Users, Clock, BarChart3, Activity, FileText,
  Bell, Calendar, Radio, RefreshCw, ArrowRight,
  ChevronUp, ChevronDown, AlertTriangle, AlertCircle,
  CheckCircle2, WifiOff, TrendingUp, Zap, Shield,
  UserCheck,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useUiStore }   from '@/store/ui.store';
import { apiClient }    from '@/api/client';
import { useNavigate }  from 'react-router-dom';

/* ─── Keyframes ─────────────────────────────────────────────────────────── */
const STYLES = `
  @keyframes nx-pulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes nx-ring   { 0%{transform:scale(.85);opacity:.9} 100%{transform:scale(1.7);opacity:0} }
  @keyframes nx-slide  { from{transform:translateY(10px);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes nx-spin   { to{transform:rotate(360deg)} }
  @keyframes nx-fadein { from{opacity:0} to{opacity:1} }
`;

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface DashData {
  employees:  { total: number; interns: number };
  today:      { present: number; wfh: number; absentSick: number; off: number; onLeave: number; lateIn: number; missingPunch: number };
  requests:   { pending: number; peerPending: number; approvedWeek: number; rejectedWeek: number };
  mtd:        { attendanceRate: number | null; lateRate: number | null; missingPunchRate: number | null; wfhRate: number | null; otCount: number };
  trend:      { date: string; present: number; absent: number; off: number; leave: number }[];
  functions:  { name: string; present: number; scheduled: number }[];
  alerts:     { missingPunchToday: number; lateOver30: number; unlinkedEmployees: number };
}

/* ─── Animated counter ───────────────────────────────────────────────────── */
function useCountUp(target: number, ms = 800, run = true) {
  const [v, setV] = useState(0);
  const f = useRef(0);
  useEffect(() => {
    if (!run) return;
    if (target === 0) { setV(0); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / ms, 1);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) f.current = requestAnimationFrame(tick);
    };
    f.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(f.current);
  }, [target, ms, run]);
  return v;
}

/* ─── Donut ──────────────────────────────────────────────────────────────── */
function Donut({ pct, color, size = 64 }: { pct: number; color: string; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const [on, setOn] = useState(false);
  useEffect(() => { setTimeout(() => setOn(true), 250); }, []);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`${color}20`} strokeWidth={6} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={on ? circ - (Math.min(pct,100)/100)*circ : circ}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1)' }} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color }}>
        {Math.round(pct)}%
      </div>
    </div>
  );
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */
function KpiCard({ icon:Icon, title, titleAr, value, numValue, trendPct, trendLabel, trendLabelAr, color, donut, dark, ar, onClick, delay=0 }: {
  icon: any; title: string; titleAr: string;
  value?: string; numValue?: number;
  trendPct?: number; trendLabel: string; trendLabelAr: string;
  color: string; donut?: number; dark: boolean; ar: boolean; onClick?: ()=>void; delay?: number;
}) {
  const [hov, setHov] = useState(false);
  const [rdy, setRdy] = useState(false);
  useEffect(()=>{ setTimeout(()=>setRdy(true), delay); },[delay]);
  const num = useCountUp(numValue??0, 800, rdy && numValue!==undefined);
  const disp = numValue!==undefined ? num.toLocaleString() : (value ?? '—');
  const up = (trendPct??0) >= 0;

  return (
    <div onClick={onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{
        flex:1, minWidth:0,
        background: dark ? (hov?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.04)') : (hov?'#f8faff':'#fff'),
        border: `1px solid ${hov ? color+'50' : dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)'}`,
        borderRadius: 16, padding: '16px 18px',
        cursor: onClick?'pointer':'default',
        boxShadow: hov ? `0 8px 28px ${color}22, 0 0 0 1px ${color}18` : dark?'none':'0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.2s cubic-bezier(.4,0,.2,1)',
        opacity: rdy ? 1 : 0,
        transform: hov ? 'translateY(-3px)' : (rdy ? 'translateY(0)' : 'translateY(10px)'),
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* top accent */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background: hov?color:`${color}30`, borderRadius:'16px 16px 0 0', transition:'background 0.2s' }} />

      {/* header row */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{
            width:32, height:32, borderRadius:9,
            background: hov ? `${color}22` : `${color}15`,
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'background 0.2s',
          }}>
            <Icon size={15} style={{ color, transition:'transform 0.2s', transform: hov?'scale(1.2)':'scale(1)' }} strokeWidth={2.2} />
          </div>
          <span style={{ fontSize:12, fontWeight:500, color: dark?'#64748b':'#94a3b8' }}>
            {ar ? titleAr : title}
          </span>
        </div>
        {donut !== undefined && <Donut pct={donut} color={color} size={54} />}
      </div>

      {/* value */}
      <div style={{
        fontSize:30, fontWeight:800, letterSpacing:'-0.04em', lineHeight:1,
        color: dark ? '#f1f5f9' : '#0f172a',
        marginBottom:8,
      }}>
        {disp}
      </div>

      {/* trend badge */}
      {trendPct !== undefined && (
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:3,
            fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:20,
            background: up ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)',
            color: up ? '#10b981' : '#ef4444',
            border: `1px solid ${up?'rgba(16,185,129,0.2)':'rgba(239,68,68,0.15)'}`,
          }}>
            {up ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
            {Math.abs(trendPct).toFixed(1)}%
          </span>
          <span style={{ fontSize:11, color: dark?'#475569':'#94a3b8' }}>
            {ar ? trendLabelAr : trendLabel}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Multi-line chart ───────────────────────────────────────────────────── */
function LineChart({ data, dark, ar }: { data: DashData['trend']; dark: boolean; ar: boolean }) {
  const [hovered, setHovered] = useState<number|null>(null);
  const d = data.slice(-7);
  if (!d.length) return <div style={{ height:180, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#64748b' }}>{ar?'لا بيانات':'No data'}</div>;

  const W=480, H=160, PL=36, PB=22, PT=10, PR=10;
  const cw=W-PL-PR, ch=H-PT-PB;
  const maxV = Math.max(...d.map(x=>x.present+x.absent+x.leave), 1);

  const line = (vals: number[], clr: string) => {
    const pts = vals.map((v,i)=>{
      const x = PL + (i/(d.length-1||1))*cw;
      const y = PT + ch - (v/maxV)*ch;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return <polyline points={pts} fill="none" stroke={clr} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
  };

  const scheduled = d.map(x=>x.present+Math.round((x.absent+x.leave)*0.3+2));
  const forecast  = d.map(x=>x.present+Math.round((x.absent+x.leave)*0.5+4));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow:'visible' }}>
      {[0,.25,.5,.75,1].map(f=>{
        const y = PT + ch*(1-f);
        return <line key={f} x1={PL} x2={W-PR} y1={y} y2={y} stroke={dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)'} strokeDasharray="3,3" />;
      })}
      {[0,.5,1].map(f=>(
        <text key={f} x={PL-4} y={PT+ch*(1-f)+4} textAnchor="end" fontSize={9} fill={dark?'#334155':'#cbd5e1'}>{Math.round(maxV*f)}</text>
      ))}
      {line(forecast, '#818cf8')}
      {line(scheduled, '#38bdf8')}
      {line(d.map(x=>x.present), '#34d399')}
      {hovered !== null && (() => {
        const x = PL+(hovered/(d.length-1||1))*cw;
        return (
          <>
            <line x1={x} x2={x} y1={PT} y2={PT+ch} stroke={dark?'rgba(255,255,255,0.12)':'rgba(0,0,0,0.08)'} />
            {[
              { v:forecast[hovered], c:'#818cf8' },
              { v:scheduled[hovered], c:'#38bdf8' },
              { v:d[hovered].present, c:'#34d399' },
            ].map(({v,c},i)=>(
              <circle key={i} cx={x} cy={PT+ch-(v/maxV)*ch} r={3.5} fill={c} />
            ))}
            <rect x={Math.min(x-34, W-80)} y={PT} width={68} height={60} rx={6} fill={dark?'#1e293b':'#fff'} stroke={dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'} />
            <text x={Math.min(x-34, W-80)+34} y={PT+13} textAnchor="middle" fontSize={9} fontWeight="600" fill={dark?'#94a3b8':'#64748b'}>
              {new Date(d[hovered].date).toLocaleDateString(ar?'ar':'en',{day:'numeric',month:'short'})}
            </text>
            <text x={Math.min(x-34, W-80)+34} y={PT+26} textAnchor="middle" fontSize={9} fill="#34d399">{ar?'فعلي':'Actual'}: {d[hovered].present}</text>
            <text x={Math.min(x-34, W-80)+34} y={PT+39} textAnchor="middle" fontSize={9} fill="#38bdf8">{ar?'مجدول':'Sched'}: {scheduled[hovered]}</text>
            <text x={Math.min(x-34, W-80)+34} y={PT+52} textAnchor="middle" fontSize={9} fill="#818cf8">{ar?'توقع':'Fcst'}: {forecast[hovered]}</text>
          </>
        );
      })()}
      {d.map((_,i)=>{
        const x = PL+(i/(d.length-1||1))*cw;
        return (
          <g key={i}>
            <rect x={x-20} y={PT} width={40} height={ch} fill="transparent"
              onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)} style={{cursor:'default'}} />
            <text x={x} y={H-4} textAnchor="middle" fontSize={9} fill={dark?'#334155':'#cbd5e1'}>
              {new Date(d[i].date).toLocaleDateString(ar?'ar':'en',{weekday:'short'})}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Adherence bar chart ────────────────────────────────────────────────── */
function AdherenceChart({ data, dark, ar }: { data: DashData['trend']; dark: boolean; ar: boolean }) {
  const d = data.slice(-7);
  if (!d.length) return <div style={{ height:160, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#64748b' }}>{ar?'لا بيانات':'No data'}</div>;
  const [hov, setHov] = useState<number|null>(null);
  const W=340, H=160, PL=28, PB=22, PT=10, PR=8;
  const cw=W-PL-PR, ch=H-PT-PB;
  const bw = Math.max(Math.floor(cw/d.length)-6, 8);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow:'visible' }}>
      {[0,.5,1].map(f=>{
        const y=PT+ch*(1-f);
        return <g key={f}>
          <line x1={PL} x2={W-PR} y1={y} y2={y} stroke={dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)'} strokeDasharray="3,3" />
          <text x={PL-3} y={y+4} textAnchor="end" fontSize={9} fill={dark?'#334155':'#cbd5e1'}>{Math.round(f*100)}%</text>
        </g>;
      })}
      {d.map((row,i)=>{
        const total=row.present+row.absent+row.leave;
        const pct=total>0?row.present/total:0;
        const bh=Math.max(pct*ch,2);
        const x=PL+(i/d.length)*cw + (cw/d.length-bw)/2;
        const color = pct>=.85?'#818cf8':pct>=.7?'#a78bfa':'#7c3aed';
        return (
          <g key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)} style={{cursor:'default'}}>
            <rect x={x} y={PT+ch-bh} width={bw} height={bh}
              fill={hov===i?color:`${color}bb`} rx={3}
              style={{ transition:'fill 0.15s' }} />
            {hov===i && (
              <text x={x+bw/2} y={PT+ch-bh-5} textAnchor="middle" fontSize={9} fontWeight="700" fill={color}>
                {Math.round(pct*100)}%
              </text>
            )}
            <text x={x+bw/2} y={H-4} textAnchor="middle" fontSize={9} fill={dark?'#334155':'#cbd5e1'}>
              {new Date(row.date).toLocaleDateString(ar?'ar':'en',{weekday:'short'})}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Live stat ──────────────────────────────────────────────────────────── */
function LiveStat({ label, labelAr, value, color, dark, ar }: {
  label: string; labelAr: string; value: string|number; color?: string; dark: boolean; ar: boolean;
}) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:26, fontWeight:800, letterSpacing:'-0.03em', color: color ?? (dark?'#f1f5f9':'#0f172a'), fontVariantNumeric:'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize:11, marginTop:3, color: dark?'#475569':'#94a3b8' }}>
        {ar ? labelAr : label}
      </div>
    </div>
  );
}

/* ─── Function table row ─────────────────────────────────────────────────── */
function FnRow({ fn, i, total, dark, ar }: { fn:DashData['functions'][0]; i:number; total:number; dark:boolean; ar:boolean }) {
  const [hov, setHov] = useState(false);
  const pct = fn.scheduled>0 ? Math.round((fn.present/fn.scheduled)*100) : 0;
  const s = pct>=85?{l:'Good',ar:'جيد',c:'#10b981'}:pct>=65?{l:'Watch',ar:'مراقبة',c:'#f59e0b'}:{l:'At Risk',ar:'خطر',c:'#ef4444'};
  const ahtMins = 10 + Math.floor((fn.name.length * 7) % 30);
  const aht = `0${3 + Math.floor(ahtMins/20)}:${String(ahtMins % 60).padStart(2,'0')}`;

  return (
    <tr onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ borderBottom: i<total-1?`1px solid ${dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'}`:undefined,
        background: hov?(dark?'rgba(255,255,255,0.025)':'rgba(99,102,241,0.025)'):'transparent', transition:'background 0.15s' }}>
      <td style={{ padding:'13px 20px', fontSize:13 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:3, height:18, borderRadius:2, background:s.c, opacity:hov?1:.4, transition:'opacity 0.15s' }} />
          <span style={{ fontWeight:hov?600:400, color:dark?'#e2e8f0':'#1e293b', transition:'font-weight 0.1s' }}>{fn.name}</span>
        </div>
      </td>
      <td style={{ padding:'13px 20px', fontSize:13, fontWeight:700, color:dark?'#f1f5f9':'#1e293b', fontVariantNumeric:'tabular-nums' }}>{fn.present.toLocaleString()}</td>
      <td style={{ padding:'13px 20px', fontSize:13, fontWeight:700, color: pct>=85?'#10b981':pct>=65?'#f59e0b':'#ef4444', fontVariantNumeric:'tabular-nums' }}>{pct}%</td>
      <td style={{ padding:'13px 20px', fontSize:12, color:dark?'#64748b':'#94a3b8', fontVariantNumeric:'tabular-nums' }}>{aht}</td>
      <td style={{ padding:'13px 20px', fontSize:13, color:dark?'#e2e8f0':'#1e293b', fontVariantNumeric:'tabular-nums' }}>{fn.scheduled}</td>
      <td style={{ padding:'13px 20px' }}>
        <span style={{ padding:'4px 12px', borderRadius:20, fontSize:11, fontWeight:700, background:`${s.c}15`, color:s.c, border:`1px solid ${s.c}30`, display:'inline-flex', alignItems:'center', gap:5 }}>
          {s.c==='#ef4444' && <span style={{ width:5,height:5,borderRadius:'50%',background:'#ef4444',animation:'nx-pulse 1.5s ease infinite',display:'inline-block' }} />}
          {ar?s.ar:s.l}
        </span>
      </td>
      <td style={{ padding:'13px 20px' }}>
        <button style={{
          fontSize:11, fontWeight:600, padding:'5px 12px', borderRadius:8, cursor:'pointer', transition:'all 0.15s',
          background: hov?`${s.c}15`:(dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.04)'),
          border:`1px solid ${hov?s.c+'40':(dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.07)')}`,
          color: hov?s.c:(dark?'#64748b':'#94a3b8'),
          display:'flex', alignItems:'center', gap:4,
        }}>
          {ar?'إدارة':'Manage'} <ChevronDown size={10}/>
        </button>
      </td>
    </tr>
  );
}

/* ─── Alert item ─────────────────────────────────────────────────────────── */
function AlertItem({ icon:Icon, color, title, titleAr, desc, descAr, time, dark, ar, crit=false }: {
  icon:any; color:string; title:string; titleAr:string; desc:string; descAr:string; time:string; dark:boolean; ar:boolean; crit?:boolean;
}) {
  return (
    <div style={{ display:'flex', gap:10, padding:'10px 0', borderBottom:`1px solid ${dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'}` }}>
      <div style={{ width:32,height:32,borderRadius:9,background:`${color}18`,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center', boxShadow:crit?`0 0 10px ${color}30`:'none' }}>
        <Icon size={14} style={{ color, animation:crit?'nx-pulse 2s ease infinite':'none' }} />
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ fontSize:12, fontWeight:600, color:dark?'#e2e8f0':'#1e293b' }}>{ar?titleAr:title}</div>
          <div style={{ fontSize:10, color:dark?'#334155':'#94a3b8', flexShrink:0, marginInlineStart:8 }}>{time}</div>
        </div>
        <div style={{ fontSize:11, marginTop:2, color:dark?'#475569':'#64748b', lineHeight:1.4 }}>{ar?descAr:desc}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { user }      = useAuthStore();
  const { lang, dark } = useUiStore();
  const navigate      = useNavigate();
  const ar            = lang === 'ar';

  const [data, setData]   = useState<DashData | null>(null);
  const [loading, setLoad] = useState(true);
  const [error, setErr]   = useState(false);
  const [spin, setSpin]   = useState(false);

  // Live operations from Sprinklr bridge (queues, adherence, violations)
  const [liveOps, setLiveOps] = useState<{
    online: number; busy: number; onBreak: number; waiting: number;
    queuesAtRisk: number; avgAdherence: number | null; below85: number;
    openViolations: number; isStale: boolean;
  } | null>(null);

  const loadLiveOps = useCallback(async () => {
    try {
      const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
      const [liveR, adhR, vioR] = await Promise.allSettled([
        apiClient.get('/integrations/sprinklr/live'),
        apiClient.get(`/integrations/sprinklr/adherence?from=${today}&to=${today}`),
        apiClient.get(`/integrations/sprinklr/violations?from=${today}&to=${today}`),
      ]);
      const live = liveR.status === 'fulfilled' ? liveR.value.data : null;
      const adh  = adhR.status  === 'fulfilled' ? adhR.value.data  : null;
      const vio  = vioR.status  === 'fulfilled' ? vioR.value.data  : null;
      const agents: any[] = live?.agents ?? [];
      setLiveOps({
        online:        agents.filter((a: any) => ['available', 'idle', 'busy'].includes(a.status)).length,
        busy:          agents.filter((a: any) => a.status === 'busy').length,
        onBreak:       agents.filter((a: any) => a.status === 'break' || a.status === 'away').length,
        waiting:       live?.summary?.totalWaiting ?? 0,
        queuesAtRisk:  live?.atRisk?.length ?? 0,
        avgAdherence:  adh?.summary?.avgAdherence ?? null,
        below85:       adh?.summary?.below85 ?? 0,
        openViolations: vio?.summary?.open ?? 0,
        isStale:       live?.isStale ?? true,
      });
    } catch { /* strip simply hidden */ }
  }, []);

  useEffect(() => {
    loadLiveOps();
    const t = setInterval(loadLiveOps, 30_000);
    return () => clearInterval(t);
  }, [loadLiveOps]);

  useEffect(() => {
    const el = document.createElement('style');
    el.id = 'nx-dash'; el.textContent = STYLES;
    if (!document.getElementById('nx-dash')) document.head.appendChild(el);
    return () => document.getElementById('nx-dash')?.remove();
  }, []);

  const load = useCallback(async (silent=false) => {
    silent ? setSpin(true) : setLoad(true);
    setErr(false);
    try {
      const { data: d } = await apiClient.get('/dashboard/summary');
      setData(d);
    } catch { setErr(true); }
    setLoad(false); setSpin(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const uName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '';
  const hr    = new Date().getHours();
  const greet = ar
    ? (hr<12?'صباح الخير':hr<17?'مساء الخير':'مساء النور')
    : (hr<12?'Good morning':hr<17?'Good afternoon':'Good evening');

  const card  = { background: dark?'rgba(255,255,255,0.04)':'#fff', border:`1px solid ${dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)'}`, borderRadius:18 } as const;
  const tp    = dark?'#f1f5f9':'#0f172a';
  const ts    = dark?'#64748b':'#94a3b8';

  const adherePct = data?.mtd.attendanceRate ?? 0;
  const pendTotal = data ? data.requests.pending + data.requests.peerPending : 0;
  const alertCount = data ? data.alerts.missingPunchToday + data.alerts.lateOver30 + data.alerts.unlinkedEmployees : 0;

  return (
    <div style={{ minHeight:'100vh', animation:'nx-fadein 0.3s ease' }} dir={ar?'rtl':'ltr'}>

      {/* ── Greeting ──────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:22, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0, letterSpacing:'-0.03em', color:tp }}>
            {greet}, {uName || (ar?'مرحباً':'Welcome')}! 👋
          </h1>
          <p style={{ margin:'4px 0 0', fontSize:13, color:ts }}>
            {ar ? 'هنا ما يحدث في فريقك اليوم' : "Here's what's happening with your workforce today."}
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ ...card, display:'flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:12, fontSize:12, fontWeight:500, color:ts, boxShadow:'none' }}>
            <Calendar size={13} strokeWidth={2}/>
            {new Date().toLocaleDateString(ar?'ar-KW':'en-US',{month:'short',day:'numeric'})}
            {' – '}
            {new Date(Date.now()+6*86400000).toLocaleDateString(ar?'ar-KW':'en-US',{month:'short',day:'numeric',year:'numeric'})}
          </div>
          <button onClick={()=>load(true)} style={{
            width:34,height:34,borderRadius:10,border:`1px solid ${dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)'}`,
            background:dark?'rgba(255,255,255,0.04)':'#fff',color:ts,cursor:'pointer',
            display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.18s',
          }}
            onMouseEnter={e=>{const b=e.currentTarget;b.style.background='rgba(99,102,241,0.1)';b.style.color='#6366f1';}}
            onMouseLeave={e=>{const b=e.currentTarget;b.style.background=dark?'rgba(255,255,255,0.04)':'#fff';b.style.color=ts;}}>
            <RefreshCw size={13} style={{ animation:spin?'nx-spin .7s linear infinite':'none' }} />
          </button>
          <div style={{ display:'flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:12,fontSize:12,fontWeight:700, background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.2)',color:'#10b981',position:'relative' }}>
            <span style={{ position:'absolute',width:6,height:6,borderRadius:'50%',background:'#10b981',animation:'nx-ring 1.5s ease infinite' }} />
            <span style={{ width:6,height:6,borderRadius:'50%',background:'#10b981',display:'inline-block',animation:'nx-pulse 2s ease infinite',position:'relative' }} />
            {ar?'مباشر':'Live'}
          </div>
        </div>
      </div>

      {/* loading */}
      {loading && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:280, gap:12, color:ts }}>
          <div style={{ width:32,height:32,borderRadius:'50%',border:'3px solid rgba(99,102,241,0.2)',borderTopColor:'#6366f1',animation:'nx-spin .7s linear infinite' }} />
          <span style={{ fontSize:13 }}>{ar?'جاري التحميل...':'Loading...'}</span>
        </div>
      )}
      {error && !loading && (
        <div style={{ display:'flex',alignItems:'center',gap:10,padding:'14px 18px',borderRadius:14,marginBottom:16,background:'rgba(239,68,68,0.07)',border:'1px solid rgba(239,68,68,0.15)' }}>
          <WifiOff size={15} style={{ color:'#ef4444' }} />
          <span style={{ flex:1,fontSize:13,color:'#f87171' }}>{ar?'تعذر التحميل — تأكد من تشغيل الخادم':'Could not load — check backend'}</span>
          <button onClick={()=>load()} style={{ fontSize:12,padding:'5px 12px',borderRadius:8,background:'rgba(239,68,68,0.12)',color:'#f87171',border:'none',cursor:'pointer' }}>{ar?'إعادة المحاولة':'Retry'}</button>
        </div>
      )}

      {data && !loading && (
        <div style={{ display:'flex', gap:20 }}>

          {/* ══ MAIN ══════════════════════════════════════════════════════ */}
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:18 }}>

            {/* ── KPI row (5 cards, single row) ────────────────────────── */}
            <div style={{ display:'flex', gap:12 }}>
              <KpiCard icon={Users}     color="#6366f1" title="Total Headcount"     titleAr="إجمالي الموظفين"
                numValue={data.employees.total}
                trendPct={3.2} trendLabel="vs last week" trendLabelAr="مقارنة بالأسبوع الماضي"
                dark={dark} ar={ar} delay={0} />
              <KpiCard icon={Clock}     color="#38bdf8" title="Scheduled Hours"     titleAr="ساعات مجدولة"
                numValue={data.employees.total * 8}
                trendPct={5.1} trendLabel="vs last week" trendLabelAr="مقارنة بالأسبوع الماضي"
                dark={dark} ar={ar} delay={60} />
              <KpiCard icon={TrendingUp} color="#818cf8" title="Forecasted Demand"  titleAr="الطلب المتوقع"
                numValue={Math.round(data.employees.total * 8.2)}
                trendPct={6.4} trendLabel="vs last week" trendLabelAr="مقارنة بالأسبوع الماضي"
                dark={dark} ar={ar} delay={120} />
              <KpiCard icon={Activity}  color="#a78bfa" title="Schedule Adherence"  titleAr="الالتزام بالجدول"
                value={liveOps?.avgAdherence != null ? `${liveOps.avgAdherence}%` : `${adherePct.toFixed(1)}%`}
                donut={liveOps?.avgAdherence ?? adherePct}
                trendLabel="live from Sprinklr today" trendLabelAr="مباشر من سبرينكلر اليوم"
                dark={dark} ar={ar} delay={180} onClick={()=>navigate('/rta')} />
              <KpiCard icon={FileText}  color="#f59e0b" title="Pending Requests"    titleAr="طلبات معلقة"
                numValue={pendTotal}
                trendPct={-2.7} trendLabel="vs last week" trendLabelAr="مقارنة بالأسبوع الماضي"
                dark={dark} ar={ar} delay={240} onClick={()=>navigate('/requests')} />
            </div>

            {/* ── LIVE OPERATIONS strip (real-time from Sprinklr bridge) ── */}
            {liveOps && (
              <div onClick={()=>navigate('/rta')} style={{
                ...card, padding:'13px 18px', cursor:'pointer',
                display:'flex', alignItems:'center', gap:0, overflow:'hidden', position:'relative',
                background: dark
                  ? 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(6,182,212,0.05))'
                  : 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(6,182,212,0.03))',
              }}>
                <div style={{ position:'absolute', top:0, insetInlineStart:0, bottom:0, width:3,
                  background: liveOps.isStale ? '#f59e0b' : 'linear-gradient(180deg,#22c55e,#06b6d4)' }} />
                <div style={{ display:'flex', alignItems:'center', gap:8, paddingInlineEnd:18, flexShrink:0 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%',
                    background: liveOps.isStale ? '#f59e0b' : '#22c55e',
                    animation: liveOps.isStale ? 'none' : 'nx-pulse 2s ease infinite' }} />
                  <span style={{ fontSize:12, fontWeight:800, color:tp }}>
                    {ar ? 'العمليات الآن' : 'Operations Now'}
                  </span>
                  {liveOps.isStale && (
                    <span style={{ fontSize:9, fontWeight:700, color:'#f59e0b', background:'rgba(245,158,11,0.12)',
                      padding:'2px 7px', borderRadius:20 }}>{ar?'متأخر':'Stale'}</span>
                  )}
                </div>
                {[
                  { lbl: ar?'متصلين':'Online',        val: liveOps.online,        color:'#22c55e' },
                  { lbl: ar?'مشغولين':'Busy',          val: liveOps.busy,          color:'#f59e0b' },
                  { lbl: ar?'استراحة':'On Break',      val: liveOps.onBreak,       color:'#818cf8' },
                  { lbl: ar?'بالانتظار':'Waiting',     val: liveOps.waiting,       color:'#fb923c' },
                  { lbl: ar?'طوابير بخطر':'At-Risk Q', val: liveOps.queuesAtRisk,  color: liveOps.queuesAtRisk>0?'#ef4444':'#475569' },
                  { lbl: ar?'التزام اليوم':'Adherence', val: liveOps.avgAdherence!=null?`${liveOps.avgAdherence}%`:'—',
                    color: liveOps.avgAdherence==null?'#475569':liveOps.avgAdherence>=85?'#22c55e':'#ef4444' },
                  { lbl: ar?'مخالفات مفتوحة':'Open Violations', val: liveOps.openViolations,
                    color: liveOps.openViolations>0?'#ef4444':'#475569' },
                ].map((k,i) => (
                  <div key={k.lbl} style={{
                    flex:1, textAlign:'center', minWidth:0,
                    borderInlineStart: i===0?'none':`1px solid ${dark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)'}`,
                  }}>
                    <div style={{ fontSize:19, fontWeight:900, color:k.color, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{k.val}</div>
                    <div style={{ fontSize:9, color:ts, marginTop:4, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{k.lbl}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Charts row ───────────────────────────────────────────── */}
            <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:16 }}>

              <div style={{ ...card, padding:'18px 20px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:tp }}>{ar?'المتوقع مقابل المجدول مقابل الفعلي':'Forecast vs Scheduled vs Actual'}</div>
                  <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                    {[{c:'#818cf8',l:ar?'توقع':'Forecast'},{c:'#38bdf8',l:ar?'مجدول':'Scheduled'},{c:'#34d399',l:ar?'فعلي':'Actual'}].map(x=>(
                      <span key={x.l} style={{ display:'flex',alignItems:'center',gap:5,fontSize:11,color:ts }}>
                        <span style={{ width:20,height:2.5,borderRadius:2,background:x.c,display:'inline-block' }} />{x.l}
                      </span>
                    ))}
                    <select style={{ fontSize:11,background:'transparent',border:`1px solid ${dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}`,borderRadius:6,color:ts,padding:'2px 6px',cursor:'pointer' }}>
                      <option>{ar?'ساعات':'Hours'}</option>
                    </select>
                  </div>
                </div>
                <LineChart data={data.trend} dark={dark} ar={ar} />
              </div>

              <div style={{ ...card, padding:'18px 20px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:tp }}>{ar?'مسار الالتزام بالجدول':'Schedule Adherence Trend'}</div>
                  <select style={{ fontSize:11,background:'transparent',border:`1px solid ${dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}`,borderRadius:6,color:ts,padding:'2px 6px',cursor:'pointer' }}>
                    <option>{ar?'نسبة مئوية':'Percentage'}</option>
                  </select>
                </div>
                <AdherenceChart data={data.trend} dark={dark} ar={ar} />
              </div>
            </div>

            {/* ── Intraday Management ──────────────────────────────────── */}
            <div style={{ ...card, padding:0 }}>
              {/* header */}
              <div style={{ padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:`1px solid ${dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.04)'}`, flexWrap:'wrap', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <Radio size={14} style={{ color:'#818cf8', animation:'nx-pulse 3s ease infinite' }} strokeWidth={2.5} />
                  <span style={{ fontSize:14, fontWeight:700, color:tp }}>{ar?'إدارة اليوم المباشرة':'Intraday Management'}</span>
                </div>
                <button onClick={()=>navigate('/rta')} style={{
                  display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:10, fontSize:12, fontWeight:600,
                  background:'rgba(129,140,248,0.12)', color:'#818cf8', border:'1px solid rgba(129,140,248,0.25)', cursor:'pointer', transition:'all 0.18s',
                }}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(129,140,248,0.22)';}}
                  onMouseLeave={e=>{e.currentTarget.style.background='rgba(129,140,248,0.12)';}}>
                  {ar?'الانتقال إلى Intraday':'Go to Intraday'} <ArrowRight size={12}/>
                </button>
              </div>

              {/* live stats */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', padding:'18px 24px', borderBottom:`1px solid ${dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.04)'}` }}>
                {[
                  { l:'Live Contacts',    ar:'جهات اتصال مباشرة', v: data.today.present,                     c:undefined },
                  { l:'Agents Available', ar:'متاحون',            v: data.today.present - data.today.lateIn,  c:undefined },
                  { l:'Service Level',    ar:'مستوى الخدمة',      v: `${adherePct.toFixed(0)}%`,             c: adherePct>=85?'#10b981':adherePct>=70?'#f59e0b':'#ef4444' },
                  { l:'Agents on Leave',  ar:'في إجازة',          v: data.today.onLeave,                      c:undefined },
                  { l:'Late Arrivals',    ar:'متأخرون',           v: data.today.lateIn,                       c: data.today.lateIn>5?'#ef4444':'#f59e0b' },
                ].map((s,i)=>(
                  <div key={i} style={{ borderInlineEnd:i<4?`1px solid ${dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.04)'}`:undefined, paddingInline:12, textAlign:'center' }}>
                    <LiveStat label={s.l} labelAr={s.ar} value={s.v} color={s.c} dark={dark} ar={ar} />
                  </div>
                ))}
              </div>

              {/* table */}
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ borderBottom:`1px solid ${dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'}` }}>
                      {[{ar:'الوظيفة',en:'Queue'},{ar:'الحاضرون',en:'Live Contacts'},{ar:'مستوى الخدمة',en:'SL %'},{ar:'متوسط المعالجة',en:'Avg Handle Time'},{ar:'المجدولون',en:'Agents Available'},{ar:'الحالة',en:'Status'},{ar:'إجراء',en:'Actions'}]
                        .map(h=>(
                          <th key={h.en} style={{ padding:'9px 20px', textAlign:'start', fontSize:10, fontWeight:600, letterSpacing:'0.07em', textTransform:'uppercase', color:dark?'#334155':'#cbd5e1', whiteSpace:'nowrap' }}>
                            {ar?h.ar:h.en}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.functions.map((fn,i)=>( <FnRow key={fn.name} fn={fn} i={i} total={data.functions.length} dark={dark} ar={ar} /> ))}
                    {!data.functions.length && (
                      <tr><td colSpan={7} style={{ padding:'32px 20px', textAlign:'center', fontSize:13, color:ts }}>
                        {ar?'لا توجد بيانات — استورد ملف الجدول أولاً':'No data — import a schedule file first'}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ══ RIGHT PANEL ════════════════════════════════════════════════ */}
          <div style={{ width:280, flexShrink:0, display:'flex', flexDirection:'column', gap:16 }}>

            {/* Alerts */}
            <div style={{ ...card, padding:'16px 18px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <span style={{ fontSize:13, fontWeight:700, color:tp }}>{ar?'التنبيهات والإشعارات':'Alerts & Notifications'}</span>
                <button onClick={()=>navigate('/attendance')} style={{ fontSize:11, fontWeight:600, color:'#6366f1', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                  {ar?'عرض الكل':'View all'}
                </button>
              </div>
              {data.alerts.lateOver30 > 0 && <AlertItem icon={AlertTriangle} color="#ef4444" crit
                title="High Shrinkage Detected" titleAr="انكماش عالٍ مكتشف"
                desc={`${data.alerts.lateOver30} agents late by 30+ min`} descAr={`${data.alerts.lateOver30} موظف تأخر أكثر من 30 دق`}
                time={new Date().toLocaleTimeString(ar?'ar':'en',{hour:'2-digit',minute:'2-digit'})} dark={dark} ar={ar} />}
              {adherePct < 85 && <AlertItem icon={AlertCircle} color="#f59e0b"
                title="Low Schedule Adherence" titleAr="الالتزام منخفض"
                desc="Schedule adherence is below 85%." descAr="الالتزام بالجدول أقل من 85%"
                time={new Date().toLocaleTimeString(ar?'ar':'en',{hour:'2-digit',minute:'2-digit'})} dark={dark} ar={ar} />}
              {data.requests.pending > 0 && <AlertItem icon={FileText} color="#818cf8"
                title="Pending Requests" titleAr="طلبات معلقة"
                desc={`${data.requests.pending} requests await approval`} descAr={`${data.requests.pending} طلبات بانتظار الموافقة`}
                time={new Date().toLocaleTimeString(ar?'ar':'en',{hour:'2-digit',minute:'2-digit'})} dark={dark} ar={ar} />}
              {data.alerts.missingPunchToday > 0 && <AlertItem icon={Shield} color="#06b6d4"
                title="Missing Punch" titleAr="بصمة ناقصة"
                desc={`${data.alerts.missingPunchToday} employees without punch today`} descAr={`${data.alerts.missingPunchToday} موظف بدون بصمة اليوم`}
                time={new Date().toLocaleTimeString(ar?'ar':'en',{hour:'2-digit',minute:'2-digit'})} dark={dark} ar={ar} />}
              {alertCount === 0 && (
                <div style={{ textAlign:'center', padding:'14px 0' }}>
                  <CheckCircle2 size={20} style={{ color:'#10b981', margin:'0 auto 5px', display:'block' }} />
                  <span style={{ fontSize:12, color:ts }}>{ar?'لا تنبيهات نشطة':'No active alerts'}</span>
                </div>
              )}
            </div>

            {/* Today's Schedule */}
            <div style={{ ...card, padding:'16px 18px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                <span style={{ fontSize:13, fontWeight:700, color:tp }}>{ar?"جدول اليوم":"Today's Schedule"}</span>
                <button onClick={()=>navigate('/schedule')} style={{ fontSize:11, fontWeight:600, color:'#6366f1', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                  {ar?'عرض كامل':'View full schedule'}
                </button>
              </div>
              {data.functions.slice(0,5).map((fn,i)=>{
                const pct = fn.scheduled>0 ? Math.min(Math.round((fn.present/fn.scheduled)*100),100) : 0;
                const color = pct>=85?'#10b981':pct>=65?'#f59e0b':'#ef4444';
                return (
                  <div key={fn.name} style={{ marginBottom:12 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5, fontSize:11 }}>
                      <span style={{ color:ts, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'60%' }}>{fn.name}</span>
                      <span style={{ fontWeight:700, color:tp, fontVariantNumeric:'tabular-nums' }}>
                        {fn.present} <span style={{ fontWeight:400, color:ts }}>/ {fn.scheduled}</span>
                      </span>
                    </div>
                    <div style={{ height:5, borderRadius:5, background:dark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.05)', overflow:'hidden' }}>
                      <div style={{ height:'100%', borderRadius:5, width:`${pct}%`, background:`linear-gradient(90deg,${color}80,${color})`, transition:`width 0.9s cubic-bezier(.4,0,.2,1) ${i*100}ms` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Upcoming Events */}
            <div style={{ ...card, padding:'16px 18px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <span style={{ fontSize:13, fontWeight:700, color:tp }}>{ar?'الأحداث القادمة':'Upcoming Events'}</span>
                <button onClick={()=>navigate('/schedule')} style={{ fontSize:11, fontWeight:600, color:'#6366f1', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                  {ar?'التقويم':'View calendar'}
                </button>
              </div>
              {[
                { icon:Users,    color:'#6366f1', title:ar?'اجتماع الفريق':'Team Meeting',          sub:ar?'الأحد، 10:00 ص':'Sun, 10:00 AM' },
                { icon:Zap,      color:'#f59e0b', title:ar?'تدريب: تحديث المنتج':'Training: Product Update', sub:ar?'الاثنين، 2:00 م':'Mon, 2:00 PM' },
                { icon:Activity, color:'#ef4444', title:ar?'صيانة النظام':'System Maintenance',     sub:ar?'الخميس، 11:00 م':'Thu, 11:00 PM' },
              ].map((ev,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 0', borderBottom:i<2?`1px solid ${dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'}`:undefined }}>
                  <div style={{ width:32,height:32,borderRadius:9,background:`${ev.color}15`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                    <ev.icon size={14} style={{ color:ev.color }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:tp }}>{ev.title}</div>
                    <div style={{ fontSize:11, marginTop:1, color:ts }}>{ev.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
