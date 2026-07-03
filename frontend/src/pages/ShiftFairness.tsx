import { useEffect, useState, useCallback, useMemo } from 'react';
import { Scale, CalendarDays, Moon, Users, TrendingDown, TrendingUp, CalendarOff, Sparkles, Lock, Download } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import { StatTile, BarRow } from '@/components/dazzle';

/** Shift Fairness — night/midnight load + weekend-OFF fairness over the uploaded roster
 *  (roster_days, deduped). Optional dedicated NIGHT TEAM carve-out (the user's choice) and
 *  a forward rebalance proposal (current staff only, female-midnight aware). Theme-aware. */
export default function ShiftFairnessPage() {
  const { lang } = useUiStore(); const ar = lang === 'ar';
  const [f, setF] = useState({ from: '', to: '', function: '' });
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'load' | 'team' | 'proposal' | 'weekend' | 'off' | 'justice' | 'stuck'>('load');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiClient.get(`/attendance-recon/roster-v2/fairness?${qs}`).then((r: any) => setD(r.data)).catch(() => setD(null)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const toggleTeam = async (a: any) => {
    setBusy(a.personNo);
    try { await apiClient.put('/attendance-recon/roster-v2/fairness/night-team', { personNo: a.personNo, name: a.name, member: !a.nightTeam }); await load(); }
    finally { setBusy(''); }
  };

  const exportXlsx = () => {
    const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) qs.set(k, v); });
    apiClient.get(`/attendance-recon/roster-v2/fairness/export?${qs}`, { responseType: 'blob' }).then((r: any) => {
      const url = URL.createObjectURL(new Blob([r.data])); const a = document.createElement('a');
      a.href = url; a.download = `Shift_Fairness_${f.from || 'all'}_${f.to || 'all'}.xlsx`; a.click(); URL.revokeObjectURL(url);
    });
  };

  const s = d?.summary;
  const h = ar ? 'س' : 'h';
  const panel = { background: 'var(--surface)', border: '1px solid var(--border)' } as React.CSSProperties;
  const inputStyle = { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' } as React.CSSProperties;
  const fnOptions = useMemo(() => Array.from(new Set((d?.agents || []).map((a: any) => a.fn).filter(Boolean))).sort(), [d]);

  // night/mid load rows: night team first (flagged), then fair pool by load desc
  const loadRows = useMemo(() => {
    const ag = (d?.agents || []).slice();
    return ag.sort((a: any, b: any) => (Number(b.nightTeam) - Number(a.nightTeam)) || (b.nightMidPct - a.nightMidPct));
  }, [d]);
  const maxNm = 100;

  const scoreColor = (v: number) => v >= 80 ? '#22c55e' : v >= 60 ? '#f59e0b' : '#ef4444';
  const tabBtn = (k: any, label: string) => (
    <button onClick={() => setTab(k)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
      style={tab === k ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', boxShadow: '0 4px 14px rgba(99,102,241,0.35)' } : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}>{label}</button>
  );

  return (
    <div className="space-y-4 page-enter">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 6px 18px rgba(99,102,241,0.35)' }}><Scale size={20} className="text-white" /></div>
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'عدالة الشفتات' : 'Shift Fairness'}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{ar ? 'توزيع النايت/الميدنايت وعدالة الأوفات على الروستر المعتمد — مع فريق ليلي اختياري واقتراح تدوير عادل' : 'night/midnight load + weekend-OFF fairness over the approved roster — optional night team + fair rebalance proposal'}</p>
        </div>
        <div className="flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}><CalendarDays size={14} />
          <input type="date" value={f.from} onChange={e => set('from', e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle} /><span className="text-xs">→</span>
          <input type="date" value={f.to} onChange={e => set('to', e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle} /></div>
        <select value={f.function} onChange={e => set('function', e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs outline-none" style={inputStyle}>
          <option value="">{ar ? 'كل الفنكشن' : 'All functions'}</option>{fnOptions.map((x: any) => <option key={x} value={x}>{x}</option>)}</select>
        <button onClick={exportXlsx} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 4px 14px rgba(16,185,129,0.35)' }}><Download size={13} />{ar ? 'إكسل' : 'Excel'}</button>
      </div>

      {loading && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>{ar ? 'جارٍ حساب العدالة…' : 'Computing fairness…'}</p>}
      {!loading && s && (<>
        {/* summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <StatTile icon={Scale} label={ar ? 'سكور العدالة' : 'Fairness score'} num={s.fairnessScore} suffix="" sub={ar ? 'البول العادل (أعلى=أعدل)' : 'fair pool (higher=fairer)'} color={scoreColor(s.fairnessScore)} delay={0} />
          <StatTile icon={Moon} label={ar ? 'متوسط نايت/ميدنايت' : 'Avg night/mid'} num={s.fairPoolAvgNightMidPct} suffix="%" sub={`±${s.nightMidStdev} ${ar ? 'انحراف' : 'stdev'}`} color="#8b5cf6" delay={60} />
          <StatTile icon={Moon} label={ar ? 'الفريق الليلي' : 'Night team'} num={s.nightTeamCount} sub={ar ? 'مخصّصون (اختيارك)' : 'dedicated (your choice)'} color="#0ea5e9" delay={120} />
          <StatTile icon={Users} label={ar ? 'البول العادل' : 'Fair pool'} num={s.fairPoolCount} sub={ar ? 'يخضعون للتدوير' : 'rotated fairly'} color="#6366f1" delay={180} />
          <StatTile icon={CalendarOff} label={ar ? 'عدالة الويك-إند أوف' : 'Weekend-OFF fairness'} num={s.weekendFairnessScore} sub={`${s.weekendOffMin}–${s.weekendOffMax} ${ar ? 'مدى' : 'range'}`} color={scoreColor(s.weekendFairnessScore)} delay={240} />
          <StatTile icon={CalendarDays} label={ar ? 'متوسط ويك-إند أوف' : 'Avg weekend-OFF'} num={s.weekendOffAvg} sub={ar ? 'لكل موظف' : 'per agent'} color="#22c55e" delay={300} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {tabBtn('load', ar ? 'خريطة الشفتات' : 'Shift mix heatmap')}
          {tabBtn('off', ar ? 'توزيع الأوفات (عادي/ويك-إند)' : 'OFF distribution (weekday/weekend)')}
          {tabBtn('justice', ar ? 'مين يستاهل تعويض' : 'Who deserves relief')}
          {tabBtn('stuck', ar ? 'عالقون على شفت' : 'Stuck on one shift')}
          {tabBtn('proposal', ar ? 'اقتراح التدوير العادل' : 'Fair rebalance proposal')}
          {tabBtn('weekend', ar ? 'عدالة الويك-إند أوف' : 'Weekend-OFF fairness')}
          {tabBtn('team', ar ? 'الفريق الليلي' : 'Night team')}
        </div>

        {/* Night/midnight load — shift-MIX heatmap per agent (morning/evening/night/midnight),
            night team flagged + toggle, 🔒 = stuck ≥80% on one shift (never rotates). */}
        {tab === 'load' && (
          <div className="rounded-2xl p-4" style={panel}>
            <p className="text-[11px] mb-1" style={{ color: 'var(--text-2)' }}>{ar ? 'خريطة خلطة الشفتات لكل موظف (صباحي/مسائي/نايت/ميدنايت كنسبة من أيام عمله). 🌙 = فريق ليلي (اضغط للتثبيت/الإلغاء) · 🔒 = عالق ≥80% على شفت واحد (ما بيتدوّر).' : 'shift-mix heatmap per agent (morning/evening/night/midnight as % of working days). 🌙 = night team (click to toggle) · 🔒 = stuck ≥80% on one shift (never rotates).'}</p>
            <div className="flex items-center gap-3 mb-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
              {[[ar ? 'صباحي' : 'Morning', '#38bdf8'], [ar ? 'مسائي' : 'Evening', '#fb923c'], [ar ? 'نايت' : 'Night', '#a78bfa'], [ar ? 'ميدنايت' : 'Midnight', '#ef4444']].map(([l, c]: any) => (
                <span key={l} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: c }} />{l}</span>
              ))}
            </div>
            <div className="space-y-1.5 max-h-[520px] overflow-auto pr-1">
              {loadRows.map((a: any) => {
                const stuck = a.dominantPct >= 80 && !a.nightTeam;
                return (
                  <div key={a.personNo} className="flex items-center gap-2" style={{ opacity: a.currentlyActive ? 1 : 0.5 }}>
                    <button onClick={() => toggleTeam(a)} disabled={busy === a.personNo} title={ar ? 'تثبيت/إلغاء كفريق ليلي' : 'toggle night team'}
                      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: a.nightTeam ? 'rgba(14,165,233,0.18)' : 'var(--surface-2)', border: `1px solid ${a.nightTeam ? '#0ea5e9' : 'var(--border)'}` }}>
                      <Moon size={12} style={{ color: a.nightTeam ? '#0ea5e9' : 'var(--text-3)' }} />
                    </button>
                    <span className="w-36 truncate text-[12px] flex items-center gap-1" style={{ color: 'var(--text-1)' }}>
                      {stuck && <span title={ar ? `عالق ${a.dominantPct}% على ${a.dominantCat}` : `stuck ${a.dominantPct}% on ${a.dominantCat}`}>🔒</span>}
                      {a.name}{!a.currentlyActive && <span style={{ color: 'var(--text-3)' }}> ·{ar ? 'سابق' : 'ex'}</span>}
                    </span>
                    <span className="w-24 truncate text-[10px]" style={{ color: 'var(--text-3)' }}>{a.fn}</span>
                    <div className="flex-1 h-3.5 rounded-full overflow-hidden flex" style={{ background: 'var(--surface-2)' }}
                      title={`${ar ? 'صباحي' : 'M'} ${a.morningPct}% · ${ar ? 'مسائي' : 'E'} ${a.eveningPct}% · ${ar ? 'نايت' : 'N'} ${a.nightPct}% · ${ar ? 'ميدنايت' : 'MD'} ${a.midOnlyPct}%`}>
                      <div style={{ width: `${a.morningPct}%`, background: '#38bdf8' }} />
                      <div style={{ width: `${a.eveningPct}%`, background: '#fb923c' }} />
                      <div style={{ width: `${a.nightPct}%`, background: '#a78bfa' }} />
                      <div style={{ width: `${a.midOnlyPct}%`, background: '#ef4444' }} />
                    </div>
                    <span className="w-16 text-end text-[10px] font-semibold" style={{ color: a.nightMidPct >= 60 ? '#ef4444' : a.nightMidPct >= 35 ? '#f59e0b' : 'var(--text-3)' }}>{a.nightMidPct}% {ar ? 'ل/م' : 'n/m'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stuck on one shift — rotation health */}
        {tab === 'stuck' && (
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-1"><Lock size={15} style={{ color: '#f59e0b' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'عالقون على شفت واحد (ما بيتدوّروا)' : 'Stuck on one shift (rarely rotate)'}</h3></div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? '≥80% من أيام عملهم على نفس نوع الشفت — مرشحون للتدوير (البول العادل، حاليين). الفريق الليلي مستثنى.' : '≥80% of working days on the same shift type — candidates to rotate (fair pool, current). Night team excluded.'}</p>
            {(d.stuckOnOneShift || []).length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'الكل بيتدوّر بشكل جيد 🎉' : 'everyone rotates well 🎉'}</p>}
            <div className="grid sm:grid-cols-2 gap-2">
              {(d.stuckOnOneShift || []).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-xl text-[11px]" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <Lock size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
                  <span className="flex-1 truncate" style={{ color: 'var(--text-1)' }}>{a.name} <span style={{ color: 'var(--text-3)' }}>· {a.fn}</span></span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>{a.dominantPct}% {a.dominantCat}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rebalance proposal */}
        {tab === 'proposal' && (
          <div className="space-y-3">
          {/* THE PLAN — concrete paired moves (apply proposal) */}
          <div className="rounded-2xl p-4 glow-border-soft" style={{ background: 'var(--surface)', border: '1px solid #6366f1' }}>
            <div className="flex items-center gap-2 mb-1"><Sparkles size={16} style={{ color: '#818cf8' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? '✦ الخطة المقترحة — طبّق التوازن' : '✦ Suggested plan — apply rebalance'}</h3></div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'مزاوجة جاهزة: انقل نايت/ميدنايت من المُحمَّل زيادة ← للناقص (البنات نايت فقط)، وأعطِ ويك-إند أوف للمحرومين. اقتراح — التطبيق النهائي بالجدول.' : 'ready pairings: move night/mid from the over-loaded → the under-loaded (females night-only), and give weekend-OFF to the deprived. A proposal — final apply lands in the schedule.'}</p>
            {(d.rebalancePlan?.nightMoves || []).length === 0 && (d.rebalancePlan?.weekendMoves || []).length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'متوازن 🎉 — ما في نقل مقترح' : 'balanced 🎉 — no moves needed'}</p>}
            {(d.rebalancePlan?.nightMoves || []).length > 0 && <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-2)' }}>{ar ? 'تدوير النايت/ميدنايت' : 'Night/midnight rotation'}</div>}
            <div className="space-y-1.5 mb-3">{(d.rebalancePlan?.nightMoves || []).map((m: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                <span className="px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>{m.fromName} ({m.fromPct}%)</span>
                <span style={{ color: 'var(--text-3)' }}>→ ~{m.shifts} {ar ? 'شفت' : 'shifts'} →</span>
                <span className="px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>{m.toName} ({m.toPct}%)</span>
                <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: m.take === 'night-only' ? 'rgba(236,72,153,0.12)' : 'rgba(14,165,233,0.12)', color: m.take === 'night-only' ? '#ec4899' : '#0ea5e9' }}>{m.take === 'night-only' ? (ar ? 'نايت فقط' : 'night-only') : (ar ? 'نايت/ميدنايت' : 'night/mid')}</span>
              </div>
            ))}</div>
            {(d.rebalancePlan?.weekendMoves || []).length > 0 && <div className="text-[10px] font-bold mb-1" style={{ color: 'var(--text-2)' }}>{ar ? 'عدالة الويك-إند أوف' : 'Weekend-OFF fairness'}</div>}
            <div className="space-y-1.5">{(d.rebalancePlan?.weekendMoves || []).map((m: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                <span style={{ color: 'var(--text-3)' }}>{ar ? 'أعطِ ويك-إند أوف لـ' : 'give weekend-OFF to'}</span>
                <span className="px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>{m.giveName} ({m.giveShare}%)</span>
                <span style={{ color: 'var(--text-3)' }}>←</span>
                <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>{m.fromName} ({m.fromShare}%)</span>
              </div>
            ))}</div>
          </div>
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="rounded-2xl p-4" style={panel}>
              <div className="flex items-center gap-2 mb-1"><TrendingDown size={15} style={{ color: '#ef4444' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'خفّف عنهم النايت (فوق المتوسط)' : 'Reduce nights (above pool avg)'}</h3></div>
              <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? `متوسط البول العادل ${d.proposal.poolAvgNightMidPct}%` : `fair-pool avg ${d.proposal.poolAvgNightMidPct}%`}</p>
              {d.proposal.reduceNights.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'متوازن — لا أحد فوق المتوسط بفارق كبير' : 'balanced — nobody far above average'}</p>}
              <div className="space-y-1.5">{d.proposal.reduceNights.map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[11px]"><span className="flex-1 truncate" style={{ color: 'var(--text-1)' }}>{r.name} <span style={{ color: 'var(--text-3)' }}>· {r.fn}</span></span>
                  <span style={{ color: '#ef4444' }}>{r.nightMidPct}%</span><span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>+{r.over}</span></div>
              ))}</div>
            </div>
            <div className="rounded-2xl p-4" style={panel}>
              <div className="flex items-center gap-2 mb-1"><TrendingUp size={15} style={{ color: '#22c55e' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'يقدروا ياخدوا نايت أكثر (تحت المتوسط)' : 'Can take more nights (below avg)'}</h3></div>
              <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'البنات: نايت فقط (مش ميدنايت)' : 'females: night only (no midnight)'}</p>
              {d.proposal.addNights.length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'لا يوجد ناقصين بفارق كبير' : 'nobody far below average'}</p>}
              <div className="space-y-1.5">{d.proposal.addNights.map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[11px]"><span className="flex-1 truncate" style={{ color: 'var(--text-1)' }}>{r.name} <span style={{ color: 'var(--text-3)' }}>· {r.fn}</span></span>
                  {!r.canMidnight && <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(236,72,153,0.12)', color: '#ec4899' }}>{ar ? 'نايت فقط' : 'night only'}</span>}
                  <span style={{ color: '#22c55e' }}>{r.nightMidPct}%</span><span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>−{r.under}</span></div>
              ))}</div>
            </div>
          </div>
          </div>
        )}

        {/* OFF distribution — weekday vs weekend split per person */}
        {tab === 'off' && (
          <div className="rounded-2xl p-4" style={panel}>
            <p className="text-[11px] mb-1" style={{ color: 'var(--text-2)' }}>{ar ? `من كل أوفات الموظف: كم نسبتها أيام عادية (رمادي) وكم ويك-إند خميس/جمعة (أخضر). "حصة الويك-إند" = كم % من إجمالي عطل نهاية الأسبوع بالفترة (${s.totalWeekendDays} يوم) أخذها أوف.` : `of each agent's OFF days: how many fall on weekdays (grey) vs weekend Thu/Fri (green). "weekend share" = % of all ${s.totalWeekendDays} weekend days in the period they got off.`}</p>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? `متوسط حصة الويك-إند بالبول العادل: ${s.weekendShareAvg}% — مرتّبين من الأقل حظاً` : `fair-pool avg weekend share: ${s.weekendShareAvg}% — sorted least-lucky first`}</p>
            <div className="space-y-1.5 max-h-[520px] overflow-auto pr-1">
              {(d.offDistribution || []).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="w-40 truncate" style={{ color: 'var(--text-1)' }}>{a.name}{a.nightTeam && <span style={{ color: '#0ea5e9' }}> 🌙</span>}</span>
                  <span className="w-24 truncate text-[10px]" style={{ color: 'var(--text-3)' }}>{a.fn}</span>
                  <div className="flex-1 h-3.5 rounded-full overflow-hidden flex" style={{ background: 'var(--surface-2)' }} title={ar ? `${a.weekdayOff} عادي · ${a.weekendOff} ويك-إند` : `${a.weekdayOff} weekday · ${a.weekendOff} weekend`}>
                    <div style={{ width: `${a.weekdayOffPct}%`, background: 'var(--text-3)', opacity: 0.5 }} />
                    <div style={{ width: `${a.weekendOffPct}%`, background: 'linear-gradient(90deg,#16a34a,#22c55e)' }} />
                  </div>
                  <span className="w-12 text-end" style={{ color: 'var(--text-3)' }}>{a.weekdayOffPct}%<span className="text-[8px]"> {ar ? 'عادي' : 'wd'}</span></span>
                  <span className="w-12 text-end font-semibold" style={{ color: '#22c55e' }}>{a.weekendOffPct}%</span>
                  <span className="w-14 text-end font-bold" style={{ color: a.weekendOffShare >= s.weekendShareAvg ? '#22c55e' : '#f59e0b' }} title={ar ? 'حصة من كل الويك-إندات' : 'share of all weekends'}>{a.weekendOffShare}%</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2.5 flex items-center gap-4 text-[10px]" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-3)' }}>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'var(--text-3)', opacity: 0.5 }} />{ar ? 'أوف يوم عادي' : 'weekday OFF'}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: '#22c55e' }} />{ar ? 'أوف ويك-إند' : 'weekend OFF'}</span>
              <span className="ms-auto">{ar ? 'العمود الأخير = حصة الموظف من إجمالي الويك-إندات (أخضر=عادل أو أعلى، برتقالي=أقل من المتوسط)' : 'last column = share of all weekends (green=fair+, orange=below avg)'}</span>
            </div>
          </div>
        )}

        {/* Justice index — who deserves relief next */}
        {tab === 'justice' && (
          <div className="rounded-2xl p-4 glow-border-soft" style={panel}>
            <div className="flex items-center gap-2 mb-1"><Sparkles size={15} style={{ color: '#a78bfa' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'مين يستاهل تعويض بالجدول الجاي' : 'Who the next schedule should compensate'}</h3></div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'مؤشّر الظلم = (نايت/ميدنايت فوق متوسط البول) + (حصة ويك-إند أوف تحت المتوسط). الأعلى = الأولى بالتخفيف وإعطاء ويك-إند أوف. (البول العادل، حاليين فقط)' : 'debt = (night/mid above pool avg) + (weekend-OFF share below avg). Higher = relieve & give weekend OFF first. (fair pool, current staff)'}</p>
            {(d.justice || []).length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'الوضع متوازن — لا أحد متظلّم بشكل واضح 🎉' : 'balanced — nobody is clearly under-treated 🎉'}</p>}
            <div className="space-y-1.5">
              {(d.justice || []).map((a: any, i: number) => {
                const max = d.justice[0]?.debt || 1;
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="w-5 text-center font-bold" style={{ color: i < 3 ? '#ef4444' : 'var(--text-3)' }}>{i + 1}</span>
                    <span className="w-40 truncate" style={{ color: 'var(--text-1)' }}>{a.name}</span>
                    <span className="w-24 truncate text-[10px]" style={{ color: 'var(--text-3)' }}>{a.fn}</span>
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div style={{ width: `${Math.round(100 * a.debt / max)}%`, height: '100%', background: 'linear-gradient(90deg,#f59e0b,#ef4444)' }} />
                    </div>
                    <span className="w-20 text-end text-[10px]" style={{ color: '#fb923c' }}>{a.nightMidPct}% {ar ? 'نايت' : 'night'}</span>
                    <span className="w-20 text-end text-[10px]" style={{ color: '#22c55e' }}>{a.weekendOffShare}% {ar ? 'ويك-إند' : 'wknd'}</span>
                    <span className="w-10 text-end font-bold" style={{ color: '#ef4444' }}>{a.debt}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Weekend-OFF fairness */}
        {tab === 'weekend' && (
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-1"><CalendarOff size={15} style={{ color: '#f59e0b' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'الأقل حظاً بالويك-إند أوف (الخميس/الجمعة)' : 'Fewest weekend (Thu/Fri) OFFs'}</h3></div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'موظفون نادراً ياخدوا أوف بالويك-إند — مرشحون لتوزيع أعدل' : 'agents who rarely get a weekend OFF — candidates for a fairer share'}</p>
            <div className="space-y-1.5">{(d.proposal.weekendOffDeprived || []).map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[11px]"><span className="flex-1 truncate" style={{ color: 'var(--text-1)' }}>{r.name} <span style={{ color: 'var(--text-3)' }}>· {r.fn}</span></span>
                <span style={{ color: 'var(--text-2)' }}>{r.off} {ar ? 'أوف' : 'OFF'}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>{r.weekendOff} {ar ? 'ويك-إند' : 'wknd'}</span></div>
            ))}</div>
          </div>
        )}

        {/* Night team */}
        {tab === 'team' && (
          <div className="rounded-2xl p-4" style={panel}>
            <div className="flex items-center gap-2 mb-1"><Moon size={15} style={{ color: '#0ea5e9' }} /><h3 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{ar ? 'الفريق الليلي المخصّص' : 'Dedicated night team'}</h3></div>
            <p className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{ar ? 'مستثنون من سكور العدالة (متوقّع منهم النايت). اضغط لإخراج أي واحد للبول العادل.' : 'excluded from the fairness score (expected to carry nights). Click to move anyone back to the fair pool.'}</p>
            {loadRows.filter((a: any) => a.nightTeam).length === 0 && <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{ar ? 'ما في فريق ليلي — الكل بالبول العادل' : 'no night team — everyone is in the fair pool'}</p>}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {loadRows.filter((a: any) => a.nightTeam).map((a: any) => (
                <div key={a.personNo} className="flex items-center gap-2 p-2 rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <Moon size={13} style={{ color: '#0ea5e9' }} />
                  <span className="flex-1 truncate text-[12px]" style={{ color: 'var(--text-1)' }}>{a.name} <span style={{ color: 'var(--text-3)' }}>· {a.nightMidPct}%</span></span>
                  <button onClick={() => toggleTeam(a)} disabled={busy === a.personNo} className="text-[10px] px-2 py-0.5 rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}>{ar ? 'للبول' : 'to pool'}</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{ar ? 'المصدر: الجدول المعتمد (roster_days)، بدون تكرار (هوية canonical). سكور العدالة محسوب على البول العادل (بدون الفريق الليلي). اقتراح التدوير للموظفين الحاليين فقط ويحترم منع البنات من الميدنايت.' : 'Source: approved schedule (roster_days), deduped (canonical identity). Fairness score is over the fair pool (excluding the night team). The rebalance proposal covers current staff only and respects the female-no-midnight rule.'}</p>
      </>)}
      {!loading && !s && <p className="text-sm py-8 text-center" style={{ color: '#f43f5e' }}>{ar ? 'تعذّر التحميل' : 'Failed to load'}</p>}
    </div>
  );
}
