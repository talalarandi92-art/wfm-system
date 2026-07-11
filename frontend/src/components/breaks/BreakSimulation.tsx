import { useState } from 'react';
import { useUiStore } from '@/store/ui.store';
import { apiClient } from '@/api/client';
import { card as cardStyle, tp, ts } from '@/components/ds';
import { AlertTriangle, FlaskConical, Loader2, Play, Users } from 'lucide-react';

/**
 * B5 §28 — what-if simulation tab: scenario controls → POST /breaks/simulate
 * (a DRY-RUN of the real optimizer + risk engine, never persisted). Everything
 * is badged "SIMULATION — not applied".
 */

const RISK_COLOR: Record<string, string> = {
  green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444', critical: '#991b1b',
};

interface SimResult {
  simulation: true; applied: false; date: string;
  scenario: { absencePct: number; queueSpike: string; extraStaff: number; mode: string | null };
  plan: {
    slotCount: number; employeesPlanned: number; onShiftAfterAbsence: number | null;
    absentCount: number; absentEmployees: { employee_name: string; function_name: string }[];
    keptSlots: number; coverageSource: string; warnings: string[];
    slotsByHour: { hour: number; count: number }[];
    slotsByFunction: Record<string, number>;
  };
  riskTimeline: Record<string, { hour: number; level: string; required: number; scheduled: number; onBreak: number }[]>;
  projectedDelayed: number;
  atRiskEmployees: string[];
  comparison: {
    current: { slotCount: number; employees: number; slotsByHour: { hour: number; count: number }[] };
    simulated: { slotCount: number; employees: number; slotsByHour: { hour: number; count: number }[] };
    deltaSlots: number;
  };
}

