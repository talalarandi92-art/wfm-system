/**
 * sprinklr-report.parser.ts — Auto-Ingest wave A0 (pure, no I/O).
 *
 * Normalizes STAGED Sprinklr reporting-TABLE rows (login/logout, survey, agent-perf) into
 * clean shapes that later waves (A1) emit into the recon pipeline. It is deliberately
 * HEURISTIC-driven rather than positional: the extension captures each report row generically
 * as { dims, measures, expandedKey } because the exact reportingQuery column ORDER for the
 * login/logout report was NOT captured live (SPRINKLR_LIVE_REPORTING_FINDINGS.md §"Honest limits").
 *
 * ⚠ CONFIRM-WITH-DIRECTOR: the field DETECTION below (which value is login vs logout vs
 * logged-in-duration, which measure key is the logged-in time) is inferred from the documented
 * column list, NOT from a real captured payload. When the Director opens the login/logout report
 * (USER_AVAILABILITY_SLA_REPORT_V2) and provides the real JSON, tighten `parseLoginLogout` to the
 * confirmed key names — the staged `payload` keeps the raw shape so no re-capture is needed.
 *
 * Documented login/logout columns (FINDINGS): Login timestamp · Logout timestamp ·
 *   Logged-In Time · Logout Cause · Device Type  (+ Agent Email as the row dimension).
 * Documented survey columns (FINDINGS §12): Date · Agent Email ID · Channel Type ·
 *   "Were we able to resolve your issue today?" (Yes/No) · Survey Response Count.
 */

export type SprinklrReportType = 'login_logout' | 'survey' | 'agent_perf' | 'unknown';

/** One captured row as produced by the extension harvester (see chrome-extension/content.js). */
export interface RawReportItem {
  dims: Record<string, any>;
  measures: Record<string, number>;
  /** ORIGINAL_EXPANDED_KEY — the dimension tuple Sprinklr returns for a grouped row. */
  expandedKey?: any[];
}

export interface NormalizedLoginLogout {
  agent_email: string | null;
  day: string | null;          // YYYY-MM-DD (Kuwait local as reported)
  login_min: number | null;    // minutes since midnight of `day`
  logout_min: number | null;
  logged_in_sec: number | null;
  logout_cause: string | null;
  device: string | null;
  /** true when a field could not be confidently detected — flags rows needing the real mapping. */
  needs_confirmation?: boolean;
}

export interface NormalizedSurvey {
  agent_email: string | null;
  day: string | null;
  channel: string | null;
  resolved: boolean | null;    // "Were we able to resolve?" Yes=true / No=false
  response_count: number | null;
}

// ── low-level value detectors ────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
// ISO or "YYYY-MM-DD HH:mm[:ss]" or "DD/MM/YYYY HH:mm" or a bare clock "HH:mm[:ss] AM/PM"
const DATETIME_RE = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
const CLOCK_RE = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*$/i;
const DEVICE_RE = /\b(web|desktop|mobile|android|ios|iphone|tablet|browser|chrome|firefox|app)\b/i;
const YESNO_RE = /^(yes|no|true|false)$/i;
const CHANNEL_RE = /\b(whatsapp|whats app|chat|email|voice|call|sms|social|instagram|facebook|twitter|messenger|line|telegram)\b/i;

export const isEmail = (v: any): v is string => typeof v === 'string' && EMAIL_RE.test(v.trim());
export const isDateOnly = (v: any): v is string => typeof v === 'string' && DATE_ONLY_RE.test(v.trim());

/** Any value that looks like a point in time (epoch ms number, ISO string, or clock string). */
export function isTimestampish(v: any): boolean {
  if (typeof v === 'number') return v > 1e11;                    // epoch millis
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return DATETIME_RE.test(s) || CLOCK_RE.test(s);
}

/** Epoch-ms | ISO | "HH:mm[:ss] AM/PM" → minutes since local midnight, or null. */
export function toMinutesOfDay(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && v > 1e11) {
    const d = new Date(v);
    return d.getUTCHours() * 60 + d.getUTCMinutes(); // caller supplies local-epoch; kept simple for A0
  }
  const s = String(v).trim();
  const dt = s.match(DATETIME_RE) ? s.match(/[ T](\d{2}):(\d{2})/) : null;
  if (dt) return (+dt[1]) * 60 + (+dt[2]);
  const c = s.match(CLOCK_RE);
  if (c) {
    let h = +c[1]; const m = +c[2]; const ap = c[4]?.toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  return null;
}

