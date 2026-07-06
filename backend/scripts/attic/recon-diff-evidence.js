/**
 * Build a RICH review Excel: every engine-vs-manual diff with the RAW Ameyo + Sprinklr
 * sessions for that employee/day, so the user can adjudicate each one with full evidence.
 * Reuses the engine's loaded sessions (require recon-new-roster does NOT run the build).
 */
const XLSX = require('xlsx');
const M = require('./recon-new-roster');
const { ameyoSessions, sprinkSessions, absToDM, F } = M;
const BASE_MS = new Date('2026-05-31T00:00:00Z').getTime();
const hhmm = (m) => m == null ? '' : String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0') + ':' + String(((m % 1440) + 1440) % 60).padStart(2, '0');

// all sessions for an employee whose login falls in [D-1 18:00 .. D+1 12:00] (captures cross-midnight night shifts)
function sessionsFor(map, id, date) {
  const list = map[id] || [];
  const dayIdx = Math.round((new Date(date + 'T00:00:00Z').getTime() - BASE_MS) / 86400000);
  const absMid = dayIdx * 1440, lo = absMid - 360, hi = absMid + 1440 + 720;
  return list.filter(s => s.aLogin >= lo && s.aLogin <= hi)
    .sort((a, b) => a.aLogin - b.aLogin)
    .map(s => {
      const di = absToDM(s.aLogin), doo = absToDM(s.aLogout);
      const tag = di.date < date ? '(prev) ' : di.date > date ? '(next) ' : '';
      const outTag = doo.date > di.date ? ' (+1)' : '';
      return tag + hhmm(di.min) + '→' + hhmm(doo.min) + outTag;
    }).join('  ·  ');
}

const cmp = XLSX.readFile('C:/Users/t.bassam/Desktop/new roster/Manual_vs_Engine_Comparison.xlsx');
const rows = XLSX.utils.sheet_to_json(cmp.Sheets['Manual_vs_Engine']).filter(r => r.Match === '✗ DIFF');
const tm = (s) => { if (!s || s === '—') return null; const m = String(s).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; };
const isNonWork = (c) => /^(OFF|L|H|SL|COMP|DL|RES|TER)$/i.test(c) || (/S$/.test(c) && c.length > 1) || (/A$/.test(c) && c.length > 1 && !/^AM/i.test(c));
const isNight = (c) => /^(MD|MN|E|EE|N)/i.test(c);
const cat = (d) => {
  const c = String(d.Code || '').trim(); const yE = tm(d['Your EarlyOut']), yL = tm(d['Your Late']), mLog = tm(d['My Login']), yLog = tm(d['Your Login']);
  const ld = (mLog != null && yLog != null) ? Math.abs(((mLog - yLog + 720 + 1440) % 1440) - 720) : null; const imp = (yE != null && yE > 240) || (yL != null && yL > 240);
  if (isNonWork(c)) return '3 ENGINE-right (non-working day)';
  if (isNight(c) && imp) return '2 ENGINE-right (manual night artifact)';
  if (/outside shift/.test(String(d['Likely issue'] || ''))) return '1 manual slip';
  if (ld != null && ld <= 15 && !imp) return '4 immaterial ping (<=15min)';
  return '0 GENUINE — review';
};

const out = rows.map(d => {
  const id = d.EmployeeID, date = d.Date;
  const sch = (F.schedule && F.schedule[id + '|' + date]) || {};
  return {
    Category: cat(d), Date: date, Day: d.Day, EmployeeID: id, Name: d.Name, Code: d.Code,
    'Scheduled': (sch.start != null ? hhmm(sch.start) + '–' + hhmm(sch.end) : ''),
    'My Login': d['My Login'], 'Your Login': d['Your Login'],
    'My Late': d['My Late'], 'Your Late': d['Your Late'],
    'My EarlyOut': d['My EarlyOut'], 'Your EarlyOut': d['Your EarlyOut'],
    'My Logout': d['My Logout'], 'Your Logout': d['Your Logout'],
    'RAW Ameyo sessions': sessionsFor(ameyoSessions, id, date) || '(none matched)',
    'RAW Sprinklr sessions': sessionsFor(sprinkSessions, id, date) || '(none matched)',
    'Engine source': d.Source, 'Engine disposition': d['My Disposition'],
  };
}).sort((a, b) => a.Category.localeCompare(b.Category) || a.Date.localeCompare(b.Date) || String(a.Name).localeCompare(String(b.Name)));

const owb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(out);
ws['!cols'] = [{ wch: 30 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 20 }, { wch: 7 }, { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 40 }, { wch: 40 }, { wch: 20 }, { wch: 28 }];
XLSX.utils.book_append_sheet(owb, ws, 'Diffs_with_evidence');
const P = 'C:/Users/t.bassam/Desktop/new roster/Diffs_To_Review.xlsx';
XLSX.writeFile(owb, P);
const byCat = {}; for (const r of out) byCat[r.Category] = (byCat[r.Category] || 0) + 1;
console.log('wrote ' + out.length + ' diffs with raw sessions → ' + P);
console.log('by category:', JSON.stringify(byCat, null, 0));
