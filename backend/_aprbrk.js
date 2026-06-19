const XLSX=require('xlsx');
const D='C:/Users/t.bassam/Desktop/WFM System/My work/April SC & May/';
const sb=XLSX.readFile(D+'sprinklr april break.xlsx');
console.log('=== sprinklr april break.xlsx ===','sheets:',sb.SheetNames.join(' | '));
for(const sn of sb.SheetNames){const r=XLSX.utils.sheet_to_json(sb.Sheets[sn],{header:1,defval:''});
  // find header row (first row with >3 non-empty)
  let hr=r.findIndex(row=>row.filter(x=>x!=='').length>3);
  console.log(`[${sn}] rows=${r.length} headerRow=${hr}: `+JSON.stringify(r[hr]).slice(0,260));
  if(r[hr+1])console.log('  sample: '+JSON.stringify(r[hr+1]).slice(0,260));}
// Shaima/Haya in April Productivity
console.log('\n=== Shaima/Haya in April Productivity sheet ===');
const pr=XLSX.utils.sheet_to_json(XLSX.readFile('C:/Users/t.bassam/Desktop/WFM System/My work/OPS/Score Card 2026/4.April 26 SC..xlsx').Sheets['Productivity'],{header:1,defval:''});
const h=pr[0];console.log('hdr cols0-12:',h.slice(0,13).join(' | '));
for(let i=1;i<pr.length;i++){const nm=String(pr[i][1]||'').toLowerCase();if(/shaim|haya|mohan|saoud/.test(nm))console.log('row',i,JSON.stringify(pr[i].slice(0,13)));}
