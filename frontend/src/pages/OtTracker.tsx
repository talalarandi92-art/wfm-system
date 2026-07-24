import { useEffect, useMemo, useState } from 'react';
import { Download, CalendarClock, Users, Coins, TimerReset, AlertTriangle, Search } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile } from '@/components/dazzle';

/**
 * MONTHLY OVERTIME TRACKER — one live sheet in place of the 11 per-occasion overtime
 * workbooks. Same layout the Director already works in (people down, days across, one
 * `hours/N|O|H` cell per person-day, four multiplier totals on the right) but built
 * from `roster_days`, so it is never hand-merged and never stale.
 *
 * The hours shown are PAYABLE OT (`payableOtMin`, D-2026-07-11): the three disjoint
 * buckets plus before/after-shift minutes that review has ACKNOWLEDGED. Minutes still
 * pending are surfaced in their own tile and never folded into pay.
 */
type Cell = { day: number; hours: number; type: 'N' | 'O' | 'H'; detected: number; reviewHours: number; pendingHours: number; flag?: string | null };
type Person = {
  personNo: string; name: string; functionName: string | null; cells: Cell[];
  rawNormal: number; rawOffday: number; rawHoliday: number; rawTotal: number;
  paidNormal: number; paidOffday: number; paidHoliday: number; paidTotal: number;
  detectedTotal: number; reviewHours: number; pendingHours: number; flaggedDays: number;
  ytdHours: number; ytdPaid: number; ytdDays: number;
};

const TYPE_COLOR: Record<Cell['type'], string> = { N: '#f59e0b', O: '#3b82f6', H: '#ef4444' };

