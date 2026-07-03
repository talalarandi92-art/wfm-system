import { useEffect, useState, useCallback, Fragment } from 'react';
import { Layers, ArrowRight, ArrowLeft, ShieldCheck, Users, Moon } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile } from '@/components/dazzle';

/* Laddered Rotation — humane block rotation that covers demand without daily shift-thrash.
 * Each agent works a 2-3 day block per band, rests, then steps forward (morning→evening→night).
 * Backend: GET /attendance-recon/roster-v2/ladder-generate. Read-only proposal. */
const BAND: Record<string, { c: string; bg: string; ar: string; en: string }> = {
  M: { c: '#0ea5e9', bg: 'rgba(14,165,233,0.16)', ar: 'صباحي', en: 'Morning' },
  B: { c: '#38bdf8', bg: 'rgba(56,189,248,0.16)', ar: 'صباحي', en: 'Morning' },
  C: { c: '#22d3ee', bg: 'rgba(34,211,238,0.16)', ar: 'نهاري', en: 'Day' },
  N: { c: '#8b5cf6', bg: 'rgba(139,92,246,0.16)', ar: 'مسائي', en: 'Evening' },
  E: { c: '#a78bfa', bg: 'rgba(167,139,250,0.16)', ar: 'مسائي', en: 'Evening' },
  MD: { c: '#6366f1', bg: 'rgba(99,102,241,0.2)', ar: 'ميدنايت', en: 'Midnight' },
  MN: { c: '#4f46e5', bg: 'rgba(79,70,229,0.2)', ar: 'فجر', en: 'Dawn' },
  OFF: { c: '#64748b', bg: 'var(--surface-2)', ar: 'راحة', en: 'Off' },
};
const cellOf = (code: string) => BAND[code] || { c: 'var(--text-3)', bg: 'var(--surface-2)', ar: code, en: code };

