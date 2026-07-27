/**
 * ⑥ TUNING & DATA — the admin room, tucked behind one disclosure so the buyer
 * demo stays clean: (a) per-function engine parameters (CPO/AHT/ACW/Hold/SL/
 * occupancy/shrinkage/productivity/concurrency — every knob saved per function),
 * (b) the event/period Excel forecast flow (template → fill → upload → verdict),
 * (c) the learned Sprinklr floor grid (weekday × hour P90 measured load).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Settings2, ChevronDown, ChevronUp, Loader2, Save, Download, Upload, UserPlus,
  SlidersHorizontal, CalendarRange, Zap, RefreshCw,
} from 'lucide-react';
import { apiClient } from '@/api/client';
import { nfmt, PAL, type StaffParams } from './kit';
import { readableOn } from '@/utils/format';

const NUM_FIELDS: { key: keyof StaffParams; ar: string; en: string; step: number; pct?: boolean }[] = [
  { key: 'acwSec',          ar: 'ACW (ث)',        en: 'ACW (s)',       step: 5 },
  { key: 'holdSec',         ar: 'Hold (ث)',       en: 'Hold (s)',      step: 5 },
  { key: 'targetSl',        ar: 'هدف SL',         en: 'SL target',     step: 0.05, pct: true },
  { key: 'targetAnswerSec', ar: 'زمن الرد (ث)',   en: 'Answer (s)',    step: 5 },
  { key: 'occupancyCap',    ar: 'سقف الإشغال',    en: 'Occupancy cap', step: 0.05, pct: true },
  { key: 'shrinkage',       ar: 'شرينكج',         en: 'Shrinkage',     step: 0.05, pct: true },
  { key: 'productivity',    ar: 'إنتاجية',        en: 'Productivity',  step: 0.05, pct: true },
  { key: 'concurrency',     ar: 'تزامن',          en: 'Concurrency',   step: 1 },
];

function SubHeader({ icon: Icon, color, title, right }: {
  icon: typeof Settings2; color: string; title: string; right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-6 h-6 rounded-lg grid place-items-center flex-shrink-0" style={{ background: `${color}1a` }}>
        <Icon size={12} style={{ color }} />
      </span>
      <span className="font-bold text-[11px]" style={{ color: 'var(--text-1)' }}>{title}</span>
      {right && <span className="ms-auto flex items-center gap-2">{right}</span>}
    </div>
  );
}

/* ── (a) Params editor ────────────────────────────────────────────────────── */
function ParamsEditor({ ar, params, edit, dirtyCount, saveDirty, saving }: {
  ar: boolean; params: StaffParams[];
  edit: (fn: string, key: keyof StaffParams, val: unknown) => void;
  dirtyCount: number; saveDirty: () => void; saving: boolean;
}) {
  const soft = 'var(--surface-2)';
  return (
    <div>
      <SubHeader icon={SlidersHorizontal} color={PAL.warn}
        title={ar ? 'براميترات كل فنكشن' : 'Per-function parameters'}
        right={dirtyCount > 0 && (
          <button onClick={saveDirty} disabled={saving}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg"
            style={{ background: '#6366f1', color: '#fff' }}>
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            {ar ? `حفظ (${dirtyCount})` : `Save (${dirtyCount})`}
          </button>
        )} />
      <div style={{ overflowX: 'auto' }}>
        <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="px-2 py-1.5 font-bold" style={{ color: 'var(--text-3)', textAlign: 'start' }}>{ar ? 'الفنكشن' : 'Function'}</th>
              <th className="px-2 py-1.5 font-bold" style={{ color: 'var(--text-3)' }}>{ar ? 'القنوات' : 'Channels'}</th>
              <th className="px-2 py-1.5 font-bold" style={{ color: 'var(--text-3)' }}>Model</th>
              <th className="px-2 py-1.5 font-bold" style={{ color: 'var(--text-3)' }}>AHT</th>
              {NUM_FIELDS.map(f => (
                <th key={String(f.key)} className="px-2 py-1.5 font-bold text-center" style={{ color: 'var(--text-3)' }}>{ar ? f.ar : f.en}</th>
              ))}
              <th className="px-2 py-1.5 font-bold" style={{ color: 'var(--text-3)' }}>{ar ? 'مُوظَّف' : 'Staffed'}</th>
            </tr>
          </thead>
          <tbody>
            {params.map(p => (
              <tr key={p.functionKey} style={{ borderBottom: '1px solid var(--border)', opacity: p.isStaffed ? 1 : 0.45 }}>
                <td className="px-2 py-1.5 font-bold whitespace-nowrap" style={{ color: 'var(--text-1)' }}>{p.functionKey}</td>
                <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                  {Object.entries(p.channelMix).map(([c, s]) => `${c} ${Math.round((s as number) * 100)}%`).join(' · ') || '—'}
                </td>
                <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-3)' }}>{p.model}</td>
                <td className="px-2 py-1.5 text-center">
                  <input type="number" placeholder={ar ? 'مقاس' : 'auto'} value={p.ahtSec ?? ''}
                    onChange={e => edit(p.functionKey, 'ahtSec', e.target.value === '' ? null : +e.target.value)}
                    className="w-14 text-center rounded px-1 py-0.5 text-[10px]"
                    style={{ background: soft, color: 'var(--text-1)', border: '1px solid var(--border)' }} />
                </td>
                {NUM_FIELDS.map(f => (
                  <td key={String(f.key)} className="px-1 py-1.5 text-center">
                    <input type="number" step={f.step}
                      value={f.pct ? Math.round((p[f.key] as number) * 100) : (p[f.key] as number)}
                      onChange={e => edit(p.functionKey, f.key, f.pct ? +e.target.value / 100 : +e.target.value)}
                      className="w-12 text-center rounded px-1 py-0.5 text-[10px]"
                      style={{ background: soft, color: 'var(--text-1)', border: '1px solid var(--border)' }} />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" checked={p.isStaffed} className="accent-indigo-500"
                    onChange={e => edit(p.functionKey, 'isStaffed', e.target.checked)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] mt-1.5" style={{ color: 'var(--text-3)' }}>
        {ar ? 'AHT فاضي = يُقاس تلقائيًا من آخر 28 يوم. النِسَب (SL/إشغال/شرينكج/إنتاجية) تُدخل كنسبة مئوية. حصص القنوات يجب أن تجمع 100% لكل قناة عبر الفنكشنز.'
            : 'Blank AHT = measured from the last 28 days. Percent fields entered as %. Channel shares must sum to 100% per channel across functions.'}
      </div>
    </div>
  );
}

/* ── (b) Event / period forecast (Excel flow) ─────────────────────────────── */
interface EventFnVerdict {
  functionKey: string; error?: string; requiredPeak: number; availableAgents: number;
  gapAgents: number; internsToHire: number; projectedSlNow: number; projectedSlAfterHire: number;
  worstDay: string | null; targetSl: number;
}

function EventForecastPanel({ ar }: { ar: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; from: string; to: string; perFunction: EventFnVerdict[] } | null>(null);
  const [history, setHistory] = useState<{ name: string; from: string; to: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiClient.get('/capacity/staffing/event-forecasts').then(r => setHistory(r.data)).catch(() => {});
  }, [result]);

  const download = async () => {
    const r = await apiClient.get('/capacity/staffing/event-template', { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url; a.download = 'WFM_Event_Forecast_Template.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('name', f.name.replace(/\.xlsx?$/i, ''));
      const r = await apiClient.post('/capacity/staffing/event-forecast', fd);
      setResult(r.data);
    } catch { /* surfaced by empty result */ }
    setBusy(false);
  };

  return (
    <div>
      <SubHeader icon={CalendarRange} color={PAL.learn}
        title={ar ? 'فوركاست فترة / إيفنت — بأرقامك أنت' : 'Event / period forecast — with YOUR numbers'} />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={download} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg"
          style={{ background: `${PAL.learn}15`, color: PAL.learn }}>
          <Download size={12} /> {ar ? 'تنزيل القالب' : 'Download template'}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg"
          style={{ background: '#6366f1', color: '#fff' }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {ar ? 'رفع الملف المعبّى' : 'Upload filled file'}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ''; }} />
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>
          {ar ? 'شيت Daily_Forecast: الطلبات + كونتاكتس كل فنكشن يوم بيوم · شيت Available_Agents: المتاحين + إنتاجية الإنترن'
              : 'Daily_Forecast: orders + contacts per function per day · Available_Agents: current agents + intern productivity'}
        </span>
      </div>

      {result && (
        <div className="mt-2.5" style={{ overflowX: 'auto' }}>
          <div className="text-[10px] font-black mb-1.5" style={{ color: 'var(--text-1)' }}>
            {result.name} — {result.from} → {result.to}
          </div>
          <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {[ar ? 'الفنكشن' : 'Function', ar ? 'المطلوب (ذروة)' : 'Required (peak)', ar ? 'المتاح' : 'Available',
                  ar ? 'الفجوة' : 'Gap', ar ? '⬅ إنترنز للتوظيف' : '⬅ Interns to hire',
                  ar ? 'SL الآن' : 'SL now', ar ? 'SL بعد التوظيف' : 'SL after', ar ? 'أسوأ يوم' : 'Worst day'].map((h, i) => (
                  <th key={i} className="px-2 py-1.5 font-bold text-center" style={{ color: 'var(--text-3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.perFunction.filter(f => !f.error).map(f => (
                <tr key={f.functionKey} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-2 py-1.5 font-bold" style={{ color: 'var(--text-1)' }}>{f.functionKey}</td>
                  <td className="px-2 py-1.5 text-center font-bold tabular-nums" style={{ color: PAL.warn }}>{f.requiredPeak}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: 'var(--text-1)' }}>{f.availableAgents}</td>
                  <td className="px-2 py-1.5 text-center font-bold tabular-nums" style={{ color: f.gapAgents > 0 ? PAL.risk : PAL.ok }}>{f.gapAgents}</td>
                  <td className="px-2 py-1.5 text-center font-black tabular-nums" style={{ color: f.internsToHire > 0 ? PAL.risk : PAL.ok }}>
                    {f.internsToHire > 0 ? <span className="inline-flex items-center gap-1"><UserPlus size={11} />{f.internsToHire}</span> : '✓'}
                  </td>
                  <td className="px-2 py-1.5 text-center font-bold tabular-nums"
                    style={{ color: f.projectedSlNow >= f.targetSl ? PAL.ok : PAL.risk }}>{Math.round(f.projectedSlNow * 100)}%</td>
                  <td className="px-2 py-1.5 text-center font-bold tabular-nums"
                    style={{ color: f.projectedSlAfterHire >= f.targetSl ? PAL.ok : PAL.warn }}>{Math.round(f.projectedSlAfterHire * 100)}%</td>
                  <td className="px-2 py-1.5 text-center" style={{ color: 'var(--text-3)' }}>{f.worstDay ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!result && history.length > 0 && (
        <div className="text-[9px] mt-1.5" style={{ color: 'var(--text-3)' }}>
          {ar ? 'رفعات سابقة: ' : 'Previous uploads: '}
          {history.slice(0, 5).map(h => `${h.name} (${h.from}→${h.to})`).join(' · ')}
        </div>
      )}
    </div>
  );
}

/* ── (c) Learned floor grid ───────────────────────────────────────────────── */
interface LearnedData { cells?: number; total_samples?: number; channels?: Record<string, { cells: number; grid: (number | null)[][] }> }

function LearnedPanel({ ar, learned, reload }: { ar: boolean; learned: LearnedData | null; reload: () => Promise<void> }) {
  const [ch, setCh] = useState('');
  const [busy, setBusy] = useState(false);
  const keys = Object.keys(learned?.channels ?? {});
  const active = keys.includes(ch) ? ch : (keys[0] ?? '');
  const grid = learned?.channels?.[active]?.grid ?? null;
  const maxV = grid ? Math.max(1, ...grid.flat().map(v => v ?? 0)) : 1;
  const DOWS = ar ? ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const rollNow = async () => {
    setBusy(true);
    await apiClient.post('/capacity/staffing/observations/rollup?hoursBack=336').catch(() => {});
    await reload();
    setBusy(false);
  };

  return (
    <div>
      <SubHeader icon={Zap} color={PAL.learn}
        title={ar ? 'الأرضية المتعلمة — الحمل المقاس من سبرينكلر (المحرك لا يوظف أقل منه)' : 'Learned floor — measured Sprinklr load (the engine never staffs below it)'}
        right={
          <button onClick={rollNow} disabled={busy}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg"
            style={{ background: `${PAL.learn}15`, color: PAL.learn }}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {ar ? 'تعلّم الآن (آخر 14 يوم)' : 'Learn now (last 14 days)'}
          </button>
        } />
      {keys.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {keys.map(c => (
            <button key={c} onClick={() => setCh(c)}
              className="text-[10px] font-bold px-2.5 py-1 rounded-lg"
              style={{ background: c === active ? PAL.learn : 'var(--surface-2)', color: c === active ? '#052e22' : 'var(--text-3)' }}>
              {c} <span style={{ opacity: 0.75 }}>({learned?.channels?.[c].cells})</span>
            </button>
          ))}
        </div>
      )}
      {!grid ? (
        <div className="text-[10px] py-2" style={{ color: 'var(--text-3)' }}>
          {ar ? 'لا توجد ملاحظات بعد — خلّي جسر سبرينكلر شغال؛ الراصد يتعلم كل ساعة تلقائيًا.' : 'No observations yet — keep the Sprinklr bridge running; the observer learns hourly.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
            <thead>
              <tr>
                <th className="text-[8px] font-bold px-1" style={{ color: 'var(--text-3)' }}></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} className="text-[8px] font-bold" style={{ color: 'var(--text-3)', minWidth: 24 }}>{String(h).padStart(2, '0')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, dow) => (
                <tr key={dow}>
                  <td className="text-[8px] font-bold px-1 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{DOWS[dow]}</td>
                  {row.map((v, h) => (
                    <td key={h} className="text-center text-[8px] font-bold rounded tabular-nums"
                      title={v != null ? `${DOWS[dow]} ${String(h).padStart(2, '0')}:00 — P90 ${nfmt(v)} Erlang` : (ar ? 'لم يُقس بعد' : 'not measured yet')}
                      style={{
                        height: 20, minWidth: 24,
                        background: v == null ? 'var(--surface-2)' : `rgba(52,211,153,${0.12 + 0.7 * (v / maxV)})`,
                        color: v != null && v / maxV > 0.5 ? '#052e22' : 'var(--text-3)',
                      }}>
                      {v != null ? Math.round(v) : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[9px] mt-1" style={{ color: 'var(--text-3)' }}>
            {ar ? 'P90 للحمل المتزامن المقاس (Erlang شامل الانتظار) لكل يوم×ساعة — الخلايا المعلَّمة بحلقة ⚡ في هيت-ماب المطلوب فوق رفعتها هذه الأرضية.'
                : 'P90 measured concurrent load (Erlangs incl. waiting) per weekday×hour — the ⚡-ringed cells in the requirement heatmap above were raised by this floor.'}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The disclosure ───────────────────────────────────────────────────────── */
export default function TuningSection({ ar, no, params, edit, dirtyCount, saveDirty, saving, learned, reloadLearned }: {
  ar: boolean; no: string; params: StaffParams[];
  edit: (fn: string, key: keyof StaffParams, val: unknown) => void;
  dirtyCount: number; saveDirty: () => void; saving: boolean;
  learned: LearnedData | null; reloadLearned: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(s => !s)} className="w-full flex items-center gap-3 p-4 text-start">
        <div className="relative flex-shrink-0" style={{ width: 34, height: 34 }}>
          <div className="w-full h-full rounded-xl grid place-items-center" style={{ background: `${PAL.neutral}1a` }}>
            <Settings2 size={16} style={{ color: 'var(--text-3)' }} strokeWidth={2.2} />
          </div>
          <span className="absolute -top-1.5 grid place-items-center rounded-full text-[8px] font-black"
            style={{ insetInlineEnd: -5, width: 14, height: 14, background: PAL.neutral,
              /* same badge as the other kits — derive the foreground from the chip */
              color: readableOn(PAL.neutral) }}>{no}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-extrabold text-[13px]" style={{ color: 'var(--text-1)' }}>
            {ar ? 'الضبط والبيانات' : 'Tuning & data'}
          </div>
          <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {ar ? 'براميترات المحرك لكل فنكشن · فوركاست إيفنت بالإكسل · شبكة الأرضية المتعلمة'
                : 'per-function engine parameters · event forecast via Excel · the learned-floor grid'}
          </div>
        </div>
        {dirtyCount > 0 && !open && (
          <span className="text-[9px] font-black px-2 py-0.5 rounded-full" style={{ background: `${PAL.warn}1a`, color: PAL.warn }}>
            {ar ? `${dirtyCount} تعديل غير محفوظ` : `${dirtyCount} unsaved`}
          </span>
        )}
        {open ? <ChevronUp size={15} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={15} style={{ color: 'var(--text-3)' }} />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-5">
          <ParamsEditor ar={ar} params={params} edit={edit} dirtyCount={dirtyCount} saveDirty={saveDirty} saving={saving} />
          <div style={{ height: 1, background: 'var(--border)' }} />
          <EventForecastPanel ar={ar} />
          <div style={{ height: 1, background: 'var(--border)' }} />
          <LearnedPanel ar={ar} learned={learned} reload={reloadLearned} />
        </div>
      )}
    </section>
  );
}