export default function OtTrackerPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [months, setMonths] = useState<{ month: string; label: string; people: number; rawHours: number }[]>([]);
  const [month, setMonth] = useState('');
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fn, setFn] = useState('');
  const [sortKey, setSortKey] = useState<'paidTotal' | 'rawTotal' | 'name' | 'pendingHours'>('paidTotal');
  const h = ar ? 'س' : 'h';

  useEffect(() => {
    apiClient.get('/attendance-recon/roster-v2/ot-tracker/months')
      .then((r: any) => { const m = r.data?.months || []; setMonths(m); if (m.length && !month) setMonth(m[0].month); })
      .catch(() => setMonths([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!month) return;
    setLoading(true);
    apiClient.get(`/attendance-recon/roster-v2/ot-tracker?month=${month}`)
      .then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [month]);

  const exportXlsx = () => {
    apiClient.get(`/attendance-recon/roster-v2/ot-tracker/export?month=${month}`, { responseType: 'blob' }).then((r: any) => {
      const url = URL.createObjectURL(new Blob([r.data])); const a = document.createElement('a');
      a.href = url; a.download = `Monthly_Overtime_Tracker_${month}.xlsx`; a.click(); URL.revokeObjectURL(url);
    });
  };

  const functions = useMemo(
    () => [...new Set(((d?.people || []) as Person[]).map(p => p.functionName).filter(Boolean))].sort() as string[],
    [d]);

  const people: Person[] = useMemo(() => {
    let a = ((d?.people || []) as Person[]).slice();
    if (fn) a = a.filter(p => p.functionName === fn);
    if (q.trim()) { const s = q.toLowerCase(); a = a.filter(p => p.name.toLowerCase().includes(s) || p.personNo.includes(s)); }
    a.sort((x, y) => sortKey === 'name' ? x.name.localeCompare(y.name) : Number(y[sortKey]) - Number(x[sortKey]));
    return a;
  }, [d, q, fn, sortKey]);

  // Totals for the CURRENT filter — the header must never claim more than the table shows.
  const view = useMemo(() => {
    const s = (f: (p: Person) => number) => Math.round(people.reduce((a, p) => a + f(p), 0) * 100) / 100;
    return {
      people: people.length, payable: s(p => p.rawTotal), money: s(p => p.paidTotal),
      pending: s(p => p.pendingHours), flagged: people.reduce((a, p) => a + p.flaggedDays, 0),
      n: s(p => p.rawNormal), o: s(p => p.rawOffday), hh: s(p => p.rawHoliday),
    };
  }, [people]);

  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const stick = (left: number, z = 2): React.CSSProperties => ({ position: 'sticky', insetInlineStart: left, zIndex: z, background: 'var(--surface)' });

  const days: { day: number; date: string; weekday: string; isWeekend: boolean }[] = d?.days || [];

  return (
    <div className="space-y-4 page-enter">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', boxShadow: '0 6px 18px rgba(239,68,68,0.35)' }}>
          <CalendarClock size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-extrabold" style={{ color: 'var(--text-1)' }}>
            {ar ? 'تراكر الأوفر تايم الشهري' : 'Monthly Overtime Tracker'}
          </h1>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {ar ? 'شيت واحد حيّ بدل ملفات الأوفر تايم المتفرقة — من روستر الحضور المطابَق'
                : 'One live sheet in place of the per-occasion overtime workbooks — built from the reconciled roster'}
          </p>
        </div>
        <select value={month} onChange={e => setMonth(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle}>
          {months.map(m => <option key={m.month} value={m.month}>{m.label} · {m.people} {ar ? 'موظف' : 'people'}</option>)}
        </select>
        <button onClick={exportXlsx} disabled={!d} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', color: '#fff' }}>
          <Download size={14} />{ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>

      {/* ── tiles ──────────────────────────────────────────────────────── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <StatTile icon={Users}      label={ar ? 'موظفين لهم أوفر تايم' : 'People with OT'} num={view.people} color="#8b5cf6" />
        <StatTile icon={TimerReset} label={ar ? 'ساعات مستحقّة' : 'Payable hours'}          num={view.payable} suffix={h} color="#f59e0b" />
        <StatTile icon={Coins}      label={ar ? 'ساعات بعد الضرب بالمعامل' : 'Hours after rate'} num={view.money} suffix={h} color="#22c55e" />
        <StatTile icon={AlertTriangle} label={ar ? 'قيد المراجعة (غير مدفوع)' : 'Pending review (unpaid)'} num={view.pending} suffix={h} color="#ef4444" />
      </div>

      {/* ── bucket split + rates ───────────────────────────────────────── */}
      <div className="rounded-2xl p-4 flex flex-wrap items-center gap-x-6 gap-y-3" style={panel}>
        {([['N', ar ? 'يوم عادي' : 'Normal day', view.n, d?.rates?.normal],
           ['O', ar ? 'يوم أوف' : 'Off day', view.o, d?.rates?.offday],
           ['H', ar ? 'عطلة رسمية' : 'Public holiday', view.hh, d?.rates?.holiday]] as [Cell['type'], string, number, number][])
          .map(([t, label, hrs, rate]) => (
          <div key={t} className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-extrabold"
              style={{ background: `${TYPE_COLOR[t]}22`, color: TYPE_COLOR[t], border: `1px solid ${TYPE_COLOR[t]}55` }}>{t}</span>
            <div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label} · ×{rate ?? '—'}</div>
              <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{hrs.toLocaleString()} {h}</div>
            </div>
          </div>
        ))}
        <div className="flex-1" />
        <div className="text-[11px] text-end" style={{ color: 'var(--text-3)' }}>
          <div>
            {ar ? 'أساس الساعة: الراتب الشهري ÷ ' : 'Hourly base: monthly salary ÷ '}{d?.base?.workDaysPerMonth ?? 26}
            {ar ? ' يوم ÷ ' : ' days ÷ '}{d?.base?.hoursPerDay ?? 8}{ar ? ' ساعات' : ' hours'}
          </div>
          <div>
            {ar ? `الخلية = ساعات فقط، مقرّبة لأقرب ${d?.rounding?.stepHours ?? 0.5} ساعة — واللون هو النوع`
                : `A cell is hours only, rounded to the nearest ${d?.rounding?.stepHours ?? 0.5} h — the colour is the type`}
          </div>
          {d?.totals?.roundedOutDays > 0 && (
            <div title={ar ? 'قبل التقريب' : 'before rounding'}>
              {ar ? `${d.totals.roundedOutDays} يوم أقل من ربع ساعة (${d.totals.roundedOutHours} س) ما ظهروا بالتقريب`
                  : `${d.totals.roundedOutDays} days under 15 min (${d.totals.roundedOutHours}${h}) fall below the step and are not shown`}
            </div>
          )}
        </div>
      </div>

      {/* ── filters ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute top-1/2 -translate-y-1/2 start-2.5" style={{ color: 'var(--text-3)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث بالاسم أو الرقم' : 'Search name or ID'}
            className="ps-7 pe-2.5 py-1.5 rounded-lg text-xs outline-none w-56" style={inputStyle} />
        </div>
        <select value={fn} onChange={e => setFn(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle}>
          <option value="">{ar ? 'كل الوظائف' : 'All functions'}</option>
          {functions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={sortKey} onChange={e => setSortKey(e.target.value as any)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle}>
          <option value="paidTotal">{ar ? 'ترتيب: الأعلى أجراً' : 'Sort: highest paid hours'}</option>
          <option value="rawTotal">{ar ? 'ترتيب: الأكثر ساعات' : 'Sort: most hours'}</option>
          <option value="pendingHours">{ar ? 'ترتيب: الأكثر انتظاراً للمراجعة' : 'Sort: most pending review'}</option>
          <option value="name">{ar ? 'ترتيب: الاسم' : 'Sort: name'}</option>
        </select>
        {d?.totals?.pendingDays > 0 && (
          <span className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
            style={{ background: '#ef444418', color: '#ef4444', border: '1px solid #ef444455' }}>
            <AlertTriangle size={12} />
            {ar ? `${d.totals.pendingDays} يوم بانتظار المراجعة — ${d.totals.pendingHours} س غير محتسبة`
                : `${d.totals.pendingDays} person-days awaiting review — ${d.totals.pendingHours}${h} not counted`}
          </span>
        )}
      </div>

      {/* ── the sheet ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={panel}>
        <div className="overflow-auto" style={{ maxHeight: '68vh' }}>
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 4 }}>
                <th className="px-2 py-2 text-start font-semibold whitespace-nowrap"
                  style={{ ...stick(0, 5), color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
                  {ar ? 'الموظف' : 'Agent'}
                </th>
                <th className="px-2 py-2 text-center font-semibold"
                  style={{ ...stick(180, 5), color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>ID</th>
                {days.map(dd => (
                  <th key={dd.day} className="px-1 py-2 text-center font-semibold" title={`${dd.date} · ${dd.weekday}`}
                    style={{ color: 'var(--text-3)', fontSize: 10, minWidth: 40, borderBottom: '1px solid var(--border)',
                      background: dd.isWeekend ? 'var(--surface-2)' : 'var(--surface)' }}>
                    <div>{dd.day}</div>
                    <div style={{ fontSize: 8, opacity: .7 }}>{dd.weekday}</div>
                  </th>
                ))}
                {[['N', ar ? 'عادي' : 'Normal'], ['O', ar ? 'أوف' : 'Off'], ['H', ar ? 'عطلة' : 'Holiday'],
                  ['T', ar ? 'إجمالي الشهر' : 'Month total'], ['Y', ar ? 'من بداية السنة' : 'YTD hours']].map(([k, l]) => (
                  <th key={k} className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                    style={{ color: k === 'T' || k === 'Y' ? 'var(--text-1)' : 'var(--text-3)', fontSize: 10, textTransform: 'uppercase',
                      borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={days.length + 7} className="px-3 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'جارِ التحميل…' : 'Loading…'}</td></tr>}
              {!loading && people.length === 0 && (
                <tr><td colSpan={days.length + 7} className="px-3 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>
                  {ar ? 'لا يوجد أوفر تايم في هذا الشهر' : 'No overtime in this month'}</td></tr>
              )}
              {people.map((p, i) => {
                const byDay = new Map(p.cells.map(c => [c.day, c]));
                return (
                  <tr key={p.personNo} style={{ background: i % 2 ? 'var(--surface-2)' : 'transparent' }}>
                    <td className="px-2 py-1.5 text-xs font-semibold whitespace-nowrap"
                      style={{ ...stick(0, 1), background: i % 2 ? 'var(--surface-2)' : 'var(--surface)', color: 'var(--text-1)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={p.functionName || ''}>
                      {p.name}
                      {p.pendingHours > 0 && <span className="ms-1" style={{ color: '#ef4444' }} title={ar ? 'لديه ساعات بانتظار المراجعة' : 'has hours awaiting review'}>•</span>}
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-center"
                      style={{ ...stick(180, 1), background: i % 2 ? 'var(--surface-2)' : 'var(--surface)', color: 'var(--text-3)' }}>{p.personNo}</td>
                    {days.map(dd => {
                      const c = byDay.get(dd.day);
                      if (!c) return <td key={dd.day} style={{ background: dd.isWeekend ? 'color-mix(in srgb, var(--text-3) 6%, transparent)' : undefined }} />;
                      const tip = [
                        `${c.hours}${h} ${c.type === 'N' ? (ar ? 'يوم عادي' : 'normal day') : c.type === 'O' ? (ar ? 'يوم أوف' : 'off day') : (ar ? 'عطلة رسمية' : 'public holiday')}`,
                        `${ar ? 'مقيس' : 'detected'}: ${c.detected}${h}`,
                        c.reviewHours ? `${ar ? 'معتمد بالمراجعة' : 'acknowledged by review'}: +${c.reviewHours}${h}` : '',
                        c.pendingHours ? `${ar ? 'بانتظار المراجعة (غير محتسب)' : 'pending review (not counted)'}: ${c.pendingHours}${h}` : '',
                        c.flag ? `${ar ? 'تنبيه المحرك' : 'engine flag'}: ${c.flag}` : '',
                      ].filter(Boolean).join('\n');
                      return (
                        <td key={dd.day} className="px-1 py-1 text-center" title={tip}>
                          <span className="inline-block px-1 py-0.5 rounded text-[10px] font-bold w-full"
                            style={{ background: `${TYPE_COLOR[c.type]}1f`, color: TYPE_COLOR[c.type],
                              border: c.pendingHours ? '1px dashed #ef4444' : c.flag ? '1px dotted var(--text-3)' : `1px solid ${TYPE_COLOR[c.type]}44` }}>
                            {c.hours}
</span>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-[11px] text-center" style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}>{p.paidNormal}</td>
                    <td className="px-2 py-1.5 text-[11px] text-center" style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}>{p.paidOffday}</td>
                    <td className="px-2 py-1.5 text-[11px] text-center" style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}>{p.paidHoliday}</td>
                    <td className="px-2 py-1.5 text-xs text-center font-extrabold" style={{ color: 'var(--text-1)', background: 'var(--surface-2)' }}>{p.paidTotal}</td>
                    <td className="px-2 py-1.5 text-center" style={{ background: 'var(--surface-2)' }}
                      title={ar ? `${p.ytdDays} يوم أوفر تايم من ${d?.ytdFrom}` : `${p.ytdDays} OT days since ${d?.ytdFrom}`}>
                      <div className="text-xs font-extrabold" style={{ color: '#8b5cf6' }}>{p.ytdHours}</div>
                      <div className="text-[9px]" style={{ color: 'var(--text-3)' }}>{p.ytdPaid} {ar ? 'بالمعامل' : 'paid'}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── provenance: where every number came from ───────────────────── */}
      {d && (
        <div className="rounded-2xl p-4 text-[11px] leading-relaxed" style={{ ...panel, color: 'var(--text-3)' }}>
          <div className="font-bold mb-1" style={{ color: 'var(--text-2)' }}>{ar ? 'مصدر الأرقام' : 'Where these numbers come from'}</div>
          {d.provenance}
          <div className="mt-2">
            {ar ? 'الخلية = ساعات/النوع، تماماً مثل شيتك. الحد المتقطّع الأحمر = ساعات بانتظار المراجعة ولم تُحتسب؛ الحد المنقّط = المحرك وضع تنبيه على هذا اليوم.'
                : 'A cell reads hours/type, exactly like your workbook. A dashed red border means hours are awaiting review and are NOT counted; a dotted border means the engine flagged that day.'}
          </div>
        </div>
      )}
    </div>
  );
}