/** "1h 2m 3s" | "02:30:00" | "150" (already sec) | bare minutes → seconds, or null. */
export function toSeconds(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);              // assume the measure is already seconds
  const s = String(v).trim();
  if (!s) return null;
  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) return (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]);
  let sec = 0; let hit = false;
  const h = s.match(/(\d+)\s*h/i); if (h) { sec += +h[1] * 3600; hit = true; }
  const m = s.match(/(\d+)\s*m(?!s)/i); if (m) { sec += +m[1] * 60; hit = true; }
  const ss = s.match(/(\d+)\s*s/i); if (ss) { sec += +ss[1]; hit = true; }
  if (hit) return sec;
  if (/^\d+$/.test(s)) return +s;
  return null;
}

/** All scalar values of a row across dims + expandedKey (flattened, in a stable order). */
function rowValues(item: RawReportItem): any[] {
  const vals: any[] = [];
  if (Array.isArray(item.expandedKey)) vals.push(...item.expandedKey);
  for (const v of Object.values(item.dims || {})) {
    if (Array.isArray(v)) vals.push(...v);
    else vals.push(v);
  }
  return vals;
}

// ── classification ───────────────────────────────────────────────────────────
/**
 * Classify a reporting TABLE from a sample of its rows. Distinguishes the three A0 report
 * families from the live agent-STATUS poll the extension already handles (whose expandedKey
 * is [id, statusLabel, loginStatusLabel] — strings, no timestamps, no Yes/No).
 */
export function classifyReport(items: RawReportItem[]): SprinklrReportType {
  let email = false, yesno = false, ts = false, dateOnly = false, loginMeasure = false, channel = false;
  for (const it of items.slice(0, 50)) {
    for (const v of rowValues(it)) {
      if (isEmail(v)) email = true;
      else if (typeof v === 'string' && YESNO_RE.test(v.trim())) yesno = true;
      else if (typeof v === 'string' && CHANNEL_RE.test(v)) channel = true;
      if (isDateOnly(v)) dateOnly = true;
      else if (isTimestampish(v)) ts = true;
    }
    for (const k of Object.keys(it.measures || {})) {
      if (/LOGGED?_?IN|LOGIN|LOGOUT|AVAILABILITY|ONLINE_?TIME/i.test(k)) loginMeasure = true;
    }
  }
  if (email && yesno && channel) return 'survey';
  if (email && yesno) return 'survey';
  if (ts && (loginMeasure || email)) return 'login_logout';
  if (email || dateOnly) return 'agent_perf';
  return 'unknown';
}

// ── login/logout normalizer ──────────────────────────────────────────────────
export function parseLoginLogout(items: RawReportItem[]): NormalizedLoginLogout[] {
  return items.map((it) => {
    const vals = rowValues(it);
    const email = vals.find(isEmail) ?? null;
    const day = (vals.find(isDateOnly) as string | undefined)
      ?? (() => { const t = vals.find((v) => typeof v === 'string' && DATETIME_RE.test(v)); const m = t && String(t).match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; })();

    // timestamps, in the order they appear → first = login, second = logout
    const tsVals = vals.filter(isTimestampish);
    const loginRaw = tsVals[0] ?? null;
    const logoutRaw = tsVals.length > 1 ? tsVals[tsVals.length - 1] : null;

    // logged-in duration: prefer a measure keyed like LOGGED_IN, else a duration-looking string value
    let loggedInSec: number | null = null;
    for (const [k, v] of Object.entries(it.measures || {})) {
      if (/LOGGED?_?IN|ONLINE_?TIME|AVAILABILITY/i.test(k)) { loggedInSec = toSeconds(v); break; }
    }
    if (loggedInSec == null) {
      const dur = vals.find((v) => typeof v === 'string' && /^(\d{1,2}:\d{2}:\d{2}|\d+\s*[hms])/i.test(v) && !isTimestampish(v));
      if (dur != null) loggedInSec = toSeconds(dur);
    }

    // logout cause: a non-email, non-timestamp, non-device, non-number string that isn't the day
    const cause = vals.find((v: any) => typeof v === 'string' && !EMAIL_RE.test(v) && !isTimestampish(v)
      && !DATE_ONLY_RE.test(v) && !DEVICE_RE.test(v) && !CLOCK_RE.test(v)
      && v.trim().length > 0 && v.trim().length < 60) ?? null;
    const device = vals.find((v) => typeof v === 'string' && DEVICE_RE.test(v)) ?? null;

    const login_min = toMinutesOfDay(loginRaw);
    const logout_min = toMinutesOfDay(logoutRaw);
    const needs = email == null || (login_min == null && logout_min == null);
    return {
      agent_email: email ? String(email).toLowerCase() : null,
      day: day ?? null,
      login_min,
      logout_min,
      logged_in_sec: loggedInSec,
      logout_cause: cause ? String(cause).trim() : null,
      device: device ? String(device).trim() : null,
      needs_confirmation: needs || undefined,
    };
  });
}

