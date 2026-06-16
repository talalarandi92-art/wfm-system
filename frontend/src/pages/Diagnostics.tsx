import { useState, useEffect, useCallback } from 'react';
import {
  Stethoscope, Loader2, RefreshCw, Copy, Check, XCircle, AlertTriangle, Activity,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles } from '@/components/ds';

interface Issue { source: string; area: string; severity: 'fail' | 'warn' | 'info'; title: string; detail: string }
interface Report {
  generatedAt: string; counts: { fail: number; warn: number };
  healthScore: number | null; securityScore: number | null;
  smoke: { passed: number; total: number } | null; issues: Issue[];
}

const SEV = {
  fail: { color: '#ef4444', Icon: XCircle, ar: 'خطأ' },
  warn: { color: '#f59e0b', Icon: AlertTriangle, ar: 'تحذير' },
  info: { color: '#64748b', Icon: Activity, ar: 'معلومة' },
} as const;

export default function DiagnosticsPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [data, setData] = useState<Report | null>(null);
  const [loading, setL] = useState(true);
  const [withSmoke, setWithSmoke] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (smoke: boolean) => {
    setL(true);
    try { const { data } = await apiClient.get<Report>('/diagnostics', { params: smoke ? { smoke: 1 } : {} }); setData(data); }
    catch { setData(null); }
    setL(false);
  }, []);
  useEffect(() => { load(false); }, [load]);

  const buildText = (): string => {
    if (!data) return '';
    const lines: string[] = [];
    lines.push(`WFM Diagnostics — ${new Date(data.generatedAt).toLocaleString('en-GB')}`);
    lines.push(`Health ${data.healthScore ?? '—'}% · Security ${data.securityScore ?? '—'}%` + (data.smoke ? ` · Smoke ${data.smoke.passed}/${data.smoke.total}` : ''));
    lines.push(`Issues: ${data.counts.fail} fail, ${data.counts.warn} warn`);
    lines.push('');
    data.issues.forEach((i, n) => {
      lines.push(`${n + 1}. [${i.severity.toUpperCase()}] (${i.source} · ${i.area}) ${i.title}`);
      lines.push(`   → ${i.detail}`);
    });
    if (!data.issues.length) lines.push('No issues detected.');
    return lines.join('\n');
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(buildText()); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* */ }
  };

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)' }}>
            <Stethoscope size={18} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'تقرير التشخيص — مشاكل النظام' : 'Diagnostics — discovered issues'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'كل المشاكل اللي اكتشفها الفريق — انسخ التقرير وابعتهولي لأصلّحها' : 'Every issue the team found — copy the report and send it to me to fix'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={copy} disabled={!data} className="flex items-center gap-1.5 text-xs font-bold rounded-xl px-3 py-2" style={{ background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(99,102,241,0.15)', color: copied ? '#4ade80' : '#a5b4fc', border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(99,102,241,0.3)'}` }}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? (ar ? 'انتسخ ✓' : 'Copied') : (ar ? 'انسخ التقرير' : 'Copy report')}
          </button>
          <button onClick={() => { setWithSmoke(true); load(true); }} disabled={loading} className="flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(34,211,238,0.12)', color: '#67e8f9', border: '1px solid rgba(34,211,238,0.25)' }}>
            {loading && withSmoke ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />} {ar ? 'تقرير شامل (مع الاختبار الوظيفي)' : 'Full (with smoke test)'}
          </button>
          <button onClick={() => load(withSmoke)} disabled={loading} className="flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {ar ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><Stethoscope size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر التحميل' : 'Could not load'}</p></div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>{data.counts.fail} {ar ? 'خطأ' : 'fail'}</span>
            <span className="px-2.5 py-1 rounded-lg font-bold" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>{data.counts.warn} {ar ? 'تحذير' : 'warn'}</span>
            {data.healthScore != null && <span className="px-2.5 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', color: '#94a3b8' }}>{ar ? 'سلامة' : 'health'} {data.healthScore}%</span>}
            {data.securityScore != null && <span className="px-2.5 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', color: '#94a3b8' }}>{ar ? 'أمن' : 'security'} {data.securityScore}%</span>}
            {data.smoke && <span className="px-2.5 py-1 rounded-lg" style={{ background: 'rgba(34,211,238,0.1)', color: '#67e8f9' }}>{ar ? 'وظيفي' : 'smoke'} {data.smoke.passed}/{data.smoke.total}</span>}
          </div>

          {data.issues.length === 0 ? (
            <div className="text-center py-16" style={{ color: '#22c55e' }}><Check size={28} className="mx-auto mb-2" /><p className="text-sm">{ar ? 'لا توجد مشاكل مكتشفة 🎉' : 'No issues detected 🎉'}</p></div>
          ) : (
            <div className="space-y-2">
              {data.issues.map((i, n) => {
                const sv = SEV[i.severity];
                return (
                  <div key={n} className="flex items-start gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${sv.color}22` }}>
                    <sv.Icon size={15} style={{ color: sv.color, flexShrink: 0, marginTop: 1 }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold" style={{ color: tp(dark) }}>{i.title}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: '#64748b' }}>{i.source} · {i.area}</span>
                      </div>
                      <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>{i.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
