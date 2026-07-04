import { useEffect, useState, useCallback, useMemo } from 'react';
import { SearchCheck, ShieldCheck, ShieldAlert, ShieldQuestion, Moon, Sun } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile } from '@/components/dazzle';
import { DateRangeBar } from '@/components/DateRangeBar';

/* Gap Review — person-days that carry NO scheduled shift (OFF / unknown window) yet have a SYSTEM
 * login → the person likely WORKED. The engine proposes the most-likely shift by nearest canonical
 * START to the login (the login-only method that won the 2026-07-04 inference training). Read-only:
 * a review surface, never writes, never overrides an explicit shift. Theme-aware (Dark/Light/Glass). */
const CONF: Record<string, { c: string; bg: string; icon: any; ar: string; en: string }> = {
  high:   { c: '#22c55e', bg: 'rgba(34,197,94,0.14)',  icon: ShieldCheck,    ar: 'عالية',  en: 'High' },
  medium: { c: '#f59e0b', bg: 'rgba(245,158,11,0.14)', icon: ShieldAlert,    ar: 'متوسطة', en: 'Medium' },
  low:    { c: '#64748b', bg: 'var(--surface-2)',      icon: ShieldQuestion, ar: 'منخفضة', en: 'Low' },
};

export default function GapReviewPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [f, setF] = useState({ from: '2026-06-01', to: '2026-06-30', function: '' });
  const [conf, setConf] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [d, setD] = useState<any>(null); const [loading, setLoading] = useState(true);
  const [fnList, setFnList] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [applied, setApplied] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiClient.get('/schedule-generator/functions')
      .then((r: any) => setFnList((Array.isArray(r.data) ? r.data : []).map((x: any) => x.name).filter(Boolean)))
      .catch(() => setFnList([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiClient.get(`/attendance-recon/roster-v2/gap-backfill?${qs}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs outline-none';
  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;

  const rows = useMemo(() => {
    let a = (d?.proposals || []).slice();
    if (conf) a = a.filter((r: any) => r.confidence === conf);
    if (q.trim()) { const s = q.toLowerCase(); a = a.filter((r: any) => (r.name || '').toLowerCase().includes(s) || (r.function || '').toLowerCase().includes(s)); }
    return a;
  }, [d, conf, q]);

  const by = d?.byConfidence || { high: 0, medium: 0, low: 0 };

  // Apply a proposal → reuses the audited manual-edit path (validation + schedule_change_log +
  // before/after impact + roster_days/attendance_records mirror). Only fills a gap (OFF/unknown);
  // the endpoint keeps the version history. override:true because the Director reviewed this row.
  const applyOne = async (r: any) => {
    const key = r.personNo + '|' + r.date;
    if (!window.confirm(ar
      ? `تطبيق شفت ${r.proposedCode} لـ${r.name} يوم ${r.date}؟ (بينكتب على الروستر ويتسجّل بالسِّجل)`
      : `Apply shift ${r.proposedCode} to ${r.name} on ${r.date}? (writes to the roster and is logged)`)) return;
    setBusy(key);
    try {
      await apiClient.post('/attendance-recon/roster-v2/schedule-change', {
        personNo: r.personNo, date: r.date, newShift: r.proposedCode,
        reason: 'Gap backfill — system login with no scheduled shift (Gap Review)', override: true,
      });
      setApplied(a => ({ ...a, [key]: true }));
    } catch { window.alert(ar ? 'فشل التطبيق — قد يكون الأسبوع مقفولًا' : 'Apply failed — the week may be locked'); }
    finally { setBusy(null); }
  };

  const exportCsv = () => {
    const head = ['Person', 'Function', 'Date', 'Current', 'Proposed', 'Login', 'GapMin', 'Confidence', 'Note'];
    const lines = [head.join(',')].concat(rows.map((r: any) =>
      [r.name, r.function, r.date, r.currentCode, r.proposedCode, r.login, r.startGapMin, r.confidence, `"${(r.note || '').replace(/"/g, "'")}"`].join(',')));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `Gap_Review_${f.from}_${f.to}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 page-enter">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#06b6d4,#6366f1)', boxShadow: '0 6px 18px rgba(99,102,241,0.35)' }}><SearchCheck size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'مراجعة الثغرات' : 'Gap Review'}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'أيام بلا شفت مجدول (OFF/غير معروف) لكن فيها تسجيل دخول للسيستم — غالبًا اشتغلوا. نقترح الشفت المرجّح من أقرب بداية للـlogin.' : 'Days with no scheduled shift (OFF/unknown) but a system login — likely worked. We propose the likely shift from the nearest start to the login.'}</p>
        </div>
        <DateRangeBar from={f.from} to={f.to} onChange={(a, b) => setF(x => ({ ...x, from: a, to: b }))} />
        <select value={f.function} onChange={e => set('function', e.target.value)} className={inputCls} style={inputStyle}>
          <option value="">{ar ? 'كل الأقسام' : 'All functions'}</option>
          {fnList.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={ar ? 'بحث بالاسم…' : 'Search name…'} className={inputCls} style={inputStyle} />
        <button onClick={exportCsv} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>{ar ? 'تصدير CSV' : 'Export CSV'}</button>
      </div>

      {loading && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ الفحص…' : 'Scanning…'}</p>}
      {!loading && d && (<>
        {/* stat tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <StatTile icon={SearchCheck} label={ar ? 'إجمالي الثغرات' : 'Total gaps'} num={d.total} sub={ar ? 'يوم-موظف للمراجعة' : 'person-days to review'} color="#6366f1" delay={0} />
          <StatTile icon={ShieldCheck} label={ar ? 'ثقة عالية' : 'High confidence'} num={by.high} sub={ar ? 'الدخول قرب بداية شفت' : 'login near a shift start'} color="#22c55e" delay={60} />
          <StatTile icon={ShieldAlert} label={ar ? 'ثقة متوسطة' : 'Medium'} num={by.medium} color="#f59e0b" delay={120} />
          <StatTile icon={ShieldQuestion} label={ar ? 'ثقة منخفضة' : 'Low'} num={by.low} sub={ar ? 'قد يكون ذيل شفت أمس' : 'maybe yesterday\'s tail'} color="#64748b" delay={180} />
        </div>

        {/* confidence filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['', 'high', 'medium', 'low'] as const).map(k => (
            <button key={k || 'all'} onClick={() => setConf(k)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
              style={conf === k ? { background: 'linear-gradient(135deg,#06b6d4,#6366f1)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>
              {k === '' ? (ar ? 'الكل' : 'All') : (ar ? CONF[k].ar : CONF[k].en)}
            </button>
          ))}
          <span className="text-[11px] ms-auto" style={{ color: 'var(--text-3)' }}>{rows.length} {ar ? 'ظاهرة' : 'shown'}</span>
        </div>

        {/* table */}
        <div className="rounded-2xl p-1 overflow-auto" style={panel}>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead><tr style={{ color: 'var(--text-3)' }}>
              {[ar ? 'الموظف' : 'Agent', ar ? 'القسم' : 'Function', ar ? 'التاريخ' : 'Date', ar ? 'الحالي' : 'Current', ar ? 'المقترح' : 'Proposed', ar ? 'الدخول' : 'Login', ar ? 'الثقة' : 'Confidence', ar ? 'ملاحظة' : 'Note', ''].map((h, i) => (
                <th key={i} className="text-start px-2.5 py-2 font-semibold" style={{ borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r: any, i: number) => { const cf = CONF[r.confidence] || CONF.low; const Ic = cf.icon;
                const night = /^(MD|MN|N|E|EE)/.test(r.proposedCode);
                return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-2.5 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{r.name}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{r.function}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap" style={{ color: 'var(--text-2)' }}>{r.date}</td>
                  <td className="px-2.5 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>{r.currentCode}</span></td>
                  <td className="px-2.5 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1" style={{ background: night ? 'rgba(99,102,241,0.16)' : 'rgba(14,165,233,0.16)', color: night ? '#818cf8' : '#0ea5e9' }}>{night ? <Moon size={10} /> : <Sun size={10} />}{r.proposedCode}</span></td>
                  <td className="px-2.5 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-2)' }}>{r.login}</td>
                  <td className="px-2.5 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1" style={{ background: cf.bg, color: cf.c }}><Ic size={10} />{ar ? cf.ar : cf.en}</span></td>
                  <td className="px-2.5 py-2" style={{ color: 'var(--text-3)', maxWidth: 300 }}>{r.note}</td>
                  <td className="px-2.5 py-2">{applied[r.personNo + '|' + r.date]
                    ? <span className="px-2 py-1 rounded text-[10px] font-bold" style={{ background: 'rgba(34,197,94,0.14)', color: '#22c55e' }}>{ar ? '✓ طُبِّق' : '✓ Applied'}</span>
                    : <button onClick={() => applyOne(r)} disabled={busy === r.personNo + '|' + r.date}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap disabled:opacity-50"
                        style={{ background: 'linear-gradient(135deg,#06b6d4,#6366f1)', color: '#fff' }}>
                        {busy === r.personNo + '|' + r.date ? '…' : (ar ? 'طبّق' : 'Apply')}</button>}</td>
                </tr>
              ); })}
              {rows.length === 0 && <tr><td colSpan={9} className="px-2.5 py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'لا ثغرات في هذا النطاق 🎉' : 'No gaps in this range 🎉'}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>★ {ar ? 'للمراجعة فقط — النظام لا يكتب ولا يلغي أي شفت موجود. الطريقة: أقرب بداية شفت معيارية للـlogin (بدون logout بسبب الـbleed). المصدر: ' + (d.method || '') : 'Read-only — never writes or overrides an existing shift. Method: nearest canonical shift-start to the login (logout ignored — bleed).'}</p>
      </>)}
    </div>
  );
}
