import { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, CalendarX, Timer, Home, HelpCircle, CheckCircle2, Users, Fingerprint, Monitor, Layers, Ban } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';

/**
 *  DATA TRUST — the system showing its own working.
 *
 *  Every other roster surface answers "what happened". This one answers the question a
 *  Director has to answer before any of it reaches HR or payroll: how much of this
 *  should you believe, and exactly where does the confidence run out?
 *
 *  Three deliberate design choices, each earned from something that went wrong:
 *
 *  1. THE HEADLINE IS A RATIO, NOT A TOTAL. "2,968 records" always looks healthy and
 *     says nothing. The number that matters is: of the days we drew a CONCLUSION about,
 *     how many were measured well enough to support it.
 *
 *  2. EVERY QUEUE STATES ITS CONSEQUENCE. A count with no consequence attached is a
 *     number people learn to scroll past. Each card says what the situation means and
 *     what it costs to leave it open — and the ones needing no action say that too,
 *     so the eye lands on the four that do.
 *
 *  3. PEOPLE ARE NAMED. "17 open items" is a statistic. "Aya Wahab, 4 days" is
 *     something a team leader can act on this afternoon.
 *
 *  Colour carries meaning and never carries it alone — every tone is paired with an
 *  icon and a word, so the page survives a projector, a colour-blind reader, and all
 *  three themes.
 */

type Queue = { key: string; days: number; people: number; title?: string; why?: string; action?: string; tone?: string };
type Trust = {
  from: string; to: string; dataThrough: string;
  coverage: { total: number; worked: number; scored: number; strong: number; partial: number; not_scored: number; people: number; trustPct: number | null };
  witnesses: { both: number; system_only: number; punch_only: number; neither: number };
  conformance: { mean: number; mean_strong: number; conforming: number; n: number };
  queues: Queue[];
  people: { name: string; person_no: string; fn: string; tl: string; days: number; conflicts: number; thin: number; displaced: number }[];
  caveats: string[];
};

const ICON: Record<string, any> = {
  schedule_vs_hr: CalendarX, displaced_shift: Timer, thin_evidence: Layers,
  wfh_no_session: Home, odoo_resolved: CheckCircle2, unknown: HelpCircle,
};
/* Tone → the three things a tone must set together. Semantic, never decorative.
   TWO PALETTES, because one does not work. The light-mode values (#b45309, #be123c,
   #047857) are the correct choices on paper and fail outright on the dark surface this
   app defaults to — measured at 2.9:1 against #0e1322 where 4.5 is the floor. A colour
   chosen for meaning still has to be legible in the theme it lands in, so each tone
   carries both and the renderer picks. */
const TONES = (dark: boolean): Record<string, { ring: string; text: string; bg: string; word: string; wordAr: string }> => ({
  amber: {
    ring: 'rgba(245,158,11,.45)', bg: dark ? 'rgba(245,158,11,.14)' : 'rgba(245,158,11,.10)',
    text: dark ? '#fcd34d' : '#b45309', word: 'Needs a decision', wordAr: 'بدها قرار',
  },
  rose: {
    ring: 'rgba(244,63,94,.45)', bg: dark ? 'rgba(244,63,94,.15)' : 'rgba(244,63,94,.10)',
    text: dark ? '#fda4af' : '#be123c', word: 'Unrecoverable', wordAr: 'غير قابل للاسترجاع',
  },
  slate: {
    ring: 'var(--border-strong)', bg: 'var(--surface-2)',
    text: 'var(--text-2)', word: 'Recorded, not scored', wordAr: 'مسجّل وغير مقيَّم',
  },
  emerald: {
    ring: 'rgba(16,185,129,.45)', bg: dark ? 'rgba(16,185,129,.15)' : 'rgba(16,185,129,.10)',
    text: dark ? '#6ee7b7' : '#047857', word: 'Resolved', wordAr: 'محلول',
  },
});

