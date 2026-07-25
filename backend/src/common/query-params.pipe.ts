import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * WELL-KNOWN QUERY PARAMS — validated once, for every endpoint.
 *
 * THE DEFECT THIS FIXES, measured 2026-07-25 across the live API: 7 of 10 probes
 * with an empty or malformed date returned **HTTP 500 "Internal server error"**.
 *
 *     /schedule/week-status?weekStart=          → 500
 *     /schedule/grid?weekStart=banana           → 500
 *     /capacity/hc-overview?date=banana         → 500
 *     /attendance-recon/roster-v2?from=banana   → 500
 *
 * Nothing was wrong with the server. The value went straight into SQL, Postgres
 * refused it ("invalid input syntax for type date"), and Nest turned an ordinary
 * bad request into a server error. That is the wrong answer twice over: it blames
 * the system for the caller's input, and it tells the user nothing they can act on.
 * A stale bookmark, a cleared date field, or a hand-edited URL is enough to produce
 * it — in front of anyone.
 *
 * These parameter NAMES are used consistently across the whole platform, so one
 * middleware covers every controller without touching a single one of them. It
 * validates shape only; it never guesses a value and never rewrites one. An empty
 * string is treated as "not provided" and deleted, which is what every handler
 * already expects from an omitted param — that alone fixes the blank-input 500s.
 *
 * `common/pg-error.filter.ts` is the safety net for any param this does not name.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;

/** A real calendar date, not merely the right shape — 2026-02-31 matches the regex. */
function isRealDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

type Rule = { test: (v: string) => boolean; expected: string };

const DATE_RULE: Rule = { test: isRealDate, expected: 'YYYY-MM-DD' };
const RULES: Record<string, Rule> = {
  date: DATE_RULE, day: DATE_RULE, from: DATE_RULE, to: DATE_RULE,
  start: DATE_RULE, end: DATE_RULE, startDate: DATE_RULE, endDate: DATE_RULE,
  weekStart: DATE_RULE, week: DATE_RULE, anchor: DATE_RULE, statDate: DATE_RULE,
  month: { test: (v) => ISO_MONTH.test(v), expected: 'YYYY-MM' },
  year: { test: (v) => YEAR.test(v) && +v >= 2000 && +v <= 2100, expected: 'YYYY (2000-2100)' },
};

/** Numeric params that must not reach SQL as text. Bounded to keep a typo from
 *  asking for a million rows and stalling the box. */
const NUMERIC: Record<string, { min: number; max: number }> = {
  limit: { min: 1, max: 5000 }, offset: { min: 0, max: 1e7 },
  page: { min: 0, max: 1e6 }, months: { min: 1, max: 120 },
  weeks: { min: 1, max: 520 }, days: { min: 1, max: 3660 },
  hour: { min: 0, max: 23 }, startHour: { min: 0, max: 23 }, endHour: { min: 0, max: 24 },
};

@Injectable()
export class QueryParamsMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const q = req.query as Record<string, unknown>;
    for (const key of Object.keys(q)) {
      const raw = q[key];
      if (Array.isArray(raw) || raw == null) continue;
      const value = String(raw).trim();

      /* Empty means "not provided". Every handler already has a default for an
         absent param; none of them had one for a blank string, which is exactly
         how a cleared date field produced a 500. */
      if (value === '') { delete q[key]; continue; }

      const rule = RULES[key];
      if (rule && !rule.test(value)) {
        throw new BadRequestException(
          `Invalid "${key}": expected ${rule.expected}, received "${value.slice(0, 40)}"`,
        );
      }
      const num = NUMERIC[key];
      if (num) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new BadRequestException(`Invalid "${key}": expected a number, received "${value.slice(0, 40)}"`);
        }
        if (n < num.min || n > num.max) {
          throw new BadRequestException(`"${key}" out of range: expected ${num.min}–${num.max}, received ${n}`);
        }
      }
      q[key] = value;
    }

    /* A from/to pair the wrong way round returns an empty result that looks like
       "there is no data" — a silent wrong answer, which is worse than an error. */
    const from = q.from as string | undefined, to = q.to as string | undefined;
    if (from && to && isRealDate(from) && isRealDate(to) && from > to) {
      throw new BadRequestException(`"from" (${from}) is after "to" (${to}) — the range is empty`);
    }
    next();
  }
}