// ── survey normalizer ────────────────────────────────────────────────────────
export function parseSurvey(items: RawReportItem[]): NormalizedSurvey[] {
  return items.map((it) => {
    const vals = rowValues(it);
    const email = vals.find(isEmail) ?? null;
    const day = (vals.find(isDateOnly) as string | undefined) ?? null;
    const channel = vals.find((v) => typeof v === 'string' && CHANNEL_RE.test(v)) ?? null;
    const yesno = vals.find((v) => typeof v === 'string' && YESNO_RE.test(v.trim()));
    let resolved: boolean | null = null;
    if (yesno != null) resolved = /^(yes|true)$/i.test(String(yesno).trim());

    // response count: prefer a measure, else the first standalone number value
    let count: number | null = null;
    const measVals = Object.values(it.measures || {}).filter((v) => typeof v === 'number');
    if (measVals.length) count = measVals[0] as number;
    else {
      const n = vals.find((v) => typeof v === 'number');
      if (typeof n === 'number') count = n;
    }
    return {
      agent_email: email ? String(email).toLowerCase() : null,
      day: day ?? null,
      channel: channel ? String(channel).trim() : null,
      resolved,
      response_count: count,
    };
  });
}

/**
 * Flatten a raw `data.reportingQuery` response (as the extension sees it) into RawReportItem[].
 * Kept here so tests can build a realistic reportingQuery fixture and prove the whole chain,
 * and so A1 can feed a re-captured raw payload directly through the same code path.
 */
export function flattenReportingQuery(rqResponse: any): RawReportItem[] {
  const rq = rqResponse?.reportingQuery || rqResponse?.data?.reportingQuery || rqResponse;
  const out: RawReportItem[] = [];
  const take = (item: any) => {
    if (!item || typeof item !== 'object') return;
    const dims: Record<string, any> = {};
    const measures: Record<string, number> = {};
    if (item.groupDetails?.name != null) dims.groupName = item.groupDetails.name;
    if (item.key != null) dims.key = item.key;
    const addl = item.additional || {};
    for (const [k, v] of Object.entries(addl)) {
      if (k === 'ORIGINAL_EXPANDED_KEY') continue;
      if (typeof v === 'string' || typeof v === 'number') dims[k] = v;
    }
    for (const src of [item.projections, item.measurements]) {
      if (src && typeof src === 'object') {
        for (const [k, v] of Object.entries(src)) if (typeof v === 'number') measures[k] = v;
      }
    }
    out.push({ dims, measures, expandedKey: Array.isArray(addl.ORIGINAL_EXPANDED_KEY) ? addl.ORIGINAL_EXPANDED_KEY : undefined });
  };
  for (const resp of (rq?.responses || [])) {
    for (const g of (resp?.groupedData || [])) for (const item of (g?.responses || [])) take(item);
    for (const hit of (resp?.hits || [])) take(hit);
    for (const r of (resp?.rows || [])) take(r);
  }
  return out;
}
