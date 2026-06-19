import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, Clock, CalendarOff, Stethoscope, Layers, TrendingDown,
  Users, AlertTriangle, Download, Activity, X, Send, CheckCircle2, Loader2, Zap,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';
import { fmtLocalDate } from '@/utils/format';

/* ─── Cover-Gap modal: pick channel + date for an under-covered hour, list eligible
       agents (skill + present + shift covers), dispatch one to cover with one click ── */
const CHANNELS = [
  { code: 'chat', ar: 'شات', en: 'Chat' },
  { code: 'voice', ar: 'صوت', en: 'Voice' },
  { code: 'whatsapp', ar: 'واتساب', en: 'WhatsApp' },
  { code: 'email', ar: 'إيميل', en: 'Email' },
];
function CoverGapModal({ hour, defaultDate, ar, onClose }: { hour: number; defaultDate: string; ar: boolean; onClose: () => void }) {
  const [skill, setSkill] = useState('chat');
  const [date, setDate]   = useState(defaultDate);
  const [cands, setCands] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]   = useState<string | null>(null);
  const [done, setDone]   = useState<Record<string, boolean>>({});
  const [msg, setMsg]     = useState('');

  const find = useCallback(() => {
    setLoading(true); setMsg('');
    apiClient.get(`/skills/gaps?skillCode=${skill}&date=${date}&fromHour=${hour}&toHour=${hour + 1}`)
      .then((r: any) => setCands(r.data?.candidates ?? []))
      .catch(() => setCands([])).finally(() => setLoading(false));
  }, [skill, date, hour]);
  useEffect(() => { find(); }, [find]);

  const dispatch = async (c: any) => {
    setBusy(c.employeeId);
    try {
      const chLabel = CHANNELS.find(x => x.code === skill)?.en ?? skill;
      await apiClient.post('/skills/dispatch', {
        employeeId: c.employeeId,
        fromFunction: c.currentFunction || 'Voice',
        toFunction: chLabel,
        startAt: `${date}T${String(hour).padStart(2, '0')}:00:00Z`,
        endAt:   `${date}T${String(hour + 1).padStart(2, '0')}:00:00Z`,
        reason: `Cover ${chLabel} gap at ${hour}:00`,
      });
      setDone(d => ({ ...d, [c.employeeId]: true }));
      setMsg(ar ? `✓ تم تكليف ${c.name} بتغطية ${chLabel}` : `✓ ${c.name} dispatched to cover ${chLabel}`);
    } catch { setMsg(ar ? 'فشل التكليف' : 'Dispatch failed'); } finally { setBusy(null); }
  };

  const eligible = cands.filter(c => c.eligible);
  const others   = cands.filter(c => !c.eligible);
  const inp = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: '#0f1527', border: '1px solid rgba(255,255,255,0.12)' }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.07]">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><Zap size={15} className="text-amber-400" /> {ar ? `تغطية فجوة الساعة ${hour}:00` : `Cover ${hour}:00 gap`}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <select value={skill} onChange={e => setSkill(e.target.value)} className="flex-1 px-3 py-2 rounded-xl text-sm text-white outline-none cursor-pointer" style={inp}>
              {CHANNELS.map(c => <option key={c.code} value={c.code} style={{ background: '#0f1527' }}>{ar ? c.ar : c.en}</option>)}
            </select>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-3 py-2 rounded-xl text-sm text-white outline-none" style={inp} />
          </div>

          {msg && <div className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac' }}>{msg}</div>}

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-indigo-400" /></div>
          ) : (
            <div className="max-h-[44vh] overflow-y-auto space-y-1.5">
              <p className="text-[10px] text-slate-500 uppercase font-bold">{ar ? `مؤهلون للتغطية (${eligible.length})` : `Eligible (${eligible.length})`}</p>
              {eligible.length === 0 && <p className="text-xs text-slate-600 py-3 text-center">{ar ? 'لا يوجد ايجنت بهذه المهارة متواجد هذه الفترة' : 'No skilled agent present this period'}</p>}
              {eligible.map(c => (
                <div key={c.employeeId} className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ background: c.bestMatch ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.06)', border: `1px solid ${c.bestMatch ? 'rgba(245,158,11,0.35)' : 'rgba(34,197,94,0.18)'}` }}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                      {c.name}
                      {c.bestMatch && <span className="text-[9px] font-bold text-amber-300 px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.2)' }}>⭐ {ar ? 'أفضل ترشيح' : 'Best match'}</span>}
                    </p>
                    <p className="text-[10px] text-slate-500">{c.currentFunction} · {c.proficiency} · {c.shiftWindow} · {ar ? 'تكليفات' : 'loads'}: {c.recentMoves ?? 0}</p>
                  </div>
                  {done[c.employeeId] ? (
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 size={13} /> {ar ? 'تم' : 'Sent'}</span>
                  ) : (
                    <button onClick={() => dispatch(c)} disabled={busy === c.employeeId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#16a34a,#22c55e)' }}>
                      {busy === c.employeeId ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {ar ? 'كلّف' : 'Dispatch'}
                    </button>
                  )}
                </div>
              ))}
              {others.length > 0 && (
                <>
                  <p className="text-[10px] text-slate-600 uppercase font-bold pt-2">{ar ? `عندهم المهارة لكن غير متاحين (${others.length})` : `Skilled but unavailable (${others.length})`}</p>
                  {others.slice(0, 8).map(c => (
                    <div key={c.employeeId} className="flex items-center justify-between px-3 py-1.5 rounded-xl opacity-60" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <p className="text-[11px] text-slate-400 truncate">{c.name} <span className="text-slate-600">· {c.marker ?? (ar ? 'غير مجدول' : 'not scheduled')}</span></p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface ShiftRow {
  window: string; code: string; start: string; end: string; shiftHours: number; scheduled: number;
  present: number; absent: number; sick: number; leave: number; holiday: number; off: number; wfh: number;
  otCount: number; otHours: number; lateCount: number; lateMinutes: number; missingPunch: number;
  permissions: number; breaks: number; breakMinutes: number; missedBreaks: number;
  plannedShrinkage: number; unplannedShrinkage: number; plannedShrinkagePct: number; unplannedShrinkagePct: number;
  attendanceRate: number | null; shrinkagePct: number;
}
interface ShrinkBlock { scheduledDays: number; plannedPct: number; unplannedPct: number; latePct: number; totalPct: number; breakdown: any }
interface Shrinkage { overall: ShrinkBlock; weekend: ShrinkBlock; weekday: ShrinkBlock }
interface TrendPoint { bucket: string; firstDay: string; scheduled: number; plannedPct: number; unplannedPct: number; totalPct: number }
interface FairnessRow { id: string; employeeNo: string; name: string; functionName: string; weekendDays: number; weekendOff: number; totalOff: number; weekendOffPct: number; weekendOffShare: number }
interface SickRow { employeeNo: string; name: string; functionName: string; totalSick: number; weekendSick: number; weekdaySick: number; weekendSickPct: number }
interface HourRow {
  hour: number; scheduledTotal: number; presentTotal: number; avgScheduled: number; avgPresent: number; shrinkagePct: number;
  normalHc: number; onPermission: number; afterPermission: number; sick: number; absent: number; afterSick: number;
  otAdded: number; afterOt: number; avgNormal: number; avgAfterPermission: number; avgAfterSick: number; avgAfterOt: number;
}
interface ForecastDay { date: string; dow: number; dayName: string; dayNameAr: string; peakHc: number; hours: { hour: number; forecastHc: number }[] }

const monthStart = () => { const d = new Date(); return fmtLocalDate(new Date(d.getFullYear(), d.getMonth(), 1)); };
const today = () => fmtLocalDate(new Date());

type Tab = 'shifts' | 'shrinkage' | 'coverage' | 'fairness' | 'sick' | 'forecast';

export default function WorkforceAnalyticsPage() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';

  const [tab, setTab]   = useState<Tab>('shifts');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo]     = useState(today());
  const [functionId, setFunctionId] = useState('');
  const [funcs, setFuncs] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const [shifts, setShifts]       = useState<ShiftRow[]>([]);
  const [shrink, setShrink]       = useState<Shrinkage | null>(null);
  const [trend, setTrend]         = useState<{ weekly: TrendPoint[]; monthly: TrendPoint[] } | null>(null);
  const [trendMode, setTrendMode] = useState<'weekly' | 'monthly'>('weekly');
  const [hours, setHours]         = useState<HourRow[]>([]);
  const [fairness, setFairness]   = useState<FairnessRow[]>([]);
  const [sick, setSick]           = useState<SickRow[]>([]);
  const [coverHour, setCoverHour] = useState<number | null>(null);
  const [gapMsg, setGapMsg] = useState('');
  const [forecast, setForecast] = useState<ForecastDay[]>([]);

  const notifyGaps = () => {
    setGapMsg(ar ? 'جاري الفحص...' : 'Scanning...');
    apiClient.post(`/analytics/notify-gaps?from=${from}&to=${to}`, {})
      .then((r: any) => {
        const d = r.data;
        setGapMsg(d.gaps > 0
          ? (ar ? `✓ تم تنبيه الـRTA بـ${d.gaps} فجوة` : `✓ RTA alerted to ${d.gaps} gap(s)`)
          : (ar ? '✓ لا توجد فجوات تغطية' : '✓ No coverage gaps'));
      })
      .catch(() => setGapMsg(ar ? 'فشل' : 'Failed'));
    setTimeout(() => setGapMsg(''), 5000);
  };

  const load = useCallback(() => {
    setLoading(true);
    if (tab === 'forecast') {
      apiClient.get('/analytics/coverage-forecast?weeks=8&horizon=7')
        .then((r: any) => setForecast(r.data?.forecast ?? []))
        .catch(() => setForecast([])).finally(() => setLoading(false));
      return;
    }
    const fq = functionId ? `&functionId=${functionId}` : '';
    const q = `?from=${from}&to=${to}${fq}`;
    const map: Record<string, string> = {
      shifts: '/analytics/shift-breakdown', shrinkage: '/analytics/shrinkage',
      coverage: '/analytics/hourly-headcount', fairness: '/analytics/weekend-fairness', sick: '/analytics/sick-pattern',
    };
    apiClient.get(map[tab] + q).then((r: any) => {
      const d = r.data;
      if (tab === 'shifts') setShifts(d.shifts ?? []);
      else if (tab === 'shrinkage') {
        setShrink(d);
        apiClient.get(`/analytics/shrinkage-trend${q}`).then((tr: any) => setTrend(tr.data)).catch(() => setTrend(null));
      }
      else if (tab === 'coverage') setHours(d.hours ?? []);
      else if (tab === 'fairness') setFairness(d.employees ?? []);
      else if (tab === 'sick') setSick(d.employees ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [tab, from, to, functionId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiClient.get('/analytics/functions').then((r: any) => setFuncs(r.data ?? [])).catch(() => {}); }, []);

  const exportCSV = () => {
    let headers: string[] = [], rows: any[][] = [], name = tab;
    if (tab === 'shifts') {
      headers = ['Code', 'Shift', 'Hours', 'Scheduled', 'Present', 'Absent', 'Sick', 'Leave', 'Holiday', 'OFF', 'WFH', 'OT count', 'OT hrs', 'Late', 'Missing punch', 'Permissions', 'Breaks', 'Break mins', 'Missed breaks', 'Planned shrinkage', 'Unplanned shrinkage', 'Attendance %', 'Shrinkage %'];
      rows = shifts.map(s => [s.code, s.window, s.shiftHours, s.scheduled, s.present, s.absent, s.sick, s.leave, s.holiday, s.off, s.wfh, s.otCount, s.otHours, s.lateCount, s.missingPunch, s.permissions, s.breaks, s.breakMinutes, s.missedBreaks, s.plannedShrinkage, s.unplannedShrinkage, s.attendanceRate ?? '', s.shrinkagePct]);
    } else if (tab === 'fairness') {
      headers = ['Emp#', 'Name', 'Function', 'Weekend days', 'Weekend OFF', 'Weekends off %', 'Total OFF', 'OFF on weekend %'];
      rows = fairness.map(e => [e.employeeNo, e.name, e.functionName, e.weekendDays, e.weekendOff, e.weekendOffPct, e.totalOff, e.weekendOffShare]);
    } else if (tab === 'sick') {
      headers = ['Emp#', 'Name', 'Function', 'Total sick', 'Weekend sick', 'Weekday sick', 'Weekend sick %'];
      rows = sick.map(e => [e.employeeNo, e.name, e.functionName, e.totalSick, e.weekendSick, e.weekdaySick, e.weekendSickPct]);
    } else if (tab === 'coverage') {
      headers = ['Hour', 'Normal HC', 'On permission', 'After permission', 'Sick', 'After sick', 'OT added', 'After OT', 'Avg present', 'Shrinkage %'];
      rows = hours.map(h => [h.hour, h.avgNormal, h.onPermission, h.avgAfterPermission, h.sick, h.avgAfterSick, h.otAdded, h.avgAfterOt, h.avgPresent, h.shrinkagePct]);
    } else return;
    const csv = '﻿' + [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `analytics-${name}-${from}_${to}.csv`; a.click();
  };

  const TABS: { key: Tab; icon: any; ar: string; en: string }[] = [
    { key: 'shifts',    icon: Layers,       ar: 'تفاصيل الورديات', en: 'Shift Breakdown' },
    { key: 'shrinkage', icon: TrendingDown, ar: 'الـShrinkage',    en: 'Shrinkage' },
    { key: 'coverage',  icon: Clock,        ar: 'التغطية بالساعة', en: 'Hourly Coverage' },
    { key: 'fairness',  icon: CalendarOff,  ar: 'عدالة الويك إند', en: 'Weekend Fairness' },
    { key: 'sick',      icon: Stethoscope,  ar: 'نمط الإجازات المرضية', en: 'Sick Pattern' },
    { key: 'forecast',  icon: TrendingDown, ar: 'توقّع التغطية', en: 'Coverage Forecast' },
  ];

  const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' };
  const inp = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
            <BarChart3 size={18} className="text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{ar ? 'تحليلات القوى العاملة' : 'Workforce Analytics'}</h1>
            <p className="text-xs text-slate-500">{ar ? 'تحليل عميق: الورديات، الـshrinkage، التغطية، العدالة، الأنماط' : 'Deep analysis: shifts, shrinkage, coverage, fairness, patterns'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={functionId} onChange={e => setFunctionId(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs text-white outline-none cursor-pointer" style={inp}>
            <option value="" style={{ background: '#0f1527' }}>{ar ? 'كل الأقسام' : 'All functions'}</option>
            {funcs.map(f => <option key={f.id} value={f.id} style={{ background: '#0f1527' }}>{f.name}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs text-white outline-none" style={inp} />
          <span className="text-slate-500 text-xs">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs text-white outline-none" style={inp} />
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-all" style={inp}>
            <Download size={13} /> {ar ? 'تصدير' : 'Export'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-2xl w-fit overflow-x-auto" style={card}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${tab === t.key ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
            style={tab === t.key ? { background: 'linear-gradient(135deg,#4338ca,#6366f1)' } : {}}>
            <t.icon size={13} /> {ar ? t.ar : t.en}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><div className="w-7 h-7 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" /></div>
      ) : (
        <>
          {/* ══ SHIFT BREAKDOWN ══ */}
          {tab === 'shifts' && (
            <div className="rounded-2xl overflow-x-auto" style={card}>
              <table className="w-full text-xs" style={{ minWidth: 920 }}>
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    {(ar
                      ? ['كود','الوردية','ساعات','مجدول','حاضر','غياب','مرضي','إجازة','عطلة','عن بُعد','OT','تأخير','بصمة ناقصة','استئذان','بريك','مخطط','غير مخطط','حضور%','Shrinkage%']
                      : ['Code','Shift','Hours','Scheduled','Present','Absent','Sick','Leave','Holiday','WFH','OT','Late','Missing Punch','Permission','Break','Planned','Unplanned','Attendance%','Shrinkage%']
                    ).map(h => (
                      <th key={h} className="px-2.5 py-3 text-center first:text-start">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s, i) => (
                    <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
                      <td className="px-2.5 py-2 font-bold text-indigo-300 whitespace-nowrap text-start">{s.code}</td>
                      <td className="px-2.5 py-2 text-slate-300 whitespace-nowrap text-start">{s.window}</td>
                      <td className="px-2.5 py-2 text-center text-slate-500">{s.shiftHours}h</td>
                      <td className="px-2.5 py-2 text-center text-slate-300 font-semibold">{s.scheduled}</td>
                      <td className="px-2.5 py-2 text-center text-emerald-400">{s.present}</td>
                      <td className="px-2.5 py-2 text-center text-red-400">{s.absent}</td>
                      <td className="px-2.5 py-2 text-center text-amber-400">{s.sick}</td>
                      <td className="px-2.5 py-2 text-center text-indigo-300">{s.leave}</td>
                      <td className="px-2.5 py-2 text-center text-cyan-300">{s.holiday}</td>
                      <td className="px-2.5 py-2 text-center text-purple-300">{s.wfh}</td>
                      <td className="px-2.5 py-2 text-center text-cyan-400">{s.otCount}<span className="text-slate-600 text-[9px]"> ({s.otHours}h)</span></td>
                      <td className="px-2.5 py-2 text-center text-amber-400">{s.lateCount}</td>
                      <td className="px-2.5 py-2 text-center text-red-300">{s.missingPunch}</td>
                      <td className="px-2.5 py-2 text-center text-slate-300">{s.permissions}</td>
                      <td className="px-2.5 py-2 text-center text-slate-300">{s.breaks}{s.missedBreaks > 0 && <span className="text-red-400 text-[9px]"> ({s.missedBreaks}✗)</span>}</td>
                      <td className="px-2.5 py-2 text-center text-sky-300">{s.plannedShrinkage}<span className="text-slate-600 text-[9px]"> ({s.plannedShrinkagePct}%)</span></td>
                      <td className="px-2.5 py-2 text-center text-orange-300">{s.unplannedShrinkage}<span className="text-slate-600 text-[9px]"> ({s.unplannedShrinkagePct}%)</span></td>
                      <td className="px-2.5 py-2 text-center font-bold" style={{ color: (s.attendanceRate ?? 0) >= 90 ? '#22c55e' : (s.attendanceRate ?? 0) >= 75 ? '#f59e0b' : '#ef4444' }}>{s.attendanceRate ?? '—'}%</td>
                      <td className="px-2.5 py-2 text-center font-bold" style={{ color: s.shrinkagePct <= 15 ? '#22c55e' : s.shrinkagePct <= 30 ? '#f59e0b' : '#ef4444' }}>{s.shrinkagePct}%</td>
                    </tr>
                  ))}
                  {shifts.length === 0 && <tr><td colSpan={19} className="text-center py-10 text-slate-600">{ar ? 'لا بيانات' : 'No data'}</td></tr>}
                </tbody>
                {shifts.length > 0 && (() => {
                  const sum = (k: keyof ShiftRow) => shifts.reduce((a, s) => a + (Number(s[k]) || 0), 0);
                  const present = sum('present'), absent = sum('absent'), sick = sum('sick'), leave = sum('leave'), holiday = sum('holiday');
                  const stw = present + absent + sick + leave + holiday;
                  const planned = sum('plannedShrinkage'), unplanned = sum('unplannedShrinkage');
                  const cell = 'px-2.5 py-2.5 text-center font-bold text-white';
                  return (
                    <tfoot>
                      <tr style={{ background: 'rgba(99,102,241,0.10)', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
                        <td className="px-2.5 py-2.5 font-bold text-indigo-300 text-start">{ar ? 'الإجمالي' : 'Total'}</td>
                        <td className={cell}></td>
                        <td className={cell}></td>
                        <td className={cell}>{sum('scheduled')}</td>
                        <td className={`${cell} text-emerald-400`}>{present}</td>
                        <td className={`${cell} text-red-400`}>{absent}</td>
                        <td className={`${cell} text-amber-400`}>{sick}</td>
                        <td className={`${cell} text-indigo-300`}>{leave}</td>
                        <td className={`${cell} text-cyan-300`}>{holiday}</td>
                        <td className={`${cell} text-purple-300`}>{sum('wfh')}</td>
                        <td className={`${cell} text-cyan-400`}>{sum('otCount')}</td>
                        <td className={`${cell} text-amber-400`}>{sum('lateCount')}</td>
                        <td className={`${cell} text-red-300`}>{sum('missingPunch')}</td>
                        <td className={cell}>{sum('permissions')}</td>
                        <td className={cell}>{sum('breaks')}</td>
                        <td className={`${cell} text-sky-300`}>{planned}</td>
                        <td className={`${cell} text-orange-300`}>{unplanned}</td>
                        <td className={cell}>{stw ? Math.round(100 * present / stw) : 0}%</td>
                        <td className={cell}>{stw ? Math.round(100 * (planned + unplanned) / stw) : 0}%</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}

          {/* ══ SHRINKAGE ══ */}
          {tab === 'shrinkage' && shrink && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {([['overall', ar ? 'الإجمالي' : 'Overall'], ['weekend', ar ? 'الويك إند (خميس/جمعة/سبت)' : 'Weekend (Thu/Fri/Sat)'], ['weekday', ar ? 'أيام الأسبوع' : 'Weekdays']] as const).map(([key, label]) => {
                const b = shrink[key];
                return (
                  <div key={key} className="p-5 rounded-2xl" style={card}>
                    <h3 className="text-sm font-bold text-white mb-1">{label}</h3>
                    <p className="text-3xl font-bold mb-3" style={{ color: b.totalPct <= 15 ? '#22c55e' : b.totalPct <= 25 ? '#f59e0b' : '#ef4444' }}>{b.totalPct}%</p>
                    <p className="text-[10px] text-slate-500 mb-3">{ar ? 'إجمالي الـshrinkage على' : 'total shrinkage of'} {b.scheduledDays.toLocaleString()} {ar ? 'يوم مجدول' : 'scheduled days'}</p>
                    {[
                      { l: ar ? 'مخطط (إجازة/عطلة)' : 'Planned (leave/holiday)', v: b.plannedPct, c: '#6366f1' },
                      { l: ar ? 'غير مخطط (غياب/مرضي)' : 'Unplanned (absent/sick)', v: b.unplannedPct, c: '#ef4444' },
                      { l: ar ? 'تأخير' : 'Lateness', v: b.latePct, c: '#f59e0b' },
                    ].map(x => (
                      <div key={x.l} className="mb-2">
                        <div className="flex justify-between text-[10px] mb-0.5"><span className="text-slate-400">{x.l}</span><span className="font-bold text-white">{x.v}%</span></div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, x.v * 3)}%`, background: x.c }} />
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-3 text-[10px] text-slate-500 mt-3 pt-2 border-t border-white/[0.06]">
                      <span>{ar ? 'إجازة' : 'Leave'}: {b.breakdown.leave}</span>
                      <span>{ar ? 'مرضي' : 'Sick'}: {b.breakdown.sick}</span>
                      <span>{ar ? 'غياب' : 'Absent'}: {b.breakdown.absent}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Shrinkage trend (weekly / monthly) */}
          {tab === 'shrinkage' && trend && (
            <div className="p-5 rounded-2xl mt-4" style={card}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><TrendingDown size={15} className="text-indigo-400" /> {ar ? 'اتجاه الـShrinkage' : 'Shrinkage Trend'}</h3>
                <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  {(['weekly', 'monthly'] as const).map(m => (
                    <button key={m} onClick={() => setTrendMode(m)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-semibold ${trendMode === m ? 'text-white' : 'text-slate-500'}`}
                      style={trendMode === m ? { background: 'rgba(99,102,241,0.4)' } : {}}>
                      {m === 'weekly' ? (ar ? 'أسبوعي' : 'Weekly') : (ar ? 'شهري' : 'Monthly')}
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                const pts = trend[trendMode];
                if (!pts.length) return <p className="text-xs text-slate-600 text-center py-4">{ar ? 'لا بيانات' : 'No data'}</p>;
                const max = Math.max(5, ...pts.map(p => p.totalPct));
                return (
                  <div className="flex items-end gap-1.5 h-44" dir="ltr">
                    {pts.map((p, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group relative" style={{ minWidth: 24 }}>
                        <div className="absolute hidden group-hover:block z-10 px-2 py-1 rounded text-[9px] whitespace-nowrap" style={{ background: '#0f1527', color: '#fff', bottom: 150 }}>
                          {p.bucket} · {ar ? 'إجمالي' : 'total'} {p.totalPct}% ({ar ? 'مخطط' : 'planned'} {p.plannedPct} / {ar ? 'غير' : 'unplanned'} {p.unplannedPct})
                        </div>
                        {/* stacked: planned (indigo) + unplanned (red) */}
                        <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: Math.max(2, Math.round(150 * p.totalPct / max)) }}>
                          <div style={{ height: `${p.totalPct ? (p.plannedPct / p.totalPct) * 100 : 0}%`, background: '#6366f1' }} />
                          <div style={{ height: `${p.totalPct ? (p.unplannedPct / p.totalPct) * 100 : 0}%`, background: '#ef4444' }} />
                        </div>
                        <span className="text-[7px] text-slate-600 rotate-0 truncate w-full text-center">{p.bucket.slice(-5)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div className="flex items-center gap-4 text-[10px] mt-2 justify-center">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#6366f1' }} /> {ar ? 'مخطط' : 'Planned'}</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> {ar ? 'غير مخطط' : 'Unplanned'}</span>
              </div>
            </div>
          )}

          {/* ══ HOURLY COVERAGE ══ */}
          {tab === 'coverage' && (
            <div className="p-5 rounded-2xl" style={card}>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Activity size={15} className="text-cyan-400" /> {ar ? 'متوسط الحضور مقابل المجدول لكل ساعة' : 'Avg Present vs Scheduled per Hour'}</h3>
                <div className="flex items-center gap-2">
                  {gapMsg && <span className="text-[11px] font-semibold text-emerald-400">{gapMsg}</span>}
                  <button onClick={notifyGaps} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-300 hover:bg-amber-500/10 transition-all" style={{ border: '1px solid rgba(245,158,11,0.3)' }}>
                    <AlertTriangle size={13} /> {ar ? 'نبّه الـRTA بالفجوات' : 'Alert RTA of gaps'}
                  </button>
                </div>
              </div>
              <div className="flex items-end gap-1 h-48" dir="ltr">
                {hours.map(h => {
                  const max = Math.max(1, ...hours.map(x => x.avgScheduled));
                  const schH = Math.round(160 * h.avgScheduled / max);
                  const prsH = Math.round(160 * h.avgPresent / max);
                  const under = h.shrinkagePct > 10;   // hour flagged as under-covered → clickable to dispatch coverage
                  return (
                    <div key={h.hour} onClick={() => under && setCoverHour(h.hour)}
                      className={`flex-1 flex flex-col items-center justify-end gap-1 group relative ${under ? 'cursor-pointer' : ''}`}
                      title={under ? (ar ? 'اضغط لتغطية الفجوة' : 'Click to cover the gap') : undefined}>
                      <div className="absolute hidden group-hover:block z-10 px-2 py-1 rounded text-[9px] whitespace-nowrap" style={{ background: '#0f1527', color: '#fff', bottom: 168 }}>
                        {h.hour}:00 · sched {h.avgScheduled} · present {h.avgPresent} · gap {h.shrinkagePct}%{under ? (ar ? ' · اضغط للتغطية' : ' · click to cover') : ''}
                      </div>
                      <div className="flex items-end gap-0.5" style={{ height: 160 }}>
                        <div className="w-1.5 rounded-t" style={{ height: Math.max(2, schH), background: 'rgba(99,102,241,0.4)' }} />
                        <div className="w-1.5 rounded-t" style={{ height: Math.max(2, prsH), background: under ? '#ef4444' : '#22c55e' }} />
                      </div>
                      {under && <Zap size={8} className="text-amber-400 -mb-0.5" />}
                      <span className="text-[8px] text-slate-600">{h.hour}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 text-[10px] mt-3 justify-center">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(99,102,241,0.4)' }} /> {ar ? 'مجدول' : 'Scheduled'}</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> {ar ? 'حاضر' : 'Present'}</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> {ar ? 'تغطية ناقصة' : 'Under-covered'}</span>
              </div>

              {/* ── HC cascade table: normal → after permission → after sick → after OT ── */}
              <div className="mt-6 rounded-2xl overflow-x-auto" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <table className="w-full text-xs" style={{ minWidth: 640 }}>
                  <thead>
                    <tr className="text-slate-500 text-[10px] uppercase" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      {[ar ? 'الساعة' : 'Hour', ar ? 'عادي' : 'Normal', ar ? 'استئذان' : 'Permission', ar ? 'بعد الاستئذان' : 'After perm.', ar ? 'مرضي' : 'Sick', ar ? 'بعد المرضي' : 'After sick', ar ? 'أوفرتايم' : 'Overtime', ar ? 'بعد الأوفرتايم' : 'After OT'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-center first:text-start">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hours.filter(h => h.normalHc > 0).map(h => (
                      <tr key={h.hour} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
                        <td className="px-3 py-2 font-bold text-white text-start">{String(h.hour).padStart(2, '0')}:00</td>
                        <td className="px-3 py-2 text-center text-slate-300 font-semibold">{h.avgNormal}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{h.onPermission > 0 ? <span className="text-amber-400">−{h.onPermission}</span> : '—'}</td>
                        <td className="px-3 py-2 text-center text-slate-300">{h.avgAfterPermission}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{h.sick > 0 ? <span className="text-orange-400">−{h.sick}</span> : '—'}</td>
                        <td className="px-3 py-2 text-center text-slate-300">{h.avgAfterSick}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{h.otAdded > 0 ? <span className="text-cyan-400">+{h.otAdded}</span> : '—'}</td>
                        <td className="px-3 py-2 text-center font-bold text-emerald-400">{h.avgAfterOt}</td>
                      </tr>
                    ))}
                    {hours.filter(h => h.normalHc > 0).length === 0 && <tr><td colSpan={8} className="text-center py-8 text-slate-600">{ar ? 'لا بيانات' : 'No data'}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">{ar ? 'هيدكاونت لكل ساعة: عادي ← بعد الاستئذان ← بعد المرضي ← بعد الأوفرتايم (متوسط يومي).' : 'Per-hour headcount cascade: normal → after permission → after sick → after overtime (daily average).'}</p>
            </div>
          )}

          {/* ══ WEEKEND FAIRNESS ══ */}
          {tab === 'fairness' && (
            <div className="rounded-2xl overflow-hidden" style={card}>
              <div className="px-4 py-3 border-b border-white/[0.06] text-xs text-slate-400 flex items-center gap-2">
                <AlertTriangle size={13} className="text-amber-400" />
                {ar ? 'نسبة حصول كل موظف على راحة في الويك إند (خميس/جمعة/سبت). الأعلى = أكثر عدالة له، الأقل = يحتاج موازنة.' : 'Each employee’s % of weekend days (Thu/Fri/Sat) given off. Low = needs rebalancing.'}
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 text-[10px] uppercase"><th className="px-4 py-2.5 text-start">{ar ? 'الموظف' : 'Employee'}</th><th className="px-4 py-2.5 text-start">{ar ? 'الوظيفة' : 'Function'}</th><th className="px-4 py-2.5 text-center">{ar ? 'أيام ويك إند' : 'Weekend days'}</th><th className="px-4 py-2.5 text-center">{ar ? 'راحات ويك إند' : 'Weekend OFF'}</th><th className="px-4 py-2.5 text-center">{ar ? 'إجمالي الراحات' : 'Total OFF'}</th><th className="px-4 py-2.5 w-36">{ar ? 'حصلوا ويك إند %' : 'Weekends off %'}</th><th className="px-4 py-2.5 text-center">{ar ? 'راحاته بالويك إند %' : 'OFF on weekend %'}</th></tr></thead>
                <tbody>
                  {fairness.map((e, i) => (
                    <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
                      <td className="px-4 py-2"><p className="text-white font-medium">{e.name}</p><p className="text-[9px] text-slate-600">#{e.employeeNo}</p></td>
                      <td className="px-4 py-2 text-slate-400 text-[11px]">{e.functionName ?? '—'}</td>
                      <td className="px-4 py-2 text-center text-slate-400">{e.weekendDays}</td>
                      <td className="px-4 py-2 text-center text-slate-300">{e.weekendOff}</td>
                      <td className="px-4 py-2 text-center text-slate-400">{e.totalOff}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                            <div className="h-full rounded-full" style={{ width: `${e.weekendOffPct}%`, background: e.weekendOffPct >= 40 ? '#22c55e' : e.weekendOffPct >= 20 ? '#f59e0b' : '#ef4444' }} />
                          </div>
                          <span className="text-[10px] font-bold text-white w-9 text-end">{e.weekendOffPct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center font-bold" style={{ color: '#818cf8' }}>{e.weekendOffShare}%</td>
                    </tr>
                  ))}
                  {fairness.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-600">{ar ? 'لا بيانات' : 'No data'}</td></tr>}
                </tbody>
                {fairness.length > 0 && (() => {
                  const wd = fairness.reduce((a, e) => a + e.weekendDays, 0);
                  const wo = fairness.reduce((a, e) => a + e.weekendOff, 0);
                  const to = fairness.reduce((a, e) => a + e.totalOff, 0);
                  return (
                    <tfoot>
                      <tr style={{ background: 'rgba(99,102,241,0.10)', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
                        <td className="px-4 py-2.5 font-bold text-indigo-300 text-start">{ar ? 'الإجمالي' : 'Total'}</td>
                        <td className="px-4 py-2.5"></td>
                        <td className="px-4 py-2.5 text-center font-bold text-white">{wd}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-white">{wo}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-white">{to}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-white">{wd ? Math.round(100 * wo / wd) : 0}%</td>
                        <td className="px-4 py-2.5 text-center font-bold" style={{ color: '#818cf8' }}>{to ? Math.round(100 * wo / to) : 0}%</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}

          {/* ══ SICK PATTERN ══ */}
          {tab === 'sick' && (
            <div className="rounded-2xl overflow-hidden" style={card}>
              <div className="px-4 py-3 border-b border-white/[0.06] text-xs text-slate-400 flex items-center gap-2">
                <Stethoscope size={13} className="text-amber-400" />
                {ar ? 'الموظفون مرتبون حسب الإجازات المرضية في الويك إند — نسبة عالية قد تشير لنمط يحتاج متابعة.' : 'Sorted by weekend sick days — a high weekend ratio may flag a pattern worth reviewing.'}
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500 text-[10px] uppercase"><th className="px-4 py-2.5 text-start">{ar ? 'الموظف' : 'Employee'}</th><th className="px-4 py-2.5 text-start">{ar ? 'الوظيفة' : 'Function'}</th><th className="px-4 py-2.5 text-center">{ar ? 'إجمالي مرضي' : 'Total sick'}</th><th className="px-4 py-2.5 text-center">{ar ? 'ويك إند' : 'Weekend'}</th><th className="px-4 py-2.5 text-center">{ar ? 'أيام الأسبوع' : 'Weekday'}</th><th className="px-4 py-2.5 text-center">{ar ? 'نسبة الويك إند' : 'Weekend %'}</th></tr></thead>
                <tbody>
                  {sick.map((e, i) => (
                    <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.03]">
                      <td className="px-4 py-2"><p className="text-white font-medium">{e.name}</p><p className="text-[9px] text-slate-600">#{e.employeeNo}</p></td>
                      <td className="px-4 py-2 text-slate-400 text-[11px]">{e.functionName ?? '—'}</td>
                      <td className="px-4 py-2 text-center font-bold text-white">{e.totalSick}</td>
                      <td className="px-4 py-2 text-center text-amber-400 font-semibold">{e.weekendSick}</td>
                      <td className="px-4 py-2 text-center text-slate-400">{e.weekdaySick}</td>
                      <td className="px-4 py-2 text-center font-bold" style={{ color: e.weekendSickPct >= 60 ? '#ef4444' : e.weekendSickPct >= 40 ? '#f59e0b' : '#22c55e' }}>{e.weekendSickPct}%</td>
                    </tr>
                  ))}
                  {sick.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-600">{ar ? 'لا بيانات' : 'No data'}</td></tr>}
                </tbody>
                {sick.length > 0 && (() => {
                  const ts = sick.reduce((a, e) => a + e.totalSick, 0);
                  const ws = sick.reduce((a, e) => a + e.weekendSick, 0);
                  const wk = sick.reduce((a, e) => a + e.weekdaySick, 0);
                  return (
                    <tfoot>
                      <tr style={{ background: 'rgba(99,102,241,0.10)', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
                        <td className="px-4 py-2.5 font-bold text-indigo-300 text-start">{ar ? 'الإجمالي' : 'Total'}</td>
                        <td className="px-4 py-2.5"></td>
                        <td className="px-4 py-2.5 text-center font-bold text-white">{ts}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-amber-400">{ws}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-white">{wk}</td>
                        <td className="px-4 py-2.5 text-center font-bold text-white">{ts ? Math.round(100 * ws / ts) : 0}%</td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}

          {/* ══ COVERAGE FORECAST ══ */}
          {tab === 'forecast' && (
            <div className="p-5 rounded-2xl" style={card}>
              <p className="text-xs text-slate-500 mb-4 flex items-center gap-2">
                <TrendingDown size={13} className="text-indigo-400" />
                {ar ? 'توقّع الحضور لكل ساعة للأيام السبعة القادمة، بناءً على متوسط آخر 8 أسابيع (نفس اليوم والساعة).' : 'Predicted present headcount per hour for the next 7 days, from the trailing 8-week weekday×hour average.'}
              </p>
              {forecast.length === 0 ? <p className="text-xs text-slate-600 text-center py-8">{ar ? 'لا بيانات كافية للتوقّع' : 'Not enough data to forecast'}</p> : (
                <div className="overflow-x-auto" dir="ltr">
                  <table className="border-separate" style={{ borderSpacing: 2 }}>
                    <thead>
                      <tr>
                        <th className="text-[9px] text-slate-500 px-1 text-right sticky left-0">{ar ? 'اليوم' : 'Day'}</th>
                        {Array.from({ length: 24 }, (_, h) => <th key={h} className="text-[8px] text-slate-600 w-7">{h}</th>)}
                        <th className="text-[9px] text-slate-500 px-1">{ar ? 'ذروة' : 'Peak'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const max = Math.max(1, ...forecast.flatMap(d => d.hours.map(h => h.forecastHc)));
                        return forecast.map(day => (
                          <tr key={day.date}>
                            <td className="text-[9px] text-slate-400 px-1 whitespace-nowrap">{ar ? day.dayNameAr : day.dayName} {day.date.slice(5)}</td>
                            {day.hours.map(h => {
                              const intensity = h.forecastHc / max;
                              return (
                                <td key={h.hour} className="w-7 h-6 rounded text-center text-[8px] font-bold"
                                  title={`${day.date} ${h.hour}:00 → ${h.forecastHc}`}
                                  style={{ background: h.forecastHc ? `rgba(99,102,241,${0.12 + intensity * 0.8})` : 'rgba(255,255,255,0.02)', color: intensity > 0.5 ? '#fff' : '#64748b' }}>
                                  {h.forecastHc ? Math.round(h.forecastHc) : ''}
                                </td>
                              );
                            })}
                            <td className="text-[10px] font-bold text-indigo-300 px-1 text-center">{Math.round(day.peakHc)}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {coverHour !== null && (
        <CoverGapModal hour={coverHour} defaultDate={to} ar={ar} onClose={() => setCoverHour(null)} />
      )}
    </div>
  );
}
