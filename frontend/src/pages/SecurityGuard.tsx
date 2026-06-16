import { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  KeyRound, UserCog, ScrollText, ChevronDown,
} from 'lucide-react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { tp, ts as tsColor, useInjectDsStyles, scoreColor } from '@/components/ds';

type Status = 'pass' | 'warn' | 'fail' | 'skip';
interface Check { id: string; category: 'accounts' | 'access' | 'audit'; label: string; labelAr: string; status: Status; count: number; detail: string; sample?: any[] }
interface Report { generatedAt: string; score: number; status: Status; counts: { pass: number; warn: number; fail: number; skip: number }; checks: Check[] }

const STAT = {
  pass: { color: '#22c55e', Icon: CheckCircle2, ar: 'سليم', en: 'Pass' },
  warn: { color: '#f59e0b', Icon: AlertTriangle, ar: 'تنبيه', en: 'Warn' },
  fail: { color: '#ef4444', Icon: XCircle, ar: 'خطر', en: 'Fail' },
  skip: { color: '#64748b', Icon: MinusCircle, ar: 'تخطّي', en: 'Skip' },
} as const;

export default function SecurityGuardPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  useInjectDsStyles();

  const [data, setData] = useState<Report | null>(null);
  const [loading, setL] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setL(true);
    try { const { data } = await apiClient.get<Report>('/security-guard'); setData(data); } catch { setData(null); }
    setL(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups: { key: 'accounts' | 'access' | 'audit'; Icon: any; ar: string; en: string }[] = [
    { key: 'accounts', Icon: KeyRound, ar: 'الحسابات وتسجيل الدخول', en: 'Accounts & login' },
    { key: 'access', Icon: UserCog, ar: 'الصلاحيات والوصول', en: 'Privileges & access' },
    { key: 'audit', Icon: ScrollText, ar: 'سجلّ التدقيق', en: 'Audit trail' },
  ];

  return (
    <div className="p-6 min-h-full" dir={ar ? 'rtl' : 'ltr'} style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.22)' }}>
            <ShieldAlert size={18} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: tp(dark) }}>{ar ? 'الحارس الأمني' : 'Security Guard'}</h1>
            <p className="text-xs" style={{ color: tsColor(dark) }}>{ar ? 'مراقبة دائمة: الحسابات · الصلاحيات · سحب الوصول · سجلّ التدقيق' : 'Continuous watch: accounts · privileges · access revocation · audit trail'}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{ar ? 'إعادة الفحص' : 'Re-run'}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin" style={{ color: '#475569' }} /></div>
      ) : !data ? (
        <div className="text-center py-20" style={{ color: '#475569' }}><ShieldAlert size={32} className="mx-auto mb-3" style={{ color: '#334155' }} /><p className="text-sm">{ar ? 'تعذّر تشغيل الفحوصات' : 'Could not run checks'}</p></div>
      ) : (
        <div className="space-y-5">
          {/* Score */}
          <div className="flex items-center gap-4 flex-wrap rounded-2xl px-5 py-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-3">
              <div className="relative w-16 h-16 rounded-full flex items-center justify-center" style={{ background: `conic-gradient(${scoreColor(data.score)} ${data.score * 3.6}deg, rgba(255,255,255,0.06) 0deg)` }}>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#0b0f1c' }}>
                  <span className="text-base font-bold tabular-nums" style={{ color: scoreColor(data.score) }}>{data.score}</span>
                </div>
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? 'درجة الأمان' : 'Security score'}</p>
                <p className="text-[11px]" style={{ color: '#64748b' }}>{new Date(data.generatedAt).toLocaleString(ar ? 'ar' : 'en')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap ms-auto">
              {(['pass', 'warn', 'fail', 'skip'] as Status[]).map(s => {
                const { color, Icon, ar: la, en } = STAT[s];
                return <span key={s} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-semibold" style={{ background: `${color}14`, color }}><Icon size={13} /> {data.counts[s]} {ar ? la : en}</span>;
              })}
            </div>
          </div>

          {groups.map(g => {
            const items = data.checks.filter(c => c.category === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <div className="flex items-center gap-2 mb-2"><g.Icon size={15} style={{ color: '#f87171' }} /><h2 className="text-sm font-bold" style={{ color: tp(dark) }}>{ar ? g.ar : g.en}</h2></div>
                <div className="space-y-2">
                  {items.map(c => {
                    const { color, Icon } = STAT[c.status];
                    const hasSample = !!c.sample?.length;
                    const isOpen = open[c.id];
                    return (
                      <div key={c.id} className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${color}22` }}>
                        <button onClick={() => hasSample && setOpen(o => ({ ...o, [c.id]: !o[c.id] }))} className="w-full flex items-center gap-3 px-4 py-3 text-start" style={{ cursor: hasSample ? 'pointer' : 'default' }}>
                          <Icon size={16} style={{ color, flexShrink: 0 }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold" style={{ color: tp(dark) }}>{ar ? c.labelAr : c.label}</p>
                            <p className="text-[11px]" style={{ color: '#64748b' }}>{c.detail}</p>
                          </div>
                          {c.count > 0 && <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg" style={{ background: `${color}1a`, color }}>{c.count}</span>}
                          {hasSample && <ChevronDown size={14} style={{ color: '#475569', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />}
                        </button>
                        {hasSample && isOpen && (
                          <div className="px-4 pb-3 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <table className="w-full text-[11px]">
                              <tbody>
                                {c.sample!.map((row, i) => (
                                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                    {Object.values(row).map((v, j) => <td key={j} className="px-2 py-1" style={{ color: j === 0 ? '#cbd5e1' : '#94a3b8', whiteSpace: 'nowrap' }}>{String(v)}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