export default function DataTrustPage() {
  const { lang, dark } = useUiStore();
  const ar = lang === 'ar';
  const TONE = TONES(!!dark);
  const [d, setD] = useState<Trust | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /* The drawer is where a count stops being a count. Opening it is the whole point of the
     cards above — every number on this page was chosen because a person can answer it. */
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [qRows, setQRows] = useState<any[] | null>(null);
  const [qBusy, setQBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const loadQueue = (key: string) => {
    setOpenQ(key); setQRows(null); setQBusy(true);
    apiClient.get('/attendance-recon/roster-v2/data-trust/queue?queue=' + key)
      .then((r: any) => setQRows(r.data.rows || []))
      .catch(() => setQRows([]))
      .finally(() => setQBusy(false));
  };

  /* Optimistic, but only on the row that was answered — and the row keeps showing its
     answer instead of vanishing, so a mistaken call can be seen and changed. The headline
     number does not move until the next rebuild, and the drawer says so rather than
     letting someone refresh and conclude it failed. */
  const decide = async (row: any, decision: string) => {
    const id = row.person_no + '|' + row.date;
    setSaving(id);
    try {
      await apiClient.post('/attendance-recon/roster-v2/data-trust/decide',
        { personNo: row.person_no, date: row.date, queue: openQ, decision });
      setQRows(rows => (rows || []).map(r =>
        r.person_no === row.person_no && r.date === row.date
          ? { ...r, decision, decided_by: ar ? 'you' : 'you' } : r));
    } catch (e: any) {
      alert((ar ? 'ما انحفظ القرار: ' : 'Could not record the decision: ') +
        (e?.response?.data?.message || e?.message || ''));
    } finally { setSaving(null); }
  };

  useEffect(() => {
    setLoading(true);
    apiClient.get('/attendance-recon/roster-v2/data-trust')
      .then((r: any) => { setD(r.data); setErr(null); })
      .catch((e: any) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32, color: 'var(--text-2)' }}>{ar ? 'جارٍ الحساب…' : 'Computing…'}</div>;
  if (err || !d) return (
    <div style={{ padding: 32, color: 'var(--text-2)' }}>
      {ar ? 'تعذّر تحميل لوحة الثقة.' : 'Could not load the trust panel.'} {err}
    </div>
  );

  const c = d.coverage;
  const trust = c.trustPct;
  /* The arc is the page's one piece of theatre, and it is honest: it draws the exact
     ratio it reports. A gauge that rounds up to look better is the opposite of this page. */
  const R = 78, CIRC = 2 * Math.PI * R;
  const arc = trust == null ? 0 : (trust / 100) * CIRC;
  const trustTone = trust == null ? (dark ? '#94a3b8' : '#64748b')
    : trust >= 90 ? (dark ? '#34d399' : '#059669')
    : trust >= 75 ? (dark ? '#fbbf24' : '#d97706')
    : (dark ? '#fb7185' : '#e11d48');

  const card: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-card)', boxShadow: 'var(--elev-1)',
  };

  return (
/* The page paints its own canvas so it never depends on an ancestor to do it. Cheap,
       and it keeps the surface self-contained. (An earlier version of this comment claimed
       it worked around a light-mode body bug — that bug was a measurement artifact from a
       non-compositing preview pane, not a real defect.) */
    <div style={{ padding: '20px 22px 40px', maxWidth: 1320, margin: '0 auto', background: 'var(--bg)', minHeight: '100%' }} dir={ar ? 'rtl' : 'ltr'}>

      {/* ── Header: what this is, and the period it speaks for ─────────────── */}
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 13, display: 'grid', placeItems: 'center', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', color: '#fff',
          boxShadow: '0 6px 18px rgba(99,102,241,.32)',
        }}><ShieldCheck size={22} /></div>
        <div style={{ minWidth: 260, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-.01em' }}>
            {ar ? 'ثقة البيانات' : 'Data Trust'}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.55, maxWidth: 720 }}>
            {ar
              ? 'كل شاشة تانية بتقول شو صار. هاي بتقول قدّيش منه يستاهل الثقة، ووين بالضبط بتوقف.'
              : 'Every other screen tells you what happened. This one tells you how much of it to believe, and exactly where the confidence runs out.'}
          </p>
        </div>
        <div style={{ ...card, padding: '9px 14px', fontSize: 12.5, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
          {d.from} → {d.to}
        </div>
      </header>

      {/* ── The one number, and the arithmetic behind it, side by side ──────── */}
      <section style={{ ...card, padding: 22, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 28, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ position: 'relative', width: 184, height: 184, flexShrink: 0 }}>
          <svg width="184" height="184" viewBox="0 0 184 184" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
            <circle cx="92" cy="92" r={R} fill="none" stroke="var(--border)" strokeWidth="13" />
            <circle cx="92" cy="92" r={R} fill="none" stroke={trustTone} strokeWidth="13" strokeLinecap="round"
              strokeDasharray={`${arc} ${CIRC}`}
              style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(.22,.9,.28,1)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 40, fontWeight: 750, color: trustTone, lineHeight: 1, letterSpacing: '-.03em' }}>
                {trust == null ? '—' : `${trust}%`}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 6, fontWeight: 600, letterSpacing: '.02em' }}>
                {ar ? 'أيام مقيَّمة بدليل قوي' : 'SCORED ON STRONG EVIDENCE'}
              </div>
            </div>
          </div>
        </div>

        <div>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--text-1)', lineHeight: 1.65 }}>
            {ar
              ? <>من <b>{c.scored.toLocaleString()}</b> يوم أطلقنا عليه حُكم، <b>{c.strong.toLocaleString()}</b> منهم شفنا فيهم ثلاثة أرباع الشفت أو أكتر. الباقي <b>{c.partial.toLocaleString()}</b> مقيَّم على دليل جزئي، و<b>{c.not_scored.toLocaleString()}</b> يوم شغل انحفظ بدون تقييم — كل واحد فيهم بيحمل سببه.</>
              : <>Of <b>{c.scored.toLocaleString()}</b> days we drew a conclusion about, <b>{c.strong.toLocaleString()}</b> were measured across three quarters of the shift or more. A further <b>{c.partial.toLocaleString()}</b> rest on partial evidence, and <b>{c.not_scored.toLocaleString()}</b> worked days are recorded but deliberately not scored — each carrying its reason.</>}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(132px,1fr))', gap: 10 }}>
            {[
              { k: ar ? 'أشخاص' : 'People', v: c.people, Icon: Users },
              { k: ar ? 'أيام شغل' : 'Worked days', v: c.worked, Icon: CalendarX },
              { k: ar ? 'الالتزام' : 'Conformance', v: `${d.conformance.mean}%`, Icon: ShieldCheck },
              { k: ar ? 'على دليل قوي' : 'On strong evidence', v: `${d.conformance.mean_strong}%`, Icon: CheckCircle2 },
            ].map(({ k, v, Icon }) => (
              <div key={k} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 600 }}>
                  <Icon size={13} />{k}
                </div>
                <div style={{ fontSize: 21, fontWeight: 700, color: 'var(--text-1)', marginTop: 3, letterSpacing: '-.02em' }}>{v}</div>
              </div>
            ))}
          </div>
          {/* Conformance stated twice on purpose: the headline average, and the average over
              only the days that can carry it. When the two agree the number is safe to quote. */}
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
            {ar
              ? `الالتزام ${d.conformance.mean}% على كل الأيام المقيَّمة، و${d.conformance.mean_strong}% لو حسبناه على الأيام القوية بس — قرب الرقمين من بعض معناه إنه رقم بينحكى فيه.`
              : `Conformance is ${d.conformance.mean}% across all scored days and ${d.conformance.mean_strong}% across only the strongly-evidenced ones. The two agreeing is what makes the figure safe to quote.`}
          </p>
        </div>
      </section>

      {/* ── Where the evidence came from ───────────────────────────────────── */}
      <section style={{ ...card, padding: '16px 20px', marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>
          {ar ? 'من وين إجا الدليل' : 'Where the evidence came from'}
        </h2>
        <div style={{ display: 'flex', height: 34, borderRadius: 9, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {[
            { n: d.witnesses.both,        c: '#047857', l: ar ? 'سيستم + بصمة' : 'System + punch',  Icon: Layers },
            { n: d.witnesses.system_only, c: '#4338ca', l: ar ? 'سيستم فقط' : 'System only',        Icon: Monitor },
            { n: d.witnesses.punch_only,  c: '#0e7490', l: ar ? 'بصمة فقط' : 'Punch only',          Icon: Fingerprint },
            /* was #94a3b8: white on it measured 2.56:1. The label sits INSIDE this bar. */
            { n: d.witnesses.neither,     c: '#475569', l: ar ? 'ولا واحد' : 'Neither',             Icon: Ban },
          ].map(({ n, c: col, l }) => {
            const tot = d.witnesses.both + d.witnesses.system_only + d.witnesses.punch_only + d.witnesses.neither || 1;
            const pc = (100 * n) / tot;
            return pc < 0.5 ? null : (
              <div key={l} title={`${l}: ${n}`} style={{
                width: `${pc}%`, background: col, display: 'grid', placeItems: 'center',
                color: '#fff', fontSize: 11.5, fontWeight: 700, minWidth: 0,
              }}>{pc > 9 ? `${Math.round(pc)}%` : ''}</div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
          {[
            { n: d.witnesses.both,        c: '#059669', l: ar ? 'سيستم + بصمة — مؤكَّد مرتين' : 'System + punch — corroborated twice', Icon: Layers },
            { n: d.witnesses.system_only, c: '#6366f1', l: ar ? 'سيستم فقط' : 'System only',   Icon: Monitor },
            { n: d.witnesses.punch_only,  c: '#0891b2', l: ar ? 'بصمة فقط — التأخير بينقاس بمسطرة تانية' : 'Punch only — lateness measured on a different ruler', Icon: Fingerprint },
            { n: d.witnesses.neither,     c: dark ? '#94a3b8' : '#475569', l: ar ? 'ولا شاهد — بيتحل من Odoo' : 'No witness — resolved from Odoo', Icon: Ban },
          ].map(({ n, c: col, l, Icon }) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-2)' }}>
              <Icon size={13} style={{ color: col }} />
              <b style={{ color: 'var(--text-1)' }}>{n.toLocaleString()}</b> {l}
            </span>
          ))}
        </div>
      </section>

      {/* ── The open decisions ─────────────────────────────────────────────── */}
      <h2 style={{ margin: '22px 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
        {ar ? 'القرارات المفتوحة' : 'Open decisions'}
        <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-2)', marginInlineStart: 8 }}>
          {ar ? '— المحرّك رفض يقرّرها لحاله' : '— the engine deliberately refused to settle these on its own'}
        </span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(292px,1fr))', gap: 12, marginBottom: 22 }}>
        {d.queues.map(q => {
          const T = TONE[q.tone || 'slate'] || TONE.slate;
          const Icon = ICON[q.key] || AlertTriangle;
          return (
            <article key={q.key} role="button" tabIndex={0}
              onClick={() => q.days > 0 && loadQueue(q.key)}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && q.days > 0) { e.preventDefault(); loadQueue(q.key); } }}
              style={{
                ...card, padding: 16, borderColor: T.ring, display: 'flex', flexDirection: 'column', gap: 9,
                cursor: q.days > 0 ? 'pointer' : 'default', transition: 'transform .16s ease, box-shadow .16s ease',
              }}
              onMouseEnter={e => { if (q.days > 0) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--elev-2)'; } }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--elev-1)'; }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: T.bg, color: T.text, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Icon size={16} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.3 }}>{q.title || q.key}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.text, marginTop: 2 }}>{ar ? T.wordAr : T.word}</div>
                </div>
                <div style={{ textAlign: ar ? 'left' : 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-1)', lineHeight: 1, letterSpacing: '-.02em' }}>{q.days}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{ar ? `${q.people} شخص` : `${q.people} people`}</div>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>{q.why}</p>
              <div style={{
                marginTop: 'auto', paddingTop: 8, borderTop: '1px dashed var(--border)',
                fontSize: 12, fontWeight: 600, color: T.text,
              }}>{q.days > 0 ? (ar ? q.action + ' — افتح واحسمها' : q.action + ' — open and settle them') : q.action}</div>
            </article>
          );
        })}
      </div>

      {/* ── Named, so someone can act ──────────────────────────────────────── */}
      {d.people.length > 0 && (
        <section style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
              {ar ? 'مين عنده أيام مفتوحة' : 'Who is carrying open days'}
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--text-2)' }}>
              {ar ? '«١٧ بند مفتوح» إحصائية. الاسم واليوم شغلة بينعمل فيها إشي.' : '“17 open items” is a statistic. A name and a day is something someone can act on.'}
            </p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                  {[ar ? 'الموظف' : 'Employee', ar ? 'الوظيفة' : 'Function', ar ? 'المشرف' : 'Team leader',
                    ar ? 'تعارض' : 'Conflict', ar ? 'دليل ضعيف' : 'Thin', ar ? 'وقت غلط' : 'Displaced', ar ? 'المجموع' : 'Total']
                    .map((h, i) => (
                      <th key={h} style={{ padding: '9px 14px', textAlign: i > 2 ? (ar ? 'left' : 'right') : (ar ? 'right' : 'left'), fontWeight: 700 }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {d.people.map((p, i) => (
                  <tr key={p.person_no} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'var(--surface-2)' : 'transparent' }}>
                    <td style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--text-1)' }}>{p.name}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-2)' }}>{p.fn || '—'}</td>
                    <td style={{ padding: '9px 14px', color: 'var(--text-2)' }}>{p.tl || '—'}</td>
                    {[p.conflicts, p.thin, p.displaced].map((n, j) => (
                      <td key={j} style={{ padding: '9px 14px', textAlign: ar ? 'left' : 'right', color: n ? 'var(--text-1)' : 'var(--text-3)', fontWeight: n ? 600 : 400 }}>
                        {n || '·'}
                      </td>
                    ))}
                    <td style={{ padding: '9px 14px', textAlign: ar ? 'left' : 'right', fontWeight: 700, color: 'var(--text-1)' }}>{p.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openQ && <QueueDrawer queue={openQ} rows={qRows} busy={qBusy} saving={saving} ar={ar} dark={!!dark}
        onClose={() => { setOpenQ(null); setQRows(null); }} onDecide={decide} />}

      {/* ── What the page cannot see, said on the page ─────────────────────── */}
      {d.caveats?.length > 0 && (
        <footer style={{ marginTop: 18, padding: '13px 16px', background: 'var(--surface-2)', border: '1px dashed var(--border-strong)', borderRadius: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6, letterSpacing: '.02em' }}>
            {ar ? 'حدود هالصفحة' : 'WHAT THIS PAGE CANNOT SEE'}
          </div>
          {d.caveats.map((c2, i) => (
            <div key={i} style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>· {c2}</div>
          ))}
        </footer>
      )}
    </div>
  );
}

/* ── The drawer ────────────────────────────────────────────────────────────────────
   Every row states the case before it offers the buttons: what the schedule said, what the
   systems saw, what was counted, and the engine's own sentence explaining why it stopped.
   A reviewer should be able to answer without opening another screen — and should never be
   asked to answer from a label alone. */
const hhmm = (m: any) => (m == null ? '—'
  : String(Math.floor((m % 1440) / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));

type Choice = { v: string; en: string; ar: string; good?: boolean; bad?: boolean };
const CHOICES: Record<string, Choice[]> = {
  schedule_vs_hr: [
    { v: 'schedule', en: 'The schedule was right — it was a working day', ar: 'الجدول صح — كان يوم دوام', good: true },
    { v: 'hr',       en: 'Odoo was right — it was an off day',            ar: 'أودو صح — كان يوم عطلة' },
  ],
  displaced_shift: [
    { v: 'schedule_wrong', en: 'The shift code is wrong — re-measure against what was worked', ar: 'كود الشفت غلط — قيس على الي اشتغله', bad: true },
    { v: 'keep',           en: 'Code is right — leave it unscored',                            ar: 'الكود صح — خلّيه بدون تقييم' },
  ],
  thin_evidence: [
    { v: 'worked',     en: 'They worked the shift — the evidence is just incomplete', ar: 'اشتغل الشفت — الدليل ناقص بس', good: true },
    { v: 'not_worked', en: 'They did not work it',                                    ar: 'ما اشتغله', bad: true },
    { v: 'keep',       en: 'Still unclear — leave it open',                           ar: 'لسا مش واضح — خلّيه مفتوح' },
  ],
  unknown: [
    { v: 'worked',     en: 'Worked — confirmed off-system', ar: 'اشتغل — تأكّد خارج السيستم', good: true },
    { v: 'not_worked', en: 'Did not work',                  ar: 'ما اشتغل', bad: true },
    { v: 'keep',       en: 'Leave it open',                 ar: 'خلّيه مفتوح' },
  ],
};

function QueueDrawer({ queue, rows, busy, saving, ar, dark, onClose, onDecide }: {
  queue: string; rows: any[] | null; busy: boolean; saving: string | null; ar: boolean; dark: boolean;
  onClose: () => void; onDecide: (row: any, decision: string) => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const choices = CHOICES[queue] || CHOICES.unknown;
  const list = rows || [];
  const open = list.filter(r => !r.decision).length;
  const done = list.length - open;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(2,6,23,.55)',
      backdropFilter: 'blur(3px)', display: 'flex', justifyContent: ar ? 'flex-start' : 'flex-end',
    }}>
      <div onClick={e => e.stopPropagation()} dir={ar ? 'rtl' : 'ltr'} style={{
        width: 'min(760px, 100%)', height: '100%', background: 'var(--bg)',
        borderInlineStart: '1px solid var(--border)', boxShadow: '0 0 60px rgba(0,0,0,.35)',
        display: 'flex', flexDirection: 'column',
      }}>
        <header style={{
          padding: '15px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
              {ar ? 'احسم البنود المفتوحة' : 'Settle the open items'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
              {busy ? (ar ? 'جارٍ التحميل…' : 'Loading…')
                : ar ? (open + ' مفتوح · ' + done + ' انحسم') : (open + ' open · ' + done + ' already answered')}
            </div>
          </div>
          <button onClick={onClose} style={{
            border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)',
            borderRadius: 9, padding: '7px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>{ar ? 'إغلاق' : 'Close'}</button>
        </header>

        {/* The honest banner. The answer is recorded now; the numbers move on the next
            rebuild, because the rules live in the engine rather than being written over the
            data — which also means the decision is re-applied every run instead of decaying
            into a one-off edit. Saying so is what stops someone refreshing and thinking it
            failed. */}
        <div style={{
          padding: '9px 20px', fontSize: 12.5, lineHeight: 1.55,
          background: dark ? 'rgba(99,102,241,.13)' : 'rgba(99,102,241,.09)',
          color: 'var(--text-2)', borderBottom: '1px solid var(--border)',
        }}>
          {ar
            ? 'القرار بينحفظ هلق وبينطبّق مع أول إعادة بناء — لأنه القواعد بتعيش بالمحرّك، مش بتنكتب فوق الداتا. وبينعاد تطبيقه كل مرة، فما بيضيع.'
            : 'Your answer is recorded now and applied on the next rebuild — the rules live in the engine rather than being written over the data, so the decision is re-applied every run instead of decaying into a one-off edit.'}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 30px' }}>
          {busy && <div style={{ color: 'var(--text-2)', fontSize: 13, padding: 20 }}>{ar ? 'جارٍ التحميل…' : 'Loading…'}</div>}
          {!busy && rows && rows.length === 0 &&
            <div style={{ color: 'var(--text-2)', fontSize: 13, padding: 20 }}>{ar ? 'ما في بنود بهالطابور.' : 'Nothing open in this queue.'}</div>}

          {list.map(r => {
            const id = r.person_no + '|' + r.date;
            const isSaving = saving === id;
            const answered = choices.find(c => c.v === r.decision);
            const seen = r.login == null && r.punch == null
              ? (ar ? 'ولا إشي' : 'nothing')
              : [r.login != null ? hhmm(r.login) + '→' + hhmm(r.logout) : null,
                 r.punch != null ? (ar ? 'بصمة ' + hhmm(r.punch) : 'punch ' + hhmm(r.punch)) : null]
                .filter(Boolean).join(' · ');
            return (
              <article key={id} style={{
                background: 'var(--surface)',
                border: '1px solid ' + (r.decision ? (dark ? '#065f46' : '#a7f3d0') : 'var(--border)'),
                borderRadius: 13, padding: 14, marginBottom: 11,
                opacity: isSaving ? .6 : 1, transition: 'opacity .2s ease, border-color .2s ease',
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 14, color: 'var(--text-1)' }}>{r.name}</b>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.fn || '—'}{r.tl ? ' · ' + r.tl : ''}</span>
                  <span style={{ marginInlineStart: 'auto', fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>
                    {r.day ? r.day + ' · ' : ''}{r.date}
                  </span>
                </div>

                {/* The case, in the order a human reasons about it */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, margin: '11px 0 9px' }}>
                  {[
                    { k: ar ? 'الجدول قال' : 'Schedule said', v: (r.shift_code || '—') + (r.ss != null ? '  ' + hhmm(r.ss) + '→' + hhmm(r.se) : '') },
                    { k: ar ? 'السيستم شاف' : 'Systems saw', v: seen },
                    { k: ar ? 'محسوب شغل' : 'Counted as worked', v: r.worked ? (r.worked / 60).toFixed(1) + 'h' : '0h' },
                    { k: ar ? 'كود الحضور' : 'Attendance cell', v: r.attendance_code || '—' },
                  ].map(({ k, v }) => (
                    <div key={k} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-2)', letterSpacing: '.02em' }}>{k}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginTop: 2 }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>

                {r.reason && (
                  <p style={{ margin: '0 0 11px', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55, fontStyle: 'italic' }}>
                    {r.reason}
                  </p>
                )}

                {r.decision ? (
                  <div style={{
                    fontSize: 12.5, fontWeight: 600, color: dark ? '#6ee7b7' : '#047857',
                    display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
                  }}>
                    <CheckCircle2 size={14} />
                    {(ar ? answered?.ar : answered?.en) || r.decision}
                    {r.decided_by ? ' — ' + (ar ? 'حسمها ' : 'answered by ') + r.decided_by : ''}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {choices.map(c => (
                      <button key={c.v} disabled={isSaving} onClick={() => onDecide(r, c.v)} style={{
                        border: '1px solid ' + (c.good ? (dark ? '#065f46' : '#6ee7b7') : c.bad ? (dark ? '#7f1d1d' : '#fecaca') : 'var(--border)'),
                        background: c.good ? (dark ? 'rgba(5,150,105,.16)' : '#ecfdf5') : c.bad ? (dark ? 'rgba(225,29,72,.15)' : '#fef2f2') : 'var(--surface-2)',
                        color: c.good ? (dark ? '#6ee7b7' : '#065f46') : c.bad ? (dark ? '#fda4af' : '#9f1239') : 'var(--text-1)',
                        borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600,
                        cursor: isSaving ? 'wait' : 'pointer', lineHeight: 1.3, textAlign: 'start',
                      }}>{ar ? c.ar : c.en}</button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
