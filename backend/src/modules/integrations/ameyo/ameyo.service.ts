import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Ameyo bridge brain — mirrors the Sprinklr service pattern but for telephony.
 * The Chrome extension pushes raw live-monitoring snapshots (agents list + KPI
 * cards); this service NORMALIZES the raw Ameyo status vocabulary into canonical
 * agent states, computes the live KPIs + occupancy, links each Ameyo agent to a
 * WFM employee (by login username → users/roster), and serves a stale-aware live
 * view (adaptive richness so a degenerate tail capture never hides the real board).
 *
 * The raw field names differ per Ameyo build, so every read is defensive (tries
 * several likely keys). Confirm the exact vocabulary from a real "copy samples"
 * capture and extend AMEYO_STATUS below — the mapping lives HERE, in the engine.
 */

export type AmeyoState = 'available' | 'busy' | 'acw' | 'hold' | 'break' | 'idle' | 'offline' | 'unknown';

// Raw Ameyo status → canonical state. Longest/most-specific patterns first.
const STATE_RULES: [RegExp, AmeyoState][] = [
  [/log(ged)?\s*out|logout|offline|not\s*logged|sign(ed)?\s*out/i, 'offline'],
  [/wrap|acw|after\s*call|disposition|dispos/i, 'acw'],
  [/on\s*hold|hold/i, 'hold'],
  [/break|aux|lunch|tea|bio|prayer|namaz|meeting|training|rest|not\s*ready|nr\b|away/i, 'break'],
  [/in\s*call|on\s*call|talk|connected|busy|dialing|dialer|preview|ringing|conference/i, 'busy'],
  [/ready|available|idle\s*ready|waiting/i, 'available'],
  [/idle|inactive|free/i, 'idle'],
];

export function normalizeAmeyoState(raw: any): AmeyoState {
  const s = String(raw ?? '').trim();
  if (!s) return 'unknown';
  for (const [re, st] of STATE_RULES) if (re.test(s)) return st;
  return 'unknown';
}

const pick = (o: any, keys: string[]): any => {
  if (!o || typeof o !== 'object') return null;
  const lower: Record<string, any> = {};
  for (const k of Object.keys(o)) lower[k.toLowerCase().replace(/[\s_-]/g, '')] = o[k];
  for (const k of keys) { const v = lower[k.toLowerCase().replace(/[\s_-]/g, '')]; if (v != null && v !== '') return v; }
  return null;
};

const cleanName = (n: any) => String(n ?? '').replace(/\s+/g, ' ').trim();
const slug = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

