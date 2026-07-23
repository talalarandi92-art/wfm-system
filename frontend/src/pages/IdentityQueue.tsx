/**
 * IDENTITY REVIEW QUEUE — the signals the system refused to guess.
 *
 * When a Sprinklr/Ameyo/Odoo signal cannot be tied to a person with confidence,
 * the engine does the right thing: it links nothing and files the case here.
 * That behaviour is correct — a wrong link attributes one person's performance
 * (or lateness) to another. But the queue had a full API and NO screen, so 31
 * cases sat unseen. A review queue nobody can see is not a queue, it is a silent
 * backlog.
 *
 * This page shows the backlog and lets a human resolve it. It never proposes a
 * link the engine did not already compute — where the engine has no suggestion,
 * this page offers none either; you type the person number yourself.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Fingerprint, Link2, EyeOff, RefreshCw, Search, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useUiStore } from '@/store/ui.store';
import {
  useInjectDsStyles, NxPageHeader, NxLoading, NxError, NxCard, card, STATUS,
} from '@/components/ds';
import { StatTile } from '@/components/dazzle';

interface QueueRow {
  id: string;
  source: string;
  raw_key: string;
  raw_kind: string;
  raw_name: string | null;
  suggested_person_no: string | null;
  suggested_confidence: number | null;
  suggested_name: string | null;
  occurrences: number;
  status: string;
  note: string | null;
  first_seen: string;
  last_seen: string;
}

const SRC_COLOR: Record<string, string> = {
  sprinklr: '#06b6d4', ameyo: '#a855f7', odoo: '#f59e0b', roster: '#22c55e',
};

export default function IdentityQueue() {
  useInjectDsStyles();
  const { dark, lang } = useUiStore();
  const ar = lang === 'ar';

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [status, setStatus] = useState<'open' | 'resolved' | 'ignored'>('open');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(false);
    apiClient.get<{ count: number; queue: QueueRow[] }>(`/employee-identity/unresolved?status=${status}`)
      .then(r => setRows(r.data?.queue ?? []))
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(r =>
      (r.raw_name ?? '').toLowerCase().includes(t) ||
      (r.raw_key ?? '').toLowerCase().includes(t) ||
      (r.source ?? '').toLowerCase().includes(t));
  }, [rows, q]);

  const bySource = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.source, (m.get(r.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  async function act(row: QueueRow, kind: 'resolve' | 'ignore') {
    const personNo = (draft[row.id] ?? row.suggested_person_no ?? '').trim();
    if (kind === 'resolve' && !personNo) {
      setMsg(ar ? 'اكتب رقم الشخص أولًا — النظام لا يخمّن نيابةً عنك.' : 'Enter a person number first — the system will not guess for you.');
      return;
    }
    setBusy(row.id); setMsg(null);
    try {
      if (kind === 'resolve') await apiClient.post(`/employee-identity/${row.id}/resolve`, { person_no: personNo });
      else await apiClient.post(`/employee-identity/${row.id}/ignore`, {});
      setMsg(ar
        ? (kind === 'resolve' ? `تم الربط بـ ${personNo}` : 'تم التجاهل')
        : (kind === 'resolve' ? `Linked to ${personNo}` : 'Ignored'));
      load();
    } catch {
      setMsg(ar ? 'فشلت العملية — لم يتغيّر شيء.' : 'Action failed — nothing was changed.');
    } finally { setBusy(null); }
  }

  const txt = dark ? '#cbd5e1' : '#334155';
  const faint = dark ? '#94a3b8' : '#64748b';

  return (
    <div className="page-enter" style={{ maxWidth: 1180, margin: '0 auto' }} dir={ar ? 'rtl' : 'ltr'}>
      <NxPageHeader
        icon={Fingerprint}
        title="Identity Review Queue" titleAr="طابور مراجعة الهويات"
        desc="Signals the engine refused to link — it never guesses a person; you decide"
        descAr="إشارات رفض المحرّك ربطها — لا يخمّن الشخص أبدًا؛ القرار لك"
        color="#06b6d4" dark={dark} ar={ar} onRefresh={load} refreshing={loading}
      />

      {err && <NxError onRetry={load} dark={dark} ar={ar} />}
      {loading && !rows.length && <NxLoading dark={dark} ar={ar} />}

      {!err && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatTile icon={AlertTriangle} label={ar ? 'بانتظار المراجعة' : 'Awaiting review'} num={rows.length} color={rows.length ? STATUS.warn : STATUS.ok} />
            {bySource.slice(0, 3).map(([src, n]) => (
              <StatTile key={src} icon={Link2} label={src} num={n} color={SRC_COLOR[src] ?? STATUS.neutral} />
            ))}
          </div>

          <NxCard dark={dark} style={{ marginBottom: 14, borderInlineStart: '3px solid #06b6d4' }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.65, color: txt }}>
              {ar
                ? 'كل صف هنا إشارة من نظام خارجي لم يستطع المحرّك ربطها بشخص بثقة — فلم يربط شيئًا. هذا هو السلوك الصحيح: ربط خاطئ ينسب أداء (أو تأخير) شخص إلى شخص آخر. حيث لا يوجد اقتراح من المحرّك، لا تقترح هذه الصفحة شيئًا كذلك.'
                : 'Every row is a signal from an external system the engine could not tie to a person with confidence — so it linked nothing. That is the correct behaviour: a wrong link attributes one person’s performance (or lateness) to someone else. Where the engine has no suggestion, this page offers none either.'}
            </div>
          </NxCard>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            {(['open', 'resolved', 'ignored'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)}
                style={{
                  fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 9, cursor: 'pointer',
                  background: status === s ? 'rgba(6,182,212,0.15)' : 'transparent',
                  border: `1px solid ${status === s ? 'rgba(6,182,212,0.4)' : card(dark).border.split(' ').pop()}`,
                  color: status === s ? '#06b6d4' : faint,
                }}>
                {ar ? ({ open: 'مفتوح', resolved: 'محلول', ignored: 'متجاهَل' }[s]) : s}
              </button>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginInlineStart: 'auto' }}>
              <Search size={13} style={{ color: faint }} />
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder={ar ? 'بحث بالاسم أو الإيميل…' : 'Search name or email…'}
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  color: dark ? '#e2e8f0' : '#0f172a', fontSize: 12, minWidth: 190,
                }} />
            </div>
          </div>

          {msg && (
            <div style={{ fontSize: 12, marginBottom: 10, color: '#06b6d4' }}>{msg}</div>
          )}

          {!loading && !list.length && (
            <NxCard dark={dark}>
              <div style={{ fontSize: 13, color: faint, textAlign: 'center', padding: '18px 0' }}>
                {ar ? 'لا شيء في هذه القائمة.' : 'Nothing in this list.'}
              </div>
            </NxCard>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(r => {
              const color = SRC_COLOR[r.source] ?? STATUS.neutral;
              const canAct = r.status === 'open';
              return (
                <NxCard key={r.id} dark={dark} pad="0" style={{ overflow: 'hidden', borderInlineStart: `3px solid ${color}` }}>
                  <div style={{ padding: '11px 15px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
                      color, background: `${color}18`, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
                    }}>{r.source}</span>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: dark ? '#f1f5f9' : '#0f172a' }}>
                        {r.raw_name || (ar ? '(بلا اسم)' : '(no name)')}
                      </div>
                      <div style={{ fontSize: 11, color: faint, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.raw_kind}: {r.raw_key}
                      </div>
                      {r.note && <div style={{ fontSize: 11, color: faint, marginTop: 2 }}>{r.note}</div>}
                    </div>

                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: txt, fontVariantNumeric: 'tabular-nums' }}>{r.occurrences}</div>
                      <div style={{ fontSize: 9.5, color: faint }}>{ar ? 'مرّة' : 'seen'}</div>
                    </div>

                    {/* The engine's own suggestion, when it HAS one — never invented here. */}
                    {r.suggested_person_no ? (
                      <div style={{ fontSize: 11, color: STATUS.ok, flexShrink: 0 }}>
                        {ar ? 'اقتراح المحرّك: ' : 'engine suggests: '}
                        <b>{r.suggested_person_no}</b>
                        {r.suggested_name ? ` · ${r.suggested_name}` : ''}
                        {r.suggested_confidence != null ? ` (${Math.round(r.suggested_confidence * 100)}%)` : ''}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: faint, flexShrink: 0 }}>
                        {ar ? 'لا اقتراح' : 'no suggestion'}
                      </div>
                    )}

                    {canAct && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                        <input
                          value={draft[r.id] ?? r.suggested_person_no ?? ''}
                          onChange={e => setDraft(d => ({ ...d, [r.id]: e.target.value }))}
                          placeholder={ar ? 'رقم الشخص' : 'person no'}
                          style={{
                            width: 96, fontSize: 12, padding: '4px 8px', borderRadius: 8,
                            background: dark ? 'rgba(0,0,0,0.2)' : '#fff',
                            border: card(dark).border, color: dark ? '#e2e8f0' : '#0f172a',
                          }} />
                        <button disabled={busy === r.id} onClick={() => act(r, 'resolve')}
                          style={{
                            fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                            background: 'rgba(34,197,94,0.14)', color: STATUS.ok, border: '1px solid rgba(34,197,94,0.35)',
                            opacity: busy === r.id ? 0.5 : 1,
                          }}>
                          <Link2 size={11} style={{ display: 'inline', marginInlineEnd: 4 }} />
                          {ar ? 'اربط' : 'Link'}
                        </button>
                        <button disabled={busy === r.id} onClick={() => act(r, 'ignore')}
                          style={{
                            fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                            background: 'transparent', color: faint, border: card(dark).border,
                            opacity: busy === r.id ? 0.5 : 1,
                          }}>
                          <EyeOff size={11} style={{ display: 'inline', marginInlineEnd: 4 }} />
                          {ar ? 'تجاهل' : 'Ignore'}
                        </button>
                      </div>
                    )}
                  </div>
                </NxCard>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: faint, marginTop: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
            <RefreshCw size={11} />
            {ar
              ? 'كل ربط أو تجاهل مُدقَّق (audit) ومنسوب لك.'
              : 'Every link or ignore is audited and attributed to you.'}
          </div>
        </>
      )}
    </div>
  );
}
