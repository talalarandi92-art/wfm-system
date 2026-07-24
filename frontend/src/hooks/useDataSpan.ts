import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';

/**
 * WHERE THE DATA IS — asked once, cached for the session, shared by every
 * date-driven screen.
 *
 * Screens used to choose their opening date three different ways: one hard-coded
 * a month, one asked for "this week", one asked for "today". All three break the
 * moment the roster is not current — and on 2026-07-24 it was 22 days behind, so
 * "this week" and "today" both opened a blank page over a database holding 19,295
 * rows. A blank page reads as "the system has nothing", which is the most damaging
 * possible answer and the least true one.
 *
 * So: open on ground that exists. The user can still navigate anywhere; this only
 * decides where the page LANDS, and `note` tells them plainly what the coverage is.
 */
export interface DataSpanFeed {
  key: string; label: string; from: string | null; to: string | null;
  rows: number; daysBehind: number | null; current: boolean;
}
export interface DataSpan {
  today: string;
  roster: { from: string | null; to: string | null; days: number; rows: number; people: number };
  latestDay: string | null;
  latestWeek: string | null;
  latestFullWeek: string | null;
  latestMonth: string | null;
  latestMonthFrom: string | null;
  latestMonthTo: string | null;
  defaultFrom: string | null;
  defaultTo: string | null;
  daysBehind: number | null;
  feeds: DataSpanFeed[];
  note: string;
}

/* One in-flight request per session, shared by every caller — five screens mounting
   at once must not fire five identical queries. */
let cached: DataSpan | null = null;
let inflight: Promise<DataSpan | null> | null = null;

export function fetchDataSpan(): Promise<DataSpan | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = apiClient.get('/attendance-recon/roster-v2/data-span')
      .then((r: any) => { cached = r.data as DataSpan; return cached; })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Drop the cache — call after an upload/rebuild changes the coverage. */
export function invalidateDataSpan(): void { cached = null; }

export function useDataSpan(): { span: DataSpan | null; loading: boolean } {
  const [span, setSpan] = useState<DataSpan | null>(cached);
  const [loading, setLoading] = useState(!cached);
  useEffect(() => {
    if (cached) { setSpan(cached); setLoading(false); return; }
    let alive = true;
    fetchDataSpan().then((s) => { if (alive) { setSpan(s); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  return { span, loading };
}
