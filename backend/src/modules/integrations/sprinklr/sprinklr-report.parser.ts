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

export type SprinklrReportType = 'login_logout' | 'survey' | 'agent_perf' | 'agent_summary' | 'unknown';

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

/**
 * One normalized Agent Summary row (voice/Inbound agent performance, grain = agent × day).
 * Columns from the Director's report: Date · User · Offered · Taken · Not taken · User Email ·
 * Unique Profiles (Agent) · Talk Time · Avg Talk Time · Hold Time · Avg Hold Time · After Call up Time
 * (+ optional Avg After Call). Durations arrive as "03h 38m" / "02m 27s" / "12s" strings (or M_* secs).
 */
export interface NormalizedAgentSummary {
  agent_email: string | null;
  user: string | null;             // agent display name
  day: string | null;              // YYYY-MM-DD
  offered: number | null;          // contacts offered (received)
  taken: number | null;            // contacts handled / answered
  notTaken: number | null;         // missed / abandoned
  uniqueProfiles: number | null;
  talkSecTotal: number | null;
  talkSecAvg: number | null;
  holdSecTotal: number | null;
  holdSecAvg: number | null;
  acwSecTotal: number | null;      // After Call up Time (wrap) total
  acwSecAvg: number | null;        // per-call ACW (derived from total/taken when the avg column is absent)
  ahtSec: number | null;           // avg talk + avg hold + avg ACW (seconds)
  /** the original captured row, so columns we did not map are never lost. */
  rawSample?: RawReportItem;
  needs_confirmation?: boolean;
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

/** "90" | "1,234" | 90 → integer, or null. */
export function toInt(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim().replace(/,/g, '');
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Math.round(parseFloat(s));
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Thu, Jul 02, 2026" | "Jul 02, 2026" | "2026-07-02" | "02/07/2026" → YYYY-MM-DD, or null. */
export function normalizeReportDate(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (DATE_ONLY_RE.test(s)) return s;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // "Thu, Jul 02, 2026" / "Jul 2, 2026"
  const named = s.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/);
  if (named) {
    const mo = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (mo) return `${named[3]}-${String(mo).padStart(2, '0')}-${String(+named[2]).padStart(2, '0')}`;
  }
  // "02/07/2026" or "2/7/2026" — assume DD/MM/YYYY (report locale)
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${String(+dmy[2]).padStart(2, '0')}-${String(+dmy[1]).padStart(2, '0')}`;
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
export function classifyReport(items: RawReportItem[], columns?: ReportColumn[]): SprinklrReportType {
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
  // Agent Summary (voice agent perf) is the MOST specific — it carries the Offered/Taken/Talk/Hold
  // signature and NO Yes/No. Detect it before survey/login_logout so it never mis-buckets.
  if (email && !yesno && looksLikeAgentSummary(items, columns)) return 'agent_summary';
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

// ── agent-summary (voice agent performance) ──────────────────────────────────
export interface ReportColumn { key: string; label?: string | null; }

/** Which Agent-Summary field a column header / measure key maps to (contains-rules, avg-aware). */
type AgentSummaryField =
  | 'email' | 'date' | 'user' | 'offered' | 'taken' | 'notTaken' | 'uniqueProfiles'
  | 'talkTotal' | 'talkAvg' | 'holdTotal' | 'holdAvg' | 'acwTotal' | 'acwAvg' | null;

const norm = (k: string) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Classify a column header / measure key to its Agent-Summary field. Works for both the human
 * labels ("Average Talk Time", "After Call up Time", "User Email") and Sprinklr measure keys
 * ("M_AVG_TALK_TIME", "M_AFTER_CALL_UP_TIME"). Order matters: specific/avg before generic/total.
 */
export function classifyAgentSummaryKey(rawKey: string): AgentSummaryField {
  const k = norm(rawKey);
  if (!k) return null;
  if (k.includes('email')) return 'email';
  if (k === 'date' || k.endsWith('date') || k.includes('day')) return 'date';
  if (k.includes('nottaken') || k.includes('missed') || k.includes('abandon') ||
      (k.includes('not') && k.includes('taken'))) return 'notTaken';
  if (k.includes('offered')) return 'offered';
  if (k.includes('taken') || k.includes('handled') || k.includes('answered')) return 'taken';
  if (k.includes('unique')) return 'uniqueProfiles';
  const avg = k.includes('avg') || k.includes('average');
  if (k.includes('talk')) return avg ? 'talkAvg' : 'talkTotal';
  if (k.includes('hold')) return avg ? 'holdAvg' : 'holdTotal';
  if (k.includes('aftercall') || k.includes('acw') || k.includes('wrapup') || k.includes('wrap'))
    return avg ? 'acwAvg' : 'acwTotal';
  if (k.includes('user') || k.includes('agent') || k.includes('name')) return 'user';
  return null;
}

/** Build a field→value cell map for one row from named dims + measures + (positional expandedKey via columns). */
function agentSummaryCells(item: RawReportItem, columns?: ReportColumn[]): Partial<Record<Exclude<AgentSummaryField, null>, any>> {
  const cells: Partial<Record<Exclude<AgentSummaryField, null>, any>> = {};
  const put = (field: AgentSummaryField, val: any) => {
    if (!field || val == null || val === '') return;
    if (cells[field] == null) cells[field] = val; // first non-null wins
  };
  // named dims + measures carry their own header/measure keys
  for (const [k, v] of Object.entries(item.dims || {})) {
    if (k === 'key') continue;                 // numeric agent id — not a metric
    if (k === 'groupName') { put('user', v); continue; }
    put(classifyAgentSummaryKey(k), v);
  }
  for (const [k, v] of Object.entries(item.measures || {})) put(classifyAgentSummaryKey(k), v);
  // positional dimension tuple, named by the report's declared column order when provided
  if (Array.isArray(item.expandedKey) && columns && columns.length) {
    item.expandedKey.forEach((val, i) => {
      const col = columns[i];
      if (col) put(classifyAgentSummaryKey(col.label || col.key), val);
    });
  }
  return cells;
}

/**
 * Normalize captured Agent-Summary rows. Durations ("03h 38m" / "02m 27s" / "12s") and M_* second
 * measures both flow through toSeconds. AHT = avg talk + avg hold + avg ACW; when a column only ships
 * the TOTAL (no per-call avg), the avg is derived as total/taken. Unmapped columns are preserved in rawSample.
 */
export function parseAgentSummary(items: RawReportItem[], columns?: ReportColumn[]): NormalizedAgentSummary[] {
  return items.map((it) => {
    const c = agentSummaryCells(it, columns);
    const vals = rowValues(it);

    // email/day resilience: fall back to a type-scan of raw values when the header didn't name them
    const email = (c.email && isEmail(c.email) ? String(c.email) : null) ?? (vals.find(isEmail) ?? null);
    const day = normalizeReportDate(c.date)
      ?? (() => { for (const v of vals) { const d = normalizeReportDate(v); if (d) return d; } return null; })();

    const offered = toInt(c.offered);
    const taken = toInt(c.taken);
    const notTaken = toInt(c.notTaken);
    const uniqueProfiles = toInt(c.uniqueProfiles);

    const talkSecTotal = toSeconds(c.talkTotal);
    let talkSecAvg = toSeconds(c.talkAvg);
    const holdSecTotal = toSeconds(c.holdTotal);
    let holdSecAvg = toSeconds(c.holdAvg);
    const acwSecTotal = toSeconds(c.acwTotal);
    let acwSecAvg = toSeconds(c.acwAvg);

    // derive per-call averages from totals when the report omitted the avg column
    const perCall = (total: number | null) => (total != null && taken && taken > 0 ? total / taken : null);
    if (talkSecAvg == null) talkSecAvg = perCall(talkSecTotal);
    if (holdSecAvg == null) holdSecAvg = perCall(holdSecTotal);
    if (acwSecAvg == null) acwSecAvg = perCall(acwSecTotal);

    // AHT = avg talk + avg hold + avg ACW (whichever components exist)
    let ahtSec: number | null = null;
    const comps = [talkSecAvg, holdSecAvg, acwSecAvg].filter((x): x is number => x != null);
    if (comps.length) ahtSec = Math.round(comps.reduce((s, x) => s + x, 0) * 100) / 100;

    const user = (typeof c.user === 'string' && !isEmail(c.user)) ? String(c.user).trim() : null;
    const needs = email == null || (talkSecTotal == null && offered == null && taken == null);

    return {
      agent_email: email ? String(email).toLowerCase() : null,
      user,
      day,
      offered, taken, notTaken, uniqueProfiles,
      talkSecTotal, talkSecAvg: talkSecAvg == null ? null : Math.round(talkSecAvg * 100) / 100,
      holdSecTotal, holdSecAvg: holdSecAvg == null ? null : Math.round(holdSecAvg * 100) / 100,
      acwSecTotal, acwSecAvg: acwSecAvg == null ? null : Math.round(acwSecAvg * 100) / 100,
      ahtSec,
      rawSample: it,
      needs_confirmation: needs || undefined,
    };
  });
}

/** True when a captured table carries the Agent-Summary signature (Offered/Taken/Talk/Hold + email, no Yes/No). */
export function looksLikeAgentSummary(items: RawReportItem[], columns?: ReportColumn[]): boolean {
  let email = false, perf = false, yesno = false;
  const noteKey = (k: string) => {
    const f = classifyAgentSummaryKey(k);
    if (f === 'talkTotal' || f === 'talkAvg' || f === 'holdTotal' || f === 'holdAvg' ||
        f === 'acwTotal' || f === 'acwAvg' || f === 'offered' || f === 'taken') perf = true;
  };
  for (const col of (columns || [])) { noteKey(col.label || col.key || ''); if (col.label && isEmail(col.label)) {} }
  for (const it of items.slice(0, 50)) {
    for (const k of Object.keys(it.dims || {})) noteKey(k);
    for (const k of Object.keys(it.measures || {})) noteKey(k);
    for (const v of rowValues(it)) {
      if (isEmail(v)) email = true;
      else if (typeof v === 'string' && YESNO_RE.test(v.trim())) yesno = true;
    }
  }
  return email && perf && !yesno;
}

/** Resolved cross-system identity for one agent (from employee_identity_map / sprinklr_agent_map). */
export interface AgentIdentity { sprinklrAgentId?: string | null; employeeId?: string | null; }

/** The exact agent_daily_stats column values for one Agent-Summary row (pure — DB-free, so it is unit-testable). */
export interface AgentDailyStatUpsert {
  stat_date: string | null;
  sprinklr_agent_id: string | null;
  agent_name: string | null;
  agent_email: string | null;
  employee_id: string | null;
  contacts_received: number | null;   // ← offered (contacts received/demand); handled kept in extra
  aht_seconds: number | null;          // ← computed AHT
  avg_response_seconds: number | null; // report carries no first-response time → null
  extra: Record<string, any>;          // talk/hold/acw seconds + offered/handled/etc. + rawRow
}

/**
 * Map a normalized Agent-Summary row → the agent_daily_stats upsert values. agent_daily_stats has no
 * dedicated talk/hold/acw columns, so those live in `extra`; the dedicated aht_seconds + contacts_received
 * columns are what the Builder agent_ops source and the Inbound scorecard AHT read. When the email has no
 * resolved numeric Sprinklr id, a deterministic `email:<addr>` key keeps the upsert idempotent (and never
 * collides with — nor double-counts against — the live-status path, whose rows carry the busy/idle minutes).
 */
export function agentSummaryToStatRow(n: NormalizedAgentSummary, resolved: AgentIdentity = {}): AgentDailyStatUpsert {
  return {
    stat_date: n.day,
    sprinklr_agent_id: resolved.sprinklrAgentId || (n.agent_email ? `email:${n.agent_email}` : null),
    agent_name: n.user,
    agent_email: n.agent_email,
    employee_id: resolved.employeeId ?? null,
    contacts_received: n.offered ?? n.taken ?? null,
    aht_seconds: n.ahtSec,
    avg_response_seconds: null,
    extra: {
      source: 'agent_summary',
      offered: n.offered,
      handled: n.taken,          // "Taken"
      notTaken: n.notTaken,
      uniqueProfiles: n.uniqueProfiles,
      talkSecTotal: n.talkSecTotal,
      talkSecAvg: n.talkSecAvg,
      holdSecTotal: n.holdSecTotal,
      holdSecAvg: n.holdSecAvg,
      acwSecTotal: n.acwSecTotal,
      acwSecAvg: n.acwSecAvg,
      ahtSec: n.ahtSec,
      rawRow: n.rawSample ? { dims: n.rawSample.dims, measures: n.rawSample.measures, expandedKey: n.rawSample.expandedKey } : undefined,
    },
  };
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
