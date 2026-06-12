import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';

/* ─── Week assignment: W1=1-7, W2=8-15, W3=16-22, W4=23+ ─────────────────── */
function weekLabel(day: number): string {
  if (day <= 7)  return 'W1';
  if (day <= 15) return 'W2';
  if (day <= 22) return 'W3';
  return 'W4';
}

/* ─── Flexible column detection ──────────────────────────────────────────── */
const HEADER_MAP: Record<string, string[]> = {
  date:          ['date','day','تاريخ','timestamp','datetime','وقت','الوقت','hour','ساعة','interval'],
  agentName:     ['agent','agent name','employee','name','موظف','اسم الموظف','الموظف','acd agent','user','username','full name'],
  agentLogin:    ['login','user id','userid','login id','extension','agent id','agentid','user login','agent login'],
  agentNo:       ['employee no','emp no','employee id','emp id','staff id','رقم الموظف'],
  functionName:  ['function','queue','skill','department','team','skill group','channel','dnis','الفريق','القسم','skill name'],
  teamLeader:    ['tl','team leader','supervisor','manager','المشرف','team manager'],
  contacts:      ['contacts','calls','calls handled','handled','count','volume','interactions','answered','total calls','chats','emails','total contacts','contacts handled'],
  aht:           ['aht','average handle time','avg handle time','handle time','aht (sec)','aht(sec)','aht secs','aht seconds','aht(s)','average handling time','avg aht','talk time + acw','aht (seconds)'],
  responseTime:  ['response time','first response','avg response','avg first response','avg first response time','average first response','first response time (sec)','response (sec)','frt','first reply time'],
  loginHours:    ['login hours','hours','login time','productive hours','logged hours','shift hours','work hours','total hours','available time','login duration'],
  loginMinutes:  ['login minutes','login min','minutes','total minutes','available minutes'],
  quality:       ['quality','qa','quality score','qa score','quality %','qa %','المراقبة','جودة'],
  csat:          ['csat','customer satisfaction','satisfaction','nps'],
  transfers:     ['transfers','transfer count','transferred calls'],
  holds:         ['holds','hold count','total holds'],
};

function detectColumn(header: string): string | null {
  const h = header.toLowerCase().trim();
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    if (aliases.some(a => h === a || h.includes(a))) return field;
  }
  return null;
}

/* ─── Parse a date cell that could be a number (Excel serial), string, or Date */
function parseDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(d.y, d.m - 1, d.d, d.H ?? 0, d.M ?? 0, d.S ?? 0);
  }
  const s = String(val).trim();
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed;
  // try DD/MM/YYYY format
  const ddmm = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (ddmm) {
    const [, d, m, y] = ddmm;
    const year = y.length === 2 ? 2000 + +y : +y;
    return new Date(year, +m - 1, +d);
  }
  return null;
}

function parseSeconds(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    // If it looks like an Excel time fraction (< 1), convert to seconds
    if (val > 0 && val < 1) return Math.round(val * 86400);
    return Math.round(val);  // assume already seconds
  }
  const s = String(val).trim();
  // mm:ss or hh:mm:ss format
  const parts = s.split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  const n = parseFloat(s);
  if (!isNaN(n)) {
    // Heuristic: if number is <1, treat as Excel fraction (day); if <1000, seconds; if >1000, ms
    if (n < 1) return Math.round(n * 86400);
    return Math.round(n);
  }
  return null;
}

function parseMinutes(val: any): number | null {
  const s = parseSeconds(val);
  if (s === null) return null;
  return s / 60;
}

/* ─── Aggregation key ────────────────────────────────────────────────────── */
interface RawRow {
  date: Date;
  agentName: string;
  agentLogin: string;
  agentNo: string;
  functionName: string;
  teamLeader: string;
  contacts: number;
  ahtSeconds: number | null;
  responseSeconds: number | null;
  loginMinutes: number;
  quality: number | null;
  csat: number | null;
  transfers: number;
  holds: number;
}

export interface AgentWeekSummary {
  agentName: string;
  agentLogin: string;
  agentNo: string;
  functionName: string;
  teamLeader: string;
  weekLabel: string;
  dateFrom: string;
  dateTo: string;
  workingDays: number;
  totalContacts: number;
  totalLoginMinutes: number;
  avgAhtSeconds: number | null;
  minAhtSeconds: number | null;
  maxAhtSeconds: number | null;
  avgResponseSeconds: number | null;
  minResponseSeconds: number | null;
  maxResponseSeconds: number | null;
  avgQuality: number | null;
  avgCsat: number | null;
  totalTransfers: number;
  totalHolds: number;
  productivityPct: number | null;
  workingDaysPct: number | null;
}