export default function LadderRotationPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [fn, setFn] = useState('');
  const [fnList, setFnList] = useState<string[]>([]);
  const [weeks, setWeeks] = useState(2);
  const [dir, setDir] = useState<'forward' | 'backward' | ''>('');
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiClient.get('/attendance-recon/roster-v2/hourly').then((r: any) => { const f = r.data?.functions || []; setFnList(f); if (!fn && f[0]) setFn(f[0]); }).catch(() => {}); }, []);
  const load = useCallback(() => {
    if (!fn) return; setLoading(true);
    const qs = new URLSearchParams({ function: fn, weeks: String(weeks) }); if (dir) qs.set('direction', dir);
    apiClient.get(`/attendance-recon/roster-v2/ladder-generate?${qs}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [fn, weeks, dir]);
  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);

  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs outline-none';
  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;

  return (
    <div className="space-y-4 page-enter">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#8b5cf6,#0ea5e9)', boxShadow: '0 6px 18px rgba(139,92,246,0.35)' }}><Layers size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'الدوران التدريجي' : 'Laddered Rotation'}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'كتل 2–3 أيام لكل بند مع راحة بينها، تتدرّج (صبح→مسائي→نايت)، وتغطّي الاحتياج بلا تبديل يومي' : 'humane 2-3 day blocks that step gradually and cover the demand without daily switching'}</p>
        </div>
        <select value={fn} onChange={e => setFn(e.target.value)} className={inputCls} style={inputStyle}>{fnList.map(x => <option key={x} value={x}>{x}</option>)}</select>
        <select value={weeks} onChange={e => setWeeks(+e.target.value)} className={inputCls} style={inputStyle}>{[1, 2, 3, 4].map(w => <option key={w} value={w}>{w} {ar ? 'أسبوع' : 'wk'}</option>)}</select>
        <div className="inline-flex rounded-xl p-1" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          {([['', ar ? 'تلقائي' : 'Auto'], ['forward', ar ? 'أمامي' : 'Fwd'], ['backward', ar ? 'خلفي' : 'Bwd']] as [any, string][]).map(([k, l]) => (
            <button key={k || 'auto'} onClick={() => setDir(k)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold" style={{ background: dir === k ? 'linear-gradient(135deg,#8b5cf6,#0ea5e9)' : 'transparent', color: dir === k ? '#fff' : 'var(--text-2)' }}>{l}</button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ توليد الدوران…' : 'Generating…'}</p>}
      {!loading && d && !d.error && (<>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <StatTile icon={ShieldCheck} label={ar ? 'يغطّي الاحتياج' : 'Covers demand'} value={d.summary.coversAll ? (ar ? '✓ نعم' : '✓ Yes') : (ar ? `⚠ ${d.summary.shortDays} يوم نقص` : `⚠ ${d.summary.shortDays} short`)} color={d.summary.coversAll ? '#22c55e' : '#f59e0b'} delay={0} />
          <StatTile icon={Users} label={ar ? 'البِركة' : 'Pool'} num={d.poolSize} sub={ar ? `ذكور ${d.males} · إناث ${d.females}` : `M ${d.males} · F ${d.females}`} color="#0ea5e9" delay={60} />
          <StatTile icon={d.direction === 'forward' ? ArrowRight : ArrowLeft} label={ar ? 'الاتجاه' : 'Direction'} value={d.direction === 'forward' ? (ar ? 'أمامي' : 'Forward') : (ar ? 'خلفي' : 'Backward')} sub={ar ? 'صبح→مسائي→نايت' : 'M→E→N'} color="#8b5cf6" delay={120} />
          <StatTile icon={Layers} label={ar ? 'أطوال الكتل' : 'Block lengths'} value={`${d.blocks.morning}·${d.blocks.evening}·${d.blocks.night}`} sub={ar ? 'صبح·مسائي·نايت' : 'M·E·N'} color="#a78bfa" delay={180} />
          <StatTile icon={Moon} label={ar ? 'إناث بلا نايت' : 'F off nights'} value="✓" sub={ar ? 'راحة بعد النايت' : 'post-night rest'} color="#06b6d4" delay={240} />
        </div>

        {/* cycles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[['الذكور', 'Male cycle', d.cycleMale], ['الإناث', 'Female cycle', d.cycleFemale]].map(([la, le, cyc]: any) => (
            <div key={le} className="rounded-2xl p-3" style={panel}>
              <div className="text-[11px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>{ar ? la : le} <span className="font-normal" style={{ color: 'var(--text-3)' }}>· {cyc.length} {ar ? 'يوم/دورة' : 'day cycle'}</span></div>
              <div className="flex flex-wrap gap-1">
                {cyc.map((b: string, i: number) => { const bd = b === 'OFF' ? cellOf('OFF') : cellOf({ morning: 'M', evening: 'N', night: 'MD' }[b as string] || 'OFF'); return (
                  <span key={i} className="px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: bd.bg, color: bd.c }}>{ar ? (b === 'OFF' ? 'راحة' : { morning: 'صبح', evening: 'مسائي', night: 'نايت' }[b]) : (b === 'OFF' ? 'Off' : b)}</span>
                ); })}
              </div>
            </div>
          ))}
        </div>

        {/* coverage per day vs demand */}
        <div className="rounded-2xl p-4 overflow-auto" style={panel}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'التغطية مقابل الاحتياج — لكل يوم لكل بند' : 'Coverage vs demand — per day per band'}</h3>
          <div className="min-w-[560px] grid gap-1" style={{ gridTemplateColumns: `90px repeat(${d.coverage.length},1fr)` }}>
            <div />
            {d.coverage.map((c: any) => <div key={c.date} className="text-center text-[9px]" style={{ color: c.short ? '#ef4444' : 'var(--text-3)' }}>{c.dayName.slice(0, 3)}<br />{c.date.slice(5)}</div>)}
            {(['morning', 'evening', 'night'] as const).map(band => (
              <Fragment key={band}>
                <div className="text-[10px] font-semibold flex items-center" style={{ color: 'var(--text-2)' }}>{ar ? { morning: 'صبح', evening: 'مسائي', night: 'نايت' }[band] : band}<span className="text-[9px] ms-1" style={{ color: 'var(--text-3)' }}>/{d.demand[band]}</span></div>
                {d.coverage.map((c: any) => { const g = c.gap[band]; const ok = g < 1; return (
                  <div key={c.date + band} className="text-center text-[11px] font-bold rounded" style={{ background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.15)', color: ok ? '#16a34a' : '#ef4444', padding: '3px 0' }} title={`need ${c.demand[band]} · have ${c[band]}`}>{c[band]}</div>
                ); })}
              </Fragment>
            ))}
          </div>
        </div>

        {/* the grid */}
        <div className="rounded-2xl p-4 overflow-auto" style={panel}>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'الجدول المقترح' : 'Proposed rotation'} <span className="text-[11px] font-normal" style={{ color: 'var(--text-3)' }}>· {d.grid.length} {ar ? 'موظف' : 'agents'}</span></h3>
            <div className="flex gap-2 text-[9px]">{['M', 'N', 'MD', 'OFF'].map(k => { const b = cellOf(k); return <span key={k} className="flex items-center gap-1" style={{ color: 'var(--text-3)' }}><span className="w-2.5 h-2.5 rounded-sm" style={{ background: b.bg, border: `1px solid ${b.c}` }} />{ar ? b.ar : b.en}</span>; })}</div>
          </div>
          <table className="text-[10px]" style={{ borderCollapse: 'separate', borderSpacing: 1 }}>
            <thead><tr><th className="sticky start-0 text-start px-2 py-1" style={{ background: 'var(--surface)', color: 'var(--text-3)' }}>{ar ? 'الموظف' : 'Agent'}</th>
              {d.dates.map((dt: string) => <th key={dt} className="px-1 py-1 font-normal" style={{ color: 'var(--text-3)', fontSize: 8 }}>{dt.slice(8)}</th>)}</tr></thead>
            <tbody>
              {d.grid.map((g: any) => (
                <tr key={g.employeeNo}>
                  <td className="sticky start-0 px-2 py-0.5 whitespace-nowrap font-semibold" style={{ background: 'var(--surface)', color: 'var(--text-2)' }}>{g.gender === 'female' ? '♀ ' : ''}{g.name}</td>
                  {g.days.map((code: string, i: number) => { const b = cellOf(code); return (
                    <td key={i} className="text-center font-bold rounded" style={{ background: b.bg, color: b.c, minWidth: 26, padding: '3px 2px' }}>{code === 'OFF' ? '·' : code}</td>
                  ); })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>★ {ar ? d.summary.note + ' · ' + 'راحة كاملة بعد كل كتلة (تعافي ما بعد النايت مضمون). مقترح للعرض — أي نقص يظهر أعلاه ويُعالَج من «توقّع الأسبوع».' : d.summary.note + ' · a full OFF after each block (post-night recovery). Read-only proposal — any shortfall shows above and is remedied from Week Forecast.'}</p>
      </>)}
      {!loading && d?.error && <p className="text-sm py-8 text-center" style={{ color: '#ef4444' }}>{d.error}</p>}
    </div>
  );
}
