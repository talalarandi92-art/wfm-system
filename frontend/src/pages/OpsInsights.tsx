import { useState, useEffect } from 'react';
import {
  Phone, Clock, Coffee, ShoppingCart, CalendarRange,
  TrendingUp, Activity, Headphones, RotateCcw, Globe, Layers, Award,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';

/* shared mini components (match OperationsAnalytics styling) */
function KpiCard({ icon: Icon, label, value, sub, color = '#6366f1' }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}22`, color }}><Icon size={18} /></div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">{label}</p>
        <p className="text-xl font-bold text-white leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}
function HBar({ label, value, max, color = '#6366f1', suffix = '', fmt }: {
  label: string; value: number; max: number; color?: string; suffix?: string; fmt?: (n: number) => string;
}) {
  const pct = max ? Math.round(100 * value / max) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-44 truncate text-start" title={label}>{label}</span>
      <div className="flex-1 h-5 rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div className="h-full rounded-lg transition-all"
          style={{ width: `${Math.max(pct, 3)}%`, background: `linear-gradient(90deg, ${color}cc, ${color}77)` }} />
      </div>
      <span className="text-xs font-bold text-white w-20 text-end">{fmt ? fmt(value) : value.toLocaleString()}{suffix}</span>
    </div>
  );
}
function Section({ title, children }: { title: string; children: any }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <h3 className="text-sm font-bold text-white mb-4">{title}</h3>
      {children}
    </div>
  );
}
const hms = (s: number) => { s = Math.round(s); const m = Math.floor(s / 60), ss = s % 60; return m >= 60 ? `${Math.floor(m/60)}h${m%60}m` : `${m}m ${ss}s`; };
const k = (n: number) => n >= 1000 ? `${(n/1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`;

type Sub = 'volume' | 'productivity' | 'shrinkage' | 'scorecard' | 'orders' | 'peaks' | 'overtime';
const SUBS: { key: Sub; icon: any; ar: string; en: string }[] = [
  { key: 'volume',       icon: Phone,        ar: 'حجم التواصل + CPO', en: 'Volume & CPO' },
  { key: 'productivity', icon: Headphones,   ar: 'الإنتاجية',          en: 'Productivity' },
  { key: 'shrinkage',    icon: Coffee,       ar: 'الـShrinkage',       en: 'Shrinkage' },
  { key: 'scorecard',    icon: Award,        ar: 'اتجاه النقاط (عرض تشغيلي)', en: 'Net Points trend (operational view)' },
  { key: 'orders',       icon: ShoppingCart, ar: 'الطلبات',            en: 'Orders' },
  { key: 'peaks',        icon: CalendarRange,ar: 'أيام الذروة',        en: 'Peak Events' },
  { key: 'overtime',     icon: Clock,        ar: 'الأوفر تايم',        en: 'Overtime' },
];
const CH = { voice:'#6366f1', chat:'#06b6d4', whatsapp:'#22c55e', social:'#f59e0b', email:'#ec4899' } as Record<string,string>;

export default function OpsInsightsPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [sub, setSub] = useState<Sub>('volume');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ep: Record<Sub, string> = {
      volume: '/ops-analytics/volume', productivity: '/ops-analytics/productivity',
      shrinkage: '/ops-analytics/shrinkage', orders: '/ops-analytics/orders',
      scorecard: '/ops-analytics/scorecards',
      peaks: '/attendance/peak-events', overtime: '/attendance/ot-monthly',
    };
    if (data[sub]) return;
    setLoading(true);
    apiClient.get(ep[sub]).then(r => setData(d => ({ ...d, [sub]: r.data })))
      .catch(() => setData(d => ({ ...d, [sub]: { error: true } })))
      .finally(() => setLoading(false));
  }, [sub]); // eslint-disable-line

  const d = data[sub];
  const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="space-y-5">
      {/* sub-tabs */}
      <div className="flex flex-wrap gap-2">
        {SUBS.map(s => {
          const A = s.icon, on = s.key === sub;
          return (
            <button key={s.key} onClick={() => setSub(s.key)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all"
              style={on
                ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }
                : { background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}>
              <A size={14} />{ar ? s.ar : s.en}
            </button>
          );
        })}
      </div>

      {loading && !d && <p className="text-sm text-slate-500 py-10 text-center">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {d?.error && <p className="text-sm text-rose-400 py-10 text-center">{ar ? 'تعذّر تحميل البيانات' : 'Failed to load'}</p>}

      {/* ── VOLUME & CPO ── */}
      {sub === 'volume' && d && !d.error && (() => {
        const t = d.totals || {}; const max = Math.max(...(d.byChannel||[]).map((c:any)=>c.offered), 1);
        const pk = (d.profile||[]).reduce((a:any,p:any)=>Number(p.offered)>Number(a?.offered||0)?p:a, null);
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Phone} label={ar?'إجمالي التواصل':'Total Contacts'} value={k(t.offered||0)} sub={`${d.from} → ${d.to}`} />
              <KpiCard icon={Activity} label="AHT" value={hms(t.ahtSec||0)} color="#06b6d4" />
              <KpiCard icon={TrendingUp} label={ar?'نسبة الإهمال':'Abandon %'} value={`${t.abandonPct||0}%`} color="#f43f5e" />
              <KpiCard icon={Layers} label="CPO" value={d.cpo?.cpo ?? '—'} sub={d.cpo? `${k(d.cpo.contacts)} / ${k(d.cpo.orders)} ${ar?'طلب':'orders'}` : ''} color="#22c55e" />
            </div>
            <Section title={ar?'حسب القناة (المعروض)':'By channel (offered)'}>
              <div className="space-y-2">
                {(d.byChannel||[]).map((c:any)=>(
                  <HBar key={c.channel} label={`${c.channel} · AHT ${hms(c.talk_seconds/(c.handled||1))}`} value={Number(c.offered)} max={max} color={CH[c.channel]||'#6366f1'} fmt={k} />
                ))}
              </div>
            </Section>
            {pk && <p className="text-xs text-slate-500">{ar?'ذروة نصف الساعة:':'Peak half-hour:'} <span className="text-white font-bold">{String(Math.floor(pk.interval_idx/2)).padStart(2,'0')}:{pk.interval_idx%2?'30':'00'}</span> · {k(Number(pk.offered))} {ar?'تواصل':'contacts'}</p>}
            {d.cpo && <p className="text-[11px] text-slate-500">CPO = {d.cpo.note} ({(d.cpo.channels||[]).join(', ')})</p>}
          </div>
        );
      })()}

      {/* ── PRODUCTIVITY ── */}
      {sub === 'productivity' && d && !d.error && (() => {
        const s = d.summary || {}; const max = Math.max(...(d.top||[]).map((a:any)=>a.calls), 1);
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Headphones} label={ar?'موظفين (صوت)':'Voice agents'} value={s.agents||0} sub={`${s.days||0} ${ar?'يوم':'days'}`} />
              <KpiCard icon={Activity} label="AHT" value={hms(s.ahtSec||0)} color="#06b6d4" />
              <KpiCard icon={TrendingUp} label="Occupancy" value={`${s.occupancyPct||0}%`} color="#22c55e" />
              <KpiCard icon={Coffee} label={ar?'وقت البريك':'Break %'} value={`${s.breakPct||0}%`} color="#f59e0b" />
            </div>
            <Section title={ar?'أعلى الموظفين (مكالمات)':'Top agents (calls)'}>
              <div className="space-y-2">
                {(d.top||[]).slice(0,15).map((a:any)=>(
                  <HBar key={a.agent_login} label={`${a.name||a.agent_login} · AHT ${hms(a.aht_s)} · ${a.occupancy}%`} value={a.calls} max={max} color="#6366f1" fmt={k} />
                ))}
              </div>
            </Section>
            <p className="text-[11px] text-slate-500">{ar?'القناة:':'Channel:'} {s.channel}</p>
          </div>
        );
      })()}

      {/* ── SHRINKAGE ── */}
      {sub === 'shrinkage' && d && !d.error && (() => {
        const max = Math.max(...(d.byReason||[]).map((r:any)=>Number(r.hours)), 1);
        const GLAB: Record<string,{ar:string;en:string;c:string}> = {
          break:{ar:'بريك',en:'Break',c:'#f59e0b'}, meeting_training:{ar:'اجتماع/تدريب',en:'Meeting/Training',c:'#8b5cf6'},
          cross_channel:{ar:'عمل بقناة أخرى',en:'Cross-channel',c:'#06b6d4'}, acw:{ar:'ACW',en:'ACW',c:'#ec4899'},
          system_unavailable:{ar:'نظام/غير متاح',en:'System/Unavail',c:'#64748b'}, other:{ar:'أخرى',en:'Other',c:'#475569'} };
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Coffee} label={ar?'إجمالي ساعات الـAUX':'Total AUX hours'} value={k(Math.round(d.totalHours||0))} sub={`${d.from} → ${d.to}`} />
              {(d.categories||[]).slice(0,3).map((c:any)=>(
                <KpiCard key={c.group} icon={Layers} label={ar?GLAB[c.group]?.ar:GLAB[c.group]?.en||c.group} value={`${c.pct}%`} sub={`${k(Math.round(c.hours))}h`} color={GLAB[c.group]?.c} />
              ))}
            </div>
            <Section title={ar?'حسب السبب (ساعات)':'By reason (hours)'}>
              <div className="space-y-2">
                {(d.byReason||[]).slice(0,14).map((r:any)=>(
                  <HBar key={r.reason} label={r.reason} value={Math.round(Number(r.hours))} max={max} color="#f59e0b" fmt={k} />
                ))}
              </div>
            </Section>
          </div>
        );
      })()}

      {/* ── SCORECARD ── */}
      {sub === 'scorecard' && d && !d.error && (() => {
        const maxT = Math.max(...(d.trend||[]).map((t:any)=>t.avg_net),1);
        const maxF = Math.max(...(d.byFunction||[]).map((f:any)=>f.avg_net),1);
        const grade = (n:number) => n>=90?'#22c55e':n>=75?'#06b6d4':n>=60?'#f59e0b':'#f43f5e';
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Award} label={ar?'الشهر':'Period'} value={`${MONTHS[d.period?.month]} ${d.period?.year}`} sub={`${(d.top||[]).length+(d.bottom||[]).length}+ ${ar?'موظف':'agents'}`} color="#8b5cf6" />
              <KpiCard icon={TrendingUp} label={ar?'متوسط النقاط':'Avg Net Points'} value={(d.trend||[]).slice(-1)[0]?.avg_net ?? '—'} color="#22c55e" />
              <KpiCard icon={Layers} label={ar?'أشهر مغطّاة':'Months'} value={(d.trend||[]).length} color="#06b6d4" />
              <KpiCard icon={Activity} label={ar?'أفضل فنكشن':'Top function'} value={(d.byFunction||[])[0]?.avg_net ?? '—'} sub={(d.byFunction||[])[0]?.function_name} color="#f59e0b" />
            </div>
            <Section title={ar?'اتجاه النقاط شهريًا':'Monthly Net-Points trend'}>
              <div className="space-y-2">
                {(d.trend||[]).map((t:any)=>(
                  <HBar key={`${t.year}-${t.month}`} label={`${MONTHS[t.month]} ${t.year} · ${t.agents}👥`} value={t.avg_net} max={maxT} color={grade(t.avg_net)} />
                ))}
              </div>
            </Section>
            <div className="grid md:grid-cols-2 gap-4">
              <Section title={ar?'أعلى الموظفين':'Top agents'}>
                <div className="space-y-2">{(d.top||[]).map((a:any)=>(
                  <HBar key={a.employee_no} label={`${a.name} · ${a.function_name||''}`} value={a.avg_net} max={120} color={grade(a.avg_net)} />
                ))}</div>
              </Section>
              <Section title={ar?'حسب الفنكشن':'By function'}>
                <div className="space-y-2">{(d.byFunction||[]).map((f:any)=>(
                  <HBar key={f.function_name} label={`${f.function_name} · ${f.agents}👥`} value={f.avg_net} max={maxF} color={grade(f.avg_net)} />
                ))}</div>
              </Section>
            </div>
            <p className="text-[11px] text-slate-500">{d.note}</p>
            <p className="text-[11px] text-slate-500">
              {ar ? 'التقييم الرسمي التفصيلي في صفحة السكوركارد' : 'Per-KPI official scoring lives in the Scorecard hub'}
              {' — '}
              <Link to="/scorecard?tab=overview" className="underline hover:text-slate-300">{ar ? 'افتح السكوركارد' : 'open Scorecard'}</Link>
            </p>
          </div>
        );
      })()}

      {/* ── ORDERS ── */}
      {sub === 'orders' && d && !d.error && (() => {
        const dim = d.dimensions || {};
        const block = (key:string, label:string, color:string) => {
          const rows = dim[key]||[]; const max = Math.max(...rows.map((r:any)=>r.count),1);
          return (
            <Section title={label} key={key}>
              <div className="space-y-2">{rows.slice(0,8).map((r:any)=>(
                <HBar key={r.bucket} label={`${r.bucket} · ${r.pct}%`} value={r.count} max={max} color={color} fmt={k} />
              ))}</div>
            </Section>
          );
        };
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={ShoppingCart} label={ar?'إجمالي الطلبات':'Total orders'} value={k(d.total||0)} sub={d.period} />
              <KpiCard icon={RotateCcw} label={ar?'مرتجعات':'Returns'} value={k((dim.return||[]).filter((r:any)=>r.bucket!=='NONE').reduce((s:number,r:any)=>s+r.count,0))} color="#f43f5e" />
              <KpiCard icon={Layers} label={ar?'استبدال':'Exchanges'} value={k((dim.type||[]).find((r:any)=>r.bucket==='EXCHANGE')?.count||0)} color="#f59e0b" />
              <KpiCard icon={Globe} label={ar?'دول':'Countries'} value={(dim.country||[]).length} color="#06b6d4" />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {block('country', ar?'حسب الدولة':'By country', '#06b6d4')}
              {block('type', ar?'نوع الطلب':'Order type', '#8b5cf6')}
              {block('customer_type', ar?'نوع العميل':'Customer tier', '#22c55e')}
              {block('return', ar?'نوع المرتجع':'Return type', '#f43f5e')}
            </div>
          </div>
        );
      })()}

      {/* ── PEAK EVENTS ── */}
      {sub === 'peaks' && d && !d.error && (() => {
        const max = Math.max(...(d.events||[]).map((e:any)=>e.ot_hours),1);
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(d.byYear||[]).map((y:any)=>(
                <KpiCard key={y.year} icon={CalendarRange} label={`${y.year} ${ar?'ذروات':'peaks'}`} value={y.events} sub={`${k(Math.round(y.ot_hours))}h OT`} color="#8b5cf6" />
              ))}
            </div>
            <Section title={ar?'أحداث الذروة (ساعات OT)':'Peak events (OT hours)'}>
              <div className="space-y-2">
                {(d.events||[]).slice(0,16).map((e:any,i:number)=>(
                  <HBar key={i} label={`${e.event_name} · ${e.start_date||''} · ${e.headcount}👥`} value={Math.round(e.ot_hours)} max={max} color="#8b5cf6" suffix="h" />
                ))}
              </div>
            </Section>
          </div>
        );
      })()}

      {/* ── OVERTIME ── */}
      {sub === 'overtime' && d && !d.error && (() => {
        const maxT = Math.max(...(d.trend||[]).map((t:any)=>t.ot_hours),1);
        const maxE = Math.max(...(d.top||[]).map((t:any)=>t.ot_hours),1);
        return (
          <div className="space-y-5">
            <Section title={ar?'الأوفر تايم حسب الشهر (ساعات)':'OT by month (hours)'}>
              <div className="space-y-2">
                {(d.trend||[]).map((t:any)=>(
                  <HBar key={`${t.year}-${t.month}`} label={`${MONTHS[t.month]} ${t.year} · ${t.employees}👥`} value={t.ot_hours} max={maxT} color="#10b981" suffix="h" />
                ))}
              </div>
            </Section>
            <Section title={ar?'أعلى الموظفين بالأوفر تايم':'Top OT employees'}>
              <div className="space-y-2">
                {(d.top||[]).slice(0,12).map((t:any)=>(
                  <HBar key={t.name} label={`${t.name}${t.employee_no?` · ${t.employee_no}`:''}`} value={t.ot_hours} max={maxE} color="#10b981" suffix="h" />
                ))}
              </div>
            </Section>
          </div>
        );
      })()}
    </div>
  );
}