@Injectable()
export class AmeyoService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // employee link cache (username/name → employee) — refreshed lazily, cheap
  private linkCache: { at: number; byUser: Map<string, any>; byName: Map<string, any> } | null = null;

  private async employeeIndex(tid: string) {
    if (this.linkCache && Date.now() - this.linkCache.at < 10 * 60_000) return this.linkCache;
    const byUser = new Map<string, any>(), byName = new Map<string, any>();
    // primary: users.username → employee; secondary: roster_days.username / clean_name
    const rows = await this.ds.query(
      `SELECT LOWER(u.username) uname, u.employee_id, e.employee_no, e.first_name, e.last_name
         FROM users u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.tenant_id = $1 AND u.username IS NOT NULL`, [tid]).catch(() => []);
    for (const r of rows) {
      const rec = { employeeId: r.employee_id, employeeNo: r.employee_no, name: cleanName(`${r.first_name || ''} ${r.last_name || ''}`) };
      if (r.uname) byUser.set(r.uname, rec);
      if (rec.name) byName.set(slug(rec.name), rec);
    }
    const rd = await this.ds.query(
      `SELECT DISTINCT ON (LOWER(username)) LOWER(username) uname, person_no, clean_name, role_function
         FROM roster_days WHERE tenant_id = $1 AND username IS NOT NULL AND is_active
        ORDER BY LOWER(username), work_date DESC`, [tid]).catch(() => []);
    for (const r of rd) {
      const rec = { employeeId: null, employeeNo: r.person_no, name: cleanName(r.clean_name), fn: r.role_function };
      if (r.uname && !byUser.has(r.uname)) byUser.set(r.uname, rec);
      if (rec.name && !byName.has(slug(rec.name))) byName.set(slug(rec.name), rec);
    }
    this.linkCache = { at: Date.now(), byUser, byName };
    return this.linkCache;
  }

  private linkAgent(idx: { byUser: Map<string, any>; byName: Map<string, any> }, agent: any) {
    const uname = slug(pick(agent, ['username', 'userId', 'user_id', 'agentId', 'agent_id', 'loginId', 'extension', 'ext']));
    if (uname && idx.byUser.has(uname)) return idx.byUser.get(uname);
    const nm = slug(pick(agent, ['name', 'agentName', 'agent_name', 'fullName']));
    if (nm && idx.byName.has(nm)) return idx.byName.get(nm);
    return null;
  }

  /** Latest Ameyo snapshot with adaptive richness — a degenerate 1-agent tail never hides the real board. */
  private async latestRich(tid: string) {
    const [row] = await this.ds.query(
      `WITH recent AS (
         SELECT captured_at, queues_json, agents_json, agent_count, queue_count
           FROM integration_snapshots WHERE tenant_id=$1 AND source='ameyo'
          ORDER BY captured_at DESC LIMIT 200)
       SELECT * FROM recent
        WHERE agent_count >= GREATEST(1, (SELECT MAX(agent_count) FROM recent) / 2)
        ORDER BY captured_at DESC LIMIT 1`, [tid]).catch(() => []);
    return row || null;
  }

  /** Normalized live view: canonical agent states + computed KPIs + employee links + stale flag. */
  async getLive(tid: string) {
    const row = await this.latestRich(tid);
    if (!row) return { capturedAt: null, stale: true, staleSec: null, kpis: emptyKpis(), agents: [], queues: [], rawKpis: {} };
    const idx = await this.employeeIndex(tid);
    const rawAgents: any[] = Array.isArray(row.agents_json) ? row.agents_json : [];
    const qj = row.queues_json || {};

    const agents = rawAgents.map((a) => {
      const statusRaw = pick(a, ['status', 'agentStatus', 'agent_status', 'state', 'agentState']) ?? '';
      const callStatus = pick(a, ['callStatus', 'agentCallStatus', 'agent_call_status', 'call_status']);
      const link = this.linkAgent(idx, a);
      const state = normalizeAmeyoState(statusRaw || callStatus);
      return {
        name: cleanName(pick(a, ['name', 'agentName', 'agent_name', 'fullName'])) || link?.name || '—',
        agentId: pick(a, ['agentId', 'agent_id', 'username', 'userId', 'user_id', 'extension']) ?? null,
        employeeNo: link?.employeeNo ?? null,
        employeeId: link?.employeeId ?? null,
        linked: !!link,
        state,
        statusRaw: String(statusRaw || callStatus || '').trim() || null,
        callStatus: callStatus ?? null,
        callType: pick(a, ['callType', 'call_type']) ?? null,
        autoCall: pick(a, ['autoCallStatus', 'auto_call_status', 'autoCall']) ?? null,
        phone: pick(a, ['phone', 'phoneNumber', 'customerNumber']) ?? null,
        customerStatus: pick(a, ['customerCallStatus', 'customer_call_status', 'custStatus']) ?? null,
      };
    });

    const kpis = computeKpis(agents, qj.kpis || {});
    const staleSec = Math.round((Date.now() - new Date(row.captured_at).getTime()) / 1000);
    return {
      capturedAt: row.captured_at,
      stale: staleSec > 120,
      staleSec,
      kpis,
      rawKpis: qj.kpis || {},
      queues: Array.isArray(qj.queues) ? qj.queues : [],
      agents,
      linkedCount: agents.filter((a) => a.linked).length,
    };
  }
}

function emptyKpis() {
  return { total: 0, online: 0, available: 0, busy: 0, acw: 0, hold: 0, break: 0, idle: 0, offline: 0, occupancyPct: null as number | null };
}

function computeKpis(agents: any[], rawKpis: Record<string, any>) {
  const k = emptyKpis();
  k.total = agents.length;
  for (const a of agents) { if (k[a.state as keyof typeof k] != null) (k as any)[a.state]++; }
  k.online = k.available + k.busy + k.acw + k.hold + k.idle + k.break;
  const handling = k.busy + k.acw + k.hold;
  const productive = handling + k.available + k.idle;      // exclude break/offline from occupancy base
  k.occupancyPct = productive > 0 ? Math.round((handling / productive) * 100) : null;
  return k;
}
