import { useState, useEffect, useCallback } from 'react';
import {
  Activity, Loader2, AlertTriangle, Clock, Zap, Stethoscope, UserX, LogOut,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface HourRow {
  hour: number; required: number; scheduled: number; available: number;
  onSick: number; onAbsent: number; onPermission: number; late: number; earlyOut: number; ot: number; gap: number;
}
interface FnCoverage {
  functionId: string; functionName: string; hours: HourRow[];
  summary: { late: number; overtime: number; earlyOut: number; sick: number; absent: number; permissions: number; worstGap: number };
}
interface Resp { date: string; basis: string; functions: FnCoverage[] }

const gapColor = (g: number) => g >= 0 ? '#22c55e' : g >= -2 ? '#f59e0b' : '#ef4444';
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function HourlyCoveragePage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [date, setDate] = useState('');
  const [fnId, setFnId] = useState('');            // '' = all functions
  const [funcs, setFuncs] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setL] = useState(true);

  const load = useCallback(async () => {
    setL(true);
    try {
      const params: any = {};
      if (date) params.date = date;
      if (fnId) params.functionId = fnId;
      const { data } = await apiClient.get<Resp>('/coverage/hourly', { params });
      setData(data);
      if (!date && data?.date) setDate(data.date);
    } catch { setData(null); }
    setL(false);
  }, [date, fnId]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [fnId]);
  useEffect(() => {
    apiClient.get('/schedule-generator/functions')
      .then(r => setFuncs((Array.isArray(r.data) ? r.data : [])
        .filter((f: any) => parseInt(f.employee_count ?? '0', 10) > 0)
        .map((f: any) => ({ id: f.id, name: f.name }))))
      .catch(() => setFuncs([]));
  }, []);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.22)' }}>
            <Activity size={18} style={{ color: '#22d3ee' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'التغطية بالساعة لكل قسم' : 'Hourly Coverage by Function'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'الاحتياج · المجدول · المتاح · الفجوة — ويتحدّث بالسيك والاستئذان والأوفرتايم' : 'Required · Scheduled · Available · Gap — eroded by sick/permission/OT/late'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={fnId} onChange={e => setFnId(e.target.value)}
            className="text-xs rounded-xl px-3 py-1.5 outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }}>
            <option value="" style={{ background: '#0f172a' }}>{ar ? 'كل الأقسام' : 'All functions'}</option>
            {funcs.map(f => <option key={f.id} value={f.id} style={{ background: '#0f172a' }}>{f.name}</option>)}
          </select>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} onBlur={load}
            className="text-xs rounded-xl px-3 py-1.5 outline-none"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data || data.functions.length === 0 ? (
        <div className="text-center py-20" style={{ color: '#475569' }}>
          <Activity size={32} className="mx-auto mb-3" style={{ color: '#334155' }} />
          <p className="text-sm">{ar ? 'لا توجد بيانات تغطية لهذا اليوم' : 'No coverage data for this date'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[10px]" style={{ color: '#475569' }}>{data.basis}</p>
          {data.functions.map(fn => {
            const maxVal = Math.max(...fn.hours.flatMap(h => [h.required, h.scheduled]), 1);
            return (
              <div key={fn.functionId} className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                {/* Function header + summary chips */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(99,102,241,0.05)' }}>
                  <span className="text-sm font-bold" style={{ color: tp(dark) }}>{fn.functionName}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {fn.summary.worstGap < 0 && (
                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                        <AlertTriangle size={10} /> {ar ? 'أسوأ فجوة' : 'worst gap'} {fn.summary.worstGap}
                      </span>
                    )}
                    {([
                      [Clock, fn.summary.late, ar ? 'متأخر' : 'late', '#fb923c'],
                      [LogOut, fn.summary.earlyOut, ar ? 'خروج مبكر' : 'early out', '#f87171'],
                      [Zap, fn.summary.overtime, 'OT', '#22d3ee'],
                      [Stethoscope, fn.summary.sick, ar ? 'مرضي' : 'sick', '#fbbf24'],
                      [UserX, fn.summary.absent, ar ? 'غياب' : 'absent', '#f87171'],
                      [LogOut, fn.summary.permissions, ar ? 'استئذان' : 'perm', '#a78bfa'],
                    ] as const).map(([Ic, v, lbl, col], i) => (
                      <span key={i} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${col}14`, color: col as string }}>
                        <Ic size={10} /> {v} {lbl}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Hourly table */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                        {[ar ? 'الساعة' : 'Hour', ar ? 'الاحتياج' : 'Required', ar ? 'المجدول' : 'Scheduled', ar ? 'استئذان' : 'Perm', ar ? 'تأخير' : 'Late', ar ? 'خروج' : 'Out', 'OT', ar ? 'المتاح' : 'Available', ar ? 'الفجوة' : 'Gap', ''].map((h, i) => (
                          <th key={i} className="text-[10px] font-semibold uppercase tracking-wider text-start px-3 py-2" style={{ color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fn.hours.map(h => (
                        <tr key={h.hour} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: '#94a3b8' }}>{hh(h.hour)}</td>
                          <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: '#818cf8' }}>{h.required}</td>
                          <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: '#cbd5e1' }}>{h.scheduled}</td>
                          <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: h.onPermission ? '#a78bfa' : '#334155' }}>{h.onPermission || '·'}</td>
                          <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: h.late ? '#fb923c' : '#334155' }}>{h.late || '·'}</td>
                          <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: h.earlyOut ? '#f87171' : '#334155' }}>{h.earlyOut || '·'}</td>
                          <td className="px-3 py-1.5 text-xs tabular-nums" style={{ color: h.ot ? '#22d3ee' : '#334155' }}>{h.ot ? `+${h.ot}` : '·'}</td>
                          <td className="px-3 py-1.5 text-xs tabular-nums font-semibold" style={{ color: '#22d3ee' }}>
                            {h.available}
                            {(h.onSick + h.onAbsent) > 0 && (
                              <span className="text-[9px] ms-1" style={{ color: '#64748b' }}>
                                ({ar ? 'سيك/غياب' : 'sk/ab'} −{h.onSick + h.onAbsent})
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-xs font-bold tabular-nums" style={{ color: gapColor(h.gap) }}>{h.gap >= 0 ? `+${h.gap}` : h.gap}</td>
                          <td className="px-3 py-1.5" style={{ minWidth: 160 }}>
                            <div className="relative h-3 rounded" style={{ background: 'rgba(255,255,255,0.04)' }}>
                              {/* required marker */}
                              <div className="absolute top-0 bottom-0" style={{ left: `${(h.required / maxVal) * 100}%`, width: 2, background: '#818cf8' }} />
                              {/* available bar */}
                              <div className="h-full rounded" style={{ width: `${(h.available / maxVal) * 100}%`, background: gapColor(h.gap), opacity: 0.7 }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
