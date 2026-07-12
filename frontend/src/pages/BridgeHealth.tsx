import { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Radio, FileSpreadsheet, Plug, Phone,
  CheckCircle2, AlertTriangle, XCircle, ArrowRightLeft, Clock,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useUiStore } from '@/store/ui.store';
import { Kpi, KpiRow, KpiSource } from '@/components/kpi';

/* ── Types (mirror GET /integrations/health) ──────────────────────────────── */
type Verdict = 'green' | 'amber' | 'red';
interface Source {
  key: string;
  kind: 'live' | 'staging';
  lastCaptureAt: string | null;
  ageSec: number | null;
  isStale: boolean;
  verdict: Verdict;
  awaiting: boolean;
  detail: any;
}
interface Emitter {
  key: string;
  emits: string;
  inputRows: number;
  lastCaptureAt: string | null;
  ageSec: number | null;
  ready: boolean;
}
interface HealthResp {
  generatedAt: string;
  thresholds: Record<string, number>;
  overall: Verdict;
  sources: Source[];
  emitters: Emitter[];
}

/* ── Static per-source metadata (labels + what fills it), AR/EN ────────────── */
const META: Record<string, {
  icon: any;
  en: string; ar: string;
  fillsEn: string; fillsAr: string;
}> = {
  sprinklr_live: {
    icon: Radio,
    en: 'Sprinklr Live (RTA)', ar: 'سبرينكلر مباشر (RTA)',
    fillsEn: 'Chrome extension riding the Director’s Sprinklr tab → /integrations/sprinklr/push (every ~30-60s).',
    fillsAr: 'إضافة كروم تركب تبويب سبرنكلر لدى المدير ← /integrations/sprinklr/push (كل ~30-60ث).',
  },
  sprinklr_reports: {
    icon: FileSpreadsheet,
    en: 'Sprinklr Reports (login/logout · survey · agent-perf)', ar: 'تقارير سبرنكلر (دخول/خروج · استبيان · أداء)',
    fillsEn: 'reportingQuery report-tables captured when the Director opens a Sprinklr reporting tab → sprinklr_report_staging.',
    fillsAr: 'جداول reportingQuery تُلتقط عند فتح المدير لتبويب تقارير سبرنكلر ← sprinklr_report_staging.',
  },
  odoo: {
    icon: Plug,
    en: 'Odoo Staging (attendance · permission · comp · leave)', ar: 'أودو (بصمة · إذن · تعويض · إجازة)',
    fillsEn: 'Odoo extension riding the supervisor session records opened models → odoo_staging.',
    fillsAr: 'إضافة أودو تركب جلسة المشرف وتسجل النماذج المفتوحة ← odoo_staging.',
  },
  ameyo_live: {
    icon: Phone,
    en: 'Ameyo Live (telephony)', ar: 'أميو مباشر (الاتصالات)',
    fillsEn: 'Ameyo extension (discovery-stage) pushes live-monitoring snapshots.',
    fillsAr: 'إضافة أميو (قيد الاستكشاف) تدفع لقطات المراقبة المباشرة.',
  },
};

const EMITTER_META: Record<string, { en: string; ar: string }> = {
  sprinklr_sessions: { en: 'Sprinklr login/logout', ar: 'دخول/خروج سبرنكلر' },
  odoo_fingerprint: { en: 'Odoo fingerprint (hr.attendance)', ar: 'بصمة أودو (hr.attendance)' },
  odoo_permissions: { en: 'Odoo permission & comp', ar: 'إذن وتعويض أودو' },
};

const V_COLOR: Record<Verdict, string> = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444' };
const V_ICON: Record<Verdict, any> = { green: CheckCircle2, amber: AlertTriangle, red: XCircle };

function humanAge(sec: number | null, ar: boolean): string {
  if (sec == null) return ar ? 'لم يلتقط بعد' : 'never';
  if (sec < 60) return ar ? `منذ ${sec}ث` : `${sec}s ago`;
  const m = Math.round(sec / 60);
  if (m < 60) return ar ? `منذ ${m}د` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return ar ? `منذ ${h}س` : `${h}h ago`;
  const d = Math.round(h / 24);
  return ar ? `منذ ${d}ي` : `${d}d ago`;
}

