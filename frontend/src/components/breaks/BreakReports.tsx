import { useCallback, useEffect, useState } from 'react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts } from '@/components/ds';
import { AlertTriangle, BarChart3, Clock, Coffee, Download, Loader2, Scale, Timer, Zap } from 'lucide-react';
import { kwDateOffset } from '@/utils/format';

/**
 * B5 §25 — consolidated break reports tab: entitlement vs used, delay stats,
 * release stats, late returns, overdue, fairness, peak hours + Excel export.
 */

interface Report {
  range: { from: string; to: string };
  summary: {
    totalSlots: number; employees: number; days: number; completed: number;
    delayedCount: number; avgDelayMin: number; maxDelayMin: number;
    overdueEvents: number; missedBreaks: number; entitlementOverrides: number;
  };
  sections: {
    entitlement: any[];
    delays: { totals: any; byFunction: any[]; byDay: any[] };
    releases: { bySource: any[]; exceptions: any };
    lateReturns: any[];
    overdue: any;
    fairness: any[];
    peakHours: { hour: number; slots: number; delayed: number; requests: number }[];
  };
}

function isoDaysAgo(n: number) {
  return kwDateOffset(-n);
}

export default function BreakReports() {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';

  const [from, setFrom] = useState(isoDaysAgo(13));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [fn, setFn] = useState('');
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const divider = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const inputStyle: React.CSSProperties = {
    background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    border: `1px solid ${border}`, color: tp(dark), borderRadius: 10,
    padding: '7px 12px', fontSize: 12, outline: 'none',
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (fn.trim()) params.set('function', fn.trim());
      const { data } = await apiClient.get(`/breaks/reports?${params}`);
      setRep(data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (ar ? 'تعذّر تحميل التقرير' : 'Failed to load report'));
    } finally { setLoading(false); }
  }, [from, to, fn, ar]);

  useEffect(() => { load(); }, []); // initial load only; button re-runs

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (fn.trim()) params.set('function', fn.trim());
      const r: any = await apiClient.get(`/breaks/reports/export?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `break-reports_${from}_${to}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert(ar ? 'فشل التصدير' : 'Export failed'); }
    finally { setExporting(false); }
  };

  const Table = ({ headers, rows, render, max = 12 }: {
    headers: string[]; rows: any[]; render: (r: any) => (string | number)[]; max?: number;
  }) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {headers.map(h => (
            <th key={h} style={{ padding: '7px 10px', textAlign: 'start', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: ts(dark), borderBottom: `1px solid ${divider}` }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${divider}` }}>
              {render(r).map((v, j) => (
                <td key={j} style={{ padding: '7px 10px', fontSize: 11.5, color: j === 0 ? tp(dark) : ts(dark), fontWeight: j === 0 ? 600 : 400 }}>{v}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={headers.length} style={{ padding: 14, fontSize: 11, color: ts(dark), textAlign: 'center' }}>{ar ? 'لا توجد بيانات' : 'No data'}</td></tr>
          )}
        </tbody>
      </table>
      {rows.length > max && <p style={{ fontSize: 10, color: ts(dark), padding: '6px 10px' }}>{ar ? `+${rows.length - max} صفوف إضافية في ملف الإكسل` : `+${rows.length - max} more rows in the Excel export`}</p>}
    </div>
  );

  const Section = ({ title, titleAr, icon, children }: { title: string; titleAr: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <div style={{ ...cardStyle(dark), padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        {icon}
        <h3 style={{ fontSize: 12.5, fontWeight: 700, color: tp(dark) }}>{ar ? titleAr : title}</h3>
      </div>
      {children}
    </div>
  );

  const s = rep?.summary;
  const kpis = s ? [
    { label: ar ? 'إجمالي البريكات' : 'Total Slots', value: s.totalSlots, color: '#f59e0b' },
    { label: ar ? 'الموظفون' : 'Employees', value: s.employees, color: '#818cf8' },
    { label: ar ? 'مكتملة' : 'Completed', value: s.completed, color: '#2dd4bf' },
    { label: ar ? 'متأخرة' : 'Delayed', value: s.delayedCount, color: '#f97316' },
    { label: ar ? 'متوسط التأخير (د)' : 'Avg Delay (min)', value: s.avgDelayMin ?? 0, color: '#f97316' },
    { label: ar ? 'تجاوزات الوقت' : 'Overdue Events', value: s.overdueEvents, color: '#ef4444' },
    { label: ar ? 'بريكات فائتة' : 'Missed', value: s.missedBreaks, color: '#f87171' },
    { label: ar ? 'استثناءات الرصيد' : 'Entitlement Overrides', value: s.entitlementOverrides, color: '#c084fc' },
  ] : [];

  const peakMax = Math.max(1, ...(rep?.sections.peakHours ?? []).map(p => Math.max(p.slots, p.requests)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls */}
      <div style={{ ...cardStyle(dark), padding: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: ts(dark) }}>{ar ? 'من' : 'From'}</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 11, color: ts(dark) }}>{ar ? 'إلى' : 'To'}</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
        <input placeholder={ar ? 'الوظيفة (اختياري)' : 'Function (optional)'} value={fn} onChange={e => setFn(e.target.value)} style={{ ...inputStyle, width: 160 }} />
        <button onClick={load} disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', opacity: loading ? 0.6 : 1 }}>
          {loading ? <Loader2 size={13} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <BarChart3 size={13} />}
          {ar ? 'تحميل التقرير' : 'Load Report'}
        </button>
        <button onClick={exportXlsx} disabled={exporting || !rep}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, border: `1px solid ${border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: tp(dark), background: 'transparent', opacity: exporting || !rep ? 0.5 : 1 }}>
          {exporting ? <Loader2 size={13} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <Download size={13} />}
          {ar ? 'تصدير إكسل' : 'Export Excel'}
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 12 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {rep && (
        <>
          {/* Summary KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {kpis.map(k => (
              <div key={k.label} style={{ ...cardStyle(dark), padding: '12px 14px' }}>
                <p style={{ fontSize: 10, color: ts(dark) }}>{k.label}</p>
                <p style={{ fontSize: 19, fontWeight: 700, color: k.color }}>{k.value}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <Section title="Entitlement vs Used" titleAr="الرصيد مقابل المستخدم" icon={<Coffee size={14} style={{ color: '#0ea5e9' }} />}>
              <Table
                headers={[ar ? 'الموظف' : 'Employee', ar ? 'أيام' : 'Days', ar ? 'الرصيد' : 'Entitled', ar ? 'المستخدم' : 'Used', ar ? 'جلسات' : 'Sessions', ar ? 'رصيد ضائع (د)' : 'Missed Entitl. (min)']}
                rows={rep.sections.entitlement}
                render={r => [`${r.employee_name} (${r.employee_no})`, r.days, r.entitled_min, r.used_min, r.sessions, r.missed_entitlement_min]}
              />
            </Section>

            <Section title="Delays by Function" titleAr="التأخير حسب الوظيفة" icon={<Timer size={14} style={{ color: '#f97316' }} />}>
              <Table
                headers={[ar ? 'الوظيفة' : 'Function', ar ? 'متأخرة' : 'Delayed', ar ? 'متوسط (د)' : 'Avg (min)', ar ? 'أقصى (د)' : 'Max (min)']}
                rows={rep.sections.delays.byFunction}
                render={r => [r.function_name, r.delayed_count, r.avg_delay_min ?? 0, r.max_delay_min ?? 0]}
              />
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: ts(dark), marginBottom: 6 }}>{ar ? 'حسب اليوم' : 'By day'}</p>
                <Table
                  headers={[ar ? 'التاريخ' : 'Date', ar ? 'متأخرة' : 'Delayed', ar ? 'متوسط (د)' : 'Avg (min)']}
                  rows={rep.sections.delays.byDay} max={8}
                  render={r => [r.date, r.delayed_count, r.avg_delay_min ?? 0]}
                />
              </div>
            </Section>

            <Section title="Release Stats" titleAr="إحصاءات الإطلاق" icon={<Zap size={14} style={{ color: '#22c55e' }} />}>
              <Table
                headers={[ar ? 'المصدر' : 'Source', ar ? 'العدد' : 'Count', ar ? 'متوسط أهلية←إطلاق (د)' : 'Avg Eligible→Release (min)']}
                rows={rep.sections.releases.bySource}
                render={r => [r.source, r.count, r.avg_eligible_to_release_min ?? '—']}
              />
              <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                {[
                  { l: ar ? 'استثناءات رصيد' : 'Entitlement overrides', v: rep.sections.releases.exceptions?.entitlement_overrides ?? 0 },
                  { l: ar ? 'تغييرات الوضع' : 'Mode changes', v: rep.sections.releases.exceptions?.mode_changes ?? 0 },
                  { l: ar ? 'تصعيدات تأخير' : 'Delay escalations', v: rep.sections.releases.exceptions?.delay_escalations ?? 0 },
                ].map(x => (
                  <span key={x.l} style={{ fontSize: 10.5, color: ts(dark) }}>{x.l}: <b style={{ color: tp(dark) }}>{x.v}</b></span>
                ))}
              </div>
            </Section>

            <Section title="Late Returns" titleAr="العودة المتأخرة" icon={<Clock size={14} style={{ color: '#ef4444' }} />}>
              <Table
                headers={[ar ? 'الموظف' : 'Employee', ar ? 'مرات' : 'Count', ar ? 'دقائق' : 'Minutes', ar ? 'الأسوأ (د)' : 'Worst (min)']}
                rows={rep.sections.lateReturns}
                render={r => [`${r.employee_name} (${r.employee_no})`, r.late_return_count, r.late_return_minutes, r.worst_late_return_min]}
              />
            </Section>

            <Section title="Overdue & Unauthorized" titleAr="التجاوزات وغير المصرّح" icon={<AlertTriangle size={14} style={{ color: '#ef4444' }} />}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { l: ar ? 'أحداث تجاوز (مسجلة)' : 'Overdue events (audited)', v: rep.sections.overdue?.overdue_events ?? 0 },
                  { l: ar ? 'متجاوزة حالياً' : 'Currently overdue', v: rep.sections.overdue?.currently_overdue ?? 0 },
                  { l: ar ? 'بريكات فائتة' : 'Missed breaks', v: rep.sections.overdue?.missed_breaks ?? 0 },
                  { l: ar ? 'بدأت بدون إطلاق' : 'Started without release', v: rep.sections.overdue?.started_without_release ?? 0 },
                ].map(x => (
                  <div key={x.l} style={{ padding: '10px 12px', borderRadius: 10, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                    <p style={{ fontSize: 10, color: ts(dark) }}>{x.l}</p>
                    <p style={{ fontSize: 17, fontWeight: 700, color: (x.v ?? 0) > 0 ? '#f87171' : '#4ade80' }}>{x.v}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Fairness Distribution" titleAr="توزيع العدالة" icon={<Scale size={14} style={{ color: '#a78bfa' }} />}>
              <Table
                headers={[ar ? 'الموظف' : 'Employee', ar ? 'مبكر' : 'Early', ar ? 'وسط' : 'Mid', ar ? 'متأخر' : 'Late', ar ? 'إجمالي' : 'Total', ar ? 'النقاط' : 'Score']}
                rows={rep.sections.fairness}
                render={r => [`${r.employee_name} (${r.employee_no})`, r.early_slot_count, r.mid_slot_count, r.late_slot_count, r.total_breaks, r.fairness_score]}
              />
            </Section>
          </div>

          {/* Peak hours histogram */}
          <Section title="Peak Request / Delay Hours" titleAr="ساعات الذروة للطلبات والتأخير" icon={<BarChart3 size={14} style={{ color: '#6366f1' }} />}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, overflowX: 'auto', padding: '0 4px' }}>
              {rep.sections.peakHours.map(p => (
                <div key={p.hour} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 30 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
                    <div title={`${ar ? 'بريكات' : 'Slots'}: ${p.slots}`} style={{ width: 9, minHeight: 2, height: (p.slots / peakMax) * 88, background: '#6366f1cc', borderRadius: '2px 2px 0 0' }} />
                    <div title={`${ar ? 'متأخرة' : 'Delayed'}: ${p.delayed}`} style={{ width: 9, minHeight: 2, height: (p.delayed / peakMax) * 88, background: '#f97316cc', borderRadius: '2px 2px 0 0' }} />
                    <div title={`${ar ? 'طلبات' : 'Requests'}: ${p.requests}`} style={{ width: 9, minHeight: 2, height: (p.requests / peakMax) * 88, background: '#22d3eecc', borderRadius: '2px 2px 0 0' }} />
                  </div>
                  <span style={{ fontSize: 9, color: ts(dark) }}>{String(p.hour).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
              {[{ c: '#6366f1cc', l: ar ? 'بريكات' : 'Slots' }, { c: '#f97316cc', l: ar ? 'متأخرة' : 'Delayed' }, { c: '#22d3eecc', l: ar ? 'طلبات' : 'Requests' }].map(x => (
                <span key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: ts(dark) }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: x.c }} />{x.l}
                </span>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