export interface ParsedSourceData {
  periodName: string;
  periodYear: number;
  periodMonth: number;
  totalRows: number;
  totalAgents: number;
  channelType: string;
  functions: string[];
  weekSummaries: AgentWeekSummary[];
  weekCounts: Record<string, number>;
}

@Injectable()
export class KpiSourceService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ── Parse preview ──────────────────────────────────────────────────────── */
  parse(buffer: Buffer, filename: string): ParsedSourceData {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    if (rows.length < 2) throw new BadRequestException('File has no data rows.');

    // Find header row (first row with at least 3 non-empty cells)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const nonEmpty = (rows[i] ?? []).filter(c => c !== null && c !== undefined && c !== '').length;
      if (nonEmpty >= 3) { headerRowIdx = i; break; }
    }

    const headers = (rows[headerRowIdx] ?? []).map((h: any) => String(h ?? ''));
    const colMap: Record<string, number> = {};
    headers.forEach((h, i) => {
      const field = detectColumn(h);
      if (field && !(field in colMap)) colMap[field] = i;
    });

    if (!('date' in colMap)) throw new BadRequestException('No date column found. Expected a column named "date", "day", or similar.');
    if (!('agentName' in colMap) && !('agentLogin' in colMap)) {
      throw new BadRequestException('No agent/employee column found.');
    }

    // Parse raw rows
    const rawRows: RawRow[] = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const dateVal = r[colMap.date];
      const date = parseDate(dateVal);
      if (!date || isNaN(date.getTime())) continue;

      const agentName  = String(r[colMap.agentName]  ?? r[colMap.agentLogin] ?? '').trim();
      const agentLogin = String(r[colMap.agentLogin] ?? r[colMap.agentName]  ?? '').trim();
      if (!agentName && !agentLogin) continue;

      const contacts = Math.round(Math.abs(parseFloat(String(r[colMap.contacts] ?? '0')) || 0));

      rawRows.push({
        date,
        agentName,
        agentLogin,
        agentNo:        String(r[colMap.agentNo]       ?? '').trim(),
        functionName:   String(r[colMap.functionName]  ?? '').trim(),
        teamLeader:     String(r[colMap.teamLeader]    ?? '').trim(),
        contacts,
        ahtSeconds:     colMap.aht     !== undefined ? parseSeconds(r[colMap.aht])            : null,
        responseSeconds:colMap.responseTime !== undefined ? parseSeconds(r[colMap.responseTime]) : null,
        loginMinutes:   colMap.loginMinutes !== undefined ? (parseMinutes(r[colMap.loginMinutes]) ?? 0) :
                        colMap.loginHours   !== undefined ? ((parseFloat(String(r[colMap.loginHours] ?? '0')) || 0) * 60) : 0,
        quality:        colMap.quality !== undefined ? (parseFloat(String(r[colMap.quality] ?? '')) || null) : null,
        csat:           colMap.csat    !== undefined ? (parseFloat(String(r[colMap.csat]    ?? '')) || null) : null,
        transfers:      colMap.transfers !== undefined ? Math.round(Math.abs(parseFloat(String(r[colMap.transfers] ?? '0')) || 0)) : 0,
        holds:          colMap.holds     !== undefined ? Math.round(Math.abs(parseFloat(String(r[colMap.holds]    ?? '0')) || 0)) : 0,
      });
    }

    if (!rawRows.length) throw new BadRequestException('No valid data rows found after parsing.');

    // Detect period from dates
    const allDates = rawRows.map(r => r.date);
    const minDate  = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate  = new Date(Math.max(...allDates.map(d => d.getTime())));
    const year     = minDate.getFullYear();
    const month    = minDate.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const periodName = `${MONTH_NAMES[month - 1]} ${year}`;

    // Build weekly aggregates
    const weekMap: Record<string, {
      rows: RawRow[]; dates: Set<number>;
    }> = {};

    for (const r of rawRows) {
      const day = r.date.getDate();
      const wk  = weekLabel(day);
      const key = `${r.agentLogin || r.agentName}::${r.functionName}::${wk}`;
      if (!weekMap[key]) weekMap[key] = { rows: [], dates: new Set() };
      weekMap[key].rows.push(r);
      weekMap[key].dates.add(r.date.toDateString() as any);
    }

    const summaries: AgentWeekSummary[] = [];
    const weekCounts: Record<string, number> = { W1: 0, W2: 0, W3: 0, W4: 0 };

    for (const [key, { rows: wRows, dates }] of Object.entries(weekMap)) {
      const [,, wk] = key.split('::');
      const first = wRows[0];
      const wDates = wRows.map(r => r.date.getTime());
      const fromDate = new Date(Math.min(...wDates));
      const toDate   = new Date(Math.max(...wDates));

      const totalContacts = wRows.reduce((s, r) => s + r.contacts, 0);
      const ahtRows = wRows.filter(r => r.ahtSeconds !== null && r.contacts > 0);
      const avgAht  = ahtRows.length ? ahtRows.reduce((s, r) => s + r.ahtSeconds! * r.contacts, 0) / ahtRows.reduce((s, r) => s + r.contacts, 0) : null;
      const minAht  = ahtRows.length ? Math.min(...ahtRows.map(r => r.ahtSeconds!)) : null;
      const maxAht  = ahtRows.length ? Math.max(...ahtRows.map(r => r.ahtSeconds!)) : null;

      const rtRows  = wRows.filter(r => r.responseSeconds !== null);
      const avgRt   = rtRows.length ? rtRows.reduce((s, r) => s + r.responseSeconds!, 0) / rtRows.length : null;
      const minRt   = rtRows.length ? Math.min(...rtRows.map(r => r.responseSeconds!)) : null;
      const maxRt   = rtRows.length ? Math.max(...rtRows.map(r => r.responseSeconds!)) : null;

      const totalLogin = wRows.reduce((s, r) => s + r.loginMinutes, 0);
      const qaRows  = wRows.filter(r => r.quality !== null);
      const avgQa   = qaRows.length ? qaRows.reduce((s, r) => s + r.quality!, 0) / qaRows.length : null;
      const csatRows = wRows.filter(r => r.csat !== null);
      const avgCsat = csatRows.length ? csatRows.reduce((s, r) => s + r.csat!, 0) / csatRows.length : null;

      // Scheduled days for week boundary
      const [wkStart, wkEnd] = weekBounds(wk, year, month, daysInMonth);
      const scheduledDays = wkEnd - wkStart + 1;
      const actualDays = dates.size;
      const wdPct = scheduledDays > 0 ? actualDays / scheduledDays : null;

      const productivityPct = totalLogin > 0 && totalContacts > 0
        ? Math.min(1, (totalContacts * (avgAht ?? 300)) / (totalLogin * 60))
        : null;

      summaries.push({
        agentName:         first.agentName,
        agentLogin:        first.agentLogin,
        agentNo:           first.agentNo,
        functionName:      first.functionName,
        teamLeader:        first.teamLeader,
        weekLabel:         wk,
        dateFrom:          fromDate.toISOString().slice(0, 10),
        dateTo:            toDate.toISOString().slice(0, 10),
        workingDays:       actualDays,
        totalContacts,
        totalLoginMinutes: Math.round(totalLogin),
        avgAhtSeconds:     avgAht  !== null ? +avgAht.toFixed(1)  : null,
        minAhtSeconds:     minAht,
        maxAhtSeconds:     maxAht,
        avgResponseSeconds: avgRt  !== null ? +avgRt.toFixed(1)   : null,
        minResponseSeconds: minRt,
        maxResponseSeconds: maxRt,
        avgQuality:        avgQa   !== null ? +avgQa.toFixed(4)   : null,
        avgCsat:           avgCsat !== null ? +avgCsat.toFixed(4) : null,
        totalTransfers:    wRows.reduce((s, r) => s + r.transfers, 0),
        totalHolds:        wRows.reduce((s, r) => s + r.holds, 0),
        productivityPct:   productivityPct !== null ? +productivityPct.toFixed(4) : null,
        workingDaysPct:    wdPct !== null ? +wdPct.toFixed(4) : null,
      });

      weekCounts[wk] = (weekCounts[wk] ?? 0) + 1;
    }

    // Also compute Final (aggregate of all weeks per agent)
    const agentMap: Record<string, AgentWeekSummary[]> = {};
    for (const s of summaries) {
      const k = s.agentLogin || s.agentName;
      (agentMap[k] = agentMap[k] ?? []).push(s);
    }
    const finalSummaries: AgentWeekSummary[] = [];
    for (const [, agentWeeks] of Object.entries(agentMap)) {
      const first = agentWeeks[0];
      const totalContacts = agentWeeks.reduce((s, w) => s + w.totalContacts, 0);
      const totalLogin    = agentWeeks.reduce((s, w) => s + w.totalLoginMinutes, 0);
      const workingDays   = agentWeeks.reduce((s, w) => s + w.workingDays, 0);
      const scheduledDays = daysInMonth;

      // Weighted avg AHT
      const hasAht = agentWeeks.filter(w => w.avgAhtSeconds !== null && w.totalContacts > 0);
      const avgAht = hasAht.length
        ? hasAht.reduce((s, w) => s + w.avgAhtSeconds! * w.totalContacts, 0) / hasAht.reduce((s, w) => s + w.totalContacts, 0)
        : null;

      const hasRt = agentWeeks.filter(w => w.avgResponseSeconds !== null);
      const avgRt = hasRt.length ? hasRt.reduce((s, w) => s + w.avgResponseSeconds!, 0) / hasRt.length : null;

      const hasQa   = agentWeeks.filter(w => w.avgQuality !== null);
      const avgQa   = hasQa.length ? hasQa.reduce((s, w) => s + w.avgQuality!, 0) / hasQa.length : null;
      const hasCsat = agentWeeks.filter(w => w.avgCsat !== null);
      const avgCsat = hasCsat.length ? hasCsat.reduce((s, w) => s + w.avgCsat!, 0) / hasCsat.length : null;

      finalSummaries.push({
        ...first,
        weekLabel:         'Final',
        dateFrom:          `${year}-${String(month).padStart(2,'0')}-01`,
        dateTo:            `${year}-${String(month).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`,
        workingDays,
        totalContacts,
        totalLoginMinutes: totalLogin,
        avgAhtSeconds:     avgAht  !== null ? +avgAht.toFixed(1)  : null,
        minAhtSeconds:     agentWeeks.flatMap(w => w.minAhtSeconds ?? []).length ? Math.min(...agentWeeks.filter(w => w.minAhtSeconds !== null).map(w => w.minAhtSeconds!)) : null,
        maxAhtSeconds:     agentWeeks.flatMap(w => w.maxAhtSeconds ?? []).length ? Math.max(...agentWeeks.filter(w => w.maxAhtSeconds !== null).map(w => w.maxAhtSeconds!)) : null,
        avgResponseSeconds: avgRt  !== null ? +avgRt.toFixed(1)   : null,
        minResponseSeconds: null,
        maxResponseSeconds: null,
        avgQuality:        avgQa   !== null ? +avgQa.toFixed(4)   : null,
        avgCsat:           avgCsat !== null ? +avgCsat.toFixed(4) : null,
        totalTransfers:    agentWeeks.reduce((s, w) => s + w.totalTransfers, 0),
        totalHolds:        agentWeeks.reduce((s, w) => s + w.totalHolds, 0),
        workingDaysPct:    workingDays / scheduledDays,
        productivityPct:   null,
      });
    }

    const allSummaries = [...summaries, ...finalSummaries];
    const agents = new Set(allSummaries.map(s => s.agentLogin || s.agentName));
    const functions = [...new Set(allSummaries.map(s => s.functionName).filter(Boolean))];
    const channelType = detectChannelType(filename, functions);

    return {
      periodName,
      periodYear: year,
      periodMonth: month,
      totalRows: rawRows.length,
      totalAgents: agents.size,
      channelType,
      functions,
      weekSummaries: allSummaries,
      weekCounts,
    };
  }

  /* ── Commit to DB ──────────────────────────────────────────────────────── */
  async commit(
    buffer: Buffer,
    filename: string,
    tenantId: string,
    userId: string,
    overrides?: { periodName?: string; periodYear?: number; periodMonth?: number; channelType?: string; notes?: string },
  ): Promise<{ batchId: string; totalRows: number; totalAgents: number }> {
    const parsed = this.parse(buffer, filename);

    const periodName  = overrides?.periodName  ?? parsed.periodName;
    const periodYear  = overrides?.periodYear  ?? parsed.periodYear;
    const periodMonth = overrides?.periodMonth ?? parsed.periodMonth;
    const channelType = overrides?.channelType ?? parsed.channelType;

    return this.ds.transaction(async mgr => {
      // Upsert batch
      const existing = await mgr.query(
        `SELECT id FROM kpi_source_batches WHERE tenant_id=$1 AND period_year=$2 AND period_month=$3 AND channel_type=$4`,
        [tenantId, periodYear, periodMonth, channelType],
      );
      let batchId: string;
      if (existing.length) {
        batchId = existing[0].id;
        await mgr.query(`DELETE FROM kpi_weekly_summaries WHERE batch_id=$1`, [batchId]);
        await mgr.query(
          `UPDATE kpi_source_batches SET period_name=$2, total_rows=$3, total_agents=$4, uploaded_by=$5, uploaded_at=NOW(), notes=$6 WHERE id=$1`,
          [batchId, periodName, parsed.totalRows, parsed.totalAgents, userId, overrides?.notes ?? null],
        );
      } else {
        const [row] = await mgr.query(
          `INSERT INTO kpi_source_batches (tenant_id,period_name,period_year,period_month,channel_type,total_rows,total_agents,uploaded_by,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [tenantId, periodName, periodYear, periodMonth, channelType, parsed.totalRows, parsed.totalAgents, userId, overrides?.notes ?? null],
        );
        batchId = row.id;
      }

      for (const s of parsed.weekSummaries) {
        await mgr.query(
          `INSERT INTO kpi_weekly_summaries (
             tenant_id, batch_id, agent_name, agent_login, agent_no,
             function_name, team_leader, week_label, date_from, date_to,
             working_days, total_contacts, total_login_minutes,
             avg_aht_seconds, min_aht_seconds, max_aht_seconds,
             avg_response_seconds, min_response_seconds, max_response_seconds,
             avg_quality, avg_csat, total_transfers, total_holds,
             productivity_pct, working_days_pct
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,$17,$18,$19,
             $20,$21,$22,$23,$24,$25
           )`,
          [
            tenantId, batchId, s.agentName, s.agentLogin, s.agentNo,
            s.functionName, s.teamLeader, s.weekLabel, s.dateFrom, s.dateTo,
            s.workingDays, s.totalContacts, s.totalLoginMinutes,
            s.avgAhtSeconds, s.minAhtSeconds, s.maxAhtSeconds,
            s.avgResponseSeconds, s.minResponseSeconds, s.maxResponseSeconds,
            s.avgQuality, s.avgCsat, s.totalTransfers, s.totalHolds,
            s.productivityPct, s.workingDaysPct,
          ],
        );
      }

      return { batchId, totalRows: parsed.totalRows, totalAgents: parsed.totalAgents };
    });
  }

  /* ── CPO settings ──────────────────────────────────────────────────────── */
  async getCpoSettings(tenantId: string) {
    return this.ds.query(
      `SELECT id, function_name, channel_type, cpo_pct, effective_from, notes
       FROM cpo_settings WHERE tenant_id=$1 ORDER BY function_name, effective_from DESC`,
      [tenantId],
    );
  }

  async upsertCpoSetting(tenantId: string, userId: string, functionName: string, channelType: string, cpoPct: number, notes?: string) {
    await this.ds.query(
      `INSERT INTO cpo_settings (tenant_id, function_name, channel_type, cpo_pct, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, function_name, channel_type, effective_from)
       DO UPDATE SET cpo_pct=$4, notes=$5`,
      [tenantId, functionName, channelType, cpoPct, notes ?? null, userId],
    );
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function weekBounds(wk: string, year: number, month: number, daysInMonth: number): [number, number] {
  switch (wk) {
    case 'W1': return [1,  7];
    case 'W2': return [8,  15];
    case 'W3': return [16, 22];
    case 'W4': return [23, daysInMonth];
    default:   return [1,  daysInMonth];
  }
}

function detectChannelType(filename: string, functions: string[]): string {
  const src = (filename + ' ' + functions.join(' ')).toLowerCase();
  if (/chat|wa|whatsapp|social/.test(src)) return 'chat';
  if (/email|mail/.test(src)) return 'email';
  if (/inbound|voice|call|acd|ivr/.test(src)) return 'voice';
  return 'voice'; // default
}