export default function BreakSimulation({ date }: { date: string }) {
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';

  const [absencePct, setAbsencePct] = useState(10);
  const [queueSpike, setQueueSpike] = useState<'none' | 'moderate' | 'severe'>('none');
  const [extraStaff, setExtraStaff] = useState(0);
  const [mode, setMode] = useState('');
  const [fn, setFn] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<SimResult | null>(null);

  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const inputStyle: React.CSSProperties = {
    background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
    border: `1px solid ${border}`, color: tp(dark), borderRadius: 10,
    padding: '7px 12px', fontSize: 12, outline: 'none',
  };

  const run = async () => {
    setRunning(true); setError('');
    try {
      const { data } = await apiClient.post('/breaks/simulate', {
        date,
        function: fn.trim() || undefined,
        scenario: {
          absencePct,
          queueSpike,
          extraStaff,
          ...(mode ? { mode } : {}),
        },
      });
      setRes(data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (ar ? 'فشلت المحاكاة' : 'Simulation failed'));
    } finally { setRunning(false); }
  };

  const SimBadge = () => (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: 'rgba(168,85,247,0.14)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.35)', letterSpacing: '0.04em' }}>
      🧪 {ar ? 'محاكاة — غير مطبّقة' : 'SIMULATION — not applied'}
    </span>
  );

  const hourMax = res ? Math.max(1,
    ...res.comparison.current.slotsByHour.map(h => h.count),
    ...res.comparison.simulated.slotsByHour.map(h => h.count)) : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Scenario controls */}
      <div style={{ ...cardStyle(dark), padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlaskConical size={15} style={{ color: '#c084fc' }} />
            <h3 style={{ fontSize: 13, fontWeight: 700, color: tp(dark) }}>{ar ? `سيناريو ماذا-لو — ${date}` : `What-if scenario — ${date}`}</h3>
          </div>
          <SimBadge />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 10.5, color: ts(dark), display: 'block', marginBottom: 4 }}>{ar ? 'نسبة الغياب %' : 'Absence %'}</label>
            <input type="number" min={0} max={100} value={absencePct} onChange={e => setAbsencePct(Math.max(0, Math.min(100, +e.target.value || 0)))} style={{ ...inputStyle, width: 80 }} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, color: ts(dark), display: 'block', marginBottom: 4 }}>{ar ? 'ضغط الطوابير' : 'Queue Spike'}</label>
            <select value={queueSpike} onChange={e => setQueueSpike(e.target.value as any)} style={{ ...inputStyle, width: 130 }}>
              <option value="none">{ar ? 'بدون' : 'None'}</option>
              <option value="moderate">{ar ? 'متوسط' : 'Moderate'}</option>
              <option value="severe">{ar ? 'شديد' : 'Severe'}</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10.5, color: ts(dark), display: 'block', marginBottom: 4 }}>{ar ? 'موظفون إضافيون' : 'Extra Staff'}</label>
            <input type="number" min={0} max={100} value={extraStaff} onChange={e => setExtraStaff(Math.max(0, +e.target.value || 0))} style={{ ...inputStyle, width: 80 }} />
          </div>
          <div>
            <label style={{ fontSize: 10.5, color: ts(dark), display: 'block', marginBottom: 4 }}>{ar ? 'وضع الإطلاق' : 'Release Mode'}</label>
            <select value={mode} onChange={e => setMode(e.target.value)} style={{ ...inputStyle, width: 130 }}>
              <option value="">{ar ? '(بدون تغيير)' : '(unchanged)'}</option>
              <option value="auto">Auto</option>
              <option value="supervisor">Supervisor</option>
              <option value="hybrid">Hybrid</option>
              <option value="freeze">Freeze</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10.5, color: ts(dark), display: 'block', marginBottom: 4 }}>{ar ? 'الوظيفة (اختياري)' : 'Function (optional)'}</label>
            <input value={fn} onChange={e => setFn(e.target.value)} placeholder={ar ? 'الكل' : 'All'} style={{ ...inputStyle, width: 150 }} />
          </div>
          <button onClick={run} disabled={running}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg,#7c3aed,#c026d3)', opacity: running ? 0.6 : 1 }}>
            {running ? <Loader2 size={13} style={{ animation: 'ds-spin 1s linear infinite' }} /> : <Play size={13} />}
            {ar ? 'تشغيل المحاكاة' : 'Run Simulation'}
          </button>
        </div>
        <p style={{ fontSize: 10, color: ts(dark), marginTop: 8 }}>
          {ar
            ? 'الغياب يُختار حتمياً حسب هوية الموظف (نفس السيناريو = نفس النتيجة). لا يُكتب أي شيء في قاعدة البيانات.'
            : 'Absence is picked deterministically by employee hash (same scenario = same result). Nothing is written to the database.'}
        </p>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: 12 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {res && (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {[
              { label: ar ? 'بريكات المحاكاة' : 'Simulated Slots', value: res.plan.slotCount, color: '#c084fc' },
              { label: ar ? 'موظفون مخططون' : 'Employees Planned', value: res.plan.employeesPlanned, color: '#818cf8' },
              { label: ar ? 'غائبون (سيناريو)' : 'Absent (scenario)', value: res.plan.absentCount, color: '#f87171' },
              { label: ar ? 'تأخير متوقع' : 'Projected Delayed', value: res.projectedDelayed, color: '#f97316' },
              { label: ar ? 'مهددون بفقد الرصيد' : 'At Risk of Missing Break', value: res.atRiskEmployees.length, color: '#ef4444' },
              { label: ar ? 'فرق البريكات' : 'Δ Slots vs Current', value: `${res.comparison.deltaSlots >= 0 ? '+' : ''}${res.comparison.deltaSlots}`, color: res.comparison.deltaSlots >= 0 ? '#4ade80' : '#f87171' },
            ].map(k => (
              <div key={k.label} style={{ ...cardStyle(dark), padding: '12px 14px', position: 'relative' }}>
                <p style={{ fontSize: 10, color: ts(dark) }}>{k.label}</p>
                <p style={{ fontSize: 19, fontWeight: 700, color: k.color }}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Risk timeline per function */}
          <div style={{ ...cardStyle(dark), padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ fontSize: 12.5, fontWeight: 700, color: tp(dark) }}>{ar ? 'خط المخاطر بالساعة (محاكاة)' : 'Hourly Risk Timeline (simulated)'}</h3>
              <SimBadge />
            </div>
            {Object.keys(res.riskTimeline).length === 0 && (
              <p style={{ fontSize: 11, color: ts(dark) }}>{ar ? 'لا توجد بيانات طلب لهذا اليوم' : 'No demand data for this date'}</p>
            )}
            {Object.entries(res.riskTimeline).map(([fnName, hours]) => {
              const byHour = new Map(hours.map(h => [h.hour, h]));
              return (
                <div key={fnName} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: tp(dark), width: 130, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fnName}</span>
                  <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = byHour.get(h);
                      const c = cell ? RISK_COLOR[cell.level] ?? '#64748b' : (dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)');
                      return (
                        <div key={h} title={cell
                          ? `${String(h).padStart(2, '0')}:00 — ${cell.level} (req ${cell.required} / sch ${cell.scheduled} / ${ar ? 'بريك' : 'break'} ${cell.onBreak})`
                          : `${String(h).padStart(2, '0')}:00`}
                          style={{ flex: 1, height: 16, borderRadius: 3, background: c, opacity: cell ? 0.9 : 0.5 }} />
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              {Object.entries(RISK_COLOR).map(([k, c]) => (
                <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: ts(dark) }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{k}
                </span>
              ))}
            </div>
          </div>

          {/* Current vs simulated per-hour histogram */}
          <div style={{ ...cardStyle(dark), padding: 14 }}>
            <h3 style={{ fontSize: 12.5, fontWeight: 700, color: tp(dark), marginBottom: 10 }}>
              {ar ? 'البريكات بالساعة — الحالي مقابل المحاكاة' : 'Slots per Hour — Current vs Simulated'}
            </h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, overflowX: 'auto', padding: '0 4px' }}>
              {Array.from({ length: 24 }, (_, h) => {
                const cur = res.comparison.current.slotsByHour[h]?.count ?? 0;
                const sim = res.comparison.simulated.slotsByHour[h]?.count ?? 0;
                return (
                  <div key={h} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
                      <div title={`${ar ? 'الحالي' : 'Current'}: ${cur}`} style={{ width: 10, minHeight: 2, height: (cur / hourMax) * 88, background: '#64748b99', borderRadius: '2px 2px 0 0' }} />
                      <div title={`${ar ? 'المحاكاة' : 'Simulated'}: ${sim}`} style={{ width: 10, minHeight: 2, height: (sim / hourMax) * 88, background: '#c084fccc', borderRadius: '2px 2px 0 0' }} />
                    </div>
                    <span style={{ fontSize: 9, color: ts(dark) }}>{String(h).padStart(2, '0')}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: ts(dark) }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#64748b99' }} />{ar ? `الحالي (${res.comparison.current.slotCount})` : `Current (${res.comparison.current.slotCount})`}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: ts(dark) }}><span style={{ width: 9, height: 9, borderRadius: 2, background: '#c084fccc' }} />{ar ? `المحاكاة (${res.comparison.simulated.slotCount})` : `Simulated (${res.comparison.simulated.slotCount})`}</span>
              <span style={{ fontSize: 10, color: ts(dark) }}>{ar ? `مصدر التغطية: ${res.plan.coverageSource}` : `Coverage source: ${res.plan.coverageSource}`}</span>
              <span style={{ fontSize: 10, color: ts(dark) }}>{ar ? `بريكات محفوظة (يدوية/نشطة): ${res.plan.keptSlots}` : `Kept slots (manual/active): ${res.plan.keptSlots}`}</span>
            </div>
          </div>

          {/* At-risk + absent lists */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            <div style={{ ...cardStyle(dark), padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <AlertTriangle size={13} style={{ color: '#ef4444' }} />
                <h3 style={{ fontSize: 12, fontWeight: 700, color: tp(dark) }}>{ar ? 'مهددون بفقد رصيد البريك' : 'At Risk of Missing Entitlement'}</h3>
              </div>
              {res.atRiskEmployees.length === 0
                ? <p style={{ fontSize: 11, color: '#4ade80' }}>{ar ? '✓ الجميع حصلوا على بريكاتهم في الخطة' : '✓ Everyone fits their breaks in this plan'}</p>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {res.atRiskEmployees.slice(0, 40).map(n => (
                      <span key={n} style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 14, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>{n}</span>
                    ))}
                  </div>}
            </div>
            <div style={{ ...cardStyle(dark), padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Users size={13} style={{ color: '#f87171' }} />
                <h3 style={{ fontSize: 12, fontWeight: 700, color: tp(dark) }}>{ar ? `غائبون في السيناريو (${res.plan.absentCount})` : `Scenario Absentees (${res.plan.absentCount})`}</h3>
              </div>
              {res.plan.absentEmployees.length === 0
                ? <p style={{ fontSize: 11, color: ts(dark) }}>{ar ? 'لا غياب في هذا السيناريو' : 'No absence in this scenario'}</p>
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 120, overflowY: 'auto' }}>
                    {res.plan.absentEmployees.map((a, i) => (
                      <span key={i} title={a.function_name} style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 14, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', color: ts(dark) }}>{a.employee_name}</span>
                    ))}
                  </div>}
            </div>
          </div>

          {res.plan.warnings.length > 0 && (
            <div style={{ ...cardStyle(dark), padding: 14 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: tp(dark), marginBottom: 8 }}>{ar ? `تحذيرات المولّد (${res.plan.warnings.length})` : `Optimizer Warnings (${res.plan.warnings.length})`}</h3>
              <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {res.plan.warnings.map((w, i) => (
                  <p key={i} style={{ fontSize: 10.5, color: ts(dark) }}>• {w}</p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
