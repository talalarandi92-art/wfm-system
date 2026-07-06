import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, of, from, firstValueFrom } from 'rxjs';

/**
 * In-process TTL response cache (2026-07-06, EXECUTION_BRIEF risks #4/#6 — key-free variant).
 *
 * The hot roster grids (roster-v2/hourly, week-forecast) rebuilt a 7-metric × 24h grid PER
 * REQUEST; under 120 concurrent users the load test measured p50 ≈ 20s / p95 ≈ 35s. roster_days
 * changes only on rebuild/manual edit, so N identical concurrent requests should compute ONCE
 * per TTL window. Zero new dependencies; single-instance semantics (this deployment). When the
 * platform goes multi-instance, swap the store for Redis — the interceptor contract stays.
 *
 * Keyed by tenant + full URL (querystring included). Mutating paths call rosterCacheInvalidate()
 * (recon upload/ingest/schedule-change/swap/revert + editCell dual-write).
 */
const store = new Map<string, { exp: number; body: unknown }>();
const inflight = new Map<string, Promise<unknown>>();   // miss-coalescing: concurrent identical misses share ONE compute
const MAX_ENTRIES = 500;

export function rosterCacheInvalidate(): void { store.clear(); inflight.clear(); }

@Injectable()
export class RosterTtlCacheInterceptor implements NestInterceptor {
  private readonly ttlMs = +(process.env.ROSTER_CACHE_TTL_MS || 90_000);

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    if ((req.method || 'GET') !== 'GET') return next.handle();
    const key = `${req.user?.tenantId ?? 't?'}|${req.originalUrl || req.url}`;
    const hit = store.get(key);
    if (hit && hit.exp > Date.now()) return of(hit.body);

    // STAMPEDE GUARD: when 120 users hit an expired/missing key simultaneously, only the FIRST
    // computes; the rest await the same promise (the load-test first wave was p95≈1.9s because
    // every concurrent miss recomputed the grid in parallel and saturated the pool).
    const running = inflight.get(key);
    if (running) return from(running);

    const p = firstValueFrom(next.handle()).then((body) => {
      if (store.size >= MAX_ENTRIES) {
        const first = store.keys().next().value;   // cheap bound; the TTL keeps it honest
        if (first) store.delete(first);
      }
      store.set(key, { exp: Date.now() + this.ttlMs, body });
      inflight.delete(key);
      return body;
    }).catch((e) => { inflight.delete(key); throw e; });
    inflight.set(key, p);
    return from(p);
  }
}
