import { useEffect, useMemo, useState } from 'react';
import { Phone, PhoneCall, PhoneOff, Coffee, PauseCircle, Users, Activity, RefreshCw, Search, Stethoscope } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile, Donut, Gauge } from '@/components/dazzle';

/** Live telephony wallboard fed by the Ameyo Chrome-extension bridge (/integrations/ameyo/live). */

type State = 'available' | 'busy' | 'acw' | 'hold' | 'break' | 'idle' | 'offline' | 'unknown';
interface AmeyoAgent {
  name: string; agentId: string | null; employeeNo: string | null; linked: boolean;
  state: State; statusRaw: string | null; callStatus: string | null; callType: string | null;
  autoCall: string | null; phone: string | null; customerStatus: string | null;
}
interface AmeyoLiveResp {
  capturedAt: string | null; stale: boolean; staleSec: number | null; linkedCount?: number;
  kpis: { total: number; online: number; available: number; busy: number; acw: number; hold: number; break: number; idle: number; offline: number; occupancyPct: number | null };
  agents: AmeyoAgent[]; queues: any[]; rawKpis: Record<string, any>;
}

const ST: Record<State, { c: string; ar: string; en: string }> = {
  available: { c: '#22c55e', ar: 'متاح', en: 'Available' },
  busy: { c: '#3b82f6', ar: 'بمكالمة', en: 'On Call' },
  acw: { c: '#a855f7', ar: 'إنهاء (ACW)', en: 'ACW' },
  hold: { c: '#f59e0b', ar: 'تعليق', en: 'On Hold' },
  break: { c: '#f97316', ar: 'استراحة', en: 'Break' },
  idle: { c: '#94a3b8', ar: 'خامل', en: 'Idle' },
  offline: { c: '#64748b', ar: 'غير متصل', en: 'Offline' },
  unknown: { c: '#475569', ar: 'غير معروف', en: 'Unknown' },
};

const fmtAgo = (sec: number | null, ar: boolean) => {
  if (sec == null) return '—';
  if (sec < 60) return ar ? `قبل ${sec}ث` : `${sec}s ago`;
  if (sec < 3600) return ar ? `قبل ${Math.round(sec / 60)}د` : `${Math.round(sec / 60)}m ago`;
  return ar ? `قبل ${Math.round(sec / 3600)}س` : `${Math.round(sec / 3600)}h ago`;
};

