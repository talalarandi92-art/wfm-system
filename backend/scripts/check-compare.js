const ExcelJS = require('exceljs'); const fs = require('fs');
const S = 'C:/Users/T573E~1.BAS/AppData/Local/Temp/claude/C--Users-t-bassam-Desktop-WFM-System/63e84c5a-2fd1-476e-8a73-031ad06b92a0/scratchpad/recon';
const recs = JSON.parse(fs.readFileSync(S + '/records.json', 'utf8')); const byKey = {}; for (const r of recs) byKey[r.id + '|' + r.date] = r;
const isoOf = v => { if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v); let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null; let y = +m[3]; if (y < 100) y += 2000; return y + '-' + String(+m[1]).padStart(2,'0') + '-' + String(+m[2]).padStart(2,'0'); };
const isYellow = a => { if (!a) return false; a = String(a).replace(/^FF/, ''); if (a.length < 6) return false; const R = parseInt(a.slice(0,2),16), G = parseInt(a.slice(2,4),16), B = parseInt(a.slice(4,6),16); return R > 180 && G > 180 && B < 130; };
(async () => {
  const wbIn = new ExcelJS.Workbook(); await wbIn.xlsx.readFile('C:/Users/t.bassam/Desktop/new roster/Check.xlsx');
  const ws = wbIn.worksheets[0];
  const out = []; let yCount = 0;
  ws.eachRow((row, rn) => { if (rn === 1) return;
    let yellow = false; for (let c = 1; c <= 16; c++) { const f = row.getCell(c).fill; if (f && f.fgColor && isYellow(f.fgColor.argb)) { yellow = true; break; } }
    const date = isoOf(row.getCell(1).value), id = row.getCell(4).value, name = row.getCell(3).value, shift = row.getCell(8).value, yourNote = row.getCell(11).value;
    if (!date || !id) return; if (yellow) yCount++;
    const me = byKey[String(id) + '|' + date];
    const review = me ? (/HR ACTION/i.test(me.disp) || me.hr === 'Yes' || /Manual Review/i.test(me.disp)) : null;
    const engine = !me ? 'no record' : (review ? 'REVIEW / HR' : "DON'T penalize");
    out.push({ date, id, name, shift, yourNote, youExcused: yellow ? 'EXCUSED (yellow)' : '', engine, dispo: me ? me.disp : '-', L: me ? me.rawLate : '-', E: me ? me.rawEarly : '-',
      agreement: me == null ? 'no record' : (yellow && !review ? '✓ both excuse' : (yellow && review ? 'you excused / engine flags' : (!yellow && !review ? 'engine excuses / you did not' : '✓ both flag'))) });
  });
  // write highlighted output
  const wbo = new ExcelJS.Workbook(); const o = wbo.addWorksheet('My_verdict');
  o.columns = [{header:'Date',key:'date',width:11},{header:'Name',key:'name',width:22},{header:'ID',key:'id',width:8},{header:'Shift',key:'shift',width:7},{header:'Your Note',key:'yourNote',width:14},{header:'You excused?',key:'youExcused',width:16},{header:'ENGINE',key:'engine',width:15},{header:'Eng Late(min)',key:'L',width:11},{header:'Eng Early(min)',key:'E',width:11},{header:'Engine disposition',key:'dispo',width:34},{header:'Agreement',key:'agreement',width:26}];
  o.getRow(1).font = { bold: true };
  for (const r of out) { const row = o.addRow(r);
    if (r.engine === "DON'T penalize") row.eachCell(c => c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFB7E1A1'} }); // green = engine says don't penalize
    else if (r.engine === 'REVIEW / HR') row.getCell('engine').fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF4A6A6'} }; }
  await wbo.xlsx.writeFile('C:/Users/t.bassam/Desktop/new roster/My_Verdict_vs_Yours.xlsx');
  const byA = {}; for (const r of out) byA[r.agreement] = (byA[r.agreement]||0)+1;
  console.log('your yellow (excused) rows detected: ' + yCount + ' of ' + out.length);
  console.log('agreement breakdown:'); for (const [k,v] of Object.entries(byA)) console.log('  ' + v + '  ' + k);
  console.log('\n→ My_Verdict_vs_Yours.xlsx (GREEN = engine says do NOT penalize)');
})().catch(e=>console.error(e.message));
