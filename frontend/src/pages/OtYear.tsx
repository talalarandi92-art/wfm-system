import { useEffect, useMemo, useState } from 'react';
import { Download, CalendarRange, Users, Layers, GitCompareArrows, Search, ChevronDown, ChevronRight, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile } from '@/components/dazzle';

/**
 * YEAR-TO-DATE OVERTIME — every employee, every month, drilling down to every day,
 * built from the Director's OWN overtime workbooks (`Desktop/Overtime 2026`,
 * ingested into `ot_source_rows`).
 *
 * The headline this page has to carry honestly: those workbooks overlap on purpose,
 * so adding their rows together over-counts by thousands of hours. The grid shows
 * ONE value per person-day; where the sheets contradict each other the largest is
 * shown and the day is listed under Conflicts rather than quietly resolved.
 */
type Day = { date: string; hours: number; occasion: string; shiftCode: string | null; conflict: boolean };
type Person = {
  personNo: string; name: string; functionName: string | null;
  months: number[]; undatedByMonth: Record<string, number>; undatedTotal: number;
  total: number; days: Day[]; daysCount: number; conflictDays: number; engineHours: number;
};

export default function OtYearPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(''); const [fn, setFn] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'conflicts' | 'sources'>('none');
  const h = ar ? 'س' : 'h';

  useEffect(() => {
    apiClient.get('/attendance-recon/roster-v2/ot-year/years')
      .then((r: any) => { const y = r.data?.years || []; setYears(y); if (y.length) setYear((p) => p ?? y[0]); })
      .catch(() => setYears([]));
  }, []);

  useEffect(() => {
    if (!year) return;
    setLoading(true);
    apiClient.get(`/attendance-recon/roster-v2/ot-year?year=${year}`)
      .then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [year]);

  const exportXlsx = () => {
    apiClient.get(`/attendance-recon/roster-v2/ot-year/export?year=${year}`, { responseType: 'blob' }).then((r: any) => {
      const url = URL.createObjectURL(new Blob([r.data])); const a = document.createElement('a');
      a.href = url; a.download = `Overtime_${year}_Year_Tracker.xlsx`; a.click(); URL.revokeObjectURL(url);
    });
  };

  const functions = useMemo(
    () => [...new Set(((d?.people || []) as Person[]).map(p => p.functionName).filter(Boolean))].sort() as string[], [d]);

  const people: Person[] = useMemo(() => {
    let a = ((d?.people || []) as Person[]).slice();
    if (fn) a = a.filter(p => p.functionName === fn);
    if (q.trim()) { const s = q.toLowerCase(); a = a.filter(p => p.name.toLowerCase().includes(s) || p.personNo.includes(s)); }
    return a;
  }, [d, q, fn]);

  // Header figures follow the filter — the tiles must never claim more than the table shows.
  const view = useMemo(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const months = Array(12).fill(0);
    people.forEach(p => p.months.forEach((x, i) => { months[i] += x; }));
    return {
      people: people.length,
      total: r2(people.reduce((a, p) => a + p.total, 0)),
      engine: r2(people.reduce((a, p) => a + p.engineHours, 0)),
      days: people.reduce((a, p) => a + p.daysCount, 0),
      months: months.map(r2),
    };
  }, [people]);

  const maxMonth = Math.max(...view.months, 1);
  const maxTotal = Math.max(...people.map(p => p.total), 1);
  const panelSt = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const inputSt = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const stick = (left: number, z: number, bg: string): React.CSSProperties => ({ position: 'sticky', insetInlineStart: left, zIndex: z, background: bg });

  const MONTH_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const mLabel = (i: number) => ar ? MONTH_AR[i] : (d?.monthLabels?.[i] || '').slice(0, 3);

  return (
    <div className="space-y-4 page-enter">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 6px 18px rgba(139,92,246,0.35)' }}>
          <CalendarRange size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-xl font-extrabold" style={{ color: 'var(--text-1)' }}>
            {ar ? `أوفر تايم ${year ?? ''} — من بداية السنة` : `Overtime ${year ?? ''} — year to date`}
          </h1>
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            {ar ? 'كل الموظفين · إجمالي الساعات · موزّعة على الأشهر والأيام — مبنية من شيتات الأوفر تايم تبعك'
                : 'Every employee · total hours · broken down by month and by day — built from your own overtime workbooks'}
          </p>
        </div>
        <select value={year ?? ''} onChange={e => setYear(Number(e.target.value))} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputSt}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={exportXlsx} disabled={!d} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }}>
          <Download size={14} />{ar ? 'تصدير Excel' : 'Export Excel'}
        </button>
      </div>

      {/* ── tiles ──────────────────────────────────────────────────────── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <StatTile icon={Users}     label={ar ? 'موظفين لهم أوفر تايم' : 'Employees with OT'} num={view.people} color="#8b5cf6" />
        <StatTile icon={CalendarRange} label={ar ? 'إجمالي الساعات من بداية السنة' : 'Total hours YTD'} num={view.total} suffix={h} color="#6366f1" />
        <StatTile icon={Layers}    label={ar ? 'ساعات مكرّرة تم تفاديها' : 'Double-count avoided'} num={d?.dedup?.avoided ?? 0} suffix={h} color="#f59e0b" />
        <StatTile icon={GitCompareArrows} label={ar ? 'قياس المحرك (للمقارنة)' : 'Engine measured (compare)'} num={view.engine} suffix={h} color="#22c55e" />
      </div>

      {/* ── the number that justifies this page ────────────────────────── */}
      {d?.dedup && (
        <div className="rounded-2xl p-4" style={{ ...panelSt, borderInlineStart: '3px solid #f59e0b' }}>
          <div className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>
            {ar ? 'ليش هذا الرقم مش مجرد جمع الشيتات' : 'Why this is not simply the sheets added up'}
          </div>
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {ar
              ? <>الشيتات بتتقاطع بقصد — نفس اليوم بيتكرر بين <b>Details</b> و<b>All New+ Old</b> و<b>New</b>، وبين
                  <b> FULL SYSTEM</b> و<b>Normal Days</b> و<b>Day OFF</b>، وبين ملفَّي نهاية السنة. لو جمعت كل السطور
                  بيطلع معك <b>{d.dedup.stacked} {h}</b>؛ الصحيح <b>{d.dedup.deduped} {h}</b> على
                  <b> {d.dedup.personDays}</b> يوم-موظف — يعني <b style={{ color: '#f59e0b' }}>{d.dedup.avoided} {h}</b> كانت رح تنعدّ مرتين.</>
              : <>The workbooks overlap deliberately — the same day repeats across <b>Details</b>, <b>All New+ Old</b> and
                  <b> New</b>, across <b>FULL SYSTEM</b>, <b>Normal Days</b> and <b>Day OFF</b>, and between the two
                  End-Of-Year files. Stacking every row gives <b>{d.dedup.stacked} {h}</b>; the truth is
                  <b> {d.dedup.deduped} {h}</b> over <b>{d.dedup.personDays}</b> person-days — so
                  <b style={{ color: '#f59e0b' }}> {d.dedup.avoided} {h}</b> would have been counted twice.</>}
          </p>
          <div className="flex gap-2 flex-wrap mt-2.5">
            <button onClick={() => setPanel(panel === 'conflicts' ? 'none' : 'conflicts')}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
              style={{ background: d.dedup.disagreed ? '#ef444418' : 'var(--surface-2)', color: d.dedup.disagreed ? '#ef4444' : 'var(--text-2)', border: `1px solid ${d.dedup.disagreed ? '#ef444455' : 'var(--border)'}` }}>
              <AlertTriangle size={12} />
              {ar ? `${d.dedup.disagreed} يوم الشيتات مختلفة عليه` : `${d.dedup.disagreed} days the sheets disagree on`}
            </button>
            <button onClick={() => setPanel(panel === 'sources' ? 'none' : 'sources')}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              <FileSpreadsheet size={12} />{ar ? `${d.sources.length} ملف` : `${d.sources.length} workbooks`}
            </button>
            {d.totals.undated > 0 && (
              <span className="px-2.5 py-1 rounded-lg text-[11px]" style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}>
                {ar ? `${d.totals.undated} ${h} بدون تاريخ يوم — محسوبة على الشهر` : `${d.totals.undated}${h} with no day in the source — counted at month level`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── conflicts panel ────────────────────────────────────────────── */}
      {panel === 'conflicts' && d && (
        <div className="rounded-2xl p-4" style={panelSt}>
          <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)' }}>
            {ar ? 'أيام الشيتات مختلفة عليها — معروض الأكبر' : 'Days the workbooks contradict each other — the largest is shown'}
          </h3>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-3)' }}>
            {ar ? 'ما بنختار بصمت: هاي كل الاحتمالات بمصدرها، وقرارك إنت.' : 'Nothing is resolved silently: every candidate and its source is listed — the ruling is yours.'}
          </p>
          <div className="overflow-auto" style={{ maxHeight: '40vh' }}>
            {(d.conflicts || []).map((c: any, i: number) => (
              <div key={i} className="py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>
                  {c.name} <span style={{ color: 'var(--text-3)' }}>#{c.personNo} · {c.date}</span>
                  <span className="ms-2 px-1.5 py-0.5 rounded" style={{ background: '#22c55e1f', color: '#22c55e', fontSize: 10 }}>
                    {ar ? 'معروض' : 'shown'} {c.chosen}{h}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.candidates.map((k: any, j: number) => (
                    <span key={j} className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                      title={k.file}>{k.hours}{h} · {k.sheet}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── sources panel ──────────────────────────────────────────────── */}
      {panel === 'sources' && d && (
        <div className="rounded-2xl p-4" style={panelSt}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'الملفات المقروءة' : 'Workbooks read'}</h3>
          <div className="overflow-auto" style={{ maxHeight: '40vh' }}>
            <table className="w-full text-xs">
              <thead><tr>
                {[ar ? 'المناسبة' : 'Occasion', ar ? 'سطور' : 'Rows', ar ? 'موظفين' : 'People', ar ? 'ساعات (كما هي)' : 'Hours as stacked', ar ? 'بدون تاريخ' : 'Undated'].map((t, i) => (
                  <th key={i} className={`px-2 py-1.5 ${i === 0 ? 'text-start' : 'text-center'}`} style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase' }}>{t}</th>
                ))}
              </tr></thead>
              <tbody>
                {(d.sources || []).map((s: any, i: number) => (
                  <tr key={i} style={{ background: i % 2 ? 'var(--surface-2)' : 'transparent' }}>
                    <td className="px-2 py-1.5" style={{ color: 'var(--text-1)' }} title={s.file}>{s.occasion}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{s.rows}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{s.people}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-2)' }}>{s.stackedHours}</td>
                    <td className="px-2 py-1.5 text-center" style={{ color: s.undated ? '#f59e0b' : 'var(--text-3)' }}>{s.undated || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(d.dataQuality || []).length > 0 && (
            <p className="text-[11px] mt-3" style={{ color: '#f59e0b' }}>
              {ar ? 'ملاحظات على الملفات نفسها: ' : 'Notes on the files themselves: '}
              {d.dataQuality.map((x: any) => `${x.name} ${x.date || ''} — ${x.note}`).join(' · ')}
            </p>
          )}
        </div>
      )}

      {/* ── month strip ────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-4" style={panelSt}>
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>{ar ? 'الساعات حسب الشهر' : 'Hours by month'}</h3>
        <div className="flex items-end gap-1.5" style={{ height: 90 }}>
          {view.months.map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${mLabel(i)} — ${v}${h}`}>
              <span className="text-[9px] font-bold" style={{ color: v ? 'var(--text-2)' : 'transparent' }}>{v || ''}</span>
              <div className="w-full rounded-t" style={{
                height: `${Math.max(2, (v / maxMonth) * 62)}px`,
                background: v ? 'linear-gradient(180deg,#8b5cf6,#6366f1)' : 'var(--surface-2)',
              }} />
              <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{mLabel(i)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── filters ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute top-1/2 -translate-y-1/2 start-2.5" style={{ color: 'var(--text-3)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث بالاسم أو الرقم' : 'Search name or ID'}
            className="ps-7 pe-2.5 py-1.5 rounded-lg text-xs outline-none w-56" style={inputSt} />
        </div>
        <select value={fn} onChange={e => setFn(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputSt}>
          <option value="">{ar ? 'كل الوظائف' : 'All functions'}</option>
          {functions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {ar ? `اضغط على أي موظف لتشوف أيامه (${view.days} يوم أوفر تايم)` : `Click any employee to see their days (${view.days} OT days)`}
        </span>
      </div>

      {/* ── the year grid ──────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={panelSt}>
        <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
          <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 4 }}>
                <th className="px-2 py-2 text-start font-semibold whitespace-nowrap"
                  style={{ ...stick(0, 5, 'var(--surface)'), color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
                  {ar ? 'الموظف' : 'Employee'}
                </th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} className="px-1.5 py-2 text-center font-semibold"
                    style={{ color: 'var(--text-3)', fontSize: 10, minWidth: 52, borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                    {mLabel(i)}
                  </th>
                ))}
                {[ar ? 'بدون تاريخ' : 'Undated', ar ? 'الإجمالي' : 'TOTAL', ar ? 'أيام' : 'Days', ar ? 'المحرك' : 'Engine'].map((t, i) => (
                  <th key={i} className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                    style={{ color: i === 1 ? 'var(--text-1)' : 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={17} className="px-3 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'جارِ التحميل…' : 'Loading…'}</td></tr>}
              {!loading && people.length === 0 && (
                <tr><td colSpan={17} className="px-3 py-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>
                  {ar ? 'ما في بيانات — شغّل قراءة الملفات أولاً' : 'No data — run the workbook ingest first'}</td></tr>
              )}
              {people.map((p, i) => {
                const bg = i % 2 ? 'var(--surface-2)' : 'var(--surface)';
                const isOpen = open === p.personNo;
                return (
                  <>
                    <tr key={p.personNo} onClick={() => setOpen(isOpen ? null : p.personNo)} className="cursor-pointer"
                      style={{ background: isOpen ? 'color-mix(in srgb, #8b5cf6 10%, transparent)' : (i % 2 ? 'var(--surface-2)' : 'transparent') }}>
                      <td className="px-2 py-1.5 text-xs font-semibold whitespace-nowrap"
                        style={{ ...stick(0, 1, isOpen ? 'var(--surface)' : bg), color: 'var(--text-1)', maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={`${p.personNo} · ${p.functionName || ''}`}>
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {p.name}
                          {p.conflictDays > 0 && <span style={{ color: '#ef4444' }} title={ar ? 'فيه أيام مختلف عليها' : 'has contested days'}>•</span>}
                        </span>
                        <div className="text-[9px] ps-4" style={{ color: 'var(--text-3)' }}>{p.personNo} · {p.functionName || '—'}</div>
                      </td>
                      {p.months.map((v, m) => (
                        <td key={m} className="px-1.5 py-1.5 text-center text-[11px]"
                          style={{ color: v ? 'var(--text-1)' : 'var(--text-3)', fontWeight: v ? 600 : 400 }}>
                          {v ? v : '·'}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center text-[11px]" style={{ color: p.undatedTotal ? '#f59e0b' : 'var(--text-3)', background: 'var(--surface-2)' }}>{p.undatedTotal || '·'}</td>
                      <td className="px-2 py-1.5 text-center" style={{ background: 'var(--surface-2)' }}>
                        <div className="text-xs font-extrabold" style={{ color: 'var(--text-1)' }}>{p.total}</div>
                        <div className="h-1 rounded-full mt-0.5" style={{ background: 'var(--border)' }}>
                          <div className="h-1 rounded-full" style={{ width: `${(p.total / maxTotal) * 100}%`, background: 'linear-gradient(90deg,#8b5cf6,#6366f1)' }} />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center text-[11px]" style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}>{p.daysCount}</td>
                      <td className="px-2 py-1.5 text-center text-[11px]" style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>{p.engineHours}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${p.personNo}-d`}>
                        <td colSpan={17} className="px-3 py-3" style={{ background: 'color-mix(in srgb, #8b5cf6 6%, transparent)' }}>
                          <div className="text-[11px] font-bold mb-2" style={{ color: 'var(--text-2)' }}>
                            {ar ? `أيام الأوفر تايم — ${p.daysCount} يوم` : `Overtime days — ${p.daysCount}`}
                            {p.undatedTotal > 0 && <span style={{ color: '#f59e0b' }}>
                              {ar ? ` · و${p.undatedTotal}${h} بدون تاريخ يوم (${Object.keys(p.undatedByMonth).join(', ')})`
                                  : ` · plus ${p.undatedTotal}${h} with no day in the source (${Object.keys(p.undatedByMonth).join(', ')})`}
                            </span>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {p.days.map((c, k) => (
                              <span key={k} className="px-2 py-1 rounded-lg text-[10px]"
                                style={{ background: 'var(--surface)', border: `1px solid ${c.conflict ? '#ef4444' : 'var(--border)'}`, color: 'var(--text-1)' }}
                                title={`${c.occasion}${c.shiftCode ? ` · ${c.shiftCode}` : ''}${c.conflict ? (ar ? ' · الشيتات مختلفة على هذا اليوم' : ' · the sheets disagree on this day') : ''}`}>
                                <b>{c.date.slice(5)}</b> · {c.hours}{h}
                                {c.shiftCode ? <span style={{ color: 'var(--text-3)' }}> · {c.shiftCode}</span> : null}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── provenance ─────────────────────────────────────────────────── */}
      {d && (
        <div className="rounded-2xl p-4 text-[11px] leading-relaxed" style={{ ...panelSt, color: 'var(--text-3)' }}>
          <div className="font-bold mb-1" style={{ color: 'var(--text-2)' }}>{ar ? 'مصدر الأرقام' : 'Where these numbers come from'}</div>
          {d.provenance}
          {d.ingestedAt && <div className="mt-1">{ar ? 'آخر قراءة للملفات: ' : 'Last workbook ingest: '}{String(d.ingestedAt).slice(0, 19).replace('T', ' ')}</div>}
        </div>
      )}
    </div>
  );
}