export default function AmeyoLive() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [data, setData] = useState<AmeyoLiveResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<State | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const pull = async () => {
    try {
      const { data } = await apiClient.get<AmeyoLiveResp>('/integrations/ameyo/live');
      setData(data); setErr(null);
    } catch (e: any) { setErr(e?.response?.data?.message || e?.message || 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { pull(); const t = setInterval(pull, 15000); return () => clearInterval(t); }, []);

  const k = data?.kpis;
  const agents = data?.agents || [];
  const shown = useMemo(() => agents.filter(a =>
    (filter === 'all' || a.state === filter) &&
    (!q || (a.name || '').toLowerCase().includes(q.toLowerCase()) || String(a.employeeNo || '').includes(q))
  ), [agents, filter, q]);

  const donutSegs = k ? (['available', 'busy', 'acw', 'hold', 'break', 'idle', 'offline'] as State[])
    .map(s => ({ label: ST[s][ar ? 'ar' : 'en'], value: (k as any)[s] || 0, color: ST[s].c }))
    .filter(s => s.value > 0) : [];

  const hasData = !!data?.capturedAt;
  const stale = data?.stale;

  return (
    <div style={{ padding: '20px 22px', maxWidth: 1240, margin: '0 auto' }} dir={ar ? 'rtl' : 'ltr'}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#1e3a8a,#3b82f6)', display: 'grid', placeItems: 'center' }}>
            <Phone size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>{ar ? 'أميو — المراقبة المباشرة' : 'Ameyo — Live Monitoring'}</h1>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{ar ? 'جسر الهاتفية المباشر' : 'Live telephony bridge'}</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {hasData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 700,
            background: stale ? 'rgba(239,68,68,.12)' : 'rgba(34,197,94,.12)', color: stale ? '#ef4444' : '#22c55e', border: `1px solid ${stale ? 'rgba(239,68,68,.35)' : 'rgba(34,197,94,.35)'}` }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: stale ? '#ef4444' : '#22c55e', boxShadow: stale ? 'none' : '0 0 8px #22c55e' }} />
            {stale ? (ar ? 'قديم' : 'STALE') : (ar ? 'مباشر' : 'LIVE')} · {fmtAgo(data!.staleSec, ar)}
          </div>
        )}
        <button onClick={pull} title="refresh" style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <RefreshCw size={16} />
        </button>
      </div>

      {/* stale / empty banners */}
      {!loading && !hasData && (
        <div style={{ padding: '18px 20px', borderRadius: 12, background: 'var(--surface)', border: '1px dashed var(--border)', color: 'var(--text-2)', marginBottom: 18, lineHeight: 1.7 }}>
          <b style={{ color: 'var(--text-1)' }}>{ar ? 'ما في بيانات أميو بعد.' : 'No Ameyo data yet.'}</b><br />
          {ar ? 'حمّل إكستنشن «WFM Bridge — Ameyo» على متصفّح المشرف، سجّل الدخول، وافتح شاشة Ameyo Live Monitoring وثبّت التبويب (Pin). البيانات رح تبين هون خلال ثوانٍ.'
              : 'Load the "WFM Bridge — Ameyo" extension on the supervisor browser, sign in, open the Ameyo Live-Monitoring screen and pin the tab. Data appears here within seconds.'}
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Stethoscope size={14} /> {ar ? 'لو ما بان: افتح الإكستنشن واضغط 🩺 Doctor + «نسخ العيّنات».' : 'If nothing shows: open the extension, click 🩺 Doctor + "Copy samples".'}
          </div>
        </div>
      )}
      {stale && hasData && (
        <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
          {ar ? `الجسر متوقّف عن الإرسال — آخر بيانات ${fmtAgo(data!.staleSec, ar)}. افتح تبويب Ameyo وثبّته، واضغط 🩺 Doctor بالإكستنشن.`
              : `Bridge stopped pushing — last data ${fmtAgo(data!.staleSec, ar)}. Open + pin the Ameyo tab, click 🩺 Doctor in the extension.`}
        </div>
      )}
      {err && <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{err}</div>}

      {hasData && k && (
        <>
          {/* KPI tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12, marginBottom: 16 }}>
            <StatTile icon={Users} label={ar ? 'إجمالي' : 'Total'} num={k.total} color="#64748b" />
            <StatTile icon={Phone} label={ST.available[ar ? 'ar' : 'en']} num={k.available} color={ST.available.c} />
            <StatTile icon={PhoneCall} label={ST.busy[ar ? 'ar' : 'en']} num={k.busy} color={ST.busy.c} />
            <StatTile icon={Activity} label={ST.acw[ar ? 'ar' : 'en']} num={k.acw} color={ST.acw.c} />
            <StatTile icon={PauseCircle} label={ST.hold[ar ? 'ar' : 'en']} num={k.hold} color={ST.hold.c} />
            <StatTile icon={Coffee} label={ST.break[ar ? 'ar' : 'en']} num={k.break} color={ST.break.c} />
            <StatTile icon={PhoneOff} label={ST.offline[ar ? 'ar' : 'en']} num={k.offline} color={ST.offline.c} />
          </div>

          {/* donut + occupancy + linked */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px,1fr) minmax(200px,240px) minmax(200px,1fr)', gap: 14, marginBottom: 18, alignItems: 'stretch' }}>
            <div style={card}>
              <div style={cardH}>{ar ? 'توزيع الحالات' : 'Agent states'}</div>
              {donutSegs.length ? <div style={{ display: 'grid', placeItems: 'center', paddingTop: 6 }}><Donut segments={donutSegs} centerNum={k.online} centerLabel={ar ? 'متصل' : 'online'} size={172} /></div>
                : <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 30 }}>—</div>}
            </div>
            <div style={card}>
              <div style={cardH}>{ar ? 'الإشغال' : 'Occupancy'}</div>
              <div style={{ display: 'grid', placeItems: 'center', paddingTop: 6 }}>
                <Gauge value={k.occupancyPct ?? 0} label={ar ? 'إشغال' : 'occupancy'} color={(k.occupancyPct ?? 0) > 88 ? '#ef4444' : (k.occupancyPct ?? 0) > 75 ? '#f59e0b' : '#22c55e'} />
              </div>
            </div>
            <div style={card}>
              <div style={cardH}>{ar ? 'الربط بالموظفين' : 'Employee linking'}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8 }}>
                <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                  {data!.linkedCount ?? 0}<span style={{ fontSize: 18, color: 'var(--text-3)' }}> / {k.total}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
                  {ar ? 'وكلاء أميو مربوطين بموظّف WFM (عبر اسم الدخول). غير المربوطين يحتاجوا مطابقة اسم/يوزر.'
                      : 'Ameyo agents linked to a WFM employee (by login username). Unlinked need a name/username match.'}
                </div>
              </div>
            </div>
          </div>

          {/* agent board */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={cardH}>{ar ? 'لوحة الوكلاء' : 'Agent board'} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>({shown.length})</span></div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg,var(--surface))', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px' }}>
                <Search size={14} color="var(--text-3)" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث…' : 'search…'} style={{ border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-1)', fontSize: 13, width: 120 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {(['all', 'available', 'busy', 'acw', 'hold', 'break', 'idle', 'offline'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${filter === f ? (f === 'all' ? 'var(--text-2)' : ST[f as State].c) : 'var(--border)'}`,
                  background: filter === f ? (f === 'all' ? 'var(--text-2)' : ST[f as State].c) : 'transparent',
                  color: filter === f ? '#fff' : 'var(--text-2)',
                }}>{f === 'all' ? (ar ? 'الكل' : 'All') : ST[f as State][ar ? 'ar' : 'en']} {f !== 'all' && k ? (k as any)[f] : ''}</button>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 620 }}>
                <thead><tr style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {[ar ? 'الوكيل' : 'Agent', ar ? 'رقم الموظف' : 'Emp #', ar ? 'الحالة' : 'State', ar ? 'الحالة الخام' : 'Raw', ar ? 'المكالمة' : 'Call', ar ? 'النوع' : 'Type'].map((h, i) =>
                    <th key={i} style={{ textAlign: ar ? 'right' : 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((a, i) => {
                    const m = ST[a.state] || ST.unknown;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '9px 10px', fontWeight: 600, color: 'var(--text-1)' }}>{a.name}</td>
                        <td style={{ padding: '9px 10px', color: a.linked ? 'var(--text-2)' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{a.linked ? a.employeeNo : '—'}</td>
                        <td style={{ padding: '9px 10px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, color: m.c, background: `${m.c}1a`, border: `1px solid ${m.c}55` }}>
                            <span style={{ width: 7, height: 7, borderRadius: 7, background: m.c }} />{m[ar ? 'ar' : 'en']}
                          </span>
                        </td>
                        <td style={{ padding: '9px 10px', color: 'var(--text-3)', fontSize: 12.5 }}>{a.statusRaw || '—'}</td>
                        <td style={{ padding: '9px 10px', color: 'var(--text-2)' }}>{a.callStatus || '—'}</td>
                        <td style={{ padding: '9px 10px', color: 'var(--text-3)', fontSize: 12.5 }}>{a.callType || '—'}</td>
                      </tr>
                    );
                  })}
                  {!shown.length && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>{ar ? 'لا وكلاء مطابقين' : 'No matching agents'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' };
const cardH: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--text-2)', marginBottom: 2 };
