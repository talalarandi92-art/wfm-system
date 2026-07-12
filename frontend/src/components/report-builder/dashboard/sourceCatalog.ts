/**
 * Dashboard Composer — shared source catalog cache.
 *
 * Multiple widgets on the same dashboard frequently point at the same source.
 * We fetch `/report-builder-v2/sources` once and each `/sources/:key` schema
 * once, then hand cached copies to every widget so a 6-widget board makes at
 * most (1 + distinct-sources) schema calls instead of one per widget.
 */
import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { SourceMeta, SourceDetail } from './types';

let sourcesData: SourceMeta[] | null = null;
let sourcesPromise: Promise<SourceMeta[]> | null = null;
const detailData = new Map<string, SourceDetail>();
const detailPromises = new Map<string, Promise<SourceDetail>>();

export function loadSources(): Promise<SourceMeta[]> {
  if (sourcesData) return Promise.resolve(sourcesData);
  if (!sourcesPromise) {
    sourcesPromise = apiClient.get('/report-builder-v2/sources')
      .then((r: any) => { sourcesData = r.data?.sources ?? []; return sourcesData!; })
      .catch((e: any) => { sourcesPromise = null; throw e; });
  }
  return sourcesPromise;
}

export function loadDetail(key: string): Promise<SourceDetail> {
  const cached = detailData.get(key);
  if (cached) return Promise.resolve(cached);
  let p = detailPromises.get(key);
  if (!p) {
    p = apiClient.get(`/report-builder-v2/sources/${key}`)
      .then((r: any) => { detailData.set(key, r.data as SourceDetail); return r.data as SourceDetail; })
      .catch((e: any) => { detailPromises.delete(key); throw e; });
    detailPromises.set(key, p);
  }
  return p;
}

/** Synchronous peek — used to decide filter cascade without a re-render round-trip. */
export function peekDetail(key: string | null | undefined): SourceDetail | null {
  return key ? (detailData.get(key) ?? null) : null;
}

export function useSources() {
  const [sources, setSources] = useState<SourceMeta[]>(sourcesData ?? []);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    loadSources().then(d => on && setSources(d)).catch(() => on && setErr(true));
    return () => { on = false; };
  }, []);
  return { sources, err };
}

export function useSourceDetail(key: string | null | undefined) {
  const [detail, setDetail] = useState<SourceDetail | null>(peekDetail(key));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!key) { setDetail(null); setErr(false); return; }
    const cached = peekDetail(key);
    if (cached) { setDetail(cached); setErr(false); return; }
    let on = true; setLoading(true); setErr(false); setDetail(null);
    loadDetail(key)
      .then(d => { if (on) { setDetail(d); setLoading(false); } })
      .catch(() => { if (on) { setErr(true); setLoading(false); } });
    return () => { on = false; };
  }, [key]);
  return { detail, loading, err };
}