export default function BridgeHealth() {
  const { lang } = useUiStore();
  const ar = lang === 'ar';
  const [data, setData] = useState<HealthResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--elev-2)',
  };

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const { data } = await apiClient.get('/integrations/health');
      setData(data);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || (ar ? 'تعذّر التحميل' : 'Failed to load'));
    } finally { setBusy(false); }
  }, [ar]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const OverallIcon = data ? V_ICON[data.overall] : Activity;

  // Headline numbers for the provenance KPI row.
  const liveSrc = data?.sources.find(s => s.key === 'sprinklr_live');
  const repSrc = data?.sources.find(s => s.key === 'sprinklr_reports');
  const odooSrc = data?.sources.find(s => s.key === 'odoo');
  const emittersReady = data?.emitters.filter(e => e.ready).length ?? 0;
  const emittersTotal = data?.emitters.length ?? 3;

  return (
    <div dir={ar ? 'rtl' : 'ltr'} className="p-4 sm:p-6 space-y-5" style={{ color: 'var(--text-1)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <ArrowRightLeft size={20} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold">{ar ? 'صحة جسور الإدخال التلقائي' : 'Auto-Ingest Bridge Health'}</h1>
            <p className="text-xs" style={{ color: 'var(--text-2)' }}>
              {ar ? 'حالة الجسور التي تركب جلسة المدير تلقائياً' : 'Live status of the session-riding capture bridges'}
            </p>
          </div>
        </div>
        <button
          onClick={load} disabled={busy}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {err && (
        <div className="p-3 rounded-lg text-sm flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          <XCircle size={16} /> {err}
        </div>
      )}

      {/* Overall verdict banner */}
      {data && (
        <div className="p-4 rounded-2xl flex items-center gap-3" style={{ ...card, borderLeft: `4px solid ${V_COLOR[data.overall]}` }}>
          <OverallIcon size={22} style={{ color: V_COLOR[data.overall] }} />
          <div className="flex-1">
            <div className="text-sm font-semibold">
              {data.overall === 'green'
                ? (ar ? 'كل الجسور تتدفق' : 'All bridges flowing')
                : data.overall === 'amber'
                  ? (ar ? 'بعض المصادر بانتظار جلسة المدير' : 'Some sources awaiting the Director’s live session')
                  : (ar ? 'مصدر مباشر متوقف' : 'A live source has stopped')}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-2)' }}>
              {ar ? 'آخر تحديث' : 'Generated'}: {new Date(data.generatedAt).toLocaleTimeString(ar ? 'ar-KW' : 'en-GB')}
            </div>
          </div>
        </div>
      )}

      {/* Provenance KPI row */}
      {data && (
        <KpiRow cols={4}>
          <Kpi
            label={ar ? 'طوابير مباشرة' : 'Live queues'}
            value={liveSrc?.detail?.queues ?? '—'} accent={V_COLOR[liveSrc?.verdict ?? 'amber']}
            icon={<Radio size={15} />} sub={humanAge(liveSrc?.ageSec ?? null, ar)}
            source={{ endpoint: 'GET /integrations/health', table: 'integration_snapshots (source=sprinklr)',
              definition: 'Queue count in the latest Sprinklr live snapshot pushed by the Chrome bridge.',
              definitionAr: 'عدد الطوابير في آخر لقطة سبرنكلر مباشرة.',
              period: humanAge(liveSrc?.ageSec ?? null, ar) } satisfies KpiSource} />
          <Kpi
            label={ar ? 'صفوف تقارير مجهّزة' : 'Staged report rows'}
            value={repSrc?.detail?.totalRows ?? 0} accent={V_COLOR[repSrc?.verdict ?? 'amber']}
            icon={<FileSpreadsheet size={15} />} sub={repSrc?.awaiting ? (ar ? 'بانتظار الالتقاط' : 'awaiting capture') : humanAge(repSrc?.ageSec ?? null, ar)}
            source={{ endpoint: 'GET /integrations/health', table: 'sprinklr_report_staging',
              definition: 'Total staged rows across login/logout, survey and agent-perf report tables.',
              definitionAr: 'إجمالي الصفوف المجهّزة من تقارير الدخول/الخروج والاستبيان والأداء.' } satisfies KpiSource} />
          <Kpi
            label={ar ? 'صفوف أودو مجهّزة' : 'Staged Odoo rows'}
            value={odooSrc?.detail?.totalRows ?? 0} accent={V_COLOR[odooSrc?.verdict ?? 'amber']}
            icon={<Plug size={15} />} sub={odooSrc?.awaiting ? (ar ? 'بانتظار الالتقاط' : 'awaiting capture') : humanAge(odooSrc?.ageSec ?? null, ar)}
            source={{ endpoint: 'GET /integrations/health', table: 'odoo_staging',
              definition: 'Total staged Odoo rows (attendance + permission + comp + leave + other models).',
              definitionAr: 'إجمالي صفوف أودو المجهّزة (بصمة + إذن + تعويض + إجازة).' } satisfies KpiSource} />
          <Kpi
            label={ar ? 'مُخرجات جاهزة' : 'Emitters ready'}
            value={`${emittersReady}/${emittersTotal}`} accent={emittersReady === emittersTotal ? '#22c55e' : '#f59e0b'}
            icon={<ArrowRightLeft size={15} />} sub={ar ? 'مدخلات recon-emit' : 'recon-emit inputs'}
            source={{ endpoint: 'GET /integrations/health',
              definition: 'How many of the 3 recon-emit inputs have staged rows ready to promote into the roster.',
              definitionAr: 'كم من مدخلات recon-emit الثلاثة لديها صفوف جاهزة.' } satisfies KpiSource} />
        </KpiRow>
      )}

      {/* Source cards */}
      {data && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {data.sources.map(s => {
            const meta = META[s.key];
            const Icon = meta?.icon ?? Activity;
            const VIcon = V_ICON[s.verdict];
            return (
              <div key={s.key} className="p-4 rounded-2xl space-y-3" style={{ ...card, borderTop: `3px solid ${V_COLOR[s.verdict]}` }}>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <Icon size={17} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{ar ? meta?.ar : meta?.en}</div>
                    <div className="flex items-center gap-1.5 text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                      <Clock size={12} /> {humanAge(s.ageSec, ar)}
                      <span className="opacity-40">·</span>
                      <span>{s.kind === 'live' ? (ar ? 'مباشر' : 'live') : (ar ? 'تجهيز' : 'staging')}</span>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold"
                    style={{ background: `${V_COLOR[s.verdict]}1a`, color: V_COLOR[s.verdict] }}>
                    <VIcon size={12} />
                    {s.verdict === 'green' ? (ar ? 'يتدفق' : 'flowing')
                      : s.verdict === 'amber' ? (s.awaiting ? (ar ? 'بانتظار' : 'awaiting') : (ar ? 'قديم' : 'stale'))
                        : (ar ? 'متوقف' : 'down')}
                  </span>
                </div>

                {/* Detail metrics */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {s.kind === 'live' && (
                    <>
                      <Pill label={ar ? 'طوابير' : 'queues'} value={s.detail?.queues ?? 0} />
                      <Pill label={ar ? 'موظفون' : 'agents'} value={s.detail?.agents ?? 0} />
                    </>
                  )}
                  {s.key === 'sprinklr_reports' && (
                    <>
                      <Pill label={ar ? 'إجمالي الصفوف' : 'rows'} value={s.detail?.totalRows ?? 0} />
                      {(s.detail?.byType ?? []).map((t: any) => (
                        <Pill key={t.reportType} label={t.reportType} value={t.rows} />
                      ))}
                    </>
                  )}
                  {s.key === 'odoo' && (
                    <>
                      <Pill label={ar ? 'إجمالي الصفوف' : 'rows'} value={s.detail?.totalRows ?? 0} />
                      {(s.detail?.groups ?? []).map((g: any) => (
                        <Pill key={g.group} label={g.group} value={g.rows} />
                      ))}
                    </>
                  )}
                </div>

                {/* What fills it */}
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  {ar ? meta?.fillsAr : meta?.fillsEn}
                </p>

                {/* Needs Director session hint */}
                {s.awaiting && (
                  <div className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                    style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>
                    <AlertTriangle size={13} />
                    {ar ? 'يحتاج جلسة المدير المباشرة لبدء الالتقاط' : 'Needs the Director’s live session to start capturing'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Emitter readiness strip */}
      {data && (
        <div className="p-4 rounded-2xl space-y-3" style={card}>
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-semibold">{ar ? 'جاهزية المُخرجات (recon-emit)' : 'Emitter readiness (recon-emit inputs)'}</h2>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {ar ? 'كل مُخرج يقرأ الصفوف المجهّزة ويكتب شكل recon (يربط قبل recon-new-roster).'
              : 'Each emitter reads staged rows and writes the recon xlsx shape (wired before recon-new-roster).'}
          </p>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
            {data.emitters.map(e => {
              const em = EMITTER_META[e.key];
              return (
                <div key={e.key} className="p-3 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2">
                    {e.ready
                      ? <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
                      : <AlertTriangle size={14} style={{ color: '#f59e0b' }} />}
                    <span className="text-xs font-medium">{ar ? em?.ar : em?.en}</span>
                  </div>
                  <div className="text-xs mt-1.5" style={{ color: 'var(--text-2)' }}>
                    {ar ? 'صفوف المدخل' : 'input rows'}: <b style={{ color: 'var(--text-1)' }}>{e.inputRows}</b>
                    <span className="opacity-40"> · </span>{humanAge(e.ageSec, ar)}
                  </div>
                  <div className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-3)' }}>{e.emits}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="px-2 py-1 rounded-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
      {label}: <b style={{ color: 'var(--text-1)' }}>{value}</b>
    </span>
  );
}
