import { useState, useEffect, useCallback } from 'react';
import {
  FileBarChart, Loader2, RefreshCw, Download, Play, ChevronDown, Clock, CalendarDays, Zap,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface Run { id: string; recipe_name: string; run_date: string; summary: string; trigger: string; generated_at: string; sections: string[] }

const SECTIONS: { key: string; ar: string; en: string }[] = [
  { key: 'coverage', ar: 'التغطية', en: 'Coverage' },
  { key: 'compliance', ar: 'الالتزام', en: 'Compliance' },
  { key: 'queues', ar: 'الكيوز', en: 'Queues' },
  { key: 'schedule', ar: 'الجدول', en: 'Schedule' },
  { key: 'requests', ar: 'الطلبات', en: 'Requests' },
  { key: 'health', ar: 'صحّة النظام', en: 'Health' },
];

export default function ReportsBotPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [runs, setRuns] = useState<Run[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [loading, setL] = useState(true);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState('');
  const [sel, setSel] = useState<string[]>(SECTIONS.map(s => s.key));
  const [open, setOpen] = useState<Record<string, any>>({});
  const [recipeName, setRecipeName] = useState('');
  const [recipeTime, setRecipeTime] = useState('08:00');

  const load = useCallback(async () => {
    setL(true);
    try {
      const [r1, r2] = await Promise.all([apiClient.get<Run[]>('/reporter/runs'), apiClient.get<any[]>('/reporter/recipes')]);
      setRuns(r1.data || []); setRecipes(r2.data || []);
    } catch { setRuns([]); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try { await apiClient.post('/reporter/generate', { sections: sel, ...(date ? { date } : {}) }); await load(); }
    catch { /* noop */ }
    setBusy(false);
  };

  const toggleRun = async (id: string) => {
    if (open[id]) { setOpen(o => { const n = { ...o }; delete n[id]; return n; }); return; }
    try { const { data } = await apiClient.get(`/reporter/runs/${id}`); setOpen(o => ({ ...o, [id]: data.payload })); } catch { /* noop */ }
  };

  const downloadExcel = async (id: string, d: string) => {
    try {
      const res = await apiClient.get(`/reporter/runs/${id}/excel`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = `wfm-report-${d}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* noop */ }
  };

  const saveRecipe = async () => {
    if (!recipeName.trim()) return;
    try { await apiClient.post('/reporter/recipes', { name: recipeName, sections: sel, scheduleTime: recipeTime, enabled: true }); setRecipeName(''); await load(); } catch { /* noop */ }
  };
  const delRecipe = async (id: string) => { try { await apiClient.delete(`/reporter/recipes/${id}`); await load(); } catch { /* noop */ } };

  const toggleSec = (k: string) => setSel(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k]);

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.22)' }}>
            <FileBarChart size={18} style={{ color: '#0ea5e9' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'الناشر — التقارير التلقائية' : 'Reporting Bot'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'تقرير يومي حسب وصفتك — تغطية، التزام، كيوز، طلبات، صحّة — وتصدير Excel' : 'Daily report on your recipe — coverage, compliance, queues, requests, health — with Excel export'}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#7dd3fc' }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {/* Generate panel */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => toggleSec(s.key)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: sel.includes(s.key) ? 'rgba(14,165,233,0.18)' : 'rgba(255,255,255,0.03)', color: sel.includes(s.key) ? '#7dd3fc' : '#64748b', border: `1px solid ${sel.includes(s.key) ? 'rgba(14,165,233,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
              {ar ? s.ar : s.en}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} />
          <button onClick={generate} disabled={busy || !sel.length} className="flex items-center gap-2 text-xs font-bold rounded-xl px-4 py-2" style={{ background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', color: '#fff', opacity: busy || !sel.length ? 0.6 : 1 }}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}{ar ? 'أنشئ التقرير الآن' : 'Generate now'}
          </button>
        </div>
      </div>

      {/* Schedule recipe */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 mb-2"><CalendarDays size={14} style={{ color: '#a78bfa' }} /><span className="text-xs font-bold" style={{ color: tp(dark) }}>{ar ? 'جدولة تقرير يومي تلقائي' : 'Schedule a daily auto-report'}</span></div>
        <div className="flex items-center gap-2 flex-wrap">
          <input value={recipeName} onChange={e => setRecipeName(e.target.value)} placeholder={ar ? 'اسم التقرير' : 'Report name'}
            className="text-xs rounded-xl px-3 py-1.5 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', minWidth: 160 }} />
          <div className="flex items-center gap-1"><Clock size={13} style={{ color: '#64748b' }} /><input type="time" value={recipeTime} onChange={e => setRecipeTime(e.target.value)} className="text-xs rounded-xl px-2 py-1.5 outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0' }} /></div>
          <button onClick={saveRecipe} className="text-xs font-bold rounded-xl px-3 py-2" style={{ background: 'rgba(167,139,250,0.15)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.3)' }}>{ar ? 'احفظ الجدولة' : 'Save schedule'}</button>
          <span className="text-[10px]" style={{ color: '#475569' }}>{ar ? '(يعمل تلقائياً كل يوم بتوقيت الكويت)' : '(runs daily, Kuwait time)'}</span>
        </div>
        {recipes.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {recipes.map(r => (
              <span key={r.id} className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' }}>
                <Clock size={10} style={{ color: '#a78bfa' }} /> {r.name} · {r.schedule_time || '—'}
                <button onClick={() => delRecipe(r.id)} className="ms-1" style={{ color: '#f87171' }}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Runs */}
      <h2 className="text-sm font-bold mb-2" style={{ color: tp(dark) }}>{ar ? 'التقارير الأخيرة' : 'Recent reports'}</h2>
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !runs.length ? (
        <div className="text-center py-16" style={{ color: '#475569' }}><FileBarChart size={28} className="mx-auto mb-2" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'لا تقارير بعد — أنشئ واحداً' : 'No reports yet — generate one'}</p></div>
      ) : (
        <div className="space-y-2">
          {runs.map(r => (
            <div key={r.id} className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: r.trigger === 'scheduled' ? 'rgba(167,139,250,0.15)' : 'rgba(14,165,233,0.15)', color: r.trigger === 'scheduled' ? '#c4b5fd' : '#7dd3fc' }}>{r.trigger === 'scheduled' ? (ar ? 'مجدول' : 'auto') : (ar ? 'يدوي' : 'manual')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: tp(dark) }}>{r.recipe_name} · {r.run_date}</p>
                  <p className="text-[11px] truncate" style={{ color: '#94a3b8' }}>{r.summary}</p>
                </div>
                <button onClick={() => downloadExcel(r.id, r.run_date)} className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}><Download size={11} />Excel</button>
                <button onClick={() => toggleRun(r.id)} style={{ color: '#475569' }}><ChevronDown size={15} style={{ transform: open[r.id] ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /></button>
              </div>
              {open[r.id] && (
                <div className="px-4 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  {open[r.id].blocks?.coverage?.danger?.length > 0 && <Block title={ar ? 'أقسام بخطر تغطية' : 'Coverage danger'} items={open[r.id].blocks.coverage.danger.map((d: any) => `${d.fn}: ${ar ? 'فجوة' : 'gap'} ${d.gap} @${d.hour}:00`)} color="#f87171" />}
                  {open[r.id].blocks?.queues?.problems?.length > 0 && <Block title={ar ? 'كيوز متعثّرة' : 'Queue issues'} items={open[r.id].blocks.queues.problems.map((q: any) => `${q.name}: SLA ${q.sla}% · bk ${q.backlog}`)} color="#fb923c" />}
                  {open[r.id].blocks?.requests && <Block title={ar ? 'الطلبات' : 'Requests'} items={[`${ar ? 'معلّقة' : 'pending'} ${open[r.id].blocks.requests.pending} · ${ar ? 'متأخّرة' : 'overdue'} ${open[r.id].blocks.requests.overdue} · ${ar ? 'مصعّدة' : 'escalated'} ${open[r.id].blocks.requests.escalated}`]} color="#a78bfa" />}
                  {open[r.id].blocks?.health && <Block title={ar ? 'الصحّة' : 'Health'} items={[`${ar ? 'درجة' : 'score'} ${open[r.id].blocks.health.score}% (${open[r.id].blocks.health.status})`]} color="#22d3ee" />}
                  {open[r.id].blocks?.compliance && <Block title={ar ? 'الالتزام' : 'Compliance'} items={[`${open[r.id].blocks.compliance.total} ${ar ? 'غير ملتزم' : 'offenders'}`]} color="#fbbf24" />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Block({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold mb-0.5" style={{ color }}>{title}</p>
      {items.map((it, i) => <p key={i} className="text-[11px]" style={{ color: '#94a3b8' }}>· {it}</p>)}
    </div>
  );
}
