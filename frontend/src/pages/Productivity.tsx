import { useRef, useState } from 'react';
import { Activity, Upload, Download, Loader2, Users, Gauge, Phone, Clock } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

interface AgentRow {
  userId: string; name: string; campaign: string; intervals: number;
  staffed: string; ready: string; break: string; idle: string; voiceOff: string;
  talk: string; acw: string; wrappedCalls: number; aht: string;
  productivityPct: number; occupancyPct: number; breakPct: number; idlePct: number;
}
interface Result {
  generatedAt: string;
  totals: { agents: number; intervals: number; staffedHours: number; avgProductivityPct: number; avgOccupancyPct: number; totalWrappedCalls: number; overallAht: string };
  agents: AgentRow[];
}

export default function ProductivityPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');

  const card: React.CSSProperties = { background: dark ? '#0f1527' : '#fff', border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, borderRadius: 16 };

  const upload = async (file: File) => {
    setLoading(true); setErr(''); setFileName(file.name);
    try {
      const form = new FormData(); form.append('file', file);
      const { data } = await apiClient.post('/productivity/analyze', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setRes(data);
    } catch (e: any) { setErr(e?.response?.data?.message ?? (ar ? 'فشل التحليل' : 'Analysis failed')); setRes(null); }
    finally { setLoading(false); }
  };

  const exportCSV = () => {
    if (!res) return;
    const headers = ['User ID', 'Name', 'Campaign', 'Intervals', 'Staffed', 'Productive (Ready)', 'Productivity %', 'Occupancy %', 'Break', 'Break %', 'Idle', 'Idle %', 'Voice OFF', 'Talk', 'ACW', 'Wrapped Calls', 'AHT'];
    const rows = res.agents.map(a => [a.userId, a.name, a.campaign, a.intervals, a.staffed, a.ready, a.productivityPct, a.occupancyPct, a.break, a.breakPct, a.idle, a.idlePct, a.voiceOff, a.talk, a.acw, a.wrappedCalls, a.aht]);
    const csv = '﻿' + [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `agent_productivity_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const Metric = ({ icon: Icon, label, value, color }: any) => (
    <div style={{ ...card, padding: '14px 16px' }} className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: color + '1a' }}><Icon size={18} style={{ color }} /></div>
      <div><p className="text-[11px] text-slate-500">{label}</p><p className="text-xl font-bold" style={{ color: dark ? '#fff' : '#0f172a' }}>{value}</p></div>
    </div>
  );

  return (
    <div className="page-enter">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)' }}><Activity size={22} className="text-white" /></div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: dark ? '#fff' : '#0f172a' }}>{ar ? 'إنتاجية الموظفين' : 'Agent Productivity'}</h1>
            <p className="text-xs text-slate-500">{ar ? 'ارفع تقرير Ameyo (Agent Productivity Interval) — يحسب الإنتاجية والبريكات والـAHT تلقائياً' : 'Upload the Ameyo Agent Productivity Interval export — auto-computes productivity, breaks, AHT'}</p>
          </div>
        </div>
        {res && <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-200" style={card}><Download size={14} /> {ar ? 'تصدير Excel' : 'Export'}</button>}
      </div>

      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />

      {!res && (
        <div onClick={() => fileRef.current?.click()} className="cursor-pointer rounded-2xl flex flex-col items-center justify-center py-16 gap-3 transition-all hover:opacity-80"
          style={{ ...card, borderStyle: 'dashed', borderWidth: 2 }}>
          {loading ? <Loader2 size={30} className="animate-spin text-indigo-400" /> : <Upload size={30} className="text-indigo-400" />}
          <p className="text-sm font-semibold" style={{ color: dark ? '#e2e8f0' : '#334155' }}>{loading ? (ar ? `جارٍ تحليل ${fileName}…` : `Analyzing ${fileName}…`) : (ar ? 'اضغط لرفع تقرير الإنتاجية (CSV/Excel)' : 'Click to upload the Productivity report (CSV/Excel)')}</p>
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
      )}

      {res && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <Metric icon={Users} label={ar ? 'موظفين' : 'Agents'} value={res.totals.agents} color="#6366f1" />
            <Metric icon={Gauge} label={ar ? 'متوسط الإنتاجية' : 'Avg productivity'} value={res.totals.avgProductivityPct + '%'} color="#22c55e" />
            <Metric icon={Activity} label={ar ? 'الإشغال' : 'Occupancy'} value={res.totals.avgOccupancyPct + '%'} color="#0ea5e9" />
            <Metric icon={Clock} label={ar ? 'ساعات مشغّلة' : 'Staffed hrs'} value={res.totals.staffedHours} color="#f59e0b" />
            <Metric icon={Phone} label={ar ? 'مكالمات' : 'Wrapped calls'} value={res.totals.totalWrappedCalls.toLocaleString()} color="#ec4899" />
            <Metric icon={Clock} label={ar ? 'AHT' : 'AHT'} value={res.totals.overallAht} color="#a855f7" />
          </div>

          <div className="rounded-2xl overflow-x-auto" style={card}>
            <table className="w-full text-xs" style={{ minWidth: 1000 }}>
              <thead>
                <tr className="text-slate-500 text-[10px] uppercase" style={{ background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                  {[ar ? 'الموظف' : 'Agent', ar ? 'القناة' : 'Campaign', ar ? 'مشغّل' : 'Staffed', ar ? 'منتج' : 'Productive', ar ? 'إنتاجية%' : 'Prod.%', ar ? 'إشغال%' : 'Occ.%', ar ? 'بريك' : 'Break', ar ? 'بريك%' : 'Brk%', ar ? 'خامل' : 'Idle', 'Voice OFF', ar ? 'مكالمات' : 'Calls', 'AHT'].map(h => (
                    <th key={h} className="px-3 py-3 text-center first:text-start">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.agents.map((a, i) => (
                  <tr key={i} className="border-t hover:bg-white/[0.03]" style={{ borderColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
                    <td className="px-3 py-2 text-start"><p className="font-semibold" style={{ color: dark ? '#fff' : '#0f172a' }}>{a.name}</p><p className="text-[9px] text-slate-600">{a.userId}</p></td>
                    <td className="px-3 py-2 text-center text-slate-400 text-[10px]">{a.campaign}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{a.staffed}</td>
                    <td className="px-3 py-2 text-center text-slate-300">{a.ready}</td>
                    <td className="px-3 py-2 text-center font-bold" style={{ color: a.productivityPct >= 80 ? '#22c55e' : a.productivityPct >= 60 ? '#f59e0b' : '#ef4444' }}>{a.productivityPct}%</td>
                    <td className="px-3 py-2 text-center text-sky-300">{a.occupancyPct}%</td>
                    <td className="px-3 py-2 text-center text-slate-400">{a.break}</td>
                    <td className="px-3 py-2 text-center text-amber-300">{a.breakPct}%</td>
                    <td className="px-3 py-2 text-center text-slate-400">{a.idle}</td>
                    <td className="px-3 py-2 text-center text-orange-300">{a.voiceOff}</td>
                    <td className="px-3 py-2 text-center text-slate-300">{a.wrappedCalls}</td>
                    <td className="px-3 py-2 text-center text-purple-300">{a.aht}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => { setRes(null); setErr(''); }} className="mt-4 text-xs text-slate-500 hover:text-white">{ar ? '↻ رفع ملف آخر' : '↻ Upload another file'}</button>
        </>
      )}
    </div>
  );
}
