import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

/** "HH:MM:SS" (or "H:MM:SS") → seconds. Blank/garbage → 0. */
export function hmsToSec(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

export function secToHms(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const pct = (num: number, den: number) => den > 0 ? Math.round(1000 * num / den) / 10 : 0;

interface Agg {
  userId: string; name: string; campaigns: Set<string>;
  intervals: number; staffed: number; ready: number; break: number; idle: number;
  voiceOff: number; talk: number; acw: number; wrapped: number;
}

/**
 * Agent productivity from an Ameyo "AGENT_Productivity_Interval_Summary" export
 * (CSV or XLSX). Aggregates every 30-min interval row up to one line per agent,
 * replacing the manual login/break/status/productivity reconciliation.
 */
@Injectable()
export class ProductivityService {
  analyze(buffer: Buffer) {
    let wb: XLSX.WorkBook;
    try { wb = XLSX.read(buffer, { type: 'buffer' }); }
    catch { throw new BadRequestException('Could not read the file'); }
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) throw new BadRequestException('The file has no rows');

    // tolerant column lookup (Ameyo headers have trailing dots / casing)
    const keys = Object.keys(rows[0]);
    const col = (want: string) => keys.find(k => k.toLowerCase().replace(/[^a-z]/g, '').includes(want)) ?? '';
    const C = {
      user: col('userid'), name: col('username'), camp: col('campaignname'),
      staffed: col('totalstaffed'), ready: col('totalready'), brk: col('totalbreak'), idle: col('totalidle'),
      voiceOff: col('autocalloffduration'), talk: col('totaltalktimeininterval'), acw: col('totalacwdurationininter'),
      wrapped: col('totalwrappedcalls'),
    };
    if (!C.user || !C.staffed) throw new BadRequestException('This does not look like an Agent Productivity export (missing User ID / Staffed columns)');

    const map = new Map<string, Agg>();
    for (const r of rows) {
      const id = String(r[C.user] ?? '').trim();
      if (!id) continue;
      let a = map.get(id);
      if (!a) { a = { userId: id, name: String(r[C.name] ?? '').trim(), campaigns: new Set(), intervals: 0, staffed: 0, ready: 0, break: 0, idle: 0, voiceOff: 0, talk: 0, acw: 0, wrapped: 0 }; map.set(id, a); }
      a.intervals++;
      if (r[C.camp]) a.campaigns.add(String(r[C.camp]).trim());
      a.staffed += hmsToSec(r[C.staffed]);
      a.ready += hmsToSec(r[C.ready]);
      a.break += hmsToSec(r[C.brk]);
      a.idle += hmsToSec(r[C.idle]);
      a.voiceOff += hmsToSec(r[C.voiceOff]);
      a.talk += hmsToSec(r[C.talk]);
      a.acw += hmsToSec(r[C.acw]);
      a.wrapped += parseInt(String(r[C.wrapped] ?? '0').replace(/[^\d]/g, ''), 10) || 0;
    }

    const agents = [...map.values()].map(a => ({
      userId: a.userId, name: a.name, campaign: [...a.campaigns].join(', '),
      intervals: a.intervals,
      staffed: secToHms(a.staffed), ready: secToHms(a.ready), break: secToHms(a.break),
      idle: secToHms(a.idle), voiceOff: secToHms(a.voiceOff),
      talk: secToHms(a.talk), acw: secToHms(a.acw), wrappedCalls: a.wrapped,
      ahtSec: a.wrapped ? Math.round((a.talk + a.acw) / a.wrapped) : 0,
      aht: a.wrapped ? secToHms((a.talk + a.acw) / a.wrapped) : '—',
      productivityPct: pct(a.ready, a.staffed),
      occupancyPct: pct(a.talk + a.acw, a.staffed),
      breakPct: pct(a.break, a.staffed),
      idlePct: pct(a.idle, a.staffed),
      _staffedSec: a.staffed,
    })).sort((x, y) => y.productivityPct - x.productivityPct);

    const tot = (k: 'staffed' | 'ready' | 'break' | 'idle' | 'voiceOff' | 'talk' | 'acw') => [...map.values()].reduce((s, a) => s + a[k], 0);
    const totStaffed = tot('staffed'), totReady = tot('ready'), totTalk = tot('talk'), totAcw = tot('acw'), totWrapped = [...map.values()].reduce((s, a) => s + a.wrapped, 0);

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        agents: map.size, intervals: rows.length,
        staffedHours: Math.round(totStaffed / 360) / 10,
        avgProductivityPct: pct(totReady, totStaffed),
        avgOccupancyPct: pct(totTalk + totAcw, totStaffed),
        totalWrappedCalls: totWrapped,
        overallAht: totWrapped ? secToHms((totTalk + totAcw) / totWrapped) : '—',
      },
      agents,
    };
  }
}
